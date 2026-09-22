import { defineRule } from "@oxlint/plugins";

/**
 * `// oxlint-disable-next-line anti-slop/no-runtime-typeof` answers a slop finding in the one
 * store oxlint offers, and it is the weaker of the two this repository has.
 *
 * The comment is keyed by where it sits, not by what it excuses. An edit to the line below it keeps
 * the comment, so an answer given about one expression goes on excusing whatever is later written
 * there. And nothing asks it for a reason: thirty-one of the forty in the tree on 2026-09-21 had
 * none, and read as a record that someone was silenced rather than why.
 *
 * `tools/oxlint/not-slop.tsv` keys an answer by the rule and the text of the line it judged, needs a
 * reason a reviewer can check, and returns the finding for a fresh answer when the line changes.
 * `bun run lint` prints the id beside every heuristic finding and `bun run not-slop -- answer`
 * writes the row. So an `ana/` or `anti-slop/` rule has one store for its answers, and this rule
 * keeps it the only one.
 *
 * A core oxlint rule keeps its inline comment: it is a correctness rule rather than a heuristic,
 * and its exception is a fact about the code that belongs beside it. `oxlint-enable` is not
 * reported, since it answers nothing; it goes with the disable it closes.
 *
 * There is no fix. The comment's reason moves into a ledger row, which needs an id only a lint run
 * computes and a sentence only the author can check.
 */

/** A directive at the start of a comment, and the rule list before any ` -- reason`. */
const DIRECTIVE = /^\s*(?:oxlint|eslint)-disable(?:-next-line|-line)?\s+(?<rules>.*?)(?:\s+--\s.*)?$/su;

/** A rule in that list from one of the two plugins the ledger answers for. */
const SLOP_RULE = /(?:^|[\s,])(?<rule>(?:ana|anti-slop)\/[\w-]+)/gu;

export const noInlineSlopAnswerRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Answer an ana or anti-slop finding in tools/oxlint/not-slop.tsv, not in a disable comment.",
    },
    messages: {
      inlineAnswer:
        '{{rules}} answered by a disable comment, which outlives an edit to the line it excuses. Remove it, run bun run lint for the finding\'s id, and answer it with bun run not-slop -- answer <id> "<why>".',
    },
  },
  createOnce(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const rules = DIRECTIVE.exec(comment.value)?.groups?.rules ?? "";
          const named = [...rules.matchAll(SLOP_RULE)].map((match) => match.groups?.rule ?? "");
          if (named.length === 0) continue;
          context.report({ node: comment, messageId: "inlineAnswer", data: { rules: named.join(", ") } });
        }
      },
    };
  },
});
