/**
 * Apply `typescript/strict-boolean-expressions` from oxlint's own JSON report.
 *
 * Same bet as `unnecessary-condition-fix.ts`: the rule has already done the type analysis, so a
 * fixer only has to find the syntax the verdict is about, which is a parse. Here the report says
 * more than where — its wording names the offending type, and the rewrite follows from that
 * wording alone:
 *
 *   nullable boolean   `x`  ->  `x === true`          `!x`  ->  `x !== true`
 *   nullable string    `s`  ->  `hasText(s)`          `!s`  ->  `!hasText(s)`
 *   nullable string    `s || fallback` in a value position  ->  `textOr(s, fallback)`
 *
 * Both of those are exactly the original truthiness test, for both spellings of nothing, so
 * neither needs to know whether the value is `null` or `undefined`. The third wording, a nullable
 * number, has no such rewrite and is listed instead: `(n ?? 0) !== 0` is the original test for
 * every value but NaN, and the spelling that reproduces NaN names `n` twice. Without `--predicate`
 * the string form is written out as `(s ?? "") !== ""` and no import is added; with it the tool
 * calls the named predicate and inserts the import, which is the one thing a repository has to
 * tell it. The predicate is a parameter rather than a built-in name because the tool has to
 * outlive this tree.
 *
 * The other three wordings — an object that is always truthy, a nullish value that is always
 * falsy, a union with inconsistent truthiness — are left alone and listed. Those are the same
 * branch surgery `no-unnecessary-condition` leaves to a reader: which arm survives is the
 * author's call, and a rewrite that preserves the condition preserves the defect.
 *
 * None of the three refusals `unnecessary-condition-fix.ts` pays for carries over, and the reason
 * is worth stating once. Those refusals stop a wrong edit: removing a guard changes behaviour, so
 * a verdict from a degraded program, a tree with no local owner or a line someone commented is a
 * reason to stop. Every rewrite here preserves the condition exactly, so none of those is a risk,
 * and the rule is in the gate, which means every site it reports has to be repaired anyway — a
 * refusal would only leave the tree red. A refusal follows the risk of the transform and the
 * standing of the rule, not the name of the rule. `--skip=<prefix>` is still there for a tree the
 * caller owns differently.
 *
 * Four things a parse alone gets wrong, all found by running the result through `tsc`:
 *
 *   - `[].filter(cb)` and its family are conditional positions, and the span oxlint reports is the
 *     whole call, not the callback's returned expression. The rewrite goes on the body.
 *   - `s || undefined` is not `textOr(s, undefined)`: the helper returns a string. Hand work.
 *   - a file that already binds the predicate's name cannot import it.
 *   - a rewrite that is the original test can still stop the file compiling, because it does not
 *     narrow the value the way the guard did. Nothing in the report says whether a use follows.
 *
 * The middle one is not a refusal any more, and neither is a file `--constrained` holds at a
 * frozen size. Both mean only that the import cannot be added, and the predicate has a spelling
 * that needs no import: `(s ?? "") !== ""` is what the helper does. That is also what a reader
 * reached for by hand in `src/builder/tools.ts` and `src/correctness-bundle/probes.ts`, whose sizes are
 * frozen in `tools/loc/source-policy.json`, where an import line is a line like any other.
 *
 * The last cannot be decided before the edit, so the tool is meant to be run under
 * `fix-loop.ts`: apply, typecheck, add every line the compiler complains about to `--hold`,
 * revert the tree and run again. Each round starts from the same clean tree and the same census,
 * so offsets never go stale and the held set only grows. The compiler is the oracle here, not the
 * analyser: the fixer still proposes without one.
 *
 * Usage:
 *   bun tools/oxlint/strict-boolean-fix.ts <report.json> <tree> [--predicate hasText:textOr:src/meta/text.ts]
 *     [--skip=<prefix>] [--constrained=<path>] [--hold=<file of path:line>]
 *   bun tools/oxlint/strict-boolean-fix.ts --revert <journal.json> <tree> [path:line ...]
 */
import { readFileSync } from "../../src/meta/filesystem.ts";
import { dirname, relative } from "../../src/meta/path.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import * as ts from "typescript5";
import {
  type Diagnostic,
  type Edit,
  type Held,
  applyEdits,
  nodeFor,
  readReport,
  revertJournal,
  type Site,
  reportRun,
  siteOf,
} from "./fixer-source.ts";

interface Predicate {
  readonly test: string;
  readonly fallback: string;
  readonly module: string;
}

const RULE = "strict-boolean-expressions";
const UTF8 = "utf8";
const WORDING: readonly (readonly [string, string])[] = [
  ["nullable boolean", "boolean"],
  ["nullable string", "string"],
  ["nullable number", "number"],
];
const ARGUMENTS = runtimeProcess.argv.slice(2);
const REVERTING = ARGUMENTS[0] === "--revert";
const REPORT_PATH = ARGUMENTS[REVERTING ? 1 : 0] ?? "";
const ROOT = (REVERTING ? ARGUMENTS[2] : ARGUMENTS[1]) ?? "";
const WANTED = new Set(ARGUMENTS.slice(3));
const PREDICATE_ARGUMENT = ARGUMENTS.find((one) => one.startsWith("--predicate="));
const SKIPPED = ARGUMENTS.filter((one) => one.startsWith("--skip=")).map((one) => one.slice(7));
/** Files that may not gain a line, so the predicate is written out instead of imported. */
const CONSTRAINED = new Set(
  ARGUMENTS.filter((one) => one.startsWith("--constrained=")).map((one) =>
    one.slice("--constrained=".length),
  ),
);
/** Operators that already state a test, so a guard beside one of them is saying it twice. */
const COMPARISONS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
]);

/** Array methods whose callback return is read as a condition; oxlint's span covers the call. */
const PREDICATE_CALLS = new Set([
  "filter",
  "find",
  "findLast",
  "findIndex",
  "findLastIndex",
  "some",
  "every",
]);
const HOLD_ARGUMENT = ARGUMENTS.find((one) => one.startsWith("--hold="));
/** `a && b` and its family name two operands where the report names one offending value. */
const LOGICAL = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);
/** Sites an earlier round proved the compiler will not accept, spelled `path:line`. */
const HELD = new Set(
  HOLD_ARGUMENT === undefined
    ? []
    : readFileSync(HOLD_ARGUMENT.slice("--hold=".length), UTF8)
        .split("\n")
        .map((one) => one.trim())
        .filter((one) => one.length > 0),
);

const held = new Map<string, Held>();
const sites: Site[] = [];
const refused = new Map<string, number>();
const edits: Edit[] = [];
const manual: Site[] = [];
const landed: Edit[] = [];
const imported = new Map<string, Set<string>>();

function predicateFrom(argument: string | undefined): Predicate | undefined {
  if (argument === undefined) return undefined;
  const parts = argument.slice("--predicate=".length).split(":");
  const [test, fallback, module] = parts;
  if (test === undefined || fallback === undefined || module === undefined) return undefined;
  return { test, fallback, module };
}

/** True where the file already binds the predicate's name, so the import would collide with it. */
function shadows(file: Held, predicate: Predicate): boolean {
  let bound = false;
  const named = (node: ts.Node): boolean =>
    (ts.isVariableDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isBindingElement(node)) &&
    node.name !== undefined &&
    ts.isIdentifier(node.name) &&
    node.name.text === predicate.test;
  const visit = (node: ts.Node): void => {
    if (named(node)) bound = true;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file.source, visit);
  return bound;
}

/** True where the expression is read as a condition rather than as a value. */
function asksForTruth(node: ts.Node): boolean {
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined) return false;
  if (ts.isParenthesizedExpression(parent)) return asksForTruth(parent);
  if (ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken) return true;
  if (ts.isBinaryExpression(parent)) {
    const logical =
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      parent.operatorToken.kind === ts.SyntaxKind.BarBarToken;
    return logical && asksForTruth(parent);
  }
  if (ts.isIfStatement(parent) || ts.isWhileStatement(parent) || ts.isDoStatement(parent)) {
    return parent.expression === node;
  }
  if (ts.isForStatement(parent)) return parent.condition === node;
  if (ts.isConditionalExpression(parent)) return parent.condition === node;
  return false;
}

function replacement(
  kind: string,
  expression: string,
  negated: boolean,
  predicate: Predicate | undefined,
): string {
  if (kind === "boolean") return negated ? `${expression} !== true` : `${expression} === true`;
  if (kind === "string" && predicate !== undefined) {
    return negated ? `!${predicate.test}(${expression})` : `${predicate.test}(${expression})`;
  }
  return negated ? `(${expression} ?? "") === ""` : `(${expression} ?? "") !== ""`;
}

/** A fallback whose early evaluation neither runs code nor throws: a literal or a plain name. */
function inert(node: ts.Expression): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isIdentifier(node)
  );
}

/**
 * `s || fallback` read as a value is the fallback helper, not a condition.
 *
 * `"eager"` is the one shape this reads and refuses rather than not recognising: a fallback the
 * helper would evaluate that `||` would not.
 */
function fallbackEdit(
  file: Held,
  site: Site,
  node: ts.Node,
  predicate: Predicate,
): Edit | "eager" | undefined {
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined || !ts.isBinaryExpression(parent)) return undefined;
  if (parent.operatorToken.kind !== ts.SyntaxKind.BarBarToken || parent.left !== node) return undefined;
  if (asksForTruth(parent)) return undefined;
  if (parent.right.kind === ts.SyntaxKind.NullKeyword || parent.right.getText(file.source) === "undefined") {
    return undefined;
  }
  const start = parent.getStart(file.source);
  const left = file.text.slice(node.getStart(file.source), node.getEnd());
  const right = file.text.slice(parent.right.getStart(file.source), parent.right.getEnd());
  // `||` does not evaluate its right side when the left one answers; a helper taking two
  // arguments always does. `cached || recompute()` became `textOr(cached, recompute())`, which
  // returns the same string and runs the fallback anyway — a write, a fetch or a throw the
  // original never reached. Looking for a call missed `await next`, a tagged template and a
  // getter or a missing object behind `row.fallback`, so the right side must be inert instead:
  // a literal or a plain name, whose evaluation does nothing the original could have skipped.
  if (!inert(parent.right)) return "eager";
  return {
    path: site.path,
    start,
    end: parent.getEnd(),
    text: `${predicate.fallback}(${left}, ${right})`,
    was: file.text.slice(start, parent.getEnd()),
    kind: "fallback",
    line: site.line,
  };
}

/**
 * Where the span covers a whole `rows.filter(cb)` the condition may be either the call's own
 * result or the callback's returned expression, and the span says nothing about which. The
 * position decides: a call read as a condition is the condition, and only a call read as a value
 * sends the rewrite into its callback. `undefined` means no single expression is named — a block
 * body, or a body that is itself an `&&` chain whose offending operand the report does not say.
 */
function throughPredicate(node: ts.Node): ts.Node | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return node;
  if (!PREDICATE_CALLS.has(node.expression.name.text)) return node;
  if (asksForTruth(node)) return node;
  const [callback] = node.arguments;
  if (callback === undefined || !ts.isArrowFunction(callback) || ts.isBlock(callback.body)) return undefined;
  const chained = ts.isBinaryExpression(callback.body) && LOGICAL.has(callback.body.operatorToken.kind);
  return chained ? undefined : callback.body;
}

/**
 * True where the conjunct next to this one already compares the same expression, as in
 * `outcome.status && outcome.status !== 0`. Rewriting the guard there is correct and says the
 * thing twice — `(outcome.status ?? 0) !== 0 && outcome.status !== 0` — and the second half is
 * then a `no-unnecessary-condition` finding on the next run. Which of the two tests survives is
 * a reader's call, so the site is left whole. The comparison's own left side has to be the same
 * text, which is what separates this from `a && a.b`, where the guard is doing real work.
 */
function alreadyCompared(file: Held, node: ts.Node): boolean {
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined || !ts.isBinaryExpression(parent)) return false;
  if (!LOGICAL.has(parent.operatorToken.kind)) return false;
  const sibling = parent.left === node ? parent.right : parent.left;
  if (!ts.isBinaryExpression(sibling) || !COMPARISONS.has(sibling.operatorToken.kind)) return false;
  return sibling.left.getText(file.source) === node.getText(file.source);
}

/**
 * The `!` a rewrite has to swallow. `!s` is one test, not a negation of another, so the edit
 * replaces the whole prefix expression and inverts the comparison rather than wrapping it.
 */
function negationAround(node: ts.Node): ts.Node | undefined {
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined || !ts.isPrefixUnaryExpression(parent)) return undefined;
  if (parent.operator !== ts.SyntaxKind.ExclamationToken || parent.operand !== node) return undefined;
  return parent;
}

function editFor(file: Held, site: Site, predicate: Predicate | undefined): Edit | undefined {
  const kind = WORDING.find(([wording]) => site.message.includes(wording))?.[1];
  if (kind === undefined) return undefined;
  const found = nodeFor(file.source, site.start, site.end);
  if (found === undefined) return undefined;
  const node = throughPredicate(found);
  if (node === undefined) {
    refuse("a callback the span does not resolve to one expression");
    return undefined;
  }
  if (kind === "number") {
    // `(n ?? 0) !== 0` is the original test for every number but NaN, which is falsy and compares
    // unequal to zero. The spelling that reproduces NaN names `n` a second time, and `n` here can
    // be a call, so no correct single-evaluation rewrite exists.
    //
    // `.length` and `.size` were promoted to a count and rewritten anyway, on the ground that a
    // count is never negative and never NaN. That is a claim about the receiver, and the only
    // thing read was the property's spelling: a declared `{ size?: number }` holding `-1` reads
    // as truthy and `(row.size ?? 0) > 0` as false, with no type in view to say which `size` this
    // is. The promotion is withdrawn and the number kind refuses outright.
    refuse("a number whose NaN case no single-evaluation comparison reproduces");
    return undefined;
  }
  const wantsText = kind === "string";
  const blocked =
    wantsText && (predicate === undefined || CONSTRAINED.has(site.path) || shadows(file, predicate));
  if (wantsText && !blocked && predicate !== undefined) {
    const fallback = fallbackEdit(file, site, node, predicate);
    if (fallback === "eager") {
      refuse("a fallback `||` would not evaluate unless it had to");
      return undefined;
    }
    if (fallback !== undefined) return fallback;
  }
  // Read as a value rather than as a condition, the expression's own value is what the program
  // uses, and every rewrite here yields a boolean. `a || b` has the fallback above; nothing else
  // in a value position can be rewritten without changing what the line evaluates to.
  if (node === found && !asksForTruth(node)) {
    refuse("an expression read as a value, not as a condition");
    return undefined;
  }
  if (alreadyCompared(file, node)) {
    refuse("a value the conjunct beside it already compares");
    return undefined;
  }
  const negation = negationAround(node);
  const negated = negation !== undefined;
  const target = negation ?? node;
  const start = target.getStart(file.source);
  const expression = file.text.slice(node.getStart(file.source), node.getEnd());
  const spelling = blocked ? "inline" : kind;
  return {
    path: site.path,
    start,
    end: target.getEnd(),
    text: replacement(spelling, expression, negated, predicate),
    was: file.text.slice(start, target.getEnd()),
    kind: spelling,
    line: site.line,
  };
}

function refuse(why: string): void {
  refused.set(why, (refused.get(why) ?? 0) + 1);
}

function collect(diagnostics: readonly Diagnostic[]): void {
  for (const one of diagnostics) {
    if (!(one.code ?? "").includes(RULE)) continue;
    const span = one.labels[0]?.span;
    if (span === undefined) continue;
    if (SKIPPED.some((prefix) => one.filename.startsWith(prefix))) {
      refuse("a tree the caller skipped");
      continue;
    }
    if (HELD.has(`${one.filename}:${String(span.line)}`)) {
      refuse("a line an earlier round could not compile");
      continue;
    }
    sites.push(siteOf(held, ROOT, one, span));
  }
}

/** The import the predicate needs, once per file, after the imports already there. */
function importEdit(file: Held, path: string, predicate: Predicate): Edit | undefined {
  const names = imported.get(path);
  if (names === undefined || names.size === 0) return undefined;
  const wanted = [...names].sort();
  const target = relative(dirname(path), predicate.module);
  const specifier = target.startsWith(".") ? target : `./${target}`;
  let last: ts.Node | undefined;
  for (const statement of file.source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const text = statement.moduleSpecifier.getText(file.source).slice(1, -1);
    if (text === specifier) return undefined;
    last = statement;
  }
  const at = last === undefined ? 0 : last.getEnd();
  return {
    path,
    start: at,
    end: at,
    text: `\nimport { ${wanted.join(", ")} } from "${specifier}";`,
    was: "",
    kind: "import",
    line: 1,
  };
}

if (REVERTING) {
  revertJournal(REPORT_PATH, ROOT, WANTED);
} else {
  const predicate = predicateFrom(PREDICATE_ARGUMENT);
  collect(readReport(REPORT_PATH).diagnostics);
  for (const site of sites) {
    const file = held.get(site.path);
    const edit = file === undefined ? undefined : editFor(file, site, predicate);
    if (edit === undefined) {
      manual.push(site);
      continue;
    }
    edits.push(edit);
    if (predicate !== undefined && (edit.kind === "string" || edit.kind === "fallback")) {
      const names = imported.get(site.path) ?? new Set<string>();
      names.add(edit.kind === "fallback" ? predicate.fallback : predicate.test);
      imported.set(site.path, names);
    }
  }
  const imports =
    predicate === undefined
      ? []
      : [...held].flatMap(([path, file]) => importEdit(file, path, predicate) ?? []);
  edits.push(...imports);
  landed.push(...applyEdits(held, ROOT, edits));
  reportRun({
    reportPath: REPORT_PATH,
    held,
    sites,
    refused,
    manual,
    edits,
    landed,
    verb: "rewrote",
    note: "",
  });
}
