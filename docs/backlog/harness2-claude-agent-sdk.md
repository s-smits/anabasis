# Harness² sweeps on Claude Agent Python SDK

## Intended changes

Investigate whether upstream Harness² (`google-research/harness2` and its JobBench fork) has adopted the Claude Agent Python SDK instead of standalone `claude -p` (`studies/harness2/h2/claude.ts`), and if so migrate Harness²'s own JobBench sweep runner (`studies/harness2/jobbench.ts` and `studies/harness2/h2/`) so comparative Harness² sweeps (such as `k=1` or `k=5`) also run through the SDK rather than standalone Claude Code CLI invocations.

Anabasis external evaluations (`bun run runs bench` and `studies/harness2/score.ts --arm pi:*`) already run exclusively on native `pi-durable` + `@anthropic-ai/claude-agent-sdk` after removing the legacy Claude Code exporter (`488884bb2:studies/shared/claude-export.ts`). This backlog item tracks the separate Harness² baseline sweep runner only.

## History

- **2026-11-24 (operator):** "option 1 but also shouldn't we use the Claude Agents Python SDK on harness2 as well, haven't they implemented this yet? This should be in the backlog we can't scope all at once but next prompt / iteration"
