import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";

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
 * `{...(present ? { key: value } : {})}`: a spread inside an object literal whose argument is a
 * conditional with an empty object in one arm.
 *
 * There is no fix: whether the field should be absent or present and null is the contract, and
 * the spread is where that decision was avoided.
 */
export const noConditionalEmptyObjectSpreadRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow object spreads that conditionally spread an empty object to omit fields.",
      examples: [
        {
          before: "const opening = { name, ...(project === undefined ? {} : { project }) };",
          after: 'const opening = { name, ...keyIfDefined("project", project) };',
        },
        {
          before: "const start = { task, ...(limits.turns > 0 ? { turns: limits.turns } : {}) };",
          after: "const start = { task, ...keysIf(limits.turns > 0, () => ({ turns: limits.turns })) };",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      avoid:
        "This conditional spread hides property omission behind an empty object. Spread `keyIfDefined`, `keyIfNotNull` or `keysIf` from `src/meta/optional-key.ts` in its place, which names the condition the key is present under.",
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
