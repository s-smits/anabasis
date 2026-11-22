---
name: setup-anabasis
description: "Configure a local clone of Anabasis for its first campaign: Bun, the sandbox wall, dependencies and git hooks, model seat credentials, and optional remote hosts and logins. Inspects the environment first, proposes one section at a time with a recommended action, writes only what the user confirms, and verifies each step without spending credits. Re-run to verify an existing setup."
disable-model-invocation: true
---

# Set up Anabasis

This procedure brings a fresh clone of Anabasis to the point where the "Run it" section of `README.md` can launch a campaign. It is an interactive procedure rather than an automated script: inspect the host, report findings, obtain confirmation, apply changes, and verify each step with a command whose exit code confirms readiness. Re-running it acts as a verification pass: inspect the host, report any drift, and modify nothing without explicit confirmation.

Three constraints apply throughout. First, the procedure spends nothing: it invokes no model seat, starts no campaign, and never passes `--yes` to a command that mutates another host. Second, it requires no root privileges: any command requiring `sudo`, a browser, or a password is printed for the user to execute in their own terminal. Third, it never opens, prints, or overwrites an existing environment file (`AGENTS.md`, sections 10 and 11): it copies `.env` or `.env.runs` from its `.example` template only when absent, leaves the user to supply secrets, and verifies them only through commands that load the file. It edits no tracked file, shell profile, or SSH configuration.

`README.md` and the two `.example` files are the authoritative references for all configuration variables and their meanings; refer to them instead of duplicating their descriptions.

## 1. Explore

Inspect the machine without modifying anything:

- Run `uname -s` and `bun --version`, comparing the version against `packageManager` in `package.json`.
- On Linux, check `bwrap --version` and `sysctl -n kernel.apparmor_restrict_unprivileged_userns`. The sandbox requires this sysctl to be `0`; Ubuntu 24.04 and later default to `1`, whereas an absent key indicates that AppArmor does not restrict unprivileged user namespaces.
- Check `test -d node_modules` and `git config core.hooksPath` (hooks are active when this prints `.githooks`).
- Check `test -e .env` and `test -e .env.runs` to verify file existence without inspecting their contents.
- Check `command -v claude`, `claude --version`, and `command -v codex`. Check binary presence only; never read `~/.claude`, `~/.codex`, the system keychain, or login status files.
- Check `command -v rg` (required by `bun run runs search`) and `python3 --version`.

Installers often place `bun`, `claude`, and `codex` in directories such as `~/.local/bin` or `~/.bun/bin` via a shell profile that non-interactive shells do not source. Before reporting a binary as missing, check again inside a login shell (`zsh -lc 'command -v claude'`, or `bash -lc` on Linux).

## 2. Present and ask

Present a single summary table of what is present and what is missing, then work through the sections below in order, taking one confirmation per section. Lead each section with the recommended action so a brief confirmation accepts it, and skip any section already satisfied during exploration.

**A. This machine.** Recommended action: install whatever is missing of the pinned Bun version in `package.json` (print the `curl` command from `README.md` for the user), on Linux install `bubblewrap` and adjust the AppArmor setting (print both commands, as they require `sudo`), and then run `bun install --frozen-lockfile` and `bun run hooks:install` directly. Because Bun's installer adds `~/.bun/bin` to the shell profile, the current session will locate the newly installed binary only in a new shell or at `~/.bun/bin/bun`. `bun install` may report blocked lifecycle scripts; leave them blocked, as nothing verified by this setup requires them. This section is complete when `bun --version` matches the pinned version and the sandbox wall test passes locally: `ANA_CHECK_HOST=here bun run test -- test/walled-env.test.ts`. A failure caused by restricted user namespaces must be reported rather than skipped.

**B. Model seats.** This is the main configuration choice. Each seat specifies a provider (`README.md`, "Seats"), and `.env.example` lists the credentials each provider reads.

- *When `claude` is installed* (recommended if available): a single Claude Code login serves all four seats. This step is manual. Ask the user to run `claude setup-token` in their own terminal rather than through this session (because it prints a long-lived token that would otherwise be captured in the session transcript), and then paste the token into `.env` as `CLAUDE_CODE_OAUTH_TOKEN` using their own editor. Create `.env` first with `cp -n .env.example .env` if it does not yet exist. This step is complete when `bun run runs usage` prints the login's five-hour and weekly utilisation, which loads the token without printing it and makes no model call. An exit code of `1` with "neither CLAUDE_CODE_OAUTH_TOKEN nor CLAUDE_CODE_OAUTH_TOKEN<N> is set" indicates that the token line in `.env` is still empty: `bun run runs` already loads `.env`, so the message's suggestion to pass another env file does not apply.
- *When `claude` is absent*: offer `ANTHROPIC_API_KEY` for `claude-api/<model>` or `OPENROUTER_API_KEY` for `openrouter/<model>`, to be added to `.env` by the user. No local command verifies these keys without a paid model call, so note that the first seat turn serves as their verification.
- *When `codex` is installed*: no additional setup is required. A seat configured as `openai-codex/<model>` reads the existing ChatGPT login under `CODEX_HOME` (`~/.codex` by default). Only if a seat later reports that the directory "holds no ChatGPT login" should the user run `codex login` themselves.

If the user has no credential ready yet, still create `.env` from `.env.example` and leave the seat to be marked unverified in section 4.

**C. Other machines and logins.** Skip this section unless the user intends to run across multiple hosts or multiple logins; otherwise Anabasis operates locally without `.env.runs`. When needed, create it with `cp -n .env.runs.example .env.runs` and guide the user through uncommenting the relevant settings: additional logins go in `.env` as numbered tokens, remote peers in `ANA_HOSTS`, and shared Python and tool specifications in `ANA_PYTHON` and `ANA_TOOLS`. This section is complete when `bun run runs usage` lists each login, `bun run runs hosts --health` reaches every host, and `bun run runs sync` (which reports drift without mutating hosts when run without `--yes`) lists any missing tools per host. Machine-specific operational facts (such as host roles and billing accounts) belong in the user's own `CLAUDE.md` outside the repository, which `AGENTS.md` refers to as the operator's `CLAUDE.md`; offer to draft a concise version and write it only upon confirmation.

## 3. Confirm, then write

Display the exact commands to be executed and files to be created, allow the user to revise them, and execute them only after explicit confirmation. Run the verification checks for manual steps once the user reports completing them.

## 4. Finish

Conclude with one status line per component, marked `yes` or `no` alongside its verification proof: Bun, the wall test, dependencies, git hooks, each seat's credential, and each remote host if section C ran. For any `no`, supply the command needed to resolve it. Mark any seat lacking a zero-cost verification path (Codex, an API key, or OpenRouter) as "not proved" with that explanation rather than `yes`. Finally, direct the user to the "Run it" section of `README.md` for launching the first campaign from a dedicated worktree with its own `bun install`, using `--dry-run` first to inspect the planned move without spending credits.
