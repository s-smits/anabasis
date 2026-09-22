import { defineRule, type ESTree } from "@oxlint/plugins";

import { isOneOf, isUnder } from "../shared/file-role.ts";
import { importTracker } from "../shared/import-fix.ts";

/**
 * `cause instanceof Error ? cause.message : String(cause)` was written 88 times in this tree, and
 * `src/meta/runtime-values.ts` has held `errorMessage` — the same three terms, once — the whole
 * time. Ninety-one copies of one decision is not a style question: the decision is what a caught
 * value looks like to an operator, and a repository that spells it in 63 files cannot change it.
 * A non-Error cause that should read as `unreadable value` rather than `[object Object]` is one
 * edit at the owner and 88 edits everywhere else.
 *
 * Two shapes, two owners. The ternary above is `errorMessage(cause)`, which returns text. The
 * other, `cause instanceof Error ? cause : new Error(String(cause))`, is `asError(cause)`, which
 * returns an Error so a stack and a `cause` chain survive; it was written ten times.
 *
 * It fixes both, and the reason it once did not has gone: the fix needs an import, and
 * `shared/import-fix.ts` places one. That the expression and the import land together is the
 * whole of it — a rewrite that left the name undefined would be worse than the report — so the
 * import edit rides on every diagnostic rather than the first, because oxlint drops a fix
 * overlapping one it has already applied and a single carrier is lost exactly when it is the
 * one dropped.
 *
 * Two trees are outside it. `packages/ui` builds a browser bundle, and the owner sits beside
 * `src/meta/process.ts` in a module that bundle should not pull in; its nine sites stay hand
 * spelled. `starters/` is a Builder-visible template with its own module graph, which may not
 * reach into `src/` at all.
 *
 * The rule reads the subject as source text, so `result.error instanceof Error ?
 * result.error.message : String(result.error)` is caught as readily as a bare identifier, and
 * any mismatch between the three mentions leaves the expression alone: a ternary reading one
 * value and rendering another is doing something this rule has no opinion about. Only a bare
 * identifier is rewritten; any other subject is reported and left for a hand edit.
 */
/** The module that owns what a caught value reads as, and so the one file that spells it out. */
const OWNER = "src/meta/runtime-values.ts";

export const noHandRolledErrorRenderRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: { description: "Render a caught value through errorMessage or asError, which own that decision." },
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
      if (node.type !== "CallExpression" || node.arguments.length !== 1) return false;
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
      before: () =>
        !isOneOf(context.filename, [OWNER]) &&
        !isUnder(context.filename, "packages/ui") &&
        !isUnder(context.filename, "starters"),

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
