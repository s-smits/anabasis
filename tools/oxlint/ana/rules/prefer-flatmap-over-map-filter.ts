import { defineRule, type ESTree } from "@oxlint/plugins";

/**
 * `xs.map(toRow).filter(Boolean)` walks the array twice and then lies about the type. The
 * second walk exists because the first one had no way to say "nothing here", so it said
 * `undefined` and left a reader to strip them out.
 *
 *     const rows = cases.map(toRow).filter(Boolean);
 *     const rows = cases.flatMap((c) => toRow(c) ?? []);
 *
 * `filter(Boolean)` is the part that costs. TypeScript does not narrow through it — the result
 * stays `(Row | undefined)[]` unless someone writes a type predicate beside it — so the site
 * either carries an assertion or carries the wrong type forward. `flatMap` returning `[]`
 * narrows on its own, because an empty array contributes no element type.
 *
 * `filter(Boolean)` after anything else is not read here. After a `.split()` it is dropping
 * empty strings, which is a different intent with a different answer, and after a plain array
 * it is a real filter someone chose.
 *
 * The falsy set is the trap, and it is why there is no fix. `Boolean` drops
 * `0`, `""` and `false` as well as `null` and `undefined`, so a map producing counts or flags
 * means something the `?? []` rewrite does not. The author has to say which one the site is.
 */
export const preferFlatmapOverMapFilterRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "map followed by filter(Boolean) walks twice and keeps the wrong type." },
    messages: {
      twoWalks:
        "`.map(…).filter(Boolean)` walks twice and still types the result as possibly-empty, since `filter(Boolean)` does not narrow. `.flatMap((x) => f(x) ?? [])` drops the blanks where they are made and narrows on its own.",
    },
  },
  createOnce(context) {
    /** Whether a call is `<something>.<name>(<one argument>)`. */
    function methodCall(node: ESTree.Node, name: string): node is ESTree.CallExpression {
      if (node.type !== "CallExpression" || node.arguments.length !== 1) return false;
      const { callee } = node;
      if (callee.type !== "MemberExpression" || callee.computed) return false;
      return callee.property.type === "Identifier" && callee.property.name === name;
    }

    return {
      CallExpression(node) {
        if (!methodCall(node, "filter")) return;
        const [predicate] = node.arguments;
        if (predicate?.type !== "Identifier" || predicate.name !== "Boolean") return;

        const { callee } = node;
        if (callee.type !== "MemberExpression") return;
        if (!methodCall(callee.object, "map")) return;
        context.report({ node: callee.property, messageId: "twoWalks" });
      },
    };
  },
});
