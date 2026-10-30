# 11. Working in the repository

Read this for checks, hooks, protected files, publication and review. This expands `AGENTS.md`
section 11. The publication procedure belongs to `stack-pr` .

## Runtime and commands

Bun 1.4.4 only, as `package.json` pins it, for every task including one-off inspection; no Node, npm
or npx. `src/meta` wraps the few Node surfaces Bun lacks. The campaign command refuses to run under
any other Bun than the tree's pin (`pinFault`, `tools/d2/harness-builder.ts` ).

| Command | What it does |
| --- | --- |
| `bun run typecheck` / `lint` / `format` | `bun check`; Oxlint with the two plugins (`-- --strict` fails on their findings); Biome |
| `bun run test -- <paths...>` | The suite through its wrapper, never bare `bun test`; it refuses a named path that does not exist |
| `bun run gate` | The CI gate in one command; `-- --static` runs only the tests one import from what HEAD changed |
| `bun run hooks:install` | Points the clone's hooks at `.githooks` and adds `git complexity`, once per clone |
| `bun run commit:check` / `simplify` / `not-slop` / `secrets` | The pre-commit check; the scans; the answered-findings ledger; the secret scan |
| `bun run runs <verb>` | The run registry's verbs (`run-management`) |
| `bun run ui:dev` / `ui:gate` | The page over a campaign's log (`packages/ui/README.md`; `-- --exam-side` only where no Builder or solver runs); the UI's CI gate |
| `bun .claude/skills/stack-pr/scripts/stack.ts` | The open stack: every edge, and the top |
| `bun run follow` | Moves this checkout to the top of the stack holding the oldest open pull request, on `stack-pr<N>`, where a commit is not kept |
| `bun run land -- [<pull request>]` | Proves every commit a landing would publish; `--sanitize` posts each verdict, `--merge` also merges |
| `bun tools/loc/source-policy.ts` | The size policy over `src`, `tools` and `vendor`, and the unused-export policy over its roots; no script, CI job or hook runs it |
| `bun .claude/skills/repository-practice/scripts/preflight.ts` | What a change owes before a commit or a pull request: the tests the static gate would choose, the UI gate, the areas it enters, size and prose findings, and a suggested label (`SKILL.md`) |

## Hooks and CI

**Keep the hooks enabled** (`git config core.hooksPath` says whether they are): without them a
commit and a push go unchecked, silently. A plain push runs only `git diff --check` and the secret
scan, so a pushed commit is unproved until `bun run land -- <top> --sanitize` or `--merge` has
proved the stack; run the gate or `--sanitize` before any delivery that claims its tests. What each
hook, `ANA_PUSH_VERIFY=1` , the remembered passes and CI's three jobs run is `stack-pr` , sections 5
to 7. Run one full suite at a time on a host, and while editing only the owning test files. CI
(`.github/workflows/ci.yml`) runs on `main` and on a landing's top, where `land --merge` dispatches
it, in three jobs: `darwin` (ripgrep and the UI's dependencies, then typecheck, strict lint, format
check, the secret scan and the suite), `darwin-ui` (the UI's install, then its typecheck and build
and its tests, which need the install step to have passed) and `linux` (Bubblewrap, the suite, then
the climb simulation). A push to a pull request starts only `mergeable.yml` . In a container without
user namespaces the wall's tests fail: name them in the pull request as failures without the change,
and do not call the suite green.

## What you never touch

- `.ana/`: campaign logs, kept harnesses, launch receipts. Read them through the readers; never
  edit, move or commit them.
- A pack, a check program or a kept harness, by rule 2.
- `.env` and any credential. Never copy one from another checkout to make a command start.
- `vendor/`: `pi-claude-bridge` changes only by a **sed** of upstream (section 14,
  `terms-and-map.md`): the files at a cited path and commit copied whole, then the few most
  important local parts added back, each marked in place. A hand port or a merge of upstream into
  the file is no sed.
- Installed dependencies: no patches, and no edits under `node_modules`.

## The stack and pull requests

`.claude/skills/stack-pr/SKILL.md` owns this procedure: read it before you branch and again before
you push. One release cycle builds one stack of pull requests, landed whole by one `bun run land` ,
and every later subject goes on its top. A stack of its own on `main` starts only on the operator's
word, for a change that must land before the cycle's stack.

- **Read the stack every time** before `git worktree add`, a new pull request or a rewriting push,
  and state no repository fact without the commit you read it at.
- **Expand an open pull request before opening a new one** when the change fixes, simplifies,
  completes or supersedes its own code (a shared file alone does not count); never fork off the
  middle of a stack.
- **Another session's pull request changes only on the operator's word**; one with children takes
  new commits only.
- **One worktree per pull request**, from the top, pinned by commit, with its own
  `bun install --frozen-lockfile`. Never branch in a worktree a run was launched from.
- **Never use `git stash` by hand**: it is shared between worktrees.
- **Every published commit passes alone.** Fold a fix into the unpublished commit it corrects; a
  temporary commit inside one task (`commit-r`) is no published commit.
- **Label every pull request** with exactly one of `importance:I0` to `I3` and at least one category
  (`CATEGORIES`, `tools/runtime/land.ts`); `land` refuses a stack missing either. `I0` blocks a
  release or further operation; `I1` protects comparison validity, prevents a serious run failure,
  or broadly simplifies the tree or the suite; `I2` is a bounded functional improvement; `I3` is
  reporting, diagnostics, wording or convenience. No "Ix:" prefix in the title.
- **Push your own branch**, never `main`, with `--no-verify` only on the operator's word, and a
  rewrite with `--force-with-lease` on the head you last saw.
- **Merging is the operator's call**, and so is restacking or consolidating the whole stack
  (`stack-pr`, sections 8 to 10). A stack lands only through `bun run land -- <top> --merge`, which
  GitHub's ruleset on `main` enforces; never push a local merge to `main`.
- **A native stack** is made with `gh stack link <pr> <pr> ...`, bottom to top, which sets the
  bases; setting a base alone leaves a pull request outside it. `gh stack unstack <stack>`
  dissolves a whole stack.

v2 was built in `s-smits/anabasis-v2` until 11 October 2026: a pull request number written before
then, up to #235, is that repository's (cite it as `anabasis-v2#N` ); this one's run to #140 for v1
and continue from there. A cited v2 hash that does not resolve here was on one of that repository's
pull-request branches, rewritten before it merged.

Commit subjects and pull request bodies follow `stack-pr` sections 5 and 7 and section 13
(`code-and-writing.md`): name what misbehaves (the campaign command, a reader, the Builder) with its
file in the evidence, say in one line when no defect lies behind a change, and comment on each pull
request it turns back or retires.

## Reviews and subagents

Launch parallel subagents in one message, one bounded task each, with no coordinator. Each prompt
names its authority, the exact paths and commit, the observed facts, the question and the required
output, and says read-only unless the operator asked for changes. Give a reviewer the code, and keep
your conclusion to yourself.

Before acting on or repeating a finding, read the owner, its callers, tests and head comment. State
the observable consequence and the event or count that would establish it. Then inspect the newest
runs containing that code (section 9, "Evidence", `evidence-and-claims.md` ): `bun run runs replay`
for a reader, `tools/wri/wri.ts` or `bun run runs view` for a campaign, a count for an event kind.
Report each finding as confirmed (with the campaign and event), plausible (from source alone, with
the run that would settle it) or refuted, naming the runs read and left unread. The launching
session checks a subagent's report and acts on what held, within the task's authority: a confirmed
finding left in a report is dropped work.
