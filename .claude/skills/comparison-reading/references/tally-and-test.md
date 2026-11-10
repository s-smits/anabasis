# The tally, the test and the reading

Read this for task scores, the sign-flip test, the reading words and the A/A control. It expands the
middle of `AGENTS.md` section 7; `scripts/size.ts` prints the power figures from the production
test.

## The tally

Every candidate solve is paired with every reference solve of the task, and the task's score is a
weighted sum of two measures in [-1, 1] (`pointsOf`, `WEIGHTS`, `src/kernel/compare.ts`): validity
(0.6), the share of pairings where only the candidate is valid less the reverse; and the objective
(0.3), between two valid answers the gain as a share of the larger measure, zero under `ROOM`
(`told`, `gainOver`). The sign makes the task a win, loss or tie, and swapping sides negates it.
`wholePoints` rounds to thousandths for every reader. Validity dominates: 3 of 4 valid against 4 of
4 still wins where the valid answers measure more than two thirds better. An older report may carry
a bill measure at 0.1, read through `scoresIn`. The weights are host constants; this tree rescores
old comparisons by them while each report stays its own record.

An **objective** is a quantity the check program's evaluator computes from a valid answer, with a
direction, public in the contract and fixed as a term (`ObjectiveRule`; `OBJECTIVE`,
`src/kernel/verify.ts`). Without one, two valid answers tie.

## The test and the step

`flipP` is an exact one-sided paired sign-flip test over the nonzero task scores: under exchange of
the harnesses each margin is equally likely to carry either sign, and p is the share of sign
assignments whose sum reaches the observed one. When every untied task is won, p is 2 to the minus
the count, and margins matter only when wins and losses mix. Frontier and retained tasks enter one
test, reported apart; an empty retained set reads `unmeasured` instead of "no regression".

A step (`stepOf`) is p at or under the level. Each reading prints its untied count, the win share it
detects with power 0.8 (`detectable`) and its false rate at its margins (`falseRate`). At 0.02 the
smallest set that can read a step is 6 won tasks (`sweepOf`), and admission asks for 8 frontier
tasks (`comparisonFloor`); at 0.10 they are 4 and 6, and equal margins clear at 4 to 0, 6 to 1, 7 to
2 or 9 to 3. At 24 untied tasks the false rate is 1.1% at 0.02 and 7.6% at 0.10, and a reading at
0.02 detects with power 0.8 a harness that wins 80% of them (87% at 12; `src/kernel/size.ts`, head
comment). The level is kept by the opening, so a campaign is read by its own rule.

## The reading

The five words of section 7 are `Reading` in `src/campaign/comparison.ts`, whose head comment names
the older ones; none of those promotes. `not-scored` covers both no task tallied and a test the cap
cut short. Beside the test the report gives each side's validity alone (`valid`), the sets, the
overlap with the pair's previous comparison and each measure's points. The A/A, the reference on
halves of its own solves mirrored in time, is read either way at the level (`readsStepEitherWay`).
At two solves a side a half is one solve, and the mirror runs on over the tasks: the earlier solve
is the first sample on every other task (`pairsOf`).
It should read no step, ends nothing, and feeds factor 2.

## The record

Why each rule of `src/kernel/compare.ts` is as it is, with the count it rests on. The formulas and
the dated detail are in `7f0add79:docs/plan.md`, "Statistical power and cost", and the commits.

- **The sign-flip test** assumes no more than the sign test it replaced (independent tasks,
  exchangeable sides) and equals it at equal margins, while also reading how far a task was won.
- **One test over two sets.** A separate regression test on retained tasks fired once in 58 real
  readings, and a "narrow" reading for steps within one family never fired in 1,598.
- **One reading promotes.** A confirm-on-repeat rule saw all 11 repeats agree with the first
  reading, at 1 to 2.5 hours of a promotion's 6 to 7, so it went.
- **The bill scores nothing.** With the bill at a tenth of the score, a harness worse by the
  objective was promoted on cost, and the tally a Builder was told diverged from the one tested.
  Over 84 readings of 40 campaigns, dropping it took 7 of 46 steps and added none; cost belongs to
  the closing report (`close.ts`).
- **`ROOM`.** Without a floor, six tasks won by 0.01% read p = 0.016 and promote; one comparison
  read 23-0-1 on gains of 0.01% to 0.65% that the floor reads 3-3-18. A per-campaign `--room` term
  was never used, so one constant serves all. The author's answer counts towards room, otherwise a
  reference repeating one recipe refuses drafts whose author found 3 to 20% better, and the floor
  keeps the author's precision out.
- **`WEIGHTS`** replaced a lexicographic rule under which a 0.01% gain counted as much as halving
  the bill. Replayed on 74 comparisons it read 52 steps for 47 and no A/A step in 26.
- **The gain is uncapped.** A cap at 10% (`FULL`) proved nearly inert in replay over 224 readings
  and was removed; removing it dropped two promotions that rested on small objective gains the cap
  had weighed like a validity loss. Counting a gain by its sign alone added an A/A step, so it was
  not taken.
- **`informative`** counts a task the reference always fails while a valid answer is on record;
  without it a promoted harness that passed every solve left room only on tasks it answered
  sometimes.
- **The mirror** exists because A/A solves run after the test's own read drift as a difference.
