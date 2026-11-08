# 12. Code that passes the first time, and 13. Writing

Read this for the reasons behind `AGENTS.md` sections 12 and 13; `scripts/preflight.ts` reports the
size and prose patterns it can detect.

## 12. Code that passes the first time

`tools/oxlint/HABITS.md` holds the habits, the `src/meta` owners, the size policy and how to write a
test; a change that writes no code can skip it.

- Never turn a rule off: no new `"off"` in `.oxlintrc.json` and no `oxlint-disable` for a plugin
  rule. A finding wrong about a site goes in the ledger, or the rule is tuned in a change about the
  lint.
- Dependencies run one way because production must stay readable without the tooling around it.
  Production is `src/`, `vendor/`, `packages/` and `tools/` outside `tools/wri/`; a fact production
  needs from a helper moves into a production owner.
- A test checks the facts a message carries (an outcome, a count, a limit) and the wall's exclusions
  by their absence, because wording changes freely. A prompt's sentence is checked by reading the
  composed prompt.

## 13. Writing

The register is simple academic prose: a clear question, a concrete mechanism, evidence and its
limits, with ML terms where they clarify (practice as training exposure, held-out comparisons as
evaluation). Additions to section 13:

- Write "one owner instead of five" rather than a negation and its correction; infrastructure work
  says what it enables and implies no gain.
- One simulation is one observation, and an estimated saving is not a measured reduction. Keep
  counts, baselines and limits when rewriting, and attribute earlier checks to their commit and
  runner.
- No authorship labels or stock closing claims; `stack-pr` section 7 owns a pull request's text.
- A head comment is the module's manual: why the code is so, the defect it answers, the record that
  showed it and the date, kept true by the change that alters the code.
- A prompt fact lives in one surface (system prompt, opening message or tool result), because a fact
  stated twice drifts apart.
