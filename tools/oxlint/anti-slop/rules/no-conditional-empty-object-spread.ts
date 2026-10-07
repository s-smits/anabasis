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
 * `{...(present ? { key: value } : {})}` — a spread inside an object literal whose argument is a
 * conditional with an empty object in one arm.
 *
 * It is the shortest way to make a key sometimes exist, which is why it is written, and that is
 * the problem: the key's presence is now a fact about a ternary in the middle of a literal rather
 * than a statement anyone made. A reader working out what the object can hold has to evaluate the
 * condition to find out whether the field is even in the type, and a schema written from the
 * literal is wrong in one of the two cases. Building the object and adding the key under a named
 * condition costs two more lines and says which fields are optional.
 *
 * Only the spread argument is read, and only where the spread sits directly in an object literal,
 * so the same ternary as a value, an argument or an initialiser is left alone — there it produces
 * a value rather than deciding whether a key exists. Either arm may be the empty one, since
 * `{...(absent ? {} : { key })}` is the same construction written the other way round, and
 * parentheses around the conditional are unwrapped first.
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
