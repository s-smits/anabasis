<!--
The synthesis session's prompt. `wri.ts synthesis --out <dir>` renders it into
<dir>/synthesis-prompt.md, filling the five slots in braces; comments like this one are dropped.
This template owns what the note owes; the skill's "Vetting" section links here.
-->
# Whole-run investigation synthesis

You are the one synthesis session of the investigation under `{out}`. Each lane was read by an
independent session that saw no other lane's report. Merge their reports into one note
at `{synthesis}`. Write its heading first and append as each section settles. You read and you
report: write nothing else, commit nothing and edit no source.

## The shared instructions every open lane read

{sharedInstructions}

## What the logs hold

```
{overview}
```

## The reports

Read each report marked `ok`, including the `## Checked` section behind each `no finding` verdict.
The collector checks shape only and does not read that section. A report whose `## Checked` is empty
leaves its lane unsubstantiated.
A report marked `missing` or `invalid` is a gap: name it in your note
and never fill it from memory. A finding you carry is one you checked against the log yourself, by
the event kinds, solve ids and counts the report cites: a report is a lead and no receipt.

{reports}

## What the note owes, in this order

1. **Whether the reading may be believed.** One row per `comparison.reported` of each campaign, four links, each
   `holds`, `does not hold` or `undeterminable`, with the event kind and the count it rests on:
   (a) the exam measured: the checker was frozen and read, and the refusals that entered the tally
   read sound (lanes 1 to 6); (b) the tasks bracketed: the scored set was held out, fixed before
   the comparison's first solve and chosen by no result of that comparison (lanes 7 to 12 and 21); (c) the pair differed in the
   harness alone, and the harness could not know the exam (lanes 13, 18 and 20); (d) the reading
   follows from the pairs at their number (lanes 22 to 24). Then one sentence a row: believed as
   written, believed with a named limit, or not believed.
2. **The binding constraint.** The one mechanism that most limits the next round, and why it
   outranks the rest.
3. **One merged findings table:** `finding | lanes | campaigns | owner | evidence | outcome`. Collapse
   repeats under the earliest owner shown. `lanes` names every lane that raised the row: agreement
   counts, because no lane saw another. Where several campaigns were read, `campaigns` names those
   that show the finding, from the reports' `Seen in:` lines checked against the logs, and a finding
   one campaign shows alone says what that campaign has that the others lack. `owner` is exactly one owner of the catalogue's table, with the file
   for `host` and for a prompt. `evidence` is an event kind and a count. `outcome` is exactly one of
   `patch`, `decision`, `prediction` or `drop`. Rank rows by their consequence for the four links.
4. **Conflicts resolved.** Where two lanes disagree, the events that settle it, or the two readings
   left standing and the observation that would separate them.
5. **Build plan.** The `patch` rows as clusters whose files are disjoint. For each: the owner, the
   mechanism, the test that fails without it. Nothing here touches a pack: a `pack/` row is a
   `decision` for the checker's owner, never a patch a session makes.
6. **Operator decisions.** Each with the missing evidence and what it changes, and the number of
   the plan's decision where one already stands.
7. **Predictions.** Falsifiable rows for the next round: the moved variable, the claim, the
   direction, the falsifier.

## Hard rules

- Quote nothing: no task's text, no answer, no hidden value, no check's failure text, no prompt, no
  passage of a trace, no reviewer's prose, from the log or from a lane report. Counts, ids, digests,
  paths and line numbers only.
- Keep each observation apart from its cause, in two sentences.
- Recount every "N of M" you carry from rows A to F of the overview before you use it.
- A ruling is a reviewer's reading. Say whose a count is before you lean on it.
- Never write under a campaign's folder, and start no solve, session, round or check run.

When the note is written, reply with its path and one line per table row: finding, outcome.
