# Simulate a large PR stack in cumulative prefixes

**Use this case when:** an operator asks for a final test of a large stacked PR set (ten or more
open PRs, one chain) before it lands or before a paid run, and wants to know which single PR
carries each error. The "unlanded stack" trigger in `SKILL.md` gives one triage for the whole
stack; this case splits that triage so a finding is attributed to one PR and its fix travels
through every child before the next group is judged.

First use: 2026-09-06, 24 open PRs (#519..#573) in ten groups. Three of the first five groups
produced a blocking finding each in the owning PR's own file, all in reader or classification
layers whose tests had hand-rolled inputs; none of the findings was visible from the stack head
alone.

## 1. Group the stack

1. List every open PR with `gh pr list --state open --json number,headRefName,baseRefName` and
   prove the chain: each base must be an ancestor of its head, and the order must be one path.
   Every base of a stacked PR is a sibling branch, so GitHub never closes them when a peer
   integrates a prefix into main; check `git merge-base --is-ancestor <head> origin/main` for
   every head before starting, and again before the batch push.
2. Cut the chain into about ten groups by surface size: two small PRs with one large one, then the
   medium ones in pairs or threes. Group N is the cumulative prefix (operator decision 2026-09-06:
   "1-2, then 1-2+3-5, then all previous + 6"), so its head is the head of its last PR.
3. For every group record the live-exercise fact once: which recorded run's `opening.json`
   `source.commit` descends from that head, and what the delta is (a text commit, a compose merge,
   nothing). Credit exercise by blob identity when a tip is not an ancestor but the relevant
   files are byte-identical (`git rev-parse <rev>:<path>` on both sides).
4. Write `plan.md` in the session scratch directory: the group table, the recorded runs with their
   campaign directories, the worktree rule, the report path, a ledger with one row per group, and a
   lessons list. Stewards read it first.

## 2. Assign one steward per group

A steward is one `general-purpose` subagent at the operator's named model (2026-09-06: Opus 5
medium, `model: "opus"`), launched directly from the parent, never through a coordinator. That
batch used two concurrently; follow the current operator concurrency and Codex worktree rules. Its worktree is `scripts/worktree.sh new sim/g<NN>-<date> <abs-dir> <group
head>` from the shared dependency tree; its scratch directory is `sim/g<NN>/` beside `plan.md`.

The shared brief (`steward-brief.md`) fixes the method, authority and report:

- Triage from the PR bodies and `git diff origin/<base>..origin/<head> -- src tools vendor
  starters`: one row per decision change with PR, file and function, what decides differently, and
  the live-exercise citation (an exact file under the campaign directory, or `none`).
- One condition per unexercised change, cheapest first: one fact, layer walk, deterministic
  replay over copied recorded bytes. No model session, no `fullrun`, no paid turn. Pre-register
  the rows in `predictions.md`, hash them with `predictions.mts --hash`, mark the row expected to
  fail, resolve every row with `--resolve`.
- Read-only over Git and every recorded run; throwaway files inside the worktree are deleted
  before the report. A blocking finding comes back as `patch-pr<N>.diff` against the owning PR's
  own files, with the positive and nearest hostile test, proved in the steward's worktree.
- The report is a file with six sections (result per condition, decision-change table, conditions
  run, blocking findings, accepted risks, not run); the reply is a summary. A subagent's final
  result is truncated at a few thousand characters, so the file is the deliverable. If the Write
  tool is refused for a scratch path, the fallback is a Bash quoted heredoc to a literal
  `/private/tmp/...` path.

Keep a 290 s check loop in the parent (`ScheduleWakeup`): read each steward's scratch directory
and `git status --short` of its tree, steer by `SendMessage` only when a condition drifts (a model
launch, a write outside scratch, a live-model condition, an hour without a resolved prediction).

## 3. Land a finding on its PR and carry it forward

1. Verify the material claim against the source yourself (the function, the recorded file)
   before applying anything.
2. Apply the patch in the owning PR worktree and run its focused tests through
   `scripts/worktree.sh run <wt> bun run test -- <owning tests>`. Check the wrapper receipt
   identifies the intended working tree, then commit the named files. The older remote-runner
   workaround used in the September batch is not the current test command.
3. Compose the repaired head through every child with one merge per edge, recording each new head
   as a local ref `sim/pr-<n>` and one ledger line. The script shape:

   ```sh
   # compose.sh <repaired-pr> <repaired-sha>: for each later PR in the chain, start from
   # refs/heads/sim/pr-<n> if present else origin/<branch>, git switch --detach, skip when
   # merge-base --is-ancestor <parent-sha> HEAD, else merge --no-ff -m "Compose PR #<n> on
   # repaired PR #<parent>", then update-ref refs/heads/sim/pr-<n> and append to the ledger.
   ```

   A conflict stops the script at that child; resolve it in the compose tree, commit with a
   message naming both sides, `update-ref` that child and rerun the script from it. Prove the
   resolved merge with the owning test on its sha.
4. Fast-forward the trees of groups not yet started to their new `sim/pr-<n>` heads. Leave a
   running steward's tree where it started; its patch applies to the owning PR head, not to the
   tree it read.
5. Record in the ledger: group, result, finding, commit and owning PR, children carried through,
   and where the fix must still land (the PR branch, and main when a peer already integrated that
   prefix).

## 4. Close the stack

1. `git fetch origin` and compare every origin head with the base its `sim/pr-<n>` ref was
   composed on; a head a peer moved during the simulation is recomposed from the fresh head before
   anything is pushed (2026-09-06: #573 moved twice).
2. Batch-push every repaired branch once from a prepared tree at the final head, `git push origin
   sim/pr-<n>:<branch>` per PR, so the composed gate runs once. Use `--force-with-lease` only where
   a recompose replaced a head the parent itself had pushed.
3. A prefix a peer integrated into main during the simulation carries the pre-fix bytes; state
   that in the ledger and let the operator choose between the next stack integration and a direct
   main delivery for those fixes.
4. Remove only clean disposable worktrees this session created. Codex manages its own worktrees;
   preserve unpublished work and run evidence.

## What this case does not do

It attributes a deterministic finding to one PR; it does not exercise the stack live. A row only a
paid run can decide stays `accepted-risk` with its exact live condition written down, and a
transport that cannot run before a provider allowance returns is reported as such rather than
replayed against doubles. The composed gate on the batch push is the delivery proof, not a
capability claim.
