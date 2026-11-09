/**
 * `no-duplicate-derivation` (generic): a fact an exported function already returns, derived again by hand in
 * another file. `stillRunning(run, running)` returns `writers(run, running).length > 0 ||
 * keepers(run.name).length > 0`; a command that spells `writers(run, processes()).length > 0 ||
 * keepers(name).length > 0` itself is a second reader of whether a run lives, and drifts from the
 * owner the day the owner learns a new case (a remote observation, a seat). Call the owner.
 *
 * A unit is an expression rooted in a binary operator: a logical join, a comparison or arithmetic,
 * a chain of one operator read as one node. It is normalised so that spellings of one fact read
 * alike: wrappers (`as`, `!`, parentheses) are dropped, `?.` reads as `.`, a name the file binds
 * inside a function (a parameter or a local) reads as `$`, the operands of `&&`, `||`, `===`,
 * `!==` and `*` are sorted, `>` and `>=` are turned round, `==` reads as `===`, and a unit and its
 * negation (De Morgan's laws pushed through) share one key. Names a file imports or declares at its
 * top level, and the platform's globals, keep their spelling: they are what makes two spellings the
 * same fact. A call's argument reads as `_`, or `_.field` where it is a member chain; two arguments
 * match unless both name a field and the fields differ, so `writers(run, running)` matches
 * `writers(run, processes())` while `isString(call.cwd)` does not match `isString(node.type)`.
 *
 * An owner is an exported function whose returned value is the unit, behind parentheses or either
 * side of `??`. A unit counts only where it names at least two distinct fields or functions outside
 * its calls' arguments, besides the language's own (`length`, `has`, `includes` and kin); not where
 * every operand compares one subject with a literal, which `no-scattered-state-literals` reads; not where
 * a comparison or arithmetic has a literal or a constant on one side (`kind === "pass"`, `code ===
 * KEYS.D`), a one-field test; and not for `??`, which gives a default. A unit inside a larger
 * reported unit is not reported again. Reported: each spelling outside the owner's file, naming the
 * owner and how many files spell it by hand. Tests, declaration files and vendored trees never
 * reach the scan: `implicitStateFindings` and its callers leave them out.
 *
 * The second shape is a fold spelled again: a scan of a collection for one value of a discriminant
 * (`events.findLast(({ kind, data }) => kind === "referee.finding" && data.solve === solve)?.data
 * .ruling`) that reads every field an exported function's scan for the same value reads, where that
 * function returns its scan (`rulingsOf` maps each solve to its last `ruling`). A scan is a
 * selecting call (`filter`, `flatMap`, `find`, `findLast`, `some`, `every`, `findIndex`) whose
 * callback compares a field or a name with a string literal; its fields are the last names of its
 * callback's member chains and of the chain read off its result, calls and the language's names
 * left out. The owner must read at least two. A `forEach` or `map` does something to each item
 * rather than reading a fact, so it neither owns nor reads.
 *
 * No upstream detector exists for this shape: clone detectors (PMD CPD, jscpd) match token runs, not
 * one normalised expression, and `tree/no-unowned-fact` (`tree-fact.ts`) reads only a literal
 * test beside a field read in three files. A fact spelled alike in several files with no owner is
 * not reported: on the eval's trees that reading held about eighty sites a tree (geometry,
 * identifier joins) and caught one labelled second reader.
 */
import * as ts from "typescript5";
import { boundNames } from "./tree-copied-block.ts";
import type { TreeFinding } from "./tree-findings.ts";

/** One spelling of a fact: where it stands, its key, and the exported function it is the value of. */
interface Spelling {
  path: string;
  line: number;
  end: number;
  key: string;
  start: number;
  stop: number;
  owner: string | null;
}

/** One scan of a collection for a discriminant's value, with the fields it reads. */
interface Scan {
  path: string;
  line: number;
  end: number;
  test: string;
  fields: ReadonlySet<string>;
  owner: string | null;
}

/** A spelling or a scan outside its owner's file, and the owner's own. */
interface Reading {
  one: Pick<Spelling, "path" | "line" | "end" | "key">;
  owner: Pick<Spelling, "path" | "owner">;
}

const K = ts.SyntaxKind;
/** Operators read as one fact's structure. Assignments and commas are not. */
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
/** Operators whose unit reads true or false, so that a unit and its negation are one fact. */
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
/** The language's own names, which say nothing of which fact is read. */
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
/** An argument as the key spells it: `_` or `_.field`. */
const ARGUMENT = /_(?:\.[\w$]+)?(?=[,)])/gu;
/** The calls that select items by a test, so that their callback reads a fact of each item. */
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
/** The fewest fields an owner's scan reads besides its discriminant. */
const SCAN_FIELDS = 2;

const isWrapper = (
  node: ts.Node,
): node is ts.ParenthesizedExpression | ts.NonNullExpression | ts.AsExpression | ts.SatisfiesExpression =>
  ts.isParenthesizedExpression(node) ||
  ts.isNonNullExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isTypeAssertionExpression(node);

function bare(node: ts.Expression): ts.Expression {
  let at = node;
  while (isWrapper(at)) at = at.expression;
  return at;
}

const operatorOf = (node: ts.Expression): string | undefined =>
  ts.isBinaryExpression(node) ? OPERATORS.get(node.operatorToken.kind) : undefined;

/** The operands of a chain of one commutative operator, `a && b && c` as three. */
function operands(node: ts.BinaryExpression, operator: string): ts.Expression[] {
  return [node.left, node.right].flatMap((side) => {
    const inner = bare(side);
    return ts.isBinaryExpression(inner) && operatorOf(inner) === operator && COMMUTATIVE.has(operator)
      ? operands(inner, operator)
      : [inner];
  });
}

/** A literal's spelling, or null. `-1` is a literal. */
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
  if (node.kind === K.TrueKeyword || node.kind === K.FalseKeyword || node.kind === K.NullKeyword) {
    return node.getText();
  }
  return ts.isIdentifier(node) && node.text === "undefined" ? "undefined" : null;
}

/** The names a file binds inside its functions: parameters and locals, which read as `$`. */
function localNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    const outermost =
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessor(node) ||
      ts.isSetAccessor(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node);
    if (outermost) for (const name of boundNames(node)) names.add(name);
    else ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

/** The key of a unit and of its negation, with a file's locals read as `$`. */
function keyer(locals: ReadonlySet<string>): {
  canon: (node: ts.Expression) => string;
  negated: (node: ts.Expression) => string;
} {
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
    if (!["&&", "||", "*"].includes(operator)) return compared(node.left, operator, node.right);
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
      const parts = operands(node, operator).map(negated);
      return `(${parts.toSorted().join(operator === "&&" ? "||" : "&&")})`;
    }
    const flipped = NEGATED.get(operator);
    return flipped === undefined ? `!${canon(node)}` : compared(node.left, flipped, node.right);
  };
  return { canon, negated };
}

/** The distinct names a unit reads outside its calls' arguments, the language's own left out. */
function namesOf(raw: ts.Expression, locals: ReadonlySet<string>): Set<string> {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node)) {
      visit(node.expression);
      return;
    }
    if (ts.isPropertyAccessExpression(node)) found.add(node.name.text);
    if (ts.isIdentifier(node) && !locals.has(node.text) && !ts.isPropertyAccessExpression(node.parent)) {
      found.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(raw);
  return new Set([...found].filter((name) => !LANGUAGE.has(name)));
}

/**
 * Whether a unit reads a fact: a join of two or more tests on more than one subject, or a comparison
 * or arithmetic between two values. A side that is a literal or a constant (a name the function
 * does not bind, or a member of one) makes a one-field test, and `??` gives a default.
 */
function isFact(node: ts.BinaryExpression, operator: string, locals: ReadonlySet<string>): boolean {
  if (operator === "??") return false;
  if (operator === "&&" || operator === "||") {
    const parts = operands(node, operator);
    const subjects = parts.map((part) => {
      const inner = bare(part);
      if (!ts.isBinaryExpression(inner) || !["===", "!=="].includes(operatorOf(inner) ?? "")) return null;
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

/**
 * The name a top-level function is exported under, by its modifier or in an `export { }` list, or
 * null. A helper declared inside an exported function is not exported.
 */
function exportedName(fn: ts.Node, file: ts.SourceFile): string | null {
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
  const listed = file.statements.some(
    (statement) =>
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.some(
        (element) => (element.propertyName ?? element.name).text === name.text,
      ),
  );
  return modified || listed ? name.text : null;
}

/**
 * The exported function a unit is the returned value of, or null. The unit may stand behind
 * parentheses or as either side of `??`: `observed ?? (writers > 0 || keepers > 0)` returns it.
 */
function ownerOf(node: ts.Node, file: ts.SourceFile): string | null {
  let at: ts.Node = node;
  while (isWrapper(at.parent) || (ts.isBinaryExpression(at.parent) && operatorOf(at.parent) === "??")) {
    at = at.parent;
  }
  const { parent } = at;
  if (ts.isArrowFunction(parent) && parent.body === at) return exportedName(parent, file);
  const block = ts.isReturnStatement(parent) ? parent.parent : undefined;
  if (block === undefined || !ts.isBlock(block) || block.statements.length !== 1) return null;
  return ts.isFunctionLike(block.parent) ? exportedName(block.parent, file) : null;
}

/** Whether a binary node is an inner link of a chain of its own operator, read with its chain. */
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

/** Every unit of one file that reads a fact, with its key. */
function spellingsOf(path: string, file: ts.SourceFile): Spelling[] {
  const locals = localNames(file);
  const { canon, negated } = keyer(locals);
  const lineOf = (position: number): number => file.getLineAndCharacterOfPosition(position).line + 1;
  const found: Spelling[] = [];
  const visit = (node: ts.Node): void => {
    const operator = ts.isBinaryExpression(node) ? operatorOf(node) : undefined;
    if (ts.isBinaryExpression(node) && operator !== undefined && !isInnerLink(node)) {
      const plain = canon(node);
      if (!plain.includes("…") && isFact(node, operator, locals) && namesOf(node, locals).size >= 2) {
        const inverse = LOGICAL.has(operator) ? negated(node) : plain;
        const start = node.getStart(file);
        found.push({
          path,
          line: lineOf(start),
          end: lineOf(node.getEnd()),
          key: plain < inverse ? plain : inverse,
          start,
          stop: node.getEnd(),
          owner: ownerOf(node, file),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** The exported function whose returned value holds a node, through any callbacks between, or null. */
function returnedBy(node: ts.Node, file: ts.SourceFile): string | null {
  let returned = false;
  for (let at: ts.Node = node; at.parent !== file; at = at.parent) {
    const { parent } = at;
    if (ts.isReturnStatement(at) || (ts.isArrowFunction(parent) && parent.body === at)) returned = true;
    const name = ts.isFunctionLike(parent) ? exportedName(parent, file) : null;
    if (name !== null) return returned ? name : null;
  }
  return null;
}

/**
 * The discriminant tests a callback makes (`kind === "referee.finding"`, also from `!==`)
 * and the last names of its member chains, callbacks nested in it left to their own scan.
 */
function testsOf(body: ts.Node): { keys: Map<string, string>; fields: Set<string> } {
  const keys = new Map<string, string>();
  const fields = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isBinaryExpression(node) && ["===", "!=="].includes(operatorOf(node) ?? "")) {
      for (const [side, other] of [
        [bare(node.left), bare(node.right)],
        [bare(node.right), bare(node.left)],
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

/** Every scan of one file for a discriminant's value, with the fields it reads. */
function scansOf(path: string, file: ts.SourceFile): Scan[] {
  const lineOf = (position: number): number => file.getLineAndCharacterOfPosition(position).line + 1;
  const found: Scan[] = [];
  const visit = (node: ts.Node): void => {
    ts.forEachChild(node, visit);
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const [callback] = node.arguments;
    if (!SELECTING.has(node.expression.name.text) || callback === undefined) return;
    if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return;
    const { keys, fields } = testsOf(callback);
    let result: ts.Node = node;
    while (ts.isPropertyAccessExpression(result.parent) || ts.isNonNullExpression(result.parent)) {
      result = result.parent;
    }
    if (ts.isPropertyAccessExpression(result)) fields.add(result.name.text);
    const owner = returnedBy(node, file);
    const at = { line: lineOf(node.getStart(file)), end: lineOf(node.getEnd()) };
    for (const [test, subject] of keys) {
      const read = new Set([...fields].filter((field) => field !== subject && !LANGUAGE.has(field)));
      found.push({ path, ...at, test, fields: read, owner });
    }
  };
  visit(file);
  return found;
}

/** Each scan that reads every field an exported fold's scan for the same value reads. */
function scanReadings(scans: readonly Scan[]): Reading[] {
  const owners = Map.groupBy(
    scans.filter((one) => one.owner !== null && one.fields.size >= SCAN_FIELDS),
    (one) => one.test,
  );
  return scans.flatMap((one) => {
    const owner = (owners.get(one.test) ?? []).find(
      (candidate) =>
        candidate.path !== one.path && [...candidate.fields].every((field) => one.fields.has(field)),
    );
    if (one.owner !== null || owner === undefined) return [];
    const key = `${one.test} reading ${[...owner.fields].toSorted().join(", ")}`;
    return [{ one: { ...one, key }, owner }];
  });
}

/** Whether two keys spell one fact: alike but for arguments, of which no two name different fields. */
function sameFact(a: string, b: string): boolean {
  if (a.replaceAll(ARGUMENT, "_") !== b.replaceAll(ARGUMENT, "_")) return false;
  const [left, right] = [a.match(ARGUMENT) ?? [], b.match(ARGUMENT) ?? []];
  return left.every((one, at) => one === "_" || right[at] === "_" || one === right[at]);
}

/** Each spelling of a fact an exported function in another file already returns. */
export function secondReaders(sources: ReadonlyMap<string, ts.SourceFile>): TreeFinding[] {
  const read = [...sources];
  const spellings = read.flatMap(([path, file]) => spellingsOf(path, file));
  const owners = Map.groupBy(
    spellings.filter((one) => one.owner !== null),
    (one) => one.key.replaceAll(ARGUMENT, "_"),
  );
  const found = spellings.flatMap((one) => {
    const owner = (owners.get(one.key.replaceAll(ARGUMENT, "_")) ?? []).find(
      (candidate) => candidate.path !== one.path && sameFact(candidate.key, one.key),
    );
    return one.owner === null && owner !== undefined ? [{ one, owner }] : [];
  });
  const inside = (one: Spelling): boolean =>
    found.some(
      ({ one: other }) =>
        other.path === one.path && other.start <= one.start && other.stop >= one.stop && other !== one,
    );
  const readings: Reading[] = [
    ...found.filter(({ one }) => !inside(one)),
    ...scanReadings(read.flatMap(([path, file]) => scansOf(path, file))),
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
