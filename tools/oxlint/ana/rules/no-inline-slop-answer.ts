import { defineRule } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";

/**
 * Flags inline `oxlint-disable` / `eslint-disable` comments that silence an `ana/*` or
 * `anti-slop/*` rule (or name no rule at all), requiring heuristic findings to be answered in
 * `tools/oxlint/not-slop.tsv` via `bun run not-slop -- answer <id> "<why>"`. Core oxlint rule
 * disables are exempt. There is no fix.
 */

/** A directive at the start of a comment, and the rule list before any ` -- reason`. */
const DIRECTIVE =
  /^\s*(?:oxlint|eslint)-disable(?:-next-line|-line)?(?:\s+(?<rules>(?!--\s).*?))?(?:\s+--\s.*)?\s*$/su;

/** A rule in that list from one of the two plugins the ledger answers for. */
const SLOP_RULE = /(?:^|[\s,])(?<rule>(?:ana|anti-slop)\/[\w-]+)/gu;

export const noInlineSlopAnswerRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Answer an ana or anti-slop finding in tools/oxlint/not-slop.tsv, not in a disable comment.",
      examples: [
        {
          before:
            '// oxlint-disable-next-line anti-slop/no-runtime-typeof\nconst named = isString(value) ? value : "unnamed";',
          after: 'const named = isString(value) ? value : "unnamed";',
        },
        {
          before: "// oxlint-disable-next-line\nfor (const solve of solves) await settle(solve);",
          after:
            "// oxlint-disable-next-line no-await-in-loop -- each solve settles before the next starts\nfor (const solve of solves) await settle(solve);",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      inlineAnswer:
        '{{rules}} answered by a disable comment, which outlives an edit to the line it excuses. Remove it, run bun run lint for the finding\'s id, and answer it with bun run not-slop -- answer <id> "<why>".',
      everyRule:
        'A disable comment that names no rule silences every rule, the ana and anti-slop ones among them. Name the core rule it answers, and answer a slop finding with bun run not-slop -- answer <id> "<why>".',
    },
  },
  createOnce(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const directive = DIRECTIVE.exec(comment.value);
          if (directive === null) continue;
          const rules = directive.groups?.rules ?? "";
          if (rules.trim() === "") {
            context.report({ node: comment, messageId: "everyRule" });
            continue;
          }
          const named = [...rules.matchAll(SLOP_RULE)].map((match) => match.groups?.rule ?? "");
          if (named.length === 0) continue;
          context.report({ node: comment, messageId: "inlineAnswer", data: { rules: named.join(", ") } });
        }
      },
    };
  },
});
