import { defineRule } from "@oxlint/plugins";

import { isGlobalReflectMethodCall } from "../shared/reflect-method.ts";

/**
 * A call to the global `Reflect.apply`.
 *
 * `fn(...args)` is checked: the compiler knows the parameter list and the return type, and it
 * says so when the call does not fit. `Reflect.apply(fn, thisArg, args)` is the same call with
 * that conversation removed — the arguments arrive as an array the signature never sees, and the
 * result arrives as whatever the reflection is declared to give back. It is reached for when the
 * function being called is not known statically, which is exactly the case where losing the check
 * costs most.
 *
 * The receiver has to be the global: `isGlobalReflect` accepts `Reflect` only where the scope
 * chain has no binding of that name, so a local `Reflect` the file declared is its own object and
 * is left alone. Computed access is read too, because `Reflect["apply"](…)` is the same call.
 *
 * There is no fix: the repair is a direct call, or an interface for the dispatch that needed
 * reflection; swapping the spelling would keep the dispatch and lose the finding.
 */
export const noReflectApplyRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Reflect.apply; call typed functions directly or model dynamic dispatch behind an interface.",
    },
    messages: {
      reflectApply:
        "Replace `Reflect.apply` with a typed function call. Model dynamic dispatch behind a named interface.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        if (isGlobalReflectMethodCall(context.sourceCode, node.callee, "apply")) {
          context.report({ node, messageId: "reflectApply" });
        }
      },
    };
  },
});
