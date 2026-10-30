---
name: local-checks
description: "Decide where a check of Anabasis v2 runs: on this machine (the pre-push hook, `stack.ts`, `bun run land`, the runner hosts) or on GitHub Actions, which runs `ci.yml` alone. Use when adding, moving or tuning a check, a workflow, a commit status or the pre-push hook, when the operator asks about CI/CD, GitHub Actions use or a check shown on a pull request, or before editing `.github/workflows/`. Counts Actions runs by workflow with scripts/actions.ts."
---

# Local checks

GitHub Actions runs one workflow, `ci.yml`, and only when `bun run land -- <top> --merge`
dispatches it on the top's head. It stays there because its tests need a machine independent of the
operator's: a clean macOS runner for Seatbelt and the disk image, a clean Linux one for Bubblewrap,
and the UI's browser tests beside them. Every other check runs here, and where GitHub should show
its result, it posts a commit status through the API, which costs one call and no runner. On
30 October 2026 the operator asked for this ("as much locally as possible except 'ci'"): the last
day had held 193 Actions runs, 189 of them for checks this machine already made or could make.

## Where each check lives

| check | where it runs | what GitHub shows |
| --- | --- | --- |
| `git diff --check`, the secret scan on what a push adds | the pre-push hook, every plain push | nothing |
| static steps and nearby tests | the pre-push hook with `ANA_PUSH_VERIFY=1` | nothing |
| a pushed head, and the pull requests above it, go back to unproved | the pre-push hook, once its checks pass: a detached process marks them as soon as GitHub holds the push (`mark`) | `mergeable` pending |
| a pull request that repeats another's commits | `stack.ts` lists it, `land` refuses it (`doubled.ts`) | nothing |
| each commit passes alone; the whole gate at the top | `bun run land -- <top> --sanitize`, on a runner host | `ana/commit`, `mergeable` success or failure |
| the clean-machine suite on both platforms | `ci.yml`, dispatched by `land --merge` | `ci.yml` |
| the landing itself | `land --merge` | `ana/stack-gate`, the one check the ruleset on `main` requires |

A plain `bun run gate|test|typecheck|lint` already goes to a runner host through the Bun shim, so
"local" includes the operator's other machines; the operator's machine rules name them.
`--no-verify` skips the pre-push hook whole, the pending mark with it. The GitGuardian app on the
repository is no workflow and runs nothing of ours; removing it is the operator's.

## Placing a new check

Ask in this order and stop at the first yes:

1. **Does its verdict need a machine independent of the operator's?** A wall, an OS feature, or a
   suite that must pass on a clean install. Then it is a step of `ci.yml`, never a workflow of its
   own, so it still runs only at a landing.
2. **Should it stop a push?** The pre-push hook, if it takes seconds: a plain push must stay quick,
   and a slower check goes under `ANA_PUSH_VERIFY=1`.
3. **Should it stop a landing?** `bun run land`, which reads the chain again before it merges.
4. **Is it a reading of the stack?** `stack.ts`, which every session runs before a branch and a push.

Where GitHub should show the result, post a status with `gh api -X POST
repos/{owner}/{repo}/statuses/<sha> -f state=... -f context=<name>`, naming the context once in
`tools/runtime/pulls.ts` or `land.ts`. A status belongs to its commit, so a new commit starts with
none. A GitHub event this machine never sees, such as a base changed with no push, is caught at the
next `stack.ts` or landing instead of by a workflow: `stacked.yml` ran 49 times in 15.5 hours on
30 October for a check `land` already made before every merge.

## Measuring

```sh
bun .claude/skills/local-checks/scripts/actions.ts [--hours 24]
```

prints each workflow's runs over the window, by the event that started them, and its first run, so
a workflow younger than the window is read against the hours it existed. Give the count before and
after in a pull request that adds, moves or removes a check. A run of `ci.yml` costs far more
runner time than any other workflow ever did (about 17 runner-minutes over its three jobs on
30 October, against 5 to 12 seconds), so count runs for how often GitHub is woken and minutes for
what it costs.
