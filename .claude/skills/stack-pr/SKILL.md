---
name: stack-pr
description: "Place a change on an open stack of Anabasis pull requests, or start one: identify the true top, preserve local work while moving to it, expand the open pull request a change belongs to before opening a new one, shape commits that each pass alone, run the checks CI runs (by hand where the runners do not), publish through the checking pre-push hook, prove the stack with `bun run land -- <top> --sanitize`, write the title and body, repair your own children when a parent moves, consolidate the whole stack by subject (review in groups, fix in lanes, regroup, republish), and land a stack with `bun run land`. Use when asked to open, append to, stack, restack, consolidate or overhaul, rebase, hop to the latest head, sanitize or land a pull request, to title or describe one, or when a push, a hook or a base refuses. v1's stack-hop and setup-pr in one."
---

# Stack a pull request

Open pull requests form stacks: each stack is a chain based on `main` that lands as a unit, and
one release cycle builds one stack (`AGENTS.md`, section 11). "The top" denotes the end of that
stack, or `origin/main` for a cycle's first change and for a stack the operator requests. Several
sessions write concurrently. This skill sets out the order of operations that places a change on
the stack without losing local work, without altering another session's branch, and with every
commit able to stand alone.

## 1. Read the stack, every time

```sh
git fetch origin --quiet
bun .claude/skills/stack-pr/scripts/stack.ts                     # every edge, bottom first, and the top
bun .claude/skills/stack-pr/scripts/stack.ts --branch <branch>   # one branch: what is stacked on it
```

A stack's top is the end of its chain, not the highest number: a side branch from the middle
carries a higher number, and the script lists such branches separately.

**The stack changes during a task.** Another session can stack eight pull requests in one
afternoon above a branch that was read as the top two hours earlier. Read the edges again
immediately before `git worktree add`, before `gh pr create`, and before any push that rewrites a
branch. A reading taken at the start of the task is a lead, not a fact.

## 2. Decide where the change belongs

- **Identify the open pull request the change belongs to.** Read every open title and compare the
  files the change touches with each pull request's diff (`git diff --name-only <base> <head>`). A
  change belongs to a pull request when it fixes, simplifies, completes or supersedes that pull
  request's own code: it rewrites lines the pull request added, or makes one of its hunks dead. A
  shared file is insufficient evidence, since half the stack touches `decide.ts` or `AGENTS.md`.
  Of eight lanes once stacked as new pull requests, #420 rewrote #403's reader, #423 capped the
  concurrency #404 had added, and #427 superseded #417's spill; the other five were new subjects,
  correctly opened as new pull requests.
- **A change that belongs to an open pull request expands it.** Where that pull request has no
  children (`stack.ts --branch` names none), fold the change into its commit and rewrite its title
  and body. Where it has children, a rewrite would move every branch above it, so the change takes
  new commits only: commit it as `fixup! <the commit's subject>` (`amend!` where the message also
  changes) in a pull request of your own on the top, whose body opens "Absorbs into #N at the next
  consolidation". Section 10 folds it down and closes the carrier (`republish.ts --absorb`). Remove
  the code the change makes dead in the same commit.
- **A change that belongs to no open pull request opens a new one on the cycle's top.** Its base
  is the top branch of the stack the current release cycle builds, whether or not it depends on an
  open pull request, and it holds that branch's head. The cycle's file names that stack; where none
  does, it is the stack `bun run follow` follows, the one holding the oldest open pull request. The
  cycle's first change after a release has landed starts the stack on `main`. Any other stack on
  `main` starts only on the operator's word, for a change that must land before the cycle's stack.
  Such a stack lands alone, and once either of the two lands, `land` refuses the other until it is
  replayed onto the new `main` (`republish.ts --onto-main <top>`, section 8). Never base a change on
  the middle of a stack, and state the base in the body.
- **Another session's pull request is never yours to change.** Make no commit, rebase or force
  push to it, whatever the fix. Carry the fix as a `fixup!` on the top, as above, or inform its
  owner.
- **Skills belong on the stack as well**, as does documentation describing an open pull request,
  together with the row of `docs/transfer.md` that the change moves, in the same pull request.
- **Work that names anything private never becomes a pull request**: the provider account a run
  used, a credential's path, a private address.

## 3. Create the worktree

Use one worktree per pull request, created from the top and pinned by commit:

```sh
git worktree add -b claude/<topic> ../anabasis-<topic> <top-head-sha>
```

Pinning by commit matters because the branch can move between the fetch and the checkout. Run
`bun install --frozen-lockfile` once in the new tree.

Never branch in, or switch, a worktree from which a run was launched. A campaign's folder lives
under that tree's `.ana/`, its receipt names that tree's commit, and a comparison continued from its
log executes whatever source the tree then holds. `bun run runs pulse` names the trees that hold an
open run.

## 4. Move to the top without losing work

When the current tree has fallen behind and holds uncommitted work, preserve that work before any
other step. Every modified and untracked file is a candidate, and a peer session may have written
some of them.

```sh
git status --short
git diff --binary HEAD > <scratchpad>/salvage/work.patch
git rev-parse HEAD > <scratchpad>/salvage/BASE
# copy each untracked file to <scratchpad>/salvage/tree/<its relative path>
```

Then create the new worktree at the top (section 3) and apply the patch there with
`git apply --3way <scratchpad>/salvage/work.patch`. Leave the old tree unchanged until the new one
holds the work and its checks pass. Do not use `git stash`: every worktree of the repository shares
one stash, and another session can pop it.

Classify each preserved file before carrying it: already on the stack (compare with
`git show <top>:<path>`, then drop it and say so), yours and unpublished (route it by section 2),
or not yours (leave it in place). Never discard a file because it appears accidental.

## 5. Shape the commits

**Every commit passes alone.** Later sessions read the history and reproduce its patterns, and a
failing commit followed by its repair teaches them to commit failures. A fix to an unpublished
commit is therefore folded into it (`git commit --fixup=<sha>`, then
`GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <sha>~1`), and a history that went back and
forth is regrouped into finished changes before its first push: one or two commits for a small pull
request, five to ten for a large one, and beyond that several pull requests.

To regroup without loss: `git branch park/<topic> HEAD`, `git reset --soft <base>`, commit the
groups path by path with each owner before its consumers and each test in the commit whose
behaviour it proves, then confirm that `git diff --quiet park/<topic> HEAD` succeeds.

A subject line is an imperative sentence stating the finished change, in the register of a pull
request's title (section 7): "Record Seatbelt support only after its files settle". The body states
what changed and why, and never narrates a revert.

Keep the hooks enabled with `bun run hooks:install`, once per clone; every worktree shares them.
The pre-commit hook runs `bun run commit:check`, which refuses a reserved placeholder author email
and scans staged additions for secrets. For staged JavaScript and TypeScript paths it checks format
and lint against the working-tree bytes and prints an advisory slop report; where the hooks are not
installed, run it by hand before each commit. Run `/simplify` over a source diff first: the
repository's `.claude/skills/simplify`, with `bun run simplify` for the whole-tree scans. A
whole-suite run rewrites `test/.test-timings.json`, which Git ignores.

Keep the total change small. Prefer removing an owner to adding one, and where the pull request
claims a simplification, give the net source lines in the body. Test growth is not the measure.

## 6. Run what CI runs

`.github/workflows/ci.yml` runs on two platforms because the isolation has two mechanisms, and a
suite that passes on one platform establishes nothing about the other. The UI's CI gate has a
macOS runner of its own. CI starts only by `workflow_dispatch`: neither a pull request push nor a
merge into `main` starts a run, and `bun run land -- <top> --merge` dispatches the top's run where
none exists. After the root install, checks continue despite earlier check failures; the UI build
and tests both require the UI's dependency install to pass.

| job | steps |
| --- | --- |
| Darwin (macOS 15) | `bun install --frozen-lockfile`, `bun run ui:deps`, `bun run typecheck`, `bun run lint -- --strict`, `bun run format:check`, `bun run secrets`, `bun run test` |
| Darwin UI (macOS 15) | `bun install --frozen-lockfile`, then separate steps for `bun run ui:deps`, `bun run ui:build` and `bun run test -- packages/ui/test` |
| Linux (Ubuntu 24.04 VM) | install `bubblewrap`, `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`, `bun install --frozen-lockfile`, `bun run test`, `ANA_CLIMB=1 bun run test -- test/climb.test.ts` |

`bun run gate` runs the steps of both Darwin jobs in one command, cheapest first. With `-- --static`
it runs the tests one import from what `HEAD` changed in place of the suite, and omits the UI's
browser test files unless `HEAD` changed `packages/ui` or its install, run or lint setup
(`UI_SETUP` in `tools/runtime/gate.ts`). Unlike CI, the local gate stops at the first failed step.
Judge every step by its exit code, never by its last lines.

Where the runners are unavailable, run each job by hand at the pushed head, and state in the body
where it ran and with what counts. The recorded requirements are these:

- **The suite requires a Git repository.** Use `git init` and one commit in the copy, or a clone.
- **The Linux job requires a VM, not a container**, because Bubblewrap creates user and mount
  namespaces. It also requires `zip`. In a VM with little memory the linter's allocator aborts
  under strict overcommit and the suite then fails by the hundred;
  `sudo sysctl -w vm.overcommit_memory=1` prevents this.
- **Stop the VM once the job is complete.**
- **While paid solves run on a host, run focused tests there and the whole suite elsewhere.** A
  suite on every core pushes live solves into their walls, and the solves in turn make the suite
  flaky. Record the load and the concurrent work before interpreting a failure.

Run a test that failed once again alone, several times, before calling it flaky or fixed, and fix a
flaky test at its cause in a pull request of its own.

## 7. Publish

Push your own branch from its clean worktree, naming the explicit commit you intend to publish. A
new branch needs no lease; a rewrite takes a lease on the remote head last observed:

```sh
git push origin <sha>:refs/heads/<branch>
git push --force-with-lease=refs/heads/<branch>:<old-sha> origin <sha>:refs/heads/<branch>
```

Over HTTPS, `git push origin HEAD:refs/heads/<branch>` lets the remote helper resolve `HEAD` again
after the pre-push hook has read it, so a commit made in that tree while the checks ran can be
published unchecked. An explicit commit keeps the published head equal to the one the hook read.
When committing and pushing in one shell command, chain them with `&&`: with `;`, a failed commit
still pushes the previous head.

Read a refusal and correct its cause within your authority. Pass `--no-verify` only on the
operator's word, and never push to `main`. The flag skips the hook entirely, so the pushed head
shows no `mergeable` status and the pull requests above it keep their earlier passing status until
the next landing.

A plain push runs `git diff --check` and the secret scan, which take seconds. `ANA_PUSH_VERIFY=1
git push` also runs every other check, with the tests near each pushed head's own change in place
of the suite, while `bun run land -- <top> --sanitize` proves every commit of the stack and runs the
suite at its top. A push adds the commits along each pushed head's first parents that no
remote-tracking ref of the clone holds. Each such commit receives `git diff --check`, and what each
pushed head adds that no other pushed head holds receives the secret scan. Where the push requests
it and a commit changes more than `AGENTS.md`, `README.md`, `docs/` or a `.md` under `.claude/`,
each such head receives `bun run gate -- --static` over a scratch checkout: the install, the UI's
steps as far as they are due, the format check, the secret scan, typecheck, strict lint, and the
test files one import from what the head's own commit changed. `bun run land` reads that pass back
and does not repeat it. The working tree may hold anything. A history brought in through a merge's
other parent is counted and left alone, and the merge itself is checked: 444 of v2's commits entered
this repository that way, and v1's hook, which ran the CI gate on every commit new to the remote,
could not pass any of them. To push another repository's history as a branch of its own, fetch it
as a remote first, so that its commits are already held.

**A pushed commit is unproved.** Its tests run when the stack is proved: `bun run land -- <top>
--sanitize` (section 9) gives every commit its static steps and nearby tests, gives the top the
whole CI gate including the full suite, and posts each verdict. Run it when the stack merits proof,
such as after a restack or before requesting a merge; `--merge` runs the same proof again and reads
no remembered pass. A pass is remembered by content in the common Git directory: a whole or checks
pass by the commit's tree, a static pass by its tree and its parent's. A push whose lease was
refused, or a restack that kept every tree, is therefore not run again, and after a failure the
commits beneath the fix keep their passes. The key also holds the CI gate that ran and the Bun
version, so a change to either runs the proof again. `ANA_GATE_FRESH=1` ignores remembered passes.
A failure ends on one line naming the commit and the step, with its log. The fix goes into the
commit that introduced the failure, and the push or the landing is repeated:

```sh
git commit --fixup=<sha>
GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <sha>~1
```

```sh
gh pr create --draft --base <parent branch> --head <branch> --title "<title>" --body-file <file> --label importance:I<n> --label <category>
```

A pull request opens as a draft. `bun run land -- <top> --sanitize` moves each one to Ready for
review as it posts `mergeable` success on its head, so a draft is one that no landing has yet
proved.

Every pull request carries exactly one importance label, defined among the repository's labels:
`importance:I0` blocks a release or further operation; `I1` protects comparison validity, prevents
a serious run failure, or broadly simplifies the tree or the suite; `I2` is a bounded functional
improvement; and `I3` covers reporting, wording or convenience (`AGENTS.md` section 11 owns the
definitions). `bun run land` refuses a stack in which any pull request has no importance label,
more than one, or no category label, naming each before it runs any check, so `--sanitize` shows
such a stack as not ready (`gh pr edit <number> --add-label <label>` repairs it). The categories are
the subjects under which a pull request is filed, mostly the investigation's lane groups: `exam`,
`verdicts`, `supply`, `harness`, `comparison`, `climb`, `solve`, `economy`, `runs`, `log`,
`investigation`, `landing`, `quality` and `docs` (`CATEGORIES`, `tools/runtime/land.ts`).
`gh label list` describes each, and a pull request may carry several. `stack.ts` ends each line with
the importance label, and a consolidation allocates its effort by it: `I0` and `I1` through
commit-r, `I3` folded (`references/consolidate.md`, "Spend by importance").

### Title and body

**Writing style.** Write a title and a body as a short methods note for a careful colleague who
has not read the conversation: formal, plain British English in the register of `AGENTS.md`
section 13. A title is an imperative of about ten words at most that names the changed behaviour
in the system's own nouns. It joins at most two changes with "and" and carries no rationale
clause, colon, list, possessive chain or "Ix:" prefix. Prefer exact verbs (restore, preserve,
report, correct, refuse, remove, define, apply) to conversational ones (let, say, drop, hold on a
word, fix what). The body states the claim first, then the mechanism, the evidence and its limits;
each count names its population, each claim its level (`AGENTS.md` section 9), and a choice of
your own is said to be yours. Leave paths and function names until the change is understood.

| Conversational | In this style |
| --- | --- |
| Name the tree that ran in a snapshot's host line, and say an Examiner's count is where it stops | Identify the source tree in snapshot investigations and clarify the Examiner's task limit |
| Drop pulse's --once, which has changed nothing since one look became the default | Remove the redundant pulse option --once |
| Fix what the landing review confirmed: a lost pause, an overwritten file, a moving seal | Correct pause, follow and sealing defects found in landing review |
| Hold a rehearsal's scripted solves on a pause's word | Apply pause holds to rehearsed solves |

The operator's title is used word for word. A title that a push has made inaccurate is rewritten
together with the body.

Open the body with `Stacked on #<n>.` where applicable, then one paragraph stating the change, its
mechanism, why it matters and any material limit. Use as much structure as the change requires,
usually **Problem and method** followed by **Validation and limits**; separate **Observed
problem**, **Method** or **Recorded evidence** where that makes a larger change easier to follow.
These headings are aids, not mandatory sections. Cover the following without repeating the
opening:

- The observed problem, with counts and their population where the log supplies them, then how
  the change addresses it. Name the owner before its file or function.
- The relation to earlier work: among roughly the last 50 pull requests, name those the change
  builds on, fixes, retires or reverses, and confirm each relation against the diffs, in the
  explanation or in a **Relation** section.
- Where a reader changed, what a replay now reports on existing logs. Distinguish a corrected report
  from a change in the underlying campaign's performance.
- Validation at the recorded commit: the commands, the runner's platform, the passed, skipped and
  failed counts, and any failure also present without the change. Keep test results, live
  observations and retrospective estimates apart, and name their baseline and any changed
  conditions. A check inherited from an earlier description is labelled "previously reported"
  rather than attributed to the session that rewrites it.
- What remains untested or deliberately unchanged. State where Linux, live behaviour or billing has
  not been checked, rather than letting a passing local test imply that it has.

Use machine-learning framing where it clarifies the mechanism: training exposure, evaluation
conditions, solver variation or compute cost. Describe a tooling change directly where that framing
adds nothing. A single simulation does not establish general accuracy, and repricing recorded turns
estimates a saving without measuring it in a new campaign. Use tables for like-for-like comparisons
and mark estimated values in their column heading. Add no authorship labels.

Two opening paragraphs in this style:

> This PR makes the Examiner wait for an admission result by ending its turn. The host resumes the
> conversation when a result arrives, instead of immediately asking for more work and leaving the
> model to wait through shell sleeps. The runtime behaviour is tested; the model's use of it still
> needs live observation.

> This PR uses a five-minute prompt cache for Solver and Referee sessions, and retains a one-hour
> cache for Builder and Examiner sessions. The choice follows the gaps between recorded model turns:
> shorter caches reduce write costs, while longer caches preserve context across slow tools and
> evaluations. The cost estimates have not yet been confirmed in a live campaign.

Paste no run log and no long file list. After every push that changes the pull request, rewrite the
body: a body that quotes a head, a commit count or a test count becomes stale with each push.

## 8. When a parent moves

A parent that gained commits leaves its children valid, since they still hold the old head as an
ancestor, and the pull request shows them as behind. A parent that was rewritten does not. For each
of your own children, from the bottom up:

```sh
git rebase --onto <new parent head> <old parent head> <child branch>
git merge-base --is-ancestor <new parent head> <child branch>    # must succeed
```

Push every moved head in one `git push --atomic`, each with its own lease and an explicit commit
refspec (`<sha>:refs/heads/<branch>`), then confirm that each pull request lists only its own
commits. A child that belongs to another session is that session's to replay: send its owner the
exact `git rebase --onto` line and wait.

Restacking the open stack as a whole is a separate operation and requires the operator's word. A
move to the top, or a new pull request, never authorises it; section 10 describes that operation.

**When the branch beneath a stack has landed**, the stack's bottom is based on a merged branch or
lacks `main`'s new head, and `land` refuses it. `stack.ts` reports this in an `off main:` line, as
does the hourly follow's log. One command replays the whole chain onto `origin/main` with
`git replay` (no worktree, no ref moved), confirms that every commit came across under its subject,
names each head, then unstacks, retargets, pushes every head under a lease and relinks the native
stack:

```sh
bun .claude/skills/stack-pr/scripts/republish.ts --onto-main <top>        # show the plan
bun .claude/skills/stack-pr/scripts/republish.ts --onto-main <top> --yes  # carry it out
```

Because it restacks the whole stack, it requires the operator's word. It refuses a chain that does
not replay cleanly and names the `git rebase --onto` line to resolve by hand. The manual repair it
replaces, for a stack left on a merged branch, took an unstack, a base edit, a rebase in a
scratch worktree, a map of 18 heads and a republish.

## 9. Land

Merging is the operator's decision, and a session tags or versions nothing unless asked. A stack
lands through GitHub, so each pull request ends as Merged; a local merge pushed to `main` leaves
them open (98 at once in v1). The command is `tools/runtime/land.ts`:

```sh
bun run land -- <top>                 # prove it here; nothing is written to GitHub
bun run land -- <top> --sanitize      # and post each commit's verdict as ana/commit
bun run land -- <top> --merge         # and wait for ci.yml, post ana/stack-gate, and merge
bun run land -- <pr> --auto --merge   # land the top above <pr>, and follow a new top stacked meanwhile
bun run land -- --merge               # the same, for the stack that holds the oldest stacked pull request
bun run land -- <top> --merge --alone # merge beside another chain on main, on the operator's word; replay that chain after
bun run land -- <top> --merge --tag v0.9.0 # and cut that release at the merge, with the notes GitHub writes
```

GitHub enforces this path. The repository allows merge commits only, with squash, rebase and
auto-merge disabled. Ruleset 25824510 on the default branch, "main lands only through bun run land
--merge", has no bypass actors. It refuses the deletion of `main` and any non-fast-forward push to
it (`main` has been rewritten before), and it requires a pull request merged by the merge method
with the status `ana/stack-gate`, which only `bun run land -- <top> --merge` posts. Read it with
`gh api repos/s-smits/anabasis/rulesets/25824510`. One gap remains: a token with admin rights can
post `ana/stack-gate` by hand.

`land` reads the chain of bases from the named pull request down to `main`, and refuses a head that
does not contain the one beneath it or a bottom that does not contain `main`'s head; only then does
the last merge leave `main` at exactly the top's tree. It then proves every commit along the top's
first parents above `main`, each over its own checkout: the static steps and nearby tests, and on
the top's head the whole CI gate including the full suite (`land.ts`, where it builds the proofs). A
pass already recorded is not repeated. `--jobs N` runs up to N static passes at once; the whole CI
gate runs alone.

**A passing proof is not yet a release.** `land` establishes that each commit passes. A stack
merges only once a fresh run launched at the top's head has reached two promotions with its code
unchanged. Land the proved top by its number, never a newer top stacked above it.
run-improvement-campaign, step 10, "A run proves the release", owns what that run must show.

A failure names the commit and the pull request that holds it. Fold the fix into that commit, replay
the pull requests above it (section 8), push them together, and land again; the commits below the
fix keep their passes. A step whose runner dropped its connection runs once more; after a second
drop the commit reads "gave no verdict", which shows as an error rather than a failure, and the only
remedy is to land again. A head pushed while the landing runs is read again and landed as it stands.
A commit proved afresh sets its heads to pending, so a failure from an earlier landing clears once
its fix is proved.

`--merge` dispatches `ci.yml` on the top's head before the proof where no run exists, and waits for
it afterwards; a failed run is not dispatched again. The top's head carries a `ci.yml` status
linked to the run, pending until it passes, since a dispatched run appears on no pull request. A
failed run brings its failed jobs and their log home beside the gate's logs, and the refusal states
whether to fix a commit or rerun the run (`gh run rerun <id>`). `land` then reads every head again,
posts `ana/stack-gate` on each, and merges the top through GitHub's asynchronous merge, pinned to
the head the CI gate checked, which merges the native stack beneath it all or nothing; the returned
merge commit must have the top's tree. A landing of several pull requests outside a native stack is
refused before the proof, with the `gh stack link` line that creates one. A refused merge sets
`ana/stack-gate` back to pending on every head. An uncertain merge, or one that entered a merge
queue, leaves the statuses in place and asks for the trunk to be read before another landing.
`--tag vX.Y.Z` cuts that release at the merge commit with GitHub's generated notes, which the release
notes below then replace; a tag that origin already holds is refused before the proof. Test `land`
against a fake `gh` only (`test/land.test.ts`), never against this repository.

**Landing part of a stack.** A landing's members must belong to its native stack, so divide the
stack at the last pull request to land: `bun run split -- <pull request> --yes` creates two stacks
and moves no branch, so every pass stands. Without `--yes` it prints what the copy after the merge
would do. Land the lower stack, then run `bun run split -- <pull request> --yes` again. That copies
every commit above the merge onto it with only its parents changed, so each keeps its tree and its
pass; it pushes in one atomic step under leases and without the hook, moves the bases to the trunk
and links the upper stack there. `land --sanitize` on its top then shows the passes on the new
heads. `test/split.test.ts` runs against a fake `gh`; never run `split` on this repository without
the operator's word.

### Release notes, when the operator asks for the next version

This step is optional: a landing takes `--tag vX.Y.Z` only when the operator asks to merge the next
version. GitHub's generated notes are a placeholder, so save them in the scratchpad and replace them
with `gh release edit vX.Y.Z --notes-file <file>`. Follow the shape of the last two or three
releases (`gh release view <tag>`), and keep the text between 550 and 800 words; v0.9.0's first
draft ran to 1,435 words and was cut by half. Open with at most three sentences: what the release
changes, whether the minor version moves and why (run-improvement-campaign step 10), and whether a
fresh campaign has run on the release tree. Then one line: "Includes **N PRs from #a to #b**,
merged at `<sha>`." Group the changes under three or four bold headers by subject, such as
**Comparisons and task supply**, **Runs and hosts** and **Instructions and landing**, never one per
pull request. Give each change that alters what a run measures a bullet of its own, and a group of
smaller ones a short paragraph. A bullet leads with an imperative verb, states what changed instead
of what, and ends with its pull requests in brackets. Bold the key counts, each with its denominator
and axis ("**70 of 73 drafts refused**"). Keep one or two numbers per change and leave the rest to
its pull request's body. Call a replay or a snapshot an estimate, and name a result unmeasured where
no run shows it (`attribution-and-proof`). Keep every rule 3 fix and every finding carried to the
next cycle, however short the text becomes. Close with **Validation and limits**: one table with the
columns Landing, Gate head, Tests passed / skipped / failed and Merge, the last linking the `ci.yml`
run. Below it, at most three short paragraphs state how the proof ran, what the review found and
what carries over, and what the cycle's stopped runs showed. Name no host, login or account ("the
Linux runner", "a macOS runner"), and follow `AGENTS.md` section 13.

## 10. Consolidate the stack

Consolidation turns a stack that grew one fix at a time, in the order the fixes were found, into a
smaller stack structured by subject. It reviews the whole open stack, folds every fix into the
commit it belongs to, merges related pull requests into one, and publishes the result as one native
stack. Every carrier whose body says "Absorbs into #N" is folded into #N and closed. Because it
rewrites other sessions' pull requests, it requires the operator's word (section 8). The procedure,
with the reason for each rule, is `references/consolidate.md`: allocate effort by importance (`I0`
and `I1` rewritten surgically through commit-r, lowest on the stack; `I3` folded at the top); review
in groups according to its importance table; restructure in one rebase; let top-based lanes deliver
`fixup!` and `amend!` deltas; assemble by cherry-pick and autosquash; confirm that the squashed top's
tree equals the pre-squash tip and that every commit typechecks where it sits; regroup; publish; and
prove with `bun run land -- <top> --sanitize`.

The publish step is one script. It refuses a stack whose bottom does not hold `origin/main`'s head,
pushes every moved head atomically with a lease each, closes the absorbed pull requests and relinks
the native stack:

```sh
bun .claude/skills/stack-pr/scripts/republish.ts --head <pr>=<sha> ... [--absorb <pr>=<into>] ...
bun .claude/skills/stack-pr/scripts/republish.ts <the same> --yes [--no-verify]
```

## Report

State the edges read and when, which open pull request the change expanded or why it is a new
subject, where it sits, each commit with its subject, the checks with their counts and where they
ran, and where each preserved file went.
