import { defineRule, type ESTree } from "@oxlint/plugins";
import { inlineFunctionArgument } from "../shared/statements.ts";

/**
 * `await new Promise((resolve) => setTimeout(resolve, 50))` is a guess about how long something
 * else takes. It is the shape the working contract argues with in two separate places — "start
 * one background monitor that exits on the real condition" for a watch, and the test wrapper's
 * output-idle wall rather than a fixed pause for a suite — and the shape a simplify pass cut
 * out of a test in `1acfef45`.
 *
 * Three replacements, in the order to try them. A test waiting for its own producer wants
 * `Promise.withResolvers()` and a resolve at the point the producer finishes, which is exact and
 * instant. A test waiting for a file or a process wants a poll on that condition with a
 * deadline, so it fails saying what never happened rather than failing a millisecond late on a
 * loaded machine. Production code waiting for a real clock wants `Bun.sleep`, which says so.
 *
 * The shape is exact: the executor's whole body is `setTimeout(resolve, …)`, passing its own
 * settle parameter to the timer and nothing else. Measured on 2026-09-20 over 20 sites, where
 * a looser reading owned nine of them.
 *
 * When the timer's callback does work instead of being `resolve`, the promise settles on that
 * work rather than on the clock. `setTimeout(() => { controller.abort(); resolve(null); }, ms)`
 * is a deadline and `setTimeout(() => { try { draft.setValue(…); } catch …}, 0)` defers a call
 * past the current task to prove a lease has ended. Neither waits a guessed interval.
 *
 * When the executor does more than that one call, the wait can end early, which is the thing
 * this rule asks for. Every `Promise.race` deadline in the tree keeps its handle in an outer
 * `timer` so a `finally` can clear it, and `turn-retry.ts` adds an `abort` listener that
 * resolves the wait when a stop arrives. An assignment is not a bare call, so both fall out of
 * the shape without a second test.
 *
 * A named helper around the shape is caught at the helper, once, which is the right number of
 * reports. `Bun.sleep` and a bare `setTimeout` scheduling real work are both invisible to it,
 * because neither is a wait.
 *
 * There is no fix. Every one of the three answers needs to know what the site is
 * waiting for, and that is not in the expression — though all eleven sites it kept took the
 * third. Six simulated latency inside a stub, two were a retry backoff, and three asserted that
 * a poller had *not* read again within 25 ms. The first two answers need a condition to wait on,
 * and an assertion about absence has none: a real clock is what those tests measure.
 */
export const noHandRolledSleepRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "A fixed pause is a guess; wait on the condition or use Bun.sleep." },
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
