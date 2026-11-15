---
name: local-checks
description: "Decide where a check of Anabasis runs: locally (the pre-push hook, `stack.ts`, `bun run land`, the runner hosts) or on GitHub Actions, which runs `ci.yml` alone. Use when adding, moving or tuning a check, a workflow, a commit status or the pre-push hook, when asked about CI/CD, Actions use or a check shown on a pull request, or before editing `.github/workflows/`. Counts Actions runs with scripts/actions.ts."
---

# Local checks

GitHub Actions runs only `ci.yml`, dispatched by `bun run land -- <top> --merge`, because its suite
needs clean machines independent of the operator's (Seatbelt and the disk image on macOS,
Bubblewrap on Linux, the UI's browser tests). Every other check runs locally and shows on GitHub
as a commit status, one API call instead of a runner.

| check | where | GitHub shows |
| --- | --- | --- |
| `git diff --check`, secret scan | pre-push hook | nothing |
| static steps and nearby tests | pre-push hook, `ANA_PUSH_VERIFY=1` | nothing |
| pushed head and pull requests above it reset | pre-push hook (`mark`) | `mergeable` pending |
| a pull request repeating another's commits | `stack.ts`, refused by `land` (`doubled.ts`) | nothing |
| each commit alone, the gate at the top | `bun run land -- <top> --sanitize` | `ana/commit`, `mergeable` |
| the clean-machine suite; after test failures, `ci-fixes` (`fixesFor`, `tools/runtime/ci-runs.ts`) | `ci.yml`, from `land --merge` | `ci.yml` |
| the landing | `land --merge` | `ana/stack-gate`, required on `main` |

`--no-verify` skips the hook and its pending mark.

## On which machine

`bun run test|typecheck|lint|secrets|gate` and `bun test` go through the bun router
(`tools/runtime/router/`, installed with `bun tools/runtime/router/install.ts`). They run on this
machine unless `RUN_REMOTE` names a host that `ANA_HOSTS` lists with `checks`, as in
`RUN_REMOTE=<host> bun run land -- <top> --sanitize`. Git carries the working tree there,
uncommitted bytes included, as one commit in `HEAD`'s place, so only what the host lacks travels and
a static gate reads the same change. The dependencies never travel: a slot installs them from the
lockfiles it was sent, and again only once a lockfile or the pinned Bun moves. Exits 255, 75 and 69
say nothing about the tree (`NO_VERDICT`, `tools/runtime/gate.ts`).

## Placing a new check

Stop at the first yes: does its verdict need an independent clean machine (a step of `ci.yml`,
never a new workflow); should it stop a push (the hook if it takes seconds, else under
`ANA_PUSH_VERIFY=1`); should it stop a landing (`bun run land`); is it a reading of the stack
(`stack.ts`)? To show a result, post `gh api -X POST repos/{owner}/{repo}/statuses/<sha> -f
state=... -f context=<name>` with the context named once in `tools/runtime/pulls.ts` or `land.ts`.
An event this machine never sees is caught at the next `stack.ts` or landing.

## Measuring

```sh
bun .claude/skills/local-checks/scripts/actions.ts [--hours 24]
```

prints each workflow's runs by triggering event. A pull request that moves a check gives the counts
before and after, in runs and runner-minutes.
