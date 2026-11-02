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
- **2 November, about 01:30. Five points found on the way, then read against the whole of their
  owners** (`decide.ts`, `admission.ts`, `climb.ts`, `round.ts`, `checkpoint.ts`, `reports.ts`,
  `compare.ts`, `src/examiner/prompt.ts`). Four were not defects:
  - *A starter comparison may score 1 to 5 tasks.* True: `heldSince` starts one on a single task
    held since, and admission counts the whole frontier. But its first purpose is room ("whether
    they leave it room before a Builder session is paid for"), which one task can show; only
    confirmation needs six untied tasks. The 6 starter comparisons in the archive scored 10 to 32
    tasks, and each had six untied or more. Left as it is.
  - *The prompt's target rises with no upper limit.* Refuted. "Above the highest grade the reference
    answers in every solve" moves with the reference's own record, so it stops where the reference
    starts failing, at the power peak. "Chance, not a better method" is said only of room at a grade
    the reference answers every solve.
  - *`referenceHasValidAnswer` turns true on the author's answer.* Intended: the head comment of
    `poolOf` says an author's answer settles a task's feasibility for good, so that a short budget
    never sends it to a person. The field is now named for what it holds,
    `independentValidAnswer`. A task both sides fail in every solve then stays a tie on the
    frontier; 6 of the 1,699 recorded ties were such.
  - *A comparison that cannot step counts against patience.* Whether it could step is not known
    from the reference's side: a candidate can untie a task the reference answers every time with
    a better answer than any on record. 12 of 49 candidate comparisons in the archive (harnesses
    that a whole session changed) had fewer than six untied tasks and read room, so counted. Left as
    it is.
  - *The `scoredSet` head comment.* Stale, and corrected, with three docs that said admission
    counts informative tasks (it counts frontier tasks) or that exhaustion pools the other side's
    solves (only the reference's own count since the v0.9.0 review).

  The confirmation question above was then narrowed. Split by whether the comparison that promoted
  the reference had scored the task, the 6 starter comparisons read the reference against the
  starter 49 won, 20 lost, 20 tied on older tasks it had scored, 12 won, 0 lost, 4 tied on older
  tasks it had not, and 23 won, 33 lost, 5 tied on the epoch's own. So the winner's curse does not
  explain the own-epoch losses: older tasks the promotion never saw still go to the reference. Two
  readings remain, tasks aimed at the reference and gains that do not carry to the new kinds of
  task, and the 16 unseen older tasks come from 3 campaigns only. Splitting them takes blind reach
  grades of the own-epoch and older tasks from graders who read the public inputs alone, set beside
  each side's results (`grades.ts`, examiner-complexity): grader sessions, and no campaign solve.
