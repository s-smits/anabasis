# Harder Examiner tasks after each promotion

Status: planned. The zigzag is in source: every new task is solved afresh by the older harness too, the reference in each comparison and the starter in the comparison owed after a promotion, which draws as every comparison and confirms on its first reading since 2 November. Measuring the Examiner after a promotion waits for the live runs at this stack.

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
4. **Keep the zigzag, and add no blind share.** Every new task is solved afresh by the older
   harness too: the starter comparison owed after a promotion draws the tasks held out since first
   (`decide.ts`, the `starter` move), and each candidate comparison solves the reference on the same
   tasks as the candidate. A blind share of each post-promotion Examiner session was planned here
   on 3 November and is withdrawn (operator, 3 November): it adds a second kind of task to the
   Examiner and the draw, where the zigzag already reads the new tasks on both sides. The split the
   epoch line printed (own-epoch tasks against older ones) went on 3 November with the other
   readings that decided no move; whether the Examiner aims at the reference is item 1's reading.
5. **No fixed mix of own-epoch and older tasks in the draw.** The older tasks carry the opposite
   bias, since they were kept for room against the starter, so a 50/50 mix sets one bias against the
   other at an arbitrary ratio, and an epoch with fewer than half the draw on either side cannot fill
   it.

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
- **2 November, about 04:20.** The operator asked whether this was properly tackled: "the more
  complex harness coming out worse because it has harder tasks even though the harness is better".
  One form of it was still live. From 30 October a starter comparison scored the tasks held out
  since alone (`sinceOnly`, added to save the $15 and $19 two such comparisons cost), and those are
  the tasks the Examiner writes above the new reference's grade. `confirmed`, the milestone's count,
  reads that comparison, so a promotion was confirmed only where the reference also beat the
  starter on the tasks aimed at it. Re-scored on the recorded solves of the six starter comparisons
  that drew the whole set, the epoch's own tasks alone would have read the reference 23 won, 33
  lost against the starter. The starter comparison now draws as every comparison does: the tasks
  held out since first, then older ones, with one retained task for each three. It costs about as
  the two comparisons of 30 October did. The split between the two remaining readings (tasks aimed
  at the reference, gains that do not carry to new kinds of task) is a research question; no move
  waits on it.
- **2 November, afternoon.** The operator asked for three observations of the most brittle parts,
  then: "Synthesize and build improvement plan, then implement the plan", and "Tune through
  prompting as well, the model adheres to prompts well". Three read-only sessions read the floor of
  ten, the starter losses and the stack's diff. Each finding was recounted before it was used.
  - *The floor of ten.* Withdrawn (#566): on 51 of 53 comparisons the first eight tasks read as
    the first ten did, and the floor would have refused 7 step readings since 31 October.
  - *Why a promoted harness loses to the starter.* Recounted from the per-task rows of the 8
    starter comparisons on record (197 tasks, read from the reference's side): on tasks written in
    the promotion's own epoch it won 33, lost 44 and tied 9; on older tasks it won 67, lost 20 and
    tied 24. The objective decided all 64 losses and validity none, and the reference answered
    every own-epoch task validly in every solve. 21 losses come from one harness promoted on the
    bill (v070), which no longer counts. In 27 of the 64 the four pairings disagree in sign, so
    another draw could turn them; the starter's two solves of a task differ by the objective's
    floor on 109 of 197 tasks, the reference's on 14. Two of the 8 read a step for the reference if
    their set-aside tasks are counted as ruled.
  - *A second starter comparison in one epoch.* Confirmed: with no harness waiting, the table names
    the pair again where tasks are held out after it, and the epoch's last reading set
    `confirmed`. Replaying `decide` at the stack's head over the archive, it names one in 4 of the
    11 epochs where a starter comparison had reported.
  - *The host-led idle ending.* Confirmed by a probe: under `--sessions 4`, three sessions that each
    changed the harness ended a host-led campaign before their comparison. No recorded opening was
    host-led.
  - *`tools/runs/view.ts` printed a starter comparison's tally from the starter's side.* Confirmed;
    it made postplan's 7 to 3 lead read as a loss.

  The plan, as carried out:
  1. Draw the starter comparison as every comparison (already at the head), and read confirmation
     on the epoch's first starter comparison that tallied a task, so a redraw replaces no reading.
  2. Name the tasks a starter comparison set aside for labels in the epoch line and lane 24, and
     the side a tally counts from in `runs view`.
  3. Hold a host-led campaign's idle ending until it has run as many sessions as a comparison
     follows.
  4. State in the Builder's system prompt, as a count, where promoted harnesses lost to the
     starter: the Builder reads only its own campaign's tallies. Then review every text the
     Builder, the Examiner and the Referee read for a model that follows prompts closely.

  The review read each seat whole, one session a seat, and every finding was checked against the
  source before an edit. Applied, each as a fact in place of a course or a second limit:
  - *Builder.* The one limit stated once, as "names a task, copies its text or holds its answer",
    in place of "answers a particular task" and "leaves the solving method to the solver", which a
    literal reader takes as bans on the search the prompt permits. One retained task is scored for
    every three the reference does not answer. A solve cut at its limit fails. The starter
    comparison promotes and stops nothing. The patience line says what counts against it. A redraw
    of a harness changed in little draws the level's chance again. `HARNESS.md` shows the guide's
    outline as an example rather than an outline to keep.
  - *Examiner.* Objective spread between a harness's own solves is chance: 314 of 1,373 tasks in
    the archive's A/A comparisons. A grade is what the field demands, never one harness's fault,
    since the starter is compared on the new tasks too. The drafting target "the top of this scale"
    and the climb "from the highest grade the reference already answers" are gone, as is "varying
    what they ask" on a declined finish. Two stale statements were corrected.
  - *Referee.* The probe that tells a correct check from a too-strict one: the allowed value
    nearest the answer's. In 389 of 438 earned rulings no probe tried one. The host's evidence test
    is necessary, not sufficient, and unclear sets the task aside.

  Three facts the prompts lacked a value for were then plumbed: the Examiner's record says on how
  many tasks the reference's own two solves differed in its last comparison's A/A, the drafting
  opening states the solve budget a writing session is told, and both say how many times a
  comparison solves each task under each harness instead of "several times". The solver's texts are
  the operator's (`AGENTS.md`, section 3), so they are listed instead:
  the malformed flag is a fail but is not presented as one (484 flagged against 2,439 rejected
  endings), "choose your solving method" reads the guide as optional, and "You help users" names
  nobody. Whether a check may compare an answer with a hidden value is also the operator's to say.
  A pair of tuning rounds would measure the edits.

  Left for the operator: labelling the 3 set-aside rejections of postplan's g-2 and forkedPR506's
  g-6; whether a starter comparison should run 4 solves a side, which would settle the 27 losses a
  draw could turn; and a fresh run at the stack's top, its first starter comparison the test of
  the full draw.
- **3 November.** An outside review of the starter comparisons (`BACKLOG_review.md`, kept out of
  the tree) read the reference as losing the tasks its own epoch's Examiner wrote and winning the
  older ones. The epoch line now prints that split (#580). On buffer-fresh-opus-fullrun-m1-air:
  - epoch 3's confirmed 12 won, 6 lost and 3 tied was 2-6-3 on its own tasks and 10-0-0 on older
    ones;
  - epoch 2's 9-8-2 was 3-8-2 and 6-0-0.

  The review proposed three changes. The first, this split, is in source. The second, a fixed mix
  in the draw, is rejected for the reason in item 5. The third, blind tasks drafted before the
  reference opens, was item 4.
- **3 November, about 05:40.** The operator asked whether the doubt was fixed, jobstat included:
  "if we make the [tasks] too hard, then the win ratio will go down. So then we have like less
  wins, so the we won't promote while the harness is actually better, but the queries are harder
  [...] in the existing like harness B, we should rerun the queries that were set up for harness
  C. Actually, that's the solution to rerun them, and then we have an honest [...] zigzag method
  that actually works. Did we implement that already? We should definitely implement that and
  remove the other more complicated algorithms if they are there."
  - The rerun is in source, and was before this question. A comparison solves both harnesses
    afresh on one draw (`AGENTS.md`, rule 5), so the reference answers the candidate's new tasks
    in the same comparison, and a task both fail is a tie that leaves the sign-flip test: no reading
    uses a win ratio. The starter comparison after a promotion draws the tasks held since first
    (`89a6a1768`, 2 November), so the starter answers the new tasks too.
  - Jobstat runs both. `jobstat-fresh-opus-forkedPR580-stijn-pro` is at 370f320f9, which holds
    `89a6a1768` and no `sinceOnly`. It has no promotion yet, so its starter comparison has not run.
    Its g-2 draws the tasks x-2 wrote first; at 05:45 the reference was valid in 44 of 46 solves
    over both its comparisons, and its 3 earned rejections all fell on x-2's tasks.
  - The more complicated path was the planned blind share (item 4), never in source; it is
    withdrawn. Nothing in source served the doubt alone: confirmation and the epoch line's split
    are readings that decide no move.
