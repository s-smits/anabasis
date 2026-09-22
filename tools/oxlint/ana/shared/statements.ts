import type { ESTree } from "@oxlint/plugins";

/** The visitor a statement-list rule returns, so `scan` sees each list once. */
type StatementLists = {
  Program: (node: ESTree.Program) => void;
  BlockStatement: (node: ESTree.BlockStatement) => void;
  SwitchCase: (node: ESTree.SwitchCase) => void;
};

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
 * one-argument method call and the function argument in two rules each on 2026-09-22.
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

/** The name and declarator of a `const` statement declaring one plain name, or null otherwise. */
export function singleConst(
  statement: ESTree.Statement,
): { name: string; declared: ESTree.VariableDeclarator } | null {
  if (statement.type !== "VariableDeclaration" || statement.kind !== "const") return null;
  const [declared] = statement.declarations;
  if (statement.declarations.length !== 1 || declared === undefined) return null;
  if (declared.id.type !== "Identifier") return null;
  return { name: declared.id.name, declared };
}

/**
 * The receiver and only argument of `<receiver>.<method>(<argument>)`, or null for anything else:
 * another method, a computed member, or any other number of arguments.
 */
export function methodCall(
  node: ESTree.Node,
  method: string,
): { receiver: ESTree.Expression; argument: ESTree.Argument } | null {
  if (node.type !== "CallExpression" || node.arguments.length !== 1) return null;
  const { callee } = node;
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  if (callee.property.type !== "Identifier" || callee.property.name !== method) return null;
  const [argument] = node.arguments;
  return argument === undefined ? null : { receiver: callee.object, argument };
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
  const at = body.findIndex((one) => one === statement);
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
