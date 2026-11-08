---
name: design-and-seats
description: "Use before editing src/{builder,examiner,solver,referee,harness}/, a seat's prompt, tool description, tool result or home files, HARNESS.md or the starter. Explains what the evaluation measures (supply, climb, honesty, verdicts, economy), the wall (rule 3), code versus model decisions, what each seat reads and the operator's decisions (AGENTS.md sections 1–3). seat-view.ts names the wall tests a diff owes; examiner-view.ts and builder-view.ts print what the next opening would be told."
---

# Design and seats

This skill expands `AGENTS.md` sections 1 to 3, which state the invariants; the references hold the
mechanisms behind them. Where a reference disagrees with the source, the source wins and the
reference is corrected in the same change.

| Section | Reference |
| --- | --- |
| 1. The question and the four factors; v1's vocabulary | `references/question-and-factors.md` |
| 1. Two sides and one wall | `references/wall.md` |
| 2. Code owns the conditions, models own the content | `references/stance.md` |
| 3. Each seat's view and tools | `references/seats.md` |
| 3. The operator's decisions and the harness | `references/operator-and-harness.md` |

A change to anything a Builder or solver reads starts with `wall.md` and `seats.md`, then
`seat-view.ts`. A new limit, classifier or narrower grant first answers `stance.md`, consequences 3,
4 and 6. A change to a factor's reader or bar goes through `question-and-factors.md`. Changing the
harness's parts or the starter is described in `operator-and-harness.md` and done through
`harness-audit`.

## Scripts

Each reads the tree or a log through production readers.

```text
bun .claude/skills/design-and-seats/scripts/seat-view.ts [--base <rev>] [--file <path>]...
bun .claude/skills/design-and-seats/scripts/examiner-view.ts <log.jsonl | campaign name>
bun .claude/skills/design-and-seats/scripts/builder-view.ts <log.jsonl | campaign name> [--parent <digest>]
```

- `seat-view.ts` takes the changed files (the working tree against `--base`, by default the merge
  base with upstream, or each `--file`) and, for each seat, names the changed files its owners
  import with the shortest import chain, its wall tests and the `bun run test -- ...` line that runs
  them. Import reach over-states message reach, so read the chain before concluding. For one commit,
  pass `$(git diff-tree --no-commit-id --name-only -r <commit> | sed 's/^/--file=/')`.
- `examiner-view.ts` prints, as counts, what an Examiner session opening now would be told
  (`heard`, `src/examiner/record.ts`). It finds a campaign by name on any host.
- `builder-view.ts` prints the next Builder session's history messages (`src/builder/past.ts`),
  starting from `--parent` or from `--parent latest`. A held-out task, check or ruling in its output
  is a breach of rule 3, fixed in `past.ts` or `src/campaign/handover.ts`.

The first two print ids, paths and counts, never a check, hidden value or task text; the third
prints build-side text by construction.
