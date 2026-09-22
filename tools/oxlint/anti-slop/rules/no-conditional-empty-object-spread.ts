import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

function isEmptyObjectExpression(node: ESTree.Expression): boolean {
  return node.type === "ObjectExpression" && node.properties.length === 0;
}

function isConditionalEmptyObjectSpread(node: ESTree.Expression): boolean {
  let conditional = node;
  while (conditional.type === "ParenthesizedExpression") {
    conditional = conditional.expression;
  }
  return (
    conditional.type === "ConditionalExpression" &&
    (isEmptyObjectExpression(conditional.consequent) || isEmptyObjectExpression(conditional.alternate))
  );
}

/**
 * Ban conditional empty-object spreads without changing their omission semantics.
 *
 * There is no fix: whether the field should be absent or present and null is the contract, and
 * the spread is where that decision was avoided.
 */
export const noConditionalEmptyObjectSpreadRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow object spreads that conditionally spread an empty object to omit fields.",
    },
    messages: {
      avoid:
        "This conditional spread hides property omission behind an empty object. Build the object in separate statements and add the property only when present.",
    },
  },
  createOnce(context) {
    return {
      SpreadElement(node) {
        if (node.parent.type !== "ObjectExpression") return;

        if (isConditionalEmptyObjectSpread(node.argument)) {
          context.report({ node, messageId: "avoid" });
        }
      },
    };
  },
});
