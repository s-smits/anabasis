---
name: local-checks
description: "Decide where each Anabasis check runs: locally (pre-push hook, `stack.ts`, `bun run land`, and fleet runner hosts) or on GitHub Actions, which runs `ci.yml` exclusively. Use when adding, relocating, or tuning a check, workflow, commit status, or pre-push hook, when asked about CI/CD, GitHub Actions usage, or pull request checks, or before modifying `.github/workflows/`. Counts Actions runs via scripts/actions.ts."
---

# Local checks

GitHub Actions runs only `ci.yml`, dispatched exclusively by `bun run land -- <top> --merge`,
because its verification suite requires clean, isolated machines independent of the operator's
workstations (Seatbelt and disk-image checks on macOS, Bubblewrap namespaces on Linux, and browser
tests for the UI). Every other check runs locally or on the fleet and reports to GitHub via a
single commit-status API call rather than consuming CI runners.

| check | where | GitHub shows |
| --- | --- | --- |
| `git diff --check`, secret scan | pre-push hook | nothing |
| static steps and nearby tests | pre-push hook, `ANA_PUSH_VERIFY=1` | nothing |
| reset pushed head and dependent pull requests | pre-push hook (`mark`) | `mergeable` pending |
| pull request duplicating another's commits | `stack.ts`, refused by `land` (`doubled.ts`) | nothing |
| per-commit verification and top gate | `bun run land -- <top> --sanitize` | `ana/commit`, `mergeable` |
| clean-machine suite; after test failures, `ci-fixes` (`fixesFor`, `tools/runtime/ci-runs.ts`) | `ci.yml`, from `land --merge` | `ci.yml` |
| final stack gate | `land --merge` | `ana/stack-gate`, required on `main` |

Passing `--no-verify` bypasses the pre-push hook and its `mergeable` pending reset.

## Host routing

`bun run test|typecheck|lint|secrets|gate` and `bun test` route through the Bun router
(`tools/runtime/router/`, installed with `bun tools/runtime/router/install.ts`). When `ANA_HOSTS`
defines remote hosts (configured in the operator's `CLAUDE.md`), leaving `ANA_CHECK_HOST` unset
behaves identically to `ANA_CHECK_HOST=auto`: the router samples one-minute load per core across
the local machine and every configured host (`tools/runs/load.ts`, the same probe used by
`runs loadwatch`, taking roughly one second) and dispatches the task to the least loaded host with
a free slot, omitting any host that does not respond within `ANA_RUNNER_PICK_WAIT` (5 s). When no
hosts are configured or the host list cannot be read, an unset `ANA_CHECK_HOST` runs locally
without probing. Setting `ANA_CHECK_HOST=here` forces local execution, and setting it to a specific
host name targets that host directly.

`bun run land` handles an unset `ANA_CHECK_HOST` differently (`whereToProve`,
`tools/runtime/landing.ts`): it distributes per-commit passes across all configured hosts up to
each host's `checks` concurrency limit (default 2), sends the top commit's full gate (when
required) to the first listed host, and retries any commit whose host returned no verdict on a
different host. When no remote hosts exist or `ANA_CHECK_HOST` is explicitly set (for example,
`ANA_CHECK_HOST=here bun run land -- <top> --sanitize`), `land` runs through the standard single
runner path (under `auto`, each pass independently selects the least loaded slot).

Git transfers the working tree (including uncommitted modifications) as a single synthetic commit
on top of `HEAD`, so only missing objects cross the network and static gates inspect the exact same
diff. Dependencies are never copied over the network: each runner slot installs from the
transferred lockfiles and reinstalls only when a lockfile or the pinned Bun version changes. Any
runner slot idle for seven days is moved to Trash by that host's daily `runs retire`
(`trashIdleSlots`), preventing stale clones from accumulating. Exit codes 255, 75, and 69 denote
infrastructure failures rather than code verdicts (`NO_VERDICT`, `tools/runtime/gate.ts`).

## Placing a new check

Assign a new check to the first matching tier:

1. Does its verdict require an independent clean machine? Add it as a step inside `ci.yml` rather
   than creating a new workflow.
2. Should it block a push? Place it in the pre-push hook if it finishes in seconds, or gate it
   behind `ANA_PUSH_VERIFY=1` otherwise.
3. Should it block a landing? Add it to `bun run land`.
4. Is it a read-only diagnostic over the stack? Add it to `stack.ts`.

To publish a local result to GitHub, post
`gh api -X POST repos/{owner}/{repo}/statuses/<sha> -f state=... -f context=<name>`, declaring the
status context once in `tools/runtime/pulls.ts` or `land.ts`. Any state change missed by a local
machine is caught on the next `stack.ts` or `land` run.

## Measuring Actions usage

```sh
bun .claude/skills/local-checks/scripts/actions.ts [--hours 24]
```

This script tabulates workflow runs by triggering event. Any pull request that moves or alters a
check must report before-and-after counts in both workflow runs and runner-minutes.
