---
name: harness-audit
description: "Use when inspecting kept harnesses, checking which harness is current, diffing Builder changes against a parent, preparing pre-promotion or handover reviews, assessing whether components earn their keep, or testing a kept harness on a released task. Inventories versions and provenance and locates harness contract owners. Full-run analysis belongs to `whole-run-investigation`; claim wording belongs to `attribution-and-proof`."
---

# Harness audit

A campaign stores every frozen harness by content digest under `states/` alongside its log (`tools/d2/campaign.ts`), while the log records provenance (`harness.version`, `harness.imported`, `harness.promoted`) and evaluation history (`campaignOf`, `src/campaign/handover.ts`). Inspection commands below are read-only; commands that execute solves require operator authorisation. Component attribution requires an ablation against `programs-of:<digest>` framed via [attribution-and-proof](../attribution-and-proof/SKILL.md).

## 1. Inventory and diff kept harnesses

```sh
bun .claude/skills/harness-audit/scripts/harness-versions.ts <log | campaign folder | name> [--blind] [--json]
bun .claude/skills/harness-audit/scripts/harness-versions.ts <log | campaign folder | name> --diff <harness> [--against <harness>]
```

Harnesses are addressed via `keptAs` (`starter`, `promoted`, `latest`, a digest/prefix, or a letter alias from `namesOf`). The listing reports digest integrity (remote copies omit installed packages, which `--diff` notes while inspecting files in place), provenance (session/parent digest, import, starter, or unlogged sweep parent / `programs-of` control), structure (guide and `agent/tools.ts` line counts, declared tools, `.toolchain` size excluding caches), and every session and comparison in which the version participated.

To inspect line-level changes from within `states/` (using both commands because `.toolchain` is a symlink to `tree-*`):

```sh
git diff --no-index <parent> <child> -- ':!.toolchain'
git diff --no-index <parent>/.toolchain/ <child>/.toolchain/ -- ':!*__pycache__*'
```

## 2. Try, promote, or hand over a kept harness

- **Single practice solve from a handover** (runs a solve): `bun tools/d2/close.ts --name <campaign> --to <folder outside repo> --solve <task id>` logs to `handover/log.jsonl` outside campaign statistics.
- **Paired comparison** (runs solves): `bun tools/d2/checkpoint.ts --reference <a> --new <b>` ([run-management](../run-management/SKILL.md)); use `programs-of:<harness>` to isolate installed programs.
- **Pre-promotion audit** (when `--hitl` is set or promoting manually): (1) dry-run `bun tools/d2/promote.ts --name <campaign> --harness <digest>` without `--yes` (or `--despite "<why>"`), (2) verify digest integrity and lineage back to the starter, (3) run `--diff <digest> --against promoted`, and (4) check lanes 7, 9, and 16 of [whole-run-investigation](../whole-run-investigation/SKILL.md).
- **Blind handover review**: export via `bun tools/d2/close.ts --name <campaign> --to <folder>` and give an independent reviewer ([codex-gpt-swarm](../codex-gpt-swarm/SKILL.md)) only `harness/` and `RULES.md` (withholding `REPORT.md` and the log) to audit structure, guide/program consistency, escaping symlinks, and task/answer leakage (`src/builder/prompt.ts`).
- **Component evaluation**: from `solve.call` events under that harness (lane 9), classify each component as `enrich`, `add`, `consolidate`, `describe`, `remove`, or `keep` to inform Starter or Builder guidance changes (subject to operator approval).

## 3. Owners of the harness contract

| Component | Owner | Test |
| --- | --- | --- |
| Harness loading and digest | `openHarness`, `src/harness/open.ts` | `test/harness-open.test.ts` |
| Starter Built Harness and `HARNESS.md` | `writeStarter`, `HARNESS_ACCOUNT`, `src/harness/starter.ts`; `src/builder/session.ts` | `test/starter.test.ts` |
| Installed programs | `installedPrograms`, `programsOf`, `src/harness/programs.ts` | `test/programs.test.ts` |
| Builder, Solver, Examiner, Referee prompts | `src/builder/prompt.ts`, `src/solver/prompt.ts`, `src/examiner/prompt.ts`, `src/referee/referee.ts` | `test/builder.test.ts`, `test/solver-prompt.test.ts`, `test/examiner.test.ts`, `test/review.test.ts` |
