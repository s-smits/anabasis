---
name: repository-practice
description: "Use when preparing commits or pull requests, writing PR descriptions, comments, or prompts, selecting tests and checks, or working near .ana/, .env, vendor/, or src/wall/. Explains evidence levels (present in source, proved without a model, exercised live), repository terminology, and directory ownership (AGENTS.md sections 9 to 14). preflight.ts reports the checks and labels required by a diff; direction.ts detects forbidden production-to-helper imports. Procedures belong to stack-pr, run-management, and attribution-and-proof; coding habits live in tools/oxlint/HABITS.md."
---

# Repository practice

This skill expands `AGENTS.md` sections 9 to 14. Whenever a reference disagrees with the source
code, the source code is authoritative and the reference must be updated in the same change.

| Section | Reference | What it explains |
| --- | --- | --- |
| 9. Status, evidence and claims | `references/evidence-and-claims.md` | Evidence required for each rung of the ladder and what claims a sentence may make |
| 10. Runs with a real model | `references/real-model-runs.md` | The nine run conditions, `/goal`, OS sandbox isolation on each platform, seat roots, and network policy |
| 11. Working in the repository | `references/working-in-the-repository.md` | Commands, Git hooks and CI, protected paths, stacked PRs and labels, reviews, and subagents |
| 12. Code that passes the first time | `references/code-and-writing.md` | Strict linting, dependency direction, and fact-based tests |
| 13. Writing | `references/code-and-writing.md` | Complete prose and comment style rules |
| 14. Terms and map | `references/terms-and-map.md` | Canonical terminology, the definition of a sed, and directory ownership |

Operational procedures live in separate skills: branching, pushing, and landing in `stack-pr`;
launching and managing runs in `run-management`; phrasing experimental claims in
`attribution-and-proof`; coding conventions in `tools/oxlint/HABITS.md` (read in full before writing
code); and seat reachability analysis in `design-and-seats` (`seat-view.ts`).

## What a change requires: `scripts/preflight.ts`

```text
bun .claude/skills/repository-practice/scripts/preflight.ts [--base <rev> | --commit <rev>] [--stack]
```

This script inspects the working tree relative to `HEAD` (including untracked files), relative to
`--base`, or a single commit relative to its parent via `--commit`, and queries each owner to
determine what the diff requires:

- whether the diff is documentation-only (`DOCUMENTATION`, `tools/runtime/gate.ts`);
- tests within one import hop of changed files, formatted as a `bun run test -- ...` command
  (`nearbyTests`);
- whether `bun run ui:gate` is needed due to changes in `packages/ui` or its configuration;
- each area of `tools/runtime/moments.ts` touched by the diff and its associated obligation (rule 3
  wall tests for `seats`, historical replay for `measurement`, rehearsal for `campaign`, and
  cross-platform verification for `wall`);
- source files exceeding 800 nonblank lines or functions exceeding 115 lines
  (`tools/loc/source-policy.ts`);
- `AGENTS.md` section 13 style violations in changed Markdown prose: em dashes, banned hype words,
  relative dates, exclamation marks, and American spellings;
- whether Git hooks are enabled, whether a paid run may launch from the current worktree
  (`treeFault`), and with `--stack`, where the branch sits on the open stack
  (`stack-pr/scripts/stack.ts`);
- a suggested `importance:` label and category inferred from changed paths (`CATEGORIES`,
  `tools/runtime/land.ts`), which the section 11 definitions and the operator confirm.

The script reads no campaign logs and executes no checks; `bun run commit:check` and `bun run gate`
perform actual validation. Its test suite lives in `test/repository-practice-script.test.ts`.

## Dependency direction: `scripts/direction.ts`

```text
bun .claude/skills/repository-practice/scripts/direction.ts [--file <path>]...
```

`AGENTS.md` section 12 enforces one-way dependencies that no lint rule currently checks. Using the
gate's import parser (`importsOf`), this script flags any import from production code (`src/`,
`vendor/`, `packages/`, and `tools/` outside `tools/wri/`, or each `--file` argument) into
`.claude/`, `tools/wri/`, `studies/`, or `test/`, exiting with status 1 if any violation is found.
Its tests live in `test/repository-practice-script.test.ts`.
