---
name: harness-audit
description: "The harnesses a campaign keeps, read outside a run: which there are and where each came from, what moved from its parent, what measured it, trying one on a task, the audit before a promotion, the blind review at a handover, whether a part earns its place, and changing the harness contract or what a seat is told about one. Use when the operator asks which harness is current, what a Builder changed, whether a harness is ready to promote or hand over, or to run a kept harness on a task. Reading one run is whole-run-investigation's, wording a claim attribution-and-proof's."
---

# Harness audit

A campaign keeps every frozen harness under its digest in `states/` beside its log
(`tools/d2/campaign.ts`), and the log records how each arrived (`harness.version`,
`harness.imported`, `harness.promoted`) and what measured it. This skill reads the two together.
Its script writes and solves nothing; commands below that solve are marked and need the operator's
word. Which part of a harness did it is a comparison against `programs-of:<digest>`, worded by
[attribution-and-proof](../attribution-and-proof/SKILL.md).

## The versions

```sh
bun .claude/skills/harness-audit/scripts/harness-versions.ts <log | campaign folder | name> [--blind] [--json]
bun .claude/skills/harness-audit/scripts/harness-versions.ts <log | campaign folder | name> --diff <harness> [--against <harness>]
```

A harness is named as the campaign's commands name one (`keptAs`: `starter`, `promoted`, `latest`,
a digest, or a letter from `namesOf`). For each, starter first, the list gives whether it opens as
kept (a solve refuses one that opens as another digest, as after a lost tool tree); how it was made
(session and parent, import, starter, or no record, which means a sweep's first parent, another
checkout's starter or a `programs-of` control: say which and never rebuild it); its roles; its parts
(guide and `agent/tools.ts` lines, declared tools, `.toolchain` size, caches excluded as the digest
excludes them); and what measured it, from `campaignOf` (`src/campaign/handover.ts`): sessions
started from it and every comparison it stood in, with side and reading.

`--diff` counts what moved part by part against the parent or `--against`, quoting no line.

### The lines that moved

From `states/`, with the two digests `--diff` prints, parent first:

```sh
git diff --no-index <parent> <child> -- ':!.toolchain'
git diff --no-index <parent>/.toolchain/ <child>/.toolchain/ -- ':!*__pycache__*'
```

Both are needed: a kept `.toolchain` links to a shared `tree-*`, so one diff compares only link
targets, and the slash follows the link. Describe the patch by kind and size rather than quoting it.

## Trying a kept harness

- **One task, as handed over** (a solve): `bun tools/d2/close.ts --name <campaign> --to <folder
  outside the repository> --solve <task id>` solves a released task from the handover, in
  `handover/log.jsonl`, which no reading counts.
- **Two harnesses on the same tasks** (solves): `bun tools/d2/checkpoint.ts --reference <a> --new
  <b>` through [run-management](../run-management/SKILL.md); `programs-of:<harness>` separates
  programs from guide and tools.

## Before a promotion

A campaign promotes by itself unless `--hitl` is set. For a manual one, show the operator:

1. **The rule**: `bun tools/d2/promote.ts --name <campaign> --harness <digest>` without `--yes`
   prints whether a comparison with it as new side read `step` against the current reference, and
   records nothing; `--yes` records, `--despite "<why>"` records an exception.
2. **The state**: it opens as kept, its line to the starter, and each comparison it rests on names it.
3. **The change**: `--diff <digest> --against promoted` and the lines above.
4. **What it measured**: lanes 22 and 12 to 14 of
   [whole-run-investigation](../whole-run-investigation/SKILL.md), when a reading is in doubt.

## At a handover

`bun tools/d2/close.ts --name <campaign> --to <folder>` writes `harness/`, `RULES.md` and
`REPORT.md` without calling a model. Hand an independent reviewer only `harness/` and `RULES.md`,
never `REPORT.md`, the log or a reading (a Codex reviewer is one read-only row through
[codex-gpt-swarm](../codex-gpt-swarm/SKILL.md), with the folder as its workdir), and ask neutrally: structure; whether `tools-spec.json` has one row per tool `tools.ts` returns, in
name and order; whether the guide matches the programs; stale files; links leaving the folder; and
any part that names a task, copies its text or holds its answer. A search that tests candidates
against the public rules is allowed (`src/builder/prompt.ts`). Record digest and folder with the
review, which is advisory only.

## Whether a part earns its place

Read a part from the `solve.call` rows of solves under it (lane 13), over solves where the need
arose and the part was there; a missing record is unknown, never zero, and a successful call is no
valid answer.

| Decision | Evidence |
| --- | --- |
| enrich | repeated work fits its purpose and a richer result closes the gap |
| add | a recurring job has no adequate owner |
| consolidate | parts need the same inputs or force an avoidable hand-off |
| describe | the capability is there but its purpose or limits are unclear |
| remove | no distinct purpose; its work is done elsewhere |
| keep | it saves work, serves a rare real need, or the shell already does |

The harness is the Builder's to choose (`AGENTS.md`, section 2); the table grounds a change to the
Starter or to what a Builder is told, on the operator's word.

## The contract

| What | Owner | Test |
| --- | --- | --- |
| what opens as a harness, its digest | `openHarness`, `src/harness/open.ts` | `test/harness-tools.test.ts` |
| the Starter and generated `HARNESS.md` | `writeStarter`, `HARNESS_ACCOUNT`, `src/harness/starter.ts`; `src/builder/session.ts` | `test/starter.test.ts` |
| installed programs | `installedPrograms`, `programsOf`, `src/harness/programs.ts` | `test/programs.test.ts` |
| what a Builder is told | `src/builder/prompt.ts` | `test/builder.test.ts` |
| what a solver is told | `src/solver/prompt.ts` | `test/solver-prompt.test.ts` |
| what the Examiner and Referee are told | `src/examiner/prompt.ts`, `src/referee/referee.ts` | `test/examiner.test.ts`, `test/review.test.ts` |

The four parts are in `AGENTS.md`, section 3, and their shapes in `HARNESS_ACCOUNT`; read the parser
or tool that carries an instruction before rewording it.
