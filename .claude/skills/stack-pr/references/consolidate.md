# Consolidate the stack

Consolidation rewrites a stack grown one finding at a time into one ordered by subject: fixes fold
into their commits, related pull requests merge, and the result publishes as one native stack. It
rewrites other sessions' pull requests, so it runs only on the operator's word (`SKILL.md`, sections
2 and 8).

## Spend by importance

A fault in an `I0` or `I1` change misreads every later comparison; one in an `I3` change misprints a
report. The label (`SKILL.md`, section 7) therefore sets the effort:

| Label | Treatment | Review | Position |
| --- | --- | --- | --- |
| `I0`, `I1` | Rewrite the compartment through [commit-r](../../commit-r/SKILL.md) once the restructure stands; fold in only changes to the same compartment. Most of the time goes here | both reviews, each finding checked against a log, a hostile test a boundary | lowest, so it can land alone |
| `I2` | Fold by mechanism and simplify in lanes; commit-r only where review finds code bent around an old shape | both reviews | above `I0` and `I1` |
| `I3` | Fold into the pull request it reports on, or one of reporting and wording; drop what nobody reads | one review | top |

A survivor takes the highest label it absorbed.

## 1. Review in groups

Split the open pull requests into five to ten groups by the mechanism they touch, never mixing
`I0` or `I1` with `I3`. Each group gets one read-only reviewer and one brief: code first, runs
second, measure rather than assert, and say keep, simplify, merge or drop per pull request. Where
both reviews are due, the second comes from another model family that has not seen the first.
Check every finding against source and a log before it becomes a fix (`AGENTS.md`, section 11).

## 2. Restructure first, in one rebase

Drop or fold whole pull requests in one scripted `git rebase -i` over the stack before any fix is
written, so every fix targets the shape that will be published and the lanes share one base.

## 3. Fix in lanes

One worktree and branch per group (`claude/restack-laneN`) from that base, with `node_modules`
cloned (`cp -cR <a tree>/node_modules <lane>/`). An `I0` or `I1` lane runs commit-r through
**Measure and squash** and reports its hypothesis and the cases that failed on purpose. A lane
from the top delivers `fixup! <subject>` commits (`amend! <subject>` where the message changes),
one per target, after format, typecheck, strict lint and the owning tests. A replacement of a
commit range is formed on that range's parent and its descendants replayed onto it; a commit
formed on the top cannot replace a lower range. A lane pushes nothing and touches no other
branch; a conflict in its own autosquash is resolved on a `-squash-check` branch, so assembly can
take the tree with `git checkout <sha> -- <paths>`.

## 4. Assemble

Cherry-pick the lanes' deltas onto the base, keep the tip (`git branch consolidate/pre HEAD`), then
`GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash origin/main`, resolving from a lane's
`-squash-check` tree where one exists.

## 5. Check the assembly

`git diff consolidate/pre HEAD` must print nothing, since a resolution can silently drop a hunk.
Then typecheck every commit where it sits (`git rebase --exec 'bun run typecheck' origin/main`),
because the tip passing says nothing of the commits beneath it.

## 6. Regroup

Reorder so related pull requests sit together, `I0` and `I1` lowest and `I3` on top, and make each
group one pull request. Retitle the survivor and rewrite its body (`gh pr edit`); the importance
stays a label, never a title prefix. Where a reorder conflicts in many hunks, leave that group
apart.

## 7. Publish

```sh
bun .claude/skills/stack-pr/scripts/republish.ts --head 353=<sha> --head 354=<sha> ... --absorb 356=353
bun .claude/skills/stack-pr/scripts/republish.ts <the same> --yes [--no-verify]
```

Give `--head` bottom to top; an unnamed survivor keeps its head and old order. The script refuses
unless the bottom holds `origin/main`'s head and each head holds the one beneath. With `--yes` it
unstacks, retargets every survivor to `main` before any head moves (else GitHub can mark one merged
into an intermediate branch), pushes all heads in one `git push --atomic` with a lease each, sets
the bases bottom up, closes each absorbed pull request and relinks the stack (`gh extension install
github/gh-stack` once). If a step fails it stops: read heads, bases and the native stack before
recovering. `--no-verify` only on the operator's word, and the stack is then unproved until `bun run
land -- <top> --sanitize`.

## 8. Hazards

- **`main` can move.** Before every push check `git merge-base --is-ancestor origin/main <bottom
  head>` (`republish.ts` does); a rewritten `main` is replayed with
  `git rebase --onto origin/main <old main> <top>`.
- **Others build on the top.** When it moves, give every lane the old and new head so it replays
  with `git rebase --onto <new> <old>`.
- **Leases are on what GitHub showed.** A lease refuses a branch its owner moved meanwhile; read the
  stack again (`SKILL.md`, section 1) and map again.
