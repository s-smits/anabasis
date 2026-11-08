<!--
The synthesis session's prompt. `wri.ts synthesis --out <dir>` renders it into
<dir>/synthesis-prompt.md, filling the five slots in braces and dropping comments. This template owns
what the note owes; the skill's "Vetting" section links here.
-->
# Whole-run investigation synthesis

You are the one synthesis session of the investigation under `{out}`. Each lane was read by an
independent session that saw no other report. Merge their reports into one note at `{synthesis}`:
write its heading first and append as each section settles. Write nothing else, commit nothing and
edit no source.

## The shared instructions every open lane read

{sharedInstructions}

## What the logs hold

```
{overview}
```

## The reports

Read each report marked `ok`, including the `## Checked` section behind each `no finding`; an empty
one leaves its lane unsubstantiated, since the collector checks shape only. List each `omitted` lane
with its reason, those whose trigger fired first. Name each `missing` or `invalid` report as a gap and
never fill it from memory. A report is a lead: carry only findings you have checked against the log
by the event kinds, ids and counts it cites.

{reports}

## What the note owes, in this order

1. **Whether the reading may be believed.** One row per `comparison.reported` of each campaign, with
   four links, each `holds`, `does not hold` or `undeterminable` with its event kind and count:
   (a) the exam measured: the checker was frozen and read, and the refusals in the tally read sound
   (lanes 1 to 4); (b) the tasks bracketed: the scored set was held out and fixed before the first
   solve, chosen by no result of that comparison (lanes 5 and 7 to 11); (c) the pair differed in the
   harness alone, and the harness could not know the exam (lanes 12, 16 and 24); (d) the reading
   follows from the pairs at their number (lanes 18 to 20). Then one sentence a row: believed as
   written, believed with a named limit, or not believed.
2. **The binding constraint.** The one mechanism that most limits the next round, and why it
   outranks the rest.
3. **One merged findings table:** `finding | lanes | campaigns | owner | evidence | outcome`. Merge
   repeats under the earliest owner; `lanes` names every lane that raised a row, since independent
   agreement counts. `campaigns` names those that show it, from `Seen in:` lines checked
   against the logs; a finding only one campaign shows says what that campaign has that the others
   lack. `owner` is exactly one owner from the catalogue's table, with the file for `host` and for a
   prompt. `evidence` is an event kind and a count. `outcome` is exactly one of `patch`, `decision`,
   `prediction` or `drop`. Rank rows by their consequence for the four links.
4. **Conflicts resolved.** Where lanes disagree, the events that settle it, or both readings and the
   observation that would separate them.
5. **Build plan.** The `patch` rows as clusters with disjoint files, each with owner, mechanism and
   failing test. A `pack/` row is a `decision`, never a patch.
6. **Operator decisions.** Each with the missing evidence, what it changes, and the plan's decision
   number where one exists.
7. **Predictions.** Falsifiable rows for the next round: moved variable, claim, direction,
   falsifier. Name the `patch` row each checks, so a fork's `predictions-<run>.md` can carry
   it under that pull request.

## Hard rules

- Quote nothing: no task text, answer, hidden value, check failure text, prompt, trace passage or
  reviewer prose, from the log or a report. Counts, ids, digests, paths and line numbers only.
- Keep each observation apart from its cause, in two sentences.
- Recount every "N of M" you carry from rows A to F before you use it.
- A ruling is a reviewer's reading: say whose a count is before leaning on it.
- Never write under a campaign's folder, and start no solve, session, round or check run.

When the note is written, reply with its path and one line per table row: finding, outcome.
