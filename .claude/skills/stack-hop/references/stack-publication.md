# Restack and publish a stack

Use for an authorised append or repair. A local context refresh does not authorise changing open
PRs. `intelligent-rebase` owns semantic contact checks; this procedure owns Git replay and
delivery. `AGENTS.md` owns the policy it carries out: every published commit passes the gate
alone, a fix goes inside the commit it corrects, and a stack is linear, with no merge commit in any
pull request's branch. Read [recorded failures](stack-evidence.md) when investigating why a step is needed.

## Freeze the intended edges

Record one compact table: PR, owner, remote branch, old head SHA, old parent SHA, intended parent,
new head SHA and focused-check result. Include the last fully gated checkpoint and its log.
Save old heads under unique local preservation refs before rewriting any history.

Resolve the complete open-PR graph from published head/base metadata and fetched objects. Order
by parent relationships, not PR number, branch spelling or the current checkout. Record any
deliberately excluded side branch. Pin the source base once; new surrounding-only main commits
do not trigger another source restack. A source change on main requires a new restack decision.

For each edge, run `git merge-base --is-ancestor <parent-sha> <child-sha>` and inspect
`git diff --stat <parent-sha> <child-sha>`. An absent parent object is unresolved; a nonzero ancestry
result is a stale edge. GitHub's mergeability flag and the PR's base name prove neither ancestry
nor preservation of behaviour. Count every edge, including the final child.

Use isolated worktrees when another task owns a branch. Git-only inspection and replay need no
dependency installation: `scripts/worktree.sh new <branch> <dir> --scope minimal` gives exactly
that tree. Before loading modules or running checks, prepare that same tree with
`scripts/worktree.sh setup <absolute-dir>` and use `scripts/worktree.sh run` thereafter. One
replay tree can visit the saved PR heads; prepare additional dependency identities only when
their owning manifests/locks require it. Never repurpose a live run worktree.

## Replay once, from the first changed edge

- **New work:** create each local PR branch on its intended parent's pinned head, including the
  previous unpublished branch in this batch. Keep its unique diff within one owner.
- **Fixes to a published chain:** put every correction inside the commit it corrects, on the PR
  that carries it: `git commit --fixup=<sha>`, then `GIT_SEQUENCE_EDITOR=true git rebase -i
  --autosquash <sha>~1` on that PR's range. A fix that belongs to no existing commit is its own
  commit on that PR, gated alone like any other. Batch known owner fixes before propagating so
  the same descendants are replayed once.
- **Propagation, reorder and stale edges alike:** replay each child's own commits onto its new
  parent, bottom-up, with `git rebase --onto <new-parent-head> <old-parent-head> <child-head>`.
  Pin the *old fork boundary* before replay: when the parent acquired a later fix, its newest
  head may never have been in the child. Inspect merge-base, log and range-diff; do not use that
  newest head blindly as the cut point. Disable `rebase.updateRefs` for this operation so Git
  cannot move peer branches.
- **A child that still carries compose merges** from the retired merge-per-edge rule is flattened
  by the same replay, which drops merge commits and keeps the rest. Check `git show
  --remerge-diff` on each dropped merge first: an empty result means the merge resolved nothing by
  hand, and a non-empty one is a resolution the replayed commit that conflicts there must carry.
  Then compare the flattened head's tree with the old head's tree, because a flattened merge can
  lose a resolution without any conflict to announce it.

After each changed edge, prove new-parent ancestry, inspect old-child versus new-child tree diff,
and compare the child's unique changes with their saved version through `git range-diff`.
Explain every dropped or altered change. A clean merge can restore an obsolete producer, erase
a prior correction, or leave an old symbol in a fixture. Check renamed symbols in changed files
and exercise the affected producer-to-consumer path. Keep a conflict resolution with its owning
change; do not accept an entire side merely to finish the replay.

If a peer moves a relevant head, retain local work, refresh the edge table and incorporate the
new change from the first affected edge. Do not restart already unchanged lower edges. A merged
or closed target requires a new target decision before publication.

## Checkpoints: normally five new PR changes

Use up to five ready, related owner changes per checkpoint. Five is a default batch size, not a
claim that the fifth PR is safer. Keep the missing positive/hostile checks for each owner; run
overlapping test files together once on the restacked top after their last relevant edit. Previously
passed focused checks need repeating only when the replay changes their dependency or behaviour.

Close a smaller batch for a handover, independent merge, adoption, paid run, or material uncertainty
from a runtime/lock change or semantic conflict. Do not wait for five when only two changes remain.
New batch work stays local until its checkpoint passes and publishes; a need for earlier remote
review closes the smaller batch through the normal gate.

A repair low in an existing twenty-PR chain still propagates to the top before coordinated
publication. Replaying fifteen unchanged descendants is one replay rather than fifteen new fixes,
but it gives every one of their commits a new identity, and the push gates each of them: the
static steps and nearby tests on every replayed commit, and the whole gate on every moved head. That
is the price of a repair low in the chain, and the reason to batch owner fixes before replaying.
Publish the whole affected suffix together so every declared edge is coherent. The batch-size
default bounds new changes awaiting feedback.

At the checkpoint, run the union of affected focused checks and the smallest real composed path
required by `intelligent-rebase`. Then one normal multi-ref push gates every commit it publishes
and every head it moves. Do not run a manual full gate immediately before the same push. With no publication, the manual gate
supplies the checkpoint instead. Save full output and the actual command exit, without a trailing
`tail` masking it.

The current `.githooks/pre-push` refuses any pushed ref the checkout does not contain, runs
`bun run gate --static` over each earlier source-changing commit it publishes and `bun run gate
--at` over the head of every other branch it moves, each in a scratch checkout of that commit, and
then the whole gate on the checkout itself. Therefore push from the clean, prepared batch-top
checkout and assert `HEAD == <batch-top-sha>`; every pushed source head must be that head or its
ancestor. Never include an unrelated branch in
that push. Inspect the hook if its version changed: a skill cannot override a different hook's
behaviour. Keep the hook and required CI checks enabled.

## Publish without invalidating PR metadata

Immediately before publication, compare remote heads, PR states and bases with the saved table.
Use explicit SHA refspecs and a separate explicit lease for every existing destination; require
absence for a newly created destination. A replayed head is not a descendant of the head it
replaces, so its update is a forced one, and the lease is what makes it safe. A lease failure means refresh and reconcile, not widen
the lease to overwrite the new work. For example, fill in literal values before executing:

```sh
git push --atomic origin \
  --force-with-lease=refs/heads/<parent-branch>:<old-parent-sha> \
  --force-with-lease=refs/heads/<child-branch>:<old-child-sha> \
  <new-parent-sha>:refs/heads/<parent-branch> \
  <new-child-sha>:refs/heads/<child-branch>
```

For a new ref the lease is `--force-with-lease=refs/heads/<new-branch>:`. Before a forced update,
prove through `git range-diff` that every commit the old head carried is in the new one, or name
the one that was folded into another; a lease protects a peer's push, and does not by itself show
that the replay kept every change. Keep unrelated main/documentation publication separate.

With unchanged PR order, keep the existing bases. For an explicit reorder, inspect both current
and planned ancestry before changing metadata: neither a metadata transition nor a ref update
may put an open PR's head inside its base. Retarget to the intended bases before the coordinated
push when that transition is safe. If neither ordering is safe, hold that reorder and resolve a
staged publication plan; atomic Git refs do not make GitHub PR metadata transactional. Do not
blindly repeat the six-ref reorder that left #332 marked merged in August.

New PRs are created bottom-up after successful publication, each with its immediate parent's
branch as base. If atomic push is unsupported, stop the coordinated publication and report the
limitation; sequential publication changes both gate cost and intermediate remote states.
After any push, fetch again, verify every intended head and parent edge, and confirm PR state/base.
Record partial or rejected publication honestly. A local gate pass is not proof that refs landed.

## When a batch fails

1. Preserve the exact top SHA, full log, failing command/test and previous good checkpoint. Queue
   timeout (75), missing dependencies, disk failure and provider failure do not identify a bad PR.
   Apply `AGENTS.md`'s bounded queue/loaded-test retry rule before changing source.
2. Form a suspect order from the failing producer/consumer, each PR's unique diff, renamed symbols,
   lock/runtime changes and conflict resolutions. The prediction chooses the next check; it is
   never the verdict. Check the prior good checkpoint with the same failure predicate if it has
   not been proved under this condition. If it fails too, the fault predates the batch or the
   environment changed; widen the investigation rather than blame a new PR.
3. For a strong suspect, run the failing check on that PR's parent and then its head. Otherwise
   bisect the **saved PR checkpoint heads**, using only the failing test file or gate stage.
   Example: good H0, bad H5; try H3, then H1/H2 or H4. A deterministic monotonic failure among five
   changes needs at most three midpoint probes to locate its first failing head, followed by any
   missing adjacent confirmation. Do not spend a full suite at every midpoint.
4. Bind each result to SHA, command, runtime/dependency condition and log. A missing test at an
   older head is untestable, never a pass. Use a compatible external reproducer for the same
   behaviour when possible; otherwise report the unresolved interval. Stop ordinary bisection if
   results fluctuate, later fixes mask earlier failures, or the failure requires several changes.
   Inspect those interacting PRs and their replayed commits; a first bad boundary alone does not
   establish one sole author at fault.
5. Fix the proved owner inside the commit that introduced the failure, including the owning
   test/runner for a recurring loaded-only failure. Keep the regression there, propagate descendants once, rerun the failing check and affected
   composed path, then let the next checkpoint push gate it. Batch any other already
   proved fixes before that delivery attempt. Follow each newly exposed failure rather than
   repeatedly running the whole suite to hunt for a different result.

Report: `H1–H5: every commit gated alone, full gate on each moved head`, with the logs. A red
ancestor under a green descendant is exactly what the policy rules out, so a failing commit is
fixed inside itself and its descendants replayed, never repaired above. GitHub Actions is off
here, so the pre-push hook is the only gate a published head gets.
