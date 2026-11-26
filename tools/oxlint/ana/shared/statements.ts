import type { ESTree } from "@oxlint/plugins";

// oxlint-disable-next-line typescript/consistent-type-definitions -- a type alias stays assignable to the plugin's visitor, whose index signature an interface does not meet
type StatementLists = {
  Program: (node: ESTree.Program) => void;
  BlockStatement: (node: ESTree.BlockStatement) => void;
  SwitchCase: (node: ESTree.SwitchCase) => void;
};

type LiteralValue = Extract<ESTree.Node, { type: "Literal" }>["value"];
type NamedBinding = ESTree.VariableDeclarator & { id: ESTree.BindingIdentifier; init: ESTree.Expression };

/**
 * Node types that bind tighter than a `.` after them. The tree has no parentheses, and `(a ??
 * b).filter(p)` read back as `a ?? b.filter(p)` silently changes meaning.
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
 */

export function onlyStatement(node: ESTree.Statement): ESTree.Statement | null {
  if (node.type !== "BlockStatement") return node;
  const [only] = node.body;
  return node.body.length === 1 && only !== undefined ? only : null;
}

export function statementBelow(statement: ESTree.Node): ESTree.Statement | null {
  const block = statement.parent;
  if (block?.type === "SwitchCase") return below(block.consequent, statement);
  const body = blockBody(statement);
  return body === null ? null : below(body, statement);
}

/**
 * A `switch` case is left out: a rule reading the statements around a guard reads a body, and a
 * case is one arm of something else.
 */
export function blockBody(statement: ESTree.Node): readonly ESTree.Statement[] | null {
  const block = statement.parent;
  return block?.type === "Program" || block?.type === "BlockStatement" ? block.body : null;
}

export function isNamedMember(
  node: ESTree.Node,
): node is ESTree.StaticMemberExpression | ESTree.PrivateFieldExpression {
  return node.type === "MemberExpression" && !node.computed;
}

export function identifierName(node: ESTree.Node | null | undefined): string | null {
  return node?.type === "Identifier" ? node.name : null;
}

export function bindingName(node: ESTree.Node | null | undefined): string | null {
  return node?.type === "AssignmentPattern" ? bindingName(node.left) : identifierName(node);
}

export function propertyName(node: ESTree.Node | null | undefined): string | null {
  return node?.type === "MemberExpression" && !node.computed ? identifierName(node.property) : null;
}

export function memberObject(node: ESTree.Node | null | undefined): ESTree.Node | null {
  return node?.type === "MemberExpression" ? node.object : null;
}

export function plainAssignment(
  statement: ESTree.Node | null | undefined,
): ESTree.AssignmentExpression | null {
  const expression = statement?.type === "ExpressionStatement" ? statement.expression : null;
  return expression?.type === "AssignmentExpression" && expression.operator === "=" ? expression : null;
}

/**
 * A regular expression the runtime cannot build holds null too, so a test for the `null` literal
 * reads `raw` instead.
 */
export function literalValue(node: ESTree.Node | null | undefined): LiteralValue | undefined {
  return node?.type === "Literal" ? node.value : undefined;
}

export function declaredBy(statement: ESTree.Node): ESTree.Node {
  const exported =
    statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration";
  if (!exported) return statement;
  return statement.declaration ?? statement;
}

export function isConstDeclaration(
  node: ESTree.Node,
): node is ESTree.VariableDeclaration & { kind: "const" } {
  return node.type === "VariableDeclaration" && node.kind === "const";
}

export const bindsName = (node: ESTree.VariableDeclarator): node is NamedBinding =>
  node.id.type === "Identifier" && node.init !== null;

export function isOneArgumentCall(
  node: ESTree.Node,
): node is ESTree.CallExpression & { arguments: [ESTree.Argument] } {
  return node.type === "CallExpression" && node.arguments.length === 1;
}

export function singleConst(
  statement: ESTree.Statement,
): { name: string; declared: ESTree.VariableDeclarator } | null {
  if (!isConstDeclaration(statement)) return null;
  const [declared] = statement.declarations;
  if (statement.declarations.length !== 1 || declared === undefined) return null;
  const name = identifierName(declared.id);
  return name === null ? null : { name, declared };
}

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

function below(body: readonly ESTree.Statement[], statement: ESTree.Node): ESTree.Statement | null {
  const statements: readonly ESTree.Node[] = body;
  const at = statements.indexOf(statement);
  return (at === -1 ? undefined : body[at + 1]) ?? null;
}

export function everyStatementList(scan: (body: readonly ESTree.Statement[]) => void): StatementLists {
  return {
    Program: (node) => scan(node.body),
    BlockStatement: (node) => scan(node.body),
    SwitchCase: (node) => scan(node.consequent),
  };
}

export function asSubject(node: ESTree.Node, text: string): string {
  return ATOMIC.has(node.type) ? text : `(${text})`;
}
