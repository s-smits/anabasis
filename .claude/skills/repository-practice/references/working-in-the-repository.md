# 11. Working in the repository

Read this reference for repository commands, Git hooks, protected files, stacked pull requests, and
review discipline (`AGENTS.md` section 11). Publication procedures belong to `stack-pr`, and remote
check placement belongs to `local-checks`.

## Runtime and commands

Use the Bun version pinned in `package.json` for every task. `src/meta` wraps the few Node surfaces
Bun omits, and the campaign command refuses to run under an unpinned Bun version (`pinFault`,
`tools/d2/harness-builder.ts`).

| Command | What it does |
| --- | --- |
| `bun run typecheck` / `lint` / `format` | `bun check`; Oxlint with two local plugins (`-- --strict` fails on findings); Biome |
| `bun run gate -- --static` | Runs the gate with only the tests within one import hop of `HEAD`'s changes |
| `bun run hooks:install` | Points Git hooks at `.githooks` and installs `git complexity` |
| `bun run commit:check` / `simplify` / `not-slop` / `secrets` | Pre-commit validation; complexity and lint scans; answered-findings ledger; secret scan |
| `bun run ui:dev` / `ui:gate` | Local log viewer (`-- --exam-side` only when no Builder or solver is running); UI gate |
| `bun run follow` | Advances this checkout to the top of the oldest open stack, where local commits are not kept |
| `bun tools/loc/source-policy.ts` | File-size and unused-export policy check, invoked manually |

### Commands checked by the command guard

A command guard inspects every shell command prior to execution, including commands nested inside
`ssh <host> '...'` or `sh -c`. Write commands plainly; if the guard refuses a command, adopt the
sanctioned form named in the refusal rather than crafting a workaround.

- Write files using the dedicated file-editing tools instead of `>` or `cat > <file> <<EOF`. Reserve
  `>` for creating a new file inside the session's scratch or temporary directory, addressed by a
  literal path or by a variable assigned a single literal path once in the same command
  (`S=<path>; ... > "$S/out"`). Redirections whose target ends in a loop variable (`> "$S/out-$n"`),
  comes from `$(...)`, or points under the home directory outside the scratch directory are refused;
  use the editing tools or print to standard output instead.
- Place any script longer than a single line in a file and execute it (`python3 -I <file>`,
  `bun <file>`) rather than piping code to an interpreter (`python3 - <<'EOF'`,
  `python3 -c "$(...)"`, `... | python3`), because embedded code contains `${...}`, `$(...)`, and
  backticks that the guard cannot safely parse. When using a short data heredoc, quote its delimiter
  (`<<'EOF'`).
- Quote all variable expansions and globs, and pass literal paths to `mv` and `git -C`.
- Inspect historical file contents with `git show <ref>:<path>` instead of `git checkout <ref> -- <path>`,
  `git restore`, or `git reset --hard`.

## Hooks and CI

With Git hooks disabled (`git config core.hooksPath`), commits and pushes bypass local checks
silently, and pushed commits remain unverified until `land --sanitize` or `--merge` validates the
stack. GitHub Actions (`.github/workflows/ci.yml`) runs on the top of a landing chain across three
jobs: `darwin` (typecheck, strict lint, format, secrets, test suite), `darwin-ui` (UI install,
typecheck, build, and tests), and `linux` (Bubblewrap isolation, test suite, and climb simulation).
The pre-push hook marks each pushed head and all dependent pull requests above it as pending
(`tools/runtime/pre-push.ts`). Inside a container lacking user namespaces, wall tests fail and must
be reported as failures in the pull request.

## What you never touch

In addition to the protected list in `AGENTS.md` section 11: launch receipts also live under
`.ana/`; credentials are never copied from another checkout to make a command start; and
`vendor/pi-claude-bridge` copies upstream files verbatim at a cited commit before reapplying its
small, inline-marked local modifications (`terms-and-map.md`).

## The stack and pull requests

Read `stack-pr` before creating a branch or pushing. Its core rules are:

- Never state a repository fact without naming the commit at which you verified it.
- Extend an existing open pull request when the change fixes, simplifies, completes, or supersedes
  that PR's own code; touching a shared file alone does not qualify.
- Modify another session's pull request only with explicit operator authorisation, and append only
  new commits to a PR that has dependent children.
- Use one dedicated worktree per pull request, branched from the stack top at a pinned commit, with
  its own `bun install --frozen-lockfile`; never branch inside a worktree used to launch a run.
  `git stash` is forbidden because stash state is shared across worktrees.
- Fold fixes into the unpublished commit they repair; temporary commits created within a task
  (`commit-r`) are never published.
- `land` rejects any pull request lacking an importance label or category; omit "Ix:" prefixes from
  PR titles.
- Pass `--no-verify` only with operator authorisation. Stacks land exclusively via
  `land -- <top> --merge`, enforced by the GitHub ruleset on `main`.
- Link a native stack with `gh stack link <pr> <pr> ...` ordered bottom to top across the entire
  chain, because the short form appends above GitHub's current top rather than the chain's own base.
  `land --sanitize` and `--merge` invoke that link automatically when the stack holds only the
  chain's lower portion or none of it. Because `link` never reorders existing links, repair a wrong
  order by running `gh stack unstack <stack>` and relinking. `stack.ts` detects, and `land` refuses,
  any branch head that includes another open PR's commits without standing directly on it
  (`tools/runtime/doubled.ts`).

Pull request numbers up to #235 from before v2 moved into this repository are cited as
`anabasis-v2#N`. Every pull request states the affected behaviour first, cites source files as
evidence, notes explicitly when it addresses no defect, and comments on any pull request it
supersedes.

## Reviews and subagents

Before acting on any review finding, inspect the owning module, its callers, its tests, and its head
comment; state the observable consequence and the exact event or count that would confirm it; and
then inspect the most recent runs containing that code (`bun run runs replay` for a reader,
`tools/wri/wri.ts` or `runs view` for a campaign, or a direct count for an event kind). List both
the runs inspected and those left unread. A confirmed finding left only in a report counts as
unfinished work.
