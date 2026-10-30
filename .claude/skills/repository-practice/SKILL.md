---
name: repository-practice
description: "Repository practice in full, AGENTS.md sections 9 to 14, and what a change owes before a commit or a pull request. Use before you commit, open or label a pull request, run checks or ask which tests, gates or labels a diff owes (scripts/preflight.ts reads the diff and says: the tests the static gate chooses, ui:gate, rule 3's wall tests for a seat's message, files over 800 lines or functions over 115, section 13 slips in changed prose, a suggested importance and category); before claiming a level of the ladder, a step, no step or a mechanism; before a real-model run; when touching the OS wall, its start-up test or the network; when a command, a hook, a CI job, the never-touch list, what a sed is, the stack's bullets, how reviews and subagents check a finding, the dependency direction, the writing rules in long form, a fixed term or the map of the tree needs its full statement. The procedures stay with stack-pr, run-management, attribution-and-proof and tools/oxlint/HABITS.md."
---

# Repository practice

The full account of `AGENTS.md` sections 9 to 14, under the same numbers and titles, so "section 11"
means the same section in `AGENTS.md` and here. `AGENTS.md` holds the invariants every session
carries, and this skill the mechanisms, owners and edge cases behind them. `AGENTS.md` owns the rules
(section 8) and the operator's decisions (section 3). The source at the stack's head, with each
module's head comment, outranks both. The other parts of the account are `design-and-seats`
(sections 1 to 3), `campaign-mechanics` (4 to 6), `comparison-reading` (7 and 8) and
`repository-practice` (9 to 14).

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

It reads no log, runs no check and starts nothing; `bun run commit:check` and the gate remain the
checks. Logins, hosts and live runs are `bun run runs usage`, `hosts`, `status` and `active`. Its test is `test/repository-practice-script.test.ts`.
