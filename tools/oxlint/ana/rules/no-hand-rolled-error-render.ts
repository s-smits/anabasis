import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";

import { isOneOf, isUnder } from "../shared/file-role.ts";
import { importTracker } from "../shared/import-fix.ts";
import { isOneArgumentCall } from "../shared/statements.ts";

/**
 * Flags hand-rolled caught-error rendering (`cause instanceof Error ? cause.message :
 * String(cause)` and `cause instanceof Error ? cause : new Error(String(cause))`) outside
 * `src/meta/runtime-values.ts` and `packages/ui`, rewriting a bare identifier subject to
 * `errorMessage(cause)` or `asError(cause)` and reporting complex ones.
 */
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

    function instanceofSubject(test: ESTree.Expression): string | null {
      if (test.type !== "BinaryExpression" || test.operator !== "instanceof") return null;
      if (test.right.type !== "Identifier" || test.right.name !== "Error") return null;
      return context.sourceCode.getText(test.left);
    }

    function rendersSubject(node: ESTree.Expression, subject: string): boolean {
      if (!isOneArgumentCall(node)) return false;
      if (node.callee.type !== "Identifier") return false;
      if (node.callee.name !== "String" && node.callee.name !== "errorMessage") return false;
      return context.sourceCode.getText(node.arguments[0]) === subject;
    }

    /**
     * Only a plain name moves: `load() instanceof Error ? …` calls `load` again for the message,
     * and a member may be a getter answering differently each time, which the rewrite would quietly
     * change.
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
