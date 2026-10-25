---
name: stack-pr
description: "Put a change on the one open stack of Anabasis v2 pull requests: find the real top, keep local work while moving to it, decide between appending and a new pull request, shape commits that each pass alone, run the checks CI runs (by hand where the runners do not), publish through the checking pre-push hook, prove the stack with `bun run land -- <top> --sanitize`, write the body, repair your own children when a parent moves, and land a stack with `bun run land`. Use when asked to open, append to, stack, restack, rebase, hop to the latest head, sanitize or land a pull request, or when a push, a hook or a base refuses. v1's stack-hop and setup-pr in one."
---

# Stack a pull request

Every open pull request sits on one chain based on `main` (`AGENTS.md`, section 11), and "the
top" below is the end of that chain, or `origin/main` when nothing is open. Only a change of
documentation alone that describes no open pull request goes on `main` beside it. Several sessions
write at once. This skill is the order of operations that keeps a
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
- **Skills go on the stack too**, and so does documentation that describes an open pull request,
  with the row of `docs/transfer.md` that the change moves, in the same pull request.
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
The pre-commit hook runs `bun run commit:check`, which refuses a reserved placeholder author email
and scans staged additions for secrets. For staged JavaScript and TypeScript paths it checks
format and lint against the working-tree bytes and prints an advisory slop report; where the
hooks are not installed, run it by hand before each commit. Run `/simplify` over a source diff
first: the repository's `.claude/skills/simplify`, with `bun run simplify` for the whole-tree
scans. A whole-suite run rewrites
`test/.test-timings.json`, which Git ignores.

Keep the change small in total. Prefer deleting an owner to adding one, and when the pull
request claims to simplify, give the net source lines in the body. Test growth is not the
measure.

## 6. Run what CI runs

`.github/workflows/ci.yml` runs on two platforms, because the isolation has two mechanisms and a
suite passing on one platform says nothing of the other. The UI's gate has a macOS runner of its
own. CI runs on pushes to `main` and by `workflow_dispatch`; a pull request push starts no run.
`bun run land -- <top> --merge` dispatches the top's run when none exists. After the root install,
checks run despite earlier check failures; the UI build and tests both require its dependency
install to pass.

| job | steps |
| --- | --- |
| Darwin (macOS 15) | `bun install --frozen-lockfile`, `bun run ui:deps`, `bun run typecheck`, `bun run lint -- --strict`, `bun run format:check`, `bun run test` |
| Darwin UI (macOS 15) | `bun install --frozen-lockfile`, then separate steps for `bun run ui:deps`, `bun run ui:build` and `bun run test -- packages/ui/test` |
| Linux (Ubuntu 24.04 VM) | install `bubblewrap`, `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`, `bun install --frozen-lockfile`, `bun run test`, `ANA_CLIMB=1 bun run test -- test/climb.test.ts` |

`bun run gate` runs the two Darwin jobs' steps in one command, cheapest first; `-- --static` runs the
tests one import from what `HEAD` changed in place of the suite, and leaves out the UI's browser
test files unless `HEAD` changed `packages/ui`. Unlike CI, the local gate stops at the first failed
step. Judge every step by its exit code, never by its last lines.

Where the runners do not run, each job is run by hand at the pushed head, and the body says
where and with what counts. What that has cost so far:

- **The suite needs a Git repository.** Use `git init`
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

Push your own branch from its clean worktree, naming the explicit commit you intend to publish.
A new branch needs no lease; a rewrite takes a lease on the remote head you last saw:

```sh
git push origin <sha>:refs/heads/<branch>
git push --force-with-lease=refs/heads/<branch>:<old-sha> origin <sha>:refs/heads/<branch>
```

Over HTTPS, `git push origin HEAD:refs/heads/<branch>` lets the remote helper resolve `HEAD` again
after the pre-push hook read it. A commit made in that tree while the checks ran can then go out
unchecked. An explicit commit keeps the published head equal to the one the hook read (20 October).
When committing and pushing in one shell command, chain them with `&&`. With `;`, a failed commit
still pushes the previous head (20 October).

Read a refusal and correct its cause within your authority. Never pass `--no-verify`, and never
push to `main`.

The pre-push hook runs every check but the tests. What a push adds is the commits along each
pushed head's first parents that no remote-tracking ref of the clone holds; each gets
`git diff --check`, and what each pushed head that no other pushed head holds adds gets the secret
scan. Where one of them changes more than `AGENTS.md`, `README.md`, `docs/` or a `.md` under
`.claude/`, each such head gets `bun run gate -- --checks` over a scratch checkout: the install, the
UI's install and build, the format check, typecheck, strict lint, and the simplify census, whose
count it prints and which gates nothing. The working tree may hold anything. A
history brought in through a merge's other parent is counted and left alone, and the merge is
checked: 444 of v2's commits came into this repository that way on 11 October, and v1's hook, which
gated every commit new to the remote, could not pass one of them. To push another repository's
history as a branch of its own, fetch it as a remote first, so that its commits are already held.

**A pushed commit is unproved.** Its tests run when the stack is proved: `bun run land -- <top>
--sanitize` (section 9) gives every commit its static steps and nearby tests and the top the whole
gate, the full suite among it, and posts each verdict. Run it when the stack is worth proving, such
as after a restack or before asking for a merge; `--merge` runs the same proof again. A pass is
remembered by content in the common Git directory, a whole or checks pass by the commit's tree and a
static one by its tree and its parent's, so a push its lease refused or a restack that kept every
tree is not run again, and after a failure the commits beneath the fix keep their passes. The key
also holds the gate that ran and the Bun version, so either changing runs it again.
`ANA_GATE_FRESH=1` ignores remembered passes.
A failure ends on one line naming the commit and the step, with its log. The fix goes into the
commit that brought it, and the push or the landing goes again:

```sh
git commit --fixup=<sha>
GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <sha>~1
```

```sh
gh pr create --base <parent branch> --head <branch> --title "<title>" --body-file <file> --label importance:I<n>
```

Every pull request carries exactly one importance label, defined in the repository's labels:
`importance:I0` blocks a release or further operation, `I1` protects comparison validity or prevents
a serious run failure, `I2` is a bounded functional improvement, and `I3` is reporting, wording or
convenience. The title carries no "Ix:" prefix; the label replaced it on 25 October. `bun run land`
refuses a stack in which any pull request has no importance label or more than one, naming each,
before it gates anything, so `--sanitize` shows such a stack as not ready (`gh pr edit <number>
--add-label importance:I<n>` repairs it).

The operator's title is used word for word. Otherwise, name the changed behaviour in a short
imperative sentence, such as "Let the host wait for Examiner admission results" or "Reuse gate
results when unrelated tooling changes". Leave the full implementation sequence to the body.

Write in the simple academic style of `AGENTS.md` section 13. Start with `Stacked on #<n>.` where
applicable, then a paragraph stating the change, its mechanism and why it matters. Put a material
limit there too. A reader should understand the change before encountering paths or function names.

Use as much structure as the change needs, usually **Problem and method** followed by
**Validation and limits**. Separate **Observed problem**, **Method** or **Recorded evidence** when
that makes a larger change easier to read. These are useful headings, not mandatory sections.
Cover the following without repeating the opening:

- The observed problem, with counts and their population where the log supplies them, then how
  the change addresses it. Name the owner before its file or function.
- Its relation to earlier work: among the last roughly 50 pull requests, name those it builds on,
  fixes, retires or turns back, and confirm the relationship against the diffs. Include this in the
  explanation or a Relation section where useful.
- Where a reader changed, what replay now reports on existing logs. Distinguish a corrected report
  from a change in the underlying campaign's performance.
- Validation at the recorded commit: the commands, runner platform, passed, skipped and failed
  counts, and any failure also present without the change. Separate test results, live observations
  and retrospective estimates; name their baseline and any changed conditions. A check inherited
  from an earlier description is labelled "previously reported" instead of attributed to the
  rewriting session.
- What remains untested or deliberately unchanged. Say when Linux, live behaviour or billing has
  not been checked, rather than letting a passing local test imply it has.

Use ML framing when it makes the mechanism clearer: training exposure, evaluation conditions,
solver variation or compute cost. Explain tooling changes directly when that framing adds nothing.
A single simulation does not establish general accuracy, and repricing recorded turns estimates
a saving without measuring it in a new campaign. Use tables for like-for-like comparisons and label
estimated values in their column heading. Do not add authorship labels.

Examples of opening paragraphs:

> This PR lets the Examiner wait for an admission result by ending its turn. The host resumes the
> conversation when a result arrives, instead of immediately asking for more work and leaving the
> model to wait through shell sleeps. The runtime behaviour is tested; the model's use of it still
> needs live observation.

> This PR uses a five-minute prompt cache for Solver and Referee sessions, and retains a one-hour
> cache for Builder and Examiner sessions. The choice follows the gaps between recorded model turns:
> shorter caches reduce write costs, while longer caches preserve context across slow tools and
> evaluations. The cost estimates have not yet been confirmed in a live campaign.

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

Push every moved head in one `git push --atomic`, each with its own lease and explicit commit
refspec (`<sha>:refs/heads/<branch>`). Then check each
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
top's first parents above `main`, each over its own checkout: the static steps and nearby tests,
and the whole gate, the full suite among it, on the top's head (`land.ts`, where it builds the
proofs). A pass already recorded is not run again. `--jobs N` runs up to N static passes at once;
the whole gate runs alone.

A failure names the commit and the pull request it sits on. Fold the fix into that commit, replay
the pull requests above it (section 8), push them together, and land again: the commits below the
fix keep their passes.

`--merge` dispatches `ci.yml` on the top's head before the proof when no run is there, and waits
for it after; a failed run is not dispatched again. It then reads every head again, posts
`ana/stack-gate` on each, and merges the top through GitHub's asynchronous merge, pinned to its
gated head, which merges the native stack beneath it all or nothing; the returned merge commit
must have the top's tree. A landing of several pull requests outside a native stack is refused
before the proof, with the `gh stack link` line that makes one. A refused merge sets
`ana/stack-gate` back to pending on every head. An uncertain merge, or one that went into a merge
queue, leaves the statuses in place and asks for the trunk to be read before another landing. Test `land` against a fake `gh`
only (`test/land.test.ts`); never against this repository.

## Report

Say the edges you read and when, where the new pull request sits, each commit with its subject,
the checks with their counts and where they ran, and where each banked file went.
