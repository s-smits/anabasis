---
name: attribution-and-proof
description: "Use after a comparison or system change, and before claiming that a harness, model or patch is improved, better, fixed or a step in a PR, report or message. Establish the evaluation identities, separate outcome counts, replication, harness attribution and whether the mechanism ran. Distinguish measurement validity from whether the system used the mechanism. Produce the prescribed evidence report."
---

# Attribution and proof

Ask one question: what may we claim? State the owner first, then the count, then what the count does
not show. A summary must not outrun its evidence.

[run-improvement-campaign](../run-improvement-campaign/SKILL.md) chooses the next experiment, and
[system-path-simulation](../system-path-simulation/SKILL.md) tests a path before spend. This skill
starts after the run, and is narrower than a
[whole-run-investigation](../whole-run-investigation/SKILL.md): it reads no lanes and launches no
session. It decides the wording of a claim from what the log already holds.

## What a reading is

A v2 claim rests on a comparison: two harnesses, the same held-out tasks, solves made afresh and
interleaved, a one-sided paired sign-flip test over each task's score (`flipP`,
`src/kernel/compare.ts`). Validity weighs most; a declared objective and the bill compare two valid
answers. The null treats each untied task's sign as equally likely and independent, at its fixed
margin. `step` means one test over the frontier and the retained tasks together cleared its level,
on the tasks' scores and again on their scores without the bill (`stepOf`, since 26 October). It
does not say:

- **that the harness is better under another condition.** Another deadline, budget, solver, effort
  or host code is another condition, and no solve of one counts for the other.
- **which part of the harness did it.** A harness is presets, programs and a guide. The programs ablation
  `programs-of:<digest>` is the Starter with that harness's installed programs alone
  (`keptAs`, `tools/d2/campaign.ts`); a standalone comparison against it separates the programs from the rest.
- **that the solver designs better.** A harness that installs an engine the public rules name
  saves a solver its setup time. Under a short deadline that reads as a step.
- **that it would read so again.** One comparison is one draw.

## Rules

- **Match the identities.** Every solve has a `condition.recorded`: contract, harness, task,
  solver model and effort, compaction, limits, the host's code by content. Two solves compare
  when their conditions differ in the one thing compared. Two harnesses are set side by side by
  a standalone comparison, under one setting; rounds made apart are not a comparison (`AGENTS.md`, section 9).
- **Count no solve twice.** Solves of two rounds were made apart, each under its own hour of
  the host. Setting them side by side is a description. A pair is made by one comparison.
- **Keep the counts apart**: valid answers; rejected answers, by ruling (earned, a check defect,
  unclear); solves that ended with no answer, by how they ended; non-results (a host fault, a
  provider's end, a cap); tasks set aside for a person's label. A rate has a denominator, and
  the tasks left out of it are named beside it.
- **Keep three kinds of statement apart**: the verifier's verdict, a reviewer's finding, and a
  fact of the environment. A Referee's ruling is a model's output.
- **Say what did not run** and what could not be compared.

Take the owner from the record that produced the number, in that record's own words. Never turn a
model's causal guess into a label.

## How strong is the evidence

Use the four evidence levels in `AGENTS.md`, section 9: present in source, proved without a model,
exercised live, shown in an outcome. The last still requires a repeat on fresh solves; the promotion
rule itself requires one reading. None of the levels stands in for the next.

A replay can establish that a value is delivered while better model behaviour stays unrun. A refusal
that fired establishes its own condition and nothing about the answers.

## Is the reading more than noise

Answer these from the log before using the word step in a sentence of your own:

- **Repeated?** One reading promotes. A standalone comparison of the same two harnesses with a new `--id`
  makes a second draw on fresh solves; the same id returns the existing report. Until a later
  reading holds the step, say it is one draw at its level. Until 19 October promotion required a repeat.
- **What does the reference do against itself?** Read `noise` on the same tallied tasks, with
  halves of the reference's solves mirrored in time. It is available at any even number of solves
  per side; at two, it compares the first solve with the second (`compared`,
  `src/campaign/comparison.ts`). An A/A reading ends nothing. A step in either direction, at the
  comparison's level and with and without the bill (`readsStepEitherWay`), indicates that the two
  halves were not interchangeable. Report it beside the candidate's step.
- **How thin?** At `--level 0.02`, six untied tasks all won is the least that reads a step
  (p = 0.015625), and 5-0 (p = 0.03125) reads none. With equal pair margins, 8-1, 10-2 and
  12-3 also clear 0.02; unequal margins need `flipP`, rather than the tally alone. The retained
  tasks are in the same test, so a gain on new tasks can offset a loss on old ones: give the
  retained tally apart. An empty retained set is `unmeasured`, not evidence of no loss. A report
  written from 12 to 20 October read the frontier alone and may hold `regressed`.
- **How much power and risk?** Give `scored.detectable`, the least winning share detected four
  times in five at these margins, and `scored.falseRate`, `power(differences, 0.5, level)` (on
  `frontier` in a report written before 20 October).
  The latter is at most the level under the test's null. `sizeLines` assumes no ties and equal
  margins before a run (`src/kernel/size.ts`); the level is a per-comparison level.
  Give the campaign estimate from `riskLines` in `src/campaign/climb.ts`: it sums attempt rates,
  capped at one, across epochs. It is an estimate, not a measured bound. Its A/A error count is
  one-sided at the comparison's level, and counts only the controls that could read a step.
- **Which measure?** Give `points` beside the untied count: the points validity, the objective and
  the bill gave the tallied tasks, so a win the bill carried is named as one; a step must clear
  without the bill too. A report begun before 21 October holds `objective.decided` instead.
- **Under what load?** A deadline counts elapsed time. The reader's `HOST LOADED` and `LOAD MOVED` say
  when solve-start loads were high or moved between halves within or across comparisons. Compare
  no times across those loads.
- **At which budget?** Give the setting's model turn limit and deadline. A comparison reads the one
  budget its solver was told; it does not rescore those solves at shorter budgets. A different
  budget needs a separate setting and fresh solves (`settingAsked`, `tools/d2/setting.ts`).

## Validity and exploitation

A tally says nothing by itself of whether the exam can be passed without the work, or of whether a
solver passed it that way. Report the two apart, each with the checks and the traces it rests on.

- **Measurement validity**: `demonstrated gap`, `no gap found in the named checks`, or
  `unassessed`. What v2 runs: the checker's reading (`bun tools/c/accept.ts`), which puts each
  control answer to the checks twice and the do-nothing answer to every task; the Referee on each
  rejection that reached a check; a person's labels where `tools/d2/settle.ts` draws them,
  including its blind sample of passes. No model seat reviews a pass. An authored check stands
  on the operator's admission, by `--admit` or `--admit-authored`; a campaign launch without
  `--hitl` supplies the latter (`planOf`, `src/campaign/opening.ts`). State this coverage.
- **Exploitation**: `observed`, `not observed in the traces read`, or `unobservable`. `observed`
  needs a trace that joins something the solver was given to the accepted answer through the
  gap. Keep four things apart: an ordinary efficient solution, a checker with a gap, a way past
  it that an investigator built, and a way past it that a solver used.

Never shorten the scoped negative to "no reward hacking". A clean reading, an agreeing Referee and a
full tally do not prove an exam cannot be passed without the work. Keep an earlier tally as it was
recorded and put the qualification beside it.

## Was the mechanism live in run X?

Check in order, and stop at the first that fails. One command answers the first two:

```sh
bun run runs source <name> --holds <fix>
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
3. Read the frontier and retained tasks one by one, including their pair margins and objective decisions.
4. Look for something else that moved with it: the checker, the scored set, the limits, the
   load, the host's code.
5. Mark the attribution `proven`, `likely`, `mixed` or `unproven`.

```text
Claim:
Condition and identities:
Reference harness:
New harness:
Tally (wins, losses, ties, p, unsolved, set aside):
Each harness by itself (valid solves), at the setting's budget:
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

Use exact counts and scoped claims, naming the setting, frontier, retained reading and repeat. Where
the log does not hold the evidence, say so.

The report quotes no task's text, no answer, no hidden value, no check's failure text and no passage
of a trace. Solve ids, digests, check ids, counts and paths carry it. It reaches no Builder,
Examiner, solver or Referee.
