---
name: promotion-tuner
description: "Read recorded comparisons under other promotion rules without model calls or spending. scripts/lab.ts tries any mechanism (weights, the bill, turns or seconds as a gain or a guard, floors, the test, the level, free code) on one panel over the record; scripts/replay.ts asks whether a tree's rule supports the promotions on record and which measure won each task; scripts/table.ts lists runs and their promotions; scripts/trend.ts sets the newest week's runs against the weeks before, each difference tested against the spread between runs, with the climb read against what holds it and, with --bench, against outside scores; scripts/cost.ts prices promotions on one meter. Use for past promotions, changed scoring, what a promotion should reward, whether the system does better than one or two weeks ago, or comparisons between release cycles; a replay never establishes a live improvement."
---

# Promotion tuner

A comparison scores each task by weighted validity and objective over its solve pairings, and a
sign-flip test over those scores must clear the level to promote (`AGENTS.md`, section 7). This
skill re-evaluates the promotion rule off-policy: what any other rule would read of the solves on
record. It starts no solve, calls no model and writes nothing of a campaign's. What a seat is told
is tuned instead with live seats ([optimize](../system-path-simulation/cases/optimize.md)).

Every term of the rule is the operator's condition, so a sweep is evidence with a recommendation,
never a change. A change to the score is no gain of a harness, and **a replay never establishes a
live improvement**.

## What can be tuned

| Term | Where it lives | Lab knob |
| --- | --- | --- |
| Weights of validity and the objective | `WEIGHTS`, `src/kernel/compare.ts`, in steps of five | `validity=`, `objective=` |
| A resource as a gain | none in production | `bill=`, `turns=`, `seconds=`, with `when=`, `side=`, `lead=`, `floor=` |
| A resource as a guard | none in production | `mostBill=`, `mostTurns=`, `mostSeconds=` |
| The gap floor and form of a gain | `ROOM`, `pointsOf` | `room=`, `gain=` |
| The test | `flipP`, `stepOf` | `test=`, `untied=`, `level=` |
| Which tasks enter | `scoredSet` | `retained=` |
| Anything else | | a `--mechanism` file, or a candidate tree with `--against` |

`scripts/mechanisms.ts` documents each knob. An older tree also scored the bill; the replay scores
it where that tree weighs it (`Points`, `scripts/tree.ts`).

## The lab

```sh
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/lab.ts \
  [--try <knobs>]... [--mechanism <file>]... [--against <worktree>]... [--tree <worktree>] \
  [--from <tag or date>] [--logs <dir>] [--name <campaign>]... [--record <file>] [--refresh] \
  [--split <tag or date>] [--named]
```

With no `--try`, `--mechanism` or `--against` it prints a standard set. `--try
bill=0.1,lead=answers` sets knobs over today's values; a `--mechanism` file exports `Mechanism`s
with free `score`, `test` and `guard` code. `--record <file>` keeps the reduced record under
`data/derived/` (exam-side: never in a prompt, pull request or paste); `--refresh` rereads the logs;
`--split` gives step rates either side of a release; `--named` names each comparison a row added or
dropped. **First check the reconciliation lines**: today's knobs must differ from the tree's score
on 0 tasks.

Read a panel row by all its columns, never by steps alone:

| Column | Says | Misleads because |
| --- | --- | --- |
| steps, `+`, `-` | promotions against the tree | more promotions is not a better rule |
| ahead, lvl, 0-0, bhd | the tree's tally on an added step | a `0-0` step rests on no answer |
| starter | starter reads for the reference | few, and favour what the climb grew |
| A/A (could) | A/A steps over A/As able to read one | a rate over all A/As flatters |
| repeat | sign agreement on other solves | resources repeat as habits |
| bill, turns, secs, $/step, h/step | medians and spend a step | a guard bites on the maximum |
| by pack, moved, same/other/none/unread | mix, changed scores, fate of an added step | later-unread runs are censored |

On the record: a weight sets margins and rarely readings; a score must negate when the sides swap,
or it leans in the A/A; a guard only removes steps (read the largest ratio first), and only a gain
rewards a saving; time follows load and repeats worse than the bill; replay the same tree before
any rule row.

## The replay

```sh
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/replay.ts --tree <worktree> \
  [--logs <dir>] [--since <date>] [--name <campaign>]... [--totals]
```

`--tree` is the absolute path of the worktree whose kernel scores the record; the totals name its
commit and any uncommitted `src/` change, and a tree that scores no weighted measures is refused.
By default the run registry finds campaigns in every worktree, archive and host (`ANA_HOSTS`);
`--logs` reads the offline layout `<logs>/<any>/.ana/d2/<name>/log.jsonl`, the largest copy of each
name. Seeds, `sim-`, `rh-` and `test-` names and rehearsals are left out (`campaignLogs`,
`rehearsed`, `.claude/skills/main/logs.ts`). `--since` defaults to five days back; `--name` overrides the date;
`--totals` prints only totals. Live logs grow, so read baseline and candidate close together and
note the minute. The script reaches a tree only through `loadTree`.

For each pair of harnesses it prints the first reading that steps (`W-L-T`, p) as `rightful`,
`in doubt` (its A/A stepped, or a later reading of the pair lost more than it won) or
`added by this score`; **which measure won each task** (validity, the objective, or under an older
tree the bill alone, which is why the bill left the score); pairs that never step, marking
`NOT PROMOTED by this score`; and each epoch's hours and dollars split into Examiner, comparisons
and Builder (`scripts/time.ts`).

**Read the reconciliation first.** A report written under weights stores each measure's points, and
at the writing tree `read otherwise than stored` must be 0; anything else is a candidate change or a
replay defect, explained before any other count. An older report tallied rule by rule holds no
points, so `reading otherwise than recorded` counts what the weights changed: a finding about the
score, never a defect.

An A/A pairs the reference's mirrored halves of its solves (`pairsOf`, `halves: "mirrored"`), and
`readsStepEitherWay` reads a step either way on unbilled scores; an A/A step is false by
construction. `rightful` means the recorded solves support the promotion under this score; it cannot
detect a lucky draw, which the A/A and a later fresh reading address. Whether promotions bought
ability is whole-run-investigation's lane 27.

## Every run side by side

```sh
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/table.ts \
  [--rows recent|runs|promotions] [--since <date>] [--name <part>]... [--last 20] \
  [--has <text>]... [--holds <commit>]... [--format md|tsv]
```

One row a run or promotion, nothing rescored. **`recent`** (default) lists live runs and the
latest twenty that promoted, set-up hours apart from hours and dollars a later promotion.
**`runs`** gives each run's own counts of the trend's measures, among them validity room and steps
won by validity (`validityOf`): without room a run promotes only on the objective. `--has` and
`--holds` keep runs whose every launch had a mechanism (`ranWith`). Active hours subtract recorded
waits (`waitsOf`, `tools/wri/time.ts`). The row is the fold of `.claude/skills/main/runs.ts`
(`runOf`); beside the climb it carries what holds it: the promotions a starter comparison read and
confirmed, and the reference's tally on the tasks written after its promotion (`starterReads`;
comparison-reading's [starter-reads.ts](../comparison-reading/SKILL.md) prints one run's). One run
is one draw, so groups of runs are set against each other by `trend.ts` alone.

## Then and now

```sh
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/trend.ts \
  [--window 7] [--back 2] [--until <date>] [--pack <pack>]... [--any-setting] \
  [--has <text>]... [--holds <commit>]... [--bench <store>] [--format md|tsv]
```

"Is the system doing better than a week and two weeks ago" is answered here, a pack at a time. A
run is placed by the day it opened; an earlier window keeps only runs under a setting the newest
holds, and each window names its releases, since a difference across minor releases describes the
record and attributes nothing. Every measure is a rate over its exposure, because the newest runs
are younger and paused at their trigger, and each difference is put to a permutation test with the
campaign as the unit (`.claude/skills/main/stats.ts`): `moved` at p of 0.05 or less, `inside the
spread`, or `too few runs`. The closing line counts the tests, since one in twenty reads `moved` by
chance. `--back 4 --pack buffer` is the control read of `AGENTS.md` section 10.

**The climb against what holds it.** More promotions an hour is a gain only where they hold, so one
line a window sets promotions a 100 active hours beside the share the starter confirmed and the
share of tasks written after a promotion that the reference still won, and names the pattern:
`together`, `apart` (faster while fewer held, the shape of a climb fitted to its comparisons), `no
single direction` or `not read`. It is a lead for [comparison-review](../comparison-review/SKILL.md)
or a [whole-run investigation](../whole-run-investigation/SKILL.md), never a finding.

**The outside link.** `--bench <store>` reads a score store's judged records (`scripts/outside.ts`;
run-improvement-campaign's "The outside aim" fills the store) and joins each arm to the promotion
that promoted its digest, with its points against the Starter's lowest and highest sum on the same
tasks. A promotion the starter confirms that stays inside or below that spread is the case to
investigate, as a difference in conditions first. A bench score promotes nothing and reaches no
seat (`AGENTS.md`, section 1). Wording a claim from either table is
[attribution-and-proof](../attribution-and-proof/SKILL.md)'s.

`table.ts` uses each run's own meter, which has changed. Before calling a cycle cheaper, price all
runs on one meter:

```sh
bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/cost.ts \
  [--since <date>] [--name <part>]... [--by week|pack|setting|none] [--format md|tsv]
```

It reprices every recorded turn with today's `seatMeter` beside the recorded bill and pools dollars
a promotion; on newer runs `repriced/recorded` just under 1 is the backend's excess (compactions,
retries).

## Tuning the score

1. **Predict first**, in `.ana/wri/<date>-<what>/`: for each mechanism, which counts of step 5 move
   and which way. A sweep read before its prediction describes the record instead of tuning it.
2. Read the lab's reconciliation and the tree's row; keep a `--record` where a frozen comparison
   is needed.
3. Try mechanisms with `--try` or a `--mechanism` file, weights in steps of five.
4. Where knobs cannot express it, make a candidate worktree from `origin/main` through
   [stack-pr](../stack-pr/SKILL.md) that changes one thing, and read it with `--against`.
5. Recommend on one named bar. **A gain**: promotions rise or hours a promotion fall, no A/A
   steps, and no added promotion is contradicted later (one with no later reading is untested).
   **As good, and simpler**: removing a floor, measure or branch keeps the same rightful promotions,
   adds no A/A step, keeps hours a promotion, and is simpler by reduce-complexity's measures. Give
   won-by counts beside each candidate, and resolve each prediction as held or missed.
6. Deliver both tables in the pull request as counts, reconciliation explained.
7. Confirm live only on the operator's word, in a fresh campaign from a prompt at the candidate's
   commit with a prediction before the first solve (`AGENTS.md`, section 10, item 9).

The replay reads pairs on the recorded path, so it cannot show the counterfactual campaign: an
earlier promotion would change the reference, the tasks and later comparisons, unbought readings
have no solves, and a rewarded measure changes what the Builder aims at.

## The wall and the report

The log stays exam-side (`AGENTS.md`, sections 5 and 8): only the scripts' aggregates (counts, ids,
digests, campaign names) go in a pull request. Report in order: the trees, commits, mechanisms and
reading minutes; the reconciliation counts; recorded promotions as rightful, in doubt with reasons,
or rejected; each candidate beside the baseline on its step 5 bar, with predictions and won-by
counts; and campaigns left out, reports read from stored differences, and live counts that may move.
