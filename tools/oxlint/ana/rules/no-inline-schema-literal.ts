import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { isTestFile } from "../shared/file-role.ts";
import { isConstDeclaration, isNamedMember } from "../shared/statements.ts";

/**
 * Flags a `const` array or object literal of at least `ENTRY_FLOOR` (3) primitive constant entries
 * declared inside a function body (outside test files) when the binding is only ever read by
 * non-mutating property access, so it can be hoisted to a named module-scope constant. There is no fix.
 */

/** Entries below which an inline literal is one argument written out, not a table. */
const ENTRY_FLOOR = 3;

/** Methods that write to their receiver. A call to one is a write to the binding. */
const MUTATING = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "set",
  "add",
  "delete",
  "clear",
]);

/** `{…} as const` declares the same table; the assertion is not what is being declared. */
function unwrapAssertion(node: ESTree.Node): ESTree.Node {
  let value = node;
  while (value.type === "TSAsExpression" || value.type === "TSSatisfiesExpression") value = value.expression;
  return value;
}

/** Whether the value is a primitive written as a constant, which nothing can write through. */
function primitiveConstant(node: ESTree.Node): boolean {
  if (node.type === "Literal") return true;
  if (node.type === "TemplateLiteral") return node.expressions.length === 0;
  if (node.type === "UnaryExpression") return node.operator === "-" && primitiveConstant(node.argument);
  return false;
}

/** Whether every entry of the table is one of those, so no entry can be aliased out of it. */
function flatConstantTable(node: ESTree.Node): boolean {
  if (node.type === "ArrayExpression") {
    return node.elements.every((element) => element !== null && primitiveConstant(element));
  }
  if (node.type !== "ObjectExpression") return false;
  return node.properties.every(
    (property) => property.type === "Property" && !property.computed && primitiveConstant(property.value),
  );
}

/** How many entries the literal states, or zero for anything that is not one. */
function entryCount(node: ESTree.Node): number {
  if (node.type === "ArrayExpression") return node.elements.length;
  return node.type === "ObjectExpression" ? node.properties.length : 0;
}

/** Whether the declaration sits inside a function rather than at module scope. */
function insideFunction(node: ESTree.Node): boolean {
  for (let walk = node.parent; walk !== null; walk = walk.parent) {
    if (walk.type === "FunctionDeclaration" || walk.type === "FunctionExpression") return true;
    if (walk.type === "ArrowFunctionExpression") return true;
  }
  return false;
}

/** Whether a property read of the binding writes through it: `t.x = 1`, `t.rows.push(…)`, `delete t.x`. */
function writesThrough(member: ESTree.Node): boolean {
  const { parent } = member;
  if (parent === null) return false;
  if (parent.type === "AssignmentExpression") return parent.left === member;
  if (parent.type === "UpdateExpression") return true;
  if (parent.type === "UnaryExpression") return parent.operator === "delete";
  if (parent.type !== "CallExpression" || parent.callee !== member) return false;
  return (
    member.type === "MemberExpression" &&
    !member.computed &&
    member.property.type === "Identifier" &&
    MUTATING.has(member.property.name)
  );
}

export const noInlineSchemaLiteralRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "A constant table built inside a function body belongs at module scope.",
      examples: [
        {
          before:
            'function missingKeys(row: RecordedRow): string[] {\n  const required = ["at", "sessionId", "harness"];\n  return required.filter((key) => !Object.hasOwn(row, key));\n}',
          after:
            'const REQUIRED_KEYS = ["at", "sessionId", "harness"];\nfunction missingKeys(row: RecordedRow): string[] {\n  return REQUIRED_KEYS.filter((key) => !Object.hasOwn(row, key));\n}',
        },
        {
          before:
            "function dollarsOf(usage: Usage): number {\n  const perMillion = { input: 3, output: 15, cacheRead: 0.3 };\n  const tokens = usage.input * perMillion.input + usage.output * perMillion.output;\n  return (tokens + usage.cacheRead * perMillion.cacheRead) / 1e6;\n}",
          after:
            "const PER_MILLION = { input: 3, output: 15, cacheRead: 0.3 };\nfunction dollarsOf(usage: Usage): number {\n  const tokens = usage.input * PER_MILLION.input + usage.output * PER_MILLION.output;\n  return (tokens + usage.cacheRead * PER_MILLION.cacheRead) / 1e6;\n}",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      inline:
        "`{{name}}` is {{count}} constant entries rebuilt on every call, declared where the work is rather than where the shapes are. It closes over nothing and this file only reads it, so move it to module scope.",
    },
  },
  createOnce(context) {
    /** Declarations that passed the syntactic test, by name, in source order. */
    const candidates = new Map<string, ESTree.VariableDeclarator[]>();

    /** Names this file does anything with other than read a property of. */
    const escaped = new Set<string>();

    return {
      before: () => {
        candidates.clear();
        escaped.clear();
        return !isTestFile(context.filename);
      },

      VariableDeclarator(node) {
        const { id, init, parent } = node;
        if (init === null) return;
        if (!isConstDeclaration(parent)) return;
        if (id.type !== "Identifier" || !insideFunction(node)) return;
        const table = unwrapAssertion(init);
        if (entryCount(table) < ENTRY_FLOOR || !flatConstantTable(table)) return;
        candidates.set(id.name, [...(candidates.get(id.name) ?? []), node]);
      },

      Identifier(node) {
        const { parent } = node;
        // The declaration itself, and a property name that happens to match, say nothing.
        if (parent.type === "VariableDeclarator" && parent.id === node) return;
        if (parent.type === "Property" && parent.key === node && parent.value !== node) return;
        if (isNamedMember(parent) && parent.property === node) return;
        // A property read is the one use that keeps the value inside this declaration.
        if (parent.type === "MemberExpression" && parent.object === node && !writesThrough(parent)) return;
        escaped.add(node.name);
      },

      "Program:exit": () => {
        for (const [name, nodes] of candidates) {
          if (escaped.has(name)) continue;
          for (const node of nodes) {
            const { init } = node;
            if (init === null) continue;
            context.report({
              node,
              messageId: "inline",
              data: { name, count: String(entryCount(unwrapAssertion(init))) },
            });
          }
        }
      },
    };
  },
});
