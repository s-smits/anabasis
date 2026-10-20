---
name: promotion-tuner
description: "Replay recorded promotions through a tree's own rule without models or spend. Read which promotions the rule supports, what unsuccessful attempts missed by, their A/A controls, and hours and dollars per promotion. Compare a baseline and a candidate that changes one rule."
---

# Promotion tuner

Since 19 October one comparison that reads `step` promotes. This skill asks whether a tree's
rule supports the recorded promotions and how a candidate rule reads the same solves. The
comparison and the limits on claims belong to `AGENTS.md`, sections 7 and 9. A replay starts
no solve, calls no model and writes nothing of a campaign's.

## The command

```sh
bun .claude/skills/promotion-tuner/scripts/replay.ts --tree <worktree> \
  [--logs <dir>] [--since <date>] [--name <campaign>]... [--margin <n>] [--level <n>] [--totals]
```

- `--tree` names the worktree whose kernel reads the record. The totals name its commit and
  whether `src/` has uncommitted changes.
- The logs are `<logs>/<worktree>/.ana/d2/<name>/log.jsonl`. By default `--logs` is the parent of
  the repository's main checkout. The largest copy of each campaign name is read. Seeds with
  `seed.json`, names beginning `sim-`, `rh-` or `test-`, and rehearsals with a `faux/` seat or
  solver are left out (`campaignLogs`, `rehearsed` in `scripts/tree.ts`).
- `--since` selects campaigns whose last event is at or after the date, five days back by
  default. Repeated `--name` selects named campaigns regardless of date.
- `--level` replaces the recorded level for promotions and A/A controls.
- `--margin` is for trees whose pairs still carry an objective margin. The current tree has
  none and ignores it; the totals count affected readings where an objective has no margin.
- `--totals` prints only the totals.

Live logs grow. Read the baseline and candidate close together and record the minute of each.

The script imports the selected tree's `read`, `lastReports`, `pairsReported`, `pairsOf`,
`pairings`, `flipP`, `stepOf`, `billedBetween` and `BILLED`. Current `lastReports` excludes old
ladder reports. Old event fields remain readable, as `AGENTS.md` section 5, habit 4 requires.

The rule is feature-detected (`loadTree`): `promotes(reports, level)` where exported, otherwise
`readTwice(reports, level, trigger)` on trees that retain it, otherwise the latest report's
`stepOf` reading. Until 19 October a trigger bought a repeat and the two readings were joined.
`attemptsOf` with `triggered` groups those older attempts; without both exports, each reading is
one attempt. The recorded trigger is used only by trees that read it, with 0.25 as its fallback;
the level falls back to 0.02 where the comparison's start records none.

## What to read

For each pair of harnesses, old digest first, the script prints:

- The first point at which the selected rule promotes, the readings it rests on, their
  `W-L-T` tallies and p values. For an older two-stage rule it also prints `joined`: each named
  task counted once, with its differences summed.
- `rightful` for a recorded promotion the rule supports with neither an A/A step nor a later
  reading that lost more tasks than it won; `in doubt` with those reasons; or `added by this
  rule` for a pair the campaign did not promote. Inspect the A/A and later readings beside an
  added pair too.
- Each unsuccessful attempt and its shortfall. The current rule reports a scored set, frontier
  and retained tasks read in one test, short of its level; a tree of 12 to 20 October may also
  report retained tasks that regressed. Older two-stage trees report whether a repeat
  was bought, whether it was taken, and whether the joined reading cleared the level.
  `NOT PROMOTED by this rule` marks a recorded promotion the selected rule rejects.
- The untied frontier tasks won in every pairing, won in some, and lost. This count changes
  no decision.
- Each promoted epoch and the open epoch: hours and billed dollars, split into Examiner,
  comparisons and Builder time (`scripts/time.ts`).

The totals count recorded promotions, pairs the rule promotes, readings, A/A controls, readings
that cleared the level alone and their later readings, and the median and range of promoted
epochs' hours and dollars. A report without a frontier cannot be replayed as a promotion.

**Read the two reconciliation counts first:** frontier readings and A/A controls that read
otherwise than stored. At the tree and terms that wrote a report both should be zero. A
difference must be explained by the candidate change or a replay defect. Under `--margin` the
frontier count says how many readings the margin moved; the A/A reconciliation is printed only
at the recorded margin.

An A/A is the reference against itself on mirrored halves of its solves (`pairsOf` with
`halves: "mirrored"`). It is available at four or more solves per side, with an even count.
The script tests either direction at half the level, as `controlled` in `src/builder/decide.ts`
does for the epoch's control. An A/A step is false by construction.

`rightful` means the recorded solves support the promotion under the selected rule. It cannot
detect a lucky draw; the A/A, the false-promotion estimate and a later fresh reading provide
other evidence (`AGENTS.md`, factor 2). Name the rule when only one rule supports a promotion.

## Tuning the rule

The level is the operator's condition. A change to the measuring rule is no harness gain.

1. Run the baseline on `main`'s tree, both whole and with `--totals`, into the scratchpad.
2. Sweep `--level` first where that answers the question. `--margin` can compare older trees
   that still read it. A code change gets its own worktree from `origin/main`, following
   [stack-pr](../stack-pr/SKILL.md), and changes one thing: for example `stepOf` or the pairing
   of valid answers. A candidate can export `promotes(reports, level)` for another rule.
3. Run the same table on the candidate close to the baseline reading.
4. Accept a candidate only where promotions rise or hours per promotion fall, no recorded A/A
   reads a step at its terms, and no added promotion is contradicted by a later reading of its
   pair. Count added promotions whose pair has no later reading as untested.
5. Deliver both tables in the pull request as counts, with both reconciliation counts explained.
6. Confirm live only on the operator's word, with a fresh campaign from a prompt at the
   candidate's commit and a prediction recorded before the first solve (`AGENTS.md`, section
   10, item 9). Continuing a campaign at another commit measures no climb.

Limits of the replay:

- An earlier promotion would change the reference, the Examiner's tasks and later comparisons.
  The replay reads pairs on the recorded path, not a campaign under the candidate.
- A reading never bought has no solves to replay.
- Reports before 14 October may name no task: their stored differences stand and a margin
  cannot move them. Reports before 12 October hold no frontier and are left unread.
- In a led campaign, Examiner sessions and comparisons run inside the Builder conversation.
  `Builder alone` subtracts their union; `neither` is time outside all three. A Builder session
  across a promotion bills where it ends. `billedBetween` also meters unfinished work, so the
  script prints the tree's sum less the parts to expose any difference.

## The wall and the result

Keep the log on the exam side (`AGENTS.md`, sections 5 and 8). The script prints counts,
session ids, short digests and campaign names, never task contents, answers, measures or checks.
Only those aggregate results belong in a pull request or this skill.

Report, in order:

1. Both trees, their commits and the minute each was read.
2. Both reconciliation counts on each tree.
3. Recorded promotions: rightful, in doubt with reasons, and rejected by the selected rule.
4. Candidate totals beside the baseline, with each condition of tuning step 4 and its count.
5. Campaigns left out, reports read from stored differences, and live counts that may move.
