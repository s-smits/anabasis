---
name: stack-pr
description: "Place a change on an open stack of Anabasis pull requests, or start one: find the true top, keep local work while moving to it, expand the open pull request a change belongs to before opening a new one, shape commits that each pass alone, run what CI runs, publish through the pre-push hook, prove the stack with `bun run land -- <top> --sanitize`, write the title and body, replay your own children when a parent moves, consolidate the stack by subject (section 10 summarises it; consolidate-stack holds the procedure), and land it with `bun run land`. Use when asked to open, append to, stack, restack, consolidate or overhaul, rebase, hop to the latest head, sanitize or land a pull request, to title or describe one, or when a push, a hook or a base refuses."
---

# Stack a pull request

Open pull requests form stacks: chains based on `main` that land as a unit, one stack a release
cycle (`AGENTS.md`, section 11). "The top" is the end of that chain, or `origin/main` for a cycle's
first change. Several sessions write at once; the order below places a change without losing local
work or touching another session's branch.

## 1. Read the stack, every time

```sh
git fetch origin --quiet
bun .claude/skills/stack-pr/scripts/stack.ts                     # every edge, bottom first, and the top
bun .claude/skills/stack-pr/scripts/stack.ts --branch <branch>   # what is stacked on one branch
```

The top is the end of the chain, never the highest number (a side branch from the middle is listed
apart). Other sessions move the stack within hours, so a reading is only a lead. Read it again
immediately before `git worktree add`, before `gh pr create` and before any push that rewrites a
branch.

## 2. Decide where the change belongs

- **Expand the pull request the change belongs to.** A change belongs to an open pull request when
  it fixes, simplifies, completes or supersedes that pull request's own lines; a shared file is no
  evidence. Compare the change with each diff (`git diff --name-only <base> <head>`). Where the
  pull request has no children, fold the change into its commit and rewrite its title and body.
  Where it has children, a rewrite would move them, so commit `fixup! <subject>` (or `amend!`) in a
  pull request of your own on the top whose body opens "Absorbs into #N at the next
  consolidation"; section 10 folds it down. Remove what the change makes dead in the same commit.
- **Otherwise open a new pull request on the cycle's top**, whether or not it depends on what is
  below. The cycle's file names the stack; failing that, it is the one `bun run follow` follows,
  the stack of two or more that holds the oldest open pull request. The first change after a release starts the stack on
  `main`. A second stack on `main` starts only on the operator's word, lands alone, and leaves the
  other to be replayed with `republish.ts --onto-main` (section 8). Never base on the middle of a
  stack, and state the base in the body.
- **Never change another session's pull request**: no commit, rebase or force push. Carry the fix
  as a `fixup!` on the top, or tell its owner.
- Skills and docs go on the stack too, with the `docs/transfer.md` row the change moves. Nothing
  private (an account, a credential path, an address) becomes a pull request.

## 3. Create the worktree

One worktree per pull request, from the top, pinned by commit since the branch can move between
fetch and checkout; then `bun install --frozen-lockfile` once:

```sh
git worktree add -b claude/<topic> ../anabasis-<topic> <top-head-sha>
```

Never branch in or switch a tree a run was launched from, since the run executes its source
(`bun run runs pulse` names such trees).

## 4. Move to the top without losing work

Save uncommitted work before anything else; a peer session may have written some of it:

```sh
git status --short
git diff --binary HEAD > <scratchpad>/salvage/work.patch
git rev-parse HEAD > <scratchpad>/salvage/BASE
# copy each untracked file to <scratchpad>/salvage/tree/<its relative path>
```

Create the new worktree (section 3) and `git apply --3way <scratchpad>/salvage/work.patch` there.
Leave the old tree as it is until the new one passes its checks. Never use `git stash` by hand:
all worktrees share one stash, and another session can pop it. Each saved file is either on
the stack already (`git show <top>:<path>`; drop it and say so), yours (route it by section 2), or
not yours (leave it); never discard one because it looks accidental.

## 5. Shape the commits

**Every commit passes alone.** Later sessions imitate the history, and a failure followed by its
repair teaches them to commit failures. Fold a fix into the unpublished commit it repairs:

```sh
git commit --fixup=<sha>
GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <sha>~1
```

Before the first push, regroup a history that went back and forth (one or two commits for a small
pull request, five to ten for a large one): `git branch park/<topic> HEAD`, `git reset --soft
<base>`, commit path by path with each owner before its consumers and each test with the behaviour
it proves, then check that `git diff --quiet park/<topic> HEAD` succeeds.

A subject names the finished change in a title's register (section 7); the body never narrates a
revert. Install the hooks once per clone
(`bun run hooks:install`); pre-commit runs `bun run commit:check`. Run `/simplify` over a source
diff first, prefer removing an owner to adding one, and give net source lines for a simplification.

## 6. Run what CI runs

`.github/workflows/ci.yml` runs only when `bun run land -- <top> --merge` dispatches it (as
`ci-fixes` after a run that failed only in tests: `tools/runtime/ci-runs.ts`). It covers two
platforms because the wall has two mechanisms.

| job | steps |
| --- | --- |
| Darwin (macOS 15) | `bun install --frozen-lockfile`, `bun run ui:deps`, `bun run typecheck`, `bun run lint -- --strict`, `bun run format:check`, `bun run secrets`, `bun run test` |
| Darwin UI (macOS 15) | `bun install --frozen-lockfile`, `bun run ui:deps`, `bun run ui:build`, `bun run test -- packages/ui/test` |
| Linux (Ubuntu 24.04 VM) | install `bubblewrap`, `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`, `bun install --frozen-lockfile`, `bun run test`, `ANA_CLIMB=1 bun run test -- test/climb.test.ts` |

`bun run gate` runs both Darwin jobs here and stops at the first failure; `-- --static` runs only
tests one import from what `HEAD` changed (UI browser tests only where `UI_SETUP`,
`tools/runtime/gate.ts`, is touched). Judge each step by its exit code, and state where a job run by
hand ran and its counts. The suite needs a Git repository; the Linux job needs a VM (Bubblewrap
makes namespaces), `zip`, and on a small VM `sudo sysctl -w vm.overcommit_memory=1`. Beside paid
solves run only focused tests. Rerun a failed test alone several times before calling it flaky or
fixed, and fix a flaky test in its own pull request.

## 7. Publish

Push your own branch, naming the commit; a rewrite takes a lease on the head you last saw:

```sh
git push origin <sha>:refs/heads/<branch>
git push --force-with-lease=refs/heads/<branch>:<old-sha> origin <sha>:refs/heads/<branch>
```

An explicit commit keeps the published head equal to the one the hook checked (over HTTPS, `HEAD`
is resolved again after the hook). Chain commit and push with `&&`, never `;`. Fix a refusal at its
cause. `--no-verify` only on the operator's word, and never push to `main`.

A plain push runs `git diff --check` and the secret scan on what it adds; `ANA_PUSH_VERIFY=1 git
push` adds `bun run gate -- --static` on each head that changes code, which `land` reuses.
**A pushed commit is unproved** until `bun run land -- <top> --sanitize` (section 9) checks it.
Passes are remembered by tree, gate and Bun version, so a restack that keeps trees reruns nothing;
`ANA_GATE_FRESH=1` ignores them. Fold a fix into the failing commit (section 5) and land again.

```sh
gh pr create --draft --base <parent branch> --head <branch> --title "<title>" --body-file <file> --label importance:I<n> --label <category>
```

A pull request opens as a draft; `--sanitize` marks it ready once its head posts `mergeable`. It
carries exactly one importance label (`importance:I0` to `I3`, defined in `AGENTS.md` section 11)
and at least one category, or `land` refuses the stack before any check
(`gh pr edit <number> --add-label <label>`). Categories (`CATEGORIES`, `tools/runtime/land.ts`;
`gh label list`): `exam`, `verdicts`, `supply`, `harness`, `comparison`, `climb`, `solve`,
`economy`, `runs`, `log`, `investigation`, `landing`, `quality`, `docs`. A consolidation spends
by importance ([consolidate-stack](../consolidate-stack/SKILL.md), step 5).

### Title and body

Write a short methods note for a colleague who has not read the conversation (`AGENTS.md`,
section 13). A **title** is an imperative of at most about ten words naming
the changed behaviour in the system's nouns: at most two changes joined by "and", and no rationale
clause, colon, list, possessive chain or "Ix:" prefix. Prefer exact verbs (restore, preserve,
report, correct, refuse, remove, define, apply) to conversational ones (let, say, drop, fix what).
The operator's title is used word for word; a title a push made wrong is rewritten with the body.

| Conversational | In this style |
| --- | --- |
| Drop pulse's --once, which has changed nothing since one look became the default | Remove the redundant pulse option --once |
| Fix what the landing review confirmed: a lost pause, an overwritten file, a moving seal | Correct pause, follow and sealing defects found in landing review |

The **body** opens with `Stacked on #<n>.` where it applies, then one paragraph: the change, its
mechanism, why it matters and any material limit. Then, usually under **Problem and method** and
**Validation and limits** (headings are aids, not requirements):

- the observed problem with counts and their population, and how the change answers it, owner
  before file;
- the recent pull requests it builds on, fixes, retires or reverses, checked against their diffs;
- where a reader changed, what a replay now reports, apart from any change in performance;
- validation at the recorded commit: commands, platform, passed, skipped and failed counts; tests,
  live observations and estimates apart; an inherited check marked "previously reported";
- what stays untested, naming Linux, live behaviour or billing where unchecked.

Each claim names its level (`AGENTS.md`, section 9). ML framing (training exposure, evaluation
conditions, solver variance, compute cost) is welcome where it clarifies; a repriced saving is an
estimate. Tables for like-for-like comparisons; no run logs, long file lists or authorship labels.
Rewrite the body after every push that changes the pull request.

> This PR makes the Examiner wait for an admission result by ending its turn. The host resumes the
> conversation when a result arrives, instead of asking for more work and leaving the model to wait
> through shell sleeps. The runtime behaviour is tested; the model's use of it still needs live
> observation.

## 8. When a parent moves

A parent that only gained commits leaves its children valid. A rewritten parent does not; replay
each of your own children, bottom up:

```sh
git rebase --onto <new parent head> <old parent head> <child branch>
git merge-base --is-ancestor <new parent head> <child branch>    # must succeed
```

Push every moved head in one `git push --atomic`, each with its own lease and
`<sha>:refs/heads/<branch>`. Send another session's child the `git rebase --onto` line instead.

`bun run land -- <top> --sanitize` (or `--merge`) does this for the whole chain, and for what is
stacked above it: it replays each child from the newest parent head GitHub records that the child
holds, pushes every moved head atomically under leases, says the rebase line for each, and proves
the result. A child that does not replay cleanly is refused with the `git rebase --onto` line to run
by hand. A head that moves while a landing proves commits stops it, and it starts again from the
lowest pull request that moved, with every recorded pass kept. Restacking the whole open stack onto
`main` takes the operator's word.

When the branch beneath the stack has landed, `land` refuses the stack and `stack.ts` prints an
`off main:` line. One command replays the chain onto `origin/main` with `git replay`, checks every
subject came across, retargets, pushes under leases and relinks the native stack; it restacks
everything, so it takes the operator's word, and it refuses a chain that does not replay cleanly:

```sh
bun .claude/skills/stack-pr/scripts/republish.ts --onto-main <top>        # show the plan
bun .claude/skills/stack-pr/scripts/republish.ts --onto-main <top> --yes  # carry it out
```

## 9. Land

Merging is the operator's decision, and a session tags nothing unless asked. A stack lands through
GitHub (`tools/runtime/land.ts`), so each pull request ends as Merged:

```sh
bun run land -- <top>                 # prove it here; nothing is written to GitHub
bun run land -- <top> --sanitize      # and post each commit's verdict as ana/commit
bun run land -- <top> --sanitize --once # and end once it is proved, as a session waiting for it does
bun run land -- <top> --merge         # and wait for ci.yml, post ana/stack-gate, and merge
bun run land -- <pr> --auto --merge   # land the top above <pr>, following a new top stacked meanwhile
bun run land -- --merge               # the same, for the stack holding the oldest stacked pull request
bun run land -- <top> --merge --alone # merge beside another chain on main, on the operator's word
bun run land -- <top> --merge --tag v0.9.0 # and cut that release at the merge
```

Without `--once` a landing follows its stack: once it ends it lands again each time an open pull
request moves, until the one named closes or Ctrl-C ends it; every pass is remembered, so a round
costs only what moved. A `--merge` lands once. A session that waits for the verdict names `--once`.

GitHub allows merge commits only, and ruleset 25824510 on `main`
(`gh api repos/s-smits/anabasis/rulesets/25824510`) refuses non-fast-forward pushes and requires
`ana/stack-gate`, which only `--merge` posts.

`land` checks that each base contains the head beneath it down to `main`, so the last merge leaves
`main` at the top's tree, then proves each commit on the top's first parents: static steps and
nearby tests, and the whole gate on the top; recorded passes are reused, at a merge as at a
sanitize (`ANA_GATE_FRESH=1` proves every commit afresh by hand), and `--jobs N` runs N static passes
at once. **A passing proof is not a release**: a stack merges only once a fresh run at the top's head
has reached two promotions on unchanged code (run-improvement-campaign, "A run proves the release");
land the proved top by its number, never a newer top. On failure, fold the fix into the named
commit, push it and land again with `--sanitize`, which replays what is above (section 8). A
landing whose chain covers a live landing's in this clone ends that one, whose passes stay
recorded, instead of waiting behind it; a `--merge` is never ended. A runner that twice says nothing
of a commit (a dropped connection, no slot in time, a host that does not answer or lacks the disk)
reads "gave no verdict"; land again. A landing that ends, however, leaves no status it posted
pending: it turns each into an error.

**The landing review.** Before `--merge`, three read-only reviewers each read the whole landing
(`origin/main..<top>`) through one lens, rather than one slice each. A slice makes every reviewer
learn every subject, and a defect class that spans pull requests, such as one fact read twice or a
lock that two verbs take, falls between slices. Each reviewer gets the range, every pull request's
stated problem and its lens, and never a conclusion. Each finding cites a file and line at the
top's commit and the event, test or count that would settle it, and is reported as confirmed,
plausible or refuted (`AGENTS.md`, section 11). Where the landing holds an `I0` or `I1`, one lens
goes to another model family.

| lens | the skills it reads from | what it runs and asks |
| --- | --- | --- |
| The measurement | design-and-seats, comparison-reading, campaign-mechanics, attribution-and-proof | `seat-view.ts --base origin/main` and each wall test it names; `bun run runs replay`, which must refuse no log a real run wrote (exit 0); does a change move what a seat reads, a reading, a term or default, or an old event's readability, and does each body claim no more than its rung |
| The run's life | run-management, system-path-simulation, local-checks | what a kill, a stop, a login at its limit, two processes at once, a gathered copy of a live run or a moved checkout does to each changed verb, lock, pause, retire, fetch, follow or land; whether a refusal writes before its last check; a dry run or rehearsal of each changed path |
| The owner and the shape | simplify, reduce-complexity, repository-practice, `tools/oxlint/HABITS.md` | `git complexity origin/main <top>` and rule 12 and 13 across the whole landing: a second reader of one fact, a guard for a state that cannot arrive, a patch on one instance, a test without its hostile case, a reader or UI page left behind a changed writer, and a "Not done" that is honest |

The lenses follow the findings of the review of 4 November (`docs/backlog/v093-open-findings.md`),
which fell into these three classes. Confirmed findings go on the pull request that owns them before
`--sanitize` runs again; plausible ones go to the backlog with what would settle them.

`--merge` dispatches `ci.yml` where none ran, waits, and on failure says whether to fix a commit or
`gh run rerun <id>`; then it posts `ana/stack-gate` and merges the native stack all or nothing,
pinned to the checked head. To open a pull request on the top, push its branch, open it with
`gh pr create --draft --base <top's branch>`, and run `bun run land -- <new top> --sanitize --once`: before
gating, `--sanitize` and `--merge` link the whole chain into the native stack where GitHub's stack
holds only its lower part or none of it, and a plain `land` prints the `gh stack link` it would run.
A stack in another order is refused with its `gh stack unstack` and link lines. Test `land` only
against a fake `gh` (`test/land.test.ts`).

**Landing part of a stack.** `bun run split -- <pull request> --yes` cuts the native stack after
the last pull request to land; once the lower part lands, the same command moves the upper commits
onto the merge with their trees and passes intact, so each upper pull request takes a new head and
its old one can stand on no remote branch, which `runs fresh --at` refuses; read a fork's commit
from `gh pr view <n> --json headRefOid` at the launch. Run it only on the operator's word.

### Release notes, when the operator asks for the next version

Replace GitHub's generated notes (`gh release edit vX.Y.Z --notes-file <file>`) with 550 to 800
words shaped like the last releases (`gh release view <tag>`): at most three opening sentences (what
changed, whether the minor version moves and why, run-improvement-campaign, "A run proves the
release", and whether a fresh campaign ran on the tree); "Includes **N PRs from #a to #b**, merged
at `<sha>`."; three or four bold subject groups, a bullet each for changes to what a run measures,
with one or two bold counts and their denominators and the pull requests in brackets; every rule 3
fix and carried finding kept; and **Validation and limits**: one table (Landing, Gate head, Tests
passed / skipped / failed, Merge linking the `ci.yml` run) and at most three short paragraphs. Name
no host, login or account.

## 10. Consolidate the stack

Consolidation rewrites a stack grown fix by fix into fewer pull requests ordered by subject,
folding every "Absorbs into #N" carrier into #N. It rewrites other sessions' pull requests, so it
takes the operator's word, and it is a skill of its own,
[consolidate-stack](../consolidate-stack/SKILL.md). In summary:

1. read each pull request as the problem its body states, with its evidence, owner and what it
   rests on;
2. group by type (importance and kind), then by owner, and let dependencies set the order: a gate
   above the sites it judges, an answer above its rule;
3. rethink each group with [simplify](../simplify/SKILL.md)'s shapes until it is the least change
   that answers every stated problem, measured before and after;
4. trial the order on a scratch worktree (conflicts, ordered files such as the not-slop ledger,
   tree equality, checks at each group head) before anything moves;
5. review each group, restructure in one rebase, fix in lanes, assemble and check;
6. make each group one pull request and publish with `republish.ts`.

```sh
bun .claude/skills/stack-pr/scripts/republish.ts --head <pr>=<sha> ... [--absorb <pr>=<into>] ...
bun .claude/skills/stack-pr/scripts/republish.ts <the same> --yes [--no-verify]
```

## Report

The edges read and when, which pull request the change expanded or why it is new, where it sits,
each commit's subject, the checks with counts and where they ran, and where each saved file went.
