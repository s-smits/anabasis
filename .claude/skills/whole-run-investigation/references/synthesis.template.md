<!--
The synthesis agent's prompt. `wri.ts synthesis --out <dir>` renders it into
<dir>/synthesis-prompt.md, filling {out}, {synthesis}, {reports} and {sharedInstructions}; comments
like this one are dropped. Edit a copy and pass it with `--template` to change what the synthesis owes.
-->
# Whole-run investigation synthesis

You are the one synthesis session of the investigation under `{out}`. Each lane group was read by an
independent agent, in up to three readings:

- **P, per-run:** each run's lanes, read in that run alone, one report per lane;
- **C, cross-run:** each lane group read across the runs, with the per-run reports as leads;
- **M, multi-run:** each lane group read across the runs straight from their records, opening no
  other reading.

Merge them into one adjudicated note at `{synthesis}`. Write it early and append as each section
settles. You are report-only: write nothing else, commit nothing, and edit no source.

## The shared instructions every lane read

{sharedInstructions}

## The reports

`wri.ts collect` indexed every report it expected. Read each report marked `ok`; a report marked
`missing` or `invalid` is a gap, named in your note, and never filled from memory. A finding you carry
is one you re-checked against the run's source at its own commit and its records: a report is a lead,
not a receipt.

{reports}

## What the note owes, in this order

1. **The operator's question, per run.** The four links, one row per run: (a) the build harness ran
   on the shipped bytes; (b) all feedback was produced and gathered; (c) review feedback was used;
   (d) everything was handed over. Each cell is `happened`, `did not happen` or `undeterminable`, with
   a path and a count.
2. **The binding constraint.** The one mechanism that most limits the next run, and why it outranks
   the rest.
3. **One merged findings table:** `finding | readings | runs | corpus count | owner | outcome`.
   - `readings` is which of P, C and M raised the row; agreement counts only between readings reached
     independently.
   - `runs` names every run the finding holds in, and the runs it was checked absent from.
   - `corpus count` is the readings' count of distinct campaigns and domains; where two readings
     counted differently, give both.
   - `owner` is `file:line` at the run's source commit; say when the owner moved on main since.
   - `outcome` is exactly one of `patch`, `decision`, `prediction` or `drop`. Only a fix whose shape
     recurs across campaigns is a `patch`.
   Rank rows by their consequence for the binding constraint and the four links, not by count.
4. **Conflicts resolved.** Where readings disagree, the bytes that settle it.
5. **Verdicts on existing branch commits.** For each open branch commit the findings touch: keep,
   amend (how) or drop (why).
6. **Build plan.** Clusters whose file sets are disjoint, so each can be built in parallel. Per
   cluster: owners, the mechanism, the test that fails without it, and the open PR it appends to.
7. **Operator decisions.** Each with one owner, the missing evidence, and the decision it changes.
8. **Predictions.** Falsifiable rows for the next run: moved variable, claim, direction, falsifier.

## Hard rules

- Nothing quoted: never quote task content, request text, prompts, review or advice prose, Builder
  prose, trace text or any domain text from a campaign record or a lane report. Report counts, ids,
  digests, paths and line numbers, and describe mechanisms in your own abstract words.
- Run no git command inside a campaign workspace, and never run a tool with its working directory
  inside `campaigns/`.
- Read source at each run's own commit, in the checkout named for that run, never in the main
  checkout.

When the note is written, reply with only its path and one line per table row: finding, outcome.
