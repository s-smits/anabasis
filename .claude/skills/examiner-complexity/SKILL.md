---
name: examiner-complexity
description: "Calibrate the difficulty of the Examiner's tasks by editing the reach scale and worked examples (`src/examiner/ladder.ts`), the drafting prompt (`src/examiner/draft.ts`), and the writing prompt's \"How hard\" section (`src/examiner/prompt.ts`) so tasks remain solvable while leaving informative headroom above the reference harness. Includes scripts to grade archived tasks blind (`grades.ts`), re-rate ladder rungs (`grades.ts rungs`), inspect draft admission outcomes (`exams.ts`), and measure supply and time to first comparison (`ambition.ts`). Changes are validated through paired live seats and fresh campaigns."
---

# Examiner complexity

A paired comparison has statistical power only on tasks that the reference harness solves inconsistently; an exam that the reference solves on every attempt, or never solves, supplies no learning gradient. While the Examiner model chooses each task (`AGENTS.md`, section 2), this skill calibrates the difficulty guidance it receives: a reach scale, worked examples drawn from domains outside any examined campaign, and factual observations about reference performance. Edits modify prompt text rather than tasks or checks (rule 2), and supply empirical facts instead of numeric targets. Paired live-seat evaluations follow `system-path-simulation` (`cases/optimize.md`), and the difficulty scale corresponds to lane 14 of `whole-run-investigation`.

## 1. Calibrate the record

A blind grader seeing only each task's public input and rules writes `task<TAB>grade` on the reach scale (`GRADES`, `src/examiner/ladder.ts`):

```sh
bun .claude/skills/examiner-complexity/scripts/grades.ts <grades.tsv> <campaign folder>...
```

The script reports, per grade, the count of valid solves, tasks valid on every solve, and median turns. The highest grade that the reference consistently clears in a few turns defines the ceiling that new tasks must surpass.

## 2. Diagnose where a solver stops

Because a solver with shell access can script routine calculations, task difficulty increases meaningfully only in three places on the ladder: when a local search from the obvious starting point converges to the wrong basin; when a convenient approximate model diverges from the deciding engine near the specification; or when the specification sits within tolerance of a theoretical bound. Inspect the drafted exam (`draft.finished`) to determine which of these mechanisms the domain supports. Rules that merely restate textbook equations cap difficulty near grade 2, as does a frozen exam; therefore evaluate ladder edits only on domains where the exam remains open.

```sh
bun .claude/skills/examiner-complexity/scripts/exams.ts [--every] <campaign folder>... > exams.csv
```

This emits one row per task family and session (`--every` emits one row per draft): drafts held and refused, refusals at the ceiling (`noroom`), unanswered drafts, proved answers, input length, and title. Look for genuine movement above the difficulty ceiling and qualitative shifts in task structure rather than longer prompts. Conversely, a ladder pitched too high starves supply, causing repeated refusals until the budget is exhausted; check for supply starvation before revising worked examples again.

## 3. Edit the owner

| Responsibility | Owner |
| --- | --- |
| Reach scale, worked example fields, and the three difficulty mechanisms | `src/examiner/ladder.ts` (`GRADES`, `FIELDS`, `SOLVER`; task writing reads `LADDER`, drafting reads `REACH`) |
| Exam difficulty bounds and how rules are stated | `src/examiner/draft.ts` |
| Writing tasks above the reference harness's current grade | `src/examiner/prompt.ts`, "How hard" |

`test/examiner-ladder.test.ts` enforces alignment between the scale and lane 14, ensures examined domains do not appear in worked examples, and verifies that both drafting and writing prompts receive the ladder. Rewrite existing guidance rather than appending new paragraphs (rule 13), documenting the rationale for each change in the module's header comment.

Revise worked examples only on the basis of blind re-ratings rather than the author's own judgement:

```sh
bun .claude/skills/examiner-complexity/scripts/grades.ts rungs packet > <packet.md>
bun .claude/skills/examiner-complexity/scripts/grades.ts rungs compare <rungs.tsv>...
```

At least two independent graders who have read neither the ladder nor the current conversation grade the packet as `id<TAB>grade<TAB>place` and confirm whether the stated engine alone decides an answer. `compare` flags rungs whose median grade falls `below` its target rung or sits `flat` relative to the preceding rung. Rewrite flagged or undecidable rungs and re-grade with fresh graders, because graders who flagged a rung are coached by the subsequent rewrite. Replace any worked field that fails to climb with a domain outside all examined packs.

## 4. Compose, then seat

Every edit to a composed prompt defines a distinct experimental arm. Inspect the exact prompt diff with `live-seat.ts prompt` (`cases/optimize.md`, step 4) before spending credits. With operator approval, run paired live seats following steps 5 to 8: use a single login and host, select a writing position only where the exam supports genuine difficulty headroom, and evaluate with `pairs` at equal admission counts, passing `--reviewer` and `--reviewer-effort` matching the source campaign.

## 5. Read a fresh pair to its first comparison

```sh
bun .claude/skills/comparison-reading/scripts/reading.ts --zone <log or campaign name>...
```

For each comparison, this prints the count of reference tasks with zero, partial, or universal valid solves, the untied tasks on validity and on the objective, and the A/A control's untied share. When the reference is valid on every task, an untied share close to the A/A noise floor reflects measurement noise rather than signal. No model seat reads this output.

Only fresh campaigns can demonstrate that task supply increased (`AGENTS.md`, section 10, item 9). With operator authorisation, launch a control and treatment arm together via `runs fresh ... --at <commit>` on the same domain, login, and host class, recording predictions beforehand:

```sh
bun .claude/skills/examiner-complexity/scripts/ambition.ts <control folder> <arm folder>
```

The script reports elapsed hours, solves, and spend to the first `comparison.started` and `harness.promoted` events, together with per-session Examiner metrics: the active reference, drafts held, admission categories (`every`, `some`, `none, proved`), and spend. For writing sessions, it also reports requested count, current standing, and proposals by family indexed by turn, so supply is evaluated as held against requested, and an in-progress session is compared against an ended session at the same turn rather than at its end. Count task families via this script or `exams.ts` instead of `data.family` on `task.proposed`. Evaluate the output in order: confirm the arm received the updated prompt text, then compare the `every`-solved share, drafts held, answerability, and time to first comparison.

## 6. What may be claimed

A paired live-seat round represents two draws and yields a lead only (rule 6); a fresh pair represents one campaign per arm. Claiming "the exam is harder" requires blind grades higher than the control joined to solve outcomes via `grades.ts`. Claiming "supply rose" requires a higher held-task share and shorter time to first comparison across fresh campaigns, replicated in a second domain. Neither claim establishes that a harness improved (rule 1), and provider login waits do not count as system runtime (rule 15).
