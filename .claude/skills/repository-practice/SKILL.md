---
name: repository-practice
description: "Use when preparing commits or PRs, writing their bodies, comments or prompts, choosing tests and checks, or working near .ana/, .env, vendor/ or src/wall/. Explains evidence levels (present in source, proved without a model, exercised live), terminology and directory ownership (AGENTS.md sections 9–14). preflight.ts says which checks and labels a diff owes; direction.ts finds production-to-helper imports. Procedures belong to stack-pr, run-management and attribution-and-proof; coding habits are in tools/oxlint/HABITS.md."
---

# Repository practice

This skill expands `AGENTS.md` sections 9 to 14. Where a reference disagrees with the source, the
source wins and the reference is corrected in the same change.

| Section | Reference | What it explains |
| --- | --- | --- |
| 9. Status, evidence and claims | `references/evidence-and-claims.md` | what each level of the ladder needs, and what a sentence may claim |
| 10. Runs with a real model | `references/real-model-runs.md` | the nine conditions, `/goal`, the OS wall on each platform, seat roots and the network |
| 11. Working in the repository | `references/working-in-the-repository.md` | commands, hooks and CI, the never-touch list, the stack and labels, reviews and subagents |
| 12. Code that passes the first time | `references/code-and-writing.md` | strict lint, the dependency direction, tests of facts |
| 13. Writing | `references/code-and-writing.md` | the writing rules in full |
| 14. Terms and map | `references/terms-and-map.md` | each term's one meaning, the sed, which directory owns what |

The procedures live elsewhere: pushing and landing in `stack-pr`, runs in `run-management`, claims
in `attribution-and-proof`, coding habits in `tools/oxlint/HABITS.md` (read whole before coding),
and which seat a change reaches in `design-and-seats`'s `seat-view.ts`.

## What a change owes: `scripts/preflight.ts`

```text
bun .claude/skills/repository-practice/scripts/preflight.ts [--base <rev> | --commit <rev>] [--stack]
```

It reads the working tree against `HEAD` (untracked files included), against `--base`, or one
commit against its parent with `--commit`, and asks each owner what the diff owes:

- whether it is documentation only (`DOCUMENTATION`, `tools/runtime/gate.ts`);
- the tests one import away, as a `bun run test -- ...` line (`nearbyTests`);
- `bun run ui:gate`, where `packages/ui` or its setup changed;
- each area of `tools/runtime/moments.ts` it enters, with what that area owes (rule 3's wall tests
  for `seats`, a replay for `measurement`, a rehearsal for `campaign`, the other platform for
  `wall`);
- files over 800 nonblank lines or functions over 115 (`tools/loc/source-policy.ts`);
- section 13's slips in changed Markdown prose: em dashes, banned words, relative dates,
  exclamation marks, American spellings;
- whether hooks are on, whether a run may start here (`treeFault`), and with `--stack` where the
  branch sits on the open stack (`stack-pr/scripts/stack.ts`);
- a suggested `importance:` label and category from the paths (`CATEGORIES`,
  `tools/runtime/land.ts`), which the definitions in section 11 and the operator settle.

It reads no log and runs no check; `bun run commit:check` and the gate validate. Its tests are in
`test/repository-practice-script.test.ts`.

## The dependency direction: `scripts/direction.ts`

```text
bun .claude/skills/repository-practice/scripts/direction.ts [--file <path>]...
```

Section 12 lets dependencies run one way, which no lint rule checks. With the gate's import reader
(`importsOf`) it names each import from production (`src/`, `vendor/`, `packages/`, `tools/`
outside `tools/wri/`, or each `--file`) into `.claude/`, `tools/wri/`, `studies/` or `test/`, and
exits 1 on any. Its tests are in the same file.
