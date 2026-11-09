---
name: codex-gpt-swarm
description: "Launch and collect independent Codex sessions (gpt-6-luna at high, xhigh or max; gpt-6.1-sol at low to xhigh) for bounded parallel work: one manifest, one detached launcher, one report a session, a drain and a retry. Owns the Codex transport when another skill, such as whole-run-investigation, sets the questions. Use when the operator asks for Luna or Sol sessions, a swarm, many sessions, a reasoning effort, a Codex subagent from Claude Code, or a later collection of reports. Distinguish a request to launch from one to wait and collect."
---

# Codex GPT swarm

One independent Codex session per bounded question, orchestrated by the launcher's session. The
script's head lists every flag; it reads no `.env`, so no login's key reaches a session.

```sh
bun .claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts --manifest <json> --output-dir <new dir> [options]
bun .claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts --drain <output dir>
bun .claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts --retry <output dir> [--max-active N] [--start-interval-ms N]
```

## The author before the report

A failed session is missing work, never work done by something else. Read who ran before what was
claimed: a report with no result in `summary.json` is not a Codex session's. Exhausted credits are
a typed non-result, retried later (rule 15).

## Model, effort and count

With no model named, the batch policy decides:

| independent questions | model and effort |
| --- | --- |
| 2 to 5 | `--model gpt-6.1-sol --reasoning-effort medium` |
| 6 or more | `--model gpt-6-luna --reasoning-effort xhigh`, all in one launch |

An explicit choice replaces the table; keep a named effort exactly (Luna named alone runs at `max`).
One launch is one model, at one effort unless a row names its own. The count follows the unsettled questions, never split to
reach a Luna batch. Always pass the flags: the launcher defaults to `gpt-6-luna` at `max`.

| model (`MODELS`) | efforts | default |
| --- | --- | --- |
| `gpt-6-luna` | `high`, `xhigh`, `max` | `max` |
| `gpt-6.1-sol` | `low`, `medium`, `high`, `xhigh` | `medium` |

Every launch uses the `priority` tier (`SERVICE_TIER`).

## Where to stop

"Launch" or "spawn" means start every session and return the start line; "wait", "collect" or
"summarise" means drain every report and return the synthesis. Say `launched` only after
`gpt_sessions.started`. When the brief is clear, launch in the same turn.

## The sessions and the manifest

Shared material (commit, evidence rules, limits, report form, any command all would rediscover)
goes once in the instructions file. Each row needs one question with
its limits, where to start, its authority and the outcome to return. A causal question tests at
least three hypotheses, one innocent, and proposes a fix only for a proved defect. Sessions are
read-only by default; a write session owns named paths and is told others may be editing, and no
session starts another. Reports stay within the seat's view (`AGENTS.md`, sections 1 and 3), carry
no private details, and are research to check before acting on (section 11).

Write the manifest with a file-writing tool:

```json
{
  "workdir": "/absolute/worktree",
  "instructionsFile": "/absolute/shared-instructions.md",
  "sessions": [
    { "name": "readers", "task": "List every reader of comparison.reported and any two that disagree." },
    { "name": "fixture", "task": "Write the hostile case named in the instructions.", "sandbox": "workspace-write", "ownedPaths": ["test/compare.test.ts"] }
  ]
}
```

A row takes only `name` (`^[a-z][a-z0-9_]{0,47}$`), a distinct `task`, `workdir`, `sandbox`,
`ownedPaths` (required by `workspace-write`) and `effort`, which runs that row at another of the
model's efforts than `--reasoning-effort` and is recorded in `launch.json` for `--retry`. Web search is on unless `"search": false`, which a
session reading campaign logs needs; a searching session queries only public concepts and cites URLs.

## Launch

Start the batch detached, so neither a tool timeout nor the turn's end kills it, into a new output
directory outside any campaign folder:

```sh
nohup bun .claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts \
  --manifest <scratch>/manifest.json --output-dir <scratch>/gpt \
  --model gpt-6.1-sol --reasoning-effort medium [--max-active 12] [--start-interval-ms 1000] \
  > <scratch>/gpt.log 2>&1 &
```

Once the log opens with `gpt_sessions.started`, report directory, count, model, effort and pace.
`--codex-bin` overrides where Codex is found.

## Watch, drain, retry

The log gains a `gpt_session.finished` line per session, then `gpt_sessions.completed`. Drain while
it runs: `--drain` prints what `reports.md` gained, and `reports.md` survives the launcher's death.
At the end, drain again and read `summary.json` (an incomplete session's `failureKind` is `spawn`,
`rate-limit` or `null`). Where the bound model
carries a claim, read the session's own event log.

A session completes when its last attempt exits 0 and writes a report (`settle`,
`gpt-receipts.ts`), with `--retries` further attempts (default 1, at most 5). After rate limits, let
the launch settle and rerun only what is missing under the recorded settings:

```sh
bun .claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts --retry <output dir> --max-active 4 --start-interval-ms 5000
```

## Lanes of a whole-run investigation

[whole-run-investigation](../whole-run-investigation/SKILL.md) writes `<dir>/launch.json`; launch it
as it stands. A lone lane (4 and 15) launches after the reports it waits on from
`<dir>/launch-NN.json`, and `wri.ts collect` reads the reports.
