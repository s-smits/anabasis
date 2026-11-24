import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";

/**
 * Flags conditional expressions nested in the `test` or `consequent` arm of another conditional,
 * or chained along the `alternate` tail past `CASE_LIMIT` (3) outcomes. Extract the inner ternary
 * to a `const` or rewrite long cascades as a `Map` or early-return function. There is no fix.
 */

/** Cases one tail may hold: `a ? x : b ? y : z` is three, and three is where the shapes divide. */
const CASE_LIMIT = 3;

/** How many values this cascade can produce, counting along its tail. */
function cases(head: ESTree.ConditionalExpression): number {
  let count = 2;
  let cursor = head;
  while (cursor.alternate.type === "ConditionalExpression") {
    cursor = cursor.alternate;
    count += 1;
  }
  return count;
}

export const noTangledTernaryRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "A ternary may grow along its tail, up to three cases.",
      examples: [
        {
          before: 'const word = page.available ? (findings === 0 ? "clear" : "findings") : "blocked";',
          after:
            'const found = findings === 0 ? "clear" : "findings";\nconst word = page.available ? found : "blocked";',
        },
        {
          before:
            'const label =\n  ending === "pass" ? "valid" : ending === "fail" ? "not valid" : ending === "flagged" ? "flagged" : "no result";',
          after:
            'const LABELS = new Map([["pass", "valid"], ["fail", "not valid"], ["flagged", "flagged"]]);\nconst label = LABELS.get(ending) ?? "no result";',
        },
      ] satisfies RuleExample[],
    },
    messages: {
      tooManyCases:
        "This ternary decides between {{count}} values, so reading the last one means holding every condition ruled out before it. Four cases is usually a `Map` keyed on what the tests compare, or a function whose branches return.",
      nestedArm:
        "This ternary sits in the {{position}} of another, so the `:` that ends the outer one belongs to a condition several tokens back. Name this one in a `const` above, or make the whole decision a function whose branches return — inverting the outer test instead trades this finding for `unicorn/no-negated-condition`.",
    },
  },
  createOnce(context) {
    return {
      before: () => true,

      ConditionalExpression: (node) => {
        const parent = node.parent;
        if (parent.type === "ConditionalExpression") {
          // A tail link is part of the cascade its head already counts.
          if (parent.alternate === node) return;
          const position = parent.test === node ? "test" : "consequent";
          context.report({ node, messageId: "nestedArm", data: { position } });
          return;
        }
        const count = cases(node);
        if (count <= CASE_LIMIT) return;
        context.report({ node, messageId: "tooManyCases", data: { count: String(count) } });
      },
    };
  },
});
