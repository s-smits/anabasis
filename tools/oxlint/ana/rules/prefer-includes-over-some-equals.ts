import { defineRule, type ESTree } from "@oxlint/plugins";
import { holdsProse } from "../shared/masked.ts";

/**
 * `segments.some((segment) => segment === "")` is `segments.includes("")` with a closure around
 * it. The closure adds a parameter name, a scope and an arrow for the reader to step over, and
 * says the same thing.
 *
 * The rule reports only a string or boolean literal on the other side, and that limit is the
 * whole of it: the first version reported every equality closure, and its thirteen sites were
 * mostly not the pattern at all.
 *
 * Eight were narrowing predicates — `BACKEND_KINDS.some((known) => known === value)` with
 * `value: string` against a readonly tuple of literals. `Array<BackendKind>.includes` demands a
 * `BackendKind`, where the closure only needed the comparison to be allowed, so `.some` is how
 * that is written in TypeScript rather than a closure someone forgot to remove. Converting one
 * stopped the tree compiling. A plugin rule sees no types, so it cannot tell that site from a
 * real one, and reporting both asks the author to go and read an element type to find out
 * whether the rule was talking to them. `includes` also matches with SameValueZero, so
 * `[NaN].includes(NaN)` is true where the closure is false, and `null` is a literal that
 * `Array<string>.includes` still refuses.
 *
 * A string or boolean literal settles all of that at once: the value is not NaN, it is not null,
 * and an array compared against it already has that type among its elements. So every site this
 * reports it also fixes, and the ones it cannot prove it leaves alone. It found three; it now
 * holds the line at zero.
 */
export const preferIncludesOverSomeEqualsRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: {
      description:
        "Ask an array whether it includes a literal instead of wrapping the comparison in a closure.",
    },
    messages: {
      closureAroundEquals:
        "`.some(({{param}}) => {{param}} === {{value}})` is `.includes({{value}})` with a closure around it. Ask the array directly.",
    },
  },
  createOnce(context) {
    /**
     * The parameter and the literal of an `xs.some((p) => p === "value")` closure, or null when
     * the call is not that shape or the literal is not one the rule can settle. A string or a
     * boolean settles every question at once: not NaN, not null, and already the element type.
     */
    function comparison(node: ESTree.CallExpression): { parameter: string; value: string } | null {
      const [only] = node.arguments;
      if (node.arguments.length !== 1 || only?.type !== "ArrowFunctionExpression") return null;
      const [parameter] = only.params;
      if (only.params.length !== 1 || parameter?.type !== "Identifier") return null;
      const { body } = only;
      if (body.type !== "BinaryExpression" || body.operator !== "===") return null;

      // Either side may hold the parameter; the other side is what the array is asked about.
      const left = body.left.type === "Identifier" && body.left.name === parameter.name;
      const right = body.right.type === "Identifier" && body.right.name === parameter.name;
      if (left === right) return null;
      const operand = left ? body.right : body.left;
      if (operand.type !== "Literal") return null;

      // Read off the source text the fix will move, rather than through a runtime check on the
      // parsed value: a quoted string, or one of the two boolean words.
      const value = context.sourceCode.getText(operand);
      const quoted = value.startsWith('"') || value.startsWith("'");
      return quoted || value === "true" || value === "false" ? { parameter: parameter.name, value } : null;
    }

    return {
      CallExpression(node) {
        const { callee } = node;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.type !== "Identifier" || callee.property.name !== "some") return;
        const [predicate] = node.arguments;
        const found = comparison(node);
        if (found === null || predicate === undefined) return;
        context.report({
          node: callee.property,
          messageId: "closureAroundEquals",
          data: { param: found.parameter, value: found.value },
          // The whole closure becomes the literal it compared against, so a sentence written
          // inside it has nowhere left to sit. One written between `.some(` and the closure is
          // outside both edits and stays where it is.
          fix: (fixer) =>
            holdsProse(context.sourceCode.getAllComments(), predicate.start, predicate.end)
              ? null
              : [fixer.replaceText(callee.property, "includes"), fixer.replaceText(predicate, found.value)],
        });
      },
    };
  },
});
