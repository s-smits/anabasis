---
name: codex-gpt-swarm
description: "Use when asked for Luna or Sol sessions (`gpt-6-luna` or `gpt-6.1-sol`), a Codex swarm, parallel subagents, specific reasoning efforts, a Codex subagent from Claude Code, or later report collection. Owns the Codex execution transport (single manifest, detached launcher, one report per session, incremental draining, targeted retries) whenever another skill defines the questions; distinguish launch from wait-and-collect requests."
---

# Codex GPT swarm

Runs independent Codex sessions in parallel from one manifest (`scripts/gpt-sessions.ts` header documents all flags; never loads `.env` so credentials never leak).

```sh
bun .claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts --manifest <json> --output-dir <new dir> [options]
bun .claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts --drain <output dir>
bun .claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts --retry <output dir> [--max-active N] [--start-interval-ms N]
```

## Model, effort & execution receipts

Verify `summary.json` before trusting any report; a failed session is missing work, not work absorbed elsewhere. Credit exhaustion is a typed non-result (`AGENTS.md` rule 15).

| Independent questions | Default model & effort (overridden by operator) |
| --- | --- |
| 2–5 | `--model gpt-6.1-sol --reasoning-effort medium` |
| ≥6 | `--model gpt-6-luna --reasoning-effort xhigh` (all in one launch) |

Always pass explicit flags (launcher defaults to `gpt-6-luna` at `max`). Supported `MODELS`: `gpt-6-luna` (`high`\|`xhigh`\|`max`, default `max`) and `gpt-6.1-sol` (`low`\|`medium`\|`high`\|`xhigh`, default `medium`), all on `priority` tier (`SERVICE_TIER`). Size batches to genuine unsettled questions.

**Stopping criteria**: for "launch"/"spawn", return once `gpt_sessions.started` appears in the log; for "wait"/"collect"/"summarise", drain completed reports and synthesise.

## Manifest & shared instructions

Put shared context (pinned commit, evidence rules, scope limits, report format, inspection commands) in `instructionsFile`; give each row one bounded question with scope, pointers, authority and deliverable. Causal questions test ≥3 hypotheses (including an innocent one). Default sandbox is read-only; `workspace-write` rows must declare `ownedPaths` and spawn no child sessions. Respect wall boundaries (`AGENTS.md` §1, §3), omit private host/account info, and verify reports before acting (§11).

```json
{
  "workdir": "/absolute/worktree",
  "instructionsFile": "/absolute/shared-instructions.md",
  "sessions": [
    { "name": "readers", "task": "List every reader of comparison.reported and any two that disagree." },
    { "name": "fixture", "task": "Write the hostile case.", "sandbox": "workspace-write", "ownedPaths": ["test/compare-exhaustive.test.ts"] }
  ]
}
```

Row fields: `name` (`^[a-z][a-z0-9_]{0,47}$`), distinct `task`, `workdir`, `sandbox`, `ownedPaths` (required for `workspace-write`), `effort` (persisted for `--retry`), `search` (must be `false` when inspecting campaign logs; enabled sessions query public concepts only and cite URLs).

## Launch, drain & retry

Launch detached into a fresh dir outside any campaign folder (`--codex-bin` overrides binary):

```sh
nohup bun .claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts \
  --manifest <scratch>/manifest.json --output-dir <scratch>/gpt \
  --model gpt-6.1-sol --reasoning-effort medium [--max-active 12] [--start-interval-ms 1000] \
  > <scratch>/gpt.log 2>&1 &
```

Drain incrementally with `--drain` (`reports.md` persists if the launcher dies); after `gpt_sessions.completed`, check `summary.json` (`failureKind`: `spawn` \| `rate-limit` \| `null`; `--retries` default 1, max 5). Verify exact model from each session's event log when claims depend on it. If every session fails immediately with `rate-limit` and zero spend, Codex quota is exhausted—stop scheduling Codex and route urgent work to Claude (`wri-lane` for WRI). For sporadic limits, let the batch settle and retry incomplete rows:

```sh
bun .claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts --retry <output dir> --max-active 4 --start-interval-ms 5000
```

## Related skills

- WRI lanes (`launch.json`, dependent `launch-NN.json`, `wri.ts collect`): [whole-run-investigation](../whole-run-investigation/SKILL.md)
- Parallel audit/review callers: [system-audit](../system-audit/SKILL.md), [consolidate-stack](../consolidate-stack/SKILL.md), [stack-pr](../stack-pr/SKILL.md), [comparison-review](../comparison-review/SKILL.md), [harness-audit](../harness-audit/SKILL.md)
