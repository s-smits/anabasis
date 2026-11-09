import type { ESTree } from "@oxlint/plugins";
import { isString } from "#src/meta/json-shape.ts";
import { literalValue, propertyName } from "../../ana/shared/statements.ts";

/**
 * The syntax both implicit-state plugins read: what a file is for, what a call is named, and where
 * a value ends up. Nothing here names a module of any one repository, so a rule built on it runs
 * on any TypeScript tree.
 */

/** A file the test runner owns: a fixture states its states beside each other on purpose. */
const TEST_PATH = /(?:^|\/)(?:test|tests|__tests__|__mocks__|fixtures?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/u;

/** Nodes that pass a value through unchanged, so a read inside one is a read of what it wraps. */
const TRANSPARENT = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "ChainExpression",
  "AwaitExpression",
]);

/** Statements and expressions whose `test` decides which way they go. */
const TESTS = new Set([
  "IfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "ConditionalExpression",
  "ForStatement",
]);
/** Operators that compute a value from their operands rather than compare them. */
const ARITHMETIC = new Set(["+", "-", "*"]);

/** A setter's name: `setStatus`, `setState`, `setAppState`. */
const SETTER = /^set([A-Z]\w*)$/u;

/** The state a setter's name sets (`status` for `setStatus`, `appState` for `setAppState`), or
 *  null for any other name. */
export function setterState(name: string | null): string | null {
  const word = SETTER.exec(name ?? "")?.[1];
  return word === undefined ? null : `${word.charAt(0).toLowerCase()}${word.slice(1)}`;
}

/** Whether the file belongs to a test suite rather than to the product. */
export function isTestPath(filename: string): boolean {
  return TEST_PATH.test(filename.replaceAll("\\", "/"));
}

/** `existsSync` for `existsSync(p)`, `fs.existsSync(p)` and `fs["existsSync"](p)`; null otherwise. */
export function calleeName(call: ESTree.CallExpression | ESTree.NewExpression): string | null {
  const callee = call.callee;
  if (callee.type === "Identifier") {
    return callee.name;
  }
  if (callee.type !== "MemberExpression") {
    return null;
  }
  const key = propertyName(callee) ?? literalValue(callee.property);
  return isString(key) ? key : null;
}

/** The node with every transparent wrapper above it climbed, so its parent is the first reader. */
export function outermost(node: ESTree.Node): ESTree.Node {
  let at = node;
  while (at.parent !== null && at.parent !== undefined && TRANSPARENT.has(at.parent.type)) {
    at = at.parent;
  }
  return at;
}

/** The node with every transparent wrapper inside it removed. */
export function innermost(node: ESTree.Node): ESTree.Node {
  if (node.type === "AwaitExpression") {
    return innermost(node.argument);
  }
  const wraps =
    node.type === "ParenthesizedExpression" ||
    node.type === "TSAsExpression" ||
    node.type === "TSNonNullExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "ChainExpression";
  return wraps ? innermost(node.expression) : node;
}

/** The nearest function around a node, or null at module scope. */
export function enclosingFunction(
  node: ESTree.Node,
): ESTree.Function | ESTree.ArrowFunctionExpression | null {
  for (let at = node.parent; at !== null && at !== undefined; at = at.parent) {
    if (
      at.type === "ArrowFunctionExpression" ||
      at.type === "FunctionDeclaration" ||
      at.type === "FunctionExpression"
    ) {
      return at;
    }
  }
  return null;
}

/**
 * Whether the value of `node` decides something: it is (or is negated, combined or compared into)
 * the test of an `if`, a loop or a ternary, an operand of a comparison, or what a function returns.
 */
export function decides(node: ESTree.Node): boolean {
  let at = outermost(node);
  for (let parent = at.parent; parent !== null && parent !== undefined; parent = at.parent) {
    if (parent.type !== "UnaryExpression" && parent.type !== "LogicalExpression") {
      return decidedBy(parent, at);
    }
    at = outermost(parent);
  }
  return false;
}

/** Whether `parent` decides on its child `at`: as a test, a comparison, a return or an arrow's value. */
function decidedBy(parent: ESTree.Node, at: ESTree.Node): boolean {
  if (TESTS.has(parent.type)) {
    return "test" in parent && parent.test === at;
  }
  if (parent.type === "BinaryExpression") {
    return !ARITHMETIC.has(parent.operator);
  }
  if (parent.type === "ArrowFunctionExpression") {
    return parent.body === at;
  }
  return parent.type === "ReturnStatement";
}
