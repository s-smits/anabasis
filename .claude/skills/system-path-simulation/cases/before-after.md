# Before and after

A passing test shows a change works under the test's conditions. Only the same input run at the
commit without the change and at the commit with it shows that the change alone moved the result and
that nothing else moved: an ablation with the commit as the one variable (rule 5), around any case.

## The two commits

| The change | Before | After |
| --- | --- | --- |
| One commit in a pull request | `<sha>~1` | `<sha>` |
| A whole pull request | the head of the pull request beneath it | its head |
| A fix to something a run showed | the run's commit (`bun run runs source <name>`) | the fixing commit |

A pair that spans several pull requests mixes their changes: say so, or split it.

## The two arms

```sh
git worktree add --detach ../anabasis-before-<what> <before>
git worktree add --detach ../anabasis-after-<what> <after>
# in each: bun install --frozen-lockfile
```

Readers take the same logs by name. A seed is cut in each fork from the same source and cut, as
`sim-<what>-before` and `sim-<what>-after`, since the registry refuses one name in two worktrees and
a seat's root is named by campaign and session (`claimRoot`, `src/wall/seat-root.ts`). Scripts are
identical in both.

| Layer | Run in both arms | Read |
| --- | --- | --- |
| A test | the hostile test; in the after fork, `git checkout <before> -- <paths>` for the production files, so the test file is the same | it fails before and passes after, for a reason other than a missing import |
| A reader | `runs view`, `wri.ts read --log`, `runs replay`, `close.ts --to <dir>` | the moved lines, counted, over how many logs |
| A decision | `bun tools/d2/harness-builder.ts --name <seed> --dry-run` | the row, the move and the facts it read |
| A path | `bun run runs rehearse` with one script | readings, endings, event counts by kind |
| A model seat | `scripts/live-seat.ts start` on each seed, on the operator's word for both | one draw an arm; a difference is a lead unless the change forces it. Repeated rounds are [optimize](optimize.md) |

Run each reader twice per arm before diffing, since time, load and process state differ from run to
run. Where the source run's recording already stands at the before commit, it is the before arm and
only the after arm is seated ([stack](stack.md), step 3).

## Reading the difference

Predict both sides first. Every moved line is either the change's named effect or a side effect the
pull request does not mention, which is a finding. A line that should have moved and did not means
the change never reached its link (`unreached`, run-improvement-campaign, section 7). The pull
request's "Validation and limits" names both commits, the layer, the input, and what moved against
the prediction.

Clean up with `/usr/bin/trash ../anabasis-before-<what> ../anabasis-after-<what>` and `git worktree
prune`.
