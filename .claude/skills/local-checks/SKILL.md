---
name: local-checks
description: "Use before adding, relocating, or tuning a check, commit status, pre-push hook, or `.github/workflows/` file, or when checking CI/CD or GitHub Actions usage. Decides where each Anabasis check runs: locally (pre-push hook, `stack.ts`, `bun run land`, fleet runner hosts) or on GitHub Actions (`ci.yml` exclusively); counts Actions runs via `scripts/actions.ts`."
---

# Local checks

GitHub Actions runs `ci.yml` exclusively (dispatched by `bun run land -- <top> --merge`) for clean-machine proofs (macOS Seatbelt/disk-image, Linux Bubblewrap, UI browser tests). Every other check runs locally or across the fleet and posts a commit status via API.

| Check | Where | GitHub status |
| --- | --- | --- |
| `git diff --check`, secrets | pre-push hook | none |
| Static checks & nearby tests | pre-push (`ANA_PUSH_VERIFY=1`) | none |
| Reset pushed head & child PRs | pre-push (`mark`) | `mergeable` pending |
| Doubled-commit detection | `stack.ts`, refused by `land` (`doubled.ts`) | none |
| Per-commit proof & top gate | `bun run land -- <top> --sanitize` | `ana/commit`, `mergeable` |
| Clean-machine suite (+ `ci-fixes` on test failure) | `ci.yml` via `land --merge` | `ci.yml` |
| Final stack gate | `land --merge` | `ana/stack-gate` (required on `main`) |

`--no-verify` bypasses the pre-push hook and its pending reset.

## Host routing (`tools/runtime/router/`, installed via `router/install.ts`)

- `bun run test|typecheck|lint|secrets|gate` and `bun test`: unset `ANA_CHECK_HOST` = `auto`—probes 1m load/core across local + `ANA_HOSTS` (`tools/runs/load.ts`, 5s timeout `ANA_RUNNER_PICK_WAIT`) and picks the least-loaded free slot (falls back to local if no hosts configured). `ANA_CHECK_HOST=here` forces local; naming a host targets it directly. `ANA_CHECK_HOST=all` splits `test` into chunks of like recorded time (`test/.test-timings.json`; unknown files weigh the median), two per slot, over the places under 0.5 1m load/core (the least loaded where none is), moving a chunk elsewhere on no verdict; other tasks run as `auto` over those places.
- `bun run land` and commit-r's `mutate.ts` with unset `ANA_CHECK_HOST` (`checkPlaces`, `tools/runs/host-config.ts`), and `mutate.ts --fleet` (nightly) under any `ANA_CHECK_HOST` (`fleetPlaces`): fan per-commit passes or mutants across all hosts up to each host's `checks` limit (default 2), land sends the top gate to the first host; both retry no-verdict work elsewhere. One owner (`spread`, `tools/runs/host-config.ts`) deals every such task—land and pre-push proofs, mutants, `all` test chunks—to free seats by room, drops a place that refuses or gives no verdict and puts its task back in order.
- Transfers working tree (incl. uncommitted edits) as one synthetic commit; slots reinstall only when lockfiles or Bun pin change; `runs retire` trashes slots idle ≥7 days (`trashIdleSlots`). Exit codes 255/75/69 = infrastructure non-verdict (`NO_VERDICT`, `tools/runs/host-config.ts`).

## Placing a new check & measuring Actions

1. Needs an independent clean machine? Add a step to `ci.yml` (no second workflow).
2. Should block push? Fast → pre-push hook; slower → `ANA_PUSH_VERIFY=1`.
3. Should block landing? Add to `bun run land`.
4. Read-only stack check? Add to `stack.ts`.

Publish local statuses via `gh api -X POST repos/{owner}/{repo}/statuses/<sha> -f state=... -f context=<name>` (declare context once in `tools/runtime/pulls.ts` or `land.ts`). Report before/after workflow runs and runner-minutes on any check-moving PR:

```sh
bun .claude/skills/local-checks/scripts/actions.ts [--hours 24]
```

## Related skills

- Landing, sanitising & stack ops: [stack-pr](../stack-pr/SKILL.md)
- Preflight & repo commands: [repository-practice](../repository-practice/SKILL.md)
