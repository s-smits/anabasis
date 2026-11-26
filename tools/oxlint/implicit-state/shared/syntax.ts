import type { ESTree } from "@oxlint/plugins";
import { isString } from "#src/meta/json-shape.ts";
import { identifierName, literalValue, propertyName } from "../../ana/shared/statements.ts";

/**
 * The syntax both implicit-state plugins read. Nothing here names a module of any one repository,
 * so a rule built on it runs on any TypeScript tree.
 */

/** A file the test runner owns: a fixture states its states beside each other on purpose. */
const TEST_PATH = /(?:^|\/)(?:test|tests|__tests__|__mocks__|fixtures?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/u;

const TRANSPARENT = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "ChainExpression",
  "AwaitExpression",
]);

const TESTS = new Set([
  "IfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "ConditionalExpression",
  "ForStatement",
]);
const ARITHMETIC = new Set(["+", "-", "*"]);

const SETTER = /^set([A-Z]\w*)$/u;

export function setterState(name: string | null): string | null {
  const word = SETTER.exec(name ?? "")?.[1];
  return word === undefined ? null : `${word.charAt(0).toLowerCase()}${word.slice(1)}`;
}

export function isTestPath(filename: string): boolean {
  return TEST_PATH.test(filename.replaceAll("\\", "/"));
}

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

export function outermost(node: ESTree.Node): ESTree.Node {
  let at = node;
  while (at.parent !== null && at.parent !== undefined && TRANSPARENT.has(at.parent.type)) {
    at = at.parent;
  }
  return at;
}

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
 * Whether the value of `node` decides something: the test of an `if`, a loop or a ternary (negated,
 * combined or compared), an operand of a comparison, or what a function returns.
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

export function objectValues(object: ESTree.ObjectExpression): Map<string, ESTree.Node> {
  const values = new Map<string, ESTree.Node>();
  for (const property of object.properties) {
    const name = property.type === "Property" && !property.computed ? identifierName(property.key) : null;
    if (property.type === "Property" && name !== null) {
      values.set(name, property.value);
    }
  }
  return values;
}
