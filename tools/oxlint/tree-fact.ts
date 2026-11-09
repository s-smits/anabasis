/**
 * One fact about a value (a field tested against a literal, read together with another field of
 * the same value) written out as an expression in three or more production files, where no
 * function owns it.
 *
 * Recorded case: "what the checker measured of a valid answer", `checker?.kind === "pass" ?
 * checker.objective ?? null : null` and its variants, stood in src/kernel/compare.ts,
 * src/builder/tools.ts (twice) and tools/wri/gate-era.ts until commit 073acaa7c (5 November 2026)
 * gave it one owner, `measureOf` in src/kernel/solves.ts (now `objectiveOf` in
 * src/kernel/verify.ts, beside the type). `tree/no-duplicate-block` missed it: each copy was one
 * expression, not consecutive statements, and the spellings differed.
 *
 * A unit is an outermost condition or derivation: a `?:`, `&&`, `||` or `??` expression whose
 * parent is not one, and nothing inside a nested function. Within it each member chain is read off
 * its root (a name, a call, `this`), with `?.`, `!`, `as` and parentheses dropped, and the chains
 * of one root are re-rooted at the longest path they share, so `verdict?.checker?.kind` read beside
 * `verdict.checker.objective` and a local `checker.kind` beside `checker.objective` read alike. A
 * chain compared with a literal is a test (`kind = "pass"`, either equality); a comparison with
 * `undefined` or `null` is only a read, so `x.objective !== undefined` and `x.objective ?? null`
 * spell one fact. A root's fact is its set of tests and reads, and it counts only where it holds a
 * test and a read of another field: two fields of one value, one of them a discriminant.
 *
 * Precision over recall, as a heuristic reports and never blocks (operator, 1 October). Tests,
 * vendored and generated files are not read, and only src/ and tools/ count as production.
 */
import * as ts from "typescript5";
import type { TreeFinding } from "./tree-findings.ts";

const PRODUCTION = /^(?:src|tools)\//u;
const SKIPPED_PATH =
  /(?:^|\/)(?:test|tests|__tests__|fixtures?|__mocks__)\/|\.(?:test|spec)\.|(?:^|\/)(?:vendor|vendored|third[-_]party|migrations?|examples?)\//iu;
const OPTED_OUT = /@ts-nocheck|@generated\b|\bauto-?generated\b|\bdo not edit\b|^\/\/\s*vendored from\s+\S/iu;
/** Distinct files a fact must stand in before it is a finding. */
const FILE_FLOOR = 3;
/** Places a detail names before it counts the rest. */
const NAMED_PLACES = 3;
/** Either equality counts as one test: `x.kind !== "pass" ? null : x.objective` is the same fact. */
const EQUALITIES = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);
const JOINS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);
/** A value's own identifier names the value, so reading it beside a test is a filter, not a fact
 *  (`row.seat === "solve" ? row.id : null`, three files of tools/ on 5 November). */
const IDENTITY = "id";

interface Site {
  path: string;
  line: number;
  end: number;
  /** The function whose whole body the unit is, which then owns the fact. */
  owner: string | null;
}

interface Read {
  path: readonly string[];
  /** The literal the chain is compared with, or null for a plain read. */
  test: string | null;
}

/** A wrapper that changes no value: parentheses, `!`, `as` and `satisfies`. */
const isWrapper = (
  node: ts.Node,
): node is ts.ParenthesizedExpression | ts.NonNullExpression | ts.AsExpression | ts.SatisfiesExpression =>
  ts.isParenthesizedExpression(node) ||
  ts.isNonNullExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node);

/** A node with its wrappers taken off. */
function bare(node: ts.Expression): ts.Expression {
  let at = node;
  while (isWrapper(at)) at = at.expression;
  return at;
}

/** The parent a value flows into, past its wrappers. */
function outer(node: ts.Node): ts.Node {
  let at = node.parent;
  while (isWrapper(at)) at = at.parent;
  return at;
}

const isUnit = (node: ts.Node): node is ts.Expression =>
  ts.isConditionalExpression(node) || (ts.isBinaryExpression(node) && JOINS.has(node.operatorToken.kind));

const isAbsence = (node: ts.Expression): boolean =>
  node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === "undefined");

/** A literal's spelling, or null for anything else. */
function literalOf(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return JSON.stringify(node.text);
  if (ts.isNumericLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return "true";
  return node.kind === ts.SyntaxKind.FalseKeyword ? "false" : null;
}

/** A member chain as its root's text and its field names, `?.` and wrappers dropped. */
function chainOf(node: ts.PropertyAccessExpression, file: ts.SourceFile): { root: string; path: string[] } {
  const path: string[] = [];
  let at: ts.Expression = node;
  while (ts.isPropertyAccessExpression(at)) {
    path.unshift(at.name.text);
    at = bare(at.expression);
  }
  return { root: at.getText(file).replaceAll("?.", ".").replaceAll(/\s+/gu, ""), path };
}

/** The literal a chain is compared with: null for a plain read or a comparison with absence, and
 *  undefined for a comparison with a value of the code's own, which is no fact of the root's. */
function testOf(chain: ts.Expression): string | null | undefined {
  const parent = outer(chain);
  if (!ts.isBinaryExpression(parent) || !EQUALITIES.has(parent.operatorToken.kind)) return null;
  const other = bare(bare(parent.left) === chain ? parent.right : parent.left);
  return isAbsence(other) ? null : (literalOf(other) ?? undefined);
}

/** A root's reads re-rooted at the path they all share, each chain once at its longest, as one
 *  fact; null where the root holds no test beside a read of another field. */
function factOf(reads: readonly Read[]): string | null {
  const joined = (read: Read): string => read.path.join(".");
  const kept = reads.filter(
    (read) =>
      read.test !== null ||
      !reads.some(
        (other) =>
          joined(other).startsWith(`${joined(read)}.`) ||
          (other.test !== null && joined(other) === joined(read)),
      ),
  );
  // How many leading fields every chain shares, leaving each at least its last.
  const shared = (kept[0]?.path ?? []).findIndex(
    (name, at) => !kept.every((read) => read.path.length > at + 1 && read.path[at] === name),
  );
  const field = (read: Read): string => read.path.slice(shared).join(".");
  const fields = new Set(kept.filter((read) => read.path.at(-1) !== IDENTITY).map(field));
  if (!kept.some((read) => read.test !== null) || fields.size < 2) return null;
  const spelled = kept.map((read) => (read.test === null ? field(read) : `${field(read)} = ${read.test}`));
  return [...new Set(spelled)].toSorted().join(", ");
}

/** The facts one unit holds, one for each root it reads, and whether it holds nothing else: no
 *  call, and no name but a chain's root, which makes a function whose body it is its owner. */
function factsOf(unit: ts.Expression, file: ts.SourceFile): { facts: string[]; pure: boolean } {
  const byRoot = new Map<string, Read[]>();
  let pure = true;
  const walk = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) || ts.isTypeNode(node)) {
      pure = false;
      return;
    }
    const parent = outer(node);
    if (ts.isPropertyAccessExpression(node) && !ts.isPropertyAccessExpression(parent)) {
      const callee = ts.isCallExpression(parent) && bare(parent.expression) === node;
      const test = callee ? undefined : testOf(node);
      const { root, path } = chainOf(node, file);
      if (test !== undefined) byRoot.set(root, [...(byRoot.get(root) ?? []), { path, test }]);
    } else if (
      ts.isCallExpression(node) ||
      (ts.isIdentifier(node) && !ts.isPropertyAccessExpression(parent) && !isAbsence(node))
    ) {
      pure = false;
    }
    ts.forEachChild(node, walk);
  };
  walk(unit);
  const facts = [...byRoot.values()].flatMap((reads) => factOf(reads) ?? []);
  return { facts, pure: pure && byRoot.size === 1 };
}

/** The function a unit is the whole body of: an arrow's expression, or a lone `return`. */
function bodyOf(unit: ts.Expression): string | null {
  const parent = outer(unit);
  const block = ts.isReturnStatement(parent) && ts.isBlock(parent.parent) ? parent.parent : null;
  const fn = ts.isArrowFunction(parent) ? parent : block?.statements.length === 1 ? block.parent : null;
  if (fn === null || !ts.isFunctionLike(fn)) return null;
  if (ts.isFunctionDeclaration(fn) && fn.name !== undefined) return fn.name.text;
  return ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name) ? fn.parent.name.text : null;
}

/** Every outermost unit of one file, filed under each fact it holds. */
function unitsOf(path: string, file: ts.SourceFile, into: Map<string, Site[]>): void {
  const lineOf = (position: number): number => file.getLineAndCharacterOfPosition(position).line + 1;
  const visit = (node: ts.Node): void => {
    if (isUnit(node) && !isUnit(outer(node))) {
      const { facts, pure } = factsOf(node, file);
      const owner = pure ? bodyOf(node) : null;
      const site = { path, line: lineOf(node.getStart(file)), end: lineOf(node.getEnd()), owner };
      for (const fact of facts) into.set(fact, [...(into.get(fact) ?? []), site]);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

/** One row per fact standing in three or more production files, at its first place, naming the
 *  others and the function that already returns it, where one does. */
export function factsWithoutOwner(files: ReadonlyMap<string, string>): TreeFinding[] {
  const groups = new Map<string, Site[]>();
  for (const [path, text] of [...files].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
    if (!PRODUCTION.test(path) || SKIPPED_PATH.test(path) || /\.d\.m?ts$/u.test(path)) continue;
    const kind = path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
    if (!OPTED_OUT.test(text.slice(0, file.statements[0]?.getStart(file)))) unitsOf(path, file, groups);
  }
  return [...groups].flatMap(([fact, sites]): TreeFinding[] => {
    const [first, ...others] = sites;
    const count = new Set(sites.map((site) => site.path)).size;
    if (first === undefined || count < FILE_FLOOR) return [];
    const named = others.slice(0, NAMED_PLACES).map((site) => `${site.path}:${site.line}`);
    const rest = others.length > NAMED_PLACES ? ` and ${others.length - NAMED_PLACES} more` : "";
    const owner = sites.find((site) => site.owner !== null);
    const owned = owner === undefined ? "" : `; \`${owner.owner ?? ""}\` in ${owner.path} already returns it`;
    const detail = `\`${fact}\` of one value, in ${count} files; also ${named.join(", ")}${rest}${owned}`;
    const places = sites.map(({ path, line, end }) => ({ path, line, end }));
    return [{ kind: "no-unowned-fact", path: first.path, line: first.line, detail, places }];
  });
}
