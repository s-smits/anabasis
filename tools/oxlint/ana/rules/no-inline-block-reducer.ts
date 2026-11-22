import { defineRule } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { identifierName, isNamedMember } from "../shared/statements.ts";

/**
 * Flags `.reduce((acc, item) => { ... }, seed)` calls whose reducer is an inline function or arrow
 * with a block body, preferring a `for...of` loop or a named reducer function. Expression-bodied
 * arrows and named reducer functions are exempt. There is no fix.
 */

export const noInlineBlockReducerRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "A reduce whose reducer is written inline with a block body is a loop.",
      examples: [
        {
          before:
            "const best = rows.reduce<Row | undefined>((best, row) => {\n  if (best === undefined) return row;\n  return row.score > best.score ? row : best;\n}, undefined);",
          after:
            "let best: Row | undefined;\nfor (const row of rows) if (best === undefined || row.score > best.score) best = row;",
        },
        {
          before:
            "const billed = solves.reduce((total, solve) => {\n  const dollars = solve.billed ?? 0;\n  return total + dollars;\n}, 0);",
          after: "let billed = 0;\nfor (const solve of solves) billed += solve.billed ?? 0;",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      hiddenLoop:
        "This `reduce` carries its whole step inline as a block, which is a loop with the accumulator hidden in the callback signature. Write the `for…of` and let the accumulator be an ordinary local, or lift the step out under a name.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        // `<something>.reduce(...)`, with or without an explicit type argument.
        const { callee } = node;
        if (!isNamedMember(callee) || identifierName(callee.property) !== "reduce") return;
        const [reducer] = node.arguments;
        if (reducer === undefined) return;
        if (reducer.type !== "ArrowFunctionExpression" && reducer.type !== "FunctionExpression") return;
        const { body } = reducer;
        if (body?.type !== "BlockStatement") return;
        context.report({ node, messageId: "hiddenLoop" });
      },
    };
  },
});
