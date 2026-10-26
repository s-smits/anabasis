# Consolidate the stack

A stack grows in the order its fixes were found: one pull request a finding, made along the way or
after a whole-run investigation, each answering what was known that day. Consolidating turns it into
a smaller stack structured by subject: it reviews the whole open stack, folds the fixes into the
commits they belong to, merges related pull requests into one, and publishes the result as one
native stack. It rewrites other
sessions' pull requests, so it runs only on the operator's word (`SKILL.md`, sections 2 and 8). The
procedure below is the one run on 25 October over #353 to #378, where 25 open pull requests became 18.
Its record is under `.ana/wri/2026-10-25-cycle-pr370/` in the runs checkout: `review/` and
`restack/`.

## Spend by importance

The importance label (`SKILL.md`, section 7) decides where a consolidation spends its time and how
far it may change a pull request, because a fault left in an `I0` or `I1` change misreads every
comparison after it, while one in an `I3` change misprints a report. `stack.ts` prints each pull
request's label at the end of its line.

| Label | What the consolidation does with it | Review | Where it sits |
| --- | --- | --- | --- |
| `I0`, `I1` | Rewrite its compartment through [commit-r](../../commit-r/SKILL.md) once the restructure stands: the tests again from the hypothesis, then the smallest owner that passes them, so the change is simple and surgical. Fold only what touches the same compartment into it, never an `I2` or `I3` change on another subject. Most of the pass's time goes here | both reviews, every finding checked against a log, a hostile test for each boundary | lowest on the stack, so it can land on its own |
| `I2` | Fold related changes by mechanism, and simplify in lanes (sections 3 to 6). A commit-r pass only where a review finds the code bent around an old shape | both reviews | above the `I0` and `I1` pull requests |
| `I3` | Fold aggressively: into the pull request whose mechanism it reports on, or into one pull request of reporting and wording. Drop one whose output nobody reads. Little time | one review | at the top |

A survivor takes the highest label among what it absorbed. Where an `I3` change has to fold into an
`I1` pull request because it reads the same compartment, the `I1` treatment covers it.

## 1. Review in groups

Split the open pull requests into five to ten groups of related changes, by the mechanism they
touch rather than by number, keeping `I0` and `I1` pull requests out of groups with `I3` ones, and give each group one reviewer with one brief
(`review/brief.md`): read the code first and the runs second, measure rather than assert, and say
per pull request keep, simplify, merge or drop. The reviewers are read-only and write one report
each. Where the importance table calls for both reviews, use another model family with no sight
of the first: on 25 October the GPT review added nine findings beyond the eight Opus reports
(`review/10-gpt-review-summary.md`). Check every finding against the source and a log before it
becomes a fix (`AGENTS.md`, section 11, "Reviews and subagents").

## 2. Restructure first, in one rebase

Drop a pull request's commit, or fold one pull request's commit into another, in one scripted
`git rebase -i` over the whole stack before any fix is written (on 25 October: #370 dropped, #358
folded into #361, #378 into #362). Every fix is then written against the shape that will be
published, and the result's head is the lanes' one base.

## 3. Fix in lanes

An `I0` or `I1` lane runs commit-r through **Measure and squash**, with the hypothesis and the
cases that failed on purpose in its report. Its delivery depends on where it starts:

- From the restructured stack's top, deliver the delta as `fixup! <subject>` commits, or
  `amend! <subject>` where the message must change. These amend the target during assembly.
- A replacement of a commit range is formed on that range's parent and replaces only that range.
  Replay the descendants onto it before checking the final tree. A whole commit formed on the top
  cannot replace a lower range: it carries the descendants too.

One worktree and branch per group (`claude/restack-laneN`), from that base, with `node_modules`
cloned rather than installed (`cp -cR <a tree>/node_modules <lane>/`). Every top-based lane delivers
its delta in the form above, after format, typecheck, strict lint and the owning tests. It changes no
branch but its own and pushes nothing, and writes a report with each commit, its checks and its
counts (`restack/brief.md`). A fixup per target commit keeps the assembly mechanical.

A lane that tries its own autosquash and meets a conflict resolves it on a `-squash-check` branch
and names the resolved tree per conflict, so the assembly can take it with
`git checkout <sha> -- <paths>` instead of resolving again (`restack/lane2.md`, `lane4.md`).

## 4. Assemble

Cherry-pick the top-based lanes' deltas onto the base, keep that tip as the reference
(`git branch consolidate/pre HEAD`), then `GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash
origin/main`. Resolve each conflict hunk by hunk, from the lane's `-squash-check` tree where one
exists. For a range replacement, keep the same reference with its delta applied before replacing
the range and replaying its descendants.

## 5. Check the assembly

`git diff consolidate/pre HEAD` must print nothing. Autosquash moves each fixup down the history,
and a resolution can silently leave a hunk behind: on 25 October this check found a resolution at
#367 that had dropped lane 5's tests. Then typecheck every commit where it sits
(`git rebase --exec 'bun run typecheck' origin/main`), since the tip passing says nothing about a
commit beneath it.

## 6. Regroup

Reorder commits so that related pull requests sit next to each other, `I0` and `I1` lowest and
`I3` at the top, and make each group one pull request (on 25 October: #356 and #371 into #353, #360 and #367 into #359). Retitle the
survivor and rewrite its body (`gh pr edit`). A title carries no "Ix:" prefix: the importance is
the pull request's `importance:I0` to `importance:I3` label, which the survivor keeps. A reorder
that conflicts in many hunks is abandoned for that group and the pull requests stay apart: the
merge of #354 and #375 was dropped for that.

## 7. Publish

`scripts/republish.ts` does this step:

```sh
bun .claude/skills/stack-pr/scripts/republish.ts --head 353=<sha> --head 354=<sha> ... --absorb 356=353
bun .claude/skills/stack-pr/scripts/republish.ts <the same> --yes [--no-verify]
```

It refuses before it writes anything unless the bottom's new head holds origin/main's head and
each new head holds the one beneath it, which is what `bun run land` asks. It shows each branch
before and after, then pushes every moved head in one `git push --atomic`, each with a lease on the
head GitHub showed, closes each absorbed pull request with a comment naming its survivor, unstacks,
and links the survivors bottom to top: GitHub refuses a base edit inside a native stack, and
`gh stack link` sets the bases (`gh extension install github/gh-stack` once). By hand, the push
went wrong twice on 25 October: zsh read `$sha:refs/...` as a `:r` modifier, and macOS's
`/bin/bash` 3.2 has no `mapfile`. The script runs git without a shell.

`--no-verify` is used only on the operator's word, and the stack is then unproved until
`bun run land -- <top> --sanitize` (`SKILL.md`, section 7).

## 8. Hazards

- **main can move or be rewritten mid-consolidation.** On 25 October at 14:24Z an author-identity fix
  rewrote main (the same tree under new commits) and force-pushed 98 branches. The stack had to be
  replayed with `git rebase --onto origin/main <old main> <top>`. Fetch and check
  `git merge-base --is-ancestor origin/main <bottom head>` before every push; `republish.ts` does.
  Since that day ruleset 25824510 refuses a non-fast-forward push to main (`SKILL.md`, section 9).
- **Others build on the top.** When the top moves, tell every lane and agent building on it the
  old and new head, so it replays with `git rebase --onto <new> <old>` rather than pushing a
  branch on a head that no longer exists.
- **Leases are on what GitHub showed.** A lease on a head read at the start of the consolidation refuses
  a branch its owner moved meanwhile; read the stack again (section 1 of `SKILL.md`) and map again.
