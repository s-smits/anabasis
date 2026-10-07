import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";

import {
  arrayMethodTarget,
  isKnownArrayExpression,
  resolveArrayBinding,
  unwrapArrayExpression,
} from "../shared/array-method.ts";

function enclosingReducer(node: ESTree.Node) {
  let { parent } = node;
  while (parent !== null) {
    if (parent.type === "FunctionDeclaration") return null;
    if (parent.type === "ArrowFunctionExpression" || parent.type === "FunctionExpression") {
      const callback = parent;
      let owner: ESTree.Node | null = callback.parent;
      while (owner !== null && unwrapArrayExpression(owner) === callback) owner = owner.parent;
      if (owner?.type !== "CallExpression") return null;
      const method = arrayMethodTarget(owner.callee);
      const firstArgument = owner.arguments[0];
      if (
        method === null ||
        (method.name !== "reduce" && method.name !== "reduceRight") ||
        owner.arguments.length > 2 ||
        firstArgument === undefined ||
        unwrapArrayExpression(firstArgument) !== callback
      ) {
        return null;
      }
      const firstParameter = callback.params[0];
      const accumulator = firstParameter?.type === "AssignmentPattern" ? firstParameter.left : firstParameter;
      if (accumulator?.type !== "Identifier") return null;
      return { callback, accumulator, initialValue: owner.arguments[1] };
    }
    parent = parent.parent;
  }
  return null;
}

function referencesAccumulator(
  sourceCode: SourceCode,
  node: ESTree.Node,
  accumulator: Variable,
  visited = new Set<Variable>(),
): boolean {
  const variable = resolveArrayBinding(sourceCode, node);
  if (variable === null || visited.has(variable)) return false;
  if (variable === accumulator) return true;
  visited.add(variable);
  if (variable.references.some((reference) => reference.isWrite() && !reference.init)) return false;
  for (const definition of variable.defs) {
    if (
      definition.type === "Variable" &&
      definition.node.type === "VariableDeclarator" &&
      definition.node.id.type === "Identifier" &&
      definition.node.init !== null &&
      definition.node.parent.type === "VariableDeclaration" &&
      definition.node.parent.kind === "const"
    ) {
      return referencesAccumulator(sourceCode, definition.node.init, accumulator, visited);
    }
  }
  return false;
}

function isGlobalCopyOwner(sourceCode: SourceCode, wrapped: ESTree.Node, name: string): boolean {
  const node = unwrapArrayExpression(wrapped);
  if (node.type !== "Identifier" || node.name !== name) return false;
  const variable = resolveArrayBinding(sourceCode, node);
  return variable === null || variable.defs.length === 0;
}

/**
 * A `reduce` callback that copies its own accumulator on every step: `Object.assign({}, acc, …)`,
 * `Array.from(acc)`, or `acc.concat(…)`, `.slice()`, `.toSorted()` and the rest of the copying
 * array methods.
 *
 * The accumulator grows as the reduce runs, so copying it once per element is quadratic in the
 * input — a thousand rows is half a million copied entries, and the code reads as though it costs
 * one pass. `oxc/no-accumulating-spread` already catches `{...acc}` and `[...acc]`, which is the
 * spelling most people reach for; this rule is the same defect written the other five ways, and
 * the two are meant to be enabled together.
 *
 * What it refuses to guess at is what counts as the accumulator. `referencesAccumulator` resolves
 * the copied expression through the scope, follows a `const` alias to its initialiser, and
 * accepts only a chain that actually arrives at the callback's first parameter; a binding written
 * to after its declaration stops the walk, because what it holds later is no longer decidable
 * here. `enclosingReducer` gives up at a `FunctionDeclaration`, so a copy inside a named helper
 * is that helper's business and not attributed to the reduce that happens to enclose it, and it
 * requires the callback to be the reduce's own first argument rather than any function passed
 * nearby. `Object.assign` is reported only where the target is a fresh literal and the
 * accumulator is one of the later sources, which is the copying form; assigning into the
 * accumulator is the repair, not the defect. The array methods are reported only where the
 * reduce's initial value is a known array, so a `.concat` on something else in the body is
 * untouched. `Object` and `Array` themselves have to be the globals.
 *
 * There is no fix: a mutating accumulator and an iterator pipeline are both correct answers, and
 * which one fits depends on what the reducer is building.
 */
export const noReduceAccumulatorCopyRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow copying growing reducer accumulators with Object.assign, Array.from, or array copy methods.",
    },
    messages: {
      accumulatorCopy:
        "Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const method = arrayMethodTarget(node.callee);
        if (method === null) return;
        const reducer = enclosingReducer(node);
        if (reducer === null) return;
        const accumulator = context.sourceCode
          .getDeclaredVariables(reducer.callback)
          .find((variable) =>
            variable.identifiers.some((identifier) => identifier.start === reducer.accumulator.start),
          );
        if (accumulator === undefined) return;
        const isAccumulator = (expression: ESTree.Node) =>
          referencesAccumulator(context.sourceCode, expression, accumulator);
        let copiesAccumulator = false;
        if (method.name === "assign" && isGlobalCopyOwner(context.sourceCode, method.object, "Object")) {
          const target = node.arguments[0];
          copiesAccumulator =
            target !== undefined &&
            unwrapArrayExpression(target).type === "ObjectExpression" &&
            node.arguments.slice(1).some(isAccumulator);
        } else if (method.name === "from" && isGlobalCopyOwner(context.sourceCode, method.object, "Array")) {
          const source = node.arguments[0];
          copiesAccumulator = source !== undefined && isAccumulator(source);
        } else if (["concat", "slice", "toSpliced", "toSorted", "toReversed", "with"].includes(method.name)) {
          const { initialValue } = reducer;
          const arrayAccumulator =
            initialValue !== undefined && isKnownArrayExpression(context.sourceCode, initialValue);
          copiesAccumulator = arrayAccumulator && isAccumulator(method.object);
        }
        if (copiesAccumulator) context.report({ node, messageId: "accumulatorCopy" });
      },
    };
  },
});
