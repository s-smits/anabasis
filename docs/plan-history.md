# Where v2 stood: the plan's history at PR #91 and PR #168

The plan's account of where v2 stood when it was read, written at PR #91 (9 October) and again at
PR #168 (10 October), with the three reviews of 9 October and the second rounds of that day. It
was the section "Where v2 stands" of `docs/plan.md` until 11 October, and moved here so that the
plan keeps its present: the process, the fix plan with its level column, the climb plan and the
decisions (`docs/simplify.md`, T3). Nothing here is kept current; `docs/plan.md` and the source
at the stack's head are. Two more histories follow it: the packages of the simplification plan that
were done, and the building session's handover of 10 October, both moved here on 11 October.


v2 is read here at PR #91 (commit `c65f635`, 9 October), with PR #92 open above it. 37 pull requests are open, #56 to #92. PRs #17 to #55 were merged the same day, each into the branch below it, and main still stands at #15. PR #55 rewrote the exam for this plan. PRs #56 to #71 are fixes that the first live runs asked for, and PRs #72 to #76 build eight of this plan's items. PRs #77 to #79 answer what the first rounds on the rewritten starter showed, PR #80 brings the operator's skills, and PR #81 the contract for coding sessions. PRs #84 to #90 are the first rows of the fix plan: one start check, the setting recorded once, a promotion as an event, a session by itself, two budget units, and dead code removed. The stack builds Phase 0, most of Phase 2 and the cheap half of Phase 5, little of Phase 1 and nothing of Phase 3. The rewritten starter of PR #70 has met real models on buffer and recode, and the second rounds of both campaigns run from PR #80. Nothing above PR #80 has met a model. CI starts no job: GitHub reports that the account's payments failed or its spending limit is reached. The table sets v1's blockers against the stack.

*Read again at PR #168 (`14892d3`, 10 October).* The stack runs from #150 to #168, on the Mac's #150 to #152, #155 to #157, #163 and #164 and the building session's rows between them. Everything of the process is in source, and the loop has run ten campaigns from a prompt to a typed ending with paid models (t-1 to t-10, in a Linux container), three of them to a promotion and none to a second; buffer and recode ran over stored packs on the Mac. The rows of this revision are B13 to B17 and the decision on the draw: what stood between a promotion and the next epoch, found without a model. The paragraph above is left as it was written at PR #91.

| v1 blocker | What v2 does at PR #91 | Status |
| --- | --- | --- |
| Self-graded score | The reference harness and a new one solve the same held-out tasks afresh, and the host compares them in code (`src/kernel/compare.ts`). | Avoided |
| The answer is the author's own | A separate Examiner writes tasks. A task is held out once the shape of its package passes, and no solver has to pass it first. | Removed; first run on 9 October |
| A failed task usually meant a wrong check | The check program is still v1's, as imported. A rejection counts only once it is ruled a true fail; otherwise its task is set aside until a person labels it (`tools/d2/settle.ts`). The ruling is the Referee's, which has no shell and has not been measured against hand labels. | Partly addressed |
| A single fail is a flip | Every solve of one harness is paired with every solve of the other, each task counts once, and a sign test reads the tasks. | Addressed; first run on 9 October |
| Authors widen instead of deepening | The Examiner is told one outcome for every task of the campaign and no target (`src/examiner/record.ts`). No graduation step exists. | Open |
| A true fail was seldom followed up | The Builder gets the trace and a diagnosis for each practice fail, and every session opens with the list of failed practice solves, each marked open, repaired or failing again. | Addressed, unproven |
| Spend on uninformative runs | A launch is refused without a dollar cap, on a checker that was never read, and when the tie share on record leaves fewer untied tasks than a step takes (`tools/runs/launch.ts`). | Addressed; refused a real launch on 9 October |

Set against this plan, the stack stands as follows. The table says how each item of the plan is built, and the phase details below repeat it item by item.

| Item of the plan | How it is built | Where |
| --- | --- | --- |
| One gate for a task | A task is held out once the shape of its package passes. No solve and no stored answer has a say. | `src/kernel/task.ts`, `tools/d2/prepare.ts` |
| Starter Built Harness | It is pi's coding agent as pi releases it: `read`, `bash`, `edit` and `write` in one working directory, with no guide and no domain tool. Every campaign starts from it, and a Builder session copies the harness it starts from. | `src/solve/starter.ts` |
| The answer | A file, `answer.json`. `submit` reads it through the wall and holds it to the contract's answer format. No harness tool takes the answer, and a submit returns no verdict. | `src/solve/answer.ts` |
| Comparison in code | Every solve of one harness is paired with every solve of the other, a valid answer beats one that is not, each task counts once, and a one-sided sign test reads the tasks. The terms are logged before the first solve, and each solve names the comparison it was made for. | `src/kernel/compare.ts`, `src/builder/round.ts` |
| Round and checkpoint | A round is a Builder session followed by the comparison of the harness it left with the reference. A checkpoint compares two kept harnesses with no session, and `--noise` reads the reference against itself beside it; a comparison of one harness with itself alone is refused. Since PR #87 a session also runs by itself, with no comparison after it, which has not met a model. | `tools/d2/round.ts`, `tools/d2/checkpoint.ts` |
| Rulings before a rejection counts | The Referee rules a rejection a true fail, a check defect or unclear. Anything but a true fail sets the task aside for both harnesses. A person's labels then restore the task, dispute it or leave it out, and the report is written again. | `src/review/referee.ts`, `tools/d2/settle.ts` |
| The report | It holds the tally and its reading, each harness's valid answers at the full limit and at every budget, the spread between repeated solves, and the billed dollars. | `src/kernel/reports.ts` |
| Budgets | A budget is fixed before the first solve. `--solve-model-turns` gives a solve a number of the model's own turns: the solver is told it, every tool result shows the time used and the turn it is in, and a solve that uses its turns without an answer ends `turns-ended`. Shorter budgets are still read after the fact. One command gets a quarter of the time limit by default and half at most, and a command that would run into the solve's last minute is cut there and handed back. | `--solve-model-turns`, `--budget`, `tools/d2/setting.ts`, `src/solve/run.ts` |
| Dollar cap | Required for every comparison. It holds the comparison's solves and rulings, and in a round the session's spend, with a reserve for each solve. A comparison it cuts short reads `not-scored`. | `--cap`, `--reserve` |
| Launch refusals | A launch is refused with no held-out task, with no cap, on a checker that `accept.ts` has never read, under an id that already reported, on a loaded host, or when fewer untied tasks would be left than a step takes. That count comes from the last comparison under the same setting, and it counts no more tasks than the reference harness left to win. Since PR #84 one function decides this for the launcher and for a command started by hand. Row F42 names a way past it. | `tools/runs/launch.ts` |
| Scored set and practice | `prepare.ts --tasks` confirms for each named task that a stored accepted answer still passes today's verifier, and writes nothing. The scored set is named on the comparison itself, with `--tasks` or by the contract's draw. `--practice` releases tasks by a seeded draw, at most half of what is held. | `tools/d2/prepare.ts`, `tools/d2/round.ts` |
| Tasks nobody answers | A task with no valid answer stays held out as a tie. One with no valid answer anywhere on record goes to a person after two comparisons in a row that cut no solve of it at a limit, and is labelled with `--keep` or `--infeasible`. A valid answer under any harness and at any limits shows a task feasible for good (PR #76). | `src/kernel/reports.ts` |
| Examiner | It makes no solve. At its opening it is shown the public rules, each check's id and assertion, and one outcome for every task of the campaign. | `src/examiner/session.ts`, `src/examiner/record.ts` |
| What a harness may check | The Builder's prompt keeps one limit: no tool returns a finished answer for a task. | `src/builder/prompt.ts` |
| Stop rule and promotion | The reports say when three checkpoints have passed without a step. Since PR #84 the next launch is then refused, unless the operator overrides it with a reason, which is logged. Since PR #86 the operator promotes a harness with a command that writes an event, and a later command without `--reference` is read against the promoted harness. After a promotion a step must also not lose to the starter. | `src/kernel/reports.ts`, `src/builder/round.ts` |
| Kept harnesses | Each is kept under its digest with its tool tree beside it. A kept state that opens as another harness is refused before any solve. | `tools/d2/campaign.ts` |
| Rehearsal | A whole round or checkpoint runs on a seeded copy of a campaign, with a script in each model seat and no model called. | `bun run runs rehearse` |

**Built since PR #70,** in PRs #72 to #76:

- **The Builder's history** (`src/builder/memory.ts`, `src/builder/past.ts`). A session opens with three things. The notes are v1's, copied with their tests: `MEMORY.md`, `SCRATCHPAD.md` and the helpers under `scratch/`, carried from the last session's home. The list holds every failed practice solve of the campaign, each marked open, repaired or failing again. And each comparison is told as its tally and its reading, with no task named.
- **The Builder's tools** (`src/builder/tools.ts`, `src/builder/prompt.ts`). pi's four tools, a preview of what a solver reads and a reset. `HARNESS.md` gives each part of a harness one purpose: the programs and the tools of the harness's own compute, and the guide is words about them. Until 10 October it and the system prompt told the Builder to leave `tools.ts` empty while the solver had the shell, and no harness of the ten campaigns run under that sentence declared a tool; it was a second limit in a prompt (`AGENTS.md`, section 2), and the account now states what a tool and a program each cost a solve in tokens. A practice solve also returns the time, the turns and the tokens it used.
- **The checker's reading** (`tools/c/accept.ts`, `src/kernel/acceptance.ts`). `accept.ts` puts every control and the do-nothing answer to the checks and logs what each check was seen to do. A check its author's own computation decides is a fault until the operator admits it by name (`--admit`), and a freeze keeps the names.
- **A prediction** (`--predict`). One sentence is written with a comparison's terms before its first solve and printed beside the reading. It decides nothing.
- **A harness's control** (`programs-of:<harness>`, `tools/d2/campaign.ts`). It names the starter with that harness's installed programs alone, so that a step can be read against the programs without the guide.

**Built since PR #76,** in PRs #77 to #81:

- **What a Builder is told of a solve's limits** (PR #77, `src/builder/prompt.ts`, `src/builder/tools.ts`). The host tells the solver its limits, so a guide says nothing of time or turns. `practice` says when the last practice solve is gone. `finish` says once, without refusing, that the harness does not open or has changed since the last practice solve. In both truss sessions of 9 October the harness that went to the comparison was one no practice solve had run.
- **What the Diagnoser reads** (PR #78, `src/review/diagnoser.ts`; withdrawn with the seat on 11 October, `docs/simplify.md` E1). The guide the failed solve ran under, and how much of its limits the solve used. All of the first 12 diagnoses with real models had named the solver, from a reader that was never shown a guide.
- **A loaded host, named** (PR #79, `tools/wri/read.ts`). A solve's start holds the cores beside the load. The reader says when a comparison ran on a loaded host and when two comparisons ran under different loads. One harness answered the same seven buffer tasks in a median of 105 s under a load of 31 and of 40 s under a load of 6, with the same answers.
- **The operator's skills** (PR #80, `.claude/skills/`). Four of v1's, rewritten on v2's records: `run-improvement-campaign`, `attribution-and-proof`, `oracle-handover` and `stack-pr`. The first is the Harness Builder's loop as a procedure: walk, choose, prove, predict, launch, watch, read, decide.
- **A contract for coding sessions** (PR #81, `AGENTS.md`, with `CLAUDE.md` linked to it). It states the split of authority, the seats and what crosses from the exam side to the build side, the Harness Builder's handovers, how a comparison is read, fifteen rules and the lint habits, each put to this tree's linter. It holds no status and names this plan for that.

**Not built, each behind its gate:**

- **The Harness Builder,** the owner of a campaign (its first step is brought forward, see its section). Its loop is a skill since PR #80, and no code holds a campaign's state between commands. Rows F7 to F15 of the fix plan are published as PRs #84 to #92, the first owners of its controller, and none has run with a model. The gaps of the second review cluster here: the stop rule nothing acts on, the promotion that writes no event, the setting typed again on every command, the refusals a direct command skips, and the session that cannot run without a comparison.
- **The Judge** (Phase 1). The Referee has a probe tool and no shell, it reads the check program, and its rulings are not measured against hand labels.
- **An author for the correctness model** (Phase 1). A session that wrote one rule with its check, and a way to change the checker inside one campaign log, were written on 8 October and taken out of the branch a day later. Commit `410aee3` holds both.
- **The network in a solve** (Phase 2). Reopened on 9 October: closing it for harness tools alone would guard nothing, since a harness's programs run from the solver's shell. A registry-only proxy has a cost of its own: every two-hour solve under the old starter fetched the engine's source from its publisher, so such a proxy would decide the comparison for any harness that carries the engine.
- **The objective** (Phase 3, only if needed).
- **One Builder conversation across sessions,** and the process that holds it (Phase 5). It belongs to the Harness Builder's loop and is hooked to compaction as v1's was. The notes, the list of failed practice solves and the tallies are its fallback.
- **A Builder session without a comparison** (Phase 5). In source since PR #87 as a command of its own, with the defects of rows F42 and F43. It has not run with a model.
- **The path from the user's prompt** and the controller loop (Phase 6). A campaign opens over a stored v1 pack.

**Fixed outside the plan,** after the first live runs:

- **What a command leaves behind.** Nothing a command starts runs on after it returns, and whatever still holds a file on a solve's volume is ended when the command ends. A solver's leftover search had run for 36 minutes and taken a round with it. The solver and the Builder are told the rule (PRs #56, #58, #59, #61).
- **What a comparison counts.** A solve counts only for the comparison its start names, a comparison stands where it first reported, and a solve that opened another harness than its condition names is left out (PRs #55, #65).
- **A kept harness moves with its folder.** Its tool tree is linked by a name beside it, where a whole path broke when a campaign was moved (PR #64).
- **What the launcher counts.** A task held out since the last comparison counts whole, and no more tasks are counted than the reference harness left to win (PRs #63, #67).
- **The solver's tools.** v1's draft tools and the answer writer are gone. In 209 solves on record nobody restored or inspected a draft, and on truss 38 of 41 answers were typed into the writer straight after a command had printed them (PR #70).
- **An account of a harness for the Builder.** A session is handed `HARNESS.md` with a worked example. The first buffer Builder had written three tool files only to read the tool interface's source (PR #70).
- **Unmeasured CPU.** A command cut at its limit leaves its CPU unmeasured, and a task with such a valid solve is left out of a CPU budget's test (PRs #69, #70). Withdrawn on 11 October with the meter itself (`docs/simplify.md`, A3, PR #196): a solve reports no CPU figure.
- **Two more packs.** Buffer and recode were laid out beside truss, six tasks each, by a script kept outside the repository (PR #57).
- **Reviews.** The author's own review of the rewrite found six defects and an independent one nineteen more. All are patched, each with a test (PR #55).
- **Told time, and a command handed back.** Every tool result ends with the solve time used, and a command that would run into the last minute is cut there. Five of six failed practice solves had submitted an answer the solver's own check had refused, stopping early or out of time (PR #72).

The live record so far:

- **Gate 2, now removed:** the first Examiner sessions proposed 25 tasks. 14 were too hard at the stronger solve, 6 were refused on their controls and 5 were feasible (`docs/transfer.md`).
- **Second Examiner session:** $48.45 for seven tasks, five too hard and two too easy. No reviewer read the five rejections.
- **Rounds:** eight rounds on 8 October cost over $220 and scored no task.
- **Campaign `exam-1`:** 4 anchor tasks, 1 practice task and 2 candidates, under the design before PR #55. A round on it could not read a step.
- **First round on the starter, 9 October, buffer pack:** an Opus Builder forked the starter, and its harness was compared with the starter on 9 held-out tasks, 2 solves each. The result was 0 won, 0 lost and 9 tied, with all 36 solves valid, for $31.43. The tasks left no room at the full limit. Read after the fact, the new harness used fewer turns on 9 of 9 tasks, a median of 11.5 against 23 (PR #62).
- **First step, the same pack:** under a time limit of five minutes told to the solver, the Builder's harness won 7 tasks, lost 0 and tied 4 against the starter (PR #67).
- **Truss, a stored v1 harness against the starter:** 8 tasks, 2 solves each, $167.10. The starter won 3, lost 1 and tied 4, which is no step. 22 of 32 solves ended in a rejected answer, 14 of them on one check (PR #66).
- **The turn limit bound nothing.** It counts prompts, and every finished solve of the first rounds was given one. A budget has to count the model's own turns (PR #69).
- **Review:** an independent review of the branch found nineteen defects on 9 October, all patched (PR #55).
- **A new starter, the same day (PR #70):** the starter was rewritten as pi's coding agent, so it has another digest and every solver reads another prompt. No solve made before it counts for it. The results above were read on the old starter. Nothing is compared until the new starter has its own solves and one harness has been read against itself.
- **Two rounds from PR #67 at an eight-minute wall, while the starter was being rewritten:** buffer read a step of 5 tasks to 0 with 2 tied, and truss spent its six practice solves with one pass under its own harness. Under a five-minute wall three of buffer's tasks had no valid answer from either harness, though every solve of the same three had been valid at two hours (PRs #75, #76).

**On the rewritten starter, 9 October.** These figures are the runs session's status of 16:00Z. The logs were not read for this plan.

- **Buffer, round `b-1` at PR #70, eight-minute wall:** a step of 4 won, 0 lost and 3 tied (p = 0.0625). The starter was valid on 5 of 14 solves and the Builder's harness on 10 of 14. The tally was the same at 300 s, 2-0-5 at 180 s and at 8 turns, and 3-0-4 at 5 turns. All 34 solves ended by `submit` with a verdict, and all 15 rejections were ruled earned. No solver called `read` or `edit`.
- **Buffer, checkpoint `g1`, the repeat:** a step again, 4-0-3, with the starter valid on 3 of 14 solves and the harness on 9 of 14. The starter against itself read no step: 2 won, 0 lost, 5 tied. The host's load had a median of 47 to 80 on 12 cores, with three campaigns running, and one starter solve reached the wall.
- **Recode, round `b-1` at PR #70, Sonnet, thirty-minute wall:** no step at the full limit, 2-0-5, with the starter valid on 10 of 14 solves and the harness on 12 of 14. Three of four budgets read a step: 4-0-3 at 900 s and at 600 s, and 5-0-2 at 15 turns; 25 turns read 2-0-5. The median solve took 1,141 s and 16 turns under the starter, and 84 s and 5 turns under the harness. Only 2 of the 6 rejections carry a ruling.
- **Truss, round `b-1` on the old starter (PR #67), two-hour wall:** no step, 1 won, 1 lost, 6 tied, with each harness valid on 11 of 16 solves. The harness's median solve took 811 s against 2,062 s, at the same number of turns and the same cost. The solves cost $71.94.
- **Running now, from PR #80:** on buffer and on recode an Examiner session of 12 tasks, then round `b-2` with a repeat on a step, up to round 4. Buffer's round 2 is read against its round-1 harness, which was promoted by naming its digest.

**Second rounds, as the runs session posted them at 17:51Z.** Buffer's round `b-2`, against the promoted harness of round 1, reported at 17:16Z: no step, 1 won, 1 lost and 6 tied (p = 0.75). Each harness was valid on 15 of 16 solves. At the turn budgets the new harness lost 3 to none and 1 to none. The launcher's dry run then refused round 3 for too few untied tasks, also after one more Examiner session of 12 tasks, and a second Examiner session is running. Recode's round `b-2`, against the starter, was in its Builder session. Both campaigns run from PR #80, and the runs session will not move them to PRs #84 to #89 before rows F42 to F44 are fixed.

**Plan check by the building session, 9 October.** The building session read this plan against the source at PR #71 and confirmed that the items then listed as not built had no code. It has since built eight of them.

- **Published since as PRs #72 to #76,** and read for this plan at their accounts and in part in the source: the items listed above as built since PR #70, and the rule for tasks nobody answers.
- **What the new stack changes for a campaign on record:** every solver reads a new prompt, so it is one more new condition. A launch is refused until `accept.ts` has read the campaign's checker. Every check of buffer and recode is typed authored and reads as a fault until the operator admits it by name.

**Second review, 9 October: connections and consolidation.** Three independent reviewers isolated each component of the system figure and checked its connections against the source at PR #75 and against this plan. Each finding below was checked against the lines it cites, and the figure is revised from them. No code was run.

Each gap and each candidate for consolidation that it found is a row of the fix plan below, with its evidence. The reports are in the review kit.

What has to stay separate: the Examiner and the Judge, the Judge and the Diagnoser, the Judge and the hand labels, what the Examiner hears and what the Builder hears, and held-out and practice tasks.

**Third review, 9 October: the fix-row pull requests.** Three independent reviewers read PRs #84 to #89 at PR #91, one seam each, and ran the functions in scratch scripts outside the tree. Each row's own test is met at function level, and the wall holds: neither new event, nor text derived from it, reaches a message a Builder or a solver reads. Eight defects stand, which are rows F42 to F48 and the notes in Step 1. Two of them were found twice, and I read the lines behind the first three. None of these pull requests has met a model, a wall on macOS or a recorded log. The report is `REVIEW-3.md` in the review kit.

---

# The simplification plan's history, 11 October

The packages of `docs/simplify.md` that were done by main at `524c589` (PR #221), each whole and
in its own words, with the note that says where it was done: phase 1, packages A and B but B3, D1
and D2, phase 4 to W6 with what it read of the wall, E1, E3, R1, T1, T3 and T4, and the small
edges of section 11. They were the body of `docs/simplify.md` until 11 October, and moved here so
that the plan keeps the reading, the review, its rules and what is open. Section numbers in the
text are those of `docs/simplify.md`, where sections 1 to 10, 12 and 13 stay, and its order table
names the pull request of each package. Nothing here is kept current.

Phase 1 has no notes of its own. F1 and F2 were mended otherwise at PR #183, as the review of
11 October in `docs/simplify.md` says; F3 was done at PR #188, F9 at #189, F4 at #190, and F6
with W1 at #191. W5's note names PR #211; the change was PR #210, and #211 stands on it.

## Phase 1. Defects

Each is a small pull request that stands whatever is cut later.

### F1. The stop rule reads a promotion, and a reading that bought its repeat is not yet a move

- **Why.** Section 6, F1.
- **What changes.**
  - `stopRule` (`src/kernel/reports.ts`): the count of moves since the last gain starts again at
    a `harness.promoted` event, as it does at a report that read `step`. A pair whose last
    comparison cleared the campaign's trigger, and has no later comparison of the same two, is
    left out of the moves: it is one draw whose repeat is owed. The trigger is read from the
    opening (`campaign.opened`), where #178 pinned it.
  - `signP` is in `src/kernel/compare.ts` already, so the kernel imports nothing of
    `src/builder`.
- **Tests.** `test/reports.test.ts`: a 2-0 and a 2-0 with a promotion after them leave
  `sinceStep` at 0; a 2-0 as the sixth move leaves `stop` false until its repeat reports.
  `test/decide.test.ts`: the same log names the repeat and no ending.
- **On the recorded logs.** Replay. No campaign on record was promoted in two stages, so no
  recorded move should change; the body says so with the count.
- **Lines.** About +15.

### F2. A step and its repeat are the same two harnesses on the same tasks

- **Why.** Section 6, F2. The chance of a false promotion the plan gives (3.4% an attempt) is of
  one reading and its repeat. A window that slides over any two comparisons of a pair, with
  tasks written between them, is another test.
- **What changes.** `readTwice` (`src/builder/move.ts`) reads two reports where the earlier one
  cleared the trigger and the later one scored the same task versions (`versions` of both
  reports). `onStep` passes the trigger.
- **Tests.** `test/decide.test.ts`: 3-1, tasks written, 4-0 names a repeat of the 4-0 and no
  promotion; 2-0 and 2-0 on one set promote.
- **Needs.** Nothing: it restores the rule as `AGENTS.md` section 7 states it.
- **Lines.** About +10.

### F3. The Examiner hears what the reference harness did

- **Why.** Section 6, F3. Needs D5.
- **What changes.**
  - `outcomesOf` (`src/kernel/reports.ts`): the outcome of a task is read on the reference
    harness's side of the last comparison that scored it: answered in every solve, in some, in
    none. `exhausted`, `disputed` and "not yet compared" stay.
  - `SAID` (`src/examiner/record.ts`): three sentences for the three, in place of "one harness
    won", "a tie between valid answers" and "no valid answer yet".
  - `ROOM` (`src/examiner/prompt.ts`): its last sentence already points at "the outcomes above",
    and stays as it is. The system prompt's sentence that a task with no valid answer "measures
    nothing" stays too: F4 is what keeps a feasible task from reading as one.
- **The wall.** The outcome is of the reference harness alone. It names no other harness, no
  count of solves beyond "every, some, none", and no check. The test of rule 3 for the Examiner
  (`test/examiner.test.ts`) gains the hostile case: two campaigns that differ in which harness
  won a task give the same lines.
- **Tests.** `test/reports.test.ts` (the outcome cases), `test/examiner.test.ts`.
- **Lines.** About 0.

### F4. A task the host saw answered is feasible, and stays scored

- **Why.** Section 6, F4. Needs D6.
- **What changes.**
  - `tryTool` (`src/examiner/session.ts`): where the verdict is a pass, the desk keeps the
    instance's content hash (`contentOf`). Nothing of the answer is kept.
  - `propose_tasks`: a proposal whose content the desk holds as passed is logged with
    `feasible: true` on its `task.proposed` event.
  - `awaitingLabel` (`src/kernel/reports.ts`): a task proposed as feasible counts as one with a
    valid answer on record, which that fold already treats as settled "for good".
- **What it does not do.** It asks no answer of the Examiner. A task proposed with none tried
  goes to a person as today. Rule 9 stands: no answer is stored, and no solve is made.
- **Tests.** `test/examiner.test.ts`: a pass and then a proposal of the same content logs the
  fact, and a changed instance does not. `test/reports.test.ts`: such a task never awaits a
  label. `test/round.test.ts`: it stays in `scoredSet` after two comparisons without an answer.
- **Lines.** About +15.

### F6. Say what is capped on Linux

- **What changes.** The head comment of `src/verify/disk-cap.ts` and the header of
  `test/disk-cap.test.ts`: a solve, a Builder session and an Examiner session are uncapped on
  Linux, and why. `AGENTS.md` says so since this branch. No behaviour changes.
- **Needs.** A session that may edit `src/verify` (D8), though this is a comment.

### F9. Half of the failed tasks stay scored

- **What changes.** `releaseOrder` (`tools/d2/prepare.ts`): `rest` leaves out every task of
  `failed`, so the draw cannot release the half that was kept.
- **Tests.** One case beside the release's own.
- **Lines.** About +2.

## Phase 2. The controller

### Package A. One fixed budget a campaign (D2)

`AGENTS.md` section 1: "One fixed compute budget for both harnesses. No band and no levels." The
source holds a ladder all the same. Since #167 it is the fallback behind the tasks, the plan's
levers of 10 October, 22:15 name no budget, and its account of t-10 is that with the budget
first the campaign "climbed in turns". The objective (#184) is the second way to room now.

What stays through all four: `--solve-model-turns` as the one number told to the solver and
held, `--solve-minutes` as the wall of a solve, a time limit a command, and the operator's word
to open another campaign under another budget.

What would show the package wrong: a recorded campaign in which an Examiner asked for room held
out nothing for its whole patience, and a rung of the ladder then read a step on tasks the
reference harness failed at the full limit. On record a rung read its steps on tasks both
harnesses answered at the full limit (t-10, the handover of 10 October, below).

#### A1. The table without the ladder

- **What goes.**
  - `src/builder/decide.ts`: the rung in `harder` (it becomes `written`), `tried`, the two
    full-limit branches of `onStep` (it becomes: the pair read twice, promote), the longer-rung
    half of `tooHard` (it becomes: tasks written since are compared on, else other tasks), the
    setting index in `afterPromotion`, and the last three paragraphs of the head comment.
  - `src/builder/move.ts`: `budgetBy`, `toBudget`, `budgetSaid`, `vouches`, `held`, `HALF`,
    `versionsOf` unless F2 keeps it, the move `budget` of `Decided` and its line in
    `decidedLine`.
  - `src/builder/ground.ts`: `Under`, `settingsOf`, `under`, `rest`, `settings`, `turns`; `here`
    is `all`. `Plan.limit` and `Plan.ladder`.
  - `src/builder/opening.ts`: `ladder` and `limit` as terms of the table. The limit stays as the
    setting's.
  - `tools/d2/harness-builder.ts`: `--ladder`, `ladderOf`, the arm of `make` for a budget move,
    the import of `rebudget`, and the `--budget turns=` flags `comparisonOf` adds.
  - `tools/d2/setting.ts`: `rebudget`.
- **Tests.** `test/decide.test.ts` names the ladder 18 times and the full limit 22 times in 42
  cases; `test/harness-builder.test.ts` 5; `test/admission.test.ts` 2; `test/handover.test.ts`
  1; `test/setting.test.ts` 5 for `rebudget`. The cases of the ladder go. The cases that prove a
  promotion through a full-limit reading are rewritten to the plain promotion first.
- **Docs.** `AGENTS.md` section 6 (the paragraph on `--ladder`, the flag line of t-9) and
  section 7 ("The budget", and most of "What follows a reading"); the skills
  `system-path-simulation` and `run-improvement-campaign`.
- **On the recorded logs.** Replay. A campaign that walked the ladder (t-4, t-9, t-10) reads
  another next move after its last comparison, and the body lists them.
- **Lines.** About −280 (*estimate*).
- **Done** at PR #193 (11 October), as written, with two differences: `here` is the comparisons since the setting's last record (no reading across two settings, kept until A4), and `Opening.limit` stays, since the controller names `--solve-model-turns` from it for a campaign from a prompt.

#### A2. A comparison read at one budget

- **Depends on.** A1: `budgetBy` and `tooHard` are the readers of a report's rows by budget.
- **What goes.**
  - `src/kernel/compare.ts`: `Budget`, `UNITS`, `over`, `within`.
  - `src/builder/comparison.ts`: the rows a report holds for each shorter budget (`budgets`),
    `asBudget`, the key in `REPORT_KEYS` and in `Fixed`.
  - `src/builder/round.ts`: `Terms.budgets` and their refusals in `refuseTerms`.
  - `src/kernel/reports.ts`: the `turns` parameter of `validAt` and of `roomOf`.
  - `tools/d2/round.ts`: `--budget`, `budgetsNamed`, the lines of `validLines` by budget.
    `tools/d2/checkpoint.ts`: the same flag. `tools/d2/harness-builder.ts`: the budgets in
    `termsOf`. `tools/d2/close.ts`: its two lines.
  - `tools/wri/folds.ts`, `tools/wri/read.ts`: the lanes that read a report by budget.
- **What is not touched.** `tools/d2/word.ts --budget <dollars>` is the campaign's total and has
  nothing to do with this.
- **Tests.** `test/compare.test.ts` (15 mentions), `test/round.test.ts`, `test/wri-read.test.ts`,
  `test/campaign.test.ts` (5).
- **Docs.** `AGENTS.md` section 7; the skills `launch-run` and `whole-run-investigation`
  (`references/lanes.md`, 8 mentions).
- **Lines.** About −200 (*estimate*).
- **Done** at PR #194 (11 October), as written. A report written before holds its `budgets` rows and no reader reads them; a settling of a comparison that began with shorter budgets is refused, since the settled report would drop them.

#### A3. A solve's use in two figures

- **What goes.**
  - `src/solve/command.ts`: the `times` record, `childSeconds`, `CommandWall.cpu`, and the last
    paragraph of the head comment. `src/solve/run.ts`, `src/builder/session.ts`,
    `src/examiner/session.ts`, `tools/m0/live-solve.ts`: the `cpu` they pass.
  - `src/kernel/compare.ts`: `cpu`, `unmeasured` and `prompts` of `Used`, `MEASURED`, `spread`
    and `Spread`. The report's `spread`.
  - `tools/wri/folds.ts`, `tools/wri/read.ts`: the CPU lanes (`unmeasured`, `cut`).
  - `--solve-turns` as a flag (`tools/d2/setting.ts`, 11 mentions; `harness-builder.ts`,
    `launch.ts`, `round.ts`, `campaign.ts`, `opening.ts`). The cap on nudges stays as the
    constant of `LIMITS` it defaults to.
- **Why.** The plan lists a budget in CPU seconds as withdrawn, and the meter reads zero under
  Bubblewrap. `setting.ts` says of `--solve-turns` that it "bound no solve". `spread` was what
  decided the budget's unit, which is decided.
- **Tests.** `test/command.test.ts` (5), `test/compare.test.ts` (3), `test/wri-read.test.ts` (3),
  `test/coding-tools.test.ts` (3), `test/solve-run.test.ts` (2), `test/setting.test.ts` (8),
  `test/runs-launch.test.ts` (3), `test/campaign.test.ts` (3).
- **The condition.** `limits` keeps its field for the prompt count, so a condition's form does
  not move. A `solve.finished` written before this holds `cpu`, and nothing reads it afterwards.
- **Lines.** About −170 (*estimate*).
- **Done** at PR #196 (11 October), as written, with one addition: `Used` keeps the billed dollars alone, since nothing read a pair's turns or seconds once `within` and `spread` were gone; `Recorded` holds no `turns`, and a record on the log with another count than `LIMITS.turns` is refused.

#### A4. A setting is recorded once and does not change

- **Depends on.** A1.
- **What goes.** `--new-setting` (`tools/d2/setting.ts`, 13 mentions of it and of `restarts`;
  `launch.ts`, `round.ts`, `checkpoint.ts`); `restarted` of `Wanted` and its use in `sized`
  (`src/builder/admission.ts`); the outcome `earlier-setting` (`reports.ts`, `record.ts`); the
  setting filters of `stopRule` (`from`), of `exhausted` and of `outcomesOf`.
- **What stays.** `campaign.setting`, written once; the refusal of a flag that names another
  setting; `firstRecord`, which holds a first record to what the log's solves ran under.
- **Tests.** `test/setting.test.ts` (15), `test/decide.test.ts` (3), `test/admission.test.ts`
  (2), `test/reports.test.ts` (3), `test/campaign.test.ts` (2), `test/runs-launch.test.ts` (2).
- **Lines.** About −100 (*estimate*).
- **Done** at PR #198 (11 October), as written, with one addition: the setting filter of `supplyOf` and the `stood` report `groundOf` passed it go too, and `Ground.here` is `all`. The filters read the setting id, which names the host's code, so a tree moved to a new commit between two comparisons had begun the stop rule, the exhausted tasks, the untied share and the Examiner's outcomes again.

### Package B. A comparison without its extras

#### B1. The noise arm is the operator's flag (D3)

- **Why.** The reference against itself costs half as many solves again beside the first
  comparison under a setting. The table reads only whether one was made (`noiseRead`), never
  what it read. The plan's measure M2 is a count of such controls, which a checkpoint by hand
  gives.
- **What goes.** `noiseRead` and every `"noise"` argument of `compare` in
  `src/builder/decide.ts`; the `noise` field of the move and its words in `decidedLine`; the
  three-sides arithmetic of `afforded` (two sides always); `--noise` in `comparisonOf` and
  `termsOf` of the campaign command.
- **What stays.** `--noise` on `tools/d2/checkpoint.ts`, `halves` in `src/kernel/compare.ts`, the
  report's `noise`.
- **Tests.** `test/decide.test.ts` (23 mentions), `test/harness-builder.test.ts` (5).
- **Lines.** About −60 (*estimate*).
- **Done** at PR #200 (11 October), as written. `afforded` still reads three sides off a comparison the operator asked for with `--noise`, since the next bills two.

#### B2. The starter's tally is a line of the report (D4)

- **What goes.** The readings `below-starter` and `starter-unread` as values a comparison
  writes (`Reading`, `reading()` in `src/builder/comparison.ts`); the third arm of a comparison
  and its completion (`src/builder/round.ts`); the row of `afterComparison` for
  `starter-unread`; the pair rule of `stopRule` for a harness set against the starter
  (`referenced`).
- **What stays.** The two words stay readable in a recorded report. The starter is still the
  control after a promotion (`onReference`), which is where the plan reads whether the starter
  loses more pairs each epoch (its measure M1).
- **Tests.** `test/round.test.ts`, `test/reports.test.ts` (3), `test/handover.test.ts` (2),
  `test/decide.test.ts` (2), `test/wri-read.test.ts` (5).
- **Lines.** About −90 (*estimate*).
- **Done** at PR #201 (11 October), as written, with one addition: the report's `against` goes too, since no comparison solves the starter as a third side, and the investigation's `BELOW THE STARTER` and `STARTER UNREAD` triggers with it; the Builder's words for the two readings stay (`src/builder/past.ts`), for a log of before.

## Phase 3. One record of a task, one way to start a move

### Package D. The campaign command is the one way to start a move (D7)

#### D1. The view prints the table's move, once

- **What goes.** `nextMoves`, `Asked`, `Move` and `UNCOMPARED` (`src/builder/handover.ts`, about
  90 lines), and their lines in `tools/runs/view.ts`.
- **Mends.** F7.
- **Tests.** `test/handover.test.ts` (4 mentions).
- **Lines.** About −110 (*estimate*).
- **Done** at PR #199 (11 October), as written, with the imports and the one constant only
  `nextMoves` read (`STEP`). The view still parses a launch's flags, since the table reads
  `--level`, `--trigger`, `--past-stop` and the setting's; the move list's case of
  `test/handover.test.ts` goes whole (5 cases), the view's case says that no move but the
  table's is printed, and the rehearsal of `test/checker-commands.test.ts` reads a launch's
  refusals from the launcher alone. The source loses 135 lines (153 out, 18 in); AGENTS.md section 4, the
  `launch-run` and `run-improvement-campaign` skills say the same.

#### D2. The launcher starts nothing

- **What goes.** In `tools/runs/launch.ts`: `launch`, `preflight`, `sessionPreflight`,
  `examPreflight`, `refused`, `passedOn`, `settingFlagged`, `askedFlagged`, `flagsRefused`,
  `commandOf`, `start`, `endedEarly`, `reportedAs`, `sessionTaken`. The verb in
  `tools/runs/cli.ts`. `--loaded`, `--env-file` and `--no-comparison` as the launcher's.
- **What stays.** `stop`, `family`, `leftOpen` and the receipt (`receiptOf`, `writeReceipt`,
  `launchesOf`), in a file named for them. The campaign command already waits for the host's
  load and keeps a receipt a run.
- **What replaces a launch.** One paragraph of the skill: the campaign command, niced, in a
  process group of its own, with its output to two files and the key in Bun's `--env-file`.
- **Tests.** `test/runs-launch.test.ts` (376 lines, 20 cases): the cases of `stop` and of the
  receipt stay.
- **Docs.** `AGENTS.md` section 6 (the block of `bun run runs`, the two paragraphs on the
  launcher and on admission); the skill `launch-run` is rewritten as "start and stop a
  campaign"; `run-improvement-campaign` (5 mentions).
- **Lines.** About −420 (*estimate*).
- **Done** at PR #211 (11 October), as written, with two differences: `passedOn` moves into
  `tools/runs/rehearse.ts`, its one reader, in place of going; and `runs view` parses its four
  flags itself and reads the campaign's opening for the terms it does not name, where it had
  parsed a launch's. Two files hold what stays: `tools/runs/stop.ts` and `tools/runs/receipt.ts`.
  The deferral below was met the same day: the session on the Mac starts its campaigns through
  the campaign command.

## Phase 4. The wall (D8)

This session could not edit `src/verify`: its permissions refuse a change to the wall's rules.
The phase is for a session on the operator's host, and every package runs the suite on macOS
and on Linux.

### What a seat's commands run under today

*Read* in `src/solve/command.ts` and `src/verify/solve-command-isolation.ts`.

- Three writable directories a command (`work`, the session `home`, a private `tmp`), a fresh
  `run-*` made and removed around every command, a profile file staged for each, and a policy
  rebuilt and hashed for each.
- Two layers of policy identity (`policyHash` of the session and of the command). Their one
  reader in v2 is the key of two per-process memos (`PROBED`, `REACH`). The condition records
  the profile's name, the platform and the disk bytes, and no policy hash (`recordedUnder`,
  `tools/d2/campaign.ts`).
- Programs `withheld` inside the tool tree: a field no caller sets and no test names.
- Seven name patterns for folders under the temporary directory. Three have a maker in v2: the
  verifier's cells (`ana-cell-`), the reviewers' and the Examiner's backend state
  (`ana-claude-cli-`), and the seats' own parent (`ana-built-bash`). Four are spelled in
  `wall-policy.ts` alone.
- v1's run-data patterns (`/correctness-model`, `/domains/<slug>/…`, `/campaigns/`, `/.env`,
  `hidden-tasks.json`) and its scan for peer checkouts. **These are what closes a stored pack
  today** (F10), so they go only once W5 closes a pack by name.
- The worktrees, read once a campaign (`worktreesOf`).

### The form to reach

By `AGENTS.md` section 2, consequence 6. A wall keeps three things, and each gets one rule.

| Kept | Rule |
| --- | --- |
| The exam side's hidden values | closed by name: the repository and its worktrees (or the campaigns' home, W7), a stored pack's root and bundle, and one host root that holds the verifier's cells and the reviewers' backend state |
| The operator's credentials | the home closed whole, with the runtimes and toolchains under it opened again read-only |
| One seat's files from another's | the parent of the seats' roots closed, and the seat's own root opened again |

A seat writes its one root, whole. `HOME`, `TMPDIR` and the staging folder are subfolders of it.
Reads are open otherwise. The network is open for a seat and closed for a check.

### W1. Names with no maker and no reader

- **What goes.** `withheld` (the field of `CommandDirectories`, of `CommandIsolationPolicy` and
  of both identities, `withheldKey`, its Seatbelt rule and its Bubblewrap binds);
  `PROTECTED_HOME_NAMES`; the four temporary names with no maker (`ana-pi-built-`,
  `ana-reference-solve-cwd-`, `ana-generated-tools-`, `ana-verifier-cache` with
  `VERIFIER_CACHE_STORE`).
- **Behaviour.** None changes: an empty list, an unread constant, and patterns that match no
  path v2 makes.
- **Tests.** None names `withheld`.
- **Lines.** About −50.

### W2. The probe goes through the launch in use

- **Mends.** F5.
- **What changes.** `walledBase` (`src/solve/command.ts`) probes as `networkReach` does, by
  commands through `runWalled`, once a policy a process: a read of a canary in the repository
  is refused, a read of the first other worktree's `package.json` is refused, and a write and a
  read under the seat's root succeed.
- **What goes.** `isolationArgv`, `runUnderPolicy`, `probeHostSolveReadDeny`, `judgeSteps`,
  `linuxMoveGuardCheck`, `observedRefusal`, `HostSolveIsolationEvidence`, the two fixture names
  and `liftDeniesCovering` (313 lines of `src/verify/solve-sandbox.ts` from `isolationArgv`
  down, *read*); `probeMoveGuardCheck`, `runIsolationProbe` and `MoveGuardCheck` (75 lines of
  `src/verify/seatbelt-path-guard.ts`, *read*); `bwrapIsolationArgs` and `bwrapWholeRootArgs`
  where nothing else calls them; the `cap` of `SolveIsolationPolicy`, which only that launch
  mounted.
- **The discrimination step.** The probe today lifts the denial and reads again, to show the
  refusal was the rule's and not a broken mechanism. The read under the root does the same for
  the launch: a mechanism that refuses everything fails it.
- **Tests.** `test/solve-sandbox.test.ts` (301 lines, 15 cases) is rewritten around the new
  probe, and `test/command.test.ts` gains the three reads. #185's Linux case already goes
  through the command wall.
- **Lines.** About −370.
- **Done** at PR #197 (11 October), as written, with three differences: the policy's `profile`
  (the Seatbelt text and the Linux descriptor) goes too, since only `isolationArgv` read it;
  the probe is one command, which prints each read's outcome and then writes and reads back
  under the seat's folder; and with the cap gone from the policy, a tree has one policy, so the
  probe runs once a process where the cap's root put it in every seat's hash before.
  `bwrapIsolationArgs` stays, since `bwrapBaselineArgs` builds on it. The source loses 559 lines
  net (685 out, 126 in); the tests are rewritten at about the same length.

### W3. One policy a seat, built once

- **What changes.** `commandIsolationPolicy` takes the seat's root and builds one policy for the
  session or the solve. `runWalled` stages a caller's files in a fresh folder under
  `root/staging`, starts the command there or in the home, and removes that folder afterwards.
  `TMPDIR` is `root/tmp`.
- **What goes.** `commandDirs`, `RunDirs` as two paths, the `ENOSPC` fallback that exists
  because a fresh `run-*` could not be made on a full volume, the profile file a command and its
  removal, the policy and hash a command, the three scratch roots in the identity,
  `CommandIsolationIdentity`, `BUILT_COMMAND_ISOLATION_FIXTURE` and
  `LINUX_COMMAND_ISOLATION_DESCRIPTOR`.
- **What a command loses.** A `TMPDIR` that is empty at its start. A seat's temporary files now
  last the seat. That is the grant made whole: one seat, one root.
- **Collision.** None between seats: each has its own root. Inside a seat one command runs at a
  time, and `endHolders` is called after each.
- **Tests.** `test/command.test.ts` (321 lines), `test/coding-tools.test.ts`,
  `test/harness-tools.test.ts`, `test/disk-cap.test.ts`.
- **Lines.** About −200 (*estimate*).
- **Done** at PR #203 (11 October), with one departure: the seat's commands write its root but for
  one folder in it, `kept`, which the host alone writes. A root writable whole would let pi's long
  output, which the host writes while the command runs, follow a link the command made, and a
  check before the write cannot close that race. Nor does the host stage a command's files where a
  command can write. A process that outran its command and holds no file on the volume escapes
  `endHolders` on Darwin, so it could swap the folder for a link between the host's check and its
  write. So a command's files are staged in a fresh folder under `kept`. The command copies them
  into a folder it makes under its `TMPDIR`, starts there, and removes that folder when it ends.
  The probe gains a step: a write in `kept` is refused. The policy is still taken for each command,
  as a pure function of the seat's folders and its tool tree, because a Builder's `.toolchain`
  grows during its session and its preview runs another harness's tree on the same seat. It is
  staged to one profile file a seat. `inHome` goes, as every command that brings nothing starts in
  the home. The solver's prompt now says `$TMPDIR` is kept for the whole task. A write outside the
  home but inside the root, such as pi's write to `../escape.txt` from the home, now lands in the
  seat's own root; the Builder's case reads the refusal one level up. The source loses 64 lines
  net (268 out, 204 in).

### W4. The host's own scratch under one closed root

- **Why.** The verifier's cells hold a check program and a task's hidden value, and the
  reviewers' and the Examiner's backend state holds what they read. Both are made under the
  shared temporary directory (`src/kernel/verify.ts:378`, `src/review/reader.ts:61`,
  `src/examiner/session.ts:389`, `src/examiner/draft.ts:463`), and closed there by a name
  pattern on Darwin and by the overmount of the temporary directory on Linux.
- **What changes.** They are made under one host root beside the seats' parent, which every
  seat's policy closes by path. The remaining temporary name patterns
  (`VERIFIER_TEMP_SIBLING_DENY_PATTERNS`, `COMMAND_TEMP_SIBLING_DENY_PATTERNS`) go.
- **What stays.** Darwin's grant of the user temporary directory to toolchains that ignore
  `TMPDIR` (`userTempRules`). That is the platform's, and the collision it leaves between seats
  is stated in `src/verify/disk-cap.ts`.
- **Lines.** About −40 (*estimate*).
- **Done** at PR #204 (11 October), as written. The root is `$TMPDIR/ana-host`, beside the seats'
  `ana-built-bash`, made at mode 0700 by `hostScratch`. `hostRoots` names both roots in both path
  forms, and each Darwin wall denies them whole: the command wall where it denied the seats'
  parent, the verifier's after its temporary grant. A check's cell lies in the host's root, so the
  verifier opens the folders above the cell to `lstat` alone, as the command wall does for a seat,
  and the cell after them. All seven patterns go, the four with no maker that W1 left for a change
  proved on the Mac among them, and `userTempRules` only grants. Linux changes nothing: the
  verifier binds only what it names, and the command wall overmounts the temporary directory. The
  source loses 25 lines net (98 out, 73 in).

### W5. A stored pack is closed by name

- **Mends.** F10.
- **What changes.** `Walled` carries the pack's root and bundle where a campaign opened over
  one, and `solveIsolationPolicy` closes them as it closes the repository. The harness's tool
  tree is opened again by path, as it is today.
- **What goes.** `RUN_DATA_DENY_PATTERNS`, `runDataDenyRules`, `RUN_DATA_NAMES`,
  `runDataDenyPaths`, `HIDDEN_TASKS_DENY_PATTERN`.
- **Tests.** A wall test on each system: a file under a pack's `correctness-model` is refused to
  a solve's command, with the pack in a folder that carries none of the three names beside it.
- **Lines.** About −70 (*estimate*).
- **Done** at PR #211 (11 October), as written. `tools/d2/campaign.ts` and `tools/m0/live-solve.ts`
  name the pack's root and bundle; a campaign that opened from a prompt names none, as its exam
  lies under `.ana` in the repository. A solve, an examination and a Builder's session pass them to
  `solveIsolationPolicy`, which closes them with the repository, its other worktrees and the home.
  On the Mac nothing a command sees changes: the home is closed whole, and every pack lies under
  it. On Linux a pack outside the home is now closed by its path. `test/command.test.ts` puts a
  pack in the temporary directory, its hidden file under `fixture/workspace/correctness-model`: a
  command is refused it on both systems, and on Darwin reads it where the policy names no pack,
  which shows that no folder's name closes it. The Linux half was not run here. The source loses
  62 lines net (115 out, 53 in).

### W6. A check runs under the same wall, with the network closed

- **Why.** Nine files hold the verifier's default-deny wall and its attestation, 1,700 lines
  (*read*): `exact-read-attestation.ts` 355, `read-root-attestation.ts` 319,
  `darwin-seatbelt.ts` 400, `os-isolation.ts` 175, `darwin-runtime-closure.ts` 155,
  `linux-bwrap-verifier.ts` 150, `isolation-description.ts` 88, `engine-cell-env.ts` 39,
  `verifier-port.ts` 19. v1 needed them because its Builder wrote the checks. An answer here is
  data, and a check is the exam side's code.
- **What stays.** Everything that makes a check's inputs a contract and is no wall of the
  system's: one fresh process a check, the projection of the answer and the task to the declared
  paths, one check's own hidden value, the copy of the check program in the cell, the tool tree
  as the only place a check's tools are found, the time limit and the reaping.
- **What changes.** `runCheck` (`src/kernel/verify.ts`) launches the check's process through
  the command wall with the cell as its root and the network closed. `plan.verify()` before and
  after, and the non-result "the wall changed while the check ran", go.
- **What goes.** The attestation files whole, the verifier's plans on both systems, and the
  parts of `os-isolation.ts` and `darwin-seatbelt.ts` that serve them. The part that finds the
  mechanism for both walls stays (`osIsolationSupport`, `darwinSeatbeltSupport`,
  `linuxBwrapSupport`). About 1,400 lines go (*estimate*).
- **The test.** `bun tools/m0/regrade.ts` over the stored verdicts, which matched 100 of 100 on
  truss (`docs/transfer.md`), is to match again. Then `test/verify.test.ts` and
  `test/acceptance.test.ts`.
- **What I could not establish.** What a check program's tools read outside the tool tree. The
  regrade is what says.
- **Tests that go.** `test/exact-read-attestation.test.ts` (149 lines),
  `test/read-root-attestation.test.ts` (140), `test/linux-bwrap-verifier.test.ts` (278), and most
  of `test/darwin-seatbelt.test.ts` (500).
- **Done** at PR #217 (11 October), as written. A check's cell is a seat's root: `home` and `tmp` in
  it, the program in its `kept`, which the check reads and cannot write, and the profile beside it.
  The check is launched through `isolatedArgv`, the argv a seat's command takes without its shell,
  with the network closed: Darwin `(deny network*)`, Linux `--unshare-net`. Its base is
  `solveIsolationPolicy`, with the check child's sources opened again by path. `openVerifier` takes
  the worktrees and the pack a campaign closes, so on Linux a pack outside the home is closed to a
  check as it is to a seat. A seat's policy hash does not move, as the network is named in it only
  where closed. Seven files go whole. `darwin-seatbelt.ts`, `os-isolation.ts`, `linux-bwrap.ts` and
  `wall-policy.ts` keep what the command wall uses; the bwrap canary now runs under the open-read
  posture. The regrade matched: truss 100 of 100, buffer 5 of 5, recode 10 of 10. The command wall
  no longer lets a command list the shared temporary directory on Darwin, as Linux's overmount
  leaves it empty. Bun lists each ancestor of its working directory as it starts, which the
  verifier's own wall had refused, and with 33,673 entries in that directory the truss regrade took
  68 s against the base's 43 (medians of four, interleaved). With the rule it took 43 and 32 s
  against 48 and 54. `test/verify.test.ts` gains a check whose tool compiles with `/usr/bin/cc`.
  `test/linux-bwrap.test.ts` keeps the support, refusal, resolver and runtime-prefix cases of the
  deleted test. Two things the verifier's own wall refused are open to a check now, as they are to a
  seat's command: a Mach lookup of the keychain and consent services, and a signal to a process
  outside the wall. A keychain read has no way out, since the network is closed and the cell is
  removed; a signal can end a host process. The source loses 1,855 lines net (2,086 out, 231 in),
  against the estimate of about 1,400.

## Phase 5. Seats and readers

### E1. No Diagnoser (D10)

- **Why.** 12 of 12 diagnoses of 9 October and 8 of 8 of 10 October named the solver
  (*record*). The Builder is handed the trace and the ending either way. It is a model call a
  failed practice solve.
- **What goes.** `src/review/diagnoser.ts` (350 lines, *read*) with its 6.9 kB prompt; the
  diagnosis in `src/review/agreement.ts`; `diagnosisText` and its place in a practice result
  (`src/builder/tools.ts`); the diagnoses of `src/builder/past.ts` and
  `src/builder/handover.ts`; the seat's wiring in `src/builder/session.ts` and
  `tools/d2/campaign.ts`; `--diagnoses` and the blind packet of #182 in `tools/d2/settle.ts` (28
  mentions); the lines of `tools/d2/close.ts` (11).
- **What stays.** `diagnosis.recorded` and `diagnosis.labelled` stay readable. The Referee and
  the reviewers' shared reader stay.
- **The wall.** A practice result loses one paragraph. The test of rule 3 for the Builder
  (`test/builder.test.ts`, "what crosses to the Builder") passes with fewer bytes on both sides.
- **Tests.** `test/review.test.ts` (39 mentions in 24 cases), `test/builder.test.ts` (11),
  `test/handover.test.ts` (8), `test/harness-builder.test.ts` (14).
- **Docs.** `AGENTS.md` sections 1, 3 and 14; the skill `whole-run-investigation` (about 23
  mentions).
- **If the operator keeps it.** Its measure is then the labels of #182, and this package waits
  for ten of them.
- **Lines.** About −500 (*estimate*).
- **Done** at PR #205 (11 October), as written. The wall test's hostile case leaks through a practice solve's trace in place of a diagnosis. `src/review/trace.ts` loses `stringOf` and `turnsOf`, which only the Diagnoser read.

### E3. The Builder's prompt says each fact once

- **Why.** The Builder's text grew at nearly every checkpoint, mostly a sentence a failed run:
  its system prompt from 3,498 to 5,250 characters, and `HARNESS.md` to 9,569 (a trace of the
  stack I did not recheck; the instrument reads `src/builder/prompt.ts` at 5,135 bytes on main
  and 9,751 at #183). Three pull requests answered one failure, a harness no practice solve had
  run, with words (#77, #93, #156) (*bodies*).
- **What changes.** The sentences that restate what a tool result already ends with go from the
  system prompt: the time and turns used, the practice solves left, that no practice solve has
  run the harness. `HARNESS.md`'s guide outline gains a tool beside its "Programs" heading, so
  that the worked example does not steer to programs alone.
- **Tests.** `test/builder.test.ts`, `test/starter.test.ts`.
- **Lines.** Text only.
- **Done** at PR #207 (11 October): the system prompt loses the sentences that restated the limits and what a tool result ends with (its last paragraph from 1,071 to 884 characters), and keeps one on what a reply counts as; the guide outline of `HARNESS.md` is "Programs and tools", with the worked tool as its second entry.

### R1. No reader across campaigns

- **What goes.** `tools/runs/compare.ts` (364 lines, *read*), its verb,
  `test/runs-compare.test.ts` (353 lines), the skill `model-condition-comparison`.
- **Why.** `AGENTS.md` section 9: "Results are never compared across campaigns, and never across
  two settings." Two harnesses are set side by side by a checkpoint.
- **Done** at PR #206 (11 October), as written. The skills that named the verb point at a checkpoint or `runs view`.

## Phase 6. Text and tooling (D12)

### T1. The lint habits beside the linter

- **What changes.** `AGENTS.md` section 12 (24.7 kB, a quarter of the file) moves to
  `tools/oxlint/HABITS.md`. The contract keeps ten lines: the gate, strict mode, never turn a
  rule off, and where the habits are. A session that writes no code does not read them.
- **Done** at PR #208 (11 October): `tools/oxlint/HABITS.md` holds the thirteen parts under their numbers, and section 12 keeps four lines of contract with a pointer; `AGENTS.md` from 88.9 kB to 77.4 kB.

### T3. The plan keeps its present

- **What changes.** "Where v2 stands" in `docs/plan.md` is a history written at #91 and again at
  #168. It moves to a file of its own beside `docs/v1.md`. The plan keeps the process, the fix
  plan with its level column, the climb plan and the decisions.
- **Done** at PR #209 (11 October): `docs/plan-history.md`, 24.3 kB, and a pointer of three lines where the section stood; the plan from 234.3 kB to 210.8 kB.

### T4. Sections 6 and 7 of `AGENTS.md`, written once more

- **After** A, B and D. "A campaign's commands" loses the launcher and the round. "How a
  comparison is read" loses the budget, the noise arm in the table and two readings. Both are
  written again whole, since each was patched a sentence a pull request.
- **Done** at PR #213 (11 October), after A, B, D2 and E: both sections written again whole in
  the present, with four subsections in section 6 (the campaign command, what the log records of
  a campaign's conditions, what refuses a move, defaults and a first flag line) and the decision
  table's order as a numbered list in section 7; the dated notes on what each rule replaced go to
  `docs/simplify.md` and `docs/plan-history.md` by one pointer. The round stays, since D3 is
  deferred. One correction on the way: the stop rule's second kind of move is a whole session
  that left its harness as it was where a practice solve of it failed, as `stopRule` has read it
  since row F52, where the section said any unchanged session.

## 11. Small edges

Each has no reader or no effect (*read*). They go with the package named, or alone.

| Edge | Where | What I checked | Goes with |
| --- | --- | --- | --- |
| `withheld` programs | `solve-command-isolation.ts` | no caller outside the file, no test | W1 |
| `PROTECTED_HOME_NAMES` | `wall-policy.ts` | no reader; the home is closed whole | W1 |
| Four temporary names with no maker | `VERIFIER_TEMP_SIBLING_DENY_PATTERNS` | spelled in `wall-policy.ts` alone | W1 |
| `src/meta/completed-json.ts` | 60 lines | no importer | alone |
| `src/meta/campaign-root.ts` | v1's `campaigns/` root | imported by one lint rule and two tests | T5 |
| The trinomial test as a comment | `src/kernel/compare.ts` | the plan's own row C3 | alone; done at PR #212 (11 October) |
| `--solve-turns` | `tools/d2/setting.ts` | "bound no solve", its head comment | A3 |
| `anchor.drawn`, `anchor.scored`, `exam.word` | `EVENT_KINDS` | no writer; kept readable by section 5 of `AGENTS.md` | stay |

---

# Handover of the building session, 10 October 2026

*Moved here on 11 October.* This was `docs/handover-2026-10-10.md`, written at PR #170, and it
moved whole when `docs/simplify.md` was cut to what is open. "This file" in it means that file.
Nothing here is kept current.

For a successor session with no history, and for the operator. It says what the building session
did between 9 October 23:45Z and 10 October 17:30Z, in the order it happened, where each result
is on record, what stands open, and what to do next. Newer evidence wins over this file: the log
of a campaign over its ledger line, the stack's head over a commit named here, `docs/plan.md`
over any status word below.

Read at `286cff5` (PR #169; #170 above it holds this file), with PRs #150 to #168 open above
`claude/the-tokens-a-solve-reads` and main still at #15.

## 1. The question, and where it stands

The system is for one question: is the new harness better than the reference harness, on tasks
neither was built on? The climb is that question asked again and again: a harness promoted,
harder tasks written, a harder harness promoted on them, epoch after epoch (`docs/plan.md`, "The
climb, read as epochs").

| Level | What is on record | Where |
| --- | --- | --- |
| One promotion, with a paid model | t-4 (exact LP), t-9 (exact cover), t-10 (graph colouring): a step read twice at 2 or 3 told turns and the harness promoted by the table. Buffer on the Mac, promoted by naming its digest | the campaigns' logs; the ledger |
| A second epoch read | t-4's epoch 2: the promoted harness valid on 18 of 18 solves of three new tasks, the starter on 0 of 36 | `runs view t-4`, the climb rows |
| A second promotion | None with a model. In the simulation: two, at strength 5 and 7, on tasks of bases up to 9 and 11 | `test/climb.test.ts`, climb-9 and climb-10 |
| A third epoch that reads a step | None. In the simulation it is the draw of the scored set that stops it at a target of 8, and it reads with every held task scored | plan B14 and the decision on the draw |

What the first promotions measured is narrower than the word: t-10's step was read at 3 told
turns on 8 tasks, and says that the harness answers in 2 turns where the starter takes 3 on
tasks both answer at the full limit (the WRI of t-10, section 5). The budget ladder came before
the tasks until PR #167, so the climb on record is in turns. From #167 the tasks come first.

## 2. The chronological path

Times are UTC. Each line names the result and where it is; the ledger
(`PROGRESS.md` in the session's scratchpad, not in the repository) holds the counts.

**9 October, 23:45Z to 10 October 04:06Z: the first campaigns from a prompt, in a Linux
container.** The task document asked for one prompt, one total, one command, to a typed ending
(D1), every mechanism live (D2), a climb (D3), passes and rejections audited (D4), the handover
(D5), clean engineering (D6), a true record (D7); then E1 to E10.

- t-1 crashed as root three times before any call (Claude Code refuses root); every run since
  is as user `ana`, the key sourced by root from the operator's file and handed to the user's
  process only.
- t-2 (exact LP): 684 events, 12 moves, draft to `stop`; two runs of one command, the second
  with `--admit` of the four checks, which is the one hand move. Defects A to D of the ledger.
- t-3: `campaign.word` read at a boundary (F50). Defects E and F: the table built before
  comparing on tasks written since, and sent an all-valid harness to a Builder with nothing to
  repair (PRs #124, #126).
- t-4: the budget set twice by the rule, a step read at 2 told turns (4-0-2, p 0.0625), repeated,
  the full-limit reading without a loss, `harness.promoted` written by the table (move 11), then
  an Examiner session for room, three Builder sessions that changed nothing, `stop`. The handover
  (`close.ts --to ... --solve`) solved a task from the exported folder (D5). E2: checkpoints c-1
  and c-2 attributed the step to the guide, not the programs. E5: the harness under Sonnet at
  medium, 8-0-0.
- t-5 (subset sum): E4's kills applied three times and the campaign run on by name each time;
  18 rejections, each ruled `earned`; the blind packet sent to the operator (E3). Defect G: a
  killed session billed by nobody (PR #131).
- t-6, t-7, t-8: three strangers (fresh clones) to the first comparison each, the guesses repaired
  (PR #132).
- t-9 and t-10: E6's sequence script, both to `stop` with one hand move each; both promoted a
  harness and then stopped with the Examiner's room tasks never compared on.
- PRs #115 to #136. Spend 29.73 of 80 dollars.

**10 October, 11:13Z to 14:00Z: "investigate everything and apply fixes", "fix ambitiously".**

- Tools of the harness's own: the texts had steered the Builder from `tools.ts`; they state what
  each route costs a solve in tokens, and `practice` reports tokens (PR #138, plan B8).
- The launcher counted itself as a writer and refused every second launch into a tree
  (PR #139).
- After a promotion: a control of the starter against the promoted harness on tasks held out
  since, a comparison held to its target, a release by outcome, practice brought up after a
  control with room, the Examiner's `try_answer` and walled shell, the brief in its opening
  (PR #140, plan B9).
- Every wall denies the repository's other worktrees: an Examiner's shell had read t-10's log
  from a sibling tree by hand (PR #141, plan B10).

**14:00Z to 15:40Z: the five points.** An unchanged session counts to the stop only where a
practice solve of its own failed; `--patience` as one term for the three bounds; tasks both
harnesses answered twice leave the draw but for a third; the Examiner told the budget as a fact;
every wall probes itself once a process; the closing report names the step's budget (PRs #145
to #149, plan B11, B12).

**15:40Z to 16:10Z: the whole-run investigation of t-10.** 28 lanes, all as Fable 5.1 (the
Agent tool offers no gpt-6-luna). Verdict: g-3 and g-4 are believed as steps at 3 told turns,
and measure a one-turn saving against a starter that spends a turn on a failing pip install in
26 of 34 turns-ended solves; at the full limit nothing but ties was read; the promotion's
"did not lose at the full limit" rested on 5 tasks, 4 of the 8 step tasks unread. Patched:
`onStep` takes a full-limit reading only if it covers the step's tasks (PR #153); the WRI reader
reads a drafted exam (PR #154). Ten operator decisions are listed in the synthesis
(`.ana/wri/2026-10-10-t-10/synthesis.md` in the `-wall` worktree, not published).

**16:10Z to 16:50Z: three fixes from t-10's log, the launch blocked, a rehearsal path.**

- The prompts say the network as a probe inside the wall finds it (PR #158): on this host
  `unreached` in 281 ms, 0 of 143 t-10 solves installed anything.
- The Examiner's outcomes are of the last compared setting (PR #159); `practice` under the parent
  (PR #160).
- A paid launch of t-11 was refused by this session's permission classifier twice; the script is
  left for the operator (`sh /home/ana/t11/launch-t11.sh`, worktree `anabasis-v2-t11` at
  `8ef7d31`; it reads the key from the env file and prints nothing).
- A campaign from a prompt could not be rehearsed: PR #161 reads a drafted exam from the
  campaign's own log and scripts the Examiner from the source's later tasks. The rehearsal found
  two host defects that would have killed t-11's first solve: the probe's shared folder and the
  sibling canary written into another user's tree (PR #162, plan B12). sim-t10d at `8ef7d31`:
  14 moves, 160 solves, "went as scripted".
- The bridge: a briefing to the Mac session `anabasis-runs` (15:01Z) and board posts. The Mac
  answered with PRs #163 and #164 on older heads of #161 and #162; I force-pushed those two
  after the Mac had stacked on them, told it, and will not rewrite them again. #165 waits to be
  rebased onto #164 once the Mac rebases.

**16:50Z to 17:30Z: the climb.** The operator's word: the climbing is the goal, everything else
follows; harder tasks first; do not spend on reliability; simulate without a model.

- PR #165: `decide.ts` under the size ceilings (`move.ts`), and three more splits.
- PR #167: tasks before the budget (`harder`), a promotion followed by an Examiner session for
  room once, `--room` telling the Examiner the campaign's need and no count.
- PR #168: `epochsOf` and the climb rows in `runs view`; the simulated climb
  (`test/climb.test.ts`); four readers fixed on its evidence (plan B13); the draw's part named
  (plan B14). Replayed over t-3 to t-10: no move changes but t-10's, where four tasks the promoted
  harness answered twice leave the draw and the table asks for tasks before the control.
- climb-10, every held task scored: four promotions in 36 moves (strength 5, 7, 9, 11) and still
  climbing, until I removed two reading worktrees beside the run and every solve from the next
  policy on ended `sandbox-crash`: Bubblewrap refuses a launch on a `--tmpfs` or `--remount-ro`
  of a path that no longer exists under its read-only root. PR #169 mounts nothing on such a
  path. The rule of AGENTS.md section 10 (the worktree is the condition) now has a second
  reading: a sibling worktree is part of every running campaign's wall.
- `docs/plan.md` tuned: the amended order, the climb paragraph, rows B13 to B17, the decision on
  the draw, a re-read note at #168. This file.

## 3. The stack at `286cff5`

| PR | Branch | Head | Subject |
| --- | --- | --- | --- |
| #153 | claude/full-limit-covers-the-step | b9fec6e | `onStep` takes a full-limit reading only if it covers the step's tasks |
| #154 | claude/wri-reads-a-drafted-exam | ffb3a30 | the WRI reader on a drafted exam |
| #155–#157 | the Mac's | | |
| #158 | claude/network-as-the-wall-finds-it | bb1c005 | the network probed inside the wall, told to every seat |
| #159 | claude/outcomes-of-one-setting | 335e569 | Examiner outcomes of the last compared setting |
| #160 | claude/practice-under-the-parent | 427313a | `practice` under the parent harness |
| #161 | claude/rehearse-a-drafted-exam | 5c42d3d | rehearsal of a campaign from a prompt |
| #162 | claude/a-dead-wall-stops-a-comparison | 8ef7d31 | the probe's folder, the sibling read, a comparison stopped on a dead wall |
| #163, #164 | the Mac's, on older heads of #161 and #162 | c97d945, 73b8d1c | to be rebased by the Mac |
| #165 | claude/under-the-size-ceilings | 8e9515d | `decide.ts` split, three more |
| #167 | claude/tasks-before-the-budget | ac53415 | tasks before the budget; `--room` |
| #168 | claude/the-climb | 7bbc46c | epochs, the simulated climb, four readers |
| #169 | claude/a-removed-worktree-takes-no-mount | 286cff5 | a denied worktree that no longer exists takes no mount |
| #170 | claude/plan-and-handover-10-october | | the plan tuned, this file |

Each of mine: typecheck 0, plain lint 0, strict lint the four known findings in files of
#150–#152, format clean, the suite 849 pass, 32 skip, 3 fail (the container's user-namespace,
policy-rename and resolver cases, at every head), size policy vendor only. Linux only; the
darwin job is CI's, which starts no job (billing).

Two bookmark branches on origin, `preserve/agents-md-for-v2-with-82` and `claude/frontier`, are
merge commits of #82 and #107; their one commit not in the stack (`c23a1b5`, three skill
scripts under a strict lint) was superseded by a later rewrite, and the three scripts pass a
strict lint at the head. Nothing in them is missing from the stack. Deleting a branch is refused
from this environment (the proxy denies writes to `git/refs`), so it is the operator's:
`git push origin --delete preserve/agents-md-for-v2-with-82 claude/frontier`.

## 4. What is open, by owner

**The operator's decisions**, each with a recommendation:

1. The draw of the scored set (plan, "Decisions"): a larger `--target` for the development phase
   (recommended now), a draw that takes the newest held-out tasks first (recommended as a row),
   or exhaustion from one comparison (against rule 6).
2. Launch t-11 from the operator's shell (the script above), and buffer past its stop on the Mac:
   the one domain with shown capability room.
3. The ten decisions of t-10's WRI: the wording of its step; whether a harness may be a complete
   domain solver; whether an exam with four authored checks is a domain to run; the control on
   x-5's tasks and the full-limit reading on the step tasks; the earned ruling without a probe;
   the draft's example tasks in the scored pool; F48's count.
4. The blind labels: t-5 g-1's packet (sent 03:06Z) and buffer's.
5. The two keys in the env file; the vendor size findings; the Mac campaigns' move to the top;
   merging the stack.

**Code, the next session's:**

- After the Mac rebases #163/#164 onto `8ef7d31`: rebase #165, #167, #168, #169 and #170 onto
  #164, in that order, each with its gate.
- The draw's fix, once chosen.
- `--target` into the simulation's finding: `test/climb.test.ts` scores every held task; a
  second case at the default target should fail until the draw is decided, or be left out.
- Gaps named and not fixed: `networkReach` has no test of its own; the Examiner's reading of
  "harder" is the model's and nothing checks it; `admission()` in a replay script throws on a
  log with no `restarted` (a script's fault, not the reader's, unverified).

**Runs, paid, each needing the operator's word:** t-11 (~10 dollars, predictions P1 to P4 in
the ledger of 11:50Z–14:00Z: each Examiner session holds out ≥4 tasks and calls `try_answer`;
the first comparison scores 8 tasks; after a promotion a control with fresh = starter is on
record before any Builder session; the campaign does not end `stop` with tasks held out since
its last comparison).

## 5. Where things are on this host

| What | Where |
| --- | --- |
| Development worktree (root, real `node_modules`) | `/home/claude/anabasis-v2-full`, on `claude/the-climb` |
| Run trees (user `ana`) | `/home/claude/anabasis-v2-t9` (t-9, t-10, sim-t10 to sim-t10d; at `8ef7d31`), `-t11` (launch tree, `8ef7d31`), `-t3`, `-t4`, `-t5`, `-t1` |
| Strangers' clones | `/home/ana/stranger/repo{,2,3}` (t-6, t-7, t-8) |
| The WRI of t-10 | `/home/claude/anabasis-v2-wall/.ana/wri/2026-10-10-t-10/` |
| The ledger, PR bodies, replay scripts, climb outputs | the session's scratchpad (`PROGRESS.md`, `pr*.md`, `replay-*.ts`, `climb-*.txt`, `suite-*.txt`) |
| The launch script for t-11 | `/home/ana/t11/launch-t11.sh` |
| The env file | the operator's upload; never opened, printed or copied; passed as `--env-file` only |

A run tree needs its own `node_modules` (not a link), `git config --global --add
safe.directory` for the user that runs it, and a dry run (`bun run runs launch --dry-run ...`)
before any paid move.

## 6. How to read a result here

Events in the log, then the folds, then source and tests, then a command's line, then a pull
request's text, then an agent's account (AGENTS.md, section 9). `runs view <name>` prints the
handovers, the climb rows and the table's move. A step is one draw; a promotion took a repeat
and a full-limit reading that covers the step's tasks. `not-scored` and `no-step` are different
results. A reading at a shorter budget is of a solver told the longer one. Results are never
compared across campaigns or settings.
