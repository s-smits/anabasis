import { defineRule } from "@oxlint/plugins";
import { relative, resolve } from "#src/meta/path.ts";
import {
  COMMENT_RATCHET_FILE,
  isExemptComment,
  isRuleSourcePath,
  loadCommentRatchet,
} from "../../comment-ratchet.ts";
import type { RuleExample } from "../../rule-examples.ts";

/**
 * Bans prose comments (line, block, and JSDoc) outside machine-enforced comments (`SAFETY:`,
 * lint/formatter/TS directives, empty-catch comments, shebangs, and rule `no fix` declarations),
 * using `tools/oxlint/comment-ratchet.tsv` as a per-file decreasing ceiling. There is no fix.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const RATCHET = loadCommentRatchet(REPO_ROOT);

export const noCommentsRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Ban prose comments outside machine-enforced markers, enforcing a decreasing per-file ratchet.",
      examples: [
        {
          before: "// Compute the total score.\nexport const total = (a: number, b: number) => a + b;",
          after: "export const total = (a: number, b: number) => a + b;",
        },
        {
          before: "/** Sum two numbers. */\nexport const sum = (a: number, b: number) => a + b;",
          after: "export const sum = (a: number, b: number) => a + b;",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      bannedComment:
        "Prose comments are banned in this file. Delete tautologies and stale notes, log excuses in docs/backlog/comment-excuses.md, or move real decisions into docs/adr/.",
      aboveRatchet:
        "File has {{actual}} non-exempt comments, exceeding its ratchet ceiling of {{ceiling}} in {{ratchet}}. Remove the added comment(s) or use /delete-comment.",
      staleRatchet:
        "File now has {{actual}} non-exempt comments, below its ratchet ceiling of {{ceiling}} in {{ratchet}}. Tighten the ratchet with `bun .claude/skills/delete-comment/scripts/ratchet.ts --write`.",
    },
  },
  createOnce(context) {
    const emptyCatchRanges: { readonly start: number; readonly end: number }[] = [];

    return {
      before: () => {
        emptyCatchRanges.length = 0;
        return true;
      },

      CatchClause(node) {
        if (node.body.body.length === 0) {
          emptyCatchRanges.push({ start: node.body.start, end: node.body.end });
        }
      },

      "Program:exit"(program) {
        const candidate = relative(REPO_ROOT, resolve(context.filename)).replaceAll("\\", "/");
        const path = candidate.startsWith("../") || candidate === ".." ? "" : candidate;
        const fileRole = isRuleSourcePath(path) ? "rule" : "other";
        const ceiling = path === "" ? 0 : (RATCHET.get(path) ?? 0);
        const nonExempt = context.sourceCode.getAllComments().filter((comment) => {
          const insideEmptyCatch = emptyCatchRanges.some(
            (range) => comment.start >= range.start && comment.end <= range.end,
          );
          const placement =
            comment.type === "Shebang" ? "shebang" : insideEmptyCatch ? "empty-catch" : "normal";
          return !isExemptComment({ value: comment.value, placement, fileRole });
        });

        if (ceiling === 0) {
          for (const comment of nonExempt) {
            context.report({ node: comment, messageId: "bannedComment" });
          }
          return;
        }

        if (nonExempt.length > ceiling) {
          for (const comment of nonExempt.slice(ceiling)) {
            context.report({
              node: comment,
              messageId: "aboveRatchet",
              data: {
                actual: String(nonExempt.length),
                ceiling: String(ceiling),
                ratchet: COMMENT_RATCHET_FILE,
              },
            });
          }
          return;
        }

        if (nonExempt.length < ceiling) {
          context.report({
            node: program,
            messageId: "staleRatchet",
            data: {
              actual: String(nonExempt.length),
              ceiling: String(ceiling),
              ratchet: COMMENT_RATCHET_FILE,
            },
          });
        }
      },
    };
  },
});
