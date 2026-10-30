# Rejections, the budget, room, patience and promotion

Read this for rejection handling, budgets, room, patience, task review and promotion. This expands
the corresponding parts of `AGENTS.md` section 7.

## Rejections

A rejected answer is not valid only once the Referee rules it `earned` , on an answer probe that
moved a refusing check off its refusal (`src/referee/referee.ts`). `check-defect` , `unclear` or no
ruling sets the task aside for both harnesses until labels settle it (`settle.ts`); a label
overrides a ruling. Past `--defects` tasks with a check defect or a check that could not run, the
comparison stops: the check program needs its owner before more is spent.

## The budget

A campaign runs at the one budget its setting names. The binding units are the model's own turns,
enforced and appended to results of tools that execute (`--solve-model-turns`; using them all
without an answer ends `turns-ended` ), and the solve's deadline (`--solve-minutes`). A time limit
on each command bounds a turn, and the prompt limit (`LIMITS.turns`, 24) is the same for every
solve. Evaluate a comparison under the budget given to its solves. Retrospectively applying a
shorter budget would still describe solves whose model had been told the longer limit.

## The dollar cap

`--cap` is required. A solve does not start if a reserve for it and for every solve in flight would
take the comparison's billed dollars past the cap.

## Room for improvement

`roomOf` (`src/kernel/reports.ts`) reports one of three outcomes:

- **room**: at least one task is informative for the reference. It passes some solves but not all;
  another valid answer improves on one of its answers by the objective gap floor; or it passes no
  solve while a valid answer is on record. The better answer may be its own, the other harness's
  or the author's (`informative`, also used by `try_task`).
- **too-hard**: no valid answer exists on record.
- **none**: a valid answer exists, but no task is informative.

Room can therefore come from validity differences or from the objective.

## Improvement patience

**Improvement patience** stops the campaign after `--patience` (six) eligible moves in a row show no
gain (`stopRule`, `src/kernel/reports.ts` ). A move is eligible where a harness a session changed is
read by its last comparison against one reference and that comparison tallied a task and left room,
or where a whole session left its harness unchanged although a practice solve failed (one whose
every practice solve passed had nothing to work on). Starter comparisons, and those that scored
nothing or left no room, do not count. Only moves since the last promotion count, so it never ends a
campaign that earned one. The next comparison or session is then refused without `--past-stop` .

## Awaiting task review

A task with no valid answer in two comparisons is **awaiting task review**, unless a valid answer
stands on record (a solve's, its author's that the host saw pass under its id, or a stored pack's
that passes at `prepare` : `task.feasible` ), or its deadline or context cut its solves (`poolOf`).
A solve that used every model turn is no cut, unless the window or the provider ended its last turn
(`windowEnded`, `providerFailed` ; an older log records it as `turns-ended` ): the turns are the
budget, so it is a fail.

## Promotion

Promotion writes `harness.promoted` , by the campaign command outside `--hitl` (section 3) and
otherwise by `promote.ts --yes` . A comparison with no `--reference` is made against the harness
last promoted; one that names a digest promotes nothing.
