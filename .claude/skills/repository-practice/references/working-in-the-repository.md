# 11. Working in the repository

Read this for commands, hooks, protected files, the stack and reviews (`AGENTS.md` section 11).
Publication is `stack-pr`'s, and where a check runs `local-checks`'s.

## Runtime and commands

Bun as `package.json` pins it, for every task; `src/meta` wraps the few Node surfaces Bun lacks, and
the campaign command refuses another Bun (`pinFault`, `tools/d2/harness-builder.ts`).

| Command | What it does |
| --- | --- |
| `bun run typecheck` / `lint` / `format` | `bun check`; Oxlint with two plugins (`-- --strict` fails on findings); Biome |
| `bun run gate -- --static` | The gate with only the tests one import from HEAD's change |
| `bun run hooks:install` | Points hooks at `.githooks` and adds `git complexity` |
| `bun run commit:check` / `simplify` / `not-slop` / `secrets` | Pre-commit check; scans; the answered-findings ledger; secret scan |
| `bun run ui:dev` / `ui:gate` | The log page (`-- --exam-side` only where no Builder or solver runs); its gate |
| `bun run follow` | Moves this checkout to the top of the oldest open stack, where commits are not kept |
| `bun tools/loc/source-policy.ts` | Size and unused-export policy, run by hand only |

## Hooks and CI

Without hooks (`git config core.hooksPath`) commits and pushes go unchecked silently, and a pushed
commit is unproved until `land --sanitize` or `--merge` proves the stack. CI
(`.github/workflows/ci.yml`) runs on a landing's top in three jobs: `darwin` (typecheck, strict
lint, format, secrets, suite), `darwin-ui` (the UI's install, typecheck, build and tests) and
`linux` (Bubblewrap, the suite, the climb simulation). The pre-push hook marks each pushed head and
the pull requests above it pending (`tools/runtime/pre-push.ts`). In a container without user
namespaces the wall's tests fail; name them in the pull request as failures.

## What you never touch

Beside section 11's list: launch receipts sit in `.ana/` too; a credential is never copied from
another checkout to make a command start; `vendor/pi-claude-bridge` takes upstream files at a cited
commit whole, then the few local parts added back, each marked in place (`terms-and-map.md`).

## The stack and pull requests

Read `stack-pr` before you branch and before you push. Its rules, briefly:

- State no repository fact without the commit you read it at.
- Expand an open pull request when the change fixes, simplifies, completes or supersedes its own
  code; a shared file alone does not count.
- Another session's pull request changes only on the operator's word, and one with children takes
  new commits only.
- One worktree per pull request, from the top, pinned by commit, with its own
  `bun install --frozen-lockfile`; never branch in a worktree a run was launched from. `git stash`
  is shared between worktrees, hence the ban.
- Fold a fix into the unpublished commit it corrects; a temporary commit inside one task
  (`commit-r`) is not published.
- `land` refuses a pull request without a label or category; no "Ix:" prefix in a title.
- `--no-verify` only on the operator's word. A stack lands only through `land -- <top> --merge`,
  which GitHub's ruleset on `main` enforces.
- A native stack is `gh stack link <pr> <pr> ...`, bottom to top, naming the whole chain, since the
  short form appends above GitHub's top, which may not be the chain's. `link` never reorders; mend
  an order with `gh stack unstack` and link again. `stack.ts` lists, and `land` refuses, a head that
  holds another open pull request's without standing on it (`tools/runtime/doubled.ts`).

Pull request numbers up to #235 from before v2 moved here are `anabasis-v2#N`. A pull request names
the affected behaviour, then cites files as evidence, says so when it answers no defect, and
comments on each pull request it supersedes.

## Reviews and subagents

Before acting on a finding, read the owner, callers, tests and head comment; state the observable
consequence and the event or count that would establish it; then inspect the newest runs holding
that code (`bun run runs replay` for a reader, `tools/wri/wri.ts` or `runs view` for a campaign, a
count for an event kind). Name the runs read and left unread. A confirmed finding left in a report
is dropped work.
