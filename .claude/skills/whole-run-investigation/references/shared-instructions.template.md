<!--
The shared instructions every open lane carries whole. `wri.ts start` filled each campaign's row;
write the three AUTHOR sections before `wri.ts lanes`. Comments are dropped from the prompts, a blank
`##` section refuses `lanes`, and deleting a heading drops it on purpose. An isolated lane gets only
the campaigns' rows and the hard rules.
-->

## Orientation

<!-- AUTHOR: the operator's question in your own words, and where its evidence is. Name the question,
never the answer you expect. At most about twenty lines; quote nothing from the log. -->

## The moved variable and prior state

<!-- AUTHOR: what changed between these campaigns and those before, and between each other (checker,
host code, model, a seat's prompt), the earlier findings this investigation checks, and what would
falsify each. An earlier diagnosis goes here as a hypothesis. Write "none" when nothing moved. -->

## Already read by the primary

<!-- AUTHOR: what you have already checked, one line each with its evidence (a count, a source line, a
mechanism), so a lane builds on it or refutes it. Never the answer a lane should reach. Write
"nothing" when you read nothing yet. -->

## Campaigns under review

{campaigns}

Each log is its campaign's whole append-only record, one event a line. Its folder also holds the
staged check program (`checks/` for a stored pack, `exams/<digest>/checks/` for a drafted exam),
`states/` with every harness state by digest, and each launch's `launch-run-<n>.json` (an older round
left `launch-<session>.json`): flags, commit and load. Read all of them; write to none.

## Hard rules

- Quote nothing the walls keep apart: no task text, answer, hidden value, check failure text, prompt,
  trace passage or ruling prose. Report event kinds, solve ids, the first eight characters of a
  digest, check ids, counts, paths and line numbers, and describe mechanisms in your own words.
- Never write under a campaign's folder or append to a log, and run no command whose working
  directory is inside one. Scratch goes in a temporary directory of your own.
- Start no solve, Builder or Examiner session, round or check run. `wri.ts grade` is the one
  exception, where your lane names it; it writes nothing.
- Write your report as soon as you have its first two lines, and append as you go.
- For `no finding`, leave `## Findings` empty and say under `## Checked` what you checked and found
  sound, in sentences without `Observation:`, `Cause:`, `Owner:`, `Reverses if:` or `Decision:` lines.
- Open no other lane's prompt or report and no synthesis of this investigation.
- Run the repository's commands (`bun tools/...`, `bun .claude/...`) from the checkout the rows name,
  and name logs and trees by path.
- Read source where each campaign's host line says its code stands. Where the last condition ran
  under a host hash matching neither tree, say beside each source statement that it may not be what
  ran.
- Your report is for the operator and the primary. It never reaches a Builder, an Examiner or a
  Referee, and addresses none of them.
- The orientation and the moved variable orient and do not conclude: refuting either with evidence
  is a finding.
