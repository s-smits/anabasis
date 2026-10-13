---
name: attribution-and-proof
description: "Use after an Anabasis v2 comparison, checkpoint or system change, and before any sentence claims that a harness, a model or a patch improved something. States what one reading may be said to show: the identities it was made under, the counts kept apart, whether it was repeated, which part of a harness it belongs to, whether a mechanism was live in the run, and whether the measurement is valid as distinct from whether it was exploited. Ends in one fixed report."
---

# Attribution and proof

Ask one question: what may we claim? State the owner first, then the count, then what the count
does not show. A summary must not outrun its evidence.

[run-improvement-campaign](../run-improvement-campaign/SKILL.md) chooses the next experiment, and
[system-path-simulation](../system-path-simulation/SKILL.md) tests a path before spend. This
skill starts after the run, and is narrower than a
[whole-run-investigation](../whole-run-investigation/SKILL.md): it reads no lanes and launches no
session. It decides the wording of a claim from what the log already holds.

## What a reading is

A v2 claim rests on a comparison: two harnesses, the same held-out tasks, solves made afresh and
interleaved, a sign test over tasks. `step` says that under one condition the new harness gave a
valid answer on more tasks than the reference, by more than the level allows to chance. It says
that and no more. It does not say:

- **that the harness is better under another condition.** Another wall, budget, solver, effort
  or host code is another condition, and no solve of one counts for the other. On 9 October one
  Starter passed 18 of 18 buffer solves at a two-hour wall and 5 of 14 at eight minutes.
- **which part of the harness did it.** A harness is presets, programs and a guide. The control
  `programs-of:<digest>` is the Starter with that harness's installed programs alone
  (`tools/d2/campaign.ts`); a checkpoint against it separates the programs from the rest.
- **that the solver designs better.** A harness that installs an engine the public rules name
  saves a solver its setup time. Under a short wall that reads as a step.
- **that it would read so again.** One comparison is one draw.

## Rules

- **Match the identities.** Every solve has a `condition.recorded`: contract, harness, task,
  solver model and effort, compaction, limits, the host's code by content. Two solves compare
  when their conditions differ in the one thing compared. Two harnesses are set side by side by
  a checkpoint, under one condition; rounds made apart are not compared (`AGENTS.md`, section 9,
  and `docs/simplify.md`, R1: `bun run runs compare` went on 11 October).
- **Count no solve twice.** Solves of two rounds were made apart, each under its own hour of
  the host. Setting them side by side is a description. A pair is made by one comparison.
- **Keep the counts apart**: valid answers; rejected answers, by ruling (earned, a check defect,
  unclear); solves that ended with no answer, by how they ended; non-results (a host fault, a
  provider's end, a cap); tasks set aside for a person's label. A rate has a denominator, and
  the tasks left out of it are named beside it.
- **Keep three kinds of statement apart**: the verifier's verdict, a reviewer's finding, and a
  fact of the environment. A Referee's ruling and a Diagnoser's account are a model's output.
- **Say what did not run** and what could not be compared.

Take the owner from the record that produced the number, in that record's own words. Never turn
a model's causal guess into a label.

## How strong is the evidence

Four levels, reported one by one. None stands in for the next.

1. **Present in source**: the change is in the tree at a named commit.
2. **Proved without a model**: a test, a replay of recorded logs, a rehearsal on a seed.
3. **Exercised live**: an event in a real run's log shows the mechanism did its work there.
4. **Shown in an outcome**: a reading that moved, repeated once on fresh solves.

A replay can establish that a value is delivered while better model behaviour stays unrun. A
refusal that fired establishes its own condition and nothing about the answers.

## Is the reading more than noise

Answer these from the log before using the word step in a sentence of your own:

- **Repeated?** A checkpoint of the same two harnesses on fresh solves (`--id`). The reader's
  `STEP NOT REPEATED` names a step that has none.
- **What does the reference do against itself?** The report's `noise`, which every comparison of
  four solves a side carries. A reference that wins tasks from itself sets the floor under every other tally of that hour.
- **How thin?** At `--trigger 0.25`, two untied tasks all won is the least that buys a repeat, at
  p = 0.25, and the step and its repeat together clear `--level 0.1` at 4-0 (p = 0.0625). Say the
  tally, never the word alone.
- **Under what load?** A wall counts the clock. The reader's `HOST LOADED` and `LOAD MOVED` say
  when a comparison ran on a busy host or two comparisons ran under different loads. Compare no
  times across them.
- **At which budget?** Give the reading at the full limit and at each budget fixed beforehand.
  A step at one budget alone is a statement about that budget.

## Validity and exploitation

A tally says nothing by itself of whether the exam can be passed without the work, or of
whether a solver passed it that way. Report the two apart, each with the checks and the traces it
rests on.

- **Measurement validity**: `demonstrated gap`, `no gap found in the named checks`, or
  `unassessed`. What v2 runs: the checker's reading (`bun tools/c/accept.ts`), which puts each
  control to the checks twice and the do-nothing answer to every task; the Referee on each
  rejection; a person's labels where `tools/d2/settle.ts` draws them. What it does not run: no
  role reads a pass, and a check its author's own computation decides stands on the operator's
  word (`--admit`). Say both.
- **Exploitation**: `observed`, `not observed in the traces read`, or `unobservable`. `observed`
  needs a trace that joins something the solver was given to the accepted answer through the
  gap. Keep four things apart: an ordinary efficient solution, a checker with a gap, a way past
  it that an investigator built, and a way past it that a solver used.

Never shorten the scoped negative to "no reward hacking". A clean reading, an agreeing Referee
and a full tally do not prove an exam cannot be passed without the work. Keep an earlier tally
as it was recorded and put the qualification beside it.

## Was the mechanism live in run X?

Check in order, and stop at the first that fails. One command answers the first two:

```sh
bun .claude/skills/attribution-and-proof/scripts/run-source.ts <campaign folder> --holds <fix>
```

1. **The commit.** `launch-run-<n>.json` beside the log (and `launch-<session>.json` for a round
   launched before 11 October) names the commit and whether the tree held uncommitted changes. A
   round started by hand has no receipt: the condition's host
   hash still names the code by content, and the commit is then unknown.
2. **Containment.** `--holds` asks whether the fix is an ancestor of each receipt's commit.
   After a restack the fix has another commit id; name the replayed one.
3. **The event.** Find what the mechanism writes: an event kind, a field, an ending, a refusal's
   words in the `.out`.
4. **The trigger.** An absent event shows an absent mechanism only where its trigger occurred.
   Where it did not, say the mechanism was not reached.

A stack published after the launch changes no running process.

## Procedure and report

1. State the variable that moved and check every other identity.
2. Give the counts, with what was left out of each denominator.
3. Read the tasks one by one: which changed sides between the two harnesses, and at which budget.
4. Look for something else that moved with it: the checker, the scored set, the limits, the
   load, the host's code.
5. Mark the attribution `proven`, `likely`, `mixed` or `unproven`.

```text
Claim:
Condition and identities:
Reference harness:
New harness:
Tally (wins, losses, ties, p, unsolved, set aside):
Each harness by itself (valid solves), at the full limit and each budget:
Repeat and noise:
Host load:
Non-results and what was left out:
Changed owner:
Attribution:
Proved without a model:
Validity and exploitation, with coverage:
Reviewer findings (advisory):
Unrun or provisional:
Evidence (log, event ids, commit):
```

Use exact counts and narrow claims: "valid on 14 of 14 solves where the Starter was on 5, at an
eight-minute wall, repeated once", not "made the solver better". Where the log does not hold
the evidence, say so.

The report quotes no task's text, no answer, no hidden value, no check's failure text and no
passage of a trace. Solve ids, digests, check ids, counts and paths carry it. It reaches no
Builder, Examiner, Referee or Diagnoser.
