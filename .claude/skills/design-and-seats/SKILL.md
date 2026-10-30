---
name: design-and-seats
description: "Explain or change Anabasis's design, reported factors, seat responsibilities, model-visible information or harness structure (AGENTS.md sections 1 to 3). Use seat-view.ts to trace imports and identify wall tests, and examiner-view.ts to summarise an Examiner opening."
---

# Design and seats

This skill explains `AGENTS.md` sections 1 to 3, using the same section numbers. Read the reference
for the mechanism you are changing. `AGENTS.md` keeps the shared invariants, rules and operator
decisions; these references give their mechanisms and limits. When they disagree with current
source, check the source and correct the stale description.

The references answer three questions: what the evaluation measures (section 1), which decisions
belong to code or models (section 2), and what each seat can do and read (section 3).

## Where each section is

| Section of `AGENTS.md` | Reference |
| --- | --- |
| 1. What Anabasis v2 does: the question, "The four reported factors", "What changed from v1" | `references/question-and-factors.md` |
| 1. What Anabasis v2 does: "Two sides and one wall" | `references/wall.md` |
| 2. The stance: code owns the conditions, models own the content | `references/stance.md` |
| 3. The seats: the seats' table, what the Examiner reads and never reads, each seat's tools | `references/seats.md` |
| 3. The seats: "What waits for the operator", "The harness" | `references/operator-and-harness.md` |

## Routing

| If you are about to, or asking | Read |
| --- | --- |
| Change a prompt, a tool description, a tool result or a home file a Builder or a solver reads | `references/wall.md`, then `references/seats.md`; run `scripts/seat-view.ts` |
| Open a pull request whose diff may touch a seat's message (rule 3 asks how it was checked) | run `scripts/seat-view.ts`, and the `bun run test` line it prints |
| Change what the Examiner is told of the log (`src/examiner/record.ts`), or ask what a session there was told | `references/seats.md`, "What the Examiner reads"; run `scripts/examiner-view.ts` on the log |
| Change the Referee's view or evidence rules | `references/seats.md`, then `references/question-and-factors.md`, "3. Verdicts" |
| Add a limit, a classifier, a check on content, or a narrower grant of the wall | `references/stance.md`, consequences 3, 4 and 6 |
| Add a mechanism, or decide whether code or a model owns a decision | `references/stance.md` |
| Change a factor's reader or bar: supply, the climb, the A/A comparison, the Referee's agreement, economy | `references/question-and-factors.md` |
| Read an old comment that cites a v1 rule, or a v1 word (cycle, sweep, bundle, ladder) | `references/question-and-factors.md`, "What changed from v1" |
| Decide whether a decision is the operator's, or ask the operator for one | `references/operator-and-harness.md` (the list itself is in `AGENTS.md` section 3) |
| Change what a launch decides, `--hitl`, `--admit-authored` or `--despite` | `references/operator-and-harness.md` |
| Change the harness's parts, its digest, the starter or `HARNESS.md` | `references/operator-and-harness.md`, "The harness"; the procedure is `harness-audit`'s |

## Scripts

Both read the tree or a log through production readers, and print ids, paths and counts, never a
check, a hidden value or task text.

```text
bun .claude/skills/design-and-seats/scripts/seat-view.ts [--base <rev>] [--file <path>]...
bun .claude/skills/design-and-seats/scripts/examiner-view.ts <log.jsonl | campaign name>
```

- `seat-view.ts` takes the files a change touches (the working tree against `--base`, by default the
  merge base with HEAD's upstream, untracked files included; or each `--file`) and names, for the
  Builder, the solver, the Examiner and the Referee, every changed file that one of the seat's
  owners imports at any depth, with the shortest chain of imports, then that seat's wall tests and
  the `bun run test -- ...` line that runs them. Import reach over-states message reach, since most
  of the kernel is imported by every seat: read the chain before you conclude. It refuses to run when
  a seat's owner or a named wall test has left the tree (`SEATS` in the script). For one commit, pass
  its files: `$(git diff-tree --no-commit-id --name-only -r <commit> | sed 's/^/--file=/')`.
- `examiner-view.ts` finds a campaign by name on any host or takes a log path (`logAcross`,
  `logEvents`), calls `heard` (`src/examiner/record.ts`) on it and prints what an Examiner session
  opening now would be told, in counts: its lines, the outcomes by kind (`poolOf`), the summary
  sentence (`measuredLine`), the promotion line, and the refused and interrupted drafts. Over a
  stored pack its task lines are fewer than a session's, since it lists only proposed tasks.
