import { defineRule } from "@oxlint/plugins";
import { mutatingCall } from "../shared/predicate-effect.ts";
import { inlineFunctionArgument } from "../shared/statements.ts";

/**
 * A predicate that mutates is not a predicate. The shape the simplify skill kept finding is a
 * `Set` used for deduplication from inside a `.filter()`:
 *
 *     const first = rows.filter((row) => !seen.has(row.id) && seen.add(row.id));
 *
 * The answer is the platform's own: `new Map(rows.map((row) => [row.id, row])).values()` keeps the
 * last of each key, and `[...new Map(...)].values()` reversed keeps the first. Either way one data
 * structure does the job the closure was doing by side effect, and the array method goes back to
 * answering a question rather than building state while it walks.
 *
 * The rule reads the six positions that take a predicate — `filter`, `find`, `findLast`,
 * `findIndex`, `some` and `every` — and reports a callback whose body mutates.
 * `shared/predicate-effect.ts` owns which calls count as a mutation, and why there are six of
 * those as well, because `ana/prefer-some-over-filter-length` needs the same answer from the other
 * side: it may turn a `.filter().length` into `.some()` only where the short-circuit cannot be
 * noticed.
 *
 * `forEach`, `map` and `reduce` are outside it on purpose. `forEach` exists to have an effect,
 * a `map` that also records what it saw is a different finding with a different answer, and
 * `reduce` carries its accumulator by contract.
 *
 * There is no fix: which structure replaces the set — a `Map` by key, a
 * `Object.groupBy`, or a plain loop when the walk really does build two things — is the decision
 * the author has to make, and it is not readable off the predicate.
 */

/** The six array methods whose argument is a predicate: a question, asked once per element. */
const PREDICATE_METHODS = new Set(["filter", "find", "findLast", "findIndex", "some", "every"]);

export const noSideEffectInPredicateRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "A predicate that mutates a collection is a loop wearing an array method's name." },
    messages: {
      mutates:
        "This `.{{method}}()` predicate calls `.{{mutation}}()`, so the walk builds state while it answers. Deduplication is `new Map(xs.map((x) => [key, x]))`; a walk that really does two things is a loop.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.type !== "Identifier" || !PREDICATE_METHODS.has(callee.property.name)) return;
        const predicate = inlineFunctionArgument(node);
        if (predicate === null) return;
        const found = mutatingCall(context.sourceCode.getText(predicate.body));
        if (found === null) return;
        context.report({
          node: callee.property,
          messageId: "mutates",
          data: { method: callee.property.name, mutation: found },
        });
      },
    };
  },
});
