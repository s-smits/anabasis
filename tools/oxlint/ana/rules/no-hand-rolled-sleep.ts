import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { inlineFunctionArgument } from "../shared/statements.ts";

/**
 * Flags `new Promise((resolve) => setTimeout(resolve, ms))` where the executor's sole statement
 * passes its `resolve` parameter directly to `setTimeout`. Callers should wait on the condition
 * (`Promise.withResolvers()` or a bounded poll) or call `Bun.sleep` for an intentional clock wait.
 * There is no fix.
 */
export const noHandRolledSleepRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "A fixed pause is a guess; wait on the condition or use Bun.sleep.",
      examples: [
        {
          before: "await new Promise((resolve) => setTimeout(resolve, resetAt - Date.now()));",
          after: "await Bun.sleep(resetAt - Date.now());",
        },
        {
          before:
            "worker.start();\nawait new Promise((resolve) => setTimeout(resolve, 50));\nexpect(worker.ready).toBe(true);",
          after:
            "const ready = Promise.withResolvers<void>();\nworker.start(() => ready.resolve());\nawait ready.promise;",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      fixedPause:
        "`new Promise((resolve) => setTimeout(resolve, …))` waits a guessed number of milliseconds. Wait on the condition — `Promise.withResolvers()` at the producer, or a poll with a deadline — or say it is a real clock with `Bun.sleep`.",
    },
  },
  createOnce(context) {
    /** The one expression an executor body is, or null when it holds anything more than that. */
    function only(body: ESTree.FunctionBody | ESTree.Expression): ESTree.Expression | null {
      if (body.type !== "BlockStatement") return body;
      const [statement] = body.body;
      if (body.body.length !== 1 || statement?.type !== "ExpressionStatement") return null;
      return statement.expression;
    }

    return {
      NewExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "Promise") return;
        const executor = inlineFunctionArgument(node);
        if (executor === null) return;
        const call = only(executor.body);
        if (call?.type !== "CallExpression") return;
        if (call.callee.type !== "Identifier" || call.callee.name !== "setTimeout") return;
        const [callback] = call.arguments;
        if (callback?.type !== "Identifier") return;
        const settles = executor.params.some(
          (parameter) => parameter.type === "Identifier" && parameter.name === callback.name,
        );
        if (settles) context.report({ node, messageId: "fixedPause" });
      },
    };
  },
});
