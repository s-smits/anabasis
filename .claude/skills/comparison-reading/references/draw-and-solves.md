# Terms, the scored draw and the solves

Read this for comparison terms, the draw and how each ending counts (`AGENTS.md` section 7). The
head comments of `src/kernel/compare.ts` (tally, test, step), `src/campaign/round.ts` (running one)
and `src/campaign/comparison.ts` (reading one back) are the full account.

## Terms first

`comparison.started` records the harnesses, setting, scored tasks, solves a side, level, objective
rule, cap and any `--predict`; a continuation refuses a change.

## The scored draw

The draw (`poolOf`) takes `--target` held-out tasks, newest epoch first and within it those held
since the last comparison began, ordered by the contract's hash. It leaves out tasks awaiting review
(no valid answer after two comparisons, "Awaiting task review" in `limits-and-room.md`) and marks as
**exhausted** a task the reference answered in every one of its own solves in its last two
comparisons (`ownOf`). Only the reference's solves count here, so which task the candidate won moves
nothing the Builder is told (rule 3). A task stays open while some answer on record betters one of
the reference's by the gap floor (`gapAgainst`). The counts live in `SIZE` and `RUNS`
(`src/kernel/size.ts`), and every rule reads a side's every, some or none, so they hold at any
number of solves.

One **retained** exhausted task joins each three frontier tasks, beyond the target (`scoredSet`), so
that a gain on new tasks cannot hide a regression on old ones.

## Fresh solves

Workers take whole tasks in a hashed order, and the first side is mirrored within a task
(`round.ts`), which balances order but not load or cache. A non-result gets one retry at the same
slot; a second leaves the task short. A solve counts only when its start names the comparison: the
condition names the host's code, which changes between comparisons, and one frozen draw of reference
solves would bias every later reading (rule 5).

## How a solve ends

Section 7 lists how each kind (`src/kernel/solve.ts`) counts. Two edges: a deadline on a model
silent for ten minutes with no tool running is a `provider` non-result (`SILENT_SECONDS`), and a
`malformed` flag is reported apart (`flagged`), a task both sides flag being a tie.
