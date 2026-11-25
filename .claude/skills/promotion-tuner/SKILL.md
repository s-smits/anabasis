---
name: promotion-tuner
description: "Use before changing any scoring, admission, or promotion rule, or when replaying recorded comparisons off-policy, tabulating runs and repriced costs, or checking cohort trends. `scripts/replay.ts` checks whether a tree's scoring rule reproduces recorded promotions and compares alternative rules (`--try`, `--mechanism`, `--against`); `scripts/table.ts` tabulates runs and costs (`--rows cost`); `scripts/trend.ts` tests recent weeks against prior windows with optional `--bench` scores. Off-policy replay never establishes a live improvement."
---

# Promotion tuner

Evaluates alternative scoring and promotion rules off-policy against archived solves (`AGENTS.md` §7; [comparison-reading](../comparison-reading/SKILL.md)): zero model calls, zero log writes. Promotion parameters are operator-controlled experimental conditions; sweeps yield evidence and a recommendation, and **off-policy replay never establishes live improvement**.

## Tunable knobs (`scripts/mechanisms.ts`)

| Parameter | Production owner | `--try` knob |
| --- | --- | --- |
| Validity & objective weights | `WEIGHTS`, `src/kernel/compare.ts` (step 5) | `validity=`, `objective=` |
| Resource metric as gain or guard | none in production | `bill=`, `turns=`, `seconds=` (`when=`, `side=`, `lead=`, `floor=`); `mostBill=`, `mostTurns=`, `mostSeconds=` |
| Objective gap floor & gain curve | `GAP_FLOOR`, `gainOver`, `pointsOf` (a judged task keeps production's objective) | `room=`, `gain=` |
| Test, unit & inclusion | `flipP` (exact signed-rank), one-sided `isSignificant`, `pairsOf` | `test=` (`rank`\|`flip`\|`sign`), `untied=`, `level=`, `unit=` (`family`\|`first`), `retained=` |
| Custom rule or worktree | | `--mechanism <file>`, `--against <worktree>` |

## Commands

```sh
# 1. Multi-rule panel (--record caches exam-side data under data/derived/)
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/replay.ts \
  [--try <knobs>|standard]... [--mechanism <file>]... [--against <worktree>]... [--tree <worktree>] \
  [--from <tag|date>] [--logs <dir>] [--name <campaign>]... [--record <file>] [--refresh] [--split <tag|date>] [--named]

# 2. Single-tree archive reconciliation
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/replay.ts \
  [--tree <worktree>] [--logs <dir>] [--since <date>] [--name <campaign>]... [--totals]

# 3. Per-run, per-promotion, repriced-cost or per-release honesty tables
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/table.ts \
  [--rows recent|runs|promotions|cost|releases] [--since <date>] [--name <part>]... [--last 20] \
  [--has <text>]... [--holds <commit>]... [--format md|tsv] [--runs <dir>]

# 4. Multi-week cohort trend & retention (--pack buffer --back 4 for control domain)
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/trend.ts \
  [--window 7] [--back 2] [--until <date>] [--pack <pack>]... [--any-setting] \
  [--has <text>]... [--holds <commit>]... [--bench <store> [--bench-tasks <list>]] [--format md|tsv] [--runs <dir>]

# 5. Judged-lane null and power rates on synthetic solves, through the production folds
bun .claude/skills/promotion-tuner/scripts/simulate-scoring.ts \
  [--trials 5000] [--tasks 24] [--solves 2] [--level 0.02] [--bias 0.3] [--weights <c:j>] [--seed 1]
```

`--holds` takes a commit and `--has` a text; both keep only runs whose every launch holds it. `--runs <dir>` reads an offline folder without the registry.

## Reading panels & trends

- **Reconciliation**: a tree reads `read otherwise than stored = 0` on the weighted reports of runs whose commit already scored as it does; older runs move wherever scoring changed after their commit. Readings read otherwise than recorded split into those the tree's test alone flips on the stored scores and those its scores move. Starter reads promote nothing and stay out of the promotion pairs.
- **Honesty**: an A/A false step is the reference's mirrored halves read a step one-sided at the comparison's level, counted over the powered A/As (those that could read one), as production's `falsePromotion` (`src/campaign/climb.ts`) counts them. Every reader prints it as `steps/powered` with the 95% exact bound (`upperBound`) and the bar at twice the least level (`AGENTS.md` §1, item 2). The bar reads releases: `table.ts --rows releases` pools each release's whole runs; `trend.ts` counts its windows' runs to a common horizon.
- **Panel columns**: total steps (`+`/`-`), baseline tallies on added steps (`ahead`, `lvl`, `0-0`, `bhd`), `starter` confirmation rate, `A/A (powered)` one-sided false steps of powered A/As by the mechanism's own test and level, of all A/As, with the exact bound, `repeat` sign agreement, median/per-step costs (`bill`, `turns`, `secs`, `$/step`, `h/step`), `by pack`.
- **Trends (`trend.ts`)**: truncates cohorts to a common elapsed-hour horizon (`FLOOR` = 6h) and runs campaign-level permutation (`shiftOf`, `LEVEL` = 0.05: `moved` | `inside the spread` | `too few runs`). `guardOf` pairs promotion speed (`promotions a 100 active hours`) with starter confirmations and post-promotion win rate (`together` | `apart` | `no single direction` | `not read`). `--bench <store>` joins digests to external scores vs Starter spread.

## Tuning protocol

1. Pre-register predictions in `.ana/wri/<date>-<what>/`.
2. Verify baseline reconciliation, then sweep via `--try`, `--mechanism` or `--against`.
3. Judge against an explicit bar:
   - *Gain*: promotions up or hours/promotion down, A/A false steps no more than the tree's and their exact bound within the honesty bar, no added step contradicted on repeat.
   - *Simplification*: keeps all rightful promotions, no added A/A false step, maintains hours/promotion, lowers `reduce-complexity` metrics.
4. Report aggregate counts, digests and campaign names only (no exam-side task measures); validate live only in a fresh run on operator approval (`AGENTS.md` §10, item 9).

## Related skills

- Scoring semantics & comparison scripts: [comparison-reading](../comparison-reading/SKILL.md)
- Framing claims & evidence rungs: [attribution-and-proof](../attribution-and-proof/SKILL.md)
- Per-run or comparison root-cause diagnosis: [whole-run-investigation](../whole-run-investigation/SKILL.md), [comparison-review](../comparison-review/SKILL.md)
- Landing approved rule changes & validating live: [stack-pr](../stack-pr/SKILL.md), [run-improvement-campaign](../run-improvement-campaign/SKILL.md)
