---
name: comparison-reading
description: "Use before editing or answering questions about src/kernel/{compare,reports,size,solve}.ts, src/campaign/{comparison,round,decide,admission,climb}.ts, comparison readings (step, no-step, not-scored), scoring, A/A controls, or task draws. Explains pointsOf, WEIGHTS, flipP, isSignificant, poolOf, scoredSet, held-short, sample size, decide, and AGENTS.md sections 7 to 8. Scripts: size.ts, reading.ts, draw.ts, and starter-reads.ts. Use promotion-tuner to replay comparisons under alternative rules."
---

# Comparison reading

Expands `AGENTS.md` §7–8: how solves become a comparison reading, what move follows, and why each rule holds. Source code is authoritative; update any diverging reference in the same change.

| Section | Reference | Covers |
| --- | --- | --- |
| 7. Draw & solves | `references/draw-and-solves.md` | Pre-logged terms, `poolOf`, `scoredSet`, arm mirroring, solve outcomes |
| 7. Tally & test | `references/tally-and-test.md` | `pointsOf`, `WEIGHTS`, `GAP_FLOOR`, `flipP`, `isSignificant`, A/A, reading kinds |
| 7. Limits & room | `references/limits-and-room.md` | Referee rulings, budget/cap, `evalHeadroom`, `stopRule`, promotion |
| 7. Move table | `references/move-table.md` | Nine rows of `decide`, `roomless`, supply patience |
| 8. Rules | `references/rules.md` | Rationale & edge cases per evaluation rule |

## Scripts (call production folds; support `--help`, `--host <name>`, cross-host names)

```sh
bun .claude/skills/comparison-reading/scripts/size.ts [--level <n>] [--untied <n>] [--scores <s,...> [--unbilled <s,...>]]
bun .claude/skills/comparison-reading/scripts/reading.ts <log|dir|name> [--comparison <id>] [--level <n>]
bun .claude/skills/comparison-reading/scripts/reading.ts --zone <log|name>...
bun .claude/skills/comparison-reading/scripts/draw.ts <log|name> [--target <n>] [--level <n>]
bun .claude/skills/comparison-reading/scripts/starter-reads.ts <log|dir|name> | --all [--since <date>] [--name <part>]
```

- `size.ts`: power analysis—min scored set, admission floor, clearing tallies, MDE, nominal false-positive rate (`--scores` evaluates a concrete vector).
- `reading.ts`: prints every comparison's reading, test tally, scored sets, both A/A directions, headroom, excluded tasks, any disagreement with current `isSignificant`, zone breakdown and objective gap vs `GAP_FLOOR` (exam-side; `--zone` outputs TSV across logs; for task-level family shares run `bun tools/wri/wri.ts reader pairs --log <name>`).
- `draw.ts`: predicts the next draw's partitions, overlap, epoch frontier breakdown, admission floor/refusals (`held-short`) and power lines.
- `starter-reads.ts` (`starterReads`, `src/campaign/climb.ts`): partitions starter confirmations into selecting vs unselected/post-promotion tasks (post-promotion is the sole subset free of selection bias) and tracks all-ancestors-unselected tasks; reporting-only (`--all`, `--name <part>`).

`size`, `reading` and `draw` never print task identities, answers, objective measures or check code.

## Related skills

- Off-policy rule replays & cohort trends: [promotion-tuner](../promotion-tuner/SKILL.md)
- Claim phrasing & evidence rungs: [attribution-and-proof](../attribution-and-proof/SKILL.md)
- Auditing suspicious readings or deep gap diagnosis: [whole-run-investigation](../whole-run-investigation/SKILL.md), [comparison-review](../comparison-review/SKILL.md)
- Cross-solver comparisons: [compare-systems](../compare-systems/SKILL.md)
