# Harder Examiner tasks after each promotion

Status: planned. Waits for the cost overhaul, and for the operator's word on the fresh runs it needs.

## The question

A better harness should be met by harder tasks, so that a campaign keeps finding room to climb
instead of running out of informative tasks after one or two promotions.

## Intended changes

1. **Measure first, at the release tree.** Fork fresh campaigns at v0.9.1 (on the operator's word,
   since they spend). With `ambition.ts` and `grades.ts` (examiner-complexity), read the reach
   grades of the tasks each Examiner session wrote after a promotion against those written before
   it. The test: does the grade rise after a promotion? Count it per session, with its denominator.
   Beside the grades, read the quantity that sets a comparison's power: the reference's share of
   valid solves on the scored tasks, and the tasks untied on validity, per comparison and epoch.
   Harder is better until the reference passes about half; past that it costs power again.
2. **If it stays flat, fix the post-promotion Examiner brief.** The Examiner's view
   (`src/examiner/record.ts`) already shows the new reference's outcomes. The brief should state as
   a fact that the reference now answers its earlier tasks, with no target or share to aim at
   (`AGENTS.md`, section 2, consequence 2). Tune it in paired live seats (system-path-simulation,
   `cases/optimize.md`) before any fresh campaign.
3. **Keep what protects the comparison.** Both harnesses solve the same tasks afresh, a step is
   read within one comparison, and one retained task joins each three frontier tasks. Harder tasks
   change supply, never how a comparison is read.

## How it came to be

- **1 November 2026, 21:01.** During the cost work the operator asked: "Wait i'm thinking like HOW
  are we tackling a BETTER harness but that has HARDER questions by the examiner so can still have
  MORE difficult questions etc?"
- **1 November, 21:02.** The operator: "put this in the backlog, first overhaul costs fully".
- **1 November, 21:02.** The answer on record: the design already expires a task the reference
  answers in every solve of its last two comparisons, needs 8 informative tasks to admit a
  comparison, and so names an Examiner session after a promotion. The Examiner sees the new
  reference's outcomes as facts. In the runs on record the exams stayed easy: on buffer's four
  gate-ablation runs the reference was valid in every solve on 129 of 132 scored tasks, and 1 of 6
  steps was won on validity. The same evening a live buffer run promoted twice, the first time 7
  to 0 without the bill and 0 to 0 on validity. #551 (a 0 to 7 reach scale with worked examples)
  and #552 (the gate admits a task on its package) address supply, but neither had run in a fresh
  campaign yet.
- **1 November, about 21:40.** The operator asked that every backlog item get a file like this one,
  holding the intended changes and the chronology.
- **1 November, evening.** The operator's doubt: "climbing vs complexity vs only running the new
  harness for new queries which are harder which make total win ratio lower which decrease total
  chances of winning (paradoxal) even though the harness is better".
- **2 November.** The answer, from the code and the archive:
  - The win share cannot be diluted by hard tasks. Both harnesses solve the same tasks, and the
    sign-flip test reads untied tasks alone (`flipP`, `src/kernel/compare.ts`): a task both fail
    is a tie and leaves the test.
  - What harder tasks can lower is power. A comparison scores a fixed number of tasks, and a step
    at 0.02 takes at least 6 untied ones. A task both always pass or both always fail fills a slot
    and says nothing. With 2 solves a side and 24 tasks, by the binomial: a reference at 96% against
    a candidate at 100% leaves 1.9 untied tasks and reads a step 1% of the time; 60% against 85%
    leaves 14.7 and reads one 63% of the time; 2% against 10% leaves 5.2 and 15%. The curve is a
    hump, so harder helps until the reference passes about half.
  - The record sits at the easy end. Over 244 Builder comparisons in 72 archived campaigns (seeds
    left out), the reference was valid in 84% of solves before the first promotion, 96% after it
    and 99% after the second. Tasks untied on validity fell from 3.6 a comparison to 1.7 and 0.9,
    and tasks both failed stayed under 0.5%. Of 40 steps after the second promotion, none had six
    validity wins; the objective carried them (under the rules each comparison ran on). So the risk
    on record is the opposite of the doubt: exams that do not get harder after a promotion.
  - Too-hard tasks still cost in two ways: a solve that fails runs to its limits, the dearest kind,
    and the draw takes the newest epoch by hash, not by outcome (`scoredSet`,
    `src/campaign/round.ts`), so such a task fills a slot until two comparisons set it aside for a
    person's label.
- **2 November, about 01:00.** Three independent read-only sessions (Opus 5.5) took the doubt from the
  statistics, the record and the loop's design, at f8fc8627e. What held when checked against the
  source and a rerun of their scripts:
  - **The doubt as worded is refuted.** No reading uses a total win ratio. Under a calibrated
    Examiner (each epoch's tasks equally hard for its reference) a simulated climb steps as often
    in every epoch, 0.38 to 0.43 a comparison for a candidate one log-odds unit better.
  - **The power hump, exactly.** 24 frontier and 8 retained tasks, 2 solves a side, level 0.02,
    a candidate one log-odds unit better: a step 3.5% of the time where the reference passes 2% of
    solves, 29% at 10%, 53% at 30%, 52% at 50%, 19% at 85% and 3% at 95%. Between equal harnesses
    it never exceeds 1.2%. 4 solves a side about double the chance at the hard end (0.15 to 0.35
    where the reference passes 5%).
  - **The record is at the easy end.** Of 1,699 ties in candidate comparisons, 1,686 had both
    sides valid in every solve and 6 had both fail every solve. Before 21 October the step rate
    fell after a promotion (14 of 41 comparisons); from then on it did not (57 of 82 after a
    promotion, 34 of 54 before one). Where the exam did get harder for the reference (five
    campaigns whose own-epoch share fell 10 points or more), 5 of 8 comparisons stepped, all on
    validity, and the candidate won all 107 tasks the reference failed in every solve.
  - **Where harder tasks do cost: confirmation.** A starter comparison scores only the tasks held
    since the last comparison began (`sinceOnly`, `tools/d2/checkpoint.ts`), which the Examiner
    was told to write above the new reference's grade (`src/examiner/prompt.ts`). The epoch's last
    such comparison decides `confirmed` (`src/campaign/climb.ts`), the milestone's count. In the 6
    on record, the reference beat the starter 61 to 20 on older tasks and lost 23 to 33 on its own
    epoch's, all on the objective. Three readings fit and are not yet split: the tasks are aimed at
    the reference, its gains do not carry to new kinds of task, or objective noise (in the A/A
    comparisons of epoch 1, 53% of tasks were untied). Confirmation decides no move.
- **Found on the way, not yet decided.** Each holds in the source at f8fc8627e; none has a live
  case counted yet.
  - A starter comparison is admitted on the whole frontier's size, so it can score 1 to 5 tasks,
    where no reading can confirm (`heldSince`, `src/campaign/decide.ts`; `sized`,
    `src/campaign/admission.ts`).
  - The prompt raises the target after every promotion with no upper limit, and calls a failure at
    a grade the reference usually answers "chance, not a better method", which steers the Examiner
    away from the tasks where the test is strongest.
  - `referenceHasValidAnswer` also turns true on the Examiner's own answer (`taskRecords`,
    `src/kernel/reports.ts`). 2,085 of 2,269 held tasks carry one, so `awaiting` was empty at the
    end of all 74 real campaigns. A task both sides fail leaves only by practice release, which
    takes such tasks first (`releaseOrder`) at most down to the admission floor (`practiceDue`).
  - A comparison with one informative task counts against patience (`roomOf`, `stopRule`) even
    where it has fewer than six untied tasks and could not step.
  - The head comment of `scoredSet` (`src/campaign/round.ts`) still says a step may not lose more
    pairs than it wins; one test has decided since the retained test went.
