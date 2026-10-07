import { defineRule } from "@oxlint/plugins";

import { arrayMethodTarget, isKnownArrayExpression, unwrapArrayExpression } from "../shared/array-method.ts";

/**
 * Two array passes written next to each other: `rows.filter(...).map(...)`, or the same pair the
 * other way round. Each one allocates a whole intermediate array, and the second walks it again.
 *
 * The rule fires only where the source is certainly an array, which is what
 * `isKnownArrayExpression` decides: an array literal, a chain of array-producing methods on one,
 * or a binding annotated as an array or initialised from one and never written to again. A
 * receiver it cannot establish is left alone, and that is the whole reason an iterator pipeline
 * is never reported — `.values().filter(...).map(...)` over a Map or a Set has no intermediate
 * array to collapse, and a lazy chain does one pass regardless. The two methods also have to
 * differ, so `.map(...).map(...)` is a different question and not this one.
 *
 * There is no fix: whether the two passes become one transformation, a `flatMap` or an iterator
 * pipeline depends on what the callbacks do with the index and the order, which the rule reads
 * well enough to ask the question and not well enough to answer it.
 *
 * The message used to lead with the iterator pipeline and mention `flatMap` last, and the tree
 * says that is the wrong order for a rule that fires on an array. `flatMap` sites far outnumber
 * chains ending in `.toArray()`, and most of those chains open on `.values()` or `.entries()` —
 * a Map or a Set, which never had an array to collapse. So `flatMap` is what this repository
 * writes when the source is already an array, which is the only case this rule reports, and the
 * pipeline is what it writes when the source is not. Both stay in the message; the order now
 * matches the site the reader is standing on.
 */
export const noArrayFilterMapRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow adjacent array filter/map passes in favor of lazy iterator helpers or a single transformation.",
    },
    messages: {
      arrayFilterMap:
        "Avoid consecutive array `{{first}}` and `{{second}}` passes. Prefer a single `flatMap`, which is how this repository collapses an array in one pass; where the source is a Map or a Set, `.values().{{first}}(...).{{second}}(...).toArray()` reads better, and a mutating reducer is the third answer. Preserve callback ordering, indexes, and filtering semantics.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const outer = arrayMethodTarget(node.callee);
        if (outer === null || (outer.name !== "map" && outer.name !== "filter")) return;
        const innerCall = unwrapArrayExpression(outer.object);
        if (innerCall.type !== "CallExpression") return;
        const inner = arrayMethodTarget(innerCall.callee);
        if (inner === null || inner.name !== (outer.name === "map" ? "filter" : "map")) return;
        if (!isKnownArrayExpression(context.sourceCode, inner.object)) return;
        context.report({
          node,
          messageId: "arrayFilterMap",
          data: { first: inner.name, second: outer.name },
        });
      },
    };
  },
});
