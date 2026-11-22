---
name: promotion-tuner
description: "Evaluate recorded comparisons off-policy under alternative promotion rules without model calls or spend. `scripts/replay.ts` checks whether a tree's scoring rule reproduces recorded promotions and identifies which measure won each task, and with `--try`, `--mechanism`, or `--against` compares alternative rules on a unified panel. `scripts/table.ts` tabulates runs and promotions (and with `--rows cost` reprices them on a single meter). `scripts/trend.ts` compares recent weeks against prior windows with campaign-level permutation tests, pairing climb rate with retention and optional external benchmark scores (`--bench`). Off-policy replay never establishes a live improvement."
---

# Promotion tuner

Evaluates alternative scoring and promotion rules off-policy against archived solves (`AGENTS.md` §7; [comparison-reading](../comparison-reading/SKILL.md)): zero model calls, zero log writes. Promotion parameters are operator-controlled experimental conditions; sweeps yield evidence and a recommendation, and **off-policy replay never establishes live improvement**.

## Tunable knobs (`scripts/mechanisms.ts`)

| Parameter | Production owner | `--try` knob |
| --- | --- | --- |
| Validity & objective weights | `WEIGHTS`, `src/kernel/compare.ts` (step 5) | `validity=`, `objective=` |
| Resource metric as gain or guard | none in production | `bill=`, `turns=`, `seconds=` (`when=`, `side=`, `lead=`, `floor=`); `mostBill=`, `mostTurns=`, `mostSeconds=` |
| Objective gap floor & gain curve | `GAP_FLOOR`, `pointsOf` | `room=`, `gain=` |
| Test, unit & inclusion | `flipP`, `readsStep`, `pairsOf`, `scoredSet` | `test=`, `untied=`, `level=`, `unit=` (`family`\|`first`), `retained=` |
| Custom rule or worktree | | `--mechanism <file>`, `--against <worktree>` |

## Commands

```sh
# 1. Multi-rule panel (--record caches exam-side data under data/derived/)
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/replay.ts \
  [--try <knobs>|standard]... [--mechanism <file>]... [--against <worktree>]... [--tree <worktree>] \
  [--from <tag|date>] [--logs <dir>] [--name <campaign>]... [--record <file>] [--refresh] [--split <tag|date>] [--named]

# 2. Single-tree archive reconciliation (must show read otherwise than stored = 0)
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/replay.ts \
  [--tree <worktree>] [--logs <dir>] [--since <date>] [--name <campaign>]... [--totals]

# 3. Per-run, per-promotion or single-meter repriced cost tables
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/table.ts \
  [--rows recent|runs|promotions|cost] [--since <date>] [--name <part>]... [--last 20] \
  [--has <text>]... [--holds <commit>]... [--format md|tsv]

# 4. Multi-week cohort trend & retention (--pack buffer --back 4 for control domain)
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/trend.ts \
  [--window 7] [--back 2] [--until <date>] [--pack <pack>]... [--any-setting] \
  [--has <text>]... [--holds <commit>]... [--bench <store> [--bench-tasks <list>]] [--format md|tsv]
```

## Reading panels & trends

- **Reconciliation**: default knobs at the originating tree must yield `read otherwise than stored = 0` on weighted reports.
- **Panel columns**: total steps (`+`/`-`), baseline tallies on added steps (`ahead`, `lvl`, `0-0`, `bhd`), `starter` confirmation rate, `A/A (could)` false-step rate, `repeat` sign agreement, median/per-step costs (`bill`, `turns`, `secs`, `$/step`, `h/step`), `by pack`.
- **Trends (`trend.ts`)**: truncates cohorts to a common elapsed-hour horizon (`FLOOR` = 6h) and runs campaign-level permutation (`shiftOf`, `LEVEL` = 0.05: `moved` | `inside the spread` | `too few runs`). `guardOf` pairs promotion speed (`promotions a 100 active hours`) with starter confirmations and post-promotion win rate (`together` | `apart` | `no single direction` | `not read`). `--bench <store>` joins digests to external scores vs Starter spread.

## Tuning protocol

1. Pre-register predictions in `.ana/wri/<date>-<what>/`.
2. Verify baseline reconciliation, then sweep via `--try`, `--mechanism` or `--against`.
3. Judge against an explicit bar:
   - *Gain*: promotions up or hours/promotion down, 0 A/A steps, no added step contradicted on repeat.
   - *Simplification*: keeps all rightful promotions, 0 added A/A steps, maintains hours/promotion, lowers `reduce-complexity` metrics.
4. Report aggregate counts, digests and campaign names only (no exam-side task measures); validate live only in a fresh run on operator approval (`AGENTS.md` §10, item 9).

## Related skills

- Scoring semantics & comparison scripts: [comparison-reading](../comparison-reading/SKILL.md)
- Framing claims & evidence rungs: [attribution-and-proof](../attribution-and-proof/SKILL.md)
- Per-run or comparison root-cause diagnosis: [whole-run-investigation](../whole-run-investigation/SKILL.md), [comparison-review](../comparison-review/SKILL.md)
- Landing approved rule changes & validating live: [stack-pr](../stack-pr/SKILL.md), [run-improvement-campaign](../run-improvement-campaign/SKILL.md)
