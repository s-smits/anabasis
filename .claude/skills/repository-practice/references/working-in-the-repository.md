# 11. Working in the repository

Expands `AGENTS.md` §11. Publication procedures live in `stack-pr`; remote check routing in `local-checks`.

## Runtime & commands

Use the Bun pinned in `package.json` (`pinFault` in `tools/d2/harness-builder.ts` refuses unpinned Bun); `src/meta` wraps needed Node APIs.

| Command | Purpose |
| --- | --- |
| `bun run typecheck` / `lint` / `format` | `bun check`; Oxlint + 4 local plugins (`-- --strict` fails on plugin/ledger findings); Biome |
| `bun run gate [-- --static]` | Darwin CI jobs + `source-policy.ts` + `simplify -- --gate` (`--static`: nearby tests only) |
| `bun run hooks:install` | Set Git hooks to `.githooks` and install `git complexity` |
| `bun run commit:check` / `simplify` / `not-slop` / `secrets` | Pre-commit check; whole-tree census (`-- --gate`); ledger; secret scan |
| `bun run ui:dev` / `ui:gate` | Local log UI (`-- --exam-side` only when no Builder/solver runs); UI gate |
| `bun run follow` | Advance checkout to oldest open stack top (no local commits kept) |
| `bun tools/loc/source-policy.ts` | File/function size and unused-export check (also in `gate`) |

### Commands checked by the command guard

Every shell command (including inside `ssh <host> '...'` or `sh -c`) passes a command guard. On refusal, use the sanctioned form named in the refusal:
- Edit files via dedicated edit tools, not `>` or `cat > file <<EOF`. Use `>` only for new files in scratch/temp dirs via a literal path or a single literal-assigned var (`S=<path>; ... > "$S/out"`), never loop-indexed targets, `$(...)` targets or home paths outside scratch.
- Put multi-line scripts in files (`python3 -I <file>`, `bun <file>`) rather than piping code to interpreters (`<<'EOF'` for short data heredocs only).
- Quote variable expansions/globs; pass literal paths to `mv` and `git -C`.
- Read history via `git show <ref>:<path>`, not `git checkout <ref> -- <path>`, `git restore` or `git reset --hard`.

## Hooks, CI & protected files

Keep Git hooks enabled (`core.hooksPath`). `.github/workflows/ci.yml` runs on landing tops across `darwin`, `darwin-ui` and `linux` (Bubblewrap + climb). Pre-push marks pushed heads and dependent PRs pending (`tools/runtime/pre-push.ts`). Missing-userns wall failures are real failures.

Protected beyond `AGENTS.md` §11: launch receipts under `.ana/`; never copy credentials between checkouts; `vendor/pi-claude-bridge` copies upstream verbatim at a cited commit with inline-marked local edits (`terms-and-map.md`).

## Stack, PRs & reviews

Follow `stack-pr`:
- Always name the commit at which a repo fact was verified.
- Extend an open PR for fixes/simplifications to its own code; append commits only if it has children; never edit another session's PR without operator authorisation.
- One worktree per PR from pinned stack top with `bun install --frozen-lockfile`; no branching inside live-run worktrees; no `git stash`.
- Fold fixes into unpublished commits; never publish temporary `commit-r` commits.
- `land` requires an importance label + category (no `Ix:` prefix in titles): `I0` results already invalid/unsafe (bad reading/promotion, wall breach, lost answers, leaked credentials, cap exceeded, broken `main`; live runs pause); `I1` fixes a defect in decisions, measurement or seat exposure, prevents corruption/crashes/stalls/lost sessions/wasted compute, or removes a mechanism; `I2` other production code, prompts or run/landing tooling changes (including simplifications); `I3` reporting, wording, comments, docs, skill prose or tests alone. `--no-verify` requires operator authorisation; `main` lands solely via `land -- <top> --merge`.
- Store backlog items in `docs/backlog/<subject>.md` (intended changes followed by history in the operator's words).
- Link native stacks bottom-to-top (`gh stack link <pr>...`; `land --sanitize`/`--merge` runs this automatically). Repair wrong order via `gh stack unstack <stack>` then relink. `stack.ts` and `land` reject doubled-commit branches (`tools/runtime/doubled.ts`).
- Pre-v2 PRs (≤#235) are cited as `anabasis-v2#N`. State affected behaviour first, cite source, note when no defect is addressed, and comment on superseded PRs.

Before acting on any review finding, inspect owner, callers, tests and head comment; name the confirming event/count; check recent runs with that code (`runs replay`, `wri.ts`, `runs view`); list runs inspected and left unread. Confirmed findings left only in reports count as unfinished work.

When delegating to reviewers or subagents (where permitted by operator config), assign one bounded read-only task stating authority, paths, revision, known facts and exact question; supply source rather than conclusions; require counts with denominators and `file:symbol` citations; and verify every finding at source as confirmed, plausible or refuted.
