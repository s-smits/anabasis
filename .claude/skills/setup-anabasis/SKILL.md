---
name: setup-anabasis
description: "Set up a clone of Anabasis on this machine for its first campaign: Bun, the wall, dependencies and hooks, the credentials a model seat reads, and, where the user has them, other machines and logins. Explores first, proposes one section at a time with a recommended answer, writes only what the user confirms, and ends with a proof of each step that spends nothing. Run it again to verify an existing setup."
disable-model-invocation: true
---

# Set up Anabasis

This skill brings one clone to the point where `README.md`'s "Run it" can start a campaign. It
is a procedure, not a script: explore, present what you found, confirm, write, then prove each
step with a command whose exit code says it holds. Run again, it is the verify pass: explore,
report what drifted, and write nothing without a yes.

Three limits hold throughout. It spends nothing: no model seat, no launch, no `--yes` on a verb
that would change another machine. It needs no root: a command that takes `sudo`, a browser or
a password is printed for the user to run in their own terminal. And it never opens, prints or
overwrites an env file (`AGENTS.md`, sections 10 and 11): it creates `.env` or `.env.runs` from
its `.example` only where none exists, the user fills in the values, and a command that loads the
file proves them. It edits no tracked file, shell profile or ssh configuration.

The README and the two `.example` files own every value and its meaning; point at them instead of
restating them.

## 1. Explore

Read, changing nothing:

- `uname -s` and `bun --version`, against `packageManager` in `package.json`.
- On Linux, `bwrap --version` and `sysctl -n kernel.apparmor_restrict_unprivileged_userns`. The
  wall needs it at 0; Ubuntu 24.04 and later set it to 1, and a missing key means AppArmor does
  not restrict user namespaces.
- `test -d node_modules`, and `git config core.hooksPath` (the hooks are on when it says
  `.githooks`).
- `test -e .env` and `test -e .env.runs`, which say whether each exists and nothing of what it
  holds.
- `command -v claude` and `claude --version`; `command -v codex`. Presence only: never read
  `~/.claude`, `~/.codex`, the keychain or a login's status.
- `command -v rg` (`bun run runs search` needs it) and `python3 --version`.

Installers put `bun`, `claude` and `codex` in folders such as `~/.local/bin` or `~/.bun/bin`
through a shell profile, which a non-interactive shell does not read. Before you report one
missing, ask again in a login shell (`zsh -lc 'command -v claude'`, or `bash -lc` on Linux).

## 2. Present and ask

Show one table of what is present and what is missing, then take the sections in order, one
answer each. Lead each with the recommended answer so a word accepts it, and skip a section that
exploration settled.

**A. This machine.** Recommended: whatever is missing of Bun 1.4.4 (the README's `curl` line,
printed for the user), on Linux `bubblewrap` and the AppArmor setting (printed, since both take
`sudo`), then `bun install --frozen-lockfile` and `bun run hooks:install`, which you run. Bun's
installer adds `~/.bun/bin` to the shell profile, so the session that ran it finds the new Bun
only in a new shell or at `~/.bun/bin/bun`. `bun install` may report blocked lifecycle scripts;
leave them blocked, since nothing this setup proves needs them. Done when `bun --version` prints
the pinned version and the wall test passes on this machine:
`RUN_REMOTE=here bun run test -- test/walled-env.test.ts`. A failure there from unavailable user
namespaces is a failure to report, not to skip.

**B. Model seats.** This is the one real choice. A seat names its provider (`README.md`,
"Seats"), and `.env.example` lists the credential each reads.

- *The `claude` command is installed* (recommended where it is): one Claude Code login serves all
  four seats. This step is manual. Ask the user to run `claude setup-token` in their own
  terminal, not through this session, since it prints a long-lived token and anything run here
  lands in the transcript; then to paste it into `.env` as `CLAUDE_CODE_OAUTH_TOKEN` with their
  own editor. Create `.env` first with `cp -n .env.example .env` where it is missing. Done when
  `bun run runs usage` prints that login's five-hour and weekly use, which loads the token without
  printing it and calls no model. Its exit 1 with "neither CLAUDE_CODE_OAUTH_TOKEN nor
  CLAUDE_CODE_OAUTH_TOKEN<N> is set" means the token line in `.env` is still empty: `bun run runs`
  has already loaded `.env`, so the message's advice to pass another env file does not apply.
- *No `claude` command*: offer `ANTHROPIC_API_KEY` for `claude-api/<model>` or
  `OPENROUTER_API_KEY` for `openrouter/<model>`, written into `.env` by the user. No command here
  proves these without a model call, so say that the first seat's turn is their proof.
- *The `codex` command is installed*: nothing to set up. A seat named `openai-codex/<model>`
  reads the ChatGPT login the Codex CLI already holds under `CODEX_HOME` (`~/.codex` by default).
  Only if a seat then reports that the folder "holds no ChatGPT login" does the user run
  `codex login` themselves.

Where the user has no credential to give yet, create `.env` from its example all the same and
leave the seat for section 4 to mark.

**C. Other machines and logins.** Skip unless the user says they run on more than one machine or
more than one login; with neither, Anabasis stays on this machine and needs no `.env.runs`. Where
they do, create it with `cp -n .env.runs.example .env.runs` and walk them through the settings
they uncomment there: further logins go in `.env` as numbered tokens, hosts in `ANA_HOSTS`, the
shared Python and tools in `ANA_PYTHON` and `ANA_TOOLS`. Done when `bun run runs usage` lists each
login, `bun run runs hosts --health` reaches each host, and `bun run runs sync`, which reports
drift and changes nothing without `--yes`, names what each host lacks. Facts true only of the
user's own machines (which host is for what, which login pays) belong in their own `CLAUDE.md`
outside the tree, which `AGENTS.md` calls the operator's; offer a short one, and write it only on
a yes.

## 3. Confirm, then write

Show the exact commands you will run and the files you will create, let the user change them, and
run them only on their word. Run the manual steps' "done when" once the user says they have done
them.

## 4. Finish

End with one line a step, each marked yes or no with its proof: Bun, the wall test, dependencies,
hooks, each seat's credential, and each host where section C ran. For a no, give the command that
would fix it. A seat with no free proof (Codex, an API key, OpenRouter) is marked "not proved",
with that reason, never yes. Then point at the README's "Run it" for the first campaign, which
runs from a worktree of its own with its own `bun install`, and at its `--dry-run`, which prints
the next move and makes none, as the step before the first paid launch.
