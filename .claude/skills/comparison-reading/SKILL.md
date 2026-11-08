---
name: comparison-reading
description: "Use before editing src/kernel/{compare,reports,size,solve}.ts or src/campaign/{comparison,round,decide,admission,climb}.ts. Explains readings (step, no-step, not-scored), task scores (pointsOf, WEIGHTS), significance (flipP, readsStep), A/A controls, task draws (poolOf, scoredSet, held-short), sample size, decide and rule N (AGENTS.md sections 7–8). Scripts: size.ts, reading.ts, draw.ts, gap.ts and starter-reads.ts. Use promotion-tuner to read comparisons under other rules."
---

# Comparison reading

This skill expands `AGENTS.md` sections 7 and 8: how recorded solves become a reading, what
follows, and why each rule holds. Where a reference disagrees with the source, the source wins and
the reference is corrected in the same change. Wording a claim is `attribution-and-proof`'s,
doubting a reading `whole-run-investigation`'s, and rescoring the record under another rule
`promotion-tuner`'s.

| Section | Reference | What it explains |
| --- | --- | --- |
| 7. The draw and the solves | `references/draw-and-solves.md` | the terms fixed first, which tasks are scored (`poolOf`, `scoredSet`), the mirror, how each ending counts |
| 7. The tally and the test | `references/tally-and-test.md` | `pointsOf`, `WEIGHTS`, `ROOM`, `flipP`, `readsStep`, the A/A and each reading word |
| 7. Limits and room | `references/limits-and-room.md` | rulings, the budget and cap, `roomOf`, `stopRule`, promotion |
| 7. The move table | `references/move-table.md` | the nine rows of `decide`, `roomless`, supply patience |
| 8. Rules | `references/rules.md` | each rule's reason and edge |

## Scripts

All read through production readers. Each takes `--help`, and `--host <name>` runs it on another
host (`.claude/skills/main/cli.ts`). A name is found on any host.

```text
bun .claude/skills/comparison-reading/scripts/size.ts [--level <n>] [--untied <n>]
  [--scores <s,s,...> [--unbilled <s,s,...>]]
bun .claude/skills/comparison-reading/scripts/reading.ts <log.jsonl | campaign folder | name>
  [--comparison <id>] [--level <n>]
bun .claude/skills/comparison-reading/scripts/draw.ts <log.jsonl | campaign name> [--target <n>] [--level <n>]
bun .claude/skills/comparison-reading/scripts/gap.ts <log.jsonl | campaign name>
bun .claude/skills/comparison-reading/scripts/starter-reads.ts <log.jsonl | campaign folder | name> | --all [--since <date>] [--name <part>]
```

- `size.ts` is the power analysis: at a level and a count of untied tasks it prints the smallest
  scored set that can read a step, the admission floor, the clearing tallies, the detectable share
  and the false rate. With `--scores` it tests one set of task scores
  (`--unbilled` without the bill).
- `reading.ts` prints every comparison in a log by its last report: the reading, the test as
  tallied, the scored sets, the A/A either way, the room and the tasks left out. It flags a recorded
  reading that this tree's `readsStep` would read otherwise.
- `draw.ts` predicts the next comparison: the held-out pool by part, the set it would fix, its
  frontier by epoch, admission's floor and refusals (`held-short` among them) and the size lines, at
  the table's target and level by default.
- `gap.ts` prints each side's median ratio to the best answer on record and how often it came within
  the floor. A large gap can mean a strong candidate or a weak reference. Its output is exam-side.
- `starter-reads.ts` asks what a confirmed promotion rests on. It splits each starter read into the
  tasks that selected the harness and those that did not (written before but undrawn, or after),
  and says whether the latter read a step alone: generalisation rather than selection bias. `--all`
  sums the record, `--name` filters by a text such as a pack. The fold is `starterReads`
  (`src/campaign/climb.ts`).

`size`, `reading` and `draw` print counts, ids, short digests and harness letters, never task
identities, answers, objective measures or checks.
