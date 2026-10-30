---
name: repository-practice
description: "Use when preparing commits or PRs, writing their bodies, comments or prompts, choosing tests and checks, or working near .ana/, .env, vendor/ or src/wall/. Explain evidence levels (present in source, proved without a model, exercised live), terminology and directory ownership (AGENTS.md sections 9–14). preflight.ts suggests checks and labels; direction.ts finds production-to-helper imports. Procedures belong to stack-pr, run-management and attribution-and-proof; coding habits are in tools/oxlint/HABITS.md."
---

# Repository practice

This skill explains `AGENTS.md` sections 9 to 14, using the same section numbers. Read the reference
for the mechanism you are changing. `AGENTS.md` keeps the shared invariants, rules and operator
decisions; these references give their mechanisms and limits. When they disagree with current
source, check the source and correct the stale description.

Each part answers one question:

| Section | Question it answers | Reference |
| --- | --- | --- |
| 9. Status, evidence and claims | What may this sentence say, and what evidence does it need? (the ladder, the evidence order, what may be claimed) | `references/evidence-and-claims.md` |
| 10. Runs with a real model | May this run start, and what holds while it lives? (the nine conditions, `/goal`, the OS wall on each platform, its start-up test, seat roots, the network) | `references/real-model-runs.md` |
| 11. Working in the repository | How does a change get from a worktree onto the stack, and what may it never touch? (runtime and commands, hooks and CI, the never-touch list, the stack and pull requests, reviews and subagents) | `references/working-in-the-repository.md` |
| 12. Code that passes the first time | What must code obey beyond `tools/oxlint/HABITS.md`? (strict lint, no rule off, the dependency direction, tests of facts) | `references/code-and-writing.md` |
| 13. Writing | How is prose of record written? (the long form of the writing rules) | `references/code-and-writing.md` |
| 14. Terms and map | What does this term mean, what is a sed, and which directory owns this? | `references/terms-and-map.md` |

## Where to go

| If you are about to, or asking | Read or run |
| --- | --- |
| Commit, or open a pull request: which tests, gates and labels does this diff owe? | `bun .claude/skills/repository-practice/scripts/preflight.ts` (below), then `stack-pr` |
| Ask which seat's message a change reaches through its imports, and which wall tests prove it | `bun .claude/skills/design-and-seats/scripts/seat-view.ts` |
| Choose or check a pull request's `importance:` and category labels | section 11, "The stack and pull requests"; preflight's suggestion |
| Run a check, or wonder why a check ran on a runner | section 11, "Runtime and commands" and "Hooks and CI" |
| Edit `.ana/`, a pack, a check program, a kept harness, `.env`, `vendor/` or `node_modules` | section 11, "What you never touch" (you may not) and section 14, the sed |
| Branch, push, restack or land | section 11, "The stack and pull requests", then `stack-pr` |
| Launch reviewers or subagents, or act on their findings | section 11, "Reviews and subagents" |
| Name a part's level, or claim a step, no step, a mechanism or a refusal | section 9, then `attribution-and-proof` |
| Start, continue or plan a run that bills a model | section 10, then `run-management` |
| Change the OS wall, a seat's root, its start-up test or the network | section 10, "The wall, seat roots and the network" |
| Write the first line of code | `tools/oxlint/HABITS.md` whole, then section 12 |
| Ask whether production imports a skill, the investigation's reader, a study or a test | `bun .claude/skills/repository-practice/scripts/direction.ts` (below), then section 12 |
| Write a commit, a pull request body, a comment, a prompt or a message to the operator | section 13; preflight lists the slips a pattern can see in changed Markdown |
| Use a term, or find the directory that owns a mechanism | section 14 |

## What a change owes: `scripts/preflight.ts`

```text
bun .claude/skills/repository-practice/scripts/preflight.ts [--base <rev> | --commit <rev>] [--stack]
```

With no option it reads the working tree against `HEAD`, untracked files included; `--base` reads
it against another revision, and `--commit` reads one recorded commit against its first parent. It
asks each owner rather than deciding for itself:

- documentation only, by the gate's documentation set (`DOCUMENTATION`, `tools/runtime/gate.ts`);
- the test files one import away, by the gate's own walk (`nearbyTests` at `NEAR.root`), printed as
  a `bun run test -- ...` line. Over five commits of the history read at the commit itself and by
  `--commit`, the two agreed except for test files added since, which `--commit` also names;
- `bun run ui:gate`, owed where `packages/ui` or what installs and lints it changed (`UI_ROOT`,
  `UI_SETUP`). A root file the UI imports still brings in its build and nearby UI tests under the
  gate (`uiStep`), which preflight does not walk;
- each area of `tools/runtime/moments.ts` the change enters, with that area's own sentence: `seats`
  names rule 3's wall tests (`test/builder.test.ts`, `test/builder-led.test.ts`) and the pull-request
  sentence they owe, `measurement` a replay, `campaign` a rehearsal, `wall` the other platform;
- changed authored files over 800 nonblank lines or with a function over 115 (`sourceTextFindings`,
  `tools/loc/source-policy.ts`), on the text as it stands rather than after formatting;
- in changed Markdown, outside code, quotation marks, links and paths: em dashes, the words section
  13 bans, relative dates, exclamation marks and a short list of American spellings;
- the tree's own facts, each from its owner: whether the hooks are on (`git config core.hooksPath`),
  whether a run may start here (`treeFault`, `tools/d2/campaign.ts`), and with `--stack` where the
  branch sits on the open stack, or the stacks' tops (`told` of `stack-pr/scripts/stack.ts`, which
  asks GitHub);
- a suggested `importance:` label and category, from the paths alone and checked against
  `CATEGORIES` (`tools/runtime/land.ts`). It is a suggestion: the definitions in section 11 and the
  operator decide.

Preflight reads no campaign log and starts no check or run. Validate with `bun run commit:check` and
the gate. Inspect accounts, hosts and live runs through `bun run runs usage`, `hosts`, `status`
and `active`. Its tests are in `test/repository-practice-script.test.ts`.

## The dependency direction: `scripts/direction.ts`

```text
bun .claude/skills/repository-practice/scripts/direction.ts [--file <path>]...
```

Section 12 runs dependencies one way, and no lint rule or scan checks it. This script asks the CI
gate's import reader (`importsOf`, `tools/runtime/gate.ts`), which resolves the `#skills/…` aliases
as Bun does, for the imports of each production file: every tracked file under `src/`, `vendor/`,
`packages/` and `tools/` outside `tools/wri/`, or each `--file`. It names each import that lands in
`.claude/`, `tools/wri/`, `studies/` or `test/`, and exits 1 on any. Its tests are in the same file.
