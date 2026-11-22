---
name: promotion-tuner
description: "Evaluate recorded comparisons off-policy under alternative promotion rules without model calls or spend. `scripts/replay.ts` checks whether a tree's scoring rule reproduces recorded promotions and identifies which measure won each task, and with `--try`, `--mechanism`, or `--against` compares alternative rules (weights, cost/turn/time gains or guards, gap floors, statistical tests, significance levels, or custom code) on a unified panel. `scripts/table.ts` tabulates runs and promotions (and with `--rows cost` reprices them on a single meter). `scripts/trend.ts` compares recent weeks against prior windows with campaign-level permutation tests, pairing climb rate with retention and optional external benchmark scores (`--bench`). Off-policy replay never establishes a live improvement."
---

# Promotion tuner

In production, each comparison scores tasks by weighted validity and objective margins over paired solves, and a one-sided sign-flip test over non-zero task scores must clear the significance level to trigger a promotion (`AGENTS.md`, section 7). This skill evaluates alternative promotion rules off-policy against archived solves: it executes no solves, calls no models, and modifies no campaign logs. Changes to model prompts are tuned separately using paired live seats ([optimize](../system-path-simulation/cases/optimize.md)).

Because every parameter of the promotion rule is an operator-controlled experimental condition, a sweep produces evidence and a recommendation rather than an automatic change. Altering a scoring rule does not improve any harness, and **an off-policy replay never establishes a live improvement**.

## What can be tuned

| Parameter | Production owner | `--try` knob |
| --- | --- | --- |
| Weights on validity and objective | `WEIGHTS`, `src/kernel/compare.ts` (in steps of five) | `validity=`, `objective=` |
| Resource metric as a gain | none in production | `bill=`, `turns=`, `seconds=`, with `when=`, `side=`, `lead=`, `floor=` |
| Resource metric as a guard | none in production | `mostBill=`, `mostTurns=`, `mostSeconds=` |
| Objective gap floor and gain shape | `GAP_FLOOR`, `pointsOf` | `room=`, `gain=` |
| Statistical test | `flipP`, `readsStep` | `test=`, `untied=`, `level=` |
| Independent unit of the test | each task (`pairsOf`) | `unit=` (`family`, `first`) |
| Task inclusion filter | `scoredSet` | `retained=` |
| Arbitrary custom logic | | a `--mechanism` file, or a candidate worktree via `--against` |

`scripts/mechanisms.ts` documents every knob. Legacy trees that also weighted solve cost are scored accordingly when `--tree` points to them (`Points`, `scripts/tree.ts`).

## The panel

```sh
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/replay.ts \
  [--try <knobs>|standard]... [--mechanism <file>]... [--against <worktree>]... [--tree <worktree>] \
  [--from <tag or date>] [--logs <dir>] [--name <campaign>]... [--record <file>] [--refresh] \
  [--split <tag or date>] [--named]
```

Passing any of `--try`, `--mechanism`, `--against`, `--split`, or `--named` switches output from the standard replay to the comparison panel; omitting the first three evaluates a default sweep (`--try standard`). `--try bill=0.1,lead=answers` overrides current defaults, whereas a `--mechanism` file exports `Mechanism` definitions with custom `score`, `test`, and `guard` functions. `--record <file>` caches the reduced dataset under `data/derived/` (exam-side data: keep out of prompts, pull requests, and pastes), `--refresh` re-reads raw logs, `--split` reports step rates before and after a release tag or date, and `--named` lists each comparison added or dropped by a candidate row. **Check the reconciliation lines first**: today's default knobs must differ from the baseline tree's stored scores on 0 tasks.

Evaluate each panel row across all columns rather than by promotion count alone:

| Column | Meaning | Potential pitfall |
| --- | --- | --- |
| steps, `+`, `-` | total promotions relative to the baseline tree | more promotions does not imply a better rule |
| ahead, lvl, 0-0, bhd | baseline tree's tally on newly added steps | a `0-0` step rests on no valid-answer advantage |
| starter | starter confirmation reads favouring the reference | sample sizes are small and favour what the climb selected for |
| A/A (could) | A/A false steps over A/A controls with sufficient power to step | dividing by all A/A controls artificially lowers the false-positive rate |
| repeat | sign agreement on subsequent independent solves | resource usage habits repeat even without quality gains |
| bill, turns, secs, $/step, h/step | medians and cost per step | hard guards trigger on maxima rather than medians |
| by pack, moved, same/other/none/unread | domain mix, altered scores, and subsequent fate of added steps | runs without later readings are right-censored |
| confirmed/of, kept then not | recorded promotions confirmed by starter reads, split by whether the rule steps on them | pooled rates conflate domain mixes; packs with few task families lose every step |

Empirical regularities on the archive: weight adjustments alter score margins but rarely flip readings; any scoring function must be antisymmetric under side swapping to avoid bias in the A/A control; guards only veto steps (inspect the largest ratio first), whereas only a gain term rewards resource savings; wall-clock time tracks host load and replicates more poorly than dollar cost; always replay the baseline tree before evaluating candidate rules.

## The replay

```sh
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/replay.ts [--tree <worktree>] \
  [--logs <dir>] [--since <date>] [--name <campaign>]... [--totals]
```

`--tree` specifies the absolute path of the worktree whose kernel scores the archive (defaulting to the current checkout); the totals block records its commit hash and any uncommitted `src/` changes, and refuses trees lacking weighted scoring. By default, the run registry discovers campaigns across all worktrees, archives, and configured hosts (`ANA_HOSTS`); `--logs` reads an offline directory layout `<logs>/<any>/.ana/d2/<name>/log.jsonl`, selecting the largest copy of each campaign. Seeds, rehearsals, and `sim-`, `rh-`, or `test-` runs are excluded (`campaignLogs`, `rehearsed`, `.claude/skills/main/logs.ts`). `--since` defaults to five days prior, `--name` overrides the date filter, and `--totals` prints only aggregate summaries. Because live logs grow continuously, run baseline and candidate replays close together and record the timestamp. The script loads external trees exclusively via `loadTree`.

For every harness pair, the replay prints the first comparison that steps (`W-L-T`, p-value) classified as `rightful`, `in doubt` (its A/A control stepped, or a subsequent reading of the same pair lost more tasks than it won), or `added by this score`; **which measure won each task** (validity, the objective, or under legacy trees the bill alone, which motivated removing cost from the score); pairs that never step, marked `NOT PROMOTED by this score`; and per-epoch hours and spend broken down across Examiner, comparisons, and Builder (`scripts/time.ts`).

**Inspect reconciliation before interpreting counts.** Reports generated under weighted scoring store per-measure points, so replaying at the originating tree must yield `read otherwise than stored = 0`; any non-zero count indicates either a candidate rule change or a replay bug and must be explained first. Legacy reports tallied rule-by-rule lack stored points, so `reading otherwise than recorded` measures the impact of switching to weighted scoring rather than a defect.

A/A controls pair mirrored halves of the reference's own solves (`pairsOf`, `halves: "mirrored"`), and `readsStepEitherWay` evaluates two-sided steps on unbilled scores; any A/A step is a false positive by construction. A `rightful` classification indicates only that the recorded solves support promotion under this scoring rule; it cannot detect a lucky draw, which is addressed by the A/A control and subsequent fresh readings. Whether promotions produced genuine capability gains is assessed in lane 14 of `whole-run-investigation`.

## Every run side by side

```sh
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/table.ts \
  [--rows recent|runs|promotions] [--since <date>] [--name <part>]... [--last 20] \
  [--has <text>]... [--holds <commit>]... [--format md|tsv]
```

This script tabulates one row per run or per promotion without rescoring. **`recent`** (the default) lists live runs alongside the twenty most recent runs that promoted, separating initial setup hours from hours and spend per subsequent promotion. **`runs`** reports per-run counts for the trend metrics, including validity headroom and steps won on validity (`validityOf`): without validity headroom, a run can promote only on the objective. `--has` and `--holds` filter to runs whose every launch included a given mechanism (`ranWith`). Active hours exclude recorded waits (`waitsOf`, `tools/wri/time.ts`). Each row is computed by `.claude/skills/main/runs.ts` (`runOf`) and pairs climb counts with retention metrics: promotions read and confirmed by starter comparisons, and the reference's tally on tasks written after its promotion (`starterReads`; comparison-reading's [starter-reads.ts](../comparison-reading/SKILL.md) inspects a single run). Because a single run is one draw, group-level comparisons across runs belong exclusively to `trend.ts`.

## Then and now

```sh
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/trend.ts \
  [--window 7] [--back 2] [--until <date>] [--pack <pack>]... [--any-setting] \
  [--has <text>]... [--holds <commit>]... [--bench <store> [--bench-tasks <list>]] [--format md|tsv]
```

This script compares recent runs against runs from one or more prior weeks, stratified by pack. Each run is assigned to a window by its opening date; earlier windows retain only runs matching a setting present in the newest window, and each window lists its release tags because differences across minor releases are observational rather than causal. Because recent runs are younger and often paused at their trigger, each block evaluates every run at a common age horizon: the shortest active duration (at least six hours) among recent runs that were cut short (live, paused, killed, or stopped by the operator). Runs cut short before that horizon are excluded and counted, runs that terminated naturally are read at completion, and the block header states the horizon. `--until` truncates all logs to a fixed timestamp for reproducibility. Each metric difference undergoes a campaign-level permutation test (`.claude/skills/main/stats.ts`), classified as `moved` (p <= 0.05), `inside the spread`, or `too few runs` when no permutation can achieve that significance level. The closing line counts each pack's tests once, excluding the pooled block; remember that 1 in 20 tests reads `moved` by chance, and tests sharing runs are correlated. `--back 4 --pack buffer` is the standard control check from `AGENTS.md`, section 10. Because slow starts have two distinct causes, hours to first comparison are split into supply time (until comparison admission passes) and delay from admission to launch (`heldOff`, `tools/runs/view.ts`).

**Climb rate versus retention.** Higher promotion rates represent real progress only when promotions hold, so one summary line per window pairs promotions per 100 active hours with the starter-confirmed share and the reference's win rate on post-promotion tasks, classifying the pattern as `together`, `apart` (faster promotions with weaker retention, consistent with overfitting to comparisons), `no single direction`, or `not read`. Treat this as a diagnostic lead for [comparison-review](../comparison-review/SKILL.md) or [whole-run-investigation](../whole-run-investigation/SKILL.md) rather than a standalone finding.

**External benchmark alignment.** `--bench <store>` reads judged records from a benchmark store (`scripts/outside.ts`, populated by run-improvement-campaign's "The outside aim") and joins each arm to the promotion that produced its digest, comparing its score against the Starter's minimum and maximum sums on the same tasks. Pass `--bench-tasks <list>` to inspect one benchmark partition in isolation, since partitions are never summed together. A starter-confirmed promotion that remains inside or below the Starter's spread warrants investigation, checking experimental conditions first. External benchmark scores never promote a harness and never reach any model seat (`AGENTS.md`, section 1). Frame any empirical claim from either table using [attribution-and-proof](../attribution-and-proof/SKILL.md).

Because `table.ts` uses each run's historical billing meter, reprice all runs on a single meter before claiming a cost reduction across cycles:

```sh
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/table.ts --rows cost \
  [--since <date>] [--name <part>]... [--format md|tsv]
```

This reprices every recorded turn using the current `seatMeter` alongside the originally recorded bill, per promotion and per confirmed promotion; on newer runs, a `repriced/recorded` ratio just below 1 reflects backend overhead such as compactions and retries. `trend.ts` pools repriced dollars per promotion by window.

## Tuning the score

1. **Predict before running**, in `.ana/wri/<date>-<what>/`: specify for each candidate mechanism which step-5 metrics will move and in which direction. Reading a sweep before recording predictions turns tuning into post-hoc description.
2. Inspect the panel's reconciliation lines and baseline tree row; save a `--record` snapshot if a frozen comparison corpus is needed.
3. Evaluate candidate mechanisms via `--try` or a `--mechanism` file, stepping weights in increments of five.
4. When knobs cannot express a candidate rule, create a single-change worktree branched from `origin/main` via [stack-pr](../stack-pr/SKILL.md) and evaluate it with `--against`.
5. Recommend changes against one explicit acceptance bar. **For a gain**: promotions increase or hours per promotion decrease, A/A false steps remain zero, and no newly added promotion is contradicted by later readings (promotions lacking later readings are marked untested). **For simplification ("as good, and simpler")**: removing a floor, measure, or branch preserves all rightful promotions, adds no A/A step, maintains hours per promotion, and reduces complexity under `reduce-complexity` metrics. Report won-by counts beside each candidate and resolve every prediction as held or missed.
6. Include both tables as counts in the pull request, with reconciliation explained.
7. Validate live only with operator approval, in a fresh campaign launched from a prompt at the candidate commit with predictions recorded before the first solve (`AGENTS.md`, section 10, item 9).

Because off-policy replay evaluates harness pairs along the historical trajectory, it cannot model counterfactual campaigns: an earlier promotion would alter the reference harness, subsequent tasks, and later comparisons; unexecuted readings have no solves; and rewarding a different metric shifts what the Builder optimises for.

## The wall and the report

Campaign logs remain exam-side (`AGENTS.md`, sections 5 and 8): include only aggregate script outputs (counts, identifiers, digests, and campaign names) in pull requests. Structure the report in order: trees, commits, mechanisms, and reading timestamps; reconciliation counts; recorded promotions classified as rightful, in doubt (with reasons), or rejected; each candidate compared against baseline on its step-5 bar with prediction outcomes and won-by counts; and excluded campaigns, legacy reports read from stored differences, and live counts subject to change.
