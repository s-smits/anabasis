---
name: design-and-seats
description: "Use before editing src/{builder,examiner,solver,referee,harness}/, a seat's prompt, tool description, tool result, or home files, HARNESS.md, or the starter. Explains what the evaluation measures (supply, climb, honesty, verdicts, economy), the information wall (rule 3), code versus model authority, what each seat may read, and the operator's decisions (AGENTS.md sections 1 to 3). seat-view.ts identifies the wall tests required by a diff; examiner-view.ts and builder-view.ts print what the next session opening would receive."
---

# Design and seats

This skill expands `AGENTS.md` sections 1 to 3, which state the system invariants; the reference
files below document the underlying mechanisms. Whenever a reference disagrees with the source code,
the source code is authoritative and the reference must be updated in the same change.

| Section | Reference |
| --- | --- |
| 1. The question and the four factors; v1 vocabulary | `references/question-and-factors.md` |
| 1. Two sides and one wall | `references/wall.md` |
| 2. Code owns the conditions, models own the content | `references/stance.md` |
| 3. Each seat's view and tools | `references/seats.md` |
| 3. The operator's decisions and the harness | `references/operator-and-harness.md` |

Before modifying anything a Builder or solver can read, consult `wall.md` and `seats.md`, then run
`seat-view.ts`. Before introducing a new limit, classifier, or narrower permission grant, verify it
against `stance.md` (consequences 3, 4, and 6). Changes to a factor's reader or threshold belong
under `question-and-factors.md` (and are audited across the system via [system-audit](../system-audit/SKILL.md)). When calibrating Examiner task difficulty (`src/examiner/ladder.ts`, `draft.ts`, `prompt.ts`), use [examiner-complexity](../examiner-complexity/SKILL.md) and paired live-seat rounds in [system-path-simulation](../system-path-simulation/cases/optimize.md). Changes to harness components or the starter are described in
`operator-and-harness.md` and audited through [harness-audit](../harness-audit/SKILL.md).

## Scripts

Each script inspects the repository or a campaign log through the production readers.

```text
bun .claude/skills/design-and-seats/scripts/seat-view.ts [--base <rev>] [--file <path>]...
bun .claude/skills/design-and-seats/scripts/examiner-view.ts <log.jsonl | campaign name>
bun .claude/skills/design-and-seats/scripts/builder-view.ts <log.jsonl | campaign name> [--parent <digest>]
```

- `seat-view.ts` inspects the changed files (either the working tree against `--base`, defaulting to
  the merge base with upstream, or each `--file` argument) and, for each seat, lists the changed
  files imported by its owners together with the shortest import chain, the relevant wall tests, and
  the `bun run test -- ...` command to run them. Import reachability is a conservative
  over-approximation of message reachability, so inspect the import chain before drawing
  conclusions. To inspect a single commit, pass
  `$(git diff-tree --no-commit-id --name-only -r <commit> | sed 's/^/--file=/')`.
- `examiner-view.ts` prints, as summary counts, what an Examiner session opening now would receive
  (`heard`, `src/examiner/record.ts`). It locates a campaign by name across hosts.
- `builder-view.ts` prints the history messages for the next Builder session (`src/builder/past.ts`),
  starting from `--parent` or from `--parent latest`. Any held-out task, check, or Referee ruling
  appearing in its output is a violation of rule 3 and must be fixed in `past.ts` or
  `src/campaign/handover.ts`.

The first two scripts emit identifiers, paths, and counts without exposing checks, hidden values, or
task text; the third prints build-side text by construction.
