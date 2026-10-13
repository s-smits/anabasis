---
name: stack-pr
description: "Put a change on the one open stack of Anabasis v2 pull requests: find the real top, keep local work while moving to it, decide between appending and a new pull request, shape commits that each pass alone, run the checks CI runs (by hand where the runners do not), publish through the gating pre-push hook, write the body, repair your own children when a parent moves, and land a stack with `bun run land`. Use when asked to open, append to, stack, restack, rebase, hop to the latest head, sanitize or land a pull request, or when a push, a hook or a base refuses. v1's stack-hop and setup-pr in one."
---

# Stack a pull request

Until 11 October v2's work was one linear stack of open pull requests, each based on the branch
below it; PRs #219 and #221 merged the whole of it into `main` that day. A new subject is now a
pull request on `main`, and a stack forms again only where one pull request depends on another
that has not merged: there "the top" below is that pull request's branch, and elsewhere it is
`origin/main`. Several sessions write at once. This skill is the order of operations that keeps a
change on the stack without losing local work, without touching another session's branch, and
with every commit able to stand alone.

## 1. Read the stack, every time

```sh
git fetch origin --quiet
bun .claude/skills/stack-pr/scripts/stack.ts                     # every edge, bottom first, and the top
bun .claude/skills/stack-pr/scripts/stack.ts --branch <branch>   # one branch: what is stacked on it
```

The top is the end of the longest chain of open pull requests. It is not the highest number: a
side branch off the middle carries a higher one, and the script lists those apart.

**The stack moves under you.** On 9 October another session stacked eight pull requests in one
afternoon above a branch that had been read as the top two hours before. Read the edges again
immediately before `git worktree add`, before `gh pr create`, and before any push that rewrites a branch. A
reading from the start of the task is a lead, not a fact.

## 2. Decide where the change goes

- **The same subject as one of your own open pull requests: append to it.** Same subject, not
  same directory. A second pull request for two files that belong with ten is noise.
- **A new subject: a new pull request on the top**, never beside the stack. Its base is the top
  branch, and it holds that branch's head. A change that depends on nothing below it still goes
  on top; say so in the body.
- **Another session's pull request is never yours to change.** No commit, no rebase, no force
  push, whatever the fix. Stack the fix as your own pull request on the top, or tell the owner.
- **A pull request with children takes new commits only.** Rewriting it moves every branch
  above it. Fold a fix into its own commit only while `stack.ts --branch` says nothing is
  stacked on the branch.
- **Documentation and skills go on the stack too**, with the row of `docs/transfer.md` that
  the change moves, in the same pull request.
- **Work that names anything private never becomes a pull request**: which provider account a
  run used, a credential's path, a private address.

## 3. Make the tree

One worktree per pull request, from the top, pinned by commit:

```sh
git worktree add -b claude/<topic> ../anabasis-<topic> <top-head-sha>
```

Pin by commit because the branch can move between the fetch and the checkout. Run
`bun install --frozen-lockfile` once in the new tree.

Never branch in, or switch, a worktree a run was launched from. A campaign's folder lives under
that tree's `.ana/`, its receipt names that tree's commit, and a comparison continued from its
log executes whatever source is there then. `bun run runs pulse --once` says which trees hold
an open run.

## 4. Hop without losing work

When the tree you are in fell behind and holds uncommitted work, bank it before anything else.
Every modified and untracked file is a candidate, and a peer session may have written some.

```sh
git status --short
git diff --binary HEAD > <scratchpad>/salvage/work.patch
git rev-parse HEAD > <scratchpad>/salvage/BASE
# copy each untracked file to <scratchpad>/salvage/tree/<its relative path>
```

Then make the new worktree at the top (step 3) and apply there with
`git apply --3way <scratchpad>/salvage/work.patch`. Leave the old tree as it was until the new
one holds the work and its checks pass. Do not use `git stash`: a stash is shared by every
worktree of the repository, and another session can pop it.

Sort each banked file before carrying it: already on the stack (compare with
`git show <top>:<path>`, then drop it and say so), yours and unpublished (route it by step 2), or
not yours (leave it where it is). Never discard a file because it looks accidental.

## 5. Shape the commits

**Every commit passes alone.** A later session reads the history and copies its patterns, and a
red commit followed by its repair teaches it to commit red. So a fix to an unpublished commit is
folded into it (`git commit --fixup=<sha>`, then
`GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <sha>~1`), and a history that went back and
forth is regrouped into finished changes before its first push: one or two commits for a small
pull request, five to ten for a large one, and beyond that it is several pull requests.

To regroup without losing anything: `git branch park/<topic> HEAD`, `git reset --soft <base>`,
commit the groups path by path with the owner before its consumers and each test in the commit
whose behaviour it proves, then `git diff --quiet park/<topic> HEAD` must succeed.

A subject line is an imperative sentence that states the finished change, as the log's are:
"Remember Seatbelt support only when its files settled before the read". The body says what and
why. It never narrates a revert.

Keep the hooks enabled: `bun run hooks:install`, once per clone, and every worktree shares it.
The pre-commit hook runs `bun run commit:check`, which refuses a placeholder author and a
credential-shaped line and runs the formatter and the linter over the staged files; where the
hooks are not installed, run it by hand before each commit. Run `/simplify` over a source diff
first: the repository's `.claude/skills/simplify`, with `bun run simplify` for the whole-tree
scans. A whole-suite run rewrites
`test/.test-timings.json`, which Git ignores.

Keep the change small in total. Prefer deleting an owner to adding one, and when the pull
request claims to simplify, give the net source lines in the body. Test growth is not the
measure.

## 6. Run what CI runs

`.github/workflows/ci.yml` has two jobs, because the isolation has two mechanisms and a suite
passing on one platform says nothing of the other.

| job | steps |
| --- | --- |
| Darwin (macOS 15) | `bun install --frozen-lockfile`, `bun run ui:gate`, `bun run typecheck`, `bun run lint -- --strict`, `bun run format:check`, `bun run test` |
| Linux (Ubuntu 24.04 VM) | install `bubblewrap`, `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`, `bun install --frozen-lockfile`, `bun run test` |

`bun run gate` runs the Darwin job's steps in one command, cheapest first; `-- --static` runs the
tests one import from what HEAD changed in place of the suite. Judge every step by its exit code,
never by its last lines.

Where the runners do not run, each job is run by hand at the pushed head, and the body says
where and with what counts. What that has cost so far:

- **The suite needs a Git repository.** A copy made with a tarball fails four tests; `git init`
  and one commit in the copy, or a clone.
- **The Linux job needs a VM, not a container**: bubblewrap makes user and mount namespaces.
  It also needs `zip`. In a VM with little memory the linter's allocator aborts under strict
  overcommit, and the suite then fails by the hundred; `sudo sysctl -w vm.overcommit_memory=1`.
- **Stop the VM when the job is done.**
- **While paid solves run on a host, run focused tests there and the whole suite elsewhere.** A
  suite on every core pushes live solves into their walls, and the solves make the suite flaky.
  Before reading a failure, write down the load and what else ran.

A test that fails once is run again alone, several times, before it is called flaky or fixed,
and a flaky test is fixed at its cause in a pull request of its own.

## 7. Publish

Push your own branch from its clean worktree. A new branch is a plain push. A rewrite of a
branch that is already published takes a lease on the head you last saw:

```sh
git push --force-with-lease=refs/heads/<branch>:<old-sha> origin HEAD:refs/heads/<branch>
```

When a push is refused, do not try another spelling: hand the operator the one ready line.
Never pass `--no-verify`, and never push to `main`.

The pre-push hook gates what the push adds, over a scratch checkout of each commit, so the
working tree may hold anything. What it adds is the commits along each pushed head's first
parents that no remote-tracking ref of the clone holds. Of those, a commit whose patch the
replaced branch held is a replay a rebase carried, and `bun run land` proves it where it sits; a
commit changing only `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/` or a `.md` under `.claude/` is
documentation; every other gets the static steps and its nearby tests, and the lowest pushed head
holding the newest of them the whole gate. A push of documentation alone gets `git diff --check`.
A history brought in through a merge's other parent is counted and left alone, and the merge is
gated: 444 of v2's commits came into this repository that way on 11 October, and v1's hook, which
gated every commit new to the remote, could not pass one of them. To push another repository's
history as a branch of its own, fetch it as a remote first, so that its commits are already held.

A pass is remembered by commit id in the common Git directory, so a push its lease refused goes
out again without paying twice, and after a failure the commits beneath the fix keep their passes.
A failure ends on one line naming the commit and the step, with its log. The fix goes into that
commit, and the push goes again:

```sh
git commit --fixup=<sha>
GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <sha>~1
```

```sh
gh pr create --base <parent branch> --head <branch> --title "<title>" --body-file <file>
```

The operator's title is used word for word. Without one, the title is an imperative sentence
saying what the pull request changes. The body, as the stack's bodies read:

1. `Stacked on #<n>.`
2. **Why**: what was wrong in plain words, with the recorded number that made the case.
3. **What changes**: one line per finished change.
4. **On the recorded logs**, where a reader changed: what it now says of campaigns already run.
5. **Not done**, where something was left out on purpose.
6. **Checked**: each step of each job, where it ran, the head's short commit, and the passing,
   skipped and failing counts. A failure that is there without the change is named as such.

A choice of your own, such as a threshold, is said to be yours. Paste no run log and no long
file list. After every push that changes the pull request, rewrite the body: a body that quotes
a head, a commit count or a test count goes stale with each push.

## 8. When a parent moves

A parent that gained commits leaves its children valid, since they still hold the old head as
an ancestor, and the pull request shows them behind. A parent that was rewritten does not. For
each of your own children, bottom-up:

```sh
git rebase --onto <new parent head> <old parent head> <child branch>
git merge-base --is-ancestor <new parent head> <child branch>    # must succeed
```

Push every moved head in one `git push --atomic`, each with its own lease. Then check each
pull request lists only its own commits. A child that is another session's is that session's to
replay: send its owner the exact `git rebase --onto` line and wait.

Restacking the open stack as a whole is a separate operation and needs the operator's word. A
hop to the top, or a new pull request, never authorises it.

## 9. Land

Merging is the operator's call. Nothing is tagged or versioned by a session unless asked. A stack
lands through GitHub, so each pull request ends Merged; a local merge pushed to `main` leaves them
open (98 of them on 21 September in v1). The command is `tools/runtime/land.ts`:

```sh
bun run land -- <top>                 # prove it here; nothing is written to GitHub
bun run land -- <top> --sanitize      # and post each commit's verdict as ana/commit
bun run land -- <top> --merge         # and wait for ci.yml, post ana/stack-gate, and merge
```

It reads the chain of bases from the named pull request down to `main` and refuses a head that
does not contain the one beneath it, or a bottom that does not contain `main`'s head: only then
does the last merge leave `main` at exactly the top's tree. Then it proves every commit along the
top's first parents above `main`, the replays the pre-push left among them, each over its own
checkout: the static steps and nearby tests, and the whole gate on the top's head. A pass already
recorded is not run again. `--jobs N` runs up to N static passes at once; the whole gate runs
alone.

A failure names the commit and the pull request it sits on. Fold the fix into that commit, replay
the pull requests above it (section 8), push them together, and land again: the commits below the
fix keep their passes.

`--merge` dispatches `ci.yml` on the top's head before the proof when no run is there, and waits
for it after; a failed run is not dispatched again. It then reads every head again, posts
`ana/stack-gate` on each, and merges bottom-up, each pull request based on `main` just before its
merge and pinned to its gated head. A merge GitHub refuses stops the landing, says which merged,
and sets `ana/stack-gate` back to pending on every head left open. Test `land` against a fake `gh`
only (`test/land.test.ts`); never against this repository.

## Report

Say the edges you read and when, where the new pull request sits, each commit with its subject,
the checks with their counts and where they ran, and where each banked file went.
