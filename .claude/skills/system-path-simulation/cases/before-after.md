# Before and after

Run identical input at the commit without the change (`before`) and with it (`after`) so the commit is the single variable (rule 5):

| Scope | Before | After |
| --- | --- | --- |
| Single commit | `<sha>~1` | `<sha>` |
| Whole PR | parent PR's head | PR head |
| Fix for a run | run's commit (`bun run runs source <name>`) | fixing commit |

Multi-PR pairs confound individual effects—state the confound or split.

## Setup & layers

```sh
git worktree add --detach ../anabasis-before-<what> <before>   # bun install --frozen-lockfile in each
git worktree add --detach ../anabasis-after-<what> <after>
```

Cut matching seeds named `sim-<what>-before` / `sim-<what>-after` from the same run and cut event (outside any open Examiner session; otherwise diverging `task.state`/`campaign.waited` counts confound the pair).

| Layer | Run in both arms | Read |
| --- | --- | --- |
| Test | Identical hostile test (`git show <after>:<test>`) in both | Fails before (not from missing import), passes after |
| Reader | `runs view`, `wri.ts read --log`, `runs pulse`, `runs replay`, `close.ts` | Changed lines across N logs |
| Decision | `harness-builder.ts --name <seed> --dry-run` | Decision row, move, inputs |
| Path | `bun run runs rehearse` with one script | Readings, endings, event counts |
| Wall | `scripts/wall-probe.ts <before> <after>` | Commands whose exit/output changed |
| Live seat | `scripts/live-seat.ts start` (operator approval) | Single sample = lead only; repeated rounds use [optimize](optimize.md) |

Run each reader twice per arm to filter jitter and ignore the host-code digest line (solve-path edits change `host` digest while keeping `sandbox` unchanged, `codeOf` in `tools/d2/campaign.ts`). If the source run already executed at `before`, it can serve as baseline while seeding only `after` (note effort/login differences).

Pre-register intended effect, null effect and side-effect checks before running (rule 1); unmentioned shifts are findings and unchanged expected lines are `unreached`. Report commits, layer, input and matched outcome in the PR's **Validation and limits**.

## Before landing

When simulating the top-risk unproved PRs on a stack (2 by default): prioritise seat visibility/actions > scoring/refusals > readers/tooling. Run each `after` arm in a detached worktree at that PR's head (never in its working tree or a live run's tree), fix any defect in the introducing commit on operator approval and restack (`stack-pr`), and trash worktrees when done (`/usr/bin/trash ../anabasis-{before,after}-<what> && git worktree prune`).
