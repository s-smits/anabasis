# The tally, the test, and the reading

Read this reference for per-task scoring, the paired sign-flip test, reading classifications, and
the A/A control. It expands the middle of `AGENTS.md` section 7; `scripts/size.ts` computes the
power figures directly from the production test.

## The tally

Every candidate solve is paired with every reference solve on the same task, and the task score is a
weighted sum of two components in [-1, 1] (`pointsOf`, `WEIGHTS`, `src/kernel/compare.ts`):
validity (weight 0.6), defined as the fraction of pairings where only the candidate is valid minus
the reverse; and the declared objective (weight 0.3), computed only across pairs of valid answers as
the relative improvement over the larger measure, zeroed whenever the difference falls below
`GAP_FLOOR` (`told`, `gainOver`). The sign of the resulting score classifies the task as a win,
loss, or tie, and swapping arms negates the score. `wholePoints` rounds scores to thousandths across
all readers. Validity dominates the sum: a candidate achieving 3 of 4 valid solves against 4 of 4 can
still win only when its valid answers outperform the reference by more than two thirds. Older
reports may include a bill component weighted at 0.1, decoded via `scoresIn`. Weights are host
constants: the current codebase rescores historical comparisons under current weights while each
logged report preserves its original record.

An **objective** is a numeric quantity computed by the check program's evaluator from a valid
answer, paired with an optimisation direction, published in the contract and fixed as a comparison
term (`ObjectiveRule`; `OBJECTIVE`, `src/kernel/verify.ts`). When no objective is declared, two
valid answers tie.

## The test and the step

`flipP` performs an exact one-sided paired sign-flip permutation test over the nonzero task scores.
Under the null hypothesis of exchangeable harnesses, each nonzero task margin is equally likely to
take either sign, and `p` is the proportion of sign assignments whose sum equals or exceeds the
observed sum. When every untied task is won, `p = 2^(-k)` for `k` untied tasks; margin magnitudes
affect `p` only when wins and losses both occur. Frontier and retained tasks enter a single combined
test while being reported separately; an empty retained set is reported as `unmeasured` rather than
as "no regression".

A **step** (`readsStep`) occurs when `p` is at or below the configured significance level. Each
reading reports its untied task count, the true win share detectable at 0.8 power (`detectable`),
and the exact false positive rate conditional on its margin magnitudes (`falseRate`). At level 0.02,
the smallest set capable of reading a step is 6 won tasks (`sweepOf`), and admission requires 8
frontier tasks (`comparisonFloor`). At level 0.10, these thresholds are 4 and 6, and equal margins
clear at 4 to 0, 6 to 1, 7 to 2, or 9 to 3. With 24 untied tasks, the exact false positive rate is
1.1% at level 0.02 and 7.6% at level 0.10, and a 0.02 test detects a candidate with an 80% true win
rate at 0.8 power (87% at 12 untied tasks; see the head comment of `src/kernel/size.ts`). Because
the level is recorded in the campaign opening, each campaign is evaluated under its own threshold.

## The reading

The five reading classifications in `AGENTS.md` section 7 correspond to `Reading` in
`src/campaign/comparison.ts`, whose head comment documents legacy classifications (none of which
triggers promotion). `not-scored` covers both zero tallied tasks and a test truncated by the dollar
cap. Alongside the hypothesis test, the report prints per-arm validity alone (`valid`), task set
sizes, overlap with the pair's previous comparison, and per-measure point totals. The A/A control
compares the reference against itself by splitting its solves into time-mirrored halves and running
a two-sided test at the same level (`readsStepEitherWay`). With two solves per arm, each half
contains one solve and the time-order assignment alternates across tasks (`pairsOf`). An A/A control
should register no step, triggers no campaign action, and feeds factor 2 (Honesty).

## The record

The design choices in `src/kernel/compare.ts` rest on empirical replays over historical logs (full
derivations and detailed records are archived in `7f0add79:docs/plan.md`, "Statistical power and
cost", and the corresponding commits):

- **Paired sign-flip test**: makes no stronger assumptions than the sign test it replaced
  (independent tasks, exchangeable arms) and reduces to it under equal margins, while utilising
  margin magnitude when wins and losses mix.
- **Single combined test over frontier and retained tasks**: a separate regression test on retained
  tasks fired only once in 58 real readings, and a "narrow" reading flagging single-family steps
  never fired in 1,598 readings.
- **Single-reading promotion**: a confirm-on-repeat rule agreed with the initial reading on all 11
  repeats while adding 1 to 2.5 hours to each 6 to 7 hour promotion cycle, so it was removed.
- **Exclusion of cost from scoring**: weighting the bill at 0.1 allowed a candidate with worse
  objective quality to win promotion on cost alone, and caused the Builder's reported tally to
  diverge from the tested score. Across 84 readings from 40 campaigns, removing the bill component
  eliminated 7 of 46 steps and added none; cost is reported instead in `close.ts`.
- **`GAP_FLOOR`**: without a tie floor, six tasks won by 0.01% yield `p = 0.016` and trigger
  promotion; one comparison scored 23-0-1 on gains of 0.01% to 0.65% that `GAP_FLOOR` correctly
  reads as 3-3-18. Because per-campaign `--room` overrides were never used, a single constant
  governs all comparisons. Author answers count towards headroom so a reference stuck on one recipe
  cannot reject drafts whose author achieved 3% to 20% better scores, while the floor filters
  trivial floating-point noise.
- **`WEIGHTS`**: replaced a lexicographic rule under which a 0.01% objective gain outweighed
  halving the cost. Replayed across 74 comparisons, it read 52 steps versus 47 and zero A/A steps in
  26 controls.
- **Uncapped objective gain**: a 10% gain cap (`FULL`) proved nearly inert in replay over 224
  readings and was removed; removing it eliminated two promotions driven by small objective gains
  that the cap had inflated to match a validity loss. Scoring objective gains by sign alone
  introduced an A/A step and was rejected.
- **`informative`**: includes tasks the reference always fails whenever a valid answer exists on
  record; without this, a promoted harness passing all its solves left headroom only on partially
  solved tasks.
- **Time-order mirroring**: running A/A solves sequentially after the primary test caused temporal
  drift to register as a false difference.
