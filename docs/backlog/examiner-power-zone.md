# Examiner tasks in the reference's power zone

Status: planned, and the target of 5 November. In source: the zigzag (every new task is solved
afresh by the older harness too), `try_reference` (on `main` from 4 November, 21:18), the 0 to 7
reach ladder (#551), the package gate (#552), the drafting prompt that asks for an objective or a
reason for none (`e7e8f2ba8`, 4 November, 16:23) and the one that keeps what a task was built from
hidden (`c549fadc3`, 5 November, in the stack, not yet on `main`). None of the runs read below had
any of the last three: every jobstat run opened between 4 November, 03:22 and 15:56.

## The question

A comparison can read a step only on tasks it leaves untied, and with 2 solves a side a task is
most likely to untie where the reference passes it some of the time. Every campaign on record sits
at the easy end, where the reference answers almost every task on every solve and the test has no
sample. jobstat is already there at its first comparison, before any promotion. How does the system
keep the reference's per-task pass rate in the zone where a better harness can show, without
handing any model a number to aim at?

## What the record shows (5 November)

The power curve, from a simulation of 2 November: 24 frontier and 8 retained tasks, 2 solves a
side, level 0.02, a candidate one log-odds unit better. The chance of a step by the reference's
pass rate:

| reference passes | 2% | 10% | 30% | 50% | 85% | 95% |
| --- | --- | --- | --- | --- | --- | --- |
| chance of a step | 3.5% | 29% | 53% | 52% | 19% | 3% |

Between equal harnesses it never exceeds 1.2%. 4 solves a side about double the chance at the hard
end.

The 23 comparisons behind the release figures, read per task from each report (`pairsReported`,
`pointsOf`): a task is untied on validity where the validity points differ, on the objective alone
where only those differ.

| pack | comparisons | tasks scored | reference valid share | untied on validity | untied on the objective alone | tied |
| --- | --- | --- | --- | --- | --- | --- |
| jobstat, 6 runs at PR595 to PR608 | 12, all before a promotion | 194 | 0.88 to 1.00, 9 of 12 at 1.00 | 2 | 0 | 192 |
| buffer, 4 runs at PR588 to PR595 | 9 | 110 | 0.63 to 1.00 | 26 | 67 | 17 |
| truss, 1 run at PR588 | 2 | 13 | 0.67 and 0.79 | 5 | 8 | 0 |

The archive agrees. Of 1,699 ties in candidate comparisons, 1,686 had both sides valid in every
solve and 6 had both fail in every solve. Over 244 Builder comparisons in 72 campaigns, the
reference was valid in 84% of solves before the first promotion, 96% after it and 99% after the
second.

### The culprits

Each with its owner. A cause is confirmed where it was counted here, plausible where it rests on
one reading. They are listed by how much of jobstat's ceiling each can explain.

1. **The drafted exam handed the solver the method** (confirmed, fixed in source, unmeasured). The
   jobstat exams declared an objective in 0 of 17 puts; each convention named a data defect's
   repair and each task's input named every step, and one program answered 43 of 43 solves
   (PR600 turns6, g-1). All 7 jobstat drafts published every planted defect with its repair,
   because the drafting prompt said nothing a solver needs is hidden. A rule, convention or input
   that states the whole method caps every task the exam allows, however the tasks are written
   (examiner-complexity, section 2). Owner: `src/examiner/draft.ts`. `e7e8f2ba8` now makes a draft
   give an objective or its reason for none, and `c549fadc3` rests validity on `FAIR` alone; no
   jobstat exam has been drafted under either.
2. **No objective that separates answers** (confirmed). jobstat declares none, so two valid answers
   always tie. jobstath2 declared one and it saturated: 243 of 265 passing verdicts measured exactly
   1 (#622). Across exams drafted since 1 November, every one with an objective untied most of its
   tasks (buffer 305 of 381, truss 20 of 21) and every one without tied nearly all (esp32 0 of 62,
   jobstat 7 of 180). Owner: the contract the Examiner drafts and the operator freezes. An objective
   is noisier than validity (about one task in four of the archive's A/A comparisons differs past
   the 1% floor between a harness's own two solves).
3. **The Examiner wrote with no reference solve at all** (confirmed absent; as a cause, one
   reading against). Across the six jobstat logs its tools were `bash` 1,739, `try_answer` 358,
   `propose_tasks` 198, `write` 113, `read_example` 65 and `read_opening` 25, and no Examiner
   session asked for a solve. Every jobstat run fell in a gap with no reference solve on the exam
   side: the gate's room solves (`try_task`) went on 1 November (#552, `8f901e459`); drafting
   solved its examples from 22 October to 1 November and again on 3 and 4 November (#585, which
   refused a draft the starter answered on every solve), and none of the six ran under either; and
   `try_reference` arrived on 4 November, 21:18. Its predecessors did not move supply:
   5,664 of 6,225 gate readings since 16 October had the reference valid on every room solve, the
   Examiner seeing each refusal and its reason; on 16 October the gate refused 67 of 95 drafts as
   answered in all three solves. Where they refused, they ended campaigns: under #585 four jobstat
   campaigns put 10 drafts, 60 of 60 example solves were valid and three ended `exam` with nothing
   compared, and the operator then asked for gates that trust a capable model. So per-draft
   feedback alone is not expected to lift the exam off the ceiling. Owner: `src/examiner/write.ts`
   (`try_reference`), now in source and unmeasured.
4. **Admission counts a task with no record as room** (confirmed). The frontier is every held task
   the reference has not closed, and a new task has no comparison yet, so 8 fresh tasks the
   reference will pass admit a comparison. A try of the reference does not count either: `poolOf`
   (`src/kernel/reports.ts`) reads room from comparisons alone, and `countedSolves`
   (`src/kernel/solves.ts`) keeps every Examiner-asked solve out of a task's record by design.
   Owner: `src/kernel/reports.ts`, `src/campaign/admission.ts`.
5. **Exhaustion takes two comparisons** (confirmed). A task leaves the frontier once the reference
   answers it in every solve of its last two comparisons (`RUNS.easy`), so each ceiling task fills
   two draws before it goes. Owner: `poolOf`.
6. **A tighter budget did not make room** (one reading). The jobstat run at PR600 with a turn limit
   of 6 model turns had both sides valid in every solve of its 8 tasks; its solves took 2 to 6
   turns. With the method in the exam (1), a limit has nothing to bite on. Owner: the setting, the
   operator's (`AGENTS.md`, section 3).
7. **The ladder's worked examples come from other fields** (plausible). The reach scale shows where
   a solver with a shell fails in truss, firmware and buffer terms; whether a jobstat Examiner reads
   them as reachable is unmeasured. Owner: `src/examiner/ladder.ts`, the examiner-complexity skill.

## Intended changes

In order: each rests on the one before.

1. **Read the zone on every run, from a script of record.** Promote the one-off reader of
   5 November into `examiner-complexity/scripts/` (beside `ambition.ts`): per comparison, the
   reference's tasks with 0, 1 and all valid solves, the tasks untied on validity and on the
   objective alone, and the A/A comparison's untied tasks beside them. A reading, never a decision:
   a comparison's report already prints the per-side distribution and the points by measure.
2. **Measure the drafting fixes first, in paired drafting seats on jobstat**
   (system-path-simulation, `cases/optimize.md`). Culprit 1 caps every task the exam allows, so no
   writing change can be read over an exam that hands over the method. Seat the current drafting
   prompt against the one the six runs had, on the jobstat prompt, and read the drafts with
   `exams.ts`: whether a convention
   or input still names a repair or every step, whether an objective is declared, and the starter's
   valid share on each draft's examples, put to fresh solves outside the seat.
3. **Then measure `try_reference` in paired live writing seats**, over an exam from item 2. Read
   it on solves the seat did not choose with: after each session, put every task it held out to
   fresh reference solves (2 or more each) and count the tasks with some solves valid and some not,
   against the control seat. Never count the seat's own tries: an Examiner that keeps the instances
   a try failed selects on the reference's luck (a task it passes 90% of the time fails at least one
   of two tries 19% of the time), and those tasks tie again on a fresh draw. Beside it, the check
   defects among the fresh fails and the dollars per held task. The bar is more tasks off the
   ceiling at no more check defects. Tune the try's prompt text against that count, as facts ("the
   reference answered this in 2 of 2 tries"), never a share to reach. The prior is low (culprit 3).
4. **Tell the Examiner its ties as a fact after each comparison.** Its record already gives each
   task's reference outcomes (#622). Add, if paired seats show it moves supply, how many of its
   tasks the last comparison tied on validity, and why a tie teaches the comparison nothing. Never a
   target rate.
5. **Ladder examples for the field the campaign runs in** (plausible). Only if items 2 and 3 leave
   seats writing at the ceiling: rate the worked examples blind with `rungs.ts` and add a rung
   pattern that a statistics task can follow, domain-agnostic in wording.
6. **Left to the operator** (`AGENTS.md`, section 3):
   - **Admission reading the reference's tries.** This is the third form of a reference-solve gate:
     the gate's room solves and #585's drafting refusal went for buying little and for ending
     campaigns `exam` (culprit 3). It differs in refusing no task, only a paid comparison, so a
     campaign would wait for supply or end `no-room` where it now compares at the ceiling. If the
     operator wants it, keep it one-way: a try may close a task (every try valid counts as
     answered), never open one, since an Examiner chooses which instances to try (item 3). Check
     before building: that a try runs under the comparison's condition (`src/kernel/condition.ts`);
     that rule 5 is untouched (a try decides admission and exhaustion only, and no try stands in
     for a side of a comparison); the change to `countedSolves`, which now keeps every
     Examiner-asked solve out of a task's record; and the archive replay of `decide` and admission
     over every log, counting the comparisons it would have withheld and the campaigns it would
     have ended.
   - 4 solves a side where the reference passes under a third, and the turn and time limits.
   - A draw ordered by the reference's past outcomes instead of by hash (`scoredSet`,
     `src/campaign/round.ts`). It is honest between the sides, since both solve afresh; the
     reference's luck in the record that chose a task regresses on the fresh solves, which costs
     the candidate power and never gives it a step. But it aims each comparison at the old
     reference's weak spots, the pattern behind the starter losses on own-epoch tasks below.

Kept from before, since they still hold: both harnesses solve the same tasks afresh, a step is read
within one comparison, one retained task joins each three frontier tasks, the starter comparison
draws as every comparison, and no fixed mix of own-epoch and older tasks goes into the draw (the
older tasks carry the opposite bias, so a fixed ratio sets one bias against the other). The blind
share of each post-promotion session planned on 3 November stays withdrawn.

## What working towards the zone could break

The zone is a measurement, not a target for a model, and any gate on spending is the operator's
(item 6). The sign-flip test
holds its false rate whatever tasks are drawn, so supply buys power and never a false step, with
one exception (3). Watch these with every change above:

1. **Noise passed off as difficulty.** The cheapest way to make a strong solver fail half the time
   is an ambiguous task, a fragile check or an answer that rests on luck. It costs power and
   dollars, not honesty: the test holds its false rate on noisy tasks too. The A/A untied share
   cannot tell noise from difficulty, since it rises with either: between equal harnesses passing a
   task half the time, 2 solves a side untie it on validity 62.5% of the time. Read what the fails
   were instead: the share of the reference's fails that are earned rejections citing a rule,
   against `no-answer`, limit endings and `check-defect` or `unclear` rulings, per epoch.
2. **More fails to rule.** Each rejection needs a Referee ruling, set-aside tasks need labels, and
   more than 3 tasks with a check defect stop the campaign. Watch check-defect and `unclear` rulings
   per held task.
3. **A too-strict check the Referee misses is the one route to a false step**: it refuses the
   reference's right answer, the ruling reads `earned`, and the candidate wins a task it did not
   earn (v1: 36 of 47 rehearsal misses came from a faulty check or instrument). Harder tasks bring
   more checks into play. Watch the verdicts factor's blind labels on tasks the reference fails.
4. **Cost.** A failed solve runs to its limits, the dearest kind. Watch dollars a solve across
   epochs.
5. **Narrower measurement.** Tasks aimed at the reference's weak spots measure "better there"
   rather than "better at the field". The promoted harnesses' losses to the starter on their own
   epoch's tasks (below) are the sign to watch.
6. **Endings with nothing compared.** Any gate on supply (item 6) trades a ceiling comparison for
   a campaign that waits or ends `exam` or `no-room`. Watch the endings no comparison read
   (`AGENTS.md`, section 1, "A strict gate against a capable model").

## How it came to be

- **1 November 2026, 21:01.** During the cost work the operator asked: "Wait i'm thinking like HOW
  are we tackling a BETTER harness but that has HARDER questions by the examiner so can still have
  MORE difficult questions etc?" At 21:02: "put this in the backlog, first overhaul costs fully".
  The answer then: a task the reference answers in every solve of its last two comparisons
  expires, admission needs 8 frontier tasks, and the Examiner sees the new reference's outcomes. On
  buffer's four gate-ablation runs the reference was valid in every solve on 129 of 132 scored
  tasks, and 1 of 6 steps was won on validity.
- **1 November, evening.** The operator's doubt: "climbing vs complexity vs only running the new
  harness for new queries which are harder which make total win ratio lower which decrease total
  chances of winning (paradoxal) even though the harness is better".
- **2 November.** The doubt as worded was refuted: no reading uses a total win ratio, both
  harnesses solve the same tasks, and a task both fail is a tie that leaves the test. What harder
  tasks lower is power, which is a hump peaking near half; the table above is that day's
  simulation. The record sat at the easy end. Three Opus 5.5 sessions confirmed this, and found the
  real cost in confirmation: a starter comparison scored only the tasks held since
  (`sinceOnly`), the tasks aimed above the new reference. From then on it draws as every
  comparison does (`89a6a1768`). Recounted over the 8 starter comparisons on record, the promoted
  reference won 33, lost 44 and tied 9 on its own epoch's tasks and won 67, lost 20 and tied 24 on
  older ones; the objective decided all 64 losses.
- **3 November.** An outside review read the same split and proposed a fixed mix in the draw and a
  blind share of each session; both were declined (above). The operator asked whether jobstat had
  the zigzag: "in the existing like harness B, we should rerun the queries that were set up for
  harness C [...] Did we implement that already?" It was: a comparison solves both sides afresh on
  one draw. Then: "remove all complexity along the way ambitiously", and five readings around a
  promotion that decided no move went.
- **4 November, 21:18.** `try_reference` reached `main`: a writing Examiner can put an instance to
  fresh solves by the reference before holding it out.
- **5 November, about 02:30.** Reading the release figures (Fig 4, the ceiling), the operator asked
  "what do you think the optimal point would be here for climbing maximally in theory, 0.5 x-axis
  and 0.5 y-axis?", then "Shouldn't we try to optimize for this in the system? How would this work?
  We're way at the edge now right?" The answer: a per-task pass rate of about 0.3 to 0.5, and the
  untied share as high as it goes, though some untied tasks are noise.
- **5 November, about 03:00.** The operator: "More like, what do YOU think of working towards these
  values as optimization targets? Like the downside will be that if we optimize for this there'll
  probably be other problems, right?" The answer is the section above: a measurement and a spending
  gate in code, facts for the Examiner, no target. The reading of the 23 comparisons and the
  Examiner's tool counts were taken then, and jobstat was found at the ceiling before any promotion.
  The operator: "Epand the backlog here, scrub outdated backlog about this, we should target this
  tomorrow, set cron job in 16h to fully optimize for this with all culprits related etc". This file
  replaces `examiner-harder-after-promotion.md`; its record of the Builder, Examiner and Referee
  prompt reviews of 2 November stays in that file's history.
- **5 November, 03:04.** The operator: "reveiw and tune backlog item contents". The review, against
  the source: the counts held, but the culprits missed the record that matters most for jobstat.
  Its drafted exams handed over the method, and the drafting prompt that allowed it changed on 4
  and 5 November, after every jobstat run (now culprit 1, and item 2 measures it first). The
  reference-solve gates `try_reference` follows had run since 16 October, mostly at the ceiling, and
  the one that refused ended campaigns `exam` (culprit 3). Admission reading tries became the
  operator's decision, one-way if taken. The `try_reference` measure moved to fresh solves the seat
  did not choose with, and the noise watch moved from the A/A untied share to what the fails were.
