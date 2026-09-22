import { defineRule } from "@oxlint/plugins";
import { isOneOf, isUnder } from "../shared/file-role.ts";
import { importTracker } from "../shared/import-fix.ts";

/** Ambient global -> the binding that captured it, and what else a reader should consider. */
const CAPTURED = new Map([
  [
    "JSON.parse",
    { binding: "capturedJsonParse", advice: ", or parseJsonAs<T> when the bytes have a declared contract" },
  ],
  ["JSON.stringify", { binding: "capturedJsonStringify", advice: "" }],
  ["structuredClone", { binding: "capturedStructuredClone", advice: "" }],
]);

/** The module that captures them, and so the one file that must reach the ambient global. */
const MODULE = "src/meta/json-runtime.ts";
const OWNER = [MODULE];

/**
 * `src/meta/json-runtime.ts` binds `JSON.parse`, `JSON.stringify` and `structuredClone` at load,
 * before any generated module has run. The controller loads Builder-authored and Built-authored
 * modules into its own process, and a module that replaces `JSON` afterwards changes what every
 * later reader sees: a case record, a claim digest, a submitted artifact. The captured binding is
 * the one that cannot be moved out from under a reader.
 *
 * The owner's own note records that this was swept by hand once, across 148 call sites. A sweep
 * holds until the next call site arrives, which is what this rule is for.
 *
 * The fix renames the call and imports the binding. `capturedJsonParse` returns `JsonValue` where
 * the global returned `any`, so a caller that relied on the widening stops compiling and picks
 * `parseJsonAs<T>` by hand. That is the intended remainder: a fix that cannot be silently wrong
 * is worth more than one that covers every site.
 */
export const requireCapturedJsonRuntimeRule = defineRule({
  meta: {
    type: "problem",
    fixable: "code",
    docs: {
      description:
        "Read and write JSON through the captured bindings in src/meta/json-runtime.ts, not the ambient globals.",
    },
    messages: {
      ambient:
        "`{{global}}` is the ambient global, which a generated module loaded into this process can replace. Import {{binding}}{{advice}} from src/meta/json-runtime.ts, which captured it before any generated module ran.",
    },
  },
  createOnce(context) {
    const imports = importTracker("json-runtime.ts", MODULE);
    return {
      // The controller's own process. A dev-time reporter under tools/ loads no generated module,
      // so the global it reaches cannot have been replaced.
      before: () =>
        (isUnder(context.filename, "src") || isUnder(context.filename, "vendor")) &&
        !isOneOf(context.filename, OWNER),

      Program: (node) => imports.read(node),

      CallExpression(node) {
        const { callee } = node;
        const spelled =
          callee.type === "Identifier"
            ? callee.name
            : callee.type === "MemberExpression" &&
                callee.object.type === "Identifier" &&
                callee.property.type === "Identifier" &&
                !callee.computed
              ? `${callee.object.name}.${callee.property.name}`
              : "";
        const captured = CAPTURED.get(spelled);
        if (captured === undefined) return;
        context.report({
          node: callee,
          messageId: "ambient",
          data: { global: spelled, binding: captured.binding, advice: captured.advice },
          fix: (fixer) => [
            fixer.replaceText(callee, captured.binding),
            imports.fix(fixer, captured.binding, context.filename),
          ],
        });
      },
    };
  },
});
