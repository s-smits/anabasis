---
name: setup-anabasis
description: "Prepare a local Anabasis checkout for its first campaign (or verify an existing setup): runs `bun run setup`, applies confirmed local steps via `bun run setup --apply`, and guides seat credentials without touching secrets or spending credits."
disable-model-invocation: true
---

# Set up Anabasis

`bun run setup` (`tools/runtime/setup.ts`) owns prerequisite checks, local installation, and interactive token setup. Three boundaries hold throughout:
1. **Zero paid spend**: starts no campaign, invokes no model seat, and never passes `--yes` to remote host commands.
2. **No root or browser flows inside the session**: print `sudo` commands and `bun run setup --token` for the user's own terminal.
3. **Secret isolation (`AGENTS.md` sections 10–11)**: never directly open, print, or edit `.env`, `.env.runs`, `~/.claude`, `~/.codex`, or keychains (`bun run setup` checks credential presence without exposing tokens), and never edit tracked files, shell profiles, or SSH configs.

## 1. Check

Run `bun run setup` (read-only, zero network).
- If `bun` is absent in the non-interactive shell, check `zsh -lc 'command -v bun'` (or `bash -lc` on Linux) before reporting it missing.
- If Bun is missing or mismatches `package.json`, show the exact pinned install command from `README.md` (`curl -fsSL https://bun.com/install | bash -s "bun-v<pin>"`). Only offer `bun upgrade` if the latest Bun release equals the pin and no campaign is running.
- On Linux, print any required `sudo` commands (`bubblewrap`, `kernel.apparmor_restrict_unprivileged_userns=0`) for the user's terminal.

## 2. Apply once

Show the compact status from `bun run setup` and ask **once** to run `bun run setup --apply` (installs frozen dependencies, enables `.githooks`, creates `.env` from `.env.example` at mode `0600` when absent, and runs the local OS wall test `test/walled-env.test.ts`). Skip if `bun run setup` lists no `--apply` action and no fresh wall test is needed.

## 3. Seat credentials

Check which providers `bun run setup` already reports ready:
- **Any provider ready** (Claude OAuth, Codex login, `ANTHROPIC_API_KEY`, or `OPENROUTER_API_KEY`): report it as ready. If the user wants `claude/<model>` seats and Claude OAuth is still unset, give the single terminal step below.
- **Claude OAuth (`claude/<model>`, recommended)**: explain in one sentence that isolated seats require a `setup-token` and an agent session must not run it (or the token enters the transcript), then give one command for the user's own terminal:
  ```sh
  bun run setup --token
  ```
  It runs `claude setup-token` (using the installed or bundled binary), reads the pasted token with echo disabled, saves `CLAUDE_CODE_OAUTH_TOKEN` to `.env` (mode `0600`), and verifies it via `bun run runs usage` (note: `setup-token` tokens lack `user:profile` scope, so `usage` reads rate-limit headers via a 1-token Haiku request on the subscription).
- **API keys or Codex**: `ANTHROPIC_API_KEY` (`claude-api/<model>`) and `OPENROUTER_API_KEY` (`openrouter/<model>`) live in `.env` and are verified on the first seat turn; `openai-codex/<model>` reads `~/.codex/auth.json` (`codex login` if missing).
- **Multiple hosts or logins**: skip unless asked; point to `.env.runs.example` (`cp -n .env.runs.example .env.runs`, then `bun run runs usage`, `bun run runs hosts --health`, and `bun run runs sync` without `--yes`).

## 4. Finish

Re-run `bun run setup` (and `bun run runs usage` when Claude OAuth is set), report final readiness, and point to `README.md` ("Run it") to start a `--dry-run` campaign in a dedicated worktree.
