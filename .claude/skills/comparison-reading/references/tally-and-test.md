# The tally, the test, and the reading

Expands `AGENTS.md` section 7 on per-task scoring, the paired sign-flip test, reading classifications, and the A/A control (`scripts/size.ts` computes power figures directly from the production test).

## 1. Per-task scoring (`pointsOf`, `WEIGHTS`, `src/kernel/compare.ts`)

Every candidate solve is paired with every reference solve on the same task, producing a weighted score in `[-1, 1]` rounded to thousandths (`wholePoints`):
- **Validity (weight 0.6)**: fraction of pairings where only the candidate is valid minus the reverse.
- **Declared objective (weight 0.3)**: evaluated only across pairs of valid answers (`ObjectiveRule`; `OBJECTIVE`, `src/kernel/verify.ts`) as the relative improvement over the larger measure, zeroed whenever the difference falls below `GAP_FLOOR` (`told`, `gainOver`). When no objective is declared, two valid answers tie.

The score's sign classifies the task as a win, loss, or tie; validity dominates (3/4 valid vs 4/4 valid can win only if its valid answers outperform the reference by more than two thirds). Older reports with a 0.1 bill weight are decoded via `scoresIn` and rescored under current host constants on replay.

## 2. Paired Wilcoxon signed-rank test and reading (`flipP`, `readsStep`)

`flipP` runs an exact one-sided Wilcoxon signed-rank permutation test over nonzero task scores (combining frontier and retained tasks into one test while reporting retained tasks separately, or `unmeasured` when empty): nonzero margins are mapped to exact mid-ranks (`signedRanks`, doubled to integers so tied magnitudes remain exact) and evaluated via the exact sign-flip DP. When every untied task is won, `p = 2^(-k)` for `k` untied tasks; when wins and losses mix, validity margins still rank above pure objective margins while heavy-tailed objective outliers cannot erase a consistent majority of wins. Legacy raw-magnitude sign-flip remains available as `rawFlipP` for off-policy `promotion-tuner` replay (`test=flip`).

A **step** (`readsStep`) registers when `p` is at or below the campaign's configured significance level. Each reading reports untied tasks, the win share detectable at 0.8 power (`detectable`), and the exact conditional false-positive rate (`falseRate`). At default level 0.02, at least 6 won tasks are needed to clear (`sweepOf`) and admission requires 8 frontier tasks (`comparisonFloor`; 4 and 6 at level 0.10; see `src/kernel/size.ts`).

The five reading classifications (`Reading`, `src/campaign/comparison.ts`) are `step`, `no-step`, `not-scored` (zero tallied tasks or truncated by the dollar cap), `check-defects`, and `no-change`. Alongside the primary test, the time-mirrored **A/A control** splits reference solves into alternating halves (`pairsOf`) and runs the same one-sided test at the same level (`readsStep`) to monitor factor 2 (Honesty); a control counts toward the honesty bar only where it is powered (`able`), pooled by release (`climb.ts:falsePromotionOf`, `table.ts --rows releases`).

## 3. Empirical basis of the scoring rules (`7f0add79:docs/plan.md`)

- **Paired sign-flip over combined tasks**: reduces to the sign test under equal margins while weighting margin magnitudes when wins and losses mix; separate retained-task regression tests (1/58) and single-family `narrow` flags (0/1,598) were removed as redundant.
- **Single-reading promotion**: confirm-on-repeat agreed on 11/11 repeats while adding 1–2.5 hours per promotion cycle.
- **No cost weight in scores**: removing the 0.1 bill weight across 84 readings (40 campaigns) eliminated 7 of 46 steps where worse quality won on cost alone and aligned the Builder's visible tally with the tested score.
- **`GAP_FLOOR` (1%) and uncapped `WEIGHTS`**: filters trivial floating-point differences (e.g. turning a 23-0-1 promotion on 0.01%–0.65% jitter into 3-3-18) while counting author answers toward headroom; removing the 10% gain cap (`FULL`) across 224 readings eliminated two promotions where small objective gains were inflated to match a validity loss, with zero A/A steps across 26 controls.
- **`informative` and time-order mirroring**: retains tasks the reference always fails whenever any valid answer exists on record, and alternates A/A solve order across tasks so temporal drift cannot register as a false step.
