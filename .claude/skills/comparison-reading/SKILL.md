---
name: comparison-reading
description: "How a comparison is read, in full, AGENTS.md sections 7 and 8: terms first, the scored draw (frontier, exhausted, retained), fresh solves and the mirror, how a solve ends and its part in a pair, the tally's three weighted measures and floors (WEIGHTS, ROOM, FULL, CHEAPER), the objective, the sign-flip test and the step with and without the bill, the reading words (step, no-step, not-scored, check-defects, no-change), rejections and the Referee, the budget, the A/A comparison, the dollar cap, room, improvement and supply patience, awaiting task review, promotion, the ten rows of decide, and the fifteen rules with their reasons. Use before changing or explaining compare, reports, size, comparison, round, decide, admission or climb; when a reading, a tally, an A/A or a promotion needs explaining; when asked how many tasks a step needs, which tallies clear the level, what the false rate or detectable share is, or why a comparison read what it read; and before citing a rule. Scripts print the size figures from the production test and every recorded comparison of a log."
---

# Comparison reading

The full account of `AGENTS.md` sections 7 and 8, under the same numbers and titles, so "section 7"
means the same section in `AGENTS.md` and here. `AGENTS.md` holds the invariants every session
carries, and this skill the mechanisms, owners and edge cases behind them. `AGENTS.md` owns the rules
(section 8) and the operator's decisions (section 3). The source at the stack's head, with each
module's head comment, outranks both. The other parts of the account are `design-and-seats`
(sections 1 to 3), `campaign-mechanics` (4 to 6), `comparison-reading` (7 and 8) and
`repository-practice` (9 to 14).

Section 7 answers one question: given a comparison's recorded solves, what did it read, and what
follows? Section 8 gives the fifteen rules with their reasons. Wording a claim from a reading is
`attribution-and-proof`'s; doubting one is `whole-run-investigation`'s; scoring recorded comparisons
again under other weights or a candidate tree is `promotion-tuner`'s.

## Where each section lives

| Reference | `AGENTS.md` section and its parts | The question it answers |
| --- | --- | --- |
| `references/draw-and-solves.md` | 7, "How a comparison is read": terms first; the scored draw (frontier, exhausted, retained); fresh solves; how a solve ends | What is fixed before the first solve, which tasks are scored, and how each ending counts in a pair |
| `references/tally-and-test.md` | 7: the tally; the objective; the test and the step; the reading; beside the test (the A/A comparison) | How a task is scored, what the test reads, and what each reading word means |
| `references/limits-and-room.md` | 7: rejections; the budget; the dollar cap; room for improvement; improvement patience; awaiting task review; promotion | What bounds a comparison, what room it left, and when a campaign stops or promotes |
| `references/move-table.md` | 7: what follows a reading (the ten rows of `decide`); supply patience | Which move comes next, and when supply runs out |
| `references/rules.md` | 8, "Rules": rules 1 to 15 with their reasons and edges | Why each rule holds, and where its edge is |

## If you are about to

| About to, or asking | Read or run |
| --- | --- |
| Change what `comparison.started` fixes, the draw (`poolOf`, `scoredSet`), the mirror or the endings of a solve | `references/draw-and-solves.md` |
| Change `pointsOf`, `WEIGHTS`, `ROOM`, `FULL`, `CHEAPER`, `flipP`, `stepOf`, `readsStep` or the A/A | `references/tally-and-test.md`, then `promotion-tuner` to replay the record |
| Ask how many tasks a step needs, which tallies clear the level, the false rate or the detectable share | `scripts/size.ts` |
| Ask whether a given set of task scores reads a step, with and without the bill | `scripts/size.ts --scores ... --unbilled ...` |
| Ask why a recorded comparison read `step`, `no-step` or `not-scored`, or what its A/A read | `scripts/reading.ts <log or name>`, then `references/tally-and-test.md` |
| Change a rejection's ruling path, the cap, the budget, `roomOf`, `stopRule` or promotion | `references/limits-and-room.md` |
| Explain or change the view's last line, a row of `decide`, or `roomless` | `references/move-table.md` |
| Cite a rule in a pull request or a review, or touch what a rule binds | `references/rules.md` |

## Scripts

Both are thin wrappers over production readers and compute nothing of their own; they print counts,
ids, short digests and harness letters, never a task, a family, an answer, a measure or a check.
Each takes `--help`, and `--host <name>` through `.claude/skills/main/cli.ts`.

```text
bun .claude/skills/comparison-reading/scripts/size.ts [--level <n>] [--untied <n>]
  [--scores <s,s,...> [--unbilled <s,s,...>]]
bun .claude/skills/comparison-reading/scripts/reading.ts <log.jsonl | campaign folder | name>
  [--comparison <id>] [--level <n>]
```

- `size.ts` prints, at a level and a count of untied tasks, the smallest scored set that reads a step
  (`sweepOf`), the admission floor (`comparisonFloor`) and the production's own size lines
  (`sizeLines`: the three smallest clearing tallies, the detectable share, the false rate). With
  `--scores` it reads one set of task scores (`testOf`, `power`, `detectable`, and `readsStep` with
  `--unbilled`).
- `reading.ts` prints every comparison of a log by its last report (`lastReports`; ladder readings
  of 14 to 16 October left out): the reading, the test with and without the bill, the frontier and
  retained sets, the A/A read either way (`readsStepEitherWay`), the room (`roomOf`) and the tasks
  left out, and marks a recorded reading the tree's `stepOf` reads otherwise. A name is found on any
  host through `logAcross`.
