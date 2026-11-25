# Operator questions

These are the questions the operator asks of every investigation, taken from the questions the operator has asked repeatedly across sessions. `wri.ts start` copies the table below into each investigation's `shared-instructions.md`, under `## Operator questions`.

Each lane named in a row's `lanes` column answers that question with a `Question <id>: <answer>` line under `## Questions`, and `collect` refuses a report that leaves one out. `reports.md` gathers the answers per question, and the synthesis answers each question from them.

## Adding and changing questions

- **For every later investigation:** add a row to this table with a new id and one or more lanes.
- **For one investigation only:** add a row to that investigation's `## Operator questions` section before `wri.ts lanes`, or delete a row there.

A row added after a lane's prompt was built is not in that prompt, but `collect` still asks it of that lane: rebuild the lane, or have its report answer the row.

The blind lane 1 and the isolated lane 20 answer none: neither may see the shared framing. Every other lane in the catalogue answers at least one (`test/wri-readers.test.ts`).

## Questions

| id | lanes | question | read with |
| --- | --- | --- | --- |
| Q1 | 6, 13 | Is the system working: did the campaign promote, and which link of the chain stopped the next promotion? | `climb.txt`, `CHAIN`, `table-timeline.ts` |
| Q2 | 2 | Is this version better than the previous release in the same domain, at matched active hours? | `history.txt`, `wri.ts backtrack --domain`, `trend.ts` |
| Q3 | 2 | Were this run's promotions worth more than earlier promotions in the same domain (objective gain and `written-after` share per promotion)? | `history.txt`, `starter-reads.ts` |
| Q4 | 2 | Is a fall in promotions a regression, or an intended tightening of a rule between the releases? | `git log <previous release>..<run commit>`, `promotion-tuner` replay |
| Q5 | 6 | Did each promotion beat the starter on tasks written after it? | `starter-reads.txt`, `transfer.txt` |
| Q6 | 10 | Is the promoted harness ready for the external benchmark, and does it beat `bareSolver` there? | `portability.txt`, `runs bench`, `score.ts table` |
| Q7 | 6, 12 | Did practice gains carry to held-out tasks, or are they overfitting? | `transfer.txt`, `practice.txt` |
| Q8 | 7 | After each promotion, did the Examiner write harder tasks, with lower reference validity or objective than the batch before? | `ambition.txt`, `aim.txt`, `nearness.txt` |
| Q9 | 4, 7 | Is validity near the ceiling, and if so, are the tasks too easy or the checks too lenient? | `checks.txt`, `starter-reads.ts --tasks`, `wri.ts grade` |
| Q10 | 7 | Did any Examiner session propose no task, or the run end `no-room`, and why? | `EXAMINER ZERO YIELD`, `slice.ts Examiner:x-<n>` |
| Q11 | 7 | Did the Examiner prove its answers with a real domain engine, or with reasoning no stronger than the solver's? | `exam.call`, `try_answer` calls, `runtime.tools.run` use |
| Q12 | 16 | Did the Examiner get enough feedback to aim (item scores, bands, tallies) without anything crossing the wall? | `examiner-view.txt`, `wakes.txt` |
| Q13 | 5, 11 | Which rubric items carried signal between the arms, and how much weight saturated on passing solves? | `scores.txt`, `pairs.txt`, `drafted.txt` |
| Q14 | 11 | Did the drafted exam pick a sound lane (code, judge or mixed) and measure the whole prompt? | `drafted.txt`, `campaign.opened` |
| Q15 | 7 | Did the tasks cover the prompt's scope, or cluster in one family or reuse practice? | `FAMILY CONCENTRATION`, `aim.txt` |
| Q16 | 5 | Is each step real or noise: what did the A/A control read, and do margins clear rollout noise? | `REFERENCE AGAINST ITSELF`, `MARGINS INSIDE THE NOISE`, `readings.txt` |
| Q17 | 5 | Did the sample size (tasks and solves per task) limit what a comparison could detect? | `readings.txt` (`detectable`), `UNDERPOWERED NO-STEPS` |
| Q18 | 5 | Did each step come from validity or from the objective alone? | `STEP CARRIERS`, `scores.txt` |
| Q19 | 3 | Did any seat game its gate or score, and is each channel closed in code rather than by a ban? | `gaming.txt`, seat traces |
| Q20 | 9 | Did anything cross the wall, and did every seat run on the backend the launch named? | `wall-audit.txt`, `degradations.txt`, `SERVED ANOTHER MODEL` |
| Q21 | 11, 17 | Did the judged lane run (cross-family `referee.pair`), and how did its votes split? | `referee.pair` events |
| Q22 | 17 | Were rejections earned, and did any set-aside move a reading? | `rejections.txt`, `restated.txt` |
| Q23 | 18 | Did the draft audit find real holes, and can it report a probe that makes a check throw? | `draft-audit.txt`, `src/audit/draft-audit.ts` |
| Q24 | 8, 15 | Did solvers call the harness's programs, and did those calls win tasks? | `TOOLS CALLED`, `parts.ts --comparison g-<n>` |
| Q25 | 8 | What did the Builder change, and does `BUILT_AGENTS.md` tell the truth about the tools it ships? | `harness-versions.ts --diff <digest>` |
| Q26 | 19 | Did seats have the freedom they needed (`/tmp`, installs, shell), or did the wall or tool friction cost turns? | `execution.txt`, `calls.txt` |
| Q27 | 16, 19 | Do the seat prompts state facts that match the files the seat opens, such as the shape of `public/task.json`? | `src/solver/prompt.ts`, the solvers' first turns |
| Q28 | 13 | Why did the run end, and does the log record that reason? | `campaign.ended`, `ending.ts`, `launches.txt` |
| Q29 | 13 | Did the keeper carry the run across logins, crashes and host reboots? | `continuity.txt`, `campaign.waited`, `launches.txt` |
| Q30 | 13 | Can the run be resumed from the current checkout, or did a path it runs move since its commit? | the launch receipt's tree, `tools/runs/manage.ts` |
| Q31 | 14 | Where did the wall-clock hours go: seats, waits, owed starter reads, host load? | `seats.txt`, `epoch-spend.txt`, `LONG SILENCES` |
| Q32 | 14 | What did each promotion cost in dollars and active hours, and is that falling? | `epoch-spend.txt`, `table.ts --rows cost` |
| Q33 | 14 | At this pace, when would the next promotion arrive? | `climb.txt`, `epoch-spend.txt` |
| Q34 | 9, 14 | Was a host unhealthy (load, reboots, crashing services), and did that move any outcome? | `HOST LOADED`, `LOAD MOVED`, `NON-RESULTS` |
| Q35 | 13 | Should the run continue, pause at this promotion or stop, and what would the next promotion settle? | `decision-points`, the run's predictions |
| Q36 | 2 | Did each fix made since the last investigation of this domain fire its mechanism event in this run? | `git log`, `runs source --has`, the mechanism's events |
| Q37 | 2 | Do vetted findings from earlier investigations recur here? | `wri.ts findings` |
| Q38 | 9 | Does the launch commit hold every fix the run was meant to test? | `source.txt`, `launches.txt`, `git merge-base --is-ancestor` |
| Q39 | 19 | Is the domain broken, or only slow, with limits binding on both arms? | `MISSES AT A LIMIT`, `execution.txt` |
| Q40 | 12 | Did the Builder use practice honestly and practise its final bytes? | `practice.txt`, `FINAL BYTES NEVER PRACTISED` |
