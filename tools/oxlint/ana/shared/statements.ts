import type { ESTree } from "@oxlint/plugins";

/** The visitor a statement-list rule returns, so `scan` sees each list once. */
// oxlint-disable-next-line typescript/consistent-type-definitions -- a type alias stays assignable to the plugin's visitor, whose index signature an interface does not meet
type StatementLists = {
  Program: (node: ESTree.Program) => void;
  BlockStatement: (node: ESTree.BlockStatement) => void;
  SwitchCase: (node: ESTree.SwitchCase) => void;
};

/** What a literal node holds: a string, number, boolean, bigint, regular expression or null. */
type LiteralValue = Extract<ESTree.Node, { type: "Literal" }>["value"];
type NamedBinding = ESTree.VariableDeclarator & { id: ESTree.BindingIdentifier; init: ESTree.Expression };

/**
 * Node types that bind tighter than a `.` after them, so their text can stand as a call's subject.
 * The tree has no parentheses, and `(a ?? b).filter(p)` read back as `a ?? b.filter(p)` is a
 * silent change of meaning, which is the one thing a fixer may not make.
 */
const ATOMIC = new Set([
  "Identifier",
  "MemberExpression",
  "CallExpression",
  "ThisExpression",
  "ArrayExpression",
]);

/**
 * The shapes a rule in this plugin keeps having to spell.
 *
 * Each was written out inside `create(context)` in several rules, and none reads `context`, so
 * the copies were never anything but copies: `onlyStatement` three times byte for byte, the
 * visitor twice. A line-based copy scan reached them on 2026-09-20 once it stopped requiring six
 * identical lines; the syntax-based scan reached the enclosing body, the single `const`, the
 * one-argument method call and the function argument in two rules each on 2026-09-22. The four
 * node facts below them (a member by its written name, an identifier's name, a `const` and a call
 * of one argument) stood in three to eleven files each until `tree/no-unowned-fact` read them
 * on 2026-11-05.
 */

/**
 * The single statement a body holds, or null when it holds none or several.
 *
 * A rule that asks "does this `if` do one thing?" has to accept both spellings of one thing,
 * `if (x) return;` and `if (x) { return; }`, and a brace-free statement is already its own body.
 */
export function onlyStatement(node: ESTree.Statement): ESTree.Statement | null {
  if (node.type !== "BlockStatement") return node;
  const [only] = node.body;
  return node.body.length === 1 && only !== undefined ? only : null;
}

/**
 * The statement written directly below this one, or null when it is the last of its list.
 *
 * A rule that reads a statement against the one after it can visit each list with
 * `everyStatementList`; one that has already found its subject in the tree asks this instead,
 * and gets back the node rather than an index, because a fixer needs the range.
 */
export function statementBelow(statement: ESTree.Node): ESTree.Statement | null {
  const block = statement.parent;
  if (block?.type === "SwitchCase") return below(block.consequent, statement);
  const body = blockBody(statement);
  return body === null ? null : below(body, statement);
}

/**
 * The module or block body a statement is written in, or null under any other parent. A `switch`
 * case is left out: a rule reading the statements around a guard reads a body, and a case is one
 * arm of something else.
 */
export function blockBody(statement: ESTree.Node): readonly ESTree.Statement[] | null {
  const block = statement.parent;
  return block?.type === "Program" || block?.type === "BlockStatement" ? block.body : null;
}

/** `a.b` or `a.#b`: a member read by its written name, which a computed `a[b]` is not. */
export function isNamedMember(
  node: ESTree.Node,
): node is ESTree.StaticMemberExpression | ESTree.PrivateFieldExpression {
  return node.type === "MemberExpression" && !node.computed;
}

/** The name an identifier spells, or null for any other node and for none. */
export function identifierName(node: ESTree.Node | null | undefined): string | null {
  return node?.type === "Identifier" ? node.name : null;
}

/** The name a binding spells, through a default (`name = ""`), or null for a pattern. */
export function bindingName(node: ESTree.Node | null | undefined): string | null {
  return node?.type === "AssignmentPattern" ? bindingName(node.left) : identifierName(node);
}

/** The property a static member read names (`a.b` as `b`), or null for a computed or private one. */
export function propertyName(node: ESTree.Node | null | undefined): string | null {
  return node?.type === "MemberExpression" && !node.computed ? identifierName(node.property) : null;
}

/** The object of a member read (`a` in `a.b` and `a[b]`), or null for any other node. */
export function memberObject(node: ESTree.Node | null | undefined): ESTree.Node | null {
  return node?.type === "MemberExpression" ? node.object : null;
}

/** The plain `=` assignment a statement holds (`a = b;`, `a.b = c;`), or null for any other
 *  statement, a compound operator among them. */
export function plainAssignment(
  statement: ESTree.Node | null | undefined,
): ESTree.AssignmentExpression | null {
  const expression = statement?.type === "ExpressionStatement" ? statement.expression : null;
  return expression?.type === "AssignmentExpression" && expression.operator === "=" ? expression : null;
}

/**
 * The value a literal holds, or undefined for any other node and for none. A regular expression
 * the runtime cannot build holds null too, so a test for the `null` literal reads `raw` instead.
 */
export function literalValue(node: ESTree.Node | null | undefined): LiteralValue | undefined {
  return node?.type === "Literal" ? node.value : undefined;
}

/** The declaration a statement carries, past `export`. */
export function declaredBy(statement: ESTree.Node): ESTree.Node {
  const exported =
    statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration";
  if (!exported) return statement;
  return statement.declaration ?? statement;
}

/** Whether a node is a `const` declaration. */
export function isConstDeclaration(
  node: ESTree.Node,
): node is ESTree.VariableDeclaration & { kind: "const" } {
  return node.type === "VariableDeclaration" && node.kind === "const";
}

/** Whether a declarator binds a plain name to a value (`const name = init`), not a pattern or a bare `let`. */
export const bindsName = (node: ESTree.VariableDeclarator): node is NamedBinding =>
  node.id.type === "Identifier" && node.init !== null;

/** Whether a node is a call given exactly one argument. */
export function isOneArgumentCall(
  node: ESTree.Node,
): node is ESTree.CallExpression & { arguments: [ESTree.Argument] } {
  return node.type === "CallExpression" && node.arguments.length === 1;
}

/** The name and declarator of a `const` statement declaring one plain name, or null otherwise. */
export function singleConst(
  statement: ESTree.Statement,
): { name: string; declared: ESTree.VariableDeclarator } | null {
  if (!isConstDeclaration(statement)) return null;
  const [declared] = statement.declarations;
  if (statement.declarations.length !== 1 || declared === undefined) return null;
  const name = identifierName(declared.id);
  return name === null ? null : { name, declared };
}

/**
 * The parameters and body of a call's first argument when it is a function written in place, as a
 * callback or an executor is, or null when the first argument is anything else.
 */
export function inlineFunctionArgument(node: ESTree.CallExpression | ESTree.NewExpression): {
  params: readonly ESTree.ParamPattern[];
  body: ESTree.FunctionBody | ESTree.Expression;
} | null {
  const [callback] = node.arguments;
  if (callback === undefined) return null;
  if (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression") return null;
  if (callback.body === null) return null;
  return { params: callback.params, body: callback.body };
}

/** The entry after `statement` in a list that holds it. */
function below(body: readonly ESTree.Statement[], statement: ESTree.Node): ESTree.Statement | null {
  const statements: readonly ESTree.Node[] = body;
  const at = statements.indexOf(statement);
  return (at === -1 ? undefined : body[at + 1]) ?? null;
}

/**
 * Every statement list in the file, for a rule that reads a statement against the one after it.
 *
 * Three node types hold one: a module body, a block and a `switch` case. A rule that visits
 * statements individually instead cannot see what follows, and a rule that walks the tree itself
 * visits the same list under two parents.
 */
export function everyStatementList(scan: (body: readonly ESTree.Statement[]) => void): StatementLists {
  return {
    Program: (node) => scan(node.body),
    BlockStatement: (node) => scan(node.body),
    SwitchCase: (node) => scan(node.consequent),
  };
}

/** The expression's source, parenthesised where a `.method` written after it would bind first. */
export function asSubject(node: ESTree.Node, text: string): string {
  return ATOMIC.has(node.type) ? text : `(${text})`;
}
