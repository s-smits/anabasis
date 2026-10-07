import { defineRule, type ESTree } from "@oxlint/plugins";

/**
 * A ternary may grow along its tail, and only so far. `a ? x : b ? y : z` reads as a list of
 * cases: each condition is tried in turn, and the last value is what is left. Growing it
 * anywhere else breaks that reading, because the `: z` at the end then belongs to a condition
 * several tokens back rather than to the one beside it.
 *
 * This is deliberately not `eslint/no-nested-ternary`, which reports every nesting and so reports
 * 193 sites here, `compareCodeUnits`'s `left < right ? -1 : left > right ? 1 : 0` among them.
 * That expression is the clearest form a three-way compare has, and a rule whose remedy is to
 * make it worse is a rule that gets turned off. `unicorn/no-nested-ternary` is not the answer
 * either: its only remedy is parentheses, which the formatter then takes back out. Reading the
 * 193 down to the shapes that are actually hard to follow leaves 47.
 *
 * Two shapes, and the remedies are the same two for both.
 *
 * **A tail longer than three cases** is a lookup written out by hand. At four, reaching the last
 * value means holding three conditions that have already been ruled out, which is what a `Map`
 * or a function with early returns does for the reader. Three is where the recorded sites
 * divide: the three-case tails are compares and tri-states, the longer ones are dispatch tables.
 *
 * **A ternary in the test or the consequent** puts a branch where the reader is still waiting
 * for the outer one to finish. `page.available ? (findings === 0 ? "clear" : "findings") :
 * "blocked"` has three outcomes and reads as though it had two.
 *
 * The remedy is to name the inner ternary, or to make the whole thing a function whose branches
 * return. Naming is usually the lighter one — `const found = findings === 0 ? "clear" :
 * "findings";` leaves `page.available ? found : "blocked"` behind — and a tail past three wants
 * the function. Both are available at every site, which is what the rule had to be tuned until
 * it could say.
 *
 * Inverting the outer test is **not** the remedy here, which is worth stating because it is the
 * first thing that comes to mind. `unicorn/no-negated-condition` is on, and it reads `!x` and
 * `x !== y` in a ternary test as negated, so turning `a === null ? (…) : b` around into
 * `a !== null ? b : (…)` trades this finding for that one. A guard inside a function does not
 * have the problem, because an `if` with no `else` is not a negated condition — which is part of
 * why the function is the remedy that always works.
 *
 * Only the head of a cascade is counted, so one long chain is one finding rather than one per
 * link. A ternary behind any other syntax — a call argument, an array element, a template hole —
 * is not nesting for this purpose: the enclosing node is a boundary and the reader stops there.
 *
 * There is no fix. Which of the two remedies a site wants is the decision, and at
 * the tail-too-long sites it is often a third: the `Map` the conditions were spelling out.
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
    docs: { description: "A ternary may grow along its tail, up to three cases." },
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
