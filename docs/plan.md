# Anabasis v2: plan after the v1 review

9 October 2026 · Stijn Smits

This is the repository's copy of the plan of record, as revised on 9 October after an independent review and the discussion that followed it. The text is the plan's. Three passages are the repository's and are marked as such: the note under the figure, the table of phases where the plan embeds its roadmap, and the note that closes "Where v2 stands".

![The full system under the plan of 8 October](system.png)

*Repository note.* The figure was drawn for the text of 8 October and has not been redrawn. Five things in it are no longer the plan. The box "Minimal baseline" is the Starter Built Harness, which is also what the Builder forks and the first reference harness. The operator owns no contract and no check: the Examiner drafts the contract and writes and repairs the checks, and the operator freezes or refuses and labels answers blind. The contract states no objective, and the Examiner's tasks state none, until Phase 3 is built. Two valid answers are even, so there is no objective comparison between them. And a step does not move the reference harness, which is promoted only in Phase 6.

v2 keeps its independent exam. One query names one domain, and a campaign builds one harness for it. First the tasks are set up. The Builder then forks the Starter Built Harness and builds a new harness on it, and the two are compared on tasks the Builder never saw. That first comparison also shows how the starter does by itself, and so how much room there is to improve. Every comparison is pairwise and at a fixed compute budget, on validity first and on a measured objective only when validity leaves too many ties. No agent is built to find answers. The plan takes three things from v1: staged sizing, Builder freedom, and one Builder conversation that is kept by compaction. This version was revised on 9 October after an independent review and the discussion that followed it.

## Terms

Each term below has one meaning throughout this plan and in the system figure.

| Term | Meaning |
| --- | --- |
| Solver | The model that runs inside a Built Harness and answers tasks. |
| Harness | Also called the Built Harness: the guide and tools the solver works with. This is what the system builds and improves. |
| Builder | The agent that changes the harness, also called the Harness Builder. It works in one conversation that continues across sessions. |
| Examiner | The agent that drafts the contract, writes the checks and the tasks, and repairs checks. It is the only author on the exam side. |
| Campaign | Everything that is run for one query: one domain, one contract, one correctness model and one log. A campaign builds one harness. |
| Contract | The one public document of a campaign: the rules, each with an id and its source, and the answer format. The Examiner drafts it and the operator freezes it. |
| Correctness model | Everything that decides whether an answer is valid: the instrument, the check program, the controls and each task's hidden values, and the objective function once one is added. The name is v1's. |
| Check | A hidden program that tests one rule of a task and returns pass or reject. The checks of a domain form the check program. |
| Instrument | The field's own tool that computes the facts a check compares: an analysis engine, a compiler, a simulator. No agent writes it. |
| Control | An answer with a known label, used to test the checks: one the checks must accept, or a one-fact change of it that a named check must reject. A control belongs to a check, not to a task. |
| Verifier | The host code that runs the correctness model on one answer, inside the sandbox. |
| Compute budget | The limits one solve runs under, in turns and CPU seconds, with a time limit behind them. Both harnesses get the same budget. |
| Valid answer | An answer that passes every check and was submitted within the compute budget. |
| Rejection | An answer that at least one check rejects. It is a true fail when the answer is wrong, and a check defect when the answer was correct. |
| Judge | The agent that recomputes a rejected answer to decide whether the rejection was right. It also audits a sample of valid answers. |
| Hand label | A person's verdict on one rejected answer, written before any Judge ruling is seen: true fail, check defect or unclear. A label stands over a Judge's ruling, and no repair may contradict one. |
| Objective | The quantity a task asks the solver to optimise, such as mass. It is added only if validity leaves too many ties (Phase 3). The host computes it from the answer, and a value the answer reports about itself is not used. |
| Held-out task | A task the Builder never sees. Only held-out tasks are scored. |
| Practice task | A task the operator releases to the Builder for trying out changes. Once released it is never scored. |
| Reference harness | The harness a new version is compared with. It is the Starter Built Harness until a step is promoted. |
| Starter Built Harness | The harness every campaign starts from: Pi with a shell and the tool that writes an answer, and no guide or domain tools yet. The Builder forks it in its first session, and it is the first reference harness. |
| Comparison | The reference harness and a new harness solve the same held-out tasks. Each task is a win, a loss or a tie for the new harness. |
| A/A comparison | A comparison of one harness with itself on separate solves. It should show no step, and its tie share measures the noise. |
| Tie | A task on which neither harness wins. Ties are left out of the test. |
| Step | A comparison in which the new harness wins significantly more tasks than it loses. |
| Round | One Builder session followed by one comparison. |
| Checkpoint | Several Builder sessions followed by one comparison. |
| Trace | The record of one solve: every model turn and every tool call with its result. |
| Session | One bounded stretch of Builder work, with limits on time, turns and practice solves. A session ends with a frozen harness version. |
| Diagnoser | The agent that reads one failed practice trace and names the first wrong step, the likely cause and what would prove that diagnosis wrong. |

## Why v1 did not climb

v1 never completed one full improvement cycle, which it called a climb step. Across 83 runs and 357 batteries (a battery is one test set), no failure was both genuine and reproducible. A step was defined as a true fail, meaning the solver's answer was wrong and the check was right to reject it; then a change to the harness in response; then the same task solved; then a harder battery that the solver again fails in part.

| Problem | What v1 recorded |
| --- | --- |
| The test was bounded by its author's ability | The Builder wrote each task and had to solve it first, so no task was harder than what the Builder could already do. The solver, a model of the same class, then solved it too: 265 of 299 batteries were passed in full. |
| Label noise in the test | When a task was failed, the check was usually at fault. 36 of 47 rehearsal misses came from a faulty check or instrument, and 17 of 22 fails that were counted as limits were disputed. |
| High variance between repeated solves | On truss there were 2 fails in 59 repeated solves, and both passed when solved again. One failed solve therefore says little. |
| Harder tests became broader instead of deeper | When a probe of 5 to 8 tasks was enlarged to 25, the added tasks passed in 10 of 13 cases. The cause was not isolated. After a difficulty raise, the median solve time was only 1.07 times the previous one. |
| Failures were rarely acted on | A genuine fail led to a change in the harness about once in six chances. |

- **The one change that made tasks harder:** several requirements that share one limit. This took pass counts from 22 of 23 down to 7 of 20 and 2 of 23.
- **Interventions that had no effect:** a Builder at higher reasoning effort than the solver (6 of 6 passed, twice), a different model solving another model's tasks (9 of 10), hiding the grading instrument from the solver (12 of 12 and 20 of 21), and using rehearsal solves as a filter (895 of 939 passed).
- **Choosing the answer first did not help either.** Six tasks were built around a chosen answer, at a size where greedy and a 12,000-move local search failed. The solver passed all six in 2.5 to 26 minutes. Six limits were reset from longer searches, of 45 minutes to 3.4 hours, and the solver passed 5 of the 6.
- **The recorded explanation:** the public rules let the solver check its own candidate, "so it wrote a search and ran it until the checks cleared".
- **What was reliable:** the passes. An independent Judge overturned only 5 of 1,411.
- **What was never tested:** tasks whose answer already exists in the field, and a second author for the test. An answer builder for the second was written on 30 September and never ran. v2's Examiner is that second author.

These figures come from v1's notes as summarised by the operator on 8 October. PR #55 adds an account of v1 to v2's repository (`docs/v1.md`).

## Where v2 stands

v2 is read here at PR #55 (`claude/frontier`, commit `942f6bd`). That branch sits on the top of the stack and rewrote the exam on 9 October, for an earlier revision of this plan. It builds most of Phase 2 and nothing of Phases 1, 3 and 5, and nothing in it has run with a real model. The table sets v1's blockers against it.

| v1 blocker | What v2 does at PR #55 | Status |
| --- | --- | --- |
| Self-graded score | The reference harness and a new one solve the same held-out tasks afresh, and the host compares them in code (`src/kernel/compare.ts`). | Avoided |
| The answer is the author's own | A separate Examiner writes tasks. A task is held out once the shape of its package passes, and no solver has to pass it first. | Removed in code, not yet run |
| A failed task usually meant a wrong check | The check program is still v1's, as imported. A rejection counts only once it is ruled a true fail; otherwise its task is set aside until a person labels it (`tools/d2/settle.ts`). The ruling is the Referee's, which has no shell and has not been measured against hand labels. | Partly addressed |
| A single fail is a flip | Every solve of one harness is paired with every solve of the other, each task counts once, and a sign test reads the tasks. | Addressed, not yet run |
| Authors widen instead of deepening | The Examiner is told one outcome for every task of the campaign and no target (`src/examiner/record.ts`). No graduation step exists. | Open |
| A true fail was seldom followed up | The Builder gets the trace and a diagnosis for each practice fail. | Addressed, unproven |
| Spend on uninformative runs | A launch is refused without a dollar cap, and when the tie share on record leaves fewer untied tasks than a step takes (`tools/runs/launch.ts`). | Addressed, not yet run |

Set against this plan, the branch stands as follows.

**Built in PR #55:**

- **One gate for a task,** the shape of its package. The stronger solver, the per-task controls, screening and the anchor are removed.
- **The comparison in code.** Its harnesses, tasks, solves, level, budgets and cap are written to the log before the first solve, and both sides are solved afresh and in turn.
- **Rulings before a rejection counts,** and settling by a person's labels where no ruling stands.
- **The starter,** under the name minimal baseline, and a comparison that needs no Builder session (`tools/d2/checkpoint.ts`). It is read at budgets fixed beforehand, and the reference harness can be read against itself beside it (`--noise`).
- **The dollar cap** with a reserve for each solve, the two launch refusals, and the stop rule of three checkpoints without a step.
- **An Examiner that makes no solve** and is told each task's outcome.
- **The default sizes:** 12 tasks, 2 solves per harness, level 0.10.
- **In `docs/`:** the account of v1 and an earlier revision of this plan.

**Not built:**

- **The Judge.** The Referee has a probe tool and no shell.
- **A budget the solver is told, and a cap on CPU seconds.** Shorter budgets are read after the fact from what each solve used.
- **The starter as the default.** A comparison takes the stored v1 harness as its reference, and a Builder session starts from it.
- **An author for the correctness model.** A session that wrote one rule with its check, and a way to change the checker inside one campaign log, were written on 8 October and taken out of the branch a day later, because the plan then built neither. Commit `410aee3` holds both.
- **The closed network for harness tools, and the lifted ban** in the Builder's prompt.
- **One Builder conversation across sessions,** the growing list of failed practice solves, and the aggregate result told to the Builder.
- **The objective,** which Phase 3 adds only if needed.

The live record so far:

- **Gate 2, now removed:** the first Examiner sessions proposed 25 tasks. 14 were too hard at the stronger solve, 6 were refused on their controls and 5 were feasible (`docs/transfer.md`).
- **Second Examiner session:** $48.45 for seven tasks, five too hard and two too easy. No reviewer read the five rejections.
- **Rounds:** eight rounds on 8 October cost over $220 and scored no task.
- **Campaign `exam-1`:** 4 anchor tasks, 1 practice task and 2 candidates, under the design before PR #55. A round on it could not read a step.
- **PR #55:** no run with a real model. By the pull request's own account its checks pass, apart from ten cases that need the sandbox wall.

*Repository note, 9 October, later the same day.* The account above reads the branch at commit `942f6bd`. Since then the branch has been brought to this revision, and five of its "not built" items are built:

- **The starter as the default.** A campaign starts from the Starter Built Harness and compares with it: `--parent` is `latest`, which is the starter until a session has left a harness, and `--reference` is `starter`. The name minimal baseline is gone, and the stored v1 harness is no longer a harness a campaign keeps.
- **The lifted ban.** The Builder's prompt forbids one thing of a harness tool: returning a finished answer for a task.
- **The starter's own result.** A comparison's report holds, for each harness at the full limit and at each budget, the tasks by how many of their solves were valid (`valid`), and the commands print it.
- **Naming the scored set at set-up.** `tools/d2/prepare.ts --tasks` names the tasks to score, releases none of them for practice, and confirms for each that an answer the stored sweep accepted still passes today's verifier. `tools/d2/round.ts --tasks` then scores them.
- **This copy of the plan.**

An independent review of the branch on 9 October found nineteen defects, which are patched. The one that changes a record: a solve's start now names the comparison it was made for, a comparison counts the solves that name it and no other, and the prompts a solver was given are logged beside the model's turns. The first live rounds, the same day, showed what that log is worth: every finished solve was given one prompt. So `--solve-turns`, which caps prompts and is this plan's "24 turns", bound no solve, and a budget read in `prompts` read what the full limit read. A budget is read in the model's own turns, in CPU seconds or in seconds, and the limit Phase 2 tells the solver has to count the model's turns.

The Starter Built Harness was rewritten the same day, after the first live rounds, and the terms above read on it as follows. It is pi's coding agent as pi releases it: pi's `read`, `bash`, `edit` and `write` in one working directory, under pi's own system prompt, and nothing of its own. The solver's answer is a file, `answer.json`, which `submit` sends; no harness tool takes the answer. The host adds the command wall behind every tool, the duty and the wall's facts in the prompt, and the answer's check against its format. A Builder's home holds `HARNESS.md`, the account of a harness's files. `docs/transfer.md` gives the counts from 209 solves on record that decided each change. Four consequences for this plan:

- **A new condition.** The rewritten starter has another digest, and every solver reads another prompt. No solve made before it counts for it, the rounds that were running measure against the old starter, and nothing is compared until the new starter has its own solves and one harness has been read against itself (`--noise`).
- **A stronger starter.** File tools and one directory make the bare solver more efficient, which leaves a harness less to win at a long wall. On the old starter every buffer task was already valid at two hours. So the budget is the next thing to build, and Phase 0's reading of the starter at several budgets comes before any round is read as a step or not.
- **What sizes a solve.** In the solves on record the wall bound nothing at two hours, and at five minutes most solves had submitted by a third of it. What a solver met was the limit on one command. That limit is now held to a share of the wall, a quarter where a command names no timeout and a half at most, and the prompt states both.
- **A CPU budget's reading.** A command cut at its limit leaves its CPU unmeasured. A task with a valid solve of that kind is left out of a CPU budget's test and counted as unread, where it was counted as within the budget. A cap on CPU seconds (Phase 2) needs the cut command measured, which is not built.

*Repository note, 9 October, after two live rounds on the old starter.* Two rounds ran from PR #67 at an eight-minute wall while the starter was being rewritten: buffer read a step, and truss spent its practice solves with one pass under its own harness. What they showed was built on the stack above the rewrite. Eight of this plan's "not built" items are built with it, whole or in part:

- **A budget in the model's own turns, told to the solver and enforced** (Phase 2). `--solve-model-turns` names it; every tool result says which turn the solver is in, beside the time it has used; a solve that uses its turns without an answer ends `turns-ended`. `--solve-turns` stays v1's cap on prompts.
- **How much of the budget a practice solve used** (Phase 2): its time of its limit and its model turns, in the practice result.
- **The Builder's notes** (Phase 5). They are v1's, copied: `MEMORY.md`, `SCRATCHPAD.md` and the helpers under `scratch/`, bounded and carried from one session's home to the next.
- **The list of failed practice solves** (Phase 5), across all sessions, each marked open, repaired or failing again.
- **Each comparison's result told to the Builder in aggregate** (Phase 5): the tally and the reading, with no task named.
- **The do-nothing answer as a control** (the correctness model). The acceptance reading puts the smallest answer the format allows to every task.
- **An instrument an agent wrote, listed as a fault** (Phase 1) until the operator admits the check by name.
- **A prediction written before launch** (Phase 4), with the comparison's terms.

Four more things were built that the plan does not list:

- **The time a solve has used, told on every tool result**, with a command that would run into the solve's last minute cut there and handed back. Five of the six failed practice solves had submitted an answer the solver's own check had refused, stopping early or out of time.
- **The checker read before a comparison is paid for**: the launcher refuses one while the log holds no reading.
- **A Builder's own tools**: pi's four, a preview of what a solver reads, and a reset, with each part of a harness given one purpose in `HARNESS.md`: a computation is a program, the guide is words about the programs, and a tool of the harness's own is for a harness without the shell.
- **A rule for the tasks nobody answers that reads the budget** (Phase 2). The plan sends a task to a person after two comparisons without a valid answer. Under a five-minute wall three of buffer's tasks had none from either harness, and every solve of the same three had been valid at two hours: a second comparison at that wall would have taken three feasible tasks out of the scored set. A task with a valid answer anywhere on record now never goes to a person, and a comparison that cut a solve of a task at a limit is not counted for that task (`awaitingLabel`, `src/kernel/reports.ts`).

Two items of the plan read otherwise on this stack, and are the operator's to settle:

- **CPU seconds as a budget.** They are read with the shell's `times`, which counts waited-for children only. A background job ended with its command, and a command cut at its limit, are in no sum, and under bubblewrap the reading is zero. A cap on that meter would bind one style of command and not another, so the model's turns were built as the binding unit and CPU stays a reported figure until a meter counts a solve's whole process tree.
- **The closed network for harness tools.** A harness's computation is now a program the solver runs from its own shell, and that shell keeps the network by the decision of 9 October. Closed for harness tools, the network would be closed only for a harness without a shell. What would close both holes and keep installs is a proxy that every command of a solve goes through and that allows the package registries alone. On record, though, every two-hour solve of buffer under the old starter fetched the chemistry engine's source from its publisher, which is no registry, and that fetch was the starter's whole route to a valid answer. Such a proxy would decide the comparison for any harness that carries the engine, so it is a choice about what the starter may do before it is a guard.

Still not built, each behind its gate: the Judge and the Examiner as author of the correctness model (Phase 1), the objective (Phase 3), and one Builder conversation with the process that holds it (Phase 5). `docs/transfer.md` holds the component-by-component account.

## Principles

Eight principles guide every item below. Each one follows from a result recorded in v1 or v2.

1. **Evaluate the harness as a whole.** The comparison answers one question: does the new harness perform better than the old one on held-out tasks? It does not say which tool or prompt caused the difference. That would need an ablation study, which is run only when the cause matters.
2. **Use measured outcomes as the metric.** An answer is valid when it passes the checks within the compute budget, which is the same for both harnesses. When validity leaves too many ties, quality is added: a number that the host computes from the answer, such as mass. A value the answer reports about itself is not used, because the Builder writes the tool that reports it. A model's opinion about which of two answers looks better is never used as a metric.
3. **Work without ground-truth answers.** A design task has many valid answers, so there is no single correct answer to compare against. The checks verify the required properties, so no reference answer is needed.
4. **Verify every rejection and audit a sample of passes.** In v1 the passes were almost always correct, while most rejections came from faulty checks. A rejected answer therefore counts only after it has been recomputed independently, and a random sample of accepted answers is recomputed as well.
5. **Repeat every measurement.** A single solve has high variance: the same harness can fail a task once and pass it the next time. A fail, a win or a loss counts only when repeated solves support it.
6. **Give the Builder full freedom over the harness and no access to the test set.** The Builder may change or rewrite anything in the harness, within one limit: no harness tool returns a finished answer for a task. It never sees a scored task, a trace of one, or a check, which keeps it from overfitting to the evaluation.
7. **Fix the sample size and the limits before each round.** The number of tasks and solves, the compute budget and the margin are chosen from earlier rounds and are never changed once results are visible, since that would bias the test. Every round also has a dollar cap.
8. **Add machinery only in response to evidence.** A new mechanism is built when a live result shows it is needed. The first such result is how the Starter Built Harness does on the tasks, which no run found in v1's or v2's records has measured. On 8 October, 37 pull requests were stacked while only one small live round had run.

## The correctness model

The correctness model is built in layers, and each layer has one source. For any domain it starts from the one-line prompt: the Examiner drafts the public rules from the field's standard, the field's own tool computes the facts, the Examiner writes one thin check per rule, and the host accepts every part on readings that use no model. No person writes any of it. Today v2 has one correctness model, for truss: a contract read from the brief of a v1 bundle (`tools/m0/stored-sweep.ts`) and a check program taken from v1 as it stood (`src/kernel/acceptance.ts`). A v1 Builder wrote both, and no role in v2 writes or repairs one. Two parts of this construction were written on 8 October and taken out of PR #55 a day later, because the plan then built neither: a session that writes one rule with its check behind gates, and a way to change the checker inside one campaign log. Commit 410aee3 holds both, and Phase 1 brings them back.

| Part | What it is | Where it comes from | How it is accepted |
| --- | --- | --- | --- |
| Contract | The public rules, each with an id, and the answer format | Drafted by the Examiner from the one-line prompt and the field's public standard, with each rule citing its source. For truss today: read from the v1 bundle | The operator freezes or refuses it and writes none of it. It is frozen before the first solve under it, and a change opens a new campaign |
| Instrument | The tool that computes the facts a rule is about: an analysis engine, a compiler, a simulator | The field's own open-source tool, installed and pinned by digest. No agent writes it | The host confirms it is present and records its digest |
| Checks | One hidden program per public rule: run the instrument and compare its output with the rule's limit | The Examiner, in that thin form. For truss today: imported from v1 | The acceptance reading: every check is seen to pass an answer and to reject one, twice, with the same result |
| Controls | Answers the checks must accept, and one-fact changes of them that a named check must reject | Written with each check by its author: one answer the check must accept, one it must reject, and the do-nothing answer. For truss today: rebuilt from stored valid answers | The host runs them twice, and every control must get its label. When a check changes, every answer in the log is graded again as well |
| Hidden values | What a task gives the checks and not the solver | The Examiner, with each task | The shape gate |
| Second reading | An independent recomputation of a rejected answer | The Judge, from the public rule and the instrument, before it sees the check's code | Measured against hand labels |

Ten rules follow, most of them from v1's record:

- **No agent writes the instrument.** All 32 verified firmware fails in v1 ran on batteries whose instrument a Builder had written: 32 of 816 cases, against 0 of 283 where another instrument decided. 24 of the 32 were that stand-in rejecting valid code. v1's prompt had called a stand-in the last route since 22 September, and that did not prevent it. Here the acceptance reading lists a check with such an instrument as a fault, and only the operator can accept it, at the freeze, for a check that is plain arithmetic on the answer.
- **Every public rule cites its source.** A rule the field does not hold measures the author's wording. A rule with a citation can be checked by the Judge and by a reader.
- **One check per rule, and nothing else in it.** A check already cites the rule ids it enforces, and the host confirms they exist in the contract (`src/kernel/contract.ts`). A check that does more than run the instrument and compare is where v1's defects were.
- **No reference answers.** v1 had its author solve every task before the task counted, which bounded the test by the author's ability. A check verifies a property, which is easier than finding an answer, so the checks can be right on a task nobody has solved yet.
- **A failure of the instrument is a non-result, never a rejection.** The imported truss checks count a crash of the Python engine as a rejection (PR #34).
- **Two readings of every rejection.** The check and the Judge compute the same rule separately. How often they disagree, per check, is the running estimate of that check's quality.
- **A sample of valid answers is audited.** In every comparison the Judge also recomputes a random sample of the answers the checks accepted. v1's passes were reliable, with 5 of 1,411 overturned, but that was measured before any Builder had many sessions to adapt to fixed checks. The Judge reports a wrong pass and overrules none.
- **A do-nothing answer is a control.** The smallest answer the format allows must be rejected on every task. Anchor tests its generated verifiers this way, with an agent that does nothing, and cites a benchmark on which such an agent passed 38% of the tasks because the verifier accepted an empty response.
- **Changes only between comparisons, accepted without a model.** The Examiner patches a check the Judge ruled defective. The host grades every logged answer again and accepts the patch only if no rejection is withdrawn except those ruled check defects, no accepted answer is newly rejected except those the Judge ruled wrong, and the controls hold (`tools/c/repaired.ts`). No solve is repeated. A check not repaired in three tries leaves its task disputed.
- **Hand labels check the repairs, and no person reads one.** A repair follows the Judge's rulings, so a Judge that is wrong in a consistent way would move the checks with it. A person's label therefore stands over a ruling: a repair that withdraws a rejection labelled a true fail is refused. The reading already counts this against a repair when it is given the labels (`tools/c/repaired.ts --labels`). After each comparison the host draws up to 10 ruled rejections for the operator to label blind: up to five that the Judge ruled check defects, which are the answers a repair may move, and the rest from those it ruled true fails. The repair stands meanwhile. A label that contradicts it sends the check back to the Examiner and sets the task aside as disputed. The host also reports how often the checks agree with all hand labels before and after the repairs. OpenComputer checks its verifier repair in this way: no person read a repair, and agreement with 120 hand-labelled tasks rose from 85.2% to 94.1%. There, 76 of 450 runs showed a verifier fault, which would be about eight in a comparison of 48 solves.

A campaign serves one query, so it has one domain, and nothing in this construction is specific to truss. v2 cannot start from a query today: it reads its contract and checks from a v1 bundle. The path from a one-line prompt to a contract is therefore new work, placed in Phase 6.

## Guards against reward hacking

Every party that can move the measure is listed with what stops it. Three of them are not yet built: the network rule, the Judge with its audit of valid answers, and rules that cite their source.

| Who | How it could game the measure | What prevents it |
| --- | --- | --- |
| Builder | Fit the harness to the exam | It never sees a held-out task, a check or a hidden value, and a comparison uses held-out tasks only |
| Builder | Learn the checks by trial | A practice solve returns one verdict, and a session has at most 24 practice solves |
| Builder | Report a better number | The host computes validity and the objective. Nothing an answer says about itself counts |
| Harness tools | Send a task out, or fetch help, during a held-out solve | Agreed on 9 October, not yet built: harness tools get no outbound network access in any solve. The solver's own shell keeps it, by decision, so that it can install tools |
| Solver with a harness | Give answers that pass the checks and are wrong | The Judge audits a random sample of valid answers in every comparison |
| Examiner | Make tasks look hard through a faulty check, an unclear rule or a noisy task | The Judge reads every rejection separately, a repair must pass the host's gate, every rule cites the field's standard, and the A/A comparison shows noise as ties |
| Judge | Agree with a check because it has read the check | It recomputes before it sees the check's code, and it is measured against hand labels, which stand over its rulings |
| Operator | Change a rule or a check after seeing a result | The operator writes no rule, check or task. A contract is frozen before the first solve under it, a change opens a new campaign, and results are never compared across campaigns |
| Operator | Carry what the labels show over to the build side | The host builds every Builder message from the contract, the practice tasks and the practice results. The operator types nothing into a Builder session |

## Phases

The plan runs in seven phases. The first is one small round, and the next three buy no Builder session.

| Phase | What it does | Gate after it |
| --- | --- | --- |
| 0 | Set up the tasks and run the first round | G0: the round finishes under its cap with a tally, and the starter's own result is written down at the full limit and two shorter budgets |
| 1 | One Judge and a frozen correctness model | G1: instruments no agent wrote, controls that hold, a freeze, every stored rejection ruled, and the Judge clears its bar |
| 2 | The comparison at a fixed budget | G2: on at least 8 tasks the A/A comparison of the starter gives no step, and the tie share, the share with no valid answer and the cost per solve are recorded |
| 3 | The objective, only if needed | G3: the objective decides at least half of the pairs of two valid answers, and the A/A comparison still gives no step |
| 4 | A round at full size | G4: the round finishes under its cap with a tally, every rejection ruled, and the three quantities recorded |
| 5 | Checkpoint comparison | G5: a step against the reference harness |
| 6 | After a step | none |

*Repository note.* The plan embeds its roadmap as a figure of seven phases and six gates. The table above is drawn from the gates as the phase detail states them.

Gate G0 is the one the plan turns on. The first round shows how the Starter Built Harness does by itself. If it gives a valid answer on nearly every task even at a short budget, the tasks leave a harness nothing to add, and they are replaced before another session is paid for. Phase 3 and Phase 6 are drawn dashed. Phase 3 is built only if validity leaves too many ties, and Phase 6 only after a step has been observed.

## Phase detail

Each phase starts only when the gate before it has passed. Phase 0 pays for one Builder session, and Phases 1 to 3 for none.

### Phase 0: set up the tasks and run the first round

The goal is one small round, for about $400. The Builder forks the Starter Built Harness and builds on it, and the new harness is compared with the starter. The same comparison shows how the starter does by itself, and at which compute budget it starts to fall short. No run found in v1's or v2's records has measured that. PR #55 can launch this round as it stands.

- **The dollar cap is built.** A cap for each comparison was agreed on 9 October. In PR #55 a comparison without `--cap` is refused, a reserve is held back for each solve (`--reserve`), and a comparison that the cap cuts short is read as not scored.
- **Use the starter that PR #55 built, as the fork point and as the reference.** It is there under the name minimal baseline (`src/solve/baseline.ts`): the shell and one answer writer, with no guide and no domain tool, kept under its digest like any other harness. It needs nothing from the correctness model. The host gives the answer writer the contract's answer format, shows the solver the public rules, and sends the submitted answer to the verifier. A Builder session copies the harness it starts from whole, so the fork is one flag (`--parent baseline`), and the comparison is made against the starter with another (`--reference baseline`). Both flags default to the stored v1 harness in PR #55, which this plan does not use. v1's starter is not used either: it was a template for a Builder that also wrote the exam, and v2 refuses it.
- **Set up the tasks.** Hold the stored truss tasks out, release a few of them to the Builder for practice, and name eight of the others, with the shared mass limit, as the scored set (`tools/d2/prepare.ts`, `--practice`, `--tasks`). A task is held out on the shape of its package alone. So first confirm, for each scored task, that a stored accepted answer still passes today's verifier, so that a rejection means something: all 35 accept controls of the pack fail today (`docs/transfer.md:118`).
- **Run one round.** A rehearsal with a script in each model seat walks the path first (`bun run runs rehearse`). Then one Builder session forks the starter and builds on it, with the ban in its prompt lifted as agreed. The host then compares the harness that session left with the starter: two solves per task under each, under today's limits of 120 minutes and 24 turns, and under a dollar cap. For each solve the host records whether the answer was valid, and the turns, CPU seconds, time and billed cost it used.
- **Read the result at several budgets.** PR #55 does this (`--budget`, in turns, CPU seconds or seconds, fixed before the first solve). A solve that used more than a budget counts as no answer at that budget, so one set of solves gives the tally at every shorter budget. This is an approximation, because the solver was told only the long limit. The starter's own solves are read the same way: at each budget, on how many tasks it was valid in both solves, in one and in none. The report also holds how far the use of each unit moved between two solves of one task, which decides the unit of the budget.
- **Label every rejection by hand.** A hand label is one person's verdict on one rejected answer, written before any Judge ruling is seen: true fail (the answer is wrong), check defect (the check rejected a correct answer) or unclear, with a note when the task itself looks infeasible. With 32 solves this is a small job, and it stands in for the Judge until Phase 1. PR #55 has this path: with no reviewer seated, every rejection waits for a person, and `tools/d2/settle.ts` writes a packet for each and applies the labels.

**Gate G0:** the round finishes under its cap with a tally of wins, losses and ties. The Starter Built Harness's own result is written down at the full limit and at two shorter budgets: the tasks with a valid answer in both solves, in one, and in none. The plan continues with the budget at which the starter is valid on about half the solves. If it is valid on nearly every solve even at the shortest budget, the tasks are too easy to show an improvement, and they are replaced before another session is paid for. The gate does not depend on which harness won.

### Phase 1: one Judge and a frozen correctness model

The goal is that no rejection counts until it has been verified independently.

- **Label the stored rejections by hand.** These are the five from the second Examiner session, the rejections among the 14 of 25 tasks that the first sessions lost at gate 2, and a blind sample of 20 from the 64 stored rejections (`tools/c/rejections.ts`). The tool draws the sample by a fixed seed and writes one packet per answer: the task with its hidden values, the public rules, the answer and the checks that rejected it. It refuses to draw from a log that already holds a ruling, so the sample is drawn in a fresh campaign log and the Judge rules there afterwards. A sample without any check defect cannot show that the Judge catches one, so known defects are added if it holds none. The Referee ruled all 64 a true fail, and no person has checked that ruling (`docs/transfer.md:119`).
- **Turn the Referee into the single Judge** by giving it a shell and the domain's installed engines. It looks at one answer at a time and recomputes each rule that a check reported as broken, from the public rule and the instrument, before it is shown the check's code. It needs no reference answer, because the task's rules define what is correct, and it builds no tools of its own. It is not told which harness produced the answer. In PR #55 the Referee's ruling already decides whether a rejection counts, with a probe tool, no shell and no measurement against hand labels.
- **Rule on every rejection.** If the recomputation confirms the violation, the rejection is a true fail. If it shows the rule is met, the rejection is a check defect. If the Judge cannot tell, the ruling is unclear. After a check defect or an unclear ruling the task is set aside as disputed, and a check defect goes to the Examiner for repair. PR #55 builds the setting aside, and the settling by a person's labels (`tools/d2/settle.ts`). There a comparison also stops once three tasks show a check defect or a check that could not run (`--defects`), since the check program then needs repair before more is spent.
- **Audit a sample of valid answers.** In every comparison the Judge recomputes a random sample of the answers the checks accepted, in the same way. It reports a wrong pass and overrules none.
- **Measure the Judge before trusting it, and keep measuring.** Its rulings are compared with these hand labels and those of Phase 0 against the bar: it must catch three in four of the labelled check defects, and it may void at most one in ten of the labelled true fails. v2 has this instrument (`src/review/agreement.ts`). The bar is read once the labels hold at least ten rejections of each kind. At that size it is a screen. A Judge that catches only half the defects passes about 1 time in 20, but one that voids three true fails in ten still passes about 1 time in 7. So the labels keep growing, by up to 10 per comparison, and the two rates are read again over all labels. With 50 labelled true fails, a Judge that voids one in five passes 1 time in 20. Until the bar is cleared, and whenever a rate falls outside it again, a person reads every ruling, true fails included. Reading the bar over all labels after each comparison is the new part.
- **Give the Judge its own sandbox policy,** because it reads the hidden values and, after its ruling, the check program.
- **Audit the imported truss checks.** List each check's instrument with the acceptance reading (`tools/c/accept.ts`). An instrument that an agent wrote is a fault that needs the operator's word. Make a crash of the engine a non-result. Rebuild the controls from stored valid answers, since all 35 accept controls fail today (`docs/transfer.md:118`).
- **Freeze, then repair only between comparisons.** Freeze contract and check program together (`tools/c/accept.ts --freeze`). From then on the Examiner patches a check the Judge ruled defective, and the host accepts the patch as the section on the correctness model describes. The reading that judges a patch exists and already lets a person's labels stand over the rulings (`tools/c/repaired.ts`). Most of the rest was written on 8 October and taken out of PR #55, because the plan then built neither part. Commit `410aee3` holds it. One part is a session that writes one rule with its check and puts it through gates: the candidate only adds to the pack, its controls get their labels in two runs, and the accepted answers on record are graded under it. The other part changes the checker inside one campaign log, so that a repair needs no new campaign, while a comparison is still made within one checker. Bringing them back leaves four changes. That session becomes a second kind of Examiner session, and it also patches an existing check. The host adopts a patch by itself when the reading finds nothing against it, which is the operator's word in that code. The host draws the rejections to label after a comparison. And both parts stood on the stronger solve's accepted answers, which are gone, so a check's own examples and the answers in the log take their place. A change to the contract, such as an objective added in Phase 3, still opens a new campaign: tasks are carried over (`tools/c/carry.ts`), solves are not.
- **Bring the repository's copy of this plan up to date.** PR #55 holds the account of v1 (`docs/v1.md`) and an earlier revision of this plan (`docs/plan.md`). That copy still sets the first experiment against the stored v1 harness, uses the name minimal baseline, and names no author for the correctness model.

**Gate G1:** every check of the correctness model has an instrument no agent wrote, or the operator's word. Its controls hold, and it is frozen. Every stored rejection has a ruling, and the Judge's rulings clear the bar against the hand labels.

### Phase 2: the comparison at a fixed budget

The goal is a comparison that separates two harnesses without a reference answer and without a harder exam, by giving both the same limited compute.

- **Set one compute budget for both harnesses.** It is given in turns and CPU seconds, with a time limit behind them, and the solver is told it. Its size comes from Phase 0: the budget at which the Starter Built Harness gives a valid answer on about half the solves, which is where the fewest tasks tie by chance. This is not built. PR #55 holds a solve to a time limit and a number of turns, named once for every command of a campaign (`--solve-minutes`, `--solve-turns`, `tools/d2/setting.ts`), and reads shorter budgets after the fact. It meters CPU seconds without capping them, and the solver is not told a budget. Until the cap on CPU seconds exists, the budget can be set in turns alone. In v1 the limit never bound: six tasks passed in 2.5 to 26 minutes of a 120-minute limit.
- **Score the tasks that end at the limit.** Built in PR #55: a solve that ends at its limit, or with no answer, counts as not valid and needs no ruling. Before that, v2 set a task aside as `wall-bound` when its only fails ended at the time limit. Under a budget these are the informative tasks.
- **Compare in code.** Built in PR #55 (`src/kernel/compare.ts`). Every solve of the new harness is paired with every solve of the reference harness on the same task, so the two sides may have different numbers of solves. The table below gives the result of one pair. The harness that wins more pairs wins the task; otherwise the task is a tie. A one-sided sign test reads the tasks. The terms of a comparison are written to the log before its first solve, so they cannot follow the results.

| How a solve ended | Its part in a pair |
| --- | --- |
| Valid answer within the budget | It beats an answer that is not valid. Two valid answers are even, unless an objective has been added in Phase 3. |
| Rejected, and ruled a true fail | Not valid. It loses to a valid answer and is even with another answer that is not valid. |
| No answer: the budget was reached, or nothing was submitted | Not valid. No ruling is needed. |
| The harness could not be opened | Not valid. The harness is what is compared, and one that cannot list its tools answers nothing. |
| Rejected, and ruled a check defect or unclear, or still waiting for a person | The task is set aside as disputed and left out of the test for both harnesses. |
| Non-result: a provider, sandbox or verifier failure | Solved again. It is never counted. |

- **The stronger solver is removed.** Built in PR #55. Gate 2 used one solve by a stronger model to prove that a task was possible. A task without any valid answer now stays in the held-out set and is a tie, which costs solves and introduces no bias. If no harness produces a valid answer in two comparisons in a row, the task goes to a person as possibly infeasible and leaves the set until it is labelled (`tools/d2/prepare.ts --keep`, `--infeasible`). The per-task controls went with the stronger solve. Nothing replaces them per task: a control belongs to a check, as the section on the correctness model has it.
- **Run an A/A comparison.** The Starter Built Harness is read against itself on separate solves, beside a comparison with the latest harness (`tools/d2/checkpoint.ts --noise`, in PR #55). It should give no step. Its tie share shows how often a fixed budget splits two solves of one harness at random, which is the noise every later comparison has to exceed.
- **Close the network for harness tools.** A harness tool gets no outbound network access in any solve, practice or held-out, so that practice matches the test. The solver's own shell keeps its access, and so does the Builder's shell while it builds. Not built: every command of a solve has network access today (`src/verify/solve-command-isolation.ts`).
- **Launches that cannot give a result are blocked.** Built in PR #55: a launch is refused without a cap, and when the tie share of the campaign's last comparison leaves fewer untied tasks than a step takes (`tools/runs/launch.ts`).
- **Show the Builder the result of a practice solve:** whether the answer was valid within the budget, and how much of the budget it used. The use of the budget is not shown yet.
- **The Examiner sees the task list with outcomes.** Built in PR #55 (`src/examiner/record.ts`). At its opening a session is given every task of the campaign, the older and easier ones included, each readable whole and each with one outcome so far: one harness won, a tie between valid answers, no valid answer yet, or disputed. A line names no harness, no count of solves, no check and no budget. This is a view of the log, and the Examiner makes no solve.
- **Screening and the anchor are removed.** Built in PR #55. Screening selected tasks by pass or fail, and the anchor existed to guard that selection. The comparison uses every held-out task and needs neither.

**Gate G2:** on at least 8 held-out tasks, at the fixed budget, the A/A comparison of the Starter Built Harness with itself gives no step. The tie share, the share of tasks with no valid answer and the billed cost per solve are recorded, and every rejection has a ruling.

### Phase 3: the objective, only if needed

This phase is built only if more than half of the tasks tie, at G2 or in a later comparison. Its goal is to separate two valid answers by a measured quantity.

- **State the objective.** Add an objective and its direction, for example "minimise mass", to the contract and to every new task. A solver that is not asked for the lightest design will not look for it. Changing the contract opens a new campaign. A task then sets no hard limit on the quantity that is its objective: four of the five tasks closed as too hard in the second Examiner session were rejected on the mass limit (PR #52).
- **Compute it in the host.** A check returns only pass or reject (`src/kernel/check-child.ts`), and the mass a truss answer reports is written by a harness tool, which the Builder controls. An objective function beside the checks computes the value from the answer. For truss, mass follows from the members and sections.
- **Use it only between two valid answers.** The better value wins the pair when the difference exceeds the margin; otherwise the pair stays even. The margin is fixed before each comparison.
- **Show it.** A practice solve returns the objective value to the Builder, and the best valid value seen for each task is reported beside each result. Nothing is decided on that best-known value.

**Gate G3:** in a comparison on at least 8 tasks under the new contract, the objective decides at least half of the pairs of two valid answers, and the A/A comparison still gives no step. If Phase 3 is skipped, G2 stands in for G3.

### Phase 4: a round at full size

The goal is one comparison at full size and at the fixed budget, between the Builder's latest harness and the reference harness, plus the noise estimates needed to size Phase 5.

- The Builder goes on from the harness its first session left. The comparison is made against the Starter Built Harness, which is the reference until a step is promoted.
- Run 12 held-out tasks with 2 solves per harness, which are the defaults in PR #55. Run more tasks if the tie share measured at G2 shows that 12 would leave fewer than 8 untied.
- Fix the budget, and the margin if an objective is in use, and write down the predicted result before launch.
- Have the Judge rule on every rejection before the result is read.
- Record three quantities: the share of tasks that tie, how much the use of the budget varies between repeated solves of the same harness, and the billed cost per solve. The report of a comparison in PR #55 holds all three.

**Gate G4:** the round finishes under its cap with a tally, every rejection in it has a ruling, and the three quantities are recorded. The gate does not depend on which harness won.

### Phase 5: checkpoint comparison

The goal is to detect a large improvement cheaply, by comparing once after several Builder sessions instead of after each one.

- **Keep one Builder conversation for the whole campaign, as v1 did.** A session still ends at its limits on time, turns and practice solves. The next session resumes the same conversation instead of starting from nothing, so the Builder keeps what it has learned and tried. The conversation is resumed only while the system prompt, the tool definitions and the model backend are unchanged, the rule v1's contract states.
- **Build the smallest loop that can hold that conversation.** v2 cannot do this today: a session deletes its transcript and releases the Builder's home directory when it ends (`src/builder/session.ts`). Phase 5 adds one process that keeps the conversation and the home directory open, runs the sessions of a checkpoint and then its comparison. The operator still launches each checkpoint and decides what follows it. The full controller loop stays in Phase 6.
- **Keep the context by compaction.** When the conversation outgrows the context window it is compacted, and each compaction is logged (`build.compacted`). After every compaction the standing facts are given again: the contract, the practice tasks, the limits and the list of failed practice solves. v1's Builder lost its task count at compaction and had to ask for it again.
- **Show every practice trace, failed as well as passing.** v1 showed its Builder passing traces only, because that Builder also wrote the test. Here the Builder is given the list of all failed practice solves so far, with the harness version, how each ended and the Diagnoser's finding. The list only grows; nothing is summarised or dropped, and the Builder chooses which failures to work on. Any trace is opened in full with `read_trace`, since all of them together would not fit in one message. That tool already opens any solve of a practice task (`src/builder/tools.ts`); what is bound to one harness today is the list in the opening message (`src/builder/session.ts`). Traces of held-out tasks are never shown, and a rejection ruled a check defect is left out.
- **Repair from traces with the agents that already exist.** v1 built this loop, and v2 has every part of it, so no new agent is added. For each failed practice solve the Judge first rules out a check defect. The Diagnoser then names the first step where the solve went wrong, the likely cause, whether the harness, the solver or the public rules are responsible, and one observation that would prove the diagnosis wrong. It reads the failed trace beside a passing solve of the same task. The Builder decides which failures to repair and solves the same task again after its change. The host then marks each failed solve in the list as open, repaired or failing again, read from the log. Repaired means the task passes in repeated solves under a later harness version.
- **Let the Builder keep notes.** It writes a notes file in its home directory for its own later use. If the process restarts and the conversation is lost, a new conversation opens with these notes and the same lists. In v1 a restart lost the conversation as well, and the notes were the only fallback.
- **Tell the Builder each comparison's result in aggregate:** wins, losses, ties, and whether it was a step. It is never told which held-out tasks were won or lost. This reveals a few bits per checkpoint, which is acceptable while checkpoints are few. Not built.
- **Compare once per checkpoint, on fresh solves.** The latest harness is compared with the reference harness on held-out tasks, with both sides solved again and interleaved. PR #55 has the command (`tools/d2/checkpoint.ts --new latest`). Until a step is promoted, the reference harness is the Starter Built Harness.
- **Stop after three checkpoints without a step.** PR #55 reads this rule from the reports (`src/kernel/reports.ts`). Each checkpoint is tested at the 0.10 level. When the harnesses are equal, three checkpoints read at least one false step about 14% of the time, so a step is repeated once on fresh solves before anything is promoted in Phase 6.
- **Keep every harness version.** After a comparison without a step the Builder continues from its latest harness, and the operator may tell it to return to an earlier one.

**Gate G5:** a step against the reference harness, which is the Starter Built Harness until a step is promoted. This replaces the existing plan's gate G4, a step that also holds on the anchor.

### Phase 6: after a step

Nothing in this phase is built before gate G5 has passed.

- The path from a one-line prompt to a contract. The Examiner drafts the rules from the field's standard and the operator freezes them. Until this exists, a campaign needs a v1 bundle.
- The full controller loop and promotion, which the ledger lists as deferred. A step is repeated once on fresh solves, and only then does the stepped harness become the reference harness. In PR #55 the operator promotes a harness by naming its digest as the reference. Once the reference is no longer the starter, that code also reads a step against the starter, and the step stands only with at least as many wins as losses there.
- An ablation study of a harness that showed a large gain, if the cause matters.
- Examiner depth. This plan does not address v1's fifth blocker, authors who widen a test instead of deepening it. If tasks stay too easy to separate harnesses, the first thing to test is v1's one working lever: several requirements that share one limit.

## Tuning

The way a task is scored changes, one compute budget is set for both harnesses, and three mechanisms are removed: the stronger solver, screening and the anchor. PR #55 has built the scoring and the three removals. The second column says where that branch stands on each setting.

| Setting | At PR #55 | Plan | Reason |
| --- | --- | --- | --- |
| How a task is scored | Built: valid beats not valid, over every pairing of solves | The same; the objective by a margin is added only if too many tasks tie | v1: 265 of 299 batteries passed every case, under a limit that never bound |
| Compute budget | 120 minutes and 24 turns per solve (`--solve-minutes`, `--solve-turns`). Shorter budgets are read after the fact, CPU seconds are metered and not capped, and tasks that end at the limit are scored | One budget in turns and CPU seconds, told to the solver, set from Phase 0 where the Starter Built Harness is valid on about half the solves | v1's solves took 2.5 to 26 minutes of a 120-minute limit |
| Objective | Not stated; truss tasks set a mass limit | Only if needed (Phase 3): stated in the contract, computed by the host, with no hard limit on the same quantity | A reported value is written by a harness tool; 4 of 5 too-hard tasks were rejected on the mass limit |
| Gate 2 witness | Removed. A task with no valid answer stays held out as a tie and goes to a person after two comparisons | The same | v1: the solver matched whatever the author's side found. The first sessions lost 14 of 25 tasks here |
| Screening | Removed; every held-out task is scored | The same | The comparison at a fixed budget gives wins and losses without selecting tasks |
| Anchor | Removed; the reference harness can be read against itself beside a comparison (`--noise`) | The same | The anchor existed to guard the screened choice |
| Starting harness | The stored v1 harness, as the reference and as the Builder's start; the starter is kept as `baseline` | The Starter Built Harness: the Builder forks it, and it is the first reference | No run found on record measures a starter alone, and the stored harness comes from v1's own runs |
| Scored set (`--target`) | 12 | 12 until supply allows more | No campaign has yet scored a task |
| Solves per side (`--solves`) | 2 | 2 | At equal cost, more tasks detect more than more solves |
| Level (`--level`) | 0.10 | Keep | For one comparison the real false-positive rate is 2% to 10%, depending on the number of untied tasks |
| Reader of fails | Referee with a probe tool and no shell. Its ruling decides whether a rejection counts, and it is unmeasured | Judge with a shell and the domain's engines, measured against hand labels after every comparison; it also audits a sample of valid answers | 36 of 47 misses in v1 were the check's; the Referee ruled 64 of 64 a true fail with no label to compare |
| What a harness may check | The Builder's prompt forbids any tool that tells the solver whether a candidate meets a rule | Agreed on 9 October: lifted. A tool that returns a finished answer stays forbidden | The solver writes its own check unaided, the stored harness already lists the conditions a candidate fails, and a budget prices the search |
| Stop rule | No step in 3 checkpoints | The same | The rule before it counted pass-rate points |
| Dollar cap | Required at launch for each comparison, with a reserve per solve | The same, agreed on 9 October | Over $220 was spent on 8 October with no task scored |
| Earlier solves | Fresh, interleaved solves at every comparison | The same | Reuse needs `src` and `vendor` unchanged for a whole campaign, and one frozen draw of old solves would bias every later checkpoint |
| Builder context | A fresh conversation in every session | One conversation across sessions, kept by compaction, with a notes file as fallback | v1 worked this way; a fresh session loses what earlier sessions learned and tried |
| Practice traces | A list bound to the session's starting harness | One growing list of failed practice solves across all sessions; any practice trace can be opened | v1 hid failed traces, and a genuine fail led to a harness change once in six chances |
| Author of the correctness model | None; contract and checks are imported from v1. A session that wrote a rule with its check was taken out of the branch | The Examiner drafts the contract and writes and repairs the checks; the operator freezes and labels answers blind; the host accepts each change without a model, and a hand label stands over a ruling | 36 of 47 misses in v1 were the check's, so repairs cannot wait for a person, and a person who writes rules is coaching the evaluator |
| Network for harness tools | Open in every solve | Agreed on 9 October: closed in every solve; the solver's own shell keeps it | A harness tool could send a held-out task out or fetch help |

## Statistical power and cost

A comparison with 12 untied tasks has about 65% statistical power when the new harness truly wins three tasks in four. A comparison of 12 tasks has fewer untied ones, because with 2 solves per side at least three tasks in eight tie by chance. If the reference harness gives a valid answer half the time and the new harness three times in four, 12 tasks give 51% power and 24 tasks give 80%. Small comparisons can therefore detect only large effects, which is why Phase 5 compares once after several Builder sessions.

| Untied tasks (sample size) | Wins needed for a step | Power at a 65% true win rate | Power at 75% | Power at 85% |
| --- | --- | --- | --- | --- |
| 8 | 7 | 17% | 37% | 66% |
| 12 | 9 | 35% | 65% | 91% |
| 16 | 12 | 29% | 63% | 92% |
| 24 | 16 | 53% | 88% | 99% |

How to read the table:

- **Effect size** is the true share of untied tasks that the new harness wins. A share of 50% means the two harnesses are equal.
- **Power** is the probability that a comparison detects an effect of that size and reports a step. The figures are exact for the sign test at a significance level of 0.10.
- **The table counts untied tasks, and a comparison runs more tasks than that.** With 2 solves per side, a task ties whenever both harnesses give the same number of valid answers. Without a real difference this happens for 38% of tasks when a solve is valid half the time, for 51% at four times in five, and for 69% at nine in ten. The budget is therefore set where the reference harness is valid about half the time. These figures assume that every task has the same chance of a valid answer, which real tasks do not.
- **The false-positive rate** is the probability of a step when the harnesses are in fact equal. For the four rows above it is 3.5% to 7.6%. Over all untied counts from 4 to 24 it ranges from 1.6% to 9.5%.
- **Several checkpoints raise it.** One comparison of equal harnesses on 12 tasks reads a step about 5% of the time, and three in a row about 14%.
- **Sixteen tasks give no more power than twelve** because the number of wins needed moves in whole steps.
- **Ties carry no information.** The share of tasks that end untied is therefore the main quantity Phase 0, G2 and Phase 4 have to measure.
- **What the papers behind v1 do.** Of the nine that compare harnesses, seven report point estimates of one to three attempts per task and no test, in the text read. HarnessBank asks for a paired z of 1.96, with no correction for repeated looks. HarnessOpt-Bench scores one candidate twice and treats any smaller difference as unresolved, which is this plan's A/A comparison.

Costs are estimates at $7 per solve. Live truss solves were billed between $3.29 and $8.15, and the five rejected ones, which ran longest, averaged $6.91 (PR #52). A shorter budget lowers the cost per solve, which Phase 0 and G2 measure. A Builder session is counted with up to 24 practice solves.

| Phase | Paid work | Estimate |
| --- | --- | --- |
| 0 | One Builder session and 32 scoring solves under today's limits: 8 tasks, 2 solves under each harness | $300 to $500 |
| 1 | Judge rulings on the stored rejections; the Referee's reading of 64 cost $25.14 | Under $50 |
| 2 | 48 solves at the fixed budget: 8 tasks, 4 solves under the Starter Built Harness for the A/A comparison and 2 under the latest harness | $200 to $350 |
| 3 | Only if needed: Examiner sessions for tasks under the new contract, and an A/A comparison of 32 solves | $250 to $350 |
| 4 | 48 scoring solves and one Builder session | $400 to $600 |
| 5 | Per checkpoint: three Builder sessions and 48 solves. Up to three checkpoints | $850 to $1,000 each |

For comparison, one round at the defaults before PR #55 was about 430 solves, close to $3,000. Removing screening and the anchor is what brings a scored round under $600. An Examiner session is also cheap now that it no longer pays for solves by a stronger model: its own turns cost $2.01 of the $48.45 in the second session.

## What we will not do, and why

Twenty-one ideas are deliberately left out. Most were tried in v1, and each row gives the result that speaks against the idea.

| We will not | Why |
| --- | --- |
| Build an agent that finds the answers | Such an agent would be the same model with a shell, which is what the solver already is, so it would find nothing the solver cannot. v1's `claude/answer-builder` branch, a second author for the correctness model, was never run, so no result speaks for it. |
| Keep reference answers | A design task has many valid answers, so a single reference is not meaningful. The checks verify the required properties, which needs no reference. |
| Use a value the answer reports as the metric | The Builder writes the tool that reports it. The host computes the objective from the answer. |
| Make tasks hard by building them around a chosen answer | v1 tried this with six tasks sized beyond greedy and local search. The solver passed all six in under 26 minutes. |
| Set limits with a stronger solver or a longer search | v1 reset six limits from searches of up to 3.4 hours, and the solver passed 5 of 6. A Builder at higher effort than the solver gave 6 of 6, twice. |
| Let a Judge pick the better of two answers by impression | A model tends to prefer the more convincing answer, and the Builder would learn to optimise for that preference. v1 did not allow two answers in one Judge prompt. |
| Add a second Judge for pairwise comparison | Validity and measured values are compared in code. |
| Have the Judge build its own tools | A shell and the installed engines are enough to recompute a rule. Building tools is the Builder's task. |
| Let a Judge overrule passes | v1's passes were reliable: its Judge overturned 5 of 1,411. The Judge audits a sample of passes and reports what it finds; it overrules none. |
| Keep screening and the anchor | Both exist to select tasks by pass or fail. The pairwise comparison uses every held-out task. |
| Give the Examiner a target pass rate or a difficulty band | v1 steered its author with a band and changed that feedback first, and it did not make tasks harder. The Examiner is told each task's outcome and no target. |
| Score individual tools, or build other attribution machinery | The parts of a harness interact, and an ablation study costs as much as a full round. |
| Run a full-size comparison after every Builder session | At the defaults before PR #55 a round cost about $3,000, and the gain from a single session is usually too small to detect. |
| Reuse earlier solves of the reference harness | The recorded condition includes a digest of `src` and `vendor`, which change between checkpoints, and one frozen draw of old solves would bias every later comparison. |
| Enlarge a probe by asking for more tasks at once | In v1 the added tasks passed in 10 of 13 cases. |
| Let the Builder write tasks or checks | In v1 a harness passed 75 of 75 tasks its own Builder wrote, and 2 of 23 hard tasks from a shared set under another solver. |
| Add more review lanes, launch commands or log readers before Phase 4 | Principle 8: no live result has shown a need for them. |
| Summarise failed traces into an issue list before the Builder sees them | The failed traces are appended and shown as they are. v1 consolidated them into at most six issues, and a genuine fail still led to a harness change only about once in six chances. |
| Take the shell away from the solver, so that it cannot check its own candidate | All computation would then pass through harness tools, which makes any harness look better than none, and the check would move into a harness tool. It also reverses the operator's decision of 14 September that every harness gives the solver a shell. A compute budget prices the search instead. |
| Let a person write or repair a rule, a check or a task | That is coaching the evaluator, which v1 ruled out as reward hacking. The operator freezes or refuses what the Examiner wrote and labels answers blind. No person reads or approves a repair. |
| Run a second domain beside the first | One query names one domain. A second domain would double the cost of every phase before the first has shown a step. |

## Decisions for the operator

Twelve choices are yours, and six are settled. The last two hold no phase.

- [x] **The first experiment.** Agreed on 9 October, and made simpler the same day: the first experiment is the first round. The Builder forks the Starter Built Harness and builds on it, and the new harness is compared with the starter. How the starter does by itself is read from that comparison, so no separate run is needed, and PR #55 can launch the round as it stands. Still open: which eight stored tasks are scored. Holds Phase 0.
- [x] **Dollar cap.** Agreed on 9 October: a cap for each comparison, which replaces the decision of 8 October against a campaign cap. PR #55 builds it. Still open: the amount per phase. The upper estimate of each phase plus a quarter is proposed.
- [x] **The correctness model.** Agreed on 9 October, which settles the existing plan's decisions 38 and 47. The Examiner drafts the contract from the one-line prompt, writes one thin check per rule, derives the controls and repairs a check the Judge ruled defective, with no new agent. You freeze or refuse, and write none of it. The field's own tool is the instrument, and a check that is plain arithmetic on the answer is admitted by your freeze. The host accepts every change on readings that use no model. You read no repair: a hand label stands over a Judge's ruling, and after each comparison you label blind up to 10 ruled rejections. Holds Phase 1.
- [x] **The Judge's bar.** Settled on 9 October from the papers behind v1, at your request. The tool's defaults stay: the Judge must catch three in four of the hand-labelled check defects, and it may void at most one in ten of the labelled true fails. The bar is read once the labels hold at least ten rejections of each kind, and again over all labels after every comparison, each of which adds up to 10. None of the ten papers validates a judge against people with a stated bar, so the numbers are ours. The nearest precedents are 20 failed runs per benchmark labelled by three people (HarnessFix), 120 hand-labelled tasks (OpenComputer), and a gate on a learned verifier that is strict on false alarms and lenient on misses (SBCO: precision of at least 0.80, recall of at least 0.55). Holds Phase 1.
- [ ] **The compute budget.** Its unit and its size, chosen from Phase 0. Turns and CPU seconds are proposed as units, at the size where the Starter Built Harness is valid on about half the solves. Also that a task whose solves end at the limit is scored, which settles decision 21 of the existing plan. Holds Phase 2.
- [ ] **Controls for the checks.** Before PR #55, a stronger solver had to pass each task first (gate 2), and the Examiner wrote three wrong answers for each task from that solver's answer, to test the checks on that task. PR #55 removed both. Proposed: nothing replaces them per task. A control belongs to a check. Each check comes with one answer it must accept, one it must reject and the do-nothing answer, and the host runs them when the check is written or changed. When a check changes, every answer in the log is graded again as well. A faulty task is caught in the comparison: every rejection is ruled on, and a task without a valid answer in two comparisons goes to a person. PR #55 already works this way, so nothing new is built. Holds Phase 2.
- [ ] **The objective.** Needed only if Phase 3 is built: which quantity each domain's tasks state as their objective, with no hard limit on that quantity, and whether time and cost may break a tie. Reporting them only is proposed. Holds Phase 3.
- [ ] **The margin.** Also only for Phase 3: how much better an objective must be to win a pair while the noise is unmeasured. 1% is proposed. Holds Phase 3.
- [x] **What a harness may check.** The Builder's prompt forbids any harness tool that tells the solver whether a candidate meets a rule, which was v1's answer of 7 October (`src/builder/prompt.ts`). A solver does this unaided: v1 recorded that the solver wrote a search and ran it until the checks cleared, and the stored truss harness already has a tool that lists the geometry conditions a candidate does not meet. v1's reason for the ban was that its Builder had written the checks, which is not the case here, and a fixed budget prices the search. Agreed on 9 October: the ban is lifted, with the same rule in every session. A tool that returns a finished answer stays forbidden. Holds Phase 4.
- [x] **The network.** Agreed on 9 October: harness tools get no outbound network access in any solve, and the solver's own shell keeps it. Holds Phase 2.
- [ ] **The stack.** 38 pull requests are open. PR #55 sits on the top of the stack and holds the comparison this plan needs. Whether the stack merges before Phase 1's changes are added on it.
- [ ] **The plan of record.** Whether this amends or replaces "Anabasis: one plan". PR #55 puts an earlier revision of this plan in the repository (`docs/plan.md`). Whether this revision replaces that copy.

## Risks

The largest risk is that the tasks leave a harness no room to improve on the Starter Built Harness. The first round shows that, at the cost of one Builder session.

- **No room to improve.** The Starter Built Harness may give a valid answer on nearly every task even at a short budget. v1's record points that way for most tasks: the solver wrote its own search and passed, and twelve firmware tasks passed faster with the simulator withheld. The first round shows this only after one Builder session has been paid for, which is the price of running one experiment where two were planned. The tasks are then replaced before another session.
- **A noisy budget.** The turns or seconds a solve needs may vary so much between repeats that a fixed budget splits two solves of one harness at random. Phase 0 measures that spread, and the A/A comparison at G2 shows it as a tie share.
- **Phase 0 is read without a Judge.** A rejection in the first round could come from a faulty check, which caused most rejections in v1. Its rejections are therefore labelled by hand. Time and cost do not depend on the checks.
- **Too few untied tasks.** Ties and tasks without a valid answer shrink the test. Recorded supply is poor: 14 of 25 and then 5 of 7 Examiner tasks had no passing solve. G2 reports both shares, and Phase 4 is sized from them.
- **A Judge with the solver's blind spots.** It is the same class of model, so it may make the mistake a check made without ever reading the check. Its rulings are measured against hand labels before they count, and again after every comparison. One person writes those labels, where HarnessFix used three.
- **Repairs that follow the Judge.** A repair is accepted on the Judge's rulings, with no person in the loop. If the Judge is wrong in a consistent way, the checks drift with it. Two things stand against that: a hand label overrides a ruling, and after each comparison the operator labels blind up to 10 ruled rejections. OpenComputer's repair depends on a model's verdict in the same way. There the model judge agreed with people on 95 of 120 tasks, against 113 for the coded checks, so the Judge is the weaker of the two instruments. A wrong label now blocks a correct repair; the refusal names the label, so that it can be labelled again.
- **An Examiner that owns the whole exam side.** An Examiner told "one harness won" can reach that outcome with tasks whose solves vary widely in what they need. Such tasks split evenly and add nothing. The same author repairs checks, and a faulty check also looks like difficulty, which is why a repair may only withdraw rejections that the Judge ruled check defects. The tie share of the A/A comparison and the split of wins are watched for it. A check's own examples come from its author as well, so the independent tests of a check are the Judge and the hand labels.
- **The solver's own network access.** Harness tools lose outbound access, and the solver's shell keeps it so that it can install tools. A solver can therefore still fetch from the network during a held-out solve. v1 accepted this, and the trace of every solve shows it.
- **An objective that can be gamed.** This applies if Phase 3 is built. A harness may gain on the objective by giving up margin elsewhere. The checks stay the floor, and the host computes the objective, so a harness cannot gain by reporting a better number.
- **Regressions between checkpoints.** Several sessions of work can be lost at one comparison without a step. Kept harness versions limit the loss to a return to an earlier one.
- **Cost estimates.** They rest on a few observed figures: the billed truss solves and the cost of one Examiner session.
- **Context lost at compaction.** A long conversation is compacted many times, and detail drops out each time. The standing facts are given again after each compaction, and the notes file holds what the Builder chose to keep. The single conversation rests on v1's design and on no v2 result. If it does not help, sessions go back to opening fresh with the notes and the list.
- **Code that has not run.** Nothing in PR #55 has run with a real model. Phase 0 is its first live use, so a fault in the comparison would show there first. A rehearsal with a script in each model seat comes before the paid run.

## Sources

- **v2**, `s-smits/anabasis-v2` at PR [#55](https://github.com/s-smits/anabasis-v2/pull/55), branch `claude/frontier`, commit `942f6bd`, fetched on 9 October: `src/kernel`, `src/builder`, `src/examiner`, `src/review`, `src/solve`, `tools/c`, `tools/d2`, `tools/runs`, `docs/transfer.md`, `docs/v1.md`, the pull request's own account of what is built, and commit `410aee3` for the session that wrote a rule and for the change of checker inside a log. The plan was first written against PR [#54](https://github.com/s-smits/anabasis-v2/pull/54), commit `df3935a`.
- **v2 pull requests** read for their recorded results: [#16](https://github.com/s-smits/anabasis-v2/pull/16) (dollar cap), [#24](https://github.com/s-smits/anabasis-v2/pull/24) and [#34](https://github.com/s-smits/anabasis-v2/pull/34) (acceptance of a checker), [#45](https://github.com/s-smits/anabasis-v2/pull/45) (rehearsals), [#47](https://github.com/s-smits/anabasis-v2/pull/47) (launch notes), [#48](https://github.com/s-smits/anabasis-v2/pull/48) (settling by hand), [#52](https://github.com/s-smits/anabasis-v2/pull/52) (second Examiner session), [#53](https://github.com/s-smits/anabasis-v2/pull/53) (provider retries).
- **v1**, `s-smits/harness-builder-v4` at commit `0d0fae6`: `AGENTS.md`, `src/run/battery-sizing.ts`, `src/run/climb-readout.ts`, `src/run/climb-readout-frame.ts`, `src/critic/policy.ts`, `src/author/builder-conversation.ts`, the starter Built Harness under `starters/pi-built-harness/agent`, and the starter pack's `difficulty-ladder.md`. The commit the ledger cites, `7af7315`, could not be fetched.
- **v1's public repository**, [s-smits/anabasis](https://github.com/s-smits/anabasis) at commit `3f93d06`: `AGENTS.md`, "Open gaps: the four blockers to a climb", for the chosen-answer and long-search results, the firmware stand-in figures and the note on `claude/answer-builder`; and `src/author/builder-start-prompt.ts` for the rule on what a harness tool may do.
- **The operator's account of v1's notes**, 8 October 2026, drawn from `notes/binding-constraints.md`, `notes/climb-blockers-20261001.md`, `notes/climb-review-20261002.md` and `notes/wri-20261007`. These files were not read for this plan.
- **An independent review** of an earlier version of this plan and its system figure, 9 October 2026: 24 findings, each checked against the sources above before it was acted on.
- **Detection figures:** exact calculations for the sign test and for the tie share at a fixed budget, made for this plan on 8 and 9 October 2026.
- **OpenComputer**, Wei et al., arXiv 2605.19769 (May 2026), taken from v1's survey docs/ANALYSIS.md and read on 9 October. Its verifier repair is accepted on a model's reference verdict, and no person reads a repair. The check on it is a fixed set of 120 hand-labelled tasks: agreement of the verifiers with the labels rose from 85.2% to 94.1% after repair. Of 450 calibration runs, 76 showed a verifier fault, and 68 of those were repaired within three tries. The paper does not say how the 120 were drawn or whether the annotators were blind.
- **The ten papers of v1's survey** (docs/ANALYSIS.md), read on 9 October for how each validates its evaluator: Meta-Harness (arXiv 2603.28052), Socratic-SWE (2606.07412), Self-Harness (2606.09498), HarnessFix (2606.06324), Adaptive Auto-Harness (2606.01770), SBCO (2608.10157), HarnessBank (2607.13683, listed in the survey under another title), Do Agent Optimizers Compound? (2607.14004), Anchor (2605.26321) and HarnessOpt-Bench (2608.06301). They were read through a page reader. The pages of HarnessFix and Anchor were cut at 100,000 characters, and HarnessFix's accuracy against its annotators was not retrieved.
