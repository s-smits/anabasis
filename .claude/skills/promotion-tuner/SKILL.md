---
name: promotion-tuner
description: "Read recorded comparisons under other promotion rules without model calls or spending. scripts/lab.ts tries any mechanism (weights, a resource such as the bill, turns or seconds as a gain or a guard, floors, the test, the level, or free code in a file) on one panel over the whole record: steps added and dropped, A/A against how many A/As could read a step, starter reads, sign repeats, later outcomes, every row by pack. scripts/replay.ts asks whether one tree's rule supports the promotions on record, which measure won each task and what each promotion cost. scripts/table.ts describes runs by release, pack and setting, and scripts/cost.ts prices promotions on one meter. Applies to questions about past promotions, changed scoring, what a promotion should reward, or comparisons between release cycles; a replay never establishes a live improvement."
---

# Promotion tuner

A comparison scores each task by two weighted measures over the pairings of its solves, validity
and the objective, and one test over those scores must clear the level to promote (`AGENTS.md`,
section 7, "The tally" and "The test"). An older tree also scored the bill, and
the replay scores it where the tree under replay weighs it (`Points`, `scripts/tree.ts`). This skill
asks what any rule would read of the solves on record. It starts no solve, calls no model and writes
nothing of a campaign's.

It tunes how a comparison scores the solves it bought. What a seat is told (the Examiner's prompt,
a task admission's reply) is tuned by seating it in rounds of live pairs, system-path-simulation's
[optimize](../system-path-simulation/cases/optimize.md), which reads its rounds in the same order
as this skill reads a panel.

## What can be tuned, and whose it is

Every term of the rule is the operator's condition, so a sweep is evidence brought to the operator
with a recommendation, never a change made on its own. A change to the score is no gain of a harness.

| Term | Where it lives | How the lab changes it |
| --- | --- | --- |
| The weights of validity and the objective | `WEIGHTS`, `src/kernel/compare.ts`, in steps of five | `validity=`, `objective=` |
| A resource as a gain | nothing scores one in production | `bill=`, `turns=`, `seconds=`, with `when=`, `side=`, `lead=`, `floor=` |
| A resource as a guard | none in production | `mostBill=`, `mostTurns=`, `mostSeconds=` |
| The objective gap floor and the form of a gain | `ROOM`, `pointsOf` | `room=`, `gain=` |
| The test | `flipP`, `stepOf` | `test=`, `untied=`, `level=` |
| Which tasks enter | `scoredSet` | `retained=` |
| Anything else | | a `--mechanism` file, or a candidate tree with `--against` |

`scripts/mechanisms.ts` says what each knob does.

## The lab

```sh
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/lab.ts \
  [--try <knobs>]... [--mechanism <file>]... [--against <worktree>]... [--tree <worktree>] \
  [--from <tag or date>] [--logs <dir>] [--name <campaign>]... [--record <file>] [--refresh] \
  [--split <tag or date>] [--named]
```

With no `--try`, `--mechanism` or `--against` it prints a standard set. Each `--try` is a list of
knobs over today's values, as `--try bill=0.1,lead=answers`. A `--mechanism` file exports a
`Mechanism` or a list of them, whose `score`, `test` and `guard` are free code. `--record <file>`
keeps the reduced record under `data/derived/`, and it holds exam-side measures, so it stays out of
every prompt, pull request and paste. `--refresh` reads the logs again.

The first lines reconcile the lab with the tree. Read them first: the knobs at today's values must
differ from the tree's score on 0 tasks, or the knob rows are not read from the tree's rule.

**The panel.** Read a row by these columns, and never by its steps alone:

| Column | What it says | How it misleads |
| --- | --- | --- |
| steps, `+`, `-` | candidates it would promote, against the tree | a rule that promotes more is not a better rule |
| ahead, lvl, 0-0, bhd | what the tree's own tally of an added step's tasks read | a `0-0` step rests on no answer at all |
| starter | starter comparisons it reads for the reference | few, and a rule that favours what the climb grew also reads high |
| A/A (could) | A/As it reads a step on, either way, over those whose margins could read one at all, with all of them in brackets | most are too small to read a step, so a rate over all of them flatters any rule |
| repeat | how often a task's sign holds on the comparison's other solves | a resource repeats readily, since it measures the harness's habits rather than its answers |
| bill, turns, secs | the new side over the reference on tasks both answered, median over the steps | a guard reads the largest of these, never the median |
| $/step, h/step | the candidates' solves over its steps | assumes the campaigns would have bought the same comparisons |
| by pack | steps in each pack | a pooled rate reads the mix of packs |
| moved | tasks whose score changed, and how | a weight moves many scores and few readings |
| same, other, none, unread | what became of an added step | runs that read nothing after are censored, not failures |

`--split` prints each row's step rate either side of a release, raw and at one mix of packs, and
`--named` names each comparison a row added or dropped.

**What the record has taught about a rule**, each checkable on the panel:

- A weight sets a margin, and only rarely a reading: where a measure makes tied tasks lean, a small
  weight adds nearly the steps a large one does.
- A score must negate when the sides swap, since the test assumes it. A form that counts one way
  only leans between identical harnesses: read its A/A before its steps.
- A guard can only remove a step and needs a step to refuse, so read the largest ratio among today's
  steps before expecting a ceiling to bite. It pushes nothing down.
- A gain and a guard differ in what they can do: only a gain rewards a saving.
- Time follows load, the host and the solve queue, so it repeats worse than the bill and is read
  with that in mind.
- Replay the same tree before any rule row: the record holds different packs, and pooling reads
  their mix.

## The replay

```sh
bun .claude/skills/promotion-tuner/scripts/replay.ts --tree <worktree> \
  [--logs <dir>] [--since <date>] [--name <campaign>]... [--totals]
```

- `--tree` names the worktree whose kernel scores the record, as an absolute path. The totals name
  its commit and whether `src/` has uncommitted changes. An older tree that
  scores no weighted measures is refused. Replay calls the selected tree's `stepOf`; trees from before the dual rule keep their full-score-only decision.
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
`pointsOf`, `WEIGHTS`, `flipP`, `stepOf`, `readsStepEitherWay`, `billedBetween` and `BILLED` (`loadTree`).

## Every run side by side

`replay.ts` asks whether a score supports the promotions on record. `scripts/table.ts` asks how the
runs compare: one row a run, a group or a promotion, from the same logs and receipts, with nothing
scored again.

```sh
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/table.ts \
  [--rows recent|groups|runs|promotions] [--by release,pack,setting,host,none] \
  [--since <date>] [--name <part>]... [--last 20] [--has <text>]... [--holds <commit>]... [--format md|tsv]
```

- **`recent`**, the default, is the quick look: every live run, whatever it has promoted, then the
  latest twenty finished runs that promoted at least once. Each row gives the hours to the first
  promotion, which is set-up, the promotions reached, and the mean hours, active hours and dollars
  of a rung, a promotion after set-up. Set-up takes longer, so it is kept apart, and the all-in hours
  a promotion stand beside it. A line under the table gives the medians a live run is read against.
- **`groups`** compares cycles. A run's release is the tag before its first launch (`after v0.8.0`
  is the cycle building the next release), its pack the first word of its name, its setting the
  solver, effort and solve limits. The default groups by all three, since results are never compared
  across settings (`AGENTS.md`, section 9); `--by release` pools them and marks the group `POOLED`.
  `by 6 h`, `by 12 h` and `by 24 h` count the runs promoted by then over those that were or lasted
  that long, so a young run is no miss. Grouping by stack pull request was rejected: a stack's
  numbers mean nothing from one cycle to the next.
- **Hours say how fast, not on what.** `groups` and `runs` also give the room on validity (scored
  tasks the reference did not answer validly in every solve, of those scored, summed over the
  reported comparisons), the steps won by validity (`validityOf`) and the confirmed promotions.
  A cycle whose room is near zero can promote only on the objective (and, in an older tree, the bill), whatever its
  hours: buffer after v0.8.0 held 7 of 571, its steps 5 of 17 on validity.
- **`--has`** and **`--holds`** keep the runs whose every launch ran with a mechanism (`ranWith`),
  which is how a change is read against the runs without it (`AGENTS.md`, section 9, "Evidence").
- Hours are on the log's clock, the same on macOS and Linux. Active hours subtract the union of every
  recorded wait (`waitsOf`, `tools/wri/time.ts`). Host, cores, load per core at a solve's start and
  the median solve stand beside them as indicators; no hour is scaled by them.
- A run sitting out a provider reset longer than two hours reads as finished with `no ending`.
  One run is one draw: read a group's medians beside its run count.

### Dollars a promotion on one meter

`table.ts` reads each run's dollars as its own meter billed them, and the meter moved (first to
each turn at the model that served it, then to a session on its backend's ledger). Before
saying a cycle is cheaper, price every run the same way:

```sh
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/cost.ts \
  [--since <date>] [--name <part>]... [--by week|pack|setting|none] [--format md|tsv]
```

It prices every recorded turn with today's seat meter (`seatMeter` on its provider's catalogue),
sets that beside the recorded bill, and pools the finished runs of each week (or pack) and
setting into dollars a promotion. Turns are the one measure every log holds; a backend's excess
over them (compactions, retries) is billed only by newer runs, so `repriced/recorded`
just under 1 on those runs is that excess. For example, buffer at Opus 5.5 medium read $320 a
promotion in its first week, then $58 and $56, with repriced and recorded within 1% over the later
two: the fall was the system's, not the meter's.

## What to read

For each pair of harnesses, old digest first:

- The first reading of the pair that steps, its `W-L-T` over the frontier and retained tasks
  together and its p, and then `rightful`, `in doubt` with its reasons (its A/A read a step, or a
  later reading of the pair lost more tasks than it won), or `added by this score` for a pair the
  campaign did not promote.
- **Which measure won each task** of that reading: validity where validity gave it points, the
  objective where only the measures between two valid answers did and the objective among them,
  and, under an older tree, the bill alone. This is the count to watch when the
  weights move: the bill took a tenth of the weight, yet a task every solve of both sides answered
  validly could be won by the bill alone, which is why it left the score.
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
- An older report was tallied rule by rule (validity, else the objective, else the
  bill) and holds no points. `reading otherwise than recorded`, to a step and from a step, counts
  what the weights changed on those readings. It is a finding about the score, never a defect.

An A/A is the reference against itself on mirrored halves of its solves (`pairsOf` with
`halves: "mirrored"`), available at any even number of solves a side, so at two it reads the first solve against the
second (`src/campaign/comparison.ts`). The tree's
`readsStepEitherWay` reads a step where the scores clear the comparison's level in either direction,
as the whole-run reader and the UI do: on the unbilled scores alone, and in an older tree
where the scored and unbilled tests clear together. An A/A step is false by construction.
Recorded reports without unbilled A/A scores retain their scored-only reading; the replay reconstructs
both scores from the pairs. A reading with a stored task that has neither a pair nor an unbilled
score cannot establish a replayed step.

`rightful` means the recorded solves support the promotion under this score. It cannot detect a
lucky draw; the A/A, the false-promotion estimate and a later reading on fresh solves give other
evidence (`AGENTS.md`, factor 2). Where only one score supports a promotion, name the score.

## Tuning the score

1. Write the prediction first, in the investigation's folder (`.ana/wri/<date>-<what>/`): for each
   mechanism to be tried, the counts of step 5 it should move and which way. A sweep read before its
   prediction invites the setting that reads best, which is a description of the record, never a
   tuning of it.
2. Read the lab's reconciliation lines and the tree's row, with the host environment loaded. Default
   discovery refreshes every host's records; keep a `--record` when a frozen comparison is needed.
3. Try the mechanisms with `--try` or a `--mechanism` file. Keep each set of weights in steps of five.
4. Where knobs and free code cannot say it, make a candidate worktree from `origin/main`, following
   [stack-pr](../stack-pr/SKILL.md), that changes one thing, and read it with `--against`.
5. Recommend a candidate on one of two bars, and name which:
   - **a gain**: promotions rise or hours per promotion fall, no A/A reads a step, and no added
     promotion is contradicted by a later reading of its pair. Count an added promotion with no
     later reading as untested;
   - **as good, and simpler**: a candidate that removes a floor, a measure or a branch of the test
     reads the same promotions as rightful, adds no A/A step and leaves hours per promotion where
     they were, and is simpler by reduce-complexity's measures.

   Give the won-by counts beside every candidate, and resolve each prediction of step 1 as held or
   missed with its count.
6. Deliver both tables in the pull request as counts, with the reconciliation explained.
7. Confirm live only on the operator's word, with a fresh campaign from a prompt at the candidate's
   commit and a prediction recorded before the first solve (`AGENTS.md`, section 10, item 9).
   Continuing a campaign at another commit measures no climb.

Limits of the replay:

- An earlier promotion would change the reference, the Examiner's tasks and later comparisons.
  The replay reads pairs on the recorded path, not a campaign under the candidate.
- A reading never bought has no solves to replay, and a rule changes which comparisons a campaign
  would have bought. A rule that rewards a measure also changes what a Builder aims at, which only
  fresh runs can show.
- An older report may name no task: its stored differences stand in the replay, and the lab leaves
  it out. A report that holds no frontier is left unread.
- In a led campaign, Examiner sessions and comparisons run inside the Builder conversation.
  `Builder alone` subtracts their union; `neither` is time outside all three. A Builder session
  across a promotion bills each epoch what its turns metered there: every part is billed through
  the tree's `billedBetween` over its own events, so an open session counts its metered turns and
  the parts add up to the epoch's total.

## The wall and the result

Keep the log on the exam side (`AGENTS.md`, sections 5 and 8). The script prints counts, session
ids, short digests and campaign names, never task contents, answers, measures or checks. Only
those aggregate results belong in a pull request or this skill.

Report, in order:

1. The trees, their commits, the mechanisms read, and the minute each was read.
2. The reconciliation counts on each.
3. Recorded promotions: rightful, in doubt with reasons, and rejected by the score.
4. Each candidate's totals beside the baseline: the bar of tuning step 5, each of its conditions
   with its count, each prediction held or missed, and the won-by counts.
5. Campaigns left out, reports read from stored differences, and live counts that may move.
