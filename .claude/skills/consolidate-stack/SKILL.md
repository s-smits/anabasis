---
name: consolidate-stack
description: "Consolidate an open stack of Anabasis pull requests into fewer, simpler ones: catalogue each pull request by the problem its body states, group by type and mechanism, inspect each group's combined surface (every symbol added and the problem it addresses) and rethink it with simplify until it is the minimal change resolving every stated problem; trial the new order on a scratch worktree (conflicts, ordered files, gates above their sites, tree equality, and per-group checks) before moving published branches; review, fix in lanes, regroup, and publish with `republish.ts`. Use when the operator asks to consolidate, regroup, fold, shrink, or overhaul the stack, merge related pull requests, or reduce the pull request count by a target share. Placing a single change belongs to stack-pr; rewriting one compartment belongs to commit-r."
---

# Consolidate the stack

A stack accumulates incrementally as findings arise: a fix for a previous fix, a lint rule followed
by renames, a reader followed by a review-requested guard. Consolidation rewrites the stack by
subject so that each pull request resolves a coherent set of problems with the minimal change
required. Because consolidation rewrites other sessions' pull requests, it runs only with the
operator's authorisation and never merges or lands the stack (`stack-pr`, sections 2 and 8).

Reducing the pull request count is not an end in itself. Folding twenty changes into ten without
re-examining their design is merely a regroup: it saves review overhead without reducing system
complexity. The primary work of this skill occurs in step 3: asking of each group whether the
combined set of stated problems admits a substantially simpler solution now that all requirements
are visible together.

## 1. Read each pull request as a problem

Read the current stack (`bun .claude/skills/stack-pr/scripts/stack.ts`), then inspect every pull
request from bottom to top and record it in a single table in the scratchpad:

| column | where it comes from |
| --- | --- |
| the problem | the body's own statement of what was defective or missing, in one sentence; a body stating no problem is marked "none stated", which is itself a finding |
| the evidence | what the body cites: a log event, failing test, refusal text, or review finding; "none" when nothing is cited (`AGENTS.md`, rule 13) |
| the owner | the module or fold where the decision lives rather than the files touched; a shared file is not evidence of a shared subject |
| the kind | defect fix, new mechanism, simplification, rename or move, reporting or wording, or skill/documentation |
| importance and category | the pull request's labels (`AGENTS.md`, section 11) |
| what it rests on | lower pull requests it depends on: a symbol it calls, a rule it satisfies, or a file created beneath it |
| "Not done" | deferred items acknowledged in the body, which do not count as findings against the pull request |

```sh
gh pr view <n> --json number,title,body,labels,baseRefName,headRefName,additions,deletions,files
git diff --stat <base branch>..<head branch>
git complexity <base branch> <head branch>        # reduce-complexity: decision points, edges, exports
```

These problem statements form the specification for all subsequent steps. The consolidated stack
must resolve every listed problem, or explain under "Not done" in the surviving pull request's body
why it no longer applies (already fixed on `main`, superseded, or never evidenced).

## 2. Group by type, then by owner

Group in two passes so that the first pass separates dissimilar risk tiers and the second clusters
by underlying mechanism.

1. **By type.** Partition the table by importance and kind:
   - defect fixes and new mechanisms at `I0` and `I1`, where an error would propagate into every
     comparison;
   - mechanisms and simplifications at `I2`;
   - reporting, wording, skills, and documentation at `I3`.

   Never place `I0` or `I1` changes in the same review group as `I3` changes, because the required
   review rigour differs substantially (step 5).
2. **By owner, within each type.** Group pull requests that decide in the same owner or address the
   same defect class, regardless of their original stack position. Aim for five to ten groups. Keep
   any pull request whose sole connection to a group is a shared file separate.

Check the resulting group order against the "what it rests on" column. Two hard dependency rules
survive any regrouping and constrain order:

- **A gate sits above every site it judges.** A pull request that promotes a lint rule to a gate
  requires every fix to that rule's violations beneath it, even if a violation was fixed in an
  `I3` investigation pull request; by mechanism, such a fix belongs with the rule's group.
- **An answer sits above its rule.** Each row in `tools/oxlint/not-slop.tsv` answers a finding by
  rule ID; placed beneath the commit that introduces or renames the rule, it answers nothing and
  strict lint rejects it as stale.

When a hard dependency forces a pull request out of its default type tier (such as an `I1` group
above an `I2` group), preserve the dependency and note it in the plan: tier ordering is a default,
whereas a commit that fails in isolation is a defect.

## 3. Rethink each group: could this be far simpler?

Examine one group at a time alongside its problem list. Ignore the chronological order in which the
pull requests were written and ask what minimal change would solve all of those problems from
scratch. Read [simplify](../simplify/SKILL.md) first: its shapes and ladder frame the inquiry, and
its disagreement test determines what stays.

**Inspect the group as a single surface first.** Because each member was written against an
intermediate state of the codebase, the combined diff often preserves transitional scaffolding.
Measure the members side by side, one column per member, highlighting the files modified most
heavily:

```sh
python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py --per-file '#<base>' '#<member>' ...
```

Enumerate the surface added by the group, one row per name a reader must learn: exported symbols,
functions, options or flags, event kinds, CLI verbs, prompt or skill paragraphs, and test files.
Attribute each row to the step 1 problem it solves and the member that introduced it. Begin with
files modified by two or more members, as review-driven patches concentrate there. This table
resolves three questions immediately:

- any row required by no stated problem is a candidate for deletion;
- two rows solving the same problem collapse into the deeper owner, and the other is removed;
- any row reshaped by a later member is written once in its final form, discarding the intermediate
  shape.

**The invariant to preserve** is the problem list together with the members' behavioural tests: the
simpler implementation must pass every test that specifies an external outcome, removing only tests
that pin deleted internal machinery or phrasing (`commit-r`, step 8). Efficiency here means fewer
decision points, import edges, exports, and nonblank lines for the same behavioural outcomes
(measured with the same script after the rewrite), rather than a smaller pull request count alone.

Write the surface table for every group even when consolidation stops at a regroup (due to operator
scope, an active landing, or unavailable reviewers): record the table under "Not done" in the
surviving pull request's body so that a subsequent pass can start directly from it.

Ask the following questions in order, starting with the largest potential removals:

1. **Does the problem still exist?** Check each problem against `main` and against the rest of the
   stack. A problem already fixed on `main`, or whose root cause another pull request eliminates,
   retires its pull request (`simplify`, H1). A fix for a state rendered unreachable by another
   pull request is a guard for an impossible state (H3).
2. **Do multiple pull requests patch instances of one class?** Three site-level fixes for the same
   mistake collapse into one fix in the owning abstraction that all sites pass through, retiring
   the individual patches (H4). This is the most common simplification in review-grown stacks.
3. **Does one pull request undo or rename another?** A rule added, retuned, and renamed across
   three pull requests becomes a single rule written once with its final name, final tuning, and
   final ledger entries, eliminating intermediate names and transitional rows.
4. **Is a fact read or decided twice across the group?** Two pull requests that each introduce a
   reader for the same fact create duplicate readers (`AGENTS.md`, rule 12; H2, H7). Retain the
   authoritative fold and remove the duplicate.
5. **Does the group add machinery already provided by a higher layer?** A lock, retry loop, or
   cache already handled one layer up makes the lower-layer mechanism redundant (`simplify` ladder,
   rungs 2 to 4).
6. **Is each remaining piece the smallest form that works?** Only at this stage inspect individual
   lines: single-caller helpers, duplicated prose facts, or wording-pinned tests (`simplify`, H5,
   H6, and `tools/oxlint/HABITS.md`).

For each group, assign one verdict per pull request (`keep`, `simplify`, `merge`, `rewrite`, or
`drop`) with a single justifying sentence, and map each step 1 problem to the part of the survivor
that resolves it. Choose `rewrite` when questions 2 to 4 alter the underlying shape rather than
isolated lines. Any rewritten `I0` or `I1` group goes through [commit-r](../commit-r/SKILL.md),
using the group's problems as hypothesis cases and the original pull requests as the behavioural
oracle; the stated problems define the exact boundaries the rewrite must preserve.

Measure every verdict rather than estimating it: record each group's `git complexity` and nonblank
source lines before and after the change (`reduce-complexity`). A consolidation that leaves those
metrics unchanged and only moves commits is a regroup, and must be reported as one.

## 4. Trial the order before anything moves

Test the proposed order on a detached scratch worktree before launching reviews, fix lanes, or
pushes, ensuring that all subsequent steps operate on a buildable baseline. No published branch
moves during this step.

```sh
git worktree add --detach ../anabasis-regroup-trial origin/main
# for each pull request in the new order, cherry-pick its own commits: <its base head>..<its head>
git -C ../anabasis-regroup-trial cherry-pick <base head>..<head>
```

Verify four properties:

- **Conflicts.** A cherry-pick conflict reveals a dependency missed in step 2. Move the conflicting
  pull request above its prerequisite or fold it into that group, and repeat the trial.
- **Ordered and generated files.** Files appended to by multiple pull requests in sorted or keyed
  order can merge silently into an invalid state when reordered. The not-slop ledger is the main
  example: a rename commit rewrites existing rows, and reordering can leave stale rows without
  raising a git conflict. Reconstruct such files at each pick as a set delta from the original
  commit (removing deleted rows, adding inserted rows, and sorting with the owner's comparator,
  `ledgerText` in `tools/oxlint/not-slop-ledger.ts`), holding back any row whose rule is introduced
  by a later group.
- **Tree equality.** For a pure regroup with no rewrites yet, the new top tree must match the
  published top byte for byte: `git diff --quiet <new top> <published top>`. Any diff indicates a
  dropped or duplicated hunk.
- **Per-group head checks.** Run `bun run typecheck` and `bun run lint -- --strict` at every
  group's new head sequentially on the scratch worktree. A passing top proves nothing about
  intermediate heads: placing a lint gate below a commit that fixes its violations will pass at the
  top while failing at every intermediate head.

Save the trial output (group order, new head SHAs, and per-head check results) in the scratchpad as
the reference map for step 8.

## 5. Review each group

Assign one read-only reviewer per group, briefed with the step 1 problem table, the step 3 verdicts
framed strictly as hypotheses to test rather than conclusions, and the code: "code first, runs
second, measure rather than assert, and return keep, simplify, merge, or drop per pull request."

| label | treatment | review | position |
| --- | --- | --- | --- |
| `I0`, `I1` | rewrite the compartment through commit-r once the order stands; fold in only changes to the same compartment | two reviews, the second from a different model family that has not seen the first; every finding checked against a log, and every boundary covered by a hostile test | lowest, so it can land independently |
| `I2` | fold by mechanism and simplify in lanes; use commit-r only where review exposes code bent around an obsolete shape | two reviews | above `I0` and `I1` |
| `I3` | fold into the pull request it reports on, or into a single reporting/wording pull request; drop unread output | one review | top |

Run reviewers as [codex-gpt-swarm](../codex-gpt-swarm/SKILL.md) sessions with one manifest row per
group. A reviewer that stops on a usage limit is incomplete work (`AGENTS.md`, rule 15): retry it
once quota resets or ask the operator for another model, rather than substituting your own review.
Verify every reported finding against source code and a campaign log before turning it into a code
change (`AGENTS.md`, section 11).

## 6. Restructure, then fix in lanes

1. **Restructure in one rebase.** Drop or fold whole pull requests in the trialled order before
   writing any fixes, so that every fix targets the final structure and all fix lanes share a
   common base.
2. **Fix in lanes.** Create one worktree and branch per group (`claude/restack-laneN`) from that
   common base, cloning `node_modules` via copy-on-write (`cp -cR <a tree>/node_modules <lane>/`).
   Each `I0` or `I1` lane runs `commit-r` through "Measure and squash" and reports its hypothesis
   along with the cases that failed intentionally before the fix. Each lane produces
   `fixup! <subject>` commits (`amend! <subject>` when the message changes), one per target commit,
   verified with format, typecheck, strict lint, and owning tests. A replacement for a commit range
   must be built on that range's parent with descendants replayed onto it; a commit built at the
   top cannot replace a lower range. Lanes never push and never touch other branches; resolve any
   autosquash conflict on a `-squash-check` branch so assembly can pull the resolved files with
   `git checkout <sha> -- <paths>`.

## 7. Assemble and check

Cherry-pick each lane's deltas onto the restructured base, record the pre-squash tip with
`git branch consolidate/pre HEAD`, and run
`GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash origin/main`, pulling conflict resolutions
from each lane's `-squash-check` tree where available. Confirm that
`git diff consolidate/pre HEAD` produces empty output so no hunk was silently lost during
resolution. Re-run step 4's checks at every group head, and run typecheck together with the source
policy gate at every individual commit:
`git rebase --exec 'bun run typecheck && bun tools/loc/source-policy.ts' origin/main`. Because
`land` verifies every commit in isolation and the source gate inspects the entire tree, an `export`
placed in an earlier commit before its first external consumer arrives in a later group passes
typecheck and strict lint yet fails the source gate at every intervening commit. Move each `export`
to the commit that introduces its first external reader.

## 8. Regroup and publish

Collapse each group into a single pull request by selecting one member as the survivor: choose the
pull request whose change is most central to the system (highest importance, then broadest scope),
rather than whichever sits highest on the stack. Point the survivor's branch at the group's top,
using the rewritten commits where step 3 called for a rewrite. This retains roughly one in three
pull requests under their original numbers and review threads; opening fresh pull requests for all
groups and closing every old one requires the operator's authorisation. Assign the survivor the
highest importance label among the pull requests it absorbed. Retitle it to reflect the combined
group (`stack-pr`, "Title and body") and rewrite its body: one opening line stating what it
absorbs, followed by each step 1 problem paired with the change that resolves it, and a "Not done"
section explaining any problem no longer addressed. Keep importance as a label rather than a title
prefix.

```sh
bun .claude/skills/stack-pr/scripts/republish.ts --head 353=<sha> --head 354=<sha> ... --absorb 356=353
bun .claude/skills/stack-pr/scripts/republish.ts <the same> --yes [--no-verify]
```

List `--head` arguments from bottom to top; any unnamed survivor keeps its current head and order.
The script refuses to proceed unless the bottom head contains `origin/main` and each subsequent
head contains the one beneath it. With `--yes`, it unstacks the chain, retargets every survivor and
absorbed pull request to `main` before moving any branch (preventing GitHub from marking a pull
request as merged into an intermediate branch), pushes all heads in a single `git push --atomic`
with per-branch leases, restores parent bases bottom up, closes each absorbed pull request with a
comment citing its survivor, and relinks the native stack (requires
`gh extension install github/gh-stack` once). If any step fails, the script halts; inspect heads,
bases, and the native stack before recovering. Use `--no-verify` only with the operator's
authorisation, and note that the stack remains unproved until `bun run land -- <top> --sanitize`
passes. Every moved head invalidates cached passes for its previous bytes, so a regroup must be
re-verified in full.

## Hazards

- **`main` can advance concurrently.** Before every push, verify
  `git merge-base --is-ancestor origin/main <bottom head>` (`republish.ts` checks this
  automatically); replay onto an updated `main` using
  `git rebase --onto origin/main <old main> <top>`.
- **Other sessions add pull requests at the top.** Re-read the stack before publishing; if the top
  has moved, replay the new pull requests onto the consolidated tip with
  `git rebase --onto <new> <old>` and give every lane the old and new head SHAs.
- **Leases match what GitHub last reported.** A force-with-lease rejects any branch moved by its
  owner in the interim; re-read the stack and rebuild the mapping.
- **A fold spans another session's commits.** The operator's authorisation for consolidation covers
  rewriting them. A pair of commits that adds and later removes a mechanism collapses even if a
  third pull request edited it in between; that intermediate edit disappears as well, and the
  survivor's body must note it.
- **Adjacent-only folds preserve existing heads.** Folding each pull request directly into the one
  above it moves no commit SHAs, leaving cached passes intact; publish such a regroup first if
  deeper rewrites are waiting on reviews.

## Report

Lead with the reduction: pull request counts before and after (both absolute counts and percentage
reduction), followed by what actually became simpler beyond the PR count (each group's
`git complexity` and nonblank source lines before and after, or "regroup only"). Then provide a
table with one row per group: member pull requests, survivor, step 3 verdict and justification,
each problem and its resolution, cuts from the surface table, trial checks at the group head, and
reviews with confirmed findings. Close with hazards encountered and any decisions awaiting the
operator.
