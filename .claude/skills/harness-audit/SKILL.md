---
name: harness-audit
description: "Inspect the harnesses a campaign retains outside a live run: inventory versions and their provenance, diff changes against a parent harness, review which comparisons evaluated each version, test a harness on a released task, prepare pre-promotion audits and blind handover reviews, assess whether components earn their keep, and locate owners of the harness contract. Use when asked which harness is current, what a Builder changed, whether a harness is ready for promotion or handover, or how to run a kept harness on a task. Full-run analysis belongs to `whole-run-investigation`; claim wording belongs to `attribution-and-proof`."
---

# Harness audit

A campaign stores every frozen harness by content digest under `states/` alongside its log (`tools/d2/campaign.ts`), while the log records each version's provenance (`harness.version`, `harness.imported`, `harness.promoted`) and evaluation history. This skill reads both sources together. Its inspection script neither modifies state nor executes solves; commands below that execute solves are explicitly marked and require operator authorisation. Attributing a gain to a specific harness component requires an ablation against `programs-of:<digest>`, framed using [attribution-and-proof](../attribution-and-proof/SKILL.md).

## The versions

```sh
bun .claude/skills/harness-audit/scripts/harness-versions.ts <log | campaign folder | name> [--blind] [--json]
bun .claude/skills/harness-audit/scripts/harness-versions.ts <log | campaign folder | name> --diff <harness> [--against <harness>]
```

Harnesses are addressed using the same identifiers accepted by campaign commands (`keptAs`: `starter`, `promoted`, `latest`, a full or prefix digest, or a letter alias from `namesOf`). For each version, starting with the starter, the listing reports:

- whether it opens with its recorded digest (solves refuse any harness whose digest has drifted, such as after a missing tool tree; copies fetched from remote hosts omit installed packages, so those states report the same condition, and `--diff` inspects their files in place and notes this);
- its provenance (originating session and parent digest, import, starter, or no log record, which indicates a sweep's initial parent, a starter from another checkout, or a `programs-of` control; state which applies and never reconstruct it);
- its campaign roles and structure (line counts of the guide and `agent/tools.ts`, declared tools, and `.toolchain` size excluding caches as the digest excludes them);
- its evaluation record from `campaignOf` (`src/campaign/handover.ts`), listing sessions started from it and every comparison in which it participated, with its side and reading.

`--diff` summarises structural changes per component against the parent or `--against` without quoting file contents.

### The lines that moved

From within `states/`, using the parent and child digests printed by `--diff`:

```sh
git diff --no-index <parent> <child> -- ':!.toolchain'
git diff --no-index <parent>/.toolchain/ <child>/.toolchain/ -- ':!*__pycache__*'
```

Both commands are necessary: a kept `.toolchain` is a symlink to a shared `tree-*` directory, so the first diff compares only symlink targets whereas the trailing slash in the second follows the symlink. Summarise the resulting patch by change type and scale rather than quoting raw code.

## Trying a kept harness

- **Single task from a handover** (runs a solve): `bun tools/d2/close.ts --name <campaign> --to <folder outside the repository> --solve <task id>` runs a released practice task from the exported handover in `handover/log.jsonl`, which no campaign reading counts.
- **Paired comparison on identical tasks** (runs solves): `bun tools/d2/checkpoint.ts --reference <a> --new <b>` via [run-management](../run-management/SKILL.md); use `programs-of:<harness>` to separate installed programs from the guide and tools.

## Before a promotion

Campaigns promote automatically unless `--hitl` is set. For a manual promotion, present four items to the operator:

1. **Promotion rule**: run `bun tools/d2/promote.ts --name <campaign> --harness <digest>` without `--yes` to verify whether a comparison with this harness as the candidate read `step` against the current reference without recording anything; `--yes` records the promotion, and `--despite "<why>"` records an explicit exception.
2. **Integrity and lineage**: confirm that the harness opens with its recorded digest, trace its lineage back to the starter, and verify that each supporting comparison names this exact digest.
3. **Diff summary**: run `--diff <digest> --against promoted` alongside the diff commands above.
4. **Evaluation review**: consult lanes 13, 15, and 18 of [whole-run-investigation](../whole-run-investigation/SKILL.md) whenever a reading is in doubt.

## At a handover

`bun tools/d2/close.ts --name <campaign> --to <folder>` exports `harness/`, `RULES.md`, and `REPORT.md` without invoking a model. Supply an independent reviewer with only `harness/` and `RULES.md`, withholding `REPORT.md`, the campaign log, and all comparison readings (for a Codex reviewer, configure a single read-only row via [codex-gpt-swarm](../codex-gpt-swarm/SKILL.md) with the handover directory as its working directory). Request a neutral audit covering structure, consistency between the guide and installed programs, stale files, symlinks escaping the directory, and any component that names a task, copies task text, or embeds an answer. Search procedures that test candidate solutions against public rules are permitted (`src/builder/prompt.ts`). Record the harness digest and directory path alongside the review, which remains advisory.

## Whether a part earns its place

Evaluate each harness component from `solve.call` events in solves running under that harness (lane 15), restricted to solves where the need arose and the component was present. Treat missing telemetry as unknown rather than zero, and note that a successful tool call does not imply a valid final answer.

| Decision | Evidence |
| --- | --- |
| enrich | repeated solver work aligns with the component's purpose and a richer output closes the gap |
| add | a recurring workflow lacks an adequate owner |
| consolidate | multiple components require identical inputs or force avoidable hand-offs |
| describe | the capability exists, but its purpose or constraints are unclear in the guide |
| remove | no distinct purpose; its work is handled elsewhere |
| keep | saves solver effort, serves a rare legitimate need, or the shell already handles it |

Harness design belongs to the Builder (`AGENTS.md`, section 2); this table informs changes to the Starter or to Builder guidance, subject to operator approval.

## The contract

| Component | Owner | Test |
| --- | --- | --- |
| Harness loading and digest computation | `openHarness`, `src/harness/open.ts` | `test/harness-open.test.ts` |
| Starter Built Harness and generated `HARNESS.md` | `writeStarter`, `HARNESS_ACCOUNT`, `src/harness/starter.ts`; `src/builder/session.ts` | `test/starter.test.ts` |
| Installed programs | `installedPrograms`, `programsOf`, `src/harness/programs.ts` | `test/programs.test.ts` |
| Builder prompt | `src/builder/prompt.ts` | `test/builder.test.ts` |
| Solver prompt | `src/solver/prompt.ts` | `test/solver-prompt.test.ts` |
| Examiner and Referee prompts | `src/examiner/prompt.ts`, `src/referee/referee.ts` | `test/examiner.test.ts`, `test/review.test.ts` |

The three harness components are defined in `AGENTS.md`, section 3, and their layout is specified in `HARNESS_ACCOUNT`. Inspect the parser or tool implementing an instruction before rewording its prompt text.
