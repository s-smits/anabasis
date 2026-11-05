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

In order: each rests on the one before, except item 7, which comes before item 3.

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
   reference answered this in 2 of 2 tries"), never a share to reach. The prior is low (culprit 3),
   and one live writing seat on the jobstat exam of 5 November lowered it: it tried 3 instances,
   the reference answered all 6 solves, and the seat dropped each instance and proposed none in 51
   minutes and 15 dollars. Its 86 turns billed 84% of that, and the tries 16%. One sample.
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
   - **The jobstat domain prompt, and the drafting clause that lets an exam name the method**
     (`src/examiner/draft.ts`, the rule on what conventions may state). Both outside reviews of
     5 November read jobstat as estimation against a hidden truth whose drafted inputs name every
     step. The prompt is the operator's; the same live seat found 3 of its 4 instances naming all or
     nearly all of the method, each answered on every solve. Four outside reviews of the stack now
     name the prompt's validity sentence as the binding cause, and the log confirms what it says:
     "A deliverable is valid when every requested file, sheet, column and section exists and its
     computed values, counts and denominators agree with a recomputation from the supplied files
     using standard Python statistics libraries (pandas, scipy, statsmodels)." The drafting
     prompt's "the operator's prompt outranks your choice of rules" keeps that rule whatever
     #620's text says, and the prompt names no objective. Proposed in its place, for the
     operator's word, the rest of the prompt unchanged:

     > Each task's workspace is generated from a statistical process whose parameters the task
     > does not state, with the defects real data carries (missing values, recoding, duplicates,
     > confounders) left for the analyst to find. A deliverable is valid when every requested file,
     > sheet, column and section exists and its tables reconcile with each other: counts,
     > denominators and totals agree across them. Of two valid deliverables the better is the one
     > whose estimates and intervals lie closer to the parameters the data were generated from,
     > scored by absolute error and interval score.

     It makes the exam carry hidden values (the parameters) and declare an objective that reads
     them (#616), so a third review's ask for code that forces hidden values is met for jobstat
     without refusing truss, whose objective rightly reads none. The operator approved it on
     5 November ("tune indeed"), and it is the operator's prompt file for jobstat from then, the
     one before kept beside it. The case: the 4 November revision kept recomputation as the
     objective ("the larger share of computed values ... that agree with a recomputation"), and
     the campaign that ran it, jobstath2-fresh-opus-forkedPR608-stijn-pro, scored 243 of 265
     solves at exactly 1 and tied 51 of 51 tasks over three comparisons, every one `no-step`.
   - A draw ordered by the reference's past outcomes instead of by hash (`scoredSet`,
     `src/campaign/round.ts`). It is honest between the sides, since both solve afresh; the
     reference's luck in the record that chose a task regresses on the fresh solves, which costs
     the candidate power and never gives it a step. But it aims each comparison at the old
     reference's weak spots, the pattern behind the starter losses on own-epoch tasks below.
7. **Requests that write a demanded string with markup** (plausible, one exam). In a live round of
   5 November on the jobstat exam and the seed it ran on, 18 of 19 rulings were on one check
   (`check-manifest`), from 5 tasks whose request writes each demanded section heading as a
   Markdown heading line; the solver copied the prefix, and the check compares the trimmed heading
   exactly, as the conventions say. Tasks that quote the heading instead passed. All 18 were ruled
   `check-defect`, and each is a heading-only case: its probes pass once the headings change. The
   nineteenth, on `x-4-001`, is a different case and was ruled `earned` on another ground: a wrong
   descriptive statistic under the analysis plan's pre-dose rule (R3), whose cited probe moves
   `check-descriptive-statistics` while other checks still refuse. So the record holds no two
   rulings that read the same heading-only evidence two ways. Ten rulings came from the seed's
   own campaign on 4 November, four of them on comparison g-1's solves of one task (`x-2-006`),
   below the stop's more than 3 tasks; the round's nine were all on the Builder b-2's practice
   solves.
   A replay without a model settled what caused the recorded refusals: with only the heading's `#`
   prefix stripped, 31 of the 32 rejected answers on record pass the verifier (the seed's 10 of 10,
   the round's 21 of 22), and every answer re-grades unchanged to its logged verdict. The one left
   is the `x-4-001` solve ruled `earned`, still refused by `check-descriptive-statistics` and
   `check-regression-estimates`. The Referee guard #622 removed would have refused none of the 8
   heading rulings of the round: each probe reached a declared field and supplied no accepted
   answer.
   The reference's 8 valid solves of 29 on that exam are a pooled figure, not a comparison's
   reading: 17 practice solves and 12 Examiner tries, one of them flagged, on instances chosen in
   different ways, and g-2 read nothing. Without the heading, 27 of 28 recorded solves would have
   been valid. That supports the heading as the diagnosis; what the exam's difficulty would be
   under clear wording stays unknown until a fresh set of tasks the Examiner writes with plain
   requests gets 2 or more fresh reference solves each, read per task as 0/2, 1/2 and 2/2, never
   as one pooled share. The frozen exam is not repaired and its comparison is not scored again on
   changed terms (rules 2 and 4).
   The owner is the writing prompt's wording on how a request states an exact string, written
   domain-agnostically. #621 now carries it (`80126f87c`) in the fairness text that the writing
   and the drafting prompts share: a solver copies a demanded string as the public input spells
   it, markup included, so where a check compares text exactly the input gives that text alone, set
   apart as a quotation. It is present in source and unmeasured. Operator blind labels (`settle.ts`) of a few heading cases from the five
   requests, with `x-4-001` among them and counted apart, settle which side the shared reading
   favours; one label can settle that reading, but not the Referee's accuracy over 18 rulings,
   which still needs the verdicts factor's 30 blind labels. No operator label is on record yet.
   **Settle this before item 3**, since a writing seat measured over such an exam counts the
   wording as difficulty. If the labels say `earned` for the heading cases, the Referee ruled 18
   real fails aside, and a sharper guard than the one #622 removed is worth a paired Referee seat.
8. **One generator re-seeded across an exam** (plausible). An Examiner that writes every held task
   from one generator with new seeds gives a comparison one template many times, so a harness with
   a program cut to that template wins each task, and the step measures the template rather than
   the field. By the exam's own definition that is still generalising, and telling the Examiner to
   vary structure edges towards a target (`AGENTS.md`, section 2, consequence 2), so nothing goes
   into a prompt first. Count, without money, the distinct generator structures among the held
   tasks of the recent jobstat and buffer runs (the packages under each `task.proposed`),
   and whether a step there held on tasks from another generator. Only a count that shows one
   structure carrying most steps makes this a change, and then as a fact in the Examiner's
   record (how many of its held tasks share a generator), never a quota.
   Counted on 5 November over 52 campaigns opened from 25 October (45 buffer, 1,659 held tasks; 7
   jobstat, 274), with a structure key of family plus the public input's skeleton: one structure
   holds half or more of a step's untied tasks in 4 of 54 `step` comparisons, and in each the draw,
   which takes the newest epoch first, explains the share. The one such step whose harness was
   read again (a starter comparison on 21 tasks, none of that structure) held; two rest wholly on
   one structure and were never read again. No jobstat comparison read `step` (15 `no-step`).
   Several sessions since 28 October held 8 to 26 tasks from one or two structures. So the bar is
   not met: nothing changes, and the count is a fact the Examiner's record could carry only if a
   later count shows steps carried by one structure. One subagent's count, spot-read here.
9. **One Examiner conversation across asks makes item 8 likelier** (plausible, unmeasured). #626
   keeps the writing Examiner's whole context from ask to ask, so it holds its generators and can
   reuse them, where a fresh session derived them again. Coherence and economy pull one way,
   variety the other. Monitor it in the first live run with #626: the count of item 8 by ask, the
   reference's outcomes, the held tasks and the dollars by ask. Set beside the runs before it, that
   describes an association, not the effect of continuity, and one ordinary run that shows no change
   cannot refute it. Only if keeping #626 turns on cause does it take matched seats over several
   asks that differ only in the conversation, with the same home on both arms.
10. **Practice blocked after a reading** (confirmed in the record, changed in #625). The guard that
    released nothing where nothing was held out since the last release stopped the Builder's
    practice: replayed over the archive, 16 of 247 campaigns reached that state after a reading,
    across 26 Builder conversations, 2 never cleared and 4 compared without the practice they were
    owed. #625 moves the guard into `practiceDue` and bounds it instead of removing it: a reading
    with nothing held out since the last release is owed one task, a promotion with nothing held
    none, and the admission floor and the release's cap still bound it. The cap is half of what is
    held (`tools/d2/prepare.ts`), as the campaign-mechanics reference and the `--practice` help
    say; `AGENTS.md` sections 1 and 6 said half the tasks with room, and #625 (`c40f92b73`) corrects
    them to the three bounds the code holds: half of what is held, half of the tasks a reading left
    room on (`releaseOrder`), and after the first release the comparison floor of frontier tasks.
    The risk to watch is the frontier: one task a reading drawn from tasks a comparison would score
    brings the frontier nearer the floor of eight, and an allowance does not guarantee an eligible
    task (`releaseOrder`). Read the frontier and the released count after each reading in the first
    run that carries it.
11. **Left to the operator, from the round of 5 November** (`AGENTS.md`, section 3):
    - whether a try's result names the refusing check, or says the rejection is unruled. A try
      names no check by the operator's design ("no check id", the writing levers' row 13); the round's
      tries spent 4.42 dollars refusing on the heading without the seat learning why;
    - whether a task with an earned practice fail stays in practice (`x-4-001` left it);
    - a dollar cap the host reads for a simulation: the round's 40 dollars was a note, not a limit.
12. **Leads from the round**:
    - a large tool result is unreadable from the Examiner's wall (cause confirmed, fix plausible).
      The CLI keeps a result of about 50,000 characters or more in its own configuration folder
      and hands the model the path; that folder is the session's host scratch, outside the seat's
      wall, so the seat's `read` gets EPERM on macOS and ENOENT on Linux. In `sim-exam625` this
      hit three Examiner sessions (x-2, x-3, x-4) on `read_example` results of 50,146 to 50,941
      characters, while one of 39,723 came back whole; each cost the seat a `bash` and a `read`
      before it read the examples one at a time. The CLI reads a tool's
      own limit from `anthropic/maxResultSizeChars` in the tool's `_meta`, which the vendored tool
      server (`vendor/pi-claude-bridge/mcp-server.ts`) does not send. The fix is a sed there that
      sends a limit above the largest result a seat tool returns, or a read grant on the session's
      `tool-results` folder; either is proved by one live seat turn returning a large result,
      which spends and so waits for the operator's word. Meanwhile `read_example` returns its task
      unindented (#621, `cf7eb121d`): of 201 recorded jobstat tasks, 31 passed 50,000 characters
      indented and 11 unindented;
    - `TOOLS CALLED` counted a harness's `.toolchain/bin` programs as `bash` (confirmed, changed
      on #629, `0ff38d540`): it now names the program each bash call ran first, so lane 16 sees
      which programs a new harness's solves used;
    - the Examiner's reseeding of one generator followed the host's reply asking for more tasks
      (item 8, counted there).
13. **Opposed, with the reason** (5 November):
    - naming the refusing check in a try's result. The operator chose "no check id"; naming it
      would let the seat tune a check on the reference's luck with a few tries, and the round's
      tries refused on the heading, whose cause item 7 fixes at the prompt;
    - (withdrawn on 5 November, about 06:00) changing the jobstat domain prompt: its validity sentence
      outranks the domain-agnostic text, so item 6 now carries a proposed sentence;
    - restoring a cap on the objective's share or loosening validity's weight after #623, asked
      by a third review so that a harness 35% better on the objective in 3 valid solves of 4 wins
      its task. Validity first is the design (`WEIGHTS`, `AGENTS.md` section 7): a deliverable that
      fails one time in four loses to one that never fails, and the weights are the step rule's;
    - a drafting rule that every task carries hidden values once an exam declares an objective.
      Truss's objective, the mass, reads none and is right to; item 6's sentence gives jobstat its
      hidden values instead. Asked to take one of the two opposed asks in a better form, this one
      was taken as a fact for the drafting seat (#621): a recomputation share is a measure the
      standard method reaches, so careful solves tie on it, while one read against the parameters
      the data were generated from leaves a better method room. The validity cliff has no case on
      record, so it stays opposed;
    - carrying a harness's `agent/tools.ts` into the JobBench export
      (`studies/shared/claude-export.ts`): none of the 33 kept jobstat harnesses declares a tool
      (`tools-spec.json` lists none), and their programs already travel in `scripts/toolchain/`,
      so a per-tool wrapper is machinery with no case behind it (rule 13);
    - putting the versions of packages a solve installs from the network into the condition. Both
      sides of a comparison install from the same mirror within one comparison, so a version moves
      only when a release lands mid-comparison, and the A/A beside it would show that drift; a
      pinned mirror is worth it only once a reading's A/A steps.

14. **Seat texts left to the operator, from the prompt audits of 5 November** (`AGENTS.md`,
    section 3: changing what a solver is told). Each was checked against the code:
    - `submit` (`src/tools/answer.ts`) says giving malformed "ends the task with no answer read";
      append "It counts as a solve with no valid answer." (`src/kernel/solves.ts` counts a flag as
      the flagging side's fail);
    - `HARNESS.md` (`src/harness/starter.ts`) and `src/solver/prompt.ts` promise "the size of the
      volume", which `environment()` never states; delete the phrase from both;
    - `HARNESS.md` says a harness tool's text is "at most 64 KB"; `tool()` shows about 49 KB and
      writes the rest to a file (`capped`, `src/tools/answer.ts`); say so;
    - the solver's addendum and `submit` both say the answer is `answer.json` in the answer
      format; keep it in `submit` and leave the addendum one sentence;
    - plausible, not taken: the Builder's status naming how many solves the next comparison holds
      at the reserve. No campaign on record ended `budget` on a comparison the Builder could not
      have foreseen, so it is machinery with no case (rule 13);
    - plausible, not taken: an Examiner told in its opening that a hidden value of `none` is a
      task with no hidden part; no session on record misread it.

15. **A fourth outside review of 5 November**, on #625 to #628:
    - #626 kept the Examiner's home only when the conversation's wall closed, so a host killed
      while it rested lost every ask's files. Confirmed and fixed on #626: each ask's rest keeps
      the home, with a test that fails without it;
    - the wait for a writing ask before a promotion (`context.examining?.done`,
      `tools/d2/campaign-actions.ts`) is load-bearing: it stays;
    - #628's worker count in `tools/runtime/gate.ts`: #628 is another session's, and the stack's
      top still spreads the caller's environment first, so the claim is that session's to read.

**Prediction for the first fresh campaign at this stack's top**, on record before its first solve:
its first candidate comparison that reports finds at least six tasks informative for the reference
under `informative` (`src/kernel/compare.ts`), after the usual set-asides. It is read as that count
over the tallied tasks, with the reference's per-task distribution and the points by measure beside
it. It tests usable supply, not promotion: six informative tasks need not give six wins or a step.
If no candidate comparison reports, it is unmeasured and the typed ending is what to explain.

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
- **5 November, by 03:30.** Two live simulations at the stack's top read the record above. A
  writing seat with `try_reference` proposed nothing (item 3). A whole round found the heading
  rulings of item 7. `live-seat.ts prompt` printed the writing prompt without the tries, so a seat's
  prompt is read from its first turn until that is fixed.
- **5 November, about 04:00.** The stack was proved up to #629 (every commit passed). The
  operator pasted an outside analysis of five proposals and asked "did we fix most or oppose
  purposefully?", then "What are the brittle choices here, as in what could you make a point off to
  both include or actually oppose?" The answer named the choices that one count could turn either
  way; the three that bear on the zone are items 7 to 9 (the heading rulings and the guard, one
  generator re-seeded, and #626's one conversation), each with the count that decides it.
- **5 November, about 05:00.** An outside review of revision `bfc32c41b` asked for item 7 to keep the
  heading cases apart from the statistical one, the pooled 8 of 29 qualified and what one label
  shows limited, item 9 read as monitoring, and the blocked practice of item 10 bounded. The
  operator pasted it, then "launch more subagents if you need to". The heading replay and the
  archive count of item 10 were taken then, and #625 carried the bounded release.
- **5 November, about 05:30.** The operator asked "did we fix the problems regarding jobstat trailing
  components / counterintuitive mechanisms", then "Ambitiously fix and append what's left, but do
  it in your way, or oppose purposefully". The heading fact went into the shared fairness text
  (item 7), the release cap's description was corrected (item 10), `TOOLS CALLED` learned the
  programs (item 12), the generator count was taken (item 8), the tool-results cause was found
  (item 12), and four asks were opposed (item 13). The operator then asked for two subagents to
  set every seat's prompt against what the system does and patch the missing hints.
- **5 November, about 06:00.** Two prompt audits set every seat's text beside the code. On #625 a
  practice check defect now closes its task in the log and is owed again, and the Builder is told
  every ending, the retained draw, the fails without an answer and the wait after a promotion; on
  #621 the Examiner is told how the Referee bears on the score, what a solver reads, the check's
  wall time and where its record gives the A/A, and the Referee its limits. The operator pasted
  three more outside reviews and said "The ORacle is also a name for a 2nd opinion actually,
  assume you're as smart as the oracle and can make changes here". Of their asks, two were taken
  (a grade at which the reference answers every solve now holds only with no better answer on
  record, and the objective is said to tie where the standard method reaches the best measure),
  one was found already true (a fresh fallback session opens with the whole record), the domain
  prompt's opposition was withdrawn (item 6), and two were opposed (item 13). The seat texts that
  are the operator's are item 14.
- **5 November, 11:23 UTC.** The campaign launched at `ca526ad1f` (#631) read the first step on a
  tuned jobstat prompt: its second comparison scored 13 won, 2 lost, 6 tied, p 0.0004, carried by
  the objective, and promoted. The A/A beside it read 4 won, 9 lost, 8 tied, a step the other way
  where none can be. A later comparison of the Starter against the promoted harness scored 6 won,
  12 lost, 3 tied. The Referee commits of #631 did not bear on the step: that log holds no
  `referee.call` and no rejection in 396 verdicts. The campaign at `11a330c60`, without those
  commits, holds 4 `referee.call` and one finding, ruled earned, and scored 11 won, 11 lost at its
  second comparison. The two differ in prompt text, host, exam draw and Builder draw at once, with
  one campaign each, so this does not say which change helped. Both are paused on a login limit
  with no ending.
