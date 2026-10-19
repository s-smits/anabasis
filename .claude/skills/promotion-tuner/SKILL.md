---
name: promotion-tuner
description: "Read every promotion on record in Anabasis v2 again through one tree's own rule, from the recorded solves, with no model and no spend: whether each promotion is rightful (the rule still promotes it, the A/A beside its comparisons read no step, no later reading of the pair went against it), what each attempt that fell short missed by, and how many hours and dollars each promotion took. Then tune the promotion rule or the pairing under it (the objective margin, the trigger, the two-stage reading) by running the same table on main's tree and on a candidate branch that changes one thing. Use when the operator asks whether the promotions were deserved, why an attempt did not promote, how fast the climb went, or whether another margin, level or rule would have promoted more without promoting noise."
---

# Promotion tuner

A promotion is one step of the climb: a harness that beat the reference on held-out tasks twice,
on fresh solves (`AGENTS.md`, factor 1 and section 7). This skill reads the promotions already on
record and asks two questions of them. Was each one rightful, and would another rule have read
the same record better? It answers from the logs alone. It starts no solve, calls no model, spends
nothing and writes nothing of a campaign's.

The replay goes through a tree's own code. `--tree` names a worktree, and the script imports that
tree's `src/kernel/log.ts` (`read`), `src/kernel/reports.ts` (`lastReports`, `pairsReported`,
`billedBetween`, `BILLED`) and `src/kernel/compare.ts` (`pairings`, `flipP`, `stepOf`,
`triggered`, `attemptsOf`, `pairsOf`, and its promotion rule). So one script reads the same record
under two rules, and the two tables differ in what the two trees differ in.

## The command

```sh
bun .claude/skills/promotion-tuner/scripts/replay.ts --tree <worktree>
  [--logs <dir>] [--since <date>] [--name <campaign>]... [--margin <n>] [--level <n>] [--totals]
```

- `--tree`: the worktree whose kernel reads the record, `main`'s or a candidate's. The header of
  the totals names its commit, and says where its `src` holds changes no commit has.
- The logs are every `<logs>/<worktree>/.ana/d2/<name>/log.jsonl`, `<logs>` being the folder that
  holds the repository's main checkout unless `--logs` names another. One log a campaign name is
  read, the largest where copies of one name sit in several worktrees. Seeds (`seed.json` beside
  the log), names that start `sim-`, `rh-` or `test-`, and rehearsals (a seat or the solver
  `faux/script`) are left out.
- `--since`: campaigns whose last event is at or after the date; five days back by default.
  `--name` reads the campaigns named, whenever they ran, and may be repeated.
- `--margin`: every objective read at that margin, where the tree's pairs carry one. A tree whose
  pairs carry no margin ignores it, and the totals say in how many readings.
- `--level`: every promotion and A/A read at that level in place of the recorded one. The
  trigger is always the recorded one.
- `--totals`: the totals alone.

It reads a live campaign's log as it stands. Three campaigns ran while the first record below was
read, and their counts grow from one run of the script to the next: read both trees in one
minute, and say when.

The promotion rule is feature-detected. Where the tree's `compare.ts` exports `promotes`, it is
called as `promotes(reports, level)`; otherwise `readTwice(reports, level, trigger)`, with the
level and trigger each comparison started under (`comparison.started`; 0.02 and 0.25 where it
names none). A candidate that changes the rule's shape exports `promotes` and is read the same
way. A candidate whose `attemptsOf` or `triggered` is gone is read one reading an attempt, and one that
exports neither `promotes` nor `readTwice` promotes a pair whose latest reading `stepOf` calls a
step.

## What it prints

For each campaign, each pair of harnesses it compared, by short digest, old first:

- **A pair the rule promotes**: the readings the promotion rests on (the last attempt up to the
  first reading at which the rule says yes), each as `session W-L-T p`, and the two read together
  (`joined`: a task both scored counted once, its differences summed, as the rule reads them).
  Then its status, the A/A of those comparisons, how many of its untied frontier tasks it won in
  every pairing of solves and how many in some, and every later reading of the same pair.
- **Its status**: `rightful` where the campaign promoted it and nothing below casts doubt;
  `in doubt` with the reasons; `added by this rule` where the campaign did not promote it and the
  tree's rule does.
- **A pair the rule does not promote**: each attempt, and what it missed by: `bought no repeat`
  (the first reading did not clear the trigger), `its repeat is owed and not read`, `short of
  <level>` with the joined tally and its p, or `clears <level> together, and the rule refuses it on
  its other terms` (the repeat untied nothing, lost more than it won, or the retained tasks
  regressed). `NOT PROMOTED by this rule` marks one the campaign did promote.
- **Each epoch** that ended in a promotion, and the one open since: its hours and billed dollars,
  split into the Examiner's sessions, the comparisons and the Builder's own time, with each
  session's and each comparison's hours (`scripts/time.ts` says how each is read).

The totals, over every campaign read:

| line | what it counts |
| --- | --- |
| promotions on record | `harness.promoted` events: replayed by the rule, rightful, not promoted by it, and those whose pair has no reading with a frontier (reports before 12 October hold a pooled tally, which no rule reads) |
| pairs this rule promotes | the rule's own count, those the campaigns did not promote among them; and the pairs with any one reading at the level, the count a rule with no repeat would reach |
| readings | comparisons with a frontier; how many read otherwise than their stored differences; frontier tasks kept at their stored difference for want of a pair (reports before 14 October name no task) |
| A/A controls | comparisons at four solves a side or more, even: how many read a step, two-sided at half the level, and their untied tasks won and lost |
| cleared the level alone | readings that cleared the level by themselves, how many were followed by a reading of the same pair, and of those how many won at least as many tasks as they lost |
| per promotion | median and range of the hours and dollars of the epochs that ended in a promotion |

**Read the two checks first.** On the tree that wrote the reports and at the recorded terms,
"read otherwise than stored" is 0 for the frontiers and for the A/A. Anything else means the tree
reads the record otherwise than the campaign did: either the change under test (expected, and
the point of the run) or a fault in the replay. Under `--margin` the frontier count is the
number of readings the margin moved.

## Rightful

A promotion on record is **rightful** when three things hold:

1. The tree's own rule, asked of the pair's readings with their differences read again from the
   recorded solves, promotes it.
2. No A/A of the comparisons it rests on reads a step. The A/A is the reference read against
   itself on halves of its own solves, mirrored in time (`pairsOf` with `halves: "mirrored"`,
   `fresh` the reference, half the solves a side), as the comparison's report reads it, and it is
   read two-sided at half the level, as the epoch's control is (`controlled`,
   `src/builder/decide.ts`). A step there is false by construction and says the comparison moved,
   not a harness.
3. No later reading of the same pair lost more tasks than it won.

The share of untied tasks won in every pairing is printed beside it and decides nothing: a task
won in some pairings is still won.

Rightful says the record supports the promotion under that rule. It does not re-solve anything:
it reads the same solves the campaign read, so it cannot catch a draw that was lucky on both
stages. That is what the A/A and the false-promotion estimate are for (`AGENTS.md`, factor 2), and
what a later reading of the pair would show. A promotion that only one rule calls rightful is
named with the rule.

## Tuning the rule

The promotion rule, the margin that decides a pair of valid answers, and the trigger are code and
terms; the level is the operator's (`AGENTS.md`, section 3, and run-improvement-campaign). A
change of instrument is no climb: a promotion a looser rule adds is not a harness's gain, and the
counts below are of the record, not of what a campaign under the candidate would have done.

1. **Baseline.** Run the script on `main`'s tree, `--totals` and whole, into the scratchpad.
2. **A candidate is one branch that changes one thing**, in its own worktree from `origin/main`
   ([stack-pr](../stack-pr/SKILL.md)): the default margin, the trigger, how a repeat joins its
   first stage, or a rule of its own exported as `promotes(reports, level)`. A flag sweep
   (`--margin`, `--level`) on `main`'s tree comes first, since it needs no branch; a branch is for
   what no flag reaches.
3. **The same table on the candidate**, in the same minute as the baseline, since live logs grow.
4. **Accept the candidate only where all three hold**: promotions rise or the hours per promotion
   fall; the A/A reads no step at the candidate's terms in any recorded control; and no promotion
   it adds is contradicted by a later reading of its pair. A candidate that adds promotions on
   pairs whose readings were never repeated has added untested promotions: say how many.
5. **Deliver** the candidate as a pull request carrying both tables, as counts only (the wall,
   below), with the two checks of "What it prints" read on each.
6. **Confirm live** with a fresh campaign from a prompt at the candidate's commit, on the
   operator's word (`AGENTS.md`, section 10, item 9), with its prediction on record before the
   first solve. A campaign continued at the candidate's commit counts for nothing.

What a replay cannot say:

- **What a campaign under the candidate would have done.** A promotion it reads earlier changes
  the reference, the tasks the Examiner then writes and every comparison after it. The replay
  counts pairs on the recorded path.
- **What the record never measured.** A repeat the campaign never bought has no solves to read,
  so a rule that needs fewer readings is read on readings bought under the rule that needed more.
- **Readings before 14 October** name no task, so their differences are read as stored and a
  margin does not move them; reports before 12 October hold no frontier and are not read.
- **Hours overlap.** In a campaign its Builder leads, Examiner sessions and comparisons run
  inside the Builder's conversation, so "Builder alone" is its sessions less the other two, and
  "neither" is the host's time between moves. A Builder session open across a promotion bills
  where it ends, and the tree's `billedBetween` bills one open at an epoch's end by what it had
  metered: "the tree's sum less the parts" carries that difference between epochs.

## The first record, 19 October

Read at 19:57 on 19 October with this worktree at f42c4866, `main`, and with `ana-closed` at
f3418f3f, whose supply rule differs and whose promotion rule does not; the two read every count
below alike. The default window, the five days before, held 18 campaigns, 11 with a reading,
38 readings and 11 promotions on record.

- **Every promotion on record is rightful** under today's rule at the recorded terms: 11 of 11
  replayed, no A/A step in their comparisons, no later reading of a pair that lost more than it
  won. The rule adds one: buffer-171-opus's g-1 7-0-3 and g-2 12-0-0, joined 18-0-2, which that
  campaign did not promote at the code it ran.
- **The margin.** Pairs the rule promotes: 12 at the recorded margins and at 0.01, 14 at 0.001
  and at 0. Pairs with one reading at the level: 13 at 0.01, 14 at 0.001, 17 at 0. A level of
  0.05 in place of 0.02 adds no promotion at 0.01, and 0.10 adds one there (13) and none at 0;
  pairs with one reading at the level rise to 15 (0.05 at 0.01), 16 (0.10 at 0.01) and 18
  (0.10 at 0).
- **The A/A held at every margin.** 0 steps in 38 controls at the recorded margins, 0.01, 0.001
  and 0; at 0 the reference against itself won 140 untied tasks and lost 139. At a level of 0.10
  one control reads a step two-sided at 0.05, beside buffer-fresh-opus-forkedPR223_v0_5_4-r2's
  promotion (g-2's A/A, 12-6-6), which is then in doubt.
- **The repeat has never gone against a reading that cleared the level alone.** Over every
  campaign since 1 October (79 read, 13 with a reading), 24 readings cleared the level alone, 11
  were followed by a reading of the same pair, and 11 of 11 won at least as many tasks as they
  lost.
- **What a promotion took.** Per promoted epoch in the default window: a median of 14.6 hours,
  6.1 to 30.7, and of $137, $33 to $184. In buffer-fresh-opus-forkedPR223_v0_5_4-r2 and -r3 a
  promotion took 6.1 to 7.3 hours: an Examiner session of 1.9 to 3.6 hours and two or three
  comparisons of 0.8 to 2.4 hours each, after first readings of 23-0-1, 15-0-1 and 8-0-1.
  In -r2 the next attempt read 4-0-20 and 4-0-6, joined 4-0-26, p 0.0625 against 0.02: two untied
  tasks short of the six a step at 0.02 takes when all are won.

The prototypes these numbers were first read with on the same day counted 14 pairs promoted at
0.01 and 15 at 0, and 35 controls; this script reads 12, 14 and 38 on the same logs. A rerun of
the margin prototype on the same day read 12 and 13, so the 14 and 15 do not reproduce with
either. Of the three controls more, one is a comparison the A/A prototype stopped on, and two
reported after the prototypes ran.

## The wall

The logs hold hidden values and the checks' verdicts (`AGENTS.md`, section 5). The script prints
counts, session ids, short digests and campaign names, and never a task, an answer, a measure of
a task, or a check's name or output. Nothing from a log goes into a pull request, a commit or this
file beyond such counts. Read a log only through a tree's readers or read-only `jq`, and never
edit, move or commit anything under `.ana/`.

## The result

End with these, in this order:

1. The trees read, each with its commit, and the minute both were read.
2. The two checks of "What it prints" on each tree.
3. The promotions on record: rightful, in doubt (with the reason), not promoted.
4. For a candidate, the totals side by side and the three conditions of step 4 of "Tuning the
   rule", each held or not with its count.
5. What was not read: campaigns left out, readings before 14 October read as stored, and the live
   campaigns whose counts will move.
