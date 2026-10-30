---
name: design-and-seats
description: "The design of Anabasis v2 in full, AGENTS.md sections 1 to 3: the question every mechanism serves, the four reported factors with their bars and owners (supply, climb, honesty, verdicts, economy), the two sides and the wall, what changed from v1, which decisions code owns and which models own and their seven consequences, each seat's job, view and tools (Examiner, Builder, Solver, Verifier, Referee, Host), what the Examiner reads, the operator's seven decisions and what a launch decides for them, and the parts of a harness. Use before changing what a seat reads, is told or may do, a prompt, a tool, the wall's grants, the harness contract or a factor's reader; before a pull request that touches a Builder's, solver's or Examiner's message (rule 3: which seats a diff reaches and which wall tests to run); when asked what an Examiner session is told of a campaign; and when asked how the system is meant to work or why a decision sits with code or a model."
---

# Design and seats

The full account of `AGENTS.md` sections 1 to 3, under the same numbers and titles, so "section 7"
means the same section in `AGENTS.md` and here. `AGENTS.md` holds the invariants every session
carries, and this skill the mechanisms, owners and edge cases behind them. `AGENTS.md` owns the rules
(section 8) and the operator's decisions (section 3). The source at the stack's head, with each
module's head comment, outranks both. The other parts of the account are `design-and-seats`
(sections 1 to 3), `campaign-mechanics` (4 to 6), `comparison-reading` (7 and 8) and
`repository-practice` (9 to 14).

This file routes; the account itself is in `references/`, each file opening with when to read it.
Three questions run through it: what a comparison is for and how its worth is judged (section 1),
who decides each thing, code or a model (section 2), and what each seat does and reads, and what is
left to the operator (section 3).

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
