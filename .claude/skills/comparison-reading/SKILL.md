---
name: comparison-reading
description: "Use before editing src/kernel/{compare,reports,size,solve}.ts or src/campaign/{comparison,round,decide,admission,climb}.ts. Explain readings (step, no-step, not-scored), task scores (pointsOf, WEIGHTS), significance (flipP, readsStep), A/A controls, task draws (poolOf, scoredSet, held-short), sample size, decide or rule N (AGENTS.md sections 7–8). Scripts: size.ts, reading.ts and draw.ts. Use promotion-tuner to read comparisons under other rules."
---

# Comparison reading

This skill explains `AGENTS.md` sections 7 and 8, using the same section numbers. Read the reference
for the mechanism you are changing. `AGENTS.md` keeps the shared invariants, rules and operator
decisions; these references give their mechanisms and limits. When they disagree with current
source, check the source and correct the stale description.

Section 7 answers one question: given a comparison's recorded solves, what did it read, and what
follows? Section 8 gives the fifteen rules with their reasons. Wording a claim from a reading is
`attribution-and-proof` 's; doubting one is `whole-run-investigation` 's; scoring recorded
comparisons again under other rules is `promotion-tuner` 's.

## Where each section lives

| Reference | `AGENTS.md` section and its parts | The question it answers |
| --- | --- | --- |
| `references/draw-and-solves.md` | 7, "How a comparison is read": terms first; the scored draw (frontier, exhausted, retained); fresh solves; how a solve ends | What is fixed before the first solve, which tasks are scored, and how each ending counts in a pair |
| `references/tally-and-test.md` | 7: the tally; the objective; the test and the step; the reading; beside the test (the A/A comparison) | How a task is scored, what the test reads, and what each reading word means |
| `references/limits-and-room.md` | 7: rejections; the budget; the dollar cap; room for improvement; improvement patience; awaiting task review; promotion | What bounds a comparison, what room it left, and when a campaign stops or promotes |
| `references/move-table.md` | 7: what follows a reading (the nine rows of `decide`); supply patience | Which move comes next, and when supply runs out |
| `references/rules.md` | 8, "Rules": rules 1 to 15 with their reasons and edges | Why each rule holds, and where its edge is |

## If you are about to

| About to, or asking | Read or run |
| --- | --- |
| Change what `comparison.started` fixes, the draw (`poolOf`, `scoredSet`), the mirror or the endings of a solve | `references/draw-and-solves.md` |
| Change `pointsOf`, `WEIGHTS`, `ROOM`, `flipP`, `readsStep` or the A/A | `references/tally-and-test.md`, then `promotion-tuner` to replay the record |
| Ask how many tasks a step needs, which tallies clear the level, the false rate or the detectable share | `scripts/size.ts` |
| Ask whether a given set of task scores reads a step without the bill, and what they read with it | `scripts/size.ts --scores ... --unbilled ...` |
| Ask how far a comparison's sides stood from the best answer on record, or whether a large gap is a strong candidate or a weak reference | `scripts/gap.ts <log or name>` (exam-side output) |
| Ask what the next comparison would score, why it scored fewer tasks than its target, or why admission refuses `held-short` | `scripts/draw.ts <log or name>`, then `references/draw-and-solves.md` |
| Ask why a recorded comparison read `step`, `no-step` or `not-scored`, or what its A/A read | `scripts/reading.ts <log or name>`, then `references/tally-and-test.md` |
| Ask what a confirmed promotion rests on, or whether a harness holds on tasks that did not choose it | `scripts/starter-reads.ts <log or name>`, or `--all` for the record |
| Change a rejection's ruling path, the cap, the budget, `roomOf`, `stopRule` or promotion | `references/limits-and-room.md` |
| Explain or change the view's last line, a row of `decide`, or `roomless` | `references/move-table.md` |
| Cite a rule in a pull request or a review, or touch what a rule binds | `references/rules.md` |

## Scripts

Every script uses production readers for evaluation. `size`, `reading` and `draw` print counts, ids,
short digests and harness letters, omitting task identities, families, answers, objective measures
and checks; `gap` prints ratios drawn from objective measures, and names no task. Each takes `--help`, and `--host <name>` through `.claude/skills/main/cli.ts`.

```text
bun .claude/skills/comparison-reading/scripts/size.ts [--level <n>] [--untied <n>]
  [--scores <s,s,...> [--unbilled <s,s,...>]]
bun .claude/skills/comparison-reading/scripts/reading.ts <log.jsonl | campaign folder | name>
  [--comparison <id>] [--level <n>]
bun .claude/skills/comparison-reading/scripts/draw.ts <log.jsonl | campaign name> [--target <n>] [--level <n>]
bun .claude/skills/comparison-reading/scripts/gap.ts <log.jsonl | campaign name>
bun .claude/skills/comparison-reading/scripts/starter-reads.ts <log.jsonl | campaign folder | name> | --all [--since <date>] [--name <part>]
```

- `starter-reads.ts` splits each promotion's starter read into the tasks that chose the harness, those
  written before and not drawn then, and those written after, each with its whole tally, the tasks on
  which validity differed and the rest. Each read names its sides, since a read has the reference on
  the old side. It also says whether the tasks that did not choose the harness read a step alone, and
  gives the tally on each writing session's tasks. With
  `--all` it sums each campaign and then all of them, and `--name` keeps the campaigns whose name holds
  a text, such as a pack. The fold is `starterReads` (`src/campaign/climb.ts`), and `runs alerts` prints
  the written-after tally beside each starter read. It decides no move.

- `size.ts` prints, at a level and a count of untied tasks, the smallest scored set that reads a step
  (`sweepOf`), the admission floor (`comparisonFloor`) and the production's own size lines
  (`sizeLines`: the three smallest clearing tallies, the detectable share, the false rate), then
  every clearing tally that fits (`clearing`). With
  `--scores` it reads one set of task scores (`testOf`, `power`, `detectable`, and `readsStep` with
  `--unbilled`).
- `reading.ts` prints every comparison of a log by its last report (`lastReports`; older ladder readings
  left out): the reading, the test as tallied (and without the bill in an older report that holds `unbilled`,
  which the step read), the frontier and
  retained sets, the A/A read either way (`readsStepEitherWay`), the room (`roomOf`) and the tasks
  left out, and marks a recorded reading the tree's `readsStep` reads otherwise. A name is found on any
  host through `logAcross`.
- `draw.ts` prints the held-out pool by its parts (`poolOf`: frontier, retained, exhausted, awaiting
  task review), the set a comparison starting now would fix (`scoredSet`, under the frozen contract),
  its frontier tasks by epoch (`tasksByEpoch`), comparison admission's floor and refusal codes
  (`comparisonFloor`, `refusals`), and `sizeLines` for that set, at the target and level the table
  asks under (`planOn`) unless `--target` or `--level` names others.
- `gap.ts` prints, for each comparison tallied under an objective, each side's median ratio to the
  best answer on record (`bests`, `poolOf`), and on how many tasks it came within the floor of it:
  a large gap can be a strong candidate or a weak reference, and a task score does not say which.
  Its output comes from hidden values, so it stays exam-side.
