---
name: zip-run
description: Zip one recorded Harness Builder run for handover at a chosen depth (--light, --medium, --verbose). Use when the operator asks to zip, bundle, archive or send a run, its traces, its logs or "everything the model saw", or names a size cap. One script, three cumulative levels, a README and MANIFEST inside every zip.
---

# Zip a run

One command produces the bundle; the level decides how deep it reaches.

```sh
bun .claude/skills/zip-run/scripts/zip-run.mjs <run-dir | campaign-dir> --light|--medium|--verbose \
  [--out <zip>] [--max-mb N]
```

`<run-dir>` is the launched worktree (holds `.scratch/quick-run/launch.json`, for example
`~/Developer/hb4-run-<runId>`). Its `campaigns/` tree
also carries campaigns copied from other runs, so the script keys on `launch.json`'s `runId` and
takes the one campaign whose `controller/<runId>/opening.json` exists. A campaign directory with
one controller run is accepted directly. The zip lands at `--out`, default
`./<runId>-<level>.zip`; put it in the session scratchpad and send it with `SendUserFile`.

## Pick the level from the request

| operator says | level | measured on the Sol truss run of 2026-09-12 (11 epochs, 450 cases) |
| --- | --- | --- |
| "traces", "reasoning", "logs", "under 2 MB", handover to a reviewing model | `--light` | 1.34 MB, 544 files |
| "what each case did", "tool calls", "verifier and Judge output", "the whole evaluator" | `--medium` | 6.9 MB, 3,020 files |
| "everything", "everything the model saw", "full tool outputs" | `--verbose` | 44 MB, 45,149 files |

A run bundle of 20 MB or more is verbose by definition. If a lighter request produces that, the
level is wrong, not the cap. `--light` fails when the zip exceeds 2 MB; `--max-mb` sets any other
cap. When a cap fails, drop the largest group the script prints or choose a lighter level; do not
strip files by hand inside the zip.

## What each level holds

Levels are cumulative. Every level includes `README.md` (levels, groups, what was left out,
then the level's reading guidelines) and `MANIFEST.json` (every file with byte size and group,
run id, campaign, source commit). The guidelines are presets in `readme/<level>.md`: when to
choose that level, the reading order, what the bundle cannot answer, and what not to conclude
from it. Edit the preset, not the script, to change what a recipient is told.

**light**: how the run started and ended, what each round decided, and what the Builder was thinking.

- `launch/`: `launch.json`, `stop.json`, `probe.json`, `fullrun.log`.
- `controller/`: `opening.json`, `terminal.json`.
- campaign ledgers: `epochs.json`, `budget.json`, `case-record.jsonl`, `isolation/*.json`.
- `claims/`, `difficulty-decisions/`, `analysis/` (rebuild advice packets, epoch reviews,
  admissions), `promotions/`, `safeguards/`.
- `epochs/<epoch>/`: `builder-prose.jsonl` (reasoning per turn), `builder-execution.json` (tool
  tallies, failed calls, submits), `builder-session.json`, `backends.json`, `campaign.json`.
- `versions/<version>/`: `version.json`, `conformance.json`, `claim-stages.json`, `agent/`
  (tools.ts, tools-spec.json, BUILT_AGENTS.md), `correctness-model/brief.json` and `evaluator.ts`.
- `versions/<version>/runs/<runId>/`: `battery.json`, `run-manifest.json`, `backends.json`, and
  `cases/<case>/case-result.json` only.

**medium** adds the per-case and per-check material.

- `cases/<case>/`: `trace.json` (Built Harness turns and tool calls with argument digests and
  result previews), `trace-pointer.json`, `verifier.json`, `judge.json`, `public-task.json`,
  `final-submission.json`, `artifact.json`.
- `runs/<runId>/judge/`: census sample, bait corpus, controls, standing.
- whole `correctness-model/`: `tasks.json` with hidden expectations, `controls.json`,
  `reference/`, evaluator tests.
- `epochs/<epoch>/`: `builder-path-record.jsonl` (every guarded file access), `trials/` and the
  `NN-<slug>/` preview receipts (`census.json`, `conformance.json`, `solvability.json`,
  `iteration.json`), `verifier-workshop.jsonl`.

**verbose** adds everything the models saw and everything the host recorded, minus binaries.

- `observability/<runId>.jsonl`: every start prompt the Builder, Built Harness and Judge
  received, in full (44 MB uncompressed on the Sol run: 256 solver prompts, 745 Judge prompts,
  11 Builder prompts).
- `controller/verifier-lifetime/`: `intent.json`, `spawned.json`, `settlement.json` per verifier
  process (13,702 processes on the Sol run).
- every remaining case file: `built-runtime.json`, `built-registration.json`,
  `draft-checkpoints.json`.
- `epochs/<epoch>/workspace/` and `.oss/` metadata: the Builder's authoring tree, `STARTER.md`,
  generated scripts. `.toolchain/`, `.oss/downloads/`, `.oss/build/`, `node_modules/`,
  `.bundle-snapshots/` (preview candidates; the accepted ones are under `versions/`) and any
  file over 8 MB are excluded and listed under `excluded` in the manifest.
- `controller.sqlite`.
- `transcripts/`: full session transcripts with complete tool outputs, when the backend left
  them on disk. Claude-backed runs keep them under
  `~/.claude/projects/<epoch workspace path with / replaced by ->/*.jsonl`; the script finds
  those per epoch. Codex-backed runs keep rollouts only if the frozen `CODEX_HOME`
  (`.scratch/quick-run/codex/sessions/`) retained them; the Sol run of 2026-09-12 did not, so
  its verbose bundle carries no Codex rollouts and the README says so. Do not go looking in
  `~/.codex/sessions` for them: rollouts there with the run workspace as `cwd` are later review
  sessions, not the Builder.

Never included at any level: installed toolchain binaries, dependency trees, `.git`, provider
`auth.json`, `.DS_Store`.

## After zipping

Report the zip path, the compressed size, the file count and the group table the script prints.
Name what was left out in one line; the README inside repeats it. When the operator asked for a
size, say whether the cap held. If a verbose request finds no transcripts, say that the run
recorded prompts, reasoning and tool-call previews but not full tool outputs, and where that
limit comes from (Codex rollouts not retained under the frozen home).

## Focused check

`test/zip-run-script.test.ts` builds a synthetic run tree and proves the three levels select
and exclude the named groups, that `--light` reports its cap, and that `launch.json`'s `runId`
selects the campaign among copied ones.

```sh
scripts/worktree.sh run <dir> bun run test -- test/zip-run-script.test.ts
```
