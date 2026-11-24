import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";

import { isOneOf, isUnder } from "../shared/file-role.ts";
import { importTracker } from "../shared/import-fix.ts";
import { isOneArgumentCall } from "../shared/statements.ts";

/**
 * Flags hand-rolled caught-error rendering (`cause instanceof Error ? cause.message : String(cause)`
 * and `cause instanceof Error ? cause : new Error(String(cause))`) outside `src/meta/runtime-values.ts`
 * and `packages/ui`, replacing them with `errorMessage(cause)` and `asError(cause)` from
 * `src/meta/runtime-values.ts`. Auto-fixes bare identifier subjects and reports complex subjects.
 */
/** The module that owns what a caught value reads as, and so the one file that spells it out. */
const OWNER = "src/meta/runtime-values.ts";

export const noHandRolledErrorRenderRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: {
      description: "Render a caught value through errorMessage or asError, which own that decision.",
      examples: [
        {
          before: "const reason = cause instanceof Error ? cause.message : String(cause);",
          after:
            'import { errorMessage } from "#src/meta/runtime-values.ts";\n\nconst reason = errorMessage(cause);',
        },
        {
          before: "throw cause instanceof Error ? cause : new Error(String(cause));",
          after: 'import { asError } from "#src/meta/runtime-values.ts";\n\nthrow asError(cause);',
        },
      ] satisfies RuleExample[],
    },
    messages: {
      handRolled:
        "`{{subject}} instanceof Error ? …` is `{{owner}}({{subject}})`. `src/meta/runtime-values.ts` owns what a caught value reads as, so that decision is made once rather than in every catch.",
    },
  },
  createOnce(context) {
    const imports = importTracker("runtime-values.ts", OWNER);

    /** The subject of `X instanceof Error`, as source text, or null when the test is not that. */
    function instanceofSubject(test: ESTree.Expression): string | null {
      if (test.type !== "BinaryExpression" || test.operator !== "instanceof") return null;
      if (test.right.type !== "Identifier" || test.right.name !== "Error") return null;
      return context.sourceCode.getText(test.left);
    }

    /** `String(x)`, or `errorMessage(x)` inside a `new Error(…)`, over the same subject. */
    function rendersSubject(node: ESTree.Expression, subject: string): boolean {
      if (!isOneArgumentCall(node)) return false;
      if (node.callee.type !== "Identifier") return false;
      if (node.callee.name !== "String" && node.callee.name !== "errorMessage") return false;
      return context.sourceCode.getText(node.arguments[0]) === subject;
    }

    /**
     * Both shapes are reported the same way: name the owner, rewrite to it, and import it. The
     * hand-rolled form reads its subject two or three times and the owner once, so only a plain
     * name moves; `load() instanceof Error ? …` calls `load` again for the message, and a member
     * may be a getter answering differently each time, which the rewrite would quietly change.
     */
    function reportAs(node: ESTree.ConditionalExpression, subject: string, owner: string): void {
      const report = { node, messageId: "handRolled", data: { subject, owner } };
      const stable = node.test.type === "BinaryExpression" && node.test.left.type === "Identifier";
      if (!stable) {
        context.report(report);
        return;
      }
      context.report({
        ...report,
        fix: (fixer) => [
          fixer.replaceText(node, `${owner}(${subject})`),
          imports.fix(fixer, owner, context.filename),
        ],
      });
    }

    return {
      // The owner spells both shapes itself, which is the point of it.
      before: () => !isOneOf(context.filename, [OWNER]) && !isUnder(context.filename, "packages/ui"),

      Program: (node) => imports.read(node),

      ConditionalExpression(node) {
        const subject = instanceofSubject(node.test);
        if (subject === null) return;
        const consequent = context.sourceCode.getText(node.consequent);

        if (consequent === `${subject}.message` && rendersSubject(node.alternate, subject)) {
          reportAs(node, subject, "errorMessage");
          return;
        }

        const { alternate } = node;
        if (alternate.type !== "NewExpression") return;
        const [argument] = alternate.arguments;
        const rebuilt =
          alternate.callee.type === "Identifier" &&
          alternate.callee.name === "Error" &&
          alternate.arguments.length === 1 &&
          argument !== undefined &&
          argument.type !== "SpreadElement" &&
          rendersSubject(argument, subject);
        if (consequent === subject && rebuilt) reportAs(node, subject, "asError");
      },
    };
  },
});
