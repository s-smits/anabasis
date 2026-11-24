/**
 * One fact about a value (a field tested against a literal, read together with another field of
 * the same value) written out as an expression in three or more production files, where no
 * function owns it.
 */
import * as ts from "typescript5";
import { OPTED_OUT } from "./tree-copied-block.ts";
import type { TreeFinding } from "./tree-findings.ts";

const K = ts.SyntaxKind;
const PRODUCTION = /^(?:src|tools)\//u;
const SKIPPED_PATH =
  /(?:^|\/)(?:test|tests|__tests__|fixtures?|__mocks__)\/|\.(?:test|spec)\.|(?:^|\/)(?:vendor|vendored|third[-_]party|migrations?|examples?)\//iu;
const FILE_FLOOR = 3;
const NAMED_PLACES = 3;
const EQUALITIES = new Set([
  K.EqualsEqualsEqualsToken,
  K.ExclamationEqualsEqualsToken,
  K.EqualsEqualsToken,
  K.ExclamationEqualsToken,
]);
const JOINS = new Set([K.AmpersandAmpersandToken, K.BarBarToken, K.QuestionQuestionToken]);
const WRAPPER_KINDS = new Set([
  K.ParenthesizedExpression,
  K.NonNullExpression,
  K.AsExpression,
  K.SatisfiesExpression,
]);
const STRING_KINDS = new Set([K.StringLiteral, K.NoSubstitutionTemplateLiteral]);
const BOOL_TEXT = new Map<ts.SyntaxKind, string>([
  [K.TrueKeyword, "true"],
  [K.FalseKeyword, "false"],
]);
const IDENTITY = "id";

interface Site {
  path: string;
  line: number;
  end: number;
  owner: string | null;
}

interface Read {
  path: readonly string[];
  test: string | null;
}

function bare(node: ts.Expression): ts.Expression {
  let at = node;
  while (WRAPPER_KINDS.has(at.kind)) {
    // SAFETY: every kind in `WRAPPER_KINDS` wraps an `.expression: ts.Expression`.
    at = (at as ts.ParenthesizedExpression).expression;
  }
  return at;
}

function outer(node: ts.Node): ts.Node {
  let at = node.parent;
  while (WRAPPER_KINDS.has(at.kind)) at = at.parent;
  return at;
}

const isUnit = (node: ts.Node): node is ts.Expression =>
  node.kind === K.ConditionalExpression ||
  (ts.isBinaryExpression(node) && JOINS.has(node.operatorToken.kind));

const isAbsence = (node: ts.Expression): boolean =>
  node.kind === K.NullKeyword || (ts.isIdentifier(node) && node.text === "undefined");

function literalOf(node: ts.Expression): string | null {
  if (STRING_KINDS.has(node.kind)) {
    // SAFETY: `STRING_KINDS` enumerates `StringLiteral` and `NoSubstitutionTemplateLiteral`.
    return JSON.stringify((node as ts.StringLiteral).text);
  }
  if (ts.isNumericLiteral(node)) return node.text;
  return BOOL_TEXT.get(node.kind) ?? null;
}

function chainOf(node: ts.PropertyAccessExpression, file: ts.SourceFile): { root: string; path: string[] } {
  const path: string[] = [];
  let at: ts.Expression = node;
  while (ts.isPropertyAccessExpression(at)) {
    path.unshift(at.name.text);
    at = bare(at.expression);
  }
  return { root: at.getText(file).replaceAll("?.", ".").replaceAll(/\s+/gu, ""), path };
}

function testOf(chain: ts.Expression): string | null | undefined {
  const parent = outer(chain);
  if (!ts.isBinaryExpression(parent) || !EQUALITIES.has(parent.operatorToken.kind)) return null;
  const other = bare(bare(parent.left) === chain ? parent.right : parent.left);
  return isAbsence(other) ? null : (literalOf(other) ?? undefined);
}

function factOf(reads: readonly Read[]): string | null {
  const withText = reads.map((read) => ({ ...read, text: read.path.join(".") }));
  const kept = withText.filter(
    (read) =>
      read.test !== null ||
      !withText.some(
        (other) =>
          other.text.startsWith(`${read.text}.`) || (other.test !== null && other.text === read.text),
      ),
  );
  const first = kept[0];
  if (first === undefined) return null;
  const shared = first.path.findIndex(
    (name, at) => !kept.every((read) => read.path.length > at + 1 && read.path[at] === name),
  );
  const field = (read: Read): string => read.path.slice(shared).join(".");
  const fields = new Set(kept.filter((read) => read.path.at(-1) !== IDENTITY).map(field));
  if (!kept.some((read) => read.test !== null) || fields.size < 2) return null;
  const spelled = kept.map((read) => (read.test === null ? field(read) : `${field(read)} = ${read.test}`));
  return [...new Set(spelled)].toSorted().join(", ");
}

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
      if (test !== undefined) {
        const { root, path } = chainOf(node, file);
        const list = byRoot.get(root);
        if (list === undefined) byRoot.set(root, [{ path, test }]);
        else list.push({ path, test });
      }
    } else if (
      node.kind === K.CallExpression ||
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

function bodyOf(unit: ts.Expression): string | null {
  const parent = outer(unit);
  const block = ts.isReturnStatement(parent) && ts.isBlock(parent.parent) ? parent.parent : null;
  const fn = ts.isArrowFunction(parent) ? parent : block?.statements.length === 1 ? block.parent : null;
  if (fn === null || !ts.isFunctionLike(fn)) return null;
  if (ts.isFunctionDeclaration(fn) && fn.name !== undefined) return fn.name.text;
  return ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name) ? fn.parent.name.text : null;
}

function unitsOf(path: string, file: ts.SourceFile, into: Map<string, Site[]>): void {
  const lineOf = (position: number): number => file.getLineAndCharacterOfPosition(position).line + 1;
  const visit = (node: ts.Node): void => {
    if (!isUnit(node) || isUnit(outer(node))) {
      ts.forEachChild(node, visit);
      return;
    }
    const { facts, pure } = factsOf(node, file);
    if (facts.length > 0) {
      const site: Site = {
        path,
        line: lineOf(node.getStart(file)),
        end: lineOf(node.getEnd()),
        owner: pure ? bodyOf(node) : null,
      };
      for (const fact of facts) {
        const list = into.get(fact);
        if (list === undefined) into.set(fact, [site]);
        else list.push(site);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

/** One row per fact standing in three or more production files, at its first place. */
export function factsWithoutOwner(parsed: ReadonlyMap<string, ts.SourceFile>): TreeFinding[] {
  const groups = new Map<string, Site[]>();
  for (const [path, file] of [...parsed].toSorted(([a], [b]) => a.localeCompare(b))) {
    if (!PRODUCTION.test(path) || SKIPPED_PATH.test(path)) continue;
    if (!OPTED_OUT.test(file.text.slice(0, file.statements[0]?.getStart(file)))) unitsOf(path, file, groups);
  }
  return [...groups].flatMap(([fact, sites]): TreeFinding[] => {
    const [first, ...others] = sites;
    const count = new Set(sites.map((site) => site.path)).size;
    if (first === undefined || count < FILE_FLOOR) return [];
    const named = others.slice(0, NAMED_PLACES).map((site) => `${site.path}:${site.line}`);
    const rest = others.length > NAMED_PLACES ? ` and ${others.length - NAMED_PLACES} more` : "";
    const owner = sites.find((site) => site.owner !== null);
    const owned =
      owner === undefined ? "" : `; \`${String(owner.owner)}\` in ${owner.path} already returns it`;
    return [
      {
        kind: "no-unowned-fact",
        path: first.path,
        line: first.line,
        detail: `\`${fact}\` of one value, in ${count} files; also ${named.join(", ")}${rest}${owned}`,
        places: sites.map(({ path, line, end }) => ({ path, line, end })),
      },
    ];
  });
}
