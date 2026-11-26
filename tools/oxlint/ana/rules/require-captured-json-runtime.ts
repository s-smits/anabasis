import { defineRule } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { isOneOf, isUnder } from "../shared/file-role.ts";
import { importTracker } from "../shared/import-fix.ts";

const CAPTURED = new Map([
  [
    "JSON.parse",
    { binding: "capturedJsonParse", advice: ", or parseJsonAs<T> when the bytes have a declared contract" },
  ],
  ["JSON.stringify", { binding: "capturedJsonStringify", advice: "" }],
]);

const MODULE = "src/meta/json-runtime.ts";
const OWNER = [MODULE];

/**
 * Requires `src/` and `vendor/` modules (outside `src/meta/json-runtime.ts`) to call
 * `capturedJsonParse` / `parseJsonAs<T>` and `capturedJsonStringify` instead of ambient
 * `JSON.parse` (`any`) and `JSON.stringify`. Auto-fixes the call and adds the import.
 */
export const requireCapturedJsonRuntimeRule = defineRule({
  meta: {
    type: "problem",
    fixable: "code",
    docs: {
      description:
        "Read and write JSON through the captured bindings in src/meta/json-runtime.ts, not the ambient globals.",
      examples: [
        {
          before: "const event = JSON.parse(line);",
          after:
            'import { capturedJsonParse } from "./meta/json-runtime.ts";\nconst event = capturedJsonParse(line);',
        },
        {
          before: "const line = `${JSON.stringify(event)}\\n`;",
          after:
            'import { capturedJsonStringify } from "./meta/json-runtime.ts";\nconst line = `${capturedJsonStringify(event)}\\n`;',
        },
      ] satisfies RuleExample[],
    },
    messages: {
      ambient:
        "`{{global}}` is the ambient global, which a generated module loaded into this process can replace. Import {{binding}}{{advice}} from src/meta/json-runtime.ts, which captured it before any generated module ran.",
    },
  },
  createOnce(context) {
    const imports = importTracker("json-runtime.ts", MODULE);
    return {
      // A dev-time reporter under tools/ loads no generated module, so the global it reaches cannot
      // have been replaced.
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
