---
name: examiner-complexity
description: "Tune the ambition of the Examiner's exam: the reach scale and worked examples it is shown (src/examiner/ladder.ts), the drafting prompt's rules on how hard an exam can be (src/examiner/draft.ts) and the writing prompt's \"How hard\" (src/examiner/prompt.ts), so that drafted tasks leave the reference room for a good reason and stay answerable. Calibrates the record with blind reach grades against the reference's outcomes (grades.ts), re-rates each worked example's rungs blind against their stated grades so that a rung can be overhauled (rungs.ts), lists every draft an Examiner wrote beside the gate's reading of it as a CSV (exams.ts), reads each Examiner session's admissions and a campaign's time to its first comparison and promotion (ambition.ts), and runs the edit through paired live seats and a pair of fresh campaigns. Use when the operator asks whether the queries or tasks are hard enough, to tune the ladder or overhaul one of its examples, to calibrate easy to very hard, or to read whether an exam change raised supply."
---

# Examiner complexity

An exam the reference answers on every solve measures nothing, and one nobody can answer measures
nothing either. The Examiner decides what each task asks (`AGENTS.md`, section 2); what code and
this skill own is what the Examiner is told about difficulty: one scale, worked examples from
fields no campaign examines, and the facts of what the reference did. The goal is the ambition at
which tasks leave the reference room through method rather than chance, so that supply reaches a
comparison and the exam keeps moving after each promotion.

The procedure tunes text the Examiner reads, never a task, rule or check (rule 2), and states facts,
never a count or share to reach (section 2, consequence 2). `system-path-simulation`
(`cases/optimize.md`) owns the paired seats, `run-management` the launches, and
`whole-run-investigation` lane 34 the reach scale this skill grades on.

## 1. Calibrate the record

Before any edit, grade what the reference already answers. A grader reads each scored or held
task's public input and the public rules alone (never hidden values, checks or outcomes) and
writes `task<TAB>grade` on lane 34's scale (`GRADES`, `src/examiner/ladder.ts`). Then:

```sh
bun .claude/skills/examiner-complexity/scripts/grades.ts <grades.tsv> <campaign folder>...
```

prints, by grade, the tasks, the solves valid out of those with a result, the tasks valid on every
solve and the median turns. The grade at which the reference is valid on every solve in a few turns
is the ceiling the exam has to climb past. On 31 October, 1,438 of 1,465 solves of buffer, job and
esp32 tasks graded 2 to 5 were valid, at a median of 3 to 5 turns, so a solver with a shell sits
two grades above what the scale's words alone suggest; the ladder was re-rated on that record.

## 2. Diagnose where a solver stops

A capable solver with a shell scripts every case and checks itself, so a task climbs only by moving
into one of three places (the ladder's closing paragraph): a local search from the obvious start
lands in the wrong basin; the convenient model differs, near the specification, from the engine
that decides; or the specification sits within a tolerance of a theoretical bound. Read the drafted
exam (`draft.finished`, the brief) and the session's proposals for which of these the domain offers
and whether the rules hand the solver the whole model. Rules that restate the field's tables and
equations cap every task at grade 2 however the tasks are written; on 31 October both esp32 arms
drafted such rules, and their examples passed 9 of 9 solves at 3 turns. A frozen exam caps reach the
same way, so a ladder edit is seated only where the exam is still open (section 4): on the esp32
wiring-plan seed, both ladders held none of 10 or more drafts at a writing position, while the
drafts grew only in device count.

Whether the ladder's words reached the drafts is read from the drafts themselves, beside what the
gate made of each:

```sh
bun .claude/skills/examiner-complexity/scripts/exams.ts [--every] <campaign folder>... > exams.csv
```

writes one row a family a session, in the campaign's order (`--every`: one a draft): the drafts,
how many the gate held and refused, how many of the refusals had the reference valid in every room
solve (`noroom`, the ceiling) and how many drafts it answered in none, the author's proved answers,
the public input's median length and a title. Read down a campaign for whether later sessions moved
off the ceiling, and across arms for whether one ladder's drafts differ in kind or only in length.
The drafted exam's own examples (`ex-001` on) are not rows, since their proposals hold no content.

A ladder pitched too high shows as starved supply, not as bad tasks: refusals until the budget is
gone, and no comparison to say what the exam was worth. On 31 October the first ladder's esp32 arm
held 1 of 89 session drafts over 12 hours and $79, every refusal at the ceiling, its drafts about
40% longer than the control's from the first session and no longer after; the control held 17 of 80
and compared twice, its 59 refusals at the ceiling too, and neither wrote a draft the reference
failed on every solve. A longer draft the reference still answers every time is the ladder reaching
size and not method. An arm with no comparison by its domain's median first promotion
(`promotion-tuner`: 9.8 h for buffer, 13.0 h for esp32) is read for starvation before its examples
are rewritten again.

## 3. Edit the owner

| What | Owner |
| --- | --- |
| The scale, the worked fields and the three places | `src/examiner/ladder.ts` (`GRADES`, `FIELDS`, `SOLVER`) |
| How hard an exam can be, how a rule is stated | `src/examiner/draft.ts`, the drafting system prompt |
| Writing above the reference's grade | `src/examiner/prompt.ts`, "How hard" |

`test/examiner-ladder.test.ts` holds the scale to lane 34's words, keeps every examined domain and
its neighbours out of the examples, and checks both modes are shown the ladder. Each rung names the
place it sits in; a rung that is a closed form, a search over a few variables or a finite list of
cases is grade 2 for this solver whatever its words. Rewrite rather than add a sentence (rule 13),
and record each edit's reason and count in the module's head comment.

Each worked example is overhauled on a blind re-rating of its rungs, never on its author's grade:

```sh
bun .claude/skills/examiner-complexity/scripts/rungs.ts packet > <packet.md>
bun .claude/skills/examiner-complexity/scripts/rungs.ts compare <rungs.tsv>...
```

`packet` prints the scale, who the grades are for and every rung with its grade removed, one id a
rung (`<field>.<rung>`). Hand it to two graders or more that have not read the ladder or this
conversation, each writing `id<TAB>grade<TAB>place` and saying whether a verifier could decide an
answer from the stated engine alone. `compare` sets their grades beside the stated one and flags
each rung whose median is `below` its grade or `flat` against the rung before; on 31 October two
graders agreed exactly on 13 of 18 rungs and within one on the rest, so one grader is a lead.
Rewrite a flagged rung inside the place the graders named, or move it into one, and fix every rung
a grader could not decide: a bound or optimum the contract does not state as a number, or a
measure that turns on a convention it leaves open. Then grade the new packet with fresh graders,
since a rewrite read by the grader that flagged it is coached. A field whose rungs do not climb is
replaced with another field outside every examined domain, which the test enforces.

## 4. Compose, then seat

Every edit that changes a composed prompt is a new arm. Diff the two arms' prompts with
`live-seat.ts prompt` (`system-path-simulation`, `cases/optimize.md` step 4) before paying, at a
writing position and, for `draft.ts`, at an opening. Then run paired live seats from seeds as
`cases/optimize.md` steps 5 to 8 lay out: an opening, and a writing position only on a seed whose
exam offers one of the three places (section 2), on one login and host, read with `pairs` at equal
task admissions against two draws of one commit.
A paid seat names `--reviewer` and `--reviewer-effort` as its source campaign did.

## 5. Read a fresh pair to its first comparison

Seats read one session after a cut. Whether an exam change raises supply, and holds across a
promotion, only a fresh campaign at its commit shows (`AGENTS.md`, section 10, item 9). Launch the
control and the arm together, one domain, one login, the same host class, on the operator's word
(`runs fresh ... --at <commit>`), and read them side by side as they go:

```sh
bun .claude/skills/examiner-complexity/scripts/ambition.ts <control folder> <arm folder>
```

prints what each campaign had spent by its first `comparison.started` and `harness.promoted`, in
hours, solves and dollars, since a host's load moves only the hours, and one line per Examiner
session: the reference in force, drafts held of those admitted, the admission words
(`every`, `some`, `none, proved`), the median turns of the reference's valid room solves and the
dollars. Read in this order: whether each arm's sessions received their text, the share of
admissions reading `every` (the ceiling), the drafts held, answerability (the author's answer or a
valid solve on record), then the steps to the first comparison and promotion. Put the predictions
on record before the first solve, and settle each by its count.

## 6. What may be claimed

A seat round is two draws and a lead (rule 6). A fresh pair is one campaign an arm. "The exam is
harder" needs blind grades of the held tasks above the control's, joined to the reference's outcomes
by `grades.ts`: on 31 October two graders put the first ladder's esp32 drafts a grade above the
control's while the reference answered 28 of 29 solves of its 5s and 6s at 3 turns. "Supply rose"
needs the arm's held share and its first comparison ahead of the control's on fresh campaigns,
repeated in a second domain; neither says a harness got better, which only a comparison reads (rule 1). Keep counts with
their denominators and the logins' waits apart from the system's time (rule 15).
