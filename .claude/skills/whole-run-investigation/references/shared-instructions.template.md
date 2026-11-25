<!--
The shared instructions distributed in full to every open lane. `wri.ts start` populates each
campaign's row; complete the three AUTHOR sections before running `wri.ts lanes`. HTML comments are
stripped from rendered prompts, any blank `##` section causes `lanes` to fail, and deleting a
heading omits that section intentionally. An isolated lane receives only the campaign rows and the
hard rules.
-->

## Orientation

<!-- AUTHOR: state the operator's question in your own words and point to where the relevant
evidence resides. Name the question only, never the expected answer. Keep within roughly twenty
lines and quote nothing from the log. -->

## The moved variable and prior state

<!-- AUTHOR: describe what changed between these campaigns and prior ones, and between the campaigns
under review (checker, host code, model, or seat prompt), together with earlier findings to recheck
and what would falsify each. For every change introduced since the parent run, specify its trigger
in a log and the event its mechanism emits so lanes can count both. Record any earlier diagnosis as
a falsifiable hypothesis rather than a fact. Write "none" if nothing changed. -->

## Already read by the primary

<!-- AUTHOR: list checks already completed, one line per item with supporting evidence (a count, a
source line, or a mechanism), so lanes can build on or refute them. Never state the conclusion a
lane should reach. Separately, under an unread note, flag any anomaly noticed but not pursued (an
out-of-order event, a shifted count, or an unusually large file) by location only, without
interpreting it: lanes are free to investigate it. Write "nothing" if no checks have been run yet. -->

## Campaigns under review

{campaigns}

Each log is its campaign's complete append-only record, stored as one JSON event per line. Each campaign directory also contains the staged check program (`exams/<digest>/checks/`; `checks/` in an older campaign over a stored pack), `states/` holding every saved checkpoint snapshot by digest, and each launch's receipt `launch-run-<n>.json` (older rounds wrote `launch-<session>.json`) recording flags, commit, and host load. Read any of these files; modify none of them.

## Hard rules

- Quote nothing protected by the evaluation boundary: no task text, submitted answer, hidden value, check failure message, prompt text, trace excerpt, or Auditor prose. Cite event kinds, solve ids, the first eight characters of a digest, check ids, counts, file paths, and line numbers, and summarise mechanisms in your own words.
- Never write inside a campaign directory or append to a log, and never run a command whose working directory lies inside a campaign directory. Place scratch files in a temporary directory of your own.
- Start no solve, Builder or Examiner session, round, or check run. `wri.ts grade` is the sole exception, permitted only where your lane explicitly specifies it; it writes nothing to disk.
- Open each lane's report with its heading and `Verdict: pending` before reading evidence for that lane, then update the verdict line and append findings as they settle. Work through your assigned lanes one at a time.
- For a `no finding` verdict, leave `## Findings` empty and document under `## Checked` what you verified and found sound, using plain sentences without `Observation:`, `Cause:`, `Owner:`, `Reverses if:`, or `Decision:` lines.
- Never open another lane's prompt or report, or any synthesis document for this investigation.
- Run repository commands (`bun tools/...`, `bun .claude/...`) from the checkout listed in the campaign rows, and refer to logs and trees by path.
- Inspect source files in the tree named by each campaign's host line. If the last recorded condition ran under a host hash matching neither tree, note beside every source claim that the inspected code may differ from what executed.
- Your report is written for the operator and the primary reviewer. It never reaches a Builder, Examiner, or Auditor, and must not address any of them.
- The orientation and moved variable frame the investigation rather than dictating conclusions: refuting either with evidence is a valid finding.
