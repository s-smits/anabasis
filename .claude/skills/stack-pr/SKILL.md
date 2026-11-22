---
name: stack-pr
description: "Place a change on an open stack of Anabasis pull requests, or start a new stack: inspect the current stack top, preserve local work while moving to it, expand the open pull request that owns a change before opening a new one, shape commits that pass in isolation, run the CI checks locally, publish through the pre-push hook, verify the stack with `bun run land -- <top> --sanitize`, write a concise title and methods-style body, replay child branches when a parent moves, consolidate the stack by subject (summarised in section 10; full procedure in consolidate-stack), and land it with `bun run land`. Use when asked to open, append to, stack, restack, consolidate, overhaul, rebase, move to the latest head, sanitise, or land a pull request, to title or describe one, or when a push, hook, or base branch refuses."
---

# Stack a pull request

Open pull requests form stacks: linear chains based on `main` that land as a unit, one stack per
release cycle (`AGENTS.md`, section 11). The **top** is the tip of that chain, or `origin/main` for
the first change of a cycle. Because multiple sessions write concurrently, the procedure below
places a change without losing local work or modifying another session's branch.

## 1. Read the stack before every state change

```sh
git fetch origin --quiet
bun .claude/skills/stack-pr/scripts/stack.ts                     # every edge, bottom first, and the top
bun .claude/skills/stack-pr/scripts/stack.ts --branch <branch>   # what is stacked on one branch
```

The top is the tip of the chain rather than the highest pull request number (side branches forked
from the middle are listed separately). Because other sessions advance the stack within hours, any
prior reading is only a lead. Re-read the stack immediately before `git worktree add`, before
`gh pr create`, and before any push that rewrites a branch.

## 2. Decide where the change belongs

- **Expand the open pull request that owns the change.** A change belongs to an existing open pull
  request when it fixes, simplifies, completes, or supersedes that pull request's own lines;
  touching a shared file alone is insufficient evidence. Inspect each candidate diff
  (`git diff --name-only <base> <head>`). When the target pull request has no children, fold the
  change into its commit and update its title and body. When it has children, append the follow-up
  to that pull request as a separate commit, restack every pull request above it (including those
  from other sessions) onto the new head using `git rebase --onto` or `land --sanitize`, and push
  with `--no-verify` under force-with-lease instead of opening a `fixup!` pull request at the top.
  Remove any code rendered dead by the change in the same commit.
- **Otherwise open a new pull request on the cycle's top**, regardless of whether it depends on
  commits beneath it. The active cycle file names the current stack; if absent, use the stack
  tracked by `bun run follow` (the stack of two or more pull requests containing the oldest open
  pull request). The first change after a release starts a new stack on `main`. A second parallel
  stack on `main` starts only with the operator's authorisation, lands independently, and leaves
  the remaining stack to be replayed with `republish.ts --onto-main` (section 8). Never base a new
  pull request on the middle of a stack, and always state the base pull request in the body.
- **Never modify another session's pull request** (no commits, rebases, or force pushes) outside an
  explicit restack or consolidation. Carry a fix as a `fixup!` commit at the top, or notify the
  owner.
- Skills and documentation belong on the stack as well, together with any `docs/transfer.md` row
  the change updates. Private information (accounts, credential paths, host addresses) never enters
  a pull request.

## 3. Create the worktree

Use one worktree per pull request, branched from the stack top and pinned by commit SHA so that a
concurrent branch update cannot shift the base between fetch and checkout. Run
`bun install --frozen-lockfile` once in the new worktree:

```sh
git worktree add -b claude/<topic> ../anabasis-<topic> <top-head-sha>
```

Never branch inside or switch branches in a worktree from which a live run was launched, because
the run executes directly from that tree's source (`bun run runs pulse` identifies active run
worktrees).

## 4. Move to the top without losing work

Preserve all uncommitted changes before switching trees, as a peer session may have written part of
them:

```sh
git status --short
git diff --binary HEAD > <scratchpad>/salvage/work.patch
git rev-parse HEAD > <scratchpad>/salvage/BASE
# copy each untracked file to <scratchpad>/salvage/tree/<its relative path>
```

Create the new worktree (section 3) and apply the patch with
`git apply --3way <scratchpad>/salvage/work.patch`. Leave the old worktree untouched until the new
one passes its checks. Never use `git stash` manually: all worktrees share a single stash stack,
and another session can pop entries unexpectedly. Classify each saved file as already present on
the stack (`git show <top>:<path>`; drop it and report the match), yours (route it according to
section 2), or belonging to another session (leave it untouched); never discard a file merely
because it looks accidental.

## 5. Shape the commits

**Every commit must pass in isolation.** Subsequent sessions take the git history as precedent, so
a broken commit followed by a repair commit teaches later agents to commit broken states. Fold any
fix into the unpublished commit it repairs:

```sh
git commit --fixup=<sha>
GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <sha>~1
```

Before the first push, regroup any exploratory history (one or two commits for a small pull
request, five to ten for a large one): create a backup reference with `git branch park/<topic> HEAD`,
run `git reset --soft <base>`, commit path by path with each owning module before its consumers and
each test paired with the behaviour it verifies, and confirm tree equivalence with
`git diff --quiet park/<topic> HEAD`.

Write each commit subject in the imperative register of a pull request title (section 7), naming
the finished change; avoid narrating intermediate reverts in the body. Install the repository hooks
once per clone (`bun run hooks:install`), so pre-commit runs `bun run commit:check`. Run
`/simplify` over source diffs before pushing, prefer removing an owner to adding one, and report
net source line changes for simplifications.

## 6. Run what CI runs

`.github/workflows/ci.yml` executes only when `bun run land -- <top> --merge` dispatches it (or as
`ci-fixes` after a run that failed solely in tests; see `tools/runtime/ci-runs.ts`). CI covers two
operating systems because the sandbox wall has two distinct implementations (Seatbelt on macOS and
Bubblewrap on Linux).

| job | steps |
| --- | --- |
| Darwin (macOS 15) | `bun install --frozen-lockfile`, `bun run ui:deps`, `bun run typecheck`, `bun run lint -- --strict`, `bun run format:check`, `bun run secrets`, `bun run test` |
| Darwin UI (macOS 15) | `bun install --frozen-lockfile`, `bun run ui:deps`, `bun run ui:build`, `bun run test -- packages/ui/test` |
| Linux (Ubuntu 24.04 VM) | install `bubblewrap`, `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`, `bun install --frozen-lockfile`, `bun run test`, `ANA_CLIMB=1 bun run test -- test/climb.test.ts` |

`bun run gate` executes both Darwin jobs locally and halts at the first failure. Passing
`-- --static` restricts tests to those within one import hop of files changed at `HEAD` (UI browser
tests run only when `UI_SETUP` in `tools/runtime/gate.ts` is affected). Judge every step by its
exit code, and report the execution host and pass/skip/fail counts for any manually run job. The
test suite requires a Git repository; the Linux job requires a VM capable of Bubblewrap namespaces,
`zip`, and on small VMs `sudo sysctl -w vm.overcommit_memory=1`. Alongside paid solves, run only
focused tests to avoid distorting solver timings. Rerun any failing test in isolation several times
before classifying it as flaky or fixed, and repair flaky tests in a dedicated pull request.

## 7. Publish

Push your branch by explicit commit SHA; any branch rewrite requires a force-with-lease pinned to
the last observed remote head:

```sh
git push origin <sha>:refs/heads/<branch>
git push --force-with-lease=refs/heads/<branch>:<old-sha> origin <sha>:refs/heads/<branch>
```

Naming the commit SHA explicitly guarantees that the published head matches the commit verified by
the pre-push hook (over HTTPS, `HEAD` is re-resolved after the hook runs). Chain commit and push
with `&&` rather than `;`. Resolve hook refusals at their root cause. Use `--no-verify` only with
the operator's authorisation, and never push directly to `main`.

A standard push runs `git diff --check` and the secret scan over added lines; setting
`ANA_PUSH_VERIFY=1 git push` also runs `bun run gate -- --static` on each head that modifies code,
and `land` reuses those cached results. **A pushed commit remains unproved** until
`bun run land -- <top> --sanitize` (section 9) verifies it. Gate passes are cached by tree hash,
gate version, and Bun version, so a restack that preserves trees incurs no re-execution;
`ANA_GATE_FRESH=1` bypasses the cache. On failure, fold the fix into the failing commit (section 5)
and rerun `land`.

```sh
gh pr create --draft --base <parent branch> --head <branch> --title "<title>" --body-file <file> --label importance:I<n> --label <category>
```

Every pull request opens as a draft and remains a draft until its author or the operator marks it
ready (`gh pr ready <number>`). The `mergeable` status indicates only that the commit head is
proved; `--merge` refuses any landing containing a draft, allowing changes that await an operator
decision to sit safely on the stack. A merge targeting the top (`--auto`, or with no pull request
number) encounters a draft stacked above ready pull requests in the same way: name the highest
ready pull request explicitly without `--auto` to land only the ready prefix. Each pull request
must carry exactly one importance label (`importance:I0` to `I3`, defined in `AGENTS.md`, section
11) and at least one category label, or `land` refuses the stack before running checks
(`gh pr edit <number> --add-label <label>`). Valid categories (`CATEGORIES` in
`tools/runtime/land.ts`, also listed by `gh label list`) are `exam`, `verdicts`, `supply`,
`harness`, `comparison`, `climb`, `solve`, `economy`, `runs`, `log`, `investigation`, `landing`,
`quality`, and `docs`. Stack consolidation allocates review effort by importance
([consolidate-stack](../consolidate-stack/SKILL.md), step 5).

### Title and body

Write the pull request description as a concise methods note for a careful colleague who has not
read the prior conversation (`AGENTS.md`, section 13). A **title** is an imperative phrase of at
most roughly ten words naming the changed behaviour in the system's canonical nouns: at most two
changes joined by "and", with no rationale clause, colon, list, possessive chain, or `Ix:` prefix.
Prefer exact verbs (restore, preserve, report, correct, refuse, remove, define, apply) over
conversational ones (let, say, drop, fix what). Keep an operator-supplied title verbatim; rewrite
any title that a subsequent push renders inaccurate, together with the body.

| Conversational | Preferred style |
| --- | --- |
| Drop pulse's --once, which has changed nothing since one look became the default | Remove the redundant pulse option --once |
| Fix what the landing review confirmed: a lost pause, an overwritten file, a moving seal | Correct pause, follow and sealing defects found in landing review |

The **body** opens with `Stacked on #<n>.` where applicable, followed by a single summary paragraph
stating the change, its mechanism, why it matters, and any material limitation. Follow with details
(commonly under **Problem and method** and **Validation and limits**, though headings are optional
aids):

- the observed problem with counts and their denominators, and how the change resolves it (naming
  the owning abstraction before the file);
- recent pull requests that this change builds on, fixes, retires, or reverses, verified against
  their diffs;
- where a reader changed, what a replay over the archive now reports, separated from any claim
  about model performance;
- validation at the recorded commit: exact commands, platform, and passed, skipped, and failed
  counts, keeping unit tests, live observations, and cost estimates distinct, with inherited checks
  marked "previously reported";
- what remains untested, explicitly naming Linux, live model behaviour, or billing where unchecked.

State the evidence rung for every claim (`AGENTS.md`, section 9). Machine-learning methodology
framing (training exposure, evaluation boundary, solver variance, compute budget) is helpful where
it clarifies; any repriced cost saving is an estimate. Use tables for like-for-like comparisons,
and omit raw run logs, long file listings, and authorship labels. Rewrite the body after every push
that alters the pull request.

> This PR makes the Examiner wait for an admission result by ending its turn. The host resumes the
> conversation when a result arrives, instead of asking for more work and leaving the model to wait
> through shell sleeps. The runtime behaviour is tested; the model's use of it still needs live
> observation.

## 8. When a parent moves

A parent branch that only gains new commits leaves its children valid. A rewritten parent
invalidates its children; replay each of your own child branches from bottom to top:

```sh
git rebase --onto <new parent head> <old parent head> <child branch>
git merge-base --is-ancestor <new parent head> <child branch>    # must succeed
```

Push all moved heads in a single `git push --atomic`, specifying a force-with-lease and explicit
`<sha>:refs/heads/<branch>` refspec for each. For another session's child branch, send its owner
the exact `git rebase --onto` command instead of pushing it.

`bun run land -- <top> --sanitize` (and `--merge`) automates this across the entire chain and any
branches stacked above it: it replays each child from the latest parent head recorded on GitHub
that the child contains, pushes all moved heads atomically under leases, prints the rebase command
for each, and verifies the resulting stack. Any child that fails to replay cleanly causes a refusal
that prints the manual `git rebase --onto` command. If a head moves while a landing is verifying
commits, the landing restarts from the lowest moved pull request while retaining all cached passes.
Restacking the entire open stack onto `main` requires the operator's authorisation.

When the branch beneath the stack has already landed on `main`, `land` refuses the stack and
`stack.ts` prints an `off main:` diagnostic. A single script replays the chain onto `origin/main`
with `git replay`, verifies that every commit subject survived intact, retargets the pull requests,
pushes under leases, and relinks the native GitHub stack. Because it restacks every branch, it
requires the operator's authorisation and refuses any chain that does not replay cleanly:

```sh
bun .claude/skills/stack-pr/scripts/republish.ts --onto-main <top>        # preview the plan
bun .claude/skills/stack-pr/scripts/republish.ts --onto-main <top> --yes  # execute the replay
```

## 9. Land

Merging requires the operator's decision, and sessions never tag releases unless asked. Stacks land
through GitHub (`tools/runtime/land.ts`) so that every pull request finishes in the Merged state:

```sh
bun run land -- <top>                 # verify locally; writes nothing to GitHub
bun run land -- <top> --sanitize      # verify and post each commit's verdict as ana/commit
bun run land -- <top> --sanitize --watch # re-verify whenever the stack moves, until Ctrl-C
bun run land -- <top> --sanitize --from <pr> # verify only commits from <pr> up, with operator authorisation
bun run land -- <top> --merge         # wait for ci.yml, post ana/stack-gate, and merge
bun run land -- <pr> --auto --merge   # land the top above <pr>, following any newly stacked top
bun run land -- --merge               # same, for the stack holding the oldest stacked pull request
bun run land -- latest --sanitize     # verify the highest-numbered top among open stacks
bun run land -- <top> --merge --alone # merge alongside another chain on main, with operator authorisation
bun run land -- <top> --merge --tag v0.9.0 # merge and tag that release at the merge commit
```

By default, `--sanitize` verifies the entire first-parent lineage from `main`; commits whose exact
tree bytes already passed incur no recomputation, so previously verified lower pull requests are
skipped automatically. Passing `--from <pr>` assumes the head beneath `<pr>` is verified and checks
only commits above it; it posts per-commit verdicts but omits `mergeable`, because no head has had
its full ancestry verified in that run. Use `--from` only when the operator requests it, such as
when inspecting the upper portion of a long unverified stack first.

A standard landing runs once and exits. With `--watch`, it monitors the stack and re-runs whenever
an open pull request moves until the named pull request closes or Ctrl-C terminates it; cached
passes mean each iteration checks only changed commits. `--merge` always runs once.

GitHub permits merge commits only, and ruleset 25824510 on `main`
(`gh api repos/s-smits/anabasis/rulesets/25824510`) rejects non-fast-forward pushes and requires
`ana/stack-gate`, which only `--merge` posts.

`land` verifies that every base contains the head beneath it down to `main` (ensuring the final
merge places `main` at the top's exact tree), then checks every commit along the top's first-parent
chain: static checks and neighbouring tests on each commit (including the top), plus the full gate
on the top under `--merge` or `--whole`. Cached passes are reused for both `--merge` and
`--sanitize` (`ANA_GATE_FRESH=1` forces fresh execution of every commit). When `ANA_CHECK_HOST` is
unset, checks distribute across all hosts accepting checks up to each host's slot capacity,
retrying any commit whose host produced no verdict on another host. When `ANA_CHECK_HOST` is set,
checks route through the single configured runner (`auto` selects per pass); `--jobs N` caps
concurrency (see `local-checks`, "On which machine"). **A passing gate is not sufficient for a
release**: a stack merges only after a fresh campaign at the top's commit has achieved two
promotions on unchanged code (`run-improvement-campaign`, "A run proves the release"), and the
proved top is landed by its exact pull request number rather than a newer top. On failure, fold the
fix into the offending commit, push, and rerun `land --sanitize`, which replays everything above it
(section 8). A new landing whose chain subsumes an active landing in the same clone terminates the
older landing (preserving its cached passes) rather than queuing behind it; `--merge` runs are
never preempted. If a runner twice returns no verdict for a commit (due to a dropped connection,
slot timeout, unreachable host, or insufficient disk space), `land` reports "gave no verdict" and
should be rerun. Whenever a landing terminates for any reason, it converts every pending status it
posted into an error so no stale pending checks remain.

**The landing review.** Prior to `--merge`, three independent read-only reviewers inspect the
entire landing (`origin/main..<top>`), each through a distinct analytical lens rather than
splitting the diff by slice. Slicing forces every reviewer to build context across all subsystems
and lets cross-PR defect classes (such as duplicate readers of one fact or conflicting locks across
verbs) fall between slices. Each reviewer receives the commit range, every pull request's stated
problem, and its assigned lens, with no pre-baked conclusions. Every finding must cite a file and
line at the top commit together with the event, test, or count that would settle it, and is
classified as confirmed, plausible, or refuted (`AGENTS.md`, section 11). Whenever the landing
contains an `I0` or `I1` pull request, assign one lens to a different model family.

| lens | the skills it reads from | what it runs and asks |
| --- | --- | --- |
| The measurement | design-and-seats, comparison-reading, campaign-mechanics, attribution-and-proof | `seat-view.ts --base origin/main` and each wall test it names; `bun run runs replay`, which must refuse no log written by a real run (exit 0); whether any change alters what a seat reads, a comparison reading, a term or default, or backward readability of old events, and whether every PR body stays within its evidence rung |
| The run's life | run-management, system-path-simulation, local-checks | how a kill, a stop, a login hitting its session limit, concurrent processes, a gathered copy of a live run, or a moved checkout affects every changed verb, lock, pause, retire, fetch, follow, or land path; whether any refusal writes state before its final check; a dry run or rehearsal of each modified path |
| The owner and the shape | simplify, reduce-complexity, repository-practice, `tools/oxlint/HABITS.md` | `git complexity origin/main <top>` and rules 12 and 13 across the full landing: duplicate readers of one fact, guards for unreachable states, instance-level patches instead of owner fixes, tests lacking a hostile case, readers or UI pages out of sync with a modified writer, and honest "Not done" sections |

These three lenses reflect the recurring defect classes documented in landing reviews (see
`docs/backlog/v093-open-findings.md`). Confirmed findings are fixed on their owning pull requests
before `--sanitize` runs again; plausible findings enter the backlog with the evidence required to
settle them.

`--merge` dispatches `ci.yml` if no run exists for the head, waits for completion, and on failure
indicates whether to fix a commit or rerun with `gh run rerun <id>`. Once CI passes, it posts
`ana/stack-gate` and merges the native GitHub stack atomically, pinned to the verified head. To add
a pull request on top, push its branch, open it with `gh pr create --draft --base <top's branch>`,
and run `bun run land -- <new top> --sanitize`: before gating, `--sanitize` and `--merge` link the
full chain into the native stack when GitHub's stack covers only a prefix or none of it, while a
plain `land` prints the `gh stack link` command it would execute. A stack linked in a conflicting
order is refused with explicit `gh stack unstack` and link commands. Test `land` exclusively
against a fake `gh` (`test/land.test.ts`).

**Landing part of a stack.** `bun run split -- <pull request> --yes` splits the native stack
immediately after the last pull request to land. After the lower prefix merges, rerunning the same
command replays the remaining upper commits onto the merge commit while preserving their trees and
cached passes. Because each upper pull request receives a new head SHA and its previous commit may
no longer reside on any remote branch (which `runs fresh --at` refuses), read a fork's commit from
`gh pr view <n> --json headRefOid` at launch time. Run `split` only with the operator's
authorisation.

### Release notes, when the operator asks for the next version

Replace GitHub's auto-generated release notes (`gh release edit vX.Y.Z --notes-file <file>`) with
550 to 800 words matching recent releases (`gh release view <tag>`): at most three opening
sentences (what changed, whether the release is small or big and why per `AGENTS.md` section 11
and `run-improvement-campaign`, "A run proves the release", and whether a fresh campaign ran on the
tree); the line `Includes **N PRs from #a to #b**, merged at \`<sha>\`.`; three or four bold
subject groups with one bullet per change to what a run measures, citing one or two bold counts
with denominators and pull request numbers in brackets; all rule 3 fixes and carried findings
preserved; and a **Validation and limits** section containing one summary table (Landing, Gate
head, Tests passed / skipped / failed, Merge linking the `ci.yml` run) and at most three short
paragraphs. Omit all host names, logins, and accounts.

## 10. Consolidate the stack

Consolidation rewrites a stack that grew incrementally into fewer pull requests organised by
subject, folding every "Absorbs into #N" carrier into `#N`. Because it rewrites other sessions'
pull requests, it requires the operator's authorisation and has a dedicated skill,
[consolidate-stack](../consolidate-stack/SKILL.md). In summary:

1. catalogue each pull request by the problem its body states, together with its evidence, owner,
   and dependencies;
2. group by type (importance and kind) and then by owner, letting hard dependencies dictate order
   (a gate sits above the sites it checks; a ledger answer sits above its rule);
3. rethink each group using [simplify](../simplify/SKILL.md) until it is the minimal change that
   resolves every stated problem, measured before and after;
4. trial the proposed order on a scratch worktree (checking conflicts, ordered files such as the
   not-slop ledger, tree equality, and per-group checks) before moving any published branch;
5. review each group, restructure in a single rebase, apply fixes in isolated lanes, assemble, and
   verify;
6. collapse each group into one pull request and publish with `republish.ts`.

```sh
bun .claude/skills/stack-pr/scripts/republish.ts --head <pr>=<sha> ... [--absorb <pr>=<into>] ...
bun .claude/skills/stack-pr/scripts/republish.ts <the same> --yes [--no-verify]
```

## Report

Report the stack edges inspected and when they were read, which pull request the change expanded
(or why a new one was opened), its position on the stack, each commit subject, the checks executed
with counts and host, and the destination of every salvaged file.
