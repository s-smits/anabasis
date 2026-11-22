# Terms, the scored draw, and the solves

Read this reference for comparison terms, held-out task selection, and solve outcome classification
(`AGENTS.md` section 7). The authoritative specifications live in the head comments of
`src/kernel/compare.ts` (tally, test, step), `src/campaign/round.ts` (execution), and
`src/campaign/comparison.ts` (re-reading logs).

## Terms first

`comparison.started` logs the two harnesses, experimental setting, scored task list, solves per
side, significance level, objective rule, dollar cap, and any `--predict` hypothesis before the
first solve launches; resuming a comparison refuses any change to these terms.

## The scored draw

The draw (`poolOf`) selects `--target` held-out tasks, prioritising the newest epoch first and,
within an epoch, tasks admitted since the previous comparison started, ordered deterministically by
the contract's hash. Sibling tasks from the same authoring family are included; per-family tallies
are printed alongside the test (`families` in the report, and `promotion-tuner` replays single-task
family subsampling via `unit=first`), though family tallies do not gate decisions. The draw excludes
tasks awaiting review (no valid answer across two comparisons; see "Awaiting task review" in
`limits-and-room.md`) and marks as **exhausted** any task that the reference solved on every rollout
across its last two comparisons (`ownOf`). Only reference solves determine exhaustion, ensuring that
candidate wins never alter what the Builder observes (rule 3). A task remains open whenever any
recorded answer beats one of the reference's answers by at least `GAP_FLOOR` (`gapAgainst`). These
thresholds live in `SIZE` and `READINGS_IN_A_ROW` (`src/kernel/size.ts`), and every predicate is
expressed in terms of all, some, or none of a side's solves so that the logic holds for any rollout
count.

Beyond the target count, one **retained** exhausted task is appended for every three frontier tasks
(`scoredSet`), ensuring that gains on newly authored tasks cannot mask regressions on previously
mastered tasks.

## Fresh solves

Workers process whole tasks in hashed order, mirroring which harness runs first within each task
(`round.ts`). Mirroring balances execution order, though it does not control for transient host load
or cache state. A non-result receives one retry in the same slot; a second non-result leaves that
task incomplete. A solve enters a comparison only if its start event explicitly references that
comparison: the experimental condition hashes host code that can change between comparisons, and
reusing frozen reference solves across comparisons would introduce correlated bias into every
subsequent reading (rule 5).

## How a solve ends

`AGENTS.md` section 7 lists how each solve outcome (`src/kernel/solve.ts`) is classified. Two edge
cases warrant note: a deadline reached after a model stays silent for ten minutes with no tool
running is classified as a `provider` non-result (`SILENT_SECONDS`), and a `malformed` flag is
reported separately (`flagged`), with a task flagged by both arms scored as a tie.
