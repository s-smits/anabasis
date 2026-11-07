# Rejections, the budget, room, patience and promotion

Read this for rejections, the solve budget, room, patience, task review and promotion (`AGENTS.md`
section 7).

## Rejections

A rejection becomes a fail only when the Referee rules it `earned` on an answer probe that moved a
refusing check (`src/referee/referee.ts`); otherwise the task is set aside until labels settle it
(`settle.ts`). Past 3 tasks with a check defect or a check that could not run (`--defects`), the
comparison stops, since the check program needs its owner before more is spent.

## The budget

The binding units are the solver's model turns (`--solve-model-turns`, counted in tool results; all
spent without an answer is `turns-ended`) and the deadline (`--solve-minutes`); the prompt limit
(`LIMITS.turns`) and a per-command time limit are equal for every solve. Read a comparison under its
own budget: a shorter budget applied afterwards would still describe solves told the longer one.

## The dollar cap

A solve does not start where a reserve for it and every solve in flight would pass `--cap`.

## Room for improvement

`roomOf` (`src/kernel/reports.ts`) reads **room** where some task is informative for the reference
(`informative`), **too-hard** where no valid answer exists on record, and **none** otherwise. The
better answer may be the reference's own, the candidate's or the author's, so room comes from
validity or from the objective.

## Improvement patience

`stopRule` (`src/campaign/admission.ts`) counts eligible moves since the last promotion. A move is
eligible where a session's changed harness was read against the reference by a comparison that
tallied a task and left room, or where a session left its harness unchanged although a practice
solve failed. Starter comparisons and comparisons that scored nothing or left no room do not count,
and the rule never ends a campaign that earned a promotion since.

## Awaiting task review

A task with no valid answer in two comparisons awaits review, unless a valid answer stands on record
(`task.feasible`: a solve's, its author's seen to pass under its id, or a stored pack's that passes
at `prepare`) or a deadline or context cut its solves (`poolOf`). Using every model turn is no cut,
since the turns are the budget, unless the window or provider ended the last turn (`windowEnded`,
`providerFailed`).

## Promotion

A comparison without `--reference` runs against the last promoted harness; one naming a digest
promotes nothing.
