import { defineRule } from "@oxlint/plugins";
import { mutatingCall } from "../shared/predicate-effect.ts";

/**
 * A one-line guard that writes into a value something else built, reached through `?.`:
 *
 *     if (kind === "task.state" && data.state === "released") builds.at(-1)?.practice.add(version);
 *
 * The line patches a fold from the side. The fold that built `builds` decided what a session's
 * practice is; this line adds a second answer under a second event's guard, and the optional chain
 * hides the case where there is nothing to patch. On 20 October a pull request read a session's
 * practice this way, beside a kernel fold (`practiceRan`) that already answered it; rewriting the
 * owner instead removed the field, its two writers and the guard, and matched the record on every
 * led session where the patch had counted 212 solves for 24.
 *
 * The shape is narrow on purpose, so that a reader can act on every report: an `if` with no `else`
 * whose test holds a string-literal comparison, and whose whole body is one call of a mutating
 * method (`shared/predicate-effect.ts` names the six) through an optional chain. A write without
 * `?.` to a value the function holds itself is ordinary work and is not read.
 *
 * There is no fix: the repair is the owner's, and which owner that is cannot be read off the line.
 */
export const noPatchThroughOptionalChainRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "A one-line guard that mutates through `?.` patches another fold; fix its owner." },
    messages: {
      patch:
        "This guard calls `.{{mutation}}()` through `?.` on a value built elsewhere, so it patches that value's fold from the side. Fix the owner that builds it, or read the fact from the fold that already owns it.",
    },
  },
  createOnce(context) {
    return {
      IfStatement(node) {
        if (node.alternate !== null) return;
        const body =
          node.consequent.type === "BlockStatement" && node.consequent.body.length === 1
            ? node.consequent.body[0]
            : node.consequent;
        if (body?.type !== "ExpressionStatement" || body.expression.type !== "ChainExpression") return;
        const call = body.expression.expression;
        if (call.type !== "CallExpression" || call.callee.type !== "MemberExpression") return;
        const mutation = mutatingCall(`.${context.sourceCode.getText(call.callee.property)}(`);
        if (
          mutation === null ||
          !/[=!]==?\s*["'`]|["'`]\s*[=!]==?/u.test(context.sourceCode.getText(node.test))
        ) {
          return;
        }
        context.report({ node, messageId: "patch", data: { mutation } });
      },
    };
  },
});
