---
name: promotion-tuner
description: "Score recorded comparisons again by a tree's weighted measures, without models or spend. Read which promotions the score supports, which measure won each task, the A/A controls, and hours and dollars per promotion. Sweep the weights and the level by flag, and compare a candidate tree that changes a floor or the test."
---

# Promotion tuner

A comparison scores each task by three weighted measures over the pairings of its solves, and one
test over those scores and another without the bill must both clear the level to promote (`AGENTS.md`, section 7, "The tally" and
"The test"). This skill asks whether a tree's score supports the recorded promotions, and how other
weights, another level or a candidate tree read the same solves. A replay starts no solve, calls no
model and writes nothing of a campaign's.

## What can be tuned, and whose it is

| Term | Where it lives | How the replay changes it |
| --- | --- | --- |
| The weights of validity, the objective and the bill | `WEIGHTS`, `src/kernel/compare.ts`; the operator's, in steps of five | `--weights v,o,b`, in hundredths |
| The level | the campaign's opening; the operator's | `--level` |
| The room floor, the objective's full gain, the bill's floor | `ROOM`, `FULL`, `CHEAPER` | a candidate tree |
| How a measure is read over the pairings, and the test | `pointsOf`, `flipP`, `stepOf` | a candidate tree |

The weights and the level are the operator's conditions, so a sweep of them is evidence brought to
the operator with a recommendation, never a change made on its own. A change to the score is no
gain of a harness.

`--weights` needs no candidate: each measure's points are its mean over the pairings times its
weight, so the replay divides the tree's points by the tree's weight and multiplies by the one
asked. A measure the tree weighs at 0 cannot be scaled up, and is changed in a candidate tree.
The floors shape the mean itself, so they too need a candidate.

## The command

```sh
bun .claude/skills/promotion-tuner/scripts/replay.ts --tree <worktree> \
  [--logs <dir>] [--since <date>] [--name <campaign>]... [--weights v,o,b] [--level <n>] [--totals]
```

- `--tree` names the worktree whose kernel scores the record, as an absolute path. The totals name
  its commit and whether `src/` has uncommitted changes. A tree from before 21 October, which
  scores no weighted measures, is refused. A tree without `readsStep` (before 26 October) reads a
  step on the scores alone, as it did.
- By default the shared run registry discovers campaigns in every worktree and archive, and
  refreshes remote logs and receipts through `ANA_HOSTS`. Load the host environment with
  `bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/replay.ts ...`.
  Explicit `--logs` selects the offline layout `<logs>/<worktree>/.ana/d2/<name>/log.jsonl`, taking
  the largest copy of each campaign name there. Seeds with
  `seed.json`, names beginning `sim-`, `rh-` or `test-`, and rehearsals with a `faux/` seat or
  solver are left out (`campaignLogs`, `rehearsed` in `scripts/tree.ts`). A campaign on another
  host is read from a copy laid out the same way: `<dir>/<any>/.ana/d2/<name>/log.jsonl`.
- `--since` selects campaigns whose last event is at or after the date, five days back by
  default. Repeated `--name` selects named campaigns regardless of date.
- `--totals` prints only the totals.

Live logs grow. Read the baseline and the candidate close together, and record the minute of each.

The script reaches a tree only through its own `read`, `lastReports`, `pairsReported`, `pairsOf`,
`pointsOf`, `WEIGHTS`, `flipP`, `readsStep`, `readsStepEitherWay`, `measuresIn`, `billedBetween` and `BILLED` (`loadTree`).

## What to read

For each pair of harnesses, old digest first:

- The first reading of the pair that steps, its `W-L-T` over the frontier and retained tasks
  together and its p, and then `rightful`, `in doubt` with its reasons (its A/A read a step, or a
  later reading of the pair lost more tasks than it won), or `added by this score` for a pair the
  campaign did not promote.
- **Which measure won each task** of that reading: validity where validity gave it points, the
  objective where only the measures between two valid answers did and the objective among them,
  and the bill alone. This is the count to watch when the weights move: the bill takes a tenth of
  the weight, yet a task every solve of both sides answers validly can be won by the bill alone.
- A pair that never steps: each reading, short of its level, with its A/A. `NOT PROMOTED by this
  score` marks a recorded promotion the score rejects.
- Each promoted epoch and the open one: hours and billed dollars, split into the Examiner,
  comparisons and the Builder's own time (`scripts/time.ts`).

The totals count recorded promotions (rightful, in doubt, rejected), pairs the score adds, A/A
controls and their steps, the tasks the promoting readings won by each measure, steps followed by
a later reading of the pair and how many of those stepped again at their level, and how many only
won at least as many tasks as they lost, and the median and range of promoted
epochs' hours and dollars.

**Read the reconciliation counts first.**

- A report written under the weights holds the points each measure gave (`points`). At the tree's
  own weights, its frontier, retained and A/A differences must read as stored: `read otherwise
  than stored` is 0 at the tree that wrote them. Anything else is a candidate change or a replay
  defect, and is explained before any other count is read.
- A report from before 21 October was tallied rule by rule (validity, else the objective, else the
  bill) and holds no points. `reading otherwise than recorded`, to a step and from a step, counts
  what the weights changed on those readings. It is a finding about the score, never a defect.

An A/A is the reference against itself on mirrored halves of its solves (`pairsOf` with
`halves: "mirrored"`), available at four or more solves a side, an even count. The tree's
`readsStepEitherWay` reads a step only where both the scored and unbilled tests clear the comparison's
level in the same direction, as the whole-run reader and the UI do. An A/A step is false by construction.
Recorded reports without unbilled A/A scores retain their scored-only reading; the replay reconstructs
both scores from the pairs. A reading with a stored task that has neither a pair nor an unbilled
score cannot establish a replayed step.

`rightful` means the recorded solves support the promotion under this score. It cannot detect a
lucky draw; the A/A, the false-promotion estimate and a later reading on fresh solves give other
evidence (`AGENTS.md`, factor 2). Where only one score supports a promotion, name the score.

## Tuning the score

1. Run the baseline on `main`'s tree, whole and with `--totals`, into the scratchpad, with the host
   environment loaded. Default discovery refreshes every host's records; use the same explicit
   offline `--logs` input for both trees when a frozen comparison is needed.
2. Sweep `--weights` and `--level` first where they answer the question. Keep each set of weights
   in steps of five.
3. For a floor or the test, make a candidate worktree from `origin/main`, following
   [stack-pr](../stack-pr/SKILL.md), that changes one thing, and run the same table on it close to
   the baseline.
4. Recommend a candidate only where promotions rise or hours per promotion fall, no A/A reads a
   step, and no added promotion is contradicted by a later reading of its pair. Count an added
   promotion with no later reading as untested, and give the won-by counts beside every candidate.
5. Deliver both tables in the pull request as counts, with the reconciliation explained.
6. Confirm live only on the operator's word, with a fresh campaign from a prompt at the candidate's
   commit and a prediction recorded before the first solve (`AGENTS.md`, section 10, item 9).
   Continuing a campaign at another commit measures no climb.

Limits of the replay:

- An earlier promotion would change the reference, the Examiner's tasks and later comparisons.
  The replay reads pairs on the recorded path, not a campaign under the candidate.
- A reading never bought has no solves to replay, and the weights change which comparisons a
  campaign would have bought.
- A report before 14 October may name no task: its stored differences stand, and no weight moves
  them. Reports before 12 October hold no frontier and are left unread.
- In a led campaign, Examiner sessions and comparisons run inside the Builder conversation.
  `Builder alone` subtracts their union; `neither` is time outside all three. A Builder session
  across a promotion bills where it ends. `billedBetween` also meters unfinished work, so the
  script prints the tree's sum less the parts to expose any difference.

## The wall and the result

Keep the log on the exam side (`AGENTS.md`, sections 5 and 8). The script prints counts, session
ids, short digests and campaign names, never task contents, answers, measures or checks. Only
those aggregate results belong in a pull request or this skill.

Report, in order:

1. The trees, their commits, the weights and level each read, and the minute each was read.
2. The reconciliation counts on each.
3. Recorded promotions: rightful, in doubt with reasons, and rejected by the score.
4. Each candidate's totals beside the baseline, with each condition of tuning step 4 and its count,
   and the won-by counts.
5. Campaigns left out, reports read from stored differences, and live counts that may move.
