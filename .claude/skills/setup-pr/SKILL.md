---
name: setup-pr
description: "Set up, reshape, title, publish, version or land an Anabasis pull request the way the operator wants it: where it goes on the stack, when to regroup a back-and-forth history into a few finished commits, how the body reads, who pushes, and when a version tag is attached. Use when asked to set up or append to a PR, regroup or squash its commits, rewrite its title or body, push it, cut a release for it, or merge a stack."
---

# Set up a pull request

This skill gathers the operator's decisions of 2026-09-22 to 2026-09-25 about pull requests into
one procedure. Most of the mechanics already have an owner, and this file points at them rather
than copying them: `AGENTS.md` owns the policy ("Working in the repository", "Versions", "Where
changes go", "Writing style"), `stack-hop` and its
[stack publication](../stack-hop/references/stack-publication.md) own replay and coordinated
pushes, `commit-r` and `simplify`'s `cases/remove-and-rewrite.md` own the `R` protocol,
`intelligent-rebase` owns semantic checks where changes meet, and `reduce-complexity` owns the
numbers a simplification claim needs. What this file adds is the order, the judgement calls, and
the corrections the operator has already had to make.

## 1. Decide where the change goes

**Main, directly, takes two kinds of change.** Documentation (`README.md`, `AGENTS.md`, `docs/**`,
`.claude/**/*.md`) and hotfixes. A documentation commit is made on local `main` and held there until
the operator approves that push (operator decision 2026-09-23); the approval covers that change
only. A hotfix is a small fix to a defect on main that cannot wait for the stack, and every one of
its commits ends with a `Hotfix: <why>` trailer, which `.githooks/pre-push` requires before it
lets source onto main. When unsure, ask the operator's own question from 2026-09-24, "is it a
hotfix or real PR worthy", and say which you think. `stack-hop`'s routing table still says
surrounding files go "straight to main"; the later AGENTS.md rule is that they are committed and
held, so follow AGENTS.md.

**Everything else is a pull request on the one open stack.** Before opening anything, read the
open PRs (`gh pr list --state open --json number,title,headRefName,baseRefName`) and decide by
subject, as `stack-hop` section 3 describes:

- **Same theme as an open PR: append to it.** The operator said this again and again
  in these three days: "start appending fixes to the PR" (09-22), "append wri PR to pr8
  instead, it's a skill consolidation" and "the full plan should be on PR7 so that it's fully
  exhaustive on one PR" (09-23), "append components that belong on gh (general fixes) to pr7"
  (09-24), and "append / overhaul pr25 - no new PRs for now, all climbing / timing related stuff
  to there" (09-25). A standing "no new PRs for now" holds until the operator lifts it.
- **New theme: a new PR on the top of the stack**, never beside it. Its base is the top PR's
  branch (`gh pr create --base <top branch>`), and it contains that branch's current head. The
  pre-push hook refuses a new branch that does not. A change that depends on nothing in the stack
  still goes on top; say so in its body, as #26 did ("it sits on #25 only because a new pull
  request goes on the top of the open stack").
- **A new PR carries only its own commits.** "brooo 49 commits, why not start from pr21?" and
  "properly remove all code that's not specific to pr21" (09-25) came from branches that dragged
  earlier PRs' code along. The operator counted it as "the third time or so", which is why the hook
  now refuses a push that leaves an open PR listing commits that are not its own (#24).
- **Work that must stay private never becomes a PR.** PR #10 was retitled
  "scrubbed", squashed and closed on 09-24 ("KEEP PR10 LOCAL").

## 2. Create the tree

Run `scripts/worktree.sh list` first. Create a tree from the stack's top head, pinned by SHA:
`scripts/worktree.sh new claude/<topic> <absolute-dir> <top-head-sha>`. The operator calls this
"fork latest component of the stack first". To work on a PR another session is holding, use
`scripts/worktree.sh pr <number> <absolute-dir>` and never edit that session's worktree. The
default `medium` scope is right for source; a documentation-only change takes `--scope minimal`.
Branch names in this repository are `claude/<topic>`.

## 3. Keep the change small in total

"I don't think we need to add more complexity in total here in this PR, maybe one extra function
that gets smartly integrated throughout" (09-25). An overhaul is read as a simplification: on
09-24 four commit-R lanes that had grown production by 568 nonblank lines drew "OOF". So budget
net production cyclomatic at or below zero against the PR's base, justify each addition that stays,
and measure before claiming anything, with the `reduce-complexity` skill. When the PR claims to
simplify, put a small net table (production, tests, docs) in the body, as asked for PR #7 on 09-24.

For obvious improvements, edit directly. For doubtful ones, use the `commit-r` protocol (operator,
09-24: "for all the obvious improvements just skip the commit-r, but for more doubtful cases use
commit-R protocol"), and remember it rewrites the production a rewritten test touches, not the
test alone (09-25).

## 4. Shape the history

**Every commit a push publishes passes the gate on its own, and a defect is fixed inside the
commit that introduced it** (AGENTS.md "Working in the repository", operator decision 2026-09-24).
The reason is the operator's: "new agent systems will look through the history and intrinsically
copy over patterns". A red commit followed by its repair teaches them to push red.

- **A fix to an earlier commit** is `git commit --fixup=<sha>` and then
  `GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <sha>~1`, or `git commit --amend` at the tip.
  This holds for a commit already published on an open PR too; only `main` is never rewritten.
- **`R` working commits never leave the machine.** The `R` and `R: <paths>` removals of the
  `commit-r` and `simplify` protocols cannot pass alone, so each compartment is squashed into one
  commit before any push.
- **Regroup when the history went back and forth.** Once the final state is known and the branch
  holds reverts, retunings, fix-on-fix commits or dozens of small steps, rewrite it into a few
  coherent commits. The operator's words (09-24): split it "in 5 to 20 groups … don't show any
  reverts or failure … so we have a clear overview of the intent of each commit instead of 120
  commits which are scattered around and reverted and tuned". Then "2 to 10 commits per PR" for an
  81-commit batch split into six themed PRs (09-24), and "re-group commits more logically, 2-4
  commits" for PR #25 (09-25). A single small change becomes one commit ("simplify + squash the
  commit", 09-25). So scale with the PR: one commit for one change, two to four for a themed PR,
  and at most about ten; beyond that, the work is several PRs.

How to regroup without losing anything:

1. Save the old head: `git branch park/<topic> <old-head>`. Do not use `git stash`.
2. Rebuild on the PR's base. Either `git reset --soft <base>` and commit the groups path by path
   (`git reset` to unstage, `git add <paths>`, `git commit`), or replay with
   `git rebase -i` and fixups. Order the groups so each one builds and passes on what precedes it:
   the owner before its consumers, and a test in the commit whose behaviour it proves.
3. Title each commit for the finished change it makes, as an imperative sentence like the repo's
   ("Make a rehearsal measure what the battery would, and serve passing artifacts as
   incumbents"). The body says what and why; it never narrates the reverts.
4. Prove nothing moved: `git diff --quiet park/<topic> HEAD` must succeed. Where commits kept
   their boundaries, as in a fold or a replay, compare with `git range-diff` instead.
5. Optionally pre-check an earlier commit exactly as the hook will, from the tip's tree:
   `bun run gate --static <absolute-dir>` over a detached checkout of that commit.
6. Every child PR above a rewritten one is replayed onto it bottom-up with
   `git rebase --onto <new-parent-head> <old-parent-head> <child-head>`, per stack publication.
   Before handing over the push, run `git merge-base --is-ancestor <new-parent> <child>` for every
   open child of every moved branch; on 09-25 a restack of #7 to #19 left #21 to #23 on the old
   #19.

## 5. Before the push

Run the owning focused tests with `scripts/worktree.sh run <dir> bun run test -- <paths>`,
`bun run lint -- --strict`, and `bun run simplify` while editing. Do not run a manual `bun run gate`
before a push that will run it anyway: the push is the gate.

The pre-push hook runs `bun run gate --static` over every earlier source-changing commit it
publishes (the static steps plus test files that import a changed file directly, depth 1 in
`tools/runtime/affected-tests.ts`), the whole gate on the head of every other branch it moves, and
the whole gate on the checkout. A commit that already passed on the same bytes is skipped, via
`ana-gate-passed` under the common Git directory, so a fix to commit 8 of 10 does not rerun 1 to
7 (operator, 09-24: "why not skip the ones that were already gone through"). When it fails, it
names the commit and prints the exact `--fixup` and autosquash lines; fold the fix there and push
again. Never add `--no-verify` unless the operator says so.

## 6. Publish

**Who pushes.** On 09-24 the classifier refused Claude's pushes to PR branches, and the memory
`pushes-go-through-user` says to hand the operator a ready `!` command. On 09-25 the operator said
"push yourself, you're able to", and a `--force-with-lease` push to PR #25 then succeeded. The
reconciled rule is this. Push PR branches yourself when the operator has said so; when the
classifier refuses, do not retry in another spelling, and hand over one ready line instead. Pushes
to `main` wait for the operator's approval (documentation, 09-23) or instruction (hotfix), and
merges into `main` happen only on the operator's word.

**How.** Push from the clean top checkout with `HEAD` at the pushed commit, an explicit SHA refspec
and an explicit lease per existing ref:
`git push --force-with-lease=refs/heads/<branch>:<old-sha> origin <new-sha>:refs/heads/<branch>`.
A new ref gets an empty lease (`refs/heads/<branch>:`). A restack goes out as one
`git push --atomic` carrying every moved head, as stack publication shows. A new top branch cannot
go in the same push as its parent's update, because the hook compares it with the parent's current
remote head; push those separately (memory `github-native-stack-merge`).

**Open or update the PR.** Open it with `gh pr create --base <parent branch> --head <branch>
--title <title> --body-file <file>`. Use a draft when the operator asks for one ("set up a drafter
PR though!", 09-23), and mark it ready with `gh pr ready <n>` once the evidence it waits on is in
("if no perf loss or ideally even better, set PR to ready to review", 09-23). After every push that
changes the PR, rewrite the body file and run `gh pr edit <n> --body-file <file>`, because a body
that quotes a head SHA, a commit count or a test count goes stale with each rewrite. If you created
a scratch or probe branch on the remote, say so and propose closing it or turning it into a PR;
the operator asked about `ci/restack-probe-0925` twice on 09-25.

## 7. Title and body

**The operator's title is used verbatim**, with its capitalisation: "Improve Climbing ambition of
the Harness Builder" for #25 (09-25). When asked for an opinion on it, give one, but do not replace
it. Without one, the title is a plain imperative sentence that says what the PR changes, like the
commit subjects ("Refuse a push that leaves an open pull request listing commits that are not its
own").

**The body is short and easy to understand.** On 09-25 the operator asked to "rewrite the PR Body
to make it 50% simpler and easier to understand and shorter", and #25's went from 1,988 words to
811. On 09-23 the ask was to write it "more natural like 'it occurred that the data such as … was
not transferred properly. Even though …'", which became the specimen in AGENTS.md "Writing
style". Follow that section; the shape that landed on #25 is:

1. An opening paragraph that says what was wrong in plain words, raises the reader's own objection
   and answers it, with the evidence number that made the case.
2. One line on what the PR does and how many commits it is, each passing the gate alone.
3. One short section per commit or theme: what changed and the number that shows it.
4. **Not done**: what was left out and why.
5. **Checks**: the push gate on every commit, then the full gate on the tip, with the tip's short
   SHA and the passing, skipped and failing counts.

Add where it sits on the stack only when that is surprising, and a net complexity table only when
the PR claims to simplify. Say "firmware" rather than naming the board ("do not mention esp32
anywhere", 09-22; #23 slipped). Do not paste run logs or long file lists.

## 8. Versions

A version is never attached to a PR by the agent. The operator decides when a version is cut and
which part moves: patch for an incremental release, minor for a bigger one, and major for the
"proud" breaking one (09-24). Anabasis is in beta and stays below `1.0.0` until the operator cuts
it. The version's one owner is a `vMAJOR.MINOR.PATCH` tag on a commit of `main`, published with
`gh release create v<X.Y.Z> --target <full sha>`; `packages/ui/package.json` follows the
repository's number and carries no version of its own (AGENTS.md "Versions").

When asked, tag the exact commit named, or current `origin/main`, and say which commit that was;
local `main` may hold unpushed documentation commits. The pattern so far ties a version to a
landing, not to a PR. `v0.0.1` marks main at `fae8fdb`, before PR #7 landed. `v0.1.0` is the
merge commit of #24 (`6ae9e7e`), the last of the #7 to #24 stack, tagged on 09-25 when the operator
asked to "link the latest stacked PR merge to v 0.1.0". Its release notes follow the operator's
shape: one line of the form "less test surface while keeping 95%+ of the important test surface,
more stability during runs, less Y, better Z", then one bullet per theme with its numbers and the
PR numbers it came from.

## 9. Land

Merging is the operator's call, and it waits until everything is green: "merge the full stack
AFTER our full gate came through", followed a minute later by "do not merge stack yet" (09-25).
Stacks land through GitHub, bottom-up, each PR into its own base, so every PR ends Merged. A local
`--no-ff` merge pushed to `main` leaves the PR open, which happened to 98 PRs on 09-21. The open
PRs form a GitHub native stack, where `gh pr merge` and `gh pr edit --base` are refused. Merge one
PR at a time with the asynchronous merge endpoint, as the memory `github-native-stack-merge`
records:

```sh
gh api -X PUT repos/s-smits/anabasis/pulls/<n>/merge-async \
  -f merge_method=merge -f merge_action=direct_merge -f sha=<head>
```

It merges every stacked PR up to and including `<n>`, and GitHub then rebases the rest of the
stack, so pin each merge by tree equality with the tree that passed and merge at the current head
SHA. A PR stacked by hand outside the native stack is not rebased; replay it yourself. A stack is
fixed and landed bottom to top ("go from bottom to top right, that's most efficient", 09-24).

## What the operator has corrected before

- **Fix-forward was retired on 2026-09-24.** On 09-22 the rule still read "leave the failing commit
  as it is, make the fix the next commit directly on top". It was replaced by folding the fix
  into its commit, and the compose merges of 09-05 went with it.
- **One squashed commit is not the target either.** On 09-22 and 09-23 the ask was to "squash all
  commits" and "squash all pr7 commits into one". From 09-24 it became grouping by intent: 5 to
  20 groups for a long history, 2 to 10 per PR, and 2 to 4 on #25.
- **Stacked branches carried other PRs' code three times**, the last on 09-25, which produced the
  #24 edge check.
- **A body can be too long.** #25's was cut 60% on 09-25.
- **Documentation stopped going straight to main.** On 09-23 it went to held-until-approved, after
  two notes were written and pushed within one turn.
- **Growth sold as an overhaul drew "OOF"** on 09-24, which is where the net-zero budget comes from.
- **A separate PR for a theme an open PR already owned was redirected onto it**: "append wri PR
  to pr8 instead" (09-23). On 09-25, half an hour after asking for a new PR for the policy
  simplification, the operator put all climbing and timing work on #25 ("no new PRs for now").
