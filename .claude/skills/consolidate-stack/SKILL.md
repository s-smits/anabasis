---
name: consolidate-stack
description: "Consolidate an open stack of Anabasis pull requests into fewer, simpler ones: read each pull request as the problem its body states, group by type and mechanism, then rethink each group with simplify's shapes until it is the least change that still answers every stated problem; trial the new order on a scratch worktree (conflicts, ordered files, gates above their sites, tree equality, checks at each group head) before anything moves; review, fix in lanes, regroup and publish with `republish.ts`. Use when the operator asks to consolidate, regroup, fold, shrink or overhaul the stack, to merge related pull requests, or names a percentage of pull requests to remove. Placing one change is stack-pr's; rewriting one compartment is commit-r's."
---

# Consolidate the stack

A stack grows one finding at a time: a fix for a fix, a rule and then its renames, a reader and then
the guard a review asked for. Consolidation rewrites it into one ordered by subject, where each pull
request answers one set of problems with the least change that does. It rewrites other sessions'
pull requests, so it runs only on the operator's word, and it merges or lands nothing (stack-pr,
sections 2 and 8).

The aim is not fewer pull requests for their own sake. Folding twenty changes into ten without
reading them is a regroup; it saves review time and nothing else. The work this skill exists for is
step 3: asking of each group whether the problems its bodies state could be answered far more
simply, now that all of them are known at once.

## 1. Read each pull request as a problem

Read the stack first (`bun .claude/skills/stack-pr/scripts/stack.ts`), then every pull request on
it, bottom to top, into one table in the scratchpad. For each:

| column | where it comes from |
| --- | --- |
| the problem | the body's own statement of what was wrong or missing, in one sentence; a body that states no problem gets "none stated", which is itself a finding |
| the evidence | what the body cites: an event in a log, a failing test, a refusal's text, a review finding; "none" where it cites nothing (rule 13's map, `AGENTS.md`) |
| the owner | the module or fold the change decides in, not the files it touches; a shared file is no evidence of a shared subject |
| the kind | defect fix, new mechanism, simplification, rename or move, reporting or wording, a skill or document |
| importance and category | its labels (`AGENTS.md`, section 11) |
| what it rests on | the pull requests beneath that it needs: a symbol it calls, a rule it answers, a file it edits that a lower one made |
| "Not done" | what the body says it leaves, which is no finding against it |

```sh
gh pr view <n> --json number,title,body,labels,baseRefName,headRefName,additions,deletions,files
git diff --stat <base branch>..<head branch>
git complexity <base branch> <head branch>        # reduce-complexity: decision points, edges, exports
```

The problems are the requirements of everything after. A consolidated stack must answer every one,
or say under "Not done" in its survivor's body why it no longer needs answering (fixed on `main`,
superseded, never evidenced).

## 2. Group by type, then by owner

Group in two passes, so that the first pass keeps unlike work apart and the second finds the real
subjects.

1. **By type.** Sort the table by importance and kind:
   - defect fixes and new mechanisms at `I0` and `I1`, which a misreading would carry into every
     comparison;
   - mechanisms and simplifications at `I2`;
   - reporting, wording, skills and documents at `I3`.

   Never put `I0` or `I1` in one review group with `I3`: the effort each deserves differs too much
   (step 5).
2. **By owner, within each type.** Pull requests that decide in the same owner, or answer problems
   of the same class, form a group, whatever their position on the stack. Aim for five to ten
   groups. A pull request whose only tie to a group is a shared file stays apart.

Then check the order the groups imply against "what it rests on". Two kinds of dependency survive
any regrouping and decide the order:

- **A gate sits above every site it judges.** A pull request that turns a lint rule into a gate
  needs every fix of that rule's sites beneath it, even a fix labelled `I3` in an investigation
  pull request; such a fix belongs to the rule's group by mechanism.
- **An answer sits above its rule.** A row of `tools/oxlint/not-slop.tsv` answers a finding by rule
  id; beneath the commit that adds or renames the rule it answers nothing, and strict lint calls it
  stale.

Where a dependency forces a pull request out of its type's place (an `I1` above an `I2` group),
keep the dependency and say so in the plan; the position rule is a default, a commit that fails
alone is a defect.

## 3. Rethink each group: could this be far simpler?

Take one group at a time with its problems listed. Forget the order the pull requests were written
in, and ask what the least change would be that answers every problem, as if you were writing it
today. Read [simplify](../simplify/SKILL.md) first: its shapes and its ladder are the questions, and
its disagreement test decides what stays.

Ask in this order, largest removals first:

1. **Is the problem still there?** Check it against `main`'s head and against the other pull
   requests. A problem `main` already fixed, or one a later pull request removes the cause of, takes
   its pull request with it (simplify, H1). A fix for a state another pull request makes impossible
   is a guard for a state that cannot arrive (H3).
2. **Do several pull requests patch one class?** Three fixes of three sites of one mistake are one
   fix of the owner every site runs through, and the three patches go (H4). This is the commonest
   win: a stack grown by review finds the instances one by one.
3. **Does one pull request undo or rename another?** A rule added, retuned and renamed across three
   pull requests is one rule, written once with its final name, its final tuning and its answers;
   the intermediate names and the ledger rows that answered them disappear.
4. **Is a fact read or decided twice across the group?** Two pull requests that each add a reader of
   one fact leave two readers (rule 12; H2, H7). Keep the fold, delete the other.
5. **Does the group add machinery a higher layer already has?** A lock, a retry or a cache that the
   owner one layer up provides makes the lower one dead (simplify's ladder, rungs 2 to 4).
6. **Is each remaining part the least that works?** Only now look at the lines: helpers with one
   caller, a fact stated twice in prose, a test that pins wording (simplify, H5, H6, and
   `tools/oxlint/HABITS.md`).

For each group write one verdict a pull request, keep, simplify, merge, rewrite or drop, with the
sentence that settles it, and one line per problem: which part of the survivor answers it. A
rewrite is the right verdict when the answers to questions 2 to 4 change the shape, not just the
lines. An `I0` or `I1` group that is rewritten goes through [commit-r](../commit-r/SKILL.md), with
the group's problems as the hypothesis's cases and its old pull requests as the oracle; the
problems each body states are exactly the boundaries the rewrite must keep.

Measure each verdict, never estimate it: the group's `git complexity` and nonblank source lines
before, and after the change (reduce-complexity). A rethink that leaves those numbers where they
were and only moves commits is a regroup, and is reported as one.

## 4. Trial the order before anything moves

Build the new order on a scratch worktree before any review, lane or push, so that every later step
works on a shape known to build. Nothing published moves.

```sh
git worktree add --detach ../anabasis-regroup-trial origin/main
# for each pull request in the new order, its own commits: <its base head>..<its head>
git -C ../anabasis-regroup-trial cherry-pick <base head>..<head>
```

Read four things:

- **Conflicts.** A pick that conflicts names a dependency step 2 missed. Move the pull request back
  above what it rests on, or fold it into that group; try the order again.
- **Ordered and generated files.** A file several pull requests append to in one order, sorted or
  keyed, merges wrongly in another order without a conflict. The not-slop ledger is the known case:
  a rename commit rewrites its rows, and on 9 November a reorder left 25 stale rows with no conflict
  at all. Rebuild such a file at each pick from its original commit's change as a set (its rows
  less those the commit removed, plus those it added, sorted as the owner sorts them,
  `ledgerText` in `tools/oxlint/not-slop-ledger.ts`), and hold back a row whose rule only a later
  group adds.
- **Tree equality.** For a regroup with no rewrite yet, the new top's tree must equal the published
  top's: `git diff --quiet <new top> <published top>`. Any difference is a hunk the order lost or
  doubled.
- **Each group head where it sits.** `bun run typecheck` and `bun run lint -- --strict` at every
  group's new head, one at a time on one worktree. The top passing says nothing of the heads beneath
  it; on 9 November eight of ten heads failed lint while the top passed, from a gate placed above
  the investigation pull request that fixed its sites.

The trial's output is the order, each group's new head and the checks at each; keep it in the
scratchpad as the map for step 8.

## 5. Review each group

Each group gets one read-only reviewer, briefed with the group's problem table from step 1 and its
verdicts from step 3 as hypotheses to test, never as conclusions, and the code: "code first, runs
second, measure rather than assert, and say keep, simplify, merge or drop per pull request".

| label | treatment | review | position |
| --- | --- | --- | --- |
| `I0`, `I1` | rewrite the compartment through commit-r once the order stands; fold in only changes to the same compartment | two reviews, the second from another model family that has not seen the first; each finding checked against a log, and each boundary a hostile test | lowest, so it can land alone |
| `I2` | fold by mechanism and simplify in lanes; commit-r only where review finds code bent around an old shape | two reviews | above `I0` and `I1` |
| `I3` | fold into the pull request it reports on, or into one of reporting and wording; drop what nobody reads | one review | top |

Reviewers run as [codex-gpt-swarm](../codex-gpt-swarm/SKILL.md) sessions, one manifest row a group.
A reviewer that ends on a usage limit is missing work (`AGENTS.md`, rule 15): retry it once the
limit resets, or ask the operator for another model; never stand in for it with your own reading.
Check every finding against the source and a log before it becomes a fix (`AGENTS.md`, section 11).

## 6. Restructure, then fix in lanes

1. **Restructure in one rebase.** Drop or fold whole pull requests, in the trial's order, before any
   fix is written, so that every fix targets the shape that will be published and every lane shares
   one base.
2. **Fix in lanes.** One worktree and branch a group (`claude/restack-laneN`) from that base, with
   `node_modules` cloned (`cp -cR <a tree>/node_modules <lane>/`). An `I0` or `I1` lane runs
   commit-r through "Measure and squash" and reports its hypothesis and the cases that failed on
   purpose. A lane delivers `fixup! <subject>` commits (`amend! <subject>` where the message
   changes), one per target, after format, typecheck, strict lint and the owning tests. A
   replacement of a commit range is formed on that range's parent and its descendants replayed onto
   it; a commit formed on the top cannot replace a lower range. A lane pushes nothing and touches no
   other branch; a conflict in its own autosquash is resolved on a `-squash-check` branch, so
   assembly can take the tree with `git checkout <sha> -- <paths>`.

## 7. Assemble and check

Cherry-pick the lanes' deltas onto the base, keep the tip (`git branch consolidate/pre HEAD`), then
`GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash origin/main`, resolving from a lane's
`-squash-check` tree where one exists. `git diff consolidate/pre HEAD` must print nothing, since a
resolution can silently drop a hunk. Then run step 4's checks again at every group head, and
typecheck every commit where it sits (`git rebase --exec 'bun run typecheck' origin/main`).

## 8. Regroup and publish

Make each group one pull request, and keep one of the group's own as its survivor: the one whose
change matters most to the system (the highest importance, then the widest subject), not the highest
on the stack. Its branch takes the group's top, and where step 3's verdict is a rewrite, the rewrite
becomes its commits. A consolidation so keeps about one pull request in three open under its own
number, with its thread; opening new pull requests for the groups and closing every old one takes
the operator's word. The survivor takes the highest importance it absorbed. Retitle it to cover the
group (stack-pr, "Title and body") and rewrite its body: one line naming
what it carries, then each problem from step 1 with the part that answers it, and "Not done" for any
problem the group no longer answers, with why. The importance stays a label, never a title prefix.

```sh
bun .claude/skills/stack-pr/scripts/republish.ts --head 353=<sha> --head 354=<sha> ... --absorb 356=353
bun .claude/skills/stack-pr/scripts/republish.ts <the same> --yes [--no-verify]
```

Give `--head` bottom to top; an unnamed survivor keeps its head and old order. The script refuses
unless the bottom holds `origin/main`'s head and each head holds the one beneath. With `--yes` it
unstacks, retargets every survivor to `main` before any head moves (else GitHub can mark one merged
into an intermediate branch), pushes all heads in one `git push --atomic` with a lease each, sets
the bases bottom up, closes each absorbed pull request with a comment naming its survivor, and
relinks the stack (`gh extension install github/gh-stack` once). If a step fails it stops: read
heads, bases and the native stack before recovering. `--no-verify` only on the operator's word, and
the stack is then unproved until `bun run land -- <top> --sanitize`. Every moved head loses the
passes its old bytes had, so a regroup is proved again in full.

## Hazards

- **`main` can move.** Before every push check `git merge-base --is-ancestor origin/main <bottom
  head>` (`republish.ts` does); a rewritten `main` is replayed with
  `git rebase --onto origin/main <old main> <top>`.
- **Others build on the top.** Read the stack again before the publish; when the top moved, replay
  the new pull requests onto the new shape with `git rebase --onto <new> <old>`, and give every lane
  the old and new head.
- **Leases are on what GitHub showed.** A lease refuses a branch its owner moved meanwhile; read the
  stack again and map again.
- **A fold crosses another session's commits.** The operator's word for the consolidation covers
  rewriting them. A pair that adds a thing and removes it again folds even where a third pull
  request edits the thing in between, and that edit goes with it; say so in the survivor's body.
- **A regroup with adjacent folds only keeps every head.** Folding each pull request into the one
  above it moves no commit, so its passes stand; publish such a regroup first where the rest waits
  on reviews.

## Report

Lead with the cut: pull requests before and after, as counts and a share, and what got simpler
beyond the count (each group's `git complexity` and source lines before and after, or "regroup
only"). Then, a group a row: its pull requests, its survivor, the verdict from step 3 with its
sentence, each problem and what answers it, the trial's checks at its head, the reviews and their
confirmed findings. Then the hazards met, and what waits for the operator.
