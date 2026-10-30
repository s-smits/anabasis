# 12. Code that passes the first time, and 13. Writing

Read this before you write code (section 12) or prose of record: a commit, a pull request, a comment,
a prompt or a message to the operator (section 13). It holds `AGENTS.md` sections 12 and 13 in full:
the dependency direction and the ledger's use, and the writing rules in their long form. Run
`scripts/preflight.ts` for the size and prose findings a regex can see.

## 12. Code that passes the first time

`tools/oxlint/HABITS.md` holds the habits that prevent lint findings, the `src/meta` owners, the
size policy and how to write a test. Read it whole before writing the first line of code; a change
that writes no code can skip it. Whatever you write:

- The CI gate runs the lint strict. Add no finding, and give the strict count in the pull request.
- Never turn a rule off: no new `"off"` in `.oxlintrc.json` and no `oxlint-disable` comment for a
  plugin rule. A finding wrong about a site is answered in the ledger, or the rule is tuned in a
  change whose subject is the lint.
- Reuse before you derive: find the production owner that already reads a fact and call it (rule
  12). Dependencies run one way. Production is `src/`, `vendor/`, `packages/` and the commands
  under `tools/`; helper code is `.claude/`, `tools/wri/` and `studies/`. A helper imports and wraps
  production readers, and production never imports a helper: a fact production needs moves into a
  production owner.
- A test checks the facts a message carries (an outcome, a count, a limit) and what the wall keeps
  out of it, by its absence, never how it is worded. A prompt's sentence is checked by reading the
  composed prompt.

## 13. Writing

Plain, understated British English in commits, pull requests, comments, prompts and messages to the
operator: simple academic prose (a clear question, a concrete mechanism, evidence and its limits)
for a careful colleague who has not read the conversation.

- Lead with the change and the plain verb a person would say ("This PR fixes…", "Adds…",
  "Removes…"), and say what a thing is rather than fold a negation into it: "Hide seeded campaigns",
  "one owner instead of five".
- State what changed and what remains with exact results and the axis named ("12 cases passed, 0
  failed", "1,281 of 1,386 programs"). No "robust", "bulletproof" or "10x", no celebration, no
  emoji, no exclamation marks, no em dashes. Identifiers, paths and commands go in inline code.
- State a limit early, and name the owner of a decision. Explain why a mechanism matters before
  naming its files, in ML terms where they clarify (practice as training exposure, held-out
  comparisons as evaluation); infrastructure work says what it enables and implies no gain.
- Keep tests, recorded observations, estimates and uncertainty apart: one simulation is one
  observation, an estimated saving no measured reduction. Keep counts, baselines and limits when
  rewriting, and attribute earlier checks to their commit and runner.
- Scale the structure to the change, with no authorship labels or stock closing claims;
  `stack-pr` section 7 owns a pull request's title and body.
- Use the terms of section 14, each with one meaning, and suffix an ambiguous name with what it
  belongs to: "the Builder session b-2", "comparison g2".
- A head comment is the module's manual: why the code is as it is, the defect it answers, the record
  that showed it, and the date. Keep it true in the change that alters the code.
- A prompt states facts and limits once, where they belong (system prompt, opening message, tool
  result); a recurring interface failure is fixed in the schema or the tool, not with a sentence.
- Dates are absolute ("9 October"). `AGENTS.md` and the skills say how things are now; history goes
  to the commit, the pull request and the head comment.

