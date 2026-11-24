---
name: setup-anabasis
description: "Configure a local clone of Anabasis for its first campaign: Bun, the sandbox wall, dependencies and git hooks, model seat credentials, and optional remote hosts and logins. Inspects the environment first, proposes one section at a time with a recommended action, writes only what the user confirms, and verifies each step without spending credits. Re-run to verify an existing setup."
disable-model-invocation: true
---

# Set up Anabasis

This interactive procedure brings a fresh clone of Anabasis to the point where `README.md` ("Run it") can launch a campaign (or verifies an existing setup without modifying anything unconfirmed). Three constraints apply throughout:
1. **Zero spend**: invokes no model seat, starts no campaign, and never passes `--yes` to a command that mutates another host.
2. **No root privileges**: prints any command requiring `sudo`, a browser, or a password for the user to run in their own terminal.
3. **Secret isolation (`AGENTS.md` sections 10–11)**: never opens, prints, or overwrites an existing `.env` or `.env.runs` (copies from `.example` only when absent) and edits no tracked file, shell profile, or SSH config.

## 1. Explore

Inspect the machine without modifying anything (checking login shells via `zsh -lc` / `bash -lc` before reporting a binary missing):
- `uname -s` and `bun --version` (compare against `packageManager` in `package.json`).
- On Linux: `bwrap --version` and `sysctl -n kernel.apparmor_restrict_unprivileged_userns` (must be `0` or absent; Ubuntu 24.04+ defaults to `1`).
- `test -d node_modules`, `git config core.hooksPath` (expects `.githooks`), `test -e .env`, and `test -e .env.runs`.
- Binary presence only: `command -v claude`, `claude --version`, `command -v codex`, `command -v rg`, and `python3 --version` (never read `~/.claude`, `~/.codex`, or keychains).

## 2. Present, confirm, and apply

Present a summary table of what is present and missing, then step through sections A–C below one confirmation at a time (skipping any section already satisfied):

- **A. This machine**: Print the pinned Bun install command from `README.md` (and on Linux the `sudo` commands for `bubblewrap` and `kernel.apparmor_restrict_unprivileged_userns=0`) if missing, then run `bun install --frozen-lockfile` and `bun run hooks:install`. Verify with `bun --version` and `ANA_CHECK_HOST=here bun run test -- test/walled-env.test.ts`.
- **B. Model seats** (`README.md`, "Seats"; `.env.example`): Create `.env` via `cp -n .env.example .env` if absent.
  - *When `claude` is installed (recommended)*: Ask the user to run `claude setup-token` in their own terminal and paste `CLAUDE_CODE_OAUTH_TOKEN` into `.env`. Verify via `bun run runs usage` (loads the token without printing it or calling a model).
  - *When `claude` is absent*: Offer `ANTHROPIC_API_KEY` (`claude-api/<model>`) or `OPENROUTER_API_KEY` (`openrouter/<model>`) in `.env` (verified on the first seat turn).
  - *When `codex` is installed*: `openai-codex/<model>` reads `CODEX_HOME` (`~/.codex`) directly; the user runs `codex login` only if a seat later reports no login.
- **C. Other machines and logins (optional)**: Skip unless running across multiple hosts or logins. Otherwise run `cp -n .env.runs.example .env.runs`, guide the user through numbered tokens in `.env` and `ANA_HOSTS`/`ANA_PYTHON`/`ANA_TOOLS` in `.env.runs`, and verify with `bun run runs usage`, `bun run runs hosts --health`, and `bun run runs sync` (without `--yes`). Offer to draft an outside-repo operator `CLAUDE.md` only upon confirmation.

## 3. Finish

Report one status line per component (`yes`, `no` with the resolution command, or `not proved` for credentials lacking a zero-cost check: Bun, wall test, dependencies, git hooks, seat credentials, and remote hosts), then point the user to `README.md` ("Run it") to launch their first campaign in a dedicated worktree using `--dry-run` first.
