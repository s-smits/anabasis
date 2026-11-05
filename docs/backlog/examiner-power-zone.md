# Examiner tasks in the reference's power zone

Status: planned, and the target of 5 November. In source: the zigzag (every new task is solved
afresh by the older harness too), `try_reference` (on `main` from 4 November, 21:18), the 0 to 7
reach ladder (#551) and the package gate (#552). None of the runs read below had `try_reference`.

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
one reading.

1. **The Examiner wrote without trying the reference on its own tasks** (confirmed). Across the
   six jobstat logs its tools were `bash` 1,739, `try_answer` 358, `propose_tasks` 198, `write`
   113, `read_example` 65 and `read_opening` 25, with no try of the reference: the tool was not yet
   in source. It learned the reference's outcomes only from comparisons already paid for. Owner:
   `src/examiner/write.ts` (`try_reference`), now in source and unmeasured.
2. **Admission counts a task with no record as room** (confirmed). The frontier is every held task
   the reference has not closed, and a new task has no comparison yet, so 8 fresh tasks the
   reference will pass admit a comparison. A try of the reference does not count either: `poolOf`
   (`src/kernel/reports.ts`) reads room from comparisons alone. Owner: `src/kernel/reports.ts`,
   `src/campaign/admission.ts`.
3. **Exhaustion takes two comparisons** (confirmed). A task leaves the frontier once the reference
   answers it in every solve of its last two comparisons, so each ceiling task fills two draws
   before it goes. Owner: `poolOf`.
4. **No objective that separates answers** (confirmed). jobstat declares none, so two valid answers
   always tie. jobstath2 declared one and it saturated: 243 of 265 passing verdicts measured exactly
   1 (#622). Owner: the contract the Examiner drafts; an objective is the Examiner's to declare, and
   noisier than validity (about one task in four of the archive's A/A comparisons differs past the
   1% floor between a harness's own two solves).
5. **A tighter budget did not make room** (one reading). The jobstat run at PR600 with a turn limit
   of 6 model turns had both sides valid in every solve of its 8 tasks; its solves took 2 to 6
   turns. Owner: the setting, the operator's
   (`AGENTS.md`, section 3).
6. **The ladder's worked examples come from other fields** (plausible). The reach scale shows where
   a solver with a shell fails in truss, firmware and buffer terms; whether a jobstat Examiner reads
   them as reachable is unmeasured. Owner: `src/examiner/ladder.ts`, the examiner-complexity skill.

## Intended changes

In order: each rests on the one before.

1. **Read the zone on every run, from a script of record.** Promote the one-off reader of
   5 November into `examiner-complexity/scripts/` (beside `ambition.ts`): per comparison, the
   reference's tasks with 0, 1 and all valid solves, the tasks untied on validity and on the
   objective alone, and the A/A comparison's untied tasks beside them. A reading, never a decision:
   a comparison's report already prints the per-side distribution and the points by measure.
2. **Measure `try_reference` in paired live Examiner seats on jobstat** (system-path-simulation,
   `cases/optimize.md`). The count: of the tasks each seat holds out, how many the reference fails
   in at least one try, beside the seat's check-defect rulings and its A/A untied share. The bar is
   more tasks off the ceiling at no more check defects. Tune the try's prompt text against that
   count, as facts ("the reference answered this in 2 of 2 tries"), never a share to reach.
3. **Let admission read the reference's tries** (plausible, check first). A try is a fresh solve of
   the held task by the reference, under the campaign's setting, so a task it answered in every try
   carries the same evidence as a comparison it answered. Counting tries in `poolOf`'s room would
   keep 8 ceiling tasks from admitting a paid comparison. Check before building: that a try runs
   under the comparison's condition (`src/kernel/condition.ts`), that rule 5 is untouched (a try
   decides admission and exhaustion only, and no try stands in for a side of a comparison), and the
   archive replay of `decide` and admission over every log.
4. **Tell the Examiner the zone as a fact after each comparison.** Its record already gives each
   task's reference outcomes (#622). Add, if paired seats show it moves supply, how many of its
   tasks the last comparison tied on validity, and why a tie teaches the comparison nothing. Never a
   target rate.
5. **Ladder examples for the field the campaign runs in** (plausible). Only if item 2 shows seats
   that try the reference still write at the ceiling: rate the worked examples blind with `rungs.ts`
   and add a rung pattern that a statistics task can follow, domain-agnostic in wording.
6. **Left to the operator** (`AGENTS.md`, section 3): 4 solves a side where the reference passes
   under a third, the turn and time limits, and a draw ordered by the reference's past outcomes
   instead of by hash (`scoredSet`, `src/campaign/round.ts`). The last is honest between the sides,
   since both solve afresh, but it aims each comparison at the old reference's weak spots, which is
   the pattern behind the starter losses on own-epoch tasks below.

Kept from before, since they still hold: both harnesses solve the same tasks afresh, a step is read
within one comparison, one retained task joins each three frontier tasks, the starter comparison
draws as every comparison, and no fixed mix of own-epoch and older tasks goes into the draw (the
older tasks carry the opposite bias, so a fixed ratio sets one bias against the other). The blind
share of each post-promotion session planned on 3 November stays withdrawn.

## What working towards the zone could break

The zone is a measurement and a gate on spending, not a target for a model. The sign-flip test
holds its false rate whatever tasks are drawn, so supply buys power and never a false step, with
one exception (3). Watch these with every change above:

1. **Noise passed off as difficulty.** The cheapest way to make a strong solver fail half the time
   is an ambiguous task, a fragile check or an answer that rests on luck. The untied share then
   rises in the A/A comparison too. Read the A/A untied share beside the candidate's, every time.
2. **More fails to rule.** Each rejection needs a Referee ruling, set-aside tasks need labels, and
   more than 3 tasks with a check defect stop the campaign. Watch check-defect and `unclear` rulings
   per held task.
3. **A too-strict check is the one route to a false step**: it refuses the reference's right answer
   and hands the candidate a win (v1: 36 of 47 rehearsal misses came from a faulty check or
   instrument). Harder tasks bring more checks into play.
4. **Cost.** A failed solve runs to its limits, the dearest kind. Watch dollars a solve across
   epochs.
5. **Narrower measurement.** Tasks aimed at the reference's weak spots measure "better there"
   rather than "better at the field". The promoted harnesses' losses to the starter on their own
   epoch's tasks (below) are the sign to watch.

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
