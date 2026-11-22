---
name: codex-gpt-swarm
description: "Launch and collect independent Codex sessions (`gpt-6-luna` at `high`, `xhigh`, or `max`; `gpt-6.1-sol` at `low` to `xhigh`) for bounded parallel work using a single manifest, one detached launcher, one report per session, incremental draining, and targeted retries. Owns the Codex execution transport whenever another skill (such as whole-run-investigation) defines the questions. Use when asked for Luna or Sol sessions, a swarm, parallel subagents, specific reasoning efforts, a Codex subagent from Claude Code, or later report collection. Distinguish requests to launch from requests to wait and collect."
---

# Codex GPT swarm

Run one independent Codex session per bounded question, coordinated by the launching session. The
launcher script's header documents all CLI flags; it never loads `.env`, ensuring no login
credentials leak into child sessions.

```sh
bun .claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts --manifest <json> --output-dir <new dir> [options]
bun .claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts --drain <output dir>
bun .claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts --retry <output dir> [--max-active N] [--start-interval-ms N]
```

## Verify execution before reading reports

A failed session represents missing work rather than work that another agent can silently absorb.
Check execution receipts before trusting any report: any text without a corresponding completion
entry in `summary.json` is not a verified Codex session output. Exhausted credits constitute a
typed non-result to be retried once quota resets (`AGENTS.md`, rule 15).

## Model, effort, and batch size

When no model is explicitly specified, apply the default batch policy:

| independent questions | model and effort |
| --- | --- |
| 2 to 5 | `--model gpt-6.1-sol --reasoning-effort medium` |
| 6 or more | `--model gpt-6-luna --reasoning-effort xhigh`, all in one launch |

An explicit operator choice overrides the table; preserve any requested effort verbatim (`gpt-6-luna`
named without an effort defaults to `max`). Each launch uses one model and one default effort
(individual manifest rows may override effort). Size the batch strictly to the number of genuine
unsettled questions rather than splitting questions artificially to reach a Luna threshold. Always
pass explicit flags because the launcher defaults to `gpt-6-luna` at `max`.

| model (`MODELS`) | efforts | default |
| --- | --- | --- |
| `gpt-6-luna` | `high`, `xhigh`, `max` | `max` |
| `gpt-6.1-sol` | `low`, `medium`, `high`, `xhigh` | `medium` |

All launches run on the `priority` service tier (`SERVICE_TIER`).

## Stopping criteria

When asked to "launch" or "spawn", start the detached batch and return as soon as
`gpt_sessions.started` appears in the log. When asked to "wait", "collect", or "summarise", drain
all completed reports and return the synthesis. Report `launched` only after confirming
`gpt_sessions.started`. If the brief is already complete, launch within the same turn.

## Sessions and manifest structure

Place shared context (pinned commit, evidence standards, scope limits, report format, and common
inspection commands) once in the shared instructions file. Give each manifest row a single bounded
question with explicit scope limits, starting pointers, authority level, and required deliverable.
Causal questions must evaluate at least three competing hypotheses (including an innocent
explanation) and propose fixes only for demonstrated defects. Sessions default to read-only;
write sessions must declare `ownedPaths`, be informed that peer sessions may edit concurrently,
and never spawn child sessions. All reports must respect seat-view boundaries (`AGENTS.md`,
sections 1 and 3), omit private host or account details, and be verified before acting on them
(section 11).

Create the manifest with a file-writing tool:

```json
{
  "workdir": "/absolute/worktree",
  "instructionsFile": "/absolute/shared-instructions.md",
  "sessions": [
    { "name": "readers", "task": "List every reader of comparison.reported and any two that disagree." },
    { "name": "fixture", "task": "Write the hostile case named in the instructions.", "sandbox": "workspace-write", "ownedPaths": ["test/compare-exhaustive.test.ts"] }
  ]
}
```

Valid row fields are `name` (`^[a-z][a-z0-9_]{0,47}$`), a distinct `task`, `workdir`, `sandbox`,
`ownedPaths` (mandatory for `workspace-write`), and `effort` (overriding `--reasoning-effort` for
that row and persisted in `launch.json` for `--retry`). Web search is enabled unless `"search":
false`, which must be set for any session inspecting campaign logs; sessions with web search
enabled may query only public concepts and must cite URLs.

## Launch

Start the batch detached so neither tool timeouts nor turn completion terminate it, targeting a
fresh output directory outside any campaign directory:

```sh
nohup bun .claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts \
  --manifest <scratch>/manifest.json --output-dir <scratch>/gpt \
  --model gpt-6.1-sol --reasoning-effort medium [--max-active 12] [--start-interval-ms 1000] \
  > <scratch>/gpt.log 2>&1 &
```

Once the log prints `gpt_sessions.started`, report the output directory, session count, model,
reasoning effort, and concurrency settings. Pass `--codex-bin` to override the Codex binary path.

## Watch, drain, and retry

The launcher appends a `gpt_session.finished` line as each session ends, followed by
`gpt_sessions.completed`. Drain incrementally while the batch runs: `--drain` outputs newly
appended sections of `reports.md`, and `reports.md` persists even if the launcher dies. After
completion, run a final drain and inspect `summary.json` (incomplete sessions record `failureKind`
as `spawn`, `rate-limit`, or `null`). Whenever a claim depends on the exact model that ran, verify
it directly in that session's event log.

A session counts as complete when its final attempt exits 0 and writes a report (`settle`,
`gpt-receipts.ts`), with `--retries` controlling per-session retries (default 1, maximum 5). If
every session fails immediately with `rate-limit` and zero spend, the Codex quota window is
exhausted (often for several days): halt further Codex scheduling until reset and route urgent
work to Claude agents (for WRI lanes, use the `wri-lane` agent type). After sporadic rate limits,
let the current batch settle and retry only incomplete sessions under the saved settings:

```sh
bun .claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts --retry <output dir> --max-active 4 --start-interval-ms 5000
```

## Whole-run investigation lanes

[whole-run-investigation](../whole-run-investigation/SKILL.md) generates `<dir>/launch.json`;
launch it unmodified. Dependent single lanes (lanes 4 and 15) launch after their prerequisite
reports arrive using `<dir>/launch-NN.json`, and `wri.ts collect` gathers the finished reports.
