---
name: stack-pr
description: "Put a change on an open stack of Anabasis v2 pull requests, or start one: find the real top, keep local work while moving to it, expand the open pull request a change belongs to before opening a new one, shape commits that each pass alone, run the checks CI runs (by hand where the runners do not), publish through the checking pre-push hook, prove the stack with `bun run land -- <top> --sanitize`, write the body, repair your own children when a parent moves, consolidate the whole stack by subject (review in groups, fix in lanes, regroup, republish), and land a stack with `bun run land`. Use when asked to open, append to, stack, restack, consolidate or overhaul, rebase, hop to the latest head, sanitize or land a pull request, or when a push, a hook or a base refuses. v1's stack-hop and setup-pr in one."
---

# Stack a pull request

Open pull requests sit on stacks, each a chain based on `main` that lands alone, and one release
cycle builds one stack (`AGENTS.md`, section 11). "The top" below is the end of that stack, or
`origin/main` for the cycle's first change and for a stack the operator asks for. Several sessions
write at once. This skill is the order of operations that keeps a
change on the stack without losing local work, without touching another session's branch, and
with every commit able to stand alone.

## 1. Read the stack, every time

```sh
git fetch origin --quiet
bun .claude/skills/stack-pr/scripts/stack.ts                     # every edge, bottom first, and the top
bun .claude/skills/stack-pr/scripts/stack.ts --branch <branch>   # one branch: what is stacked on it
```

Each stack's top is the end of its chain. It is not the highest number: a side branch off the
middle carries a higher one, and the script lists those apart.

**The stack moves under you.** On 9 October another session stacked eight pull requests in one
afternoon above a branch that had been read as the top two hours before. Read the edges again
immediately before `git worktree add`, before `gh pr create`, and before any push that rewrites a branch. A
reading from the start of the task is a lead, not a fact.

## 2. Decide where the change goes

- **First find the open pull request the change belongs to.** Read every open title, and compare
  the files the change touches with each one's diff (`git diff --name-only <base> <head>`). A
  change belongs to a pull request when it fixes, simplifies, completes or supersedes that pull
  request's own code: it rewrites lines that pull request added, or makes one of its hunks dead.
  Sharing a file is not enough, since half the stack touches `decide.ts` or `AGENTS.md`. On
  27 October, of eight lanes stacked as new pull requests, #420 rewrote #403's reader, #423 capped
  the concurrency #404 had added, and #427 superseded #417's spill. The other five were new
  subjects, and right as new pull requests.
- **A change that belongs to an open pull request expands it.** With no children (`stack.ts
  --branch` names none), fold the change into that pull request's commit and rewrite its title and
  body. With children, a rewrite moves every branch above it, so it takes new commits only: make
  the change as `fixup! <the commit's subject>` (`amend!` where the message changes too) in a
  pull request of your own on the top, whose body opens "Absorbs into #N at the next
  consolidation". Section 10 folds it down and closes the carrier (`republish.ts --absorb`).
  Delete the code the change makes dead in the same commit.
- **A change that belongs to no open pull request: a new pull request on the cycle's top.** Its
  base is the top branch of the stack the current release cycle builds, whether or not it builds on
  an open pull request, and it holds that branch's head. The cycle's file names that stack; where
  none does, it is the stack `bun run follow` follows, the one that holds the oldest open pull request. The cycle's first change, after
  a release has landed, starts the stack on `main`. Any other stack of its own on `main` starts only
  on the operator's word, for a change that has to land before the cycle's stack; it lands alone,
  and once one of the two lands, `land` refuses the other until it is replayed onto the new `main`.
  Never base a change on the middle of a stack. Say which in the body.
- **Another session's pull request is never yours to change.** No commit, no rebase, no force
  push, whatever the fix. Carry the fix as a `fixup!` on the top, as above, or tell the owner.
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
suite passing on one platform says nothing of the other. The UI's CI gate has a macOS runner of its
own. CI runs on pushes to `main` and by `workflow_dispatch`; a pull request push starts no run.
`bun run land -- <top> --merge` dispatches the top's run when none exists. After the root install,
checks run despite earlier check failures; the UI build and tests both require its dependency
install to pass.

| job | steps |
| --- | --- |
| Darwin (macOS 15) | `bun install --frozen-lockfile`, `bun run ui:deps`, `bun run typecheck`, `bun run lint -- --strict`, `bun run format:check`, `bun run secrets`, `bun run test` |
| Darwin UI (macOS 15) | `bun install --frozen-lockfile`, then separate steps for `bun run ui:deps`, `bun run ui:build` and `bun run test -- packages/ui/test` |
| Linux (Ubuntu 24.04 VM) | install `bubblewrap`, `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`, `bun install --frozen-lockfile`, `bun run test`, `ANA_CLIMB=1 bun run test -- test/climb.test.ts` |

`bun run gate` runs the two Darwin jobs' steps in one command, cheapest first; `-- --static` runs the
tests one import from what `HEAD` changed in place of the suite, and leaves out the UI's browser
test files unless `HEAD` changed `packages/ui` or its install, run or lint setup (`UI_SETUP` in
`tools/runtime/gate.ts`). Unlike CI, the local CI gate stops at the first failed
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

Read a refusal and correct its cause within your authority. Pass `--no-verify` only where the
operator says so, and never push to `main`.

The pre-push hook runs every check but the tests. What a push adds is the commits along each
pushed head's first parents that no remote-tracking ref of the clone holds; each gets
`git diff --check`, and what each pushed head that no other pushed head holds adds gets the secret
scan. Where one of them changes more than `AGENTS.md`, `README.md`, `docs/` or a `.md` under
`.claude/`, each such head gets `bun run gate -- --checks` over a scratch checkout: the install, the
UI's install and build, the format check, the secret scan, typecheck, strict lint, and the simplify census, whose
count it prints and which refuses nothing. The working tree may hold anything. A
history brought in through a merge's other parent is counted and left alone, and the merge is
checked: 444 of v2's commits came into this repository that way on 11 October, and v1's hook, which
ran the CI gate on every commit new to the remote, could not pass one of them. To push another repository's
history as a branch of its own, fetch it as a remote first, so that its commits are already held.

**A pushed commit is unproved.** Its tests run when the stack is proved: `bun run land -- <top>
--sanitize` (section 9) gives every commit its static steps and nearby tests and the top the whole
CI gate, the full suite among it, and posts each verdict. Run it when the stack is worth proving, such
as after a restack or before asking for a merge; `--merge` runs the same proof again. A pass is
remembered by content in the common Git directory, a whole or checks pass by the commit's tree and a
static one by its tree and its parent's, so a push its lease refused or a restack that kept every
tree is not run again, and after a failure the commits beneath the fix keep their passes. The key
also holds the CI gate that ran and the Bun version, so either changing runs it again.
`ANA_GATE_FRESH=1` ignores remembered passes.
A failure ends on one line naming the commit and the step, with its log. The fix goes into the
commit that brought it, and the push or the landing goes again:

```sh
git commit --fixup=<sha>
GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <sha>~1
```

```sh
gh pr create --draft --base <parent branch> --head <branch> --title "<title>" --body-file <file> --label importance:I<n> --label <category>
```

A pull request opens as a draft. `bun run land -- <top> --sanitize` moves each one to Ready for
review as it posts `mergeable` success on its head, so a draft is one no landing has proved yet.

Every pull request carries exactly one importance label, defined in the repository's labels:
`importance:I0` blocks a release or further operation, `I1` protects comparison validity, prevents
a serious run failure, or broadly simplifies the tree or the suite, `I2` is a bounded functional
improvement, and `I3` is reporting, wording or convenience (AGENTS.md section 11 owns the
definitions). The title carries no "Ix:" prefix; the label replaced it on 25 October. `bun run land`
refuses a stack in which any pull request has no importance label or more than one, or no category
label, naming each, before it runs any checks, so `--sanitize` shows such a stack as not ready
(`gh pr edit <number> --add-label <label>` repairs it). The categories are the subjects a pull request
is filed under, mostly the investigation's lane groups: `harness`, `climb`, `comparison`, `solve`,
`supply`, `verdicts`, `economy`, `log`, `runs`, `landing`, `quality`, `docs` and `misc` (`CATEGORIES`,
`tools/runtime/land.ts`); `gh label list` gives what each holds, and a pull request may carry several. `stack.ts` ends each line in the label, and a
consolidation spends its time by it: `I0` and `I1` through commit-r, `I3` folded
(`references/consolidate.md`, "Spend by importance").

The operator's title is used word for word. Otherwise, name the changed behaviour in a short
imperative sentence, such as "Let the host wait for Examiner admission results" or "Reuse CI gate
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
hop to the top, or a new pull request, never authorises it: section 10 is that operation.

## 9. Land

Merging is the operator's call. Nothing is tagged or versioned by a session unless asked. A stack
lands through GitHub, so each pull request ends Merged; a local merge pushed to `main` leaves them
open (98 of them on 21 September in v1). The command is `tools/runtime/land.ts`:

```sh
bun run land -- <top>                 # prove it here; nothing is written to GitHub
bun run land -- <top> --sanitize      # and post each commit's verdict as ana/commit
bun run land -- <top> --merge         # and wait for ci.yml, post ana/stack-gate, and merge
bun run land -- <pr> --auto --merge   # land the top above <pr>, and follow a new top stacked meanwhile
bun run land -- --merge               # the same, for the stack that holds the oldest stacked pull request
bun run land -- <top> --merge --alone # merge beside another chain on main, on the operator's word; replay that chain after
```

GitHub enforces this. Since 25 October the repository allows merge commits only, with squash,
rebase and auto-merge off. Ruleset 25824510 on the default branch, "main lands only through bun run
land --merge", has no bypass actors. It refuses deleting `main` and any non-fast-forward push to it
(`main` was rewritten on 25 October at 14:24Z), and it requires a pull request merged by the merge
method with the status `ana/stack-gate`, which only `bun run land -- <top> --merge` posts. Read it
with `gh api repos/s-smits/anabasis/rulesets/25824510`. One gap remains: a token with admin rights
can post `ana/stack-gate` by hand.

`land` reads the chain of bases from the named pull request down to `main` and refuses a head that
does not contain the one beneath it, or a bottom that does not contain `main`'s head: only then
does the last merge leave `main` at exactly the top's tree. Then it proves every commit along the
top's first parents above `main`, each over its own checkout: the static steps and nearby tests,
and the whole CI gate, the full suite among it, on the top's head (`land.ts`, where it builds the
proofs). A pass already recorded is not run again. `--jobs N` runs up to N static passes at once;
the whole CI gate runs alone.

A failure names the commit and the pull request it sits on. Fold the fix into that commit, replay
the pull requests above it (section 8), push them together, and land again: the commits below the
fix keep their passes.

`--merge` dispatches `ci.yml` on the top's head before the proof when no run is there, and waits
for it after; a failed run is not dispatched again. It then reads every head again, posts
`ana/stack-gate` on each, and merges the top through GitHub's asynchronous merge, pinned to its
head checked by the CI gate, which merges the native stack beneath it all or nothing; the returned merge commit
must have the top's tree. A landing of several pull requests outside a native stack is refused
before the proof, with the `gh stack link` line that makes one. A refused merge sets
`ana/stack-gate` back to pending on every head. An uncertain merge, or one that went into a merge
queue, leaves the statuses in place and asks for the trunk to be read before another landing. Test `land` against a fake `gh`
only (`test/land.test.ts`); never against this repository.

## 10. Consolidate the stack

Consolidating turns a stack that grew one fix at a time, in the order the fixes were found, into a
smaller stack structured by subject. It reviews the whole open stack, folds every fix into the commit it belongs to, makes
related pull requests one, and publishes the result as one native stack. Every carrier whose body
says "Absorbs into #N" is folded into #N and closed. It rewrites other
sessions' pull requests, so it needs the operator's word (section 8). The procedure, with the
reason for each rule, is `references/consolidate.md`: spend by importance (`I0` and `I1` rewritten
surgically through commit-r, lowest on the stack; `I3` folded at the top); review in groups according
to its importance table; restructure in one rebase; top-based lanes deliver `fixup!` and `amend!` deltas;
assemble by cherry-pick and autosquash; check that the squashed top's tree equals the pre-squash
tip and that every commit typechecks where it sits; regroup; publish; prove with
`bun run land -- <top> --sanitize`.

The publish step is one script, which refuses a stack whose bottom does not hold origin/main's
head, pushes every moved head atomically with a lease each, closes the absorbed pull requests and
relinks the native stack:

```sh
bun .claude/skills/stack-pr/scripts/republish.ts --head <pr>=<sha> ... [--absorb <pr>=<into>] ...
bun .claude/skills/stack-pr/scripts/republish.ts <the same> --yes [--no-verify]
```

## Report

Say the edges you read and when, which open pull request the change expanded or why it is a new
subject, where it sits, each commit with its subject,
the checks with their counts and where they ran, and where each banked file went.
