---
name: examiner-complexity
description: "Tune the ambition of the Examiner's exam: the reach scale and worked examples (src/examiner/ladder.ts), the drafting prompt (src/examiner/draft.ts) and the writing prompt's \"How hard\" (src/examiner/prompt.ts), so tasks leave the reference room and stay answerable. Scripts grade the record blind (grades.ts), re-rate example rungs (rungs.ts), list drafts with the gate's reading (exams.ts) and read admissions and time to first comparison (ambition.ts); edits go through paired live seats and fresh campaigns. Use when the operator asks whether tasks are hard enough, to tune the ladder or an example, to calibrate easy to very hard, or whether an exam change raised supply."
---

# Examiner complexity

A comparison has power only on tasks the reference answers sometimes, so an exam always solved, or
never, carries no gradient. The Examiner chooses each task (`AGENTS.md`, section 2); this skill
tunes only what it is told about difficulty: a reach scale, worked examples from fields no campaign
examines, and facts about the reference. It edits text, never a task or check (rule 2), and states
facts rather than a share to reach. Paired seats are `system-path-simulation`'s
(`cases/optimize.md`) and the scale is lane 27 of `whole-run-investigation`.

## 1. Calibrate the record

A grader who sees only each task's public input and rules writes `task<TAB>grade` on the scale
(`GRADES`, `src/examiner/ladder.ts`):

```sh
bun .claude/skills/examiner-complexity/scripts/grades.ts <grades.tsv> <campaign folder>...
```

It prints, per grade, valid solves, tasks always valid and median turns. The highest grade the
reference always clears in few turns is the ceiling the exam must pass.

## 2. Diagnose where a solver stops

A solver with a shell scripts every case, so a task gets harder only in one of the ladder's three
places: a local search from the obvious start finds the wrong basin; the convenient model departs
from the deciding engine near the specification; or the specification sits within tolerance of a
theoretical bound. Read the drafted exam (`draft.finished`) for which place the domain offers.
Rules that restate the field's equations cap tasks near grade 2, as a frozen exam does, so seat a
ladder edit only where the exam is open.

```sh
bun .claude/skills/examiner-complexity/scripts/exams.ts [--every] <campaign folder>... > exams.csv
```

gives one row per family and session (`--every`: per draft): drafts held and refused, refusals at
the ceiling (`noroom`), drafts never answered, proved answers, input length and title. Look for
movement off the ceiling and for change in kind rather than length. A ladder pitched too high
starves supply instead, with refusals until the budget is gone; check for that before rewriting
examples again.

## 3. Edit the owner

| What | Owner |
| --- | --- |
| scale, worked fields, three places | `src/examiner/ladder.ts` (`GRADES`, `FIELDS`, `SOLVER`; writing reads `LADDER`, drafting `REACH`) |
| how hard an exam can be, how rules are stated | `src/examiner/draft.ts` |
| writing above the reference's grade | `src/examiner/prompt.ts`, "How hard" |

`test/examiner-ladder.test.ts` holds the scale to lane 27, keeps examined domains out of the
examples and checks both modes see the ladder. Rewrite rather than add (rule 13), with each edit's
reason in the module's head comment.

Overhaul an example on a blind re-rating, never its author's grade:

```sh
bun .claude/skills/examiner-complexity/scripts/rungs.ts packet > <packet.md>
bun .claude/skills/examiner-complexity/scripts/rungs.ts compare <rungs.tsv>...
```

At least two graders who have read neither the ladder nor this conversation grade the packet as
`id<TAB>grade<TAB>place` and say whether the stated engine alone decides an answer. `compare` flags
rungs whose median is `below` their grade or `flat` against the previous one. Rewrite flagged and
undecidable rungs, then re-grade with fresh graders, since a flagging grader is coached by the
rewrite. Replace a field that does not climb with one outside every examined domain.

## 4. Compose, then seat

Each edit to a composed prompt is a new arm. Diff the arms with `live-seat.ts prompt`
(`cases/optimize.md` step 4) before paying, then, on the operator's word, run paired live seats per
steps 5 to 8: one login and host, a writing position only where the exam offers a place, read with
`pairs` at equal admissions, with `--reviewer` and `--reviewer-effort` as the source campaign had.

## 5. Read a fresh pair to its first comparison

```sh
bun .claude/skills/comparison-reading/scripts/reading.ts --zone <log or campaign name>...
```

prints per comparison the reference's tasks with no, some and every solve valid, the untied tasks
on validity and on the objective, and the A/A's untied share. With the reference always valid, an
untied share near the A/A's is noise. No seat reads it.

Only fresh campaigns show whether supply rose (`AGENTS.md`, section 10, item 9). On the operator's
word, launch control and arm together with `runs fresh ... --at <commit>`, one domain, one login,
one host class, predictions on record first:

```sh
bun .claude/skills/examiner-complexity/scripts/ambition.ts <control folder> <arm folder>
```

It prints hours, solves and dollars to the first `comparison.started` and `harness.promoted`, and
per Examiner session the reference in force, drafts held, admission words (`every`, `some`,
`none, proved`) and dollars. Read in order: the arm received its text, the share reading `every`,
drafts held, answerability, time to first comparison.

## 6. What may be claimed

A seat round is two draws and a lead (rule 6); a fresh pair is one campaign an arm. "The exam is
harder" needs blind grades above the control's joined to outcomes by `grades.ts`. "Supply rose"
needs a higher held share and earlier first comparison on fresh campaigns, repeated in a second
domain. Neither says a harness improved (rule 1), and login waits are not the system's time
(rule 15).
