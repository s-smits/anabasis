---
name: comparison-reading
description: "Use before editing src/kernel/{compare,reports,size,solve}.ts or src/campaign/{comparison,round,decide,admission,climb}.ts. Explains readings (step, no-step, not-scored), task scores (pointsOf, WEIGHTS), significance testing (flipP, readsStep), A/A controls, task draws (poolOf, scoredSet, held-short), sample size, decide, and AGENTS.md sections 7 to 8. Scripts: size.ts, reading.ts, draw.ts, and starter-reads.ts. Use promotion-tuner to replay comparisons under alternative rules."
---

# Comparison reading

This skill expands `AGENTS.md` sections 7 and 8: how recorded solves are aggregated into a
comparison reading, what actions follow, and why each evaluation rule exists. Whenever a reference
disagrees with the source code, the source code is authoritative and the reference must be updated
in the same change. For phrasing experimental claims, consult `attribution-and-proof`; for auditing
a suspicious reading, use `whole-run-investigation`; for replaying historical logs under modified
rules, use `promotion-tuner`.

| Section | Reference | What it explains |
| --- | --- | --- |
| 7. The draw and the solves | `references/draw-and-solves.md` | Pre-logged terms, task selection (`poolOf`, `scoredSet`), arm mirroring, and how each solve ending counts |
| 7. The tally and the test | `references/tally-and-test.md` | `pointsOf`, `WEIGHTS`, `GAP_FLOOR`, `flipP`, `readsStep`, A/A controls, and reading classifications |
| 7. Limits and room | `references/limits-and-room.md` | Referee rulings, compute budget and dollar cap, `roomOf`, `stopRule`, and promotion |
| 7. The move table | `references/move-table.md` | The nine rows of `decide`, `roomless`, and supply patience |
| 8. Rules | `references/rules.md` | Rationale and edge cases for each evaluation rule |

## Scripts

All scripts call the production readers directly. Each supports `--help`, and `--host <name>` runs
it on a remote host (`.claude/skills/main/cli.ts`); campaign names are resolved across hosts.

```text
bun .claude/skills/comparison-reading/scripts/size.ts [--level <n>] [--untied <n>]
  [--scores <s,s,...> [--unbilled <s,s,...>]]
bun .claude/skills/comparison-reading/scripts/reading.ts <log.jsonl | campaign folder | name>
  [--comparison <id>] [--level <n>]
bun .claude/skills/comparison-reading/scripts/reading.ts --zone <log.jsonl | campaign name>...
bun .claude/skills/comparison-reading/scripts/draw.ts <log.jsonl | campaign name> [--target <n>] [--level <n>]
bun .claude/skills/comparison-reading/scripts/starter-reads.ts <log.jsonl | campaign folder | name> | --all [--since <date>] [--name <part>]
```

- `size.ts` performs power analysis: given a significance level and a count of untied tasks, it
  prints the minimum scored set capable of detecting a step, the admission floor, the clearing
  tallies, the minimum detectable win share, and the nominal false positive rate. Passing `--scores`
  evaluates a concrete vector of task scores (`--unbilled` omits cost fields).
- `reading.ts` prints every comparison in a log from its latest report: the reading, the tallied
  test result, scored task sets, both directions of the A/A control, remaining headroom, and
  excluded tasks. It flags any recorded reading that the current tree's `readsStep` would classify
  differently. Beneath each comparison, a zone line reports how many reference tasks had none, some,
  or all solves valid and what untied each task; under an objective, a gap line reports each arm's
  median ratio to the best recorded answer and how often it fell within `GAP_FLOOR` (a large gap can
  indicate either a strong candidate or a weak reference). This output is exam-side. `--zone` emits
  the zone counts alongside the A/A untied share as one TSV row per comparison across multiple logs.
  For task-by-task breakdown, including the largest task family's share of tallied frontier tasks and
  the candidate's tally per authoring session, run `bun tools/wri/wri.ts reader pairs --log <name>`.
- `draw.ts` predicts the next comparison: the held-out pool by partition, the task set it would fix,
  its granularity and overlap with the prior comparison, its frontier breakdown by epoch, admission
  floor and refusals (including `held-short`), and the power-analysis size lines, defaulting to the
  move table's target and level.
- `starter-reads.ts` audits what evidence supports each confirmed promotion. It partitions every
  starter comparison into tasks that selected the promoted harness versus tasks that did not
  (either authored earlier and undrawn, or authored after promotion), and reports the standalone
  reading on post-promotion tasks (`step`, step for the starter, `no-step`, or too few untied tasks).
  Post-promotion tasks are the only subset free from selection bias and therefore directly measure
  out-of-sample generalisation. Alongside this, it reports the reading over all tasks unselected by
  any preceding promotion (the reference's own or an ancestor's), since the "written before, not
  chosen on" bucket can still contain tasks that selected an ancestor and therefore carries residual
  selection bias. The script is reporting-only and alters no decision; `--all` aggregates across the
  archive and `--name` filters by substring (such as a pack name). The underlying fold is
  `starterReads` (`src/campaign/climb.ts`). Across multi-week cohorts, the same fold is analysed by
  `promotion-tuner`'s [trend.ts](../promotion-tuner/SKILL.md) alongside promotion cadence.

`size`, `reading`, and `draw` print counts, identifiers, short digests, and harness letters; they
never print task identities, answers, objective measures, or check code.
