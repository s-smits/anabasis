// Apply the mechanical part of `typescript/no-unnecessary-condition` from oxlint's own report.
//
// The rule does the type analysis and ships no fixer. This does the opposite: it trusts the
// verdict and only has to find the syntax the verdict is about, which is a parse, not a checker.
//
// It reads `--format=json`, not `--format=unix`, and the difference decides whether the tool works
// at all. The unix line gives the start column, and several nodes start there: in `a?.b?.()` the
// column of `a` belongs to `a`, to `a?.b` and to the whole call, each of which would have a
// different `?.` removed. The JSON span gives offset *and* length, so exactly one node matches the
// diagnostic and the `?.` to drop is the one the matched node hangs off. Guessing that from the
// column alone removed the wrong `?.` at 4 sites on the 2026-09-20 sweep and turned two guarded
// optional properties into type errors.
//
// Three transforms, each the whole of what the diagnostic implies:
//   chain    `a?.b` -> `a.b`, `a?.()` -> `a()`, `a?.[i]` -> `a[i]`
//   nullish  `a ?? b` -> `a`
//   fold     `x === null || x === undefined` -> `x === null`  (`--fold`)
//
// The third needs its constant, and "no overlap" supplies it: if two types do not overlap then
// `===` is always false and `!==` always true, whatever the operands are. A dead operand of an
// `&&` or an `||` therefore folds away without reading intent. It is still confined to a
// comparison against `null` or `undefined`, and it is off by default. A dead comparison against a
// domain literal reads the same way and is usually a validator over a value an `as` asserted into
// shape — dead to the type, live at runtime, and the honest repair is at the assertion. Folding
// those would delete the check and leave the lie.
//
// Anything else is branch surgery: which arm survives is the author's call, so the site is listed
// and left. Swapping `x === undefined` for `x === null` was tried and withdrawn, because over 23
// sites it cleared 4 and the rest are dead either way.
//
// ## Three refusals, all of them paid for
//
// A verdict is only as good as the program it was computed against, and a removal is only safe if
// the type that justified it is honest. Neither is visible in the diagnostic, so the tool refuses
// three classes outright rather than reporting them as fixed:
//
//  - **Outside the type program.** A type-aware verdict over a file `tsconfig.json` does not name
//    is computed against a default program — no `strict`, no `noUncheckedIndexedAccess`, no
//    `exactOptionalPropertyTypes` — under which almost every guard looks unnecessary. The sweep of
//    2026-09-20 edited 12 sites in six `.mjs` files on the strength of such verdicts and deleted a
//    real runtime guard at every one of them; they were 32 of that run's 44 gate failures. The
//    refusal is not a list of suffixes: it is `tsconfig.json`'s own file set, so it follows the
//    program wherever the program moves.
//  - **A vendored tree.** A copy held at a pinned upstream commit pays a merge cost for every
//    local edit, and the edit has no owner here. `vendor/`, `third_party/` and `node_modules/`
//    segments are refused; `--skip=<prefix>` adds more.
//  - **A commented statement.** A comment names the run, the invariant or the rejected
//    alternative a line exists for. If someone wrote one over the statement holding the site, the
//    site is a judgement, not a typo. This is the bluntest of the three and the one that earns its
//    keep: it catches the guard whose reason is written down and whose type does not say it.
//
// What no refusal catches is the fourth class, where the type itself is the lie — a value asserted
// into shape by `as`, a library signature that promises more than the runtime delivers, a `let`
// narrowed at closure creation and read later. Those need a reader. The journal is what makes that
// affordable: every landed edit is recorded, and `--revert <journal> [path:line ...]` puts any
// subset back after the reading.
//
// Usage:
//   oxlint --type-aware --format=json … > report.json
//   bun tools/oxlint/unnecessary-condition-fix.ts report.json <repo-root> [--fold] [--skip=p]
//   bun tools/oxlint/unnecessary-condition-fix.ts x x --revert report.json.journal.json [path:line]
import { existsSync, readFileSync } from "../../src/meta/filesystem.ts";
import { join, relative } from "../../src/meta/path.ts";
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

/** Trees held at a pinned upstream commit, where a local edit has no owner and costs a merge. */
const VENDORED = ["vendor/", "third_party/", "node_modules/"];
const RULE = "no-unnecessary-condition";
const UTF8 = "utf8";

const argv = runtimeProcess.argv;
const reportPath = argv[2] ?? "";
const root = argv[3] ?? "";
const folding = argv.includes("--fold");
const journalPath = argv[4] === "--revert" ? (argv[5] ?? "") : "";

/** Each file the report names, parsed once and shared by every site in it. */
const held = new Map<string, Held>();
/** Sites refused outright, counted by the ground for the refusal. */
const refused = new Map<string, number>();
const sites: Site[] = [];
const edits: Edit[] = [];
const manual: Site[] = [];
/** Sites a transform matched and the comment refusal then handed back to the reader. */
const commentedSites: Site[] = [];

// Overlapping edits cannot both land in one pass; the next census picks up whatever is left.
/**
 * The repository-relative files `tsconfig.json` puts in the program, or `undefined` when there is
 * no config to read, in which case nothing is refused on this ground.
 */
function programFiles(tree: string): ReadonlySet<string> | undefined {
  const config = join(tree, "tsconfig.json");
  if (!existsSync(config)) return undefined;
  const read = ts.readConfigFile(config, (path) => readFileSync(path, UTF8));
  if (read.config === undefined) return undefined;
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, tree);
  return new Set(parsed.fileNames.map((one) => relative(tree, one)));
}

/**
 * Whether a comment sits anywhere in the statement holding this node. Comments are trivia, so this
 * asks the scanner rather than the text: a `//` inside a string literal or a URL is not one.
 */
function commented(file: Held, node: ts.Node): boolean {
  let statement: ts.Node = node;
  while (statement.parent !== undefined && !ts.isSourceFile(statement) && !ts.isStatement(statement)) {
    statement = statement.parent;
  }
  let found = false;
  const visit = (one: ts.Node): void => {
    if (found) return;
    const ranges = ts.getLeadingCommentRanges(file.text, one.getFullStart());
    if (ranges !== undefined && ranges.length > 0) found = true;
    else ts.forEachChild(one, visit);
  };
  visit(statement);
  return found;
}

/**
 * The fold: the flagged operand's comparison is a constant, so the `&&` or `||` it sits in keeps
 * its other arm. `true && rest` keeps rest and `false || rest` keeps rest; the other two fold the
 * whole chain to a constant, which is a branch the author owns.
 */
function foldEdit(file: Held, site: Site, node: ts.Node, parent: ts.Node): Edit | undefined {
  if (!ts.isBinaryExpression(parent)) return undefined;
  const equals = parent.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
  const differs = parent.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
  if (!equals && !differs) return undefined;
  const other = parent.left === node ? parent.right : parent.left;
  const absent =
    other.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(other) && other.text === "undefined");
  if (!absent) return undefined;
  const chain: ts.Node | undefined = parent.parent;
  if (chain === undefined || !ts.isBinaryExpression(chain)) return undefined;
  const conjunction = chain.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken;
  const disjunction = chain.operatorToken.kind === ts.SyntaxKind.BarBarToken;
  if (!((conjunction && differs) || (disjunction && equals))) return undefined;
  const survivor = chain.left === parent ? chain.right : chain.left;
  const start = chain.getStart(file.source);
  const end = chain.getEnd();
  const text = file.text.slice(survivor.getStart(file.source), survivor.getEnd());
  return {
    path: site.path,
    start,
    end,
    text,
    was: file.text.slice(start, end),
    kind: "fold",
    line: site.line,
  };
}

function editFor(file: Held, site: Site): Edit | undefined {
  const optional = site.message.includes("optional chain");
  const dead = site.message.includes("no overlap");
  if (!optional && !(dead && folding)) return undefined;
  const node = nodeFor(file.source, site.start, site.end);
  const parent: ts.Node | undefined = node?.parent;
  if (node === undefined || parent === undefined) return undefined;
  if (commented(file, node)) {
    commentedSites.push(site);
    return undefined;
  }
  if (dead) return foldEdit(file, site, node, parent);

  const made = (start: number, end: number, text: string, kind: string): Edit => ({
    path: site.path,
    start,
    end,
    text,
    was: file.text.slice(start, end),
    kind,
    line: site.line,
  });
  if (
    ts.isPropertyAccessExpression(parent) ||
    ts.isElementAccessExpression(parent) ||
    ts.isCallExpression(parent)
  ) {
    const question = parent.questionDotToken;
    if (parent.expression !== node || question === undefined) return undefined;
    // `a?.b` keeps its dot; `a?.()` and `a?.[i]` drop the pair entirely.
    const keepsDot = ts.isPropertyAccessExpression(parent);
    return made(question.getStart(file.source), question.getEnd(), keepsDot ? "." : "", "chain");
  }
  const nullish =
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
    parent.left === node;
  return nullish ? made(node.getEnd(), parent.getEnd(), "", "nullish") : undefined;
}

/** Every site the report names, minus the three refusals, each converted to char offsets. */
function collect(
  diagnostics: readonly Diagnostic[],
  inProgram: ReadonlySet<string> | undefined,
  skip: string[],
): void {
  for (const one of diagnostics) {
    const span = one.labels[0]?.span;
    if (one.code === undefined || !one.code.includes(RULE) || span === undefined) continue;
    const outside = inProgram !== undefined && !inProgram.has(one.filename);
    const vendored = skip.some(
      (prefix) => one.filename.startsWith(prefix) || one.filename.includes(`/${prefix}`),
    );
    if (outside || vendored) {
      const why = outside ? "outside the type program" : "in a vendored tree";
      refused.set(why, (refused.get(why) ?? 0) + 1);
      continue;
    }
    sites.push(siteOf(held, root, one, span));
  }
}

if (journalPath !== "") {
  revertJournal(journalPath, root, new Set(argv.slice(6)));
  runtimeProcess.exit(0);
}

collect(readReport(reportPath).diagnostics, programFiles(root), [
  ...VENDORED,
  ...argv.filter((one) => one.startsWith("--skip=")).map((one) => one.slice(7)),
]);

for (const site of sites) {
  const file = held.get(site.path);
  const edit = file === undefined ? undefined : editFor(file, site);
  if (edit === undefined) manual.push(site);
  else edits.push(edit);
}

const landed = applyEdits(held, root, edits);

reportRun({
  reportPath,
  held,
  sites,
  refused,
  manual,
  edits,
  landed,
  verb: "fixed",
  note: `, ${String(commentedSites.length)} of them at a commented statement`,
});
