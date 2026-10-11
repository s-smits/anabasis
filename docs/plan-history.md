# Where v2 stood: the plan's history at PR #91 and PR #168

The plan's account of where v2 stood when it was read, written at PR #91 (9 October) and again at
PR #168 (10 October), with the three reviews of 9 October and the second rounds of that day. It
was the section "Where v2 stands" of `docs/plan.md` until 11 October, and moved here so that the
plan keeps its present: the process, the fix plan with its level column, the climb plan and the
decisions (`docs/simplify.md`, T3). Nothing here is kept current; `docs/plan.md` and the source
at the stack's head are.


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
