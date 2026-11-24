/**
 * `no-duplicate-derivation` (generic): a fact an exported function already returns, derived again
 * by hand in another file. Call the owner.
 */
import * as ts from "typescript5";
import { boundNames } from "./tree-copied-block.ts";
import type { TreeFinding } from "./tree-findings.ts";

interface Spelling {
  path: string;
  line: number;
  end: number;
  key: string;
  norm: string;
  start: number;
  stop: number;
  owner: string | null;
}

interface Scan {
  path: string;
  line: number;
  end: number;
  test: string;
  fields: ReadonlySet<string>;
  owner: string | null;
}

interface Reading {
  one: Pick<Spelling, "path" | "line" | "end" | "key">;
  owner: Pick<Spelling, "path" | "owner">;
}

const K = ts.SyntaxKind;
const OPERATORS = new Map<ts.SyntaxKind, string>([
  [K.AmpersandAmpersandToken, "&&"],
  [K.BarBarToken, "||"],
  [K.QuestionQuestionToken, "??"],
  [K.EqualsEqualsEqualsToken, "==="],
  [K.EqualsEqualsToken, "==="],
  [K.ExclamationEqualsEqualsToken, "!=="],
  [K.ExclamationEqualsToken, "!=="],
  [K.LessThanToken, "<"],
  [K.LessThanEqualsToken, "<="],
  [K.GreaterThanToken, ">"],
  [K.GreaterThanEqualsToken, ">="],
  [K.PlusToken, "+"],
  [K.MinusToken, "-"],
  [K.AsteriskToken, "*"],
  [K.SlashToken, "/"],
  [K.PercentToken, "%"],
  [K.InKeyword, "in"],
  [K.InstanceOfKeyword, "instanceof"],
]);
const LOGICAL = new Set(["&&", "||", "===", "!==", "<", "<=", ">", ">="]);
const COMMUTATIVE = new Set(["&&", "||", "===", "!==", "*"]);
const NEGATED = new Map([
  ["===", "!=="],
  ["!==", "==="],
  ["<", ">="],
  ["<=", ">"],
  [">", "<="],
  [">=", "<"],
]);
const TURNED = new Map([
  [">", "<"],
  [">=", "<="],
]);
const WRAPPER_KINDS = new Set([
  K.ParenthesizedExpression,
  K.NonNullExpression,
  K.AsExpression,
  K.SatisfiesExpression,
  K.TypeAssertionExpression,
]);
const FUNC_KINDS = new Set([
  K.FunctionDeclaration,
  K.MethodDeclaration,
  K.Constructor,
  K.GetAccessor,
  K.SetAccessor,
  K.ArrowFunction,
  K.FunctionExpression,
]);
const LITERAL_KEYWORDS = new Set([K.TrueKeyword, K.FalseKeyword, K.NullKeyword]);
const EQUALITIES = new Set(["===", "!=="]);
const CHAIN_OPS = new Set(["&&", "||", "*"]);
const LANGUAGE = new Set(
  [
    "length size at get has includes some every filter find findLast map flatMap keys values entries",
    "startsWith endsWith trim toString test exec match slice indexOf split join replace toLowerCase",
    "toUpperCase now Date Math Number String Boolean Array Object JSON isArray isNaN undefined",
    "process env window document console",
  ]
    .join(" ")
    .split(" "),
);
const ARGUMENT = /_(?:\.[\w$]+)?(?=[,)])/gu;
const SELECTING = new Set([
  "filter",
  "flatMap",
  "find",
  "findLast",
  "some",
  "every",
  "findIndex",
  "findLastIndex",
]);
const SCAN_FIELDS = 2;

const isWrapper = (
  node: ts.Node,
): node is ts.ParenthesizedExpression | ts.NonNullExpression | ts.AsExpression | ts.SatisfiesExpression =>
  WRAPPER_KINDS.has(node.kind);

function bare(node: ts.Expression): ts.Expression {
  let at = node;
  while (isWrapper(at)) at = at.expression;
  return at;
}

const operatorOf = (node: ts.Expression): string | undefined =>
  ts.isBinaryExpression(node) ? OPERATORS.get(node.operatorToken.kind) : undefined;

function operands(node: ts.BinaryExpression, operator: string): ts.Expression[] {
  return [node.left, node.right].flatMap((side) => {
    const inner = bare(side);
    return ts.isBinaryExpression(inner) && operatorOf(inner) === operator && COMMUTATIVE.has(operator)
      ? operands(inner, operator)
      : [inner];
  });
}

function literalOf(node: ts.Expression): string | null {
  if (ts.isStringLiteralLike(node)) return JSON.stringify(node.text);
  if (ts.isNumericLiteral(node)) return node.text;
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === K.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return `-${node.operand.text}`;
  }
  if (LITERAL_KEYWORDS.has(node.kind)) return node.getText();
  return ts.isIdentifier(node) && node.text === "undefined" ? "undefined" : null;
}

function localNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (FUNC_KINDS.has(node.kind)) {
      // SAFETY: `FUNC_KINDS` enumerates the exact `ts.FunctionLikeDeclaration` syntax kinds.
      for (const name of boundNames(node as ts.FunctionLikeDeclaration)) names.add(name);
    } else ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

function namedExportsOf(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        names.add((element.propertyName ?? element.name).text);
      }
    }
  }
  return names;
}

function keyer(locals: ReadonlySet<string>) {
  const argument = (raw: ts.Expression): string => {
    const node = bare(raw);
    const literal = literalOf(node);
    if (literal !== null) return literal;
    if (ts.isPropertyAccessExpression(node)) return `_.${node.name.text}`;
    const key = ts.isElementAccessExpression(node) ? bare(node.argumentExpression) : undefined;
    return key !== undefined && ts.isStringLiteralLike(key) ? `_.${key.text}` : "_";
  };
  const canon = (raw: ts.Expression): string => {
    const node = bare(raw);
    const literal = literalOf(node);
    if (literal !== null) return literal;
    if (ts.isIdentifier(node)) return locals.has(node.text) ? "$" : node.text;
    if (node.kind === K.ThisKeyword) return "this";
    if (ts.isPropertyAccessExpression(node)) return `${canon(node.expression)}.${node.name.text}`;
    if (ts.isElementAccessExpression(node)) {
      const key = bare(node.argumentExpression);
      const field = ts.isStringLiteralLike(key) ? `.${key.text}` : `[${argument(key)}]`;
      return `${canon(node.expression)}${field}`;
    }
    if (ts.isCallExpression(node)) {
      return `${canon(node.expression)}(${node.arguments.map(argument).join(",")})`;
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === K.ExclamationToken) {
      return negated(node.operand);
    }
    if (ts.isTypeOfExpression(node)) return `typeof ${canon(node.expression)}`;
    const operator = operatorOf(node);
    if (operator === undefined || !ts.isBinaryExpression(node)) return "…";
    if (!CHAIN_OPS.has(operator)) return compared(node.left, operator, node.right);
    return `(${operands(node, operator).map(canon).toSorted().join(operator)})`;
  };
  const compared = (left: ts.Expression, operator: string, right: ts.Expression): string => {
    const turned = TURNED.get(operator);
    if (turned !== undefined) return `(${canon(right)}${turned}${canon(left)})`;
    const parts = [canon(left), canon(right)];
    return `(${(COMMUTATIVE.has(operator) ? parts.toSorted() : parts).join(operator)})`;
  };
  const negated = (raw: ts.Expression): string => {
    const node = bare(raw);
    if (ts.isPrefixUnaryExpression(node) && node.operator === K.ExclamationToken) return canon(node.operand);
    const operator = operatorOf(node);
    if (operator === undefined || !ts.isBinaryExpression(node)) return `!${canon(node)}`;
    if (operator === "&&" || operator === "||") {
      return `(${operands(node, operator)
        .map(negated)
        .toSorted()
        .join(operator === "&&" ? "||" : "&&")})`;
    }
    const flipped = NEGATED.get(operator);
    return flipped === undefined ? `!${canon(node)}` : compared(node.left, flipped, node.right);
  };
  return { canon, negated };
}

function namesOf(raw: ts.Expression, locals: ReadonlySet<string>): Set<string> {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node)) {
      visit(node.expression);
      return;
    }
    if (ts.isPropertyAccessExpression(node) && !LANGUAGE.has(node.name.text)) found.add(node.name.text);
    if (
      ts.isIdentifier(node) &&
      !locals.has(node.text) &&
      !LANGUAGE.has(node.text) &&
      !ts.isPropertyAccessExpression(node.parent)
    ) {
      found.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(raw);
  return found;
}

function isFact(node: ts.BinaryExpression, operator: string, locals: ReadonlySet<string>): boolean {
  if (operator === "??") return false;
  if (operator === "&&" || operator === "||") {
    const parts = operands(node, operator);
    const subjects = parts.map((part) => {
      const inner = bare(part);
      if (!ts.isBinaryExpression(inner) || !EQUALITIES.has(operatorOf(inner) ?? "")) return null;
      if (literalOf(bare(inner.right)) !== null) return bare(inner.left).getText();
      return literalOf(bare(inner.left)) === null ? null : bare(inner.right).getText();
    });
    const oneSubject = subjects.every((one) => one !== null && one === subjects[0]);
    return !oneSubject && parts.every((part) => literalOf(bare(part)) === null);
  }
  const valued = (raw: ts.Expression): boolean => {
    let at = bare(raw);
    while (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at)) at = bare(at.expression);
    if (literalOf(at) !== null) return false;
    return !ts.isIdentifier(at) || locals.has(at.text);
  };
  return valued(node.left) && valued(node.right);
}

function exportedName(fn: ts.Node, file: ts.SourceFile, listed: ReadonlySet<string>): string | null {
  const declaration = ts.isVariableDeclaration(fn.parent) ? fn.parent : fn;
  const name =
    ts.isFunctionDeclaration(declaration) || ts.isVariableDeclaration(declaration)
      ? declaration.name
      : undefined;
  if (name === undefined || !ts.isIdentifier(name)) return null;
  const top = ts.isVariableDeclaration(declaration) ? declaration.parent.parent : declaration;
  if (top.parent !== file) return null;
  const modified =
    ts.canHaveModifiers(top) && (ts.getModifiers(top) ?? []).some((one) => one.kind === K.ExportKeyword);
  return modified || listed.has(name.text) ? name.text : null;
}

function ownerOf(node: ts.Node, file: ts.SourceFile, listed: ReadonlySet<string>): string | null {
  let at: ts.Node = node;
  while (isWrapper(at.parent) || (ts.isBinaryExpression(at.parent) && operatorOf(at.parent) === "??")) {
    at = at.parent;
  }
  const { parent } = at;
  if (ts.isArrowFunction(parent) && parent.body === at) return exportedName(parent, file, listed);
  const block = ts.isReturnStatement(parent) ? parent.parent : undefined;
  if (block === undefined || !ts.isBlock(block) || block.statements.length !== 1) return null;
  return ts.isFunctionLike(block.parent) ? exportedName(block.parent, file, listed) : null;
}

function isInnerLink(node: ts.BinaryExpression): boolean {
  let { parent } = node;
  while (isWrapper(parent)) parent = parent.parent;
  const operator = operatorOf(node);
  return (
    operator !== undefined &&
    COMMUTATIVE.has(operator) &&
    ts.isBinaryExpression(parent) &&
    operatorOf(parent) === operator
  );
}

function spellingsOf(path: string, file: ts.SourceFile, listed: ReadonlySet<string>): Spelling[] {
  const locals = localNames(file);
  const { canon, negated } = keyer(locals);
  const lineOf = (position: number): number => file.getLineAndCharacterOfPosition(position).line + 1;
  const found: Spelling[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) return;
    if (ts.isBinaryExpression(node)) {
      const operator = operatorOf(node);
      if (
        operator !== undefined &&
        !isInnerLink(node) &&
        isFact(node, operator, locals) &&
        namesOf(node, locals).size >= 2
      ) {
        const plain = canon(node);
        if (!plain.includes("…")) {
          const inverse = LOGICAL.has(operator) ? negated(node) : plain;
          const key = plain < inverse ? plain : inverse;
          const start = node.getStart(file);
          found.push({
            path,
            line: lineOf(start),
            end: lineOf(node.getEnd()),
            key,
            norm: key.replaceAll(ARGUMENT, "_"),
            start,
            stop: node.getEnd(),
            owner: ownerOf(node, file, listed),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function returnedBy(node: ts.Node, file: ts.SourceFile, listed: ReadonlySet<string>): string | null {
  let returned = false;
  for (let at: ts.Node = node; at.parent !== file; at = at.parent) {
    const { parent } = at;
    if (ts.isReturnStatement(at) || (ts.isArrowFunction(parent) && parent.body === at)) returned = true;
    const name = ts.isFunctionLike(parent) ? exportedName(parent, file, listed) : null;
    if (name !== null) return returned ? name : null;
  }
  return null;
}

function testsOf(body: ts.Node): { keys: Map<string, string>; fields: Set<string> } {
  const keys = new Map<string, string>();
  const fields = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) || ts.isTypeNode(node)) return;
    if (ts.isBinaryExpression(node) && EQUALITIES.has(operatorOf(node) ?? "")) {
      const [left, right] = [bare(node.left), bare(node.right)];
      for (const [side, other] of [
        [left, right],
        [right, left],
      ] as const) {
        const subject = ts.isPropertyAccessExpression(side) ? side.name : side;
        if (ts.isStringLiteralLike(other) && ts.isIdentifier(subject)) {
          keys.set(`${subject.text} === ${JSON.stringify(other.text)}`, subject.text);
        }
      }
    }
    const called = ts.isCallExpression(node.parent) && node.parent.expression === node;
    if (ts.isPropertyAccessExpression(node) && !ts.isPropertyAccessExpression(node.parent) && !called) {
      fields.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return { keys, fields };
}

function scansOf(path: string, file: ts.SourceFile, listed: ReadonlySet<string>): Scan[] {
  const lineOf = (position: number): number => file.getLineAndCharacterOfPosition(position).line + 1;
  const found: Scan[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) return;
    ts.forEachChild(node, visit);
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const [callback] = node.arguments;
    if (
      !SELECTING.has(node.expression.name.text) ||
      callback === undefined ||
      (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
    ) {
      return;
    }
    const { keys, fields } = testsOf(callback);
    if (keys.size === 0) return;
    let result: ts.Node = node;
    while (ts.isPropertyAccessExpression(result.parent) || ts.isNonNullExpression(result.parent)) {
      result = result.parent;
    }
    if (ts.isPropertyAccessExpression(result)) fields.add(result.name.text);
    const owner = returnedBy(node, file, listed);
    const at = { line: lineOf(node.getStart(file)), end: lineOf(node.getEnd()) };
    for (const [test, subject] of keys) {
      const read = new Set([...fields].filter((field) => field !== subject && !LANGUAGE.has(field)));
      found.push({ path, ...at, test, fields: read, owner });
    }
  };
  visit(file);
  return found;
}

function scanReadings(scans: readonly Scan[]): Reading[] {
  const owners = Map.groupBy(
    scans.filter((one) => one.owner !== null && one.fields.size >= SCAN_FIELDS),
    (one) => one.test,
  );
  return scans.flatMap((one) => {
    if (one.owner !== null) return [];
    const owner = (owners.get(one.test) ?? []).find(
      (candidate) =>
        candidate.path !== one.path && [...candidate.fields].every((field) => one.fields.has(field)),
    );
    if (owner === undefined) return [];
    const key = `${one.test} reading ${[...owner.fields].toSorted().join(", ")}`;
    return [{ one: { ...one, key }, owner }];
  });
}

function sameFact(a: Spelling, b: Spelling): boolean {
  if (a.norm !== b.norm) return false;
  const [left, right] = [a.key.match(ARGUMENT) ?? [], b.key.match(ARGUMENT) ?? []];
  return left.every((one, at) => one === "_" || right[at] === "_" || one === right[at]);
}

/** Each spelling of a fact an exported function in another file already returns. */
export function secondReaders(sources: ReadonlyMap<string, ts.SourceFile>): TreeFinding[] {
  const read = [...sources].map(([path, file]) => [path, file, namedExportsOf(file)] as const);
  const spellings = read.flatMap(([path, file, listed]) => spellingsOf(path, file, listed));
  const owners = Map.groupBy(
    spellings.filter((one) => one.owner !== null),
    (one) => one.norm,
  );
  const found = spellings.flatMap((one) => {
    if (one.owner !== null) return [];
    const owner = (owners.get(one.norm) ?? []).find(
      (candidate) => candidate.path !== one.path && sameFact(candidate, one),
    );
    return owner === undefined ? [] : [{ one, owner }];
  });
  const inside = (one: Spelling): boolean =>
    found.some(
      ({ one: other }) =>
        other.path === one.path && other.start <= one.start && other.stop >= one.stop && other !== one,
    );
  const readings: Reading[] = [
    ...found.filter(({ one }) => !inside(one)),
    ...scanReadings(read.flatMap(([path, file, listed]) => scansOf(path, file, listed))),
  ];
  const readers = Map.groupBy(readings, ({ owner }) => owner);
  return readings.map(({ one, owner }): TreeFinding => {
    const files = new Set((readers.get(owner) ?? []).map((row) => row.one.path)).size;
    return {
      kind: "no-duplicate-derivation",
      path: one.path,
      line: one.line,
      detail: `\`${one.key}\` is derived by hand in ${String(files)} ${files === 1 ? "file" : "files"} besides \`${owner.owner ?? ""}\` in ${owner.path}, which already returns it`,
      places: [{ path: one.path, line: one.line, end: one.end }],
    };
  });
}
