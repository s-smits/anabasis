# ADR 0006: Agent backends, context compaction, deadlines, and billing

## Status

Accepted

## Context

Anabasis runs four agent seats across multiple backends (Claude Code OAuth, Claude API key, Codex CLI login, OpenRouter, and direct OpenAI-compatible endpoints) under strict condition comparability, budget caps, and host-load/sleep resilience.

## Decisions

1. **Provider and credential isolation (`src/agent/backends/claude.ts`, `src/agent/backends/models.ts`)**
   - `claude` (`CLAUDE_CODE_OAUTH_TOKEN`) and `claude-api` (`ANTHROPIC_API_KEY`) are distinct provider IDs so billing account identity is explicit in CLI flags, solve conditions, and price keys, and each CLI process receives an allow-listed environment containing only its own credential.
   - Claude Code runs with an isolated `claude-config` directory per seat home (not `.claude`), `ENABLE_CLAUDEAI_MCP_SERVERS=0` (blocking cloud MCP auto-loading past strict MCP config), `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` (preventing a second memory store beside the log), and `[1m]` long-context IDs for models in `LONG_CONTEXT` so a 300K compaction window is not silently clamped to 200K.
   - `codexLogin` reads Codex CLI's `auth.json` afresh per request and never refreshes tokens, because Codex rotates refresh tokens on use and refreshing would sign out the interactive CLI session.
   - `openrouter()` pins `deepseek/deepseek-v4.1-flash-1017` exclusively to DeepInfra FP8 with fallbacks disabled so paired comparisons are not confounded by cross-provider quantisation variance.

2. **Clean Claude Code shutdown and hung-query detection (`src/agent/backends/claude.ts`, `close`, `heard`, `QUIET_MS`)**
   - `close` sends an SDK `interrupt()` before aborting. Aborting directly leaves Claude Code up to two seconds on a parked tool call (`submit` or `finish`), during which it can issue an unbilled follow-up model request.
   - `QUIET_MS` (30 minutes) terminates queries that stop emitting messages on idle pipes so a stalled backend does not hang until a 24-hour Builder deadline.
   - `claudeSpendNow` validates that every returned usage count is finite before updating spend so an upstream schema change never injects `NaN` into campaign billing.
   - `FINAL_STOPS` maps only terminal completion reasons (`end_turn`, `max_tokens`, `model_context_window_exceeded`, `tool_use` with pi calls); `refusal`, unfinished server pauses, and unknown stop reasons fail the turn as provider non-results.

3. **Context compaction window and cost accounting (`src/agent/backends/compaction.ts`, `src/agent/session.ts`)**
   - `compactionPolicy` expands `reserveTokens` on large-window models so `pi-durable` compacts at the 300K campaign window; because `pi-durable` also uses `reserveTokens` as the summary output cap, the solve condition records it explicitly.
   - `compactionTrace` attributes compaction token cost as the delta in `pi.usage` between `beforeCompact` and the terminal `CompactionTask` commit (including failed attempts) without double-counting ordinary turns.
   - `sessionHooks` uses an external abort fence because `pi-durable` logs hook errors and continues instead of terminating the session.

4. **Monotonic solve deadlines, provider stalls, and command reserves (`src/solver/run.ts`, `src/kernel/solve.ts`, `src/tools/command.ts`, `src/agent/session.ts`)**
   - `raiseWall` measures elapsed solve time against monotonic `performance.now()` and re-arms timers that fire early relative to it, preventing host sleep from penalising a solve as `wall-ended`.
   - `sessionClock` pauses seat deadlines during host-owned actions (`within`) with nested pause depth so campaign comparisons or verifier reads never consume Builder or Examiner time.
   - A deadline expiry after `SILENT_SECONDS` (600 s) with no completed turn and no active tool is classified as a `provider` stall non-result rather than `wall-ended`.
   - `heldSeconds` shortens commands launched before the final solve reserve (`reserveSeconds`: 60 s, or 1/8 of solves under 8 minutes) so long commands return while time remains to submit; commands launched inside the reserve keep their normal limits.
   - Named provider reset windows (`resetOf`, `waitOut`) are waited out without consuming solve reruns; timezone offsets are computed on the reset's own calendar day to handle daylight-saving transitions, and unknown zones return `null`.

5. **Condition identity and billing (`src/kernel/condition.ts`, `src/kernel/meter.ts`)**
   - `Condition.host` hashes `src` and `vendor` content rather than git commit SHAs so doc/test commits do not split conditions while uncommitted source edits do.
   - `billedBetween` computes interval spend via prefix differences so sessions spanning the window start are not attributed whole; `sessionLedger` merges served-model turn spend with excess backend spend (retries, compactions, server tools).
