# ADR 0004: Paired comparison scoring, Wilcoxon sign-flip test, and task sampling

## Status

Accepted

## Context

Promotion decisions rest on paired comparisons of a candidate harness against the reference harness on held-out tasks. Numerical rounding drift, solve-order bias, task-family clustering, and selection bias on confirmation reads can each inflate false-promotion rates.

## Decisions

1. **Validity-first paired scoring with exact antisymmetry (`src/kernel/compare.ts`, `pointsOf`, `orderFreeSum`, `wholePoints`)**
   - `WEIGHTS = { validity: 0.6, objective: 0.3 }`, `GAP_FLOOR = 0.01`, `ZERO_FLOOR = 1e-12` (preventing near-zero floating-point dust from reading as a 100% objective gain).
   - `orderFreeSum` sums positive and negative terms separately from smallest magnitude to largest, and `wholePoints` rounds halves away from zero without `-0`, guaranteeing that swapping reference and candidate arms negates every task score identically.
   - `flipP` runs an exact one-sided Wilcoxon signed-rank dynamic program over untied task scores; `rawFlipP` is retained for off-policy replay (`test=flip`).

2. **Time-mirrored solve scheduling and mirrored A/A splits (`src/campaign/round.ts`, `unsolvedJobs`; `src/kernel/compare.ts`, `pairsOf`)**
   - Comparison solves alternate arm order across slots and tasks so provider drift over time affects both arms symmetrically.
   - Empirical A/A controls split the reference's own solves using a 4-element mirrored pattern (`0,3` vs `1,2` mod 4). An earlier chronological split exhibited order bias across 234 controls (446–363, `p = 0.004`), which balanced to 405–404 once mirrored.

3. **Epoch-tiered, family-interleaved sampling with retained regression tasks (`src/campaign/round.ts`, `scoredSet`, `frontierOverlap`)**
   - `scoredSet` draws up to `target` frontier tasks from the newest epoch backwards (and tasks written since the last comparison first within each epoch), interleaving task families round-robin and capping any single family at `FAMILY_SHARE = 0.4` when three or more families exist unless other families cannot fill the target.
   - One retained task (exhausted or from prior epochs) is drawn per three frontier tasks using a comparison-rotated deterministic seed (`draw`), scored jointly with the frontier to catch regressions while reported separately (`UNMEASURED` when empty rather than zero regressions).
   - `frontierOverlap` caps projected overlap at `OVERLAP_LIMIT = 0.8` between consecutive `no-step` candidate comparisons on the same reference, reading pre-registered starts alone so candidate outcomes never cross the wall.

4. **First-starter-comparison confirmation and underpowered-lead revert guard (`src/campaign/climb.ts`, `againstStarter`; `src/campaign/scheduler.ts`, `unconfirmedRevert`)**
   - A promotion is confirmed only by the epoch's first starter comparison that tallies at least one task, preventing later draws from overwriting a failed confirmation. Scores are negated to orient them from the reference's perspective, and `starterReads` separates `written after` and `unchosen` tasks from winner's-curse-selected tasks.
   - `unconfirmedRevert` reverts a reference that fails its first scored starter read unless it led (`wins > losses`) in an underpowered comparison (`starter_able === false`) that could not clear its significance level even at 100% wins. All-tied and losing underpowered reads still revert.

5. **Economy reported without a bar (`src/campaign/climb.ts`, `MILESTONE`)**
   Each promotion reports its epoch's promotion attempts, Builder sessions and billed dollars (`worthLine`, `tools/campaign/close.ts`). No attempt threshold is held against them: an observational bar changed no decision. `MILESTONE` (`6` promotions, `10` post-milestone controls) is strictly observational and never exposed to seats or decision rules.
