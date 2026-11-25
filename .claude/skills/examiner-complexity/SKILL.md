---
name: examiner-complexity
description: "Use before editing src/examiner/{ladder,draft,prompt}.ts or when calibrating Examiner task difficulty, supply, draft admission, or time to first comparison. Edits the reach scale and worked examples (`ladder.ts`), drafting prompt (`draft.ts`), and writing prompt's \"How hard\" section (`prompt.ts`) to leave informative headroom above the reference harness. Scripts: `grades.ts`, `grades.ts rungs`, `exams.ts`, and `ambition.ts`; validated through paired live seats and fresh campaigns."
---

# Examiner complexity

A paired comparison has statistical power only on tasks that the reference harness solves inconsistently. While the Examiner model authors each task (`AGENTS.md` section 2), this skill calibrates the difficulty guidance it receives (the reach scale, worked examples from non-campaign domains, and factual reference performance observations) without hand-editing tasks or checks (rule 2) or prescribing numerical targets. Paired live-seat evaluations follow `system-path-simulation` (`cases/optimize.md`), and the reach scale aligns with lane 8 of `whole-run-investigation`.

## 1. Calibrate the record and diagnose where solvers stop

A blind grader seeing only each task's public input and rules writes `task<TAB>grade` on the reach scale (`GRADES`, `src/examiner/difficulty.ts`):

```sh
bun .claude/skills/examiner-complexity/scripts/grades.ts <grades.tsv> <campaign folder>...
bun .claude/skills/examiner-complexity/scripts/exams.ts [--every] <campaign folder>... > exams.csv
```

`grades.ts` reports per-grade valid solves, tasks valid on every solve, and median turns (identifying the ceiling grade new tasks must surpass). Because a solver with shell access scripts routine calculations, difficulty climbs meaningfully only when local search converges to the wrong basin, when a convenient approximation diverges from the deciding engine near the specification, or when the specification sits near a theoretical bound. `exams.ts` emits one row per task family and session (`--every` per draft: held, refused, `noroom`, unanswered, proved, input length, title) to distinguish genuine structural movement above the ceiling from prompt verbosity or supply starvation.

## 2. Edit the owner and blind-grade the rungs

| Responsibility | Owner |
| --- | --- |
| Reach scale, worked example fields, and the three difficulty mechanisms | `src/examiner/difficulty.ts` (`GRADES`, `FIELDS`, `SOLVER`; task writing reads `DIFFICULTY_SCALE`, drafting reads `REACH`) |
| Exam difficulty bounds and how rules are stated | `src/examiner/draft.ts` |
| Writing tasks above the reference harness's current grade | `src/examiner/prompt.ts`, "How hard" |

`test/examiner-ladder.test.ts` enforces alignment with lane 8, excludes examined campaign domains from worked examples, and verifies that both drafting and writing prompts receive the ladder. Revise worked examples only via blind re-ratings by at least two independent graders (`id<TAB>grade<TAB>place`):

```sh
bun .claude/skills/examiner-complexity/scripts/grades.ts rungs packet > <packet.md>
bun .claude/skills/examiner-complexity/scripts/grades.ts rungs compare <rungs.tsv>...
```

Rewrite rungs flagged as `below`, `flat`, or undecidable by the stated engine alone, and re-grade with fresh graders.

## 3. Seat, launch fresh campaigns, and report claims

Inspect the exact prompt diff via `live-seat.ts prompt` (`cases/optimize.md` step 3) before running paired live seats with operator approval (`pairs` at equal admission counts with matching `--reviewer` and `--reviewer-effort`).

To inspect comparison power zones and verify task supply on a fresh control/treatment campaign pair (`runs fresh ... --at <commit>` on the same domain, login, and host class):

```sh
bun .claude/skills/comparison-reading/scripts/reading.ts --zone <log or campaign name>...
bun .claude/skills/examiner-complexity/scripts/ambition.ts <control folder> <arm folder>
```

`reading.ts --zone` prints reference tasks with zero/partial/universal valid solves, untied tasks on validity and the objective, and the A/A untied share. `ambition.ts` reports elapsed hours, solves, and spend to the first `comparison.started` and `harness.promoted`, plus per-session Examiner metrics (`every`, `some`, `none, proved`, held vs requested, and proposals by family indexed by turn). Claim "the exam is harder" only when blind grades exceed the control joined via `grades.ts`; claim "supply rose" only when held-task share rises and time to first comparison falls across fresh campaigns, replicated in a second domain.
