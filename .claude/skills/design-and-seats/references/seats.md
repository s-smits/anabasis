Read this reference before modifying a seat's prompt, tools, or view of campaign history. It expands
the seat overview in `AGENTS.md` section 3.

## 3. The seats

| Seat | Reads | Never reads | Source |
| --- | --- | --- | --- |
| Examiner | The view detailed below | Any target count, harness name, candidate measures, or the reference harness's guide and programs | `src/examiner/` |
| Builder | The closed list in `AGENTS.md` section 1, its own notes, and other kept harnesses (`kept/`) | Any other exam-side data | `src/builder/` |
| Solver | The public task specification, public rules, active harness, and solve limits | Check programs and hidden values | `src/solver/`, `src/harness/`, `src/tools/` |
| Verifier | The submitted answer, full task, check program, and verification engines | n/a | `src/kernel/verify.ts`, `src/wall/` |
| Referee | The full task with hidden values, rules, submitted answer and its files in full, refusing checks, and check program | The harness, solver trace, or Builder state | `src/referee/referee.ts` |
| Host | The campaign log | n/a | `src/kernel/`, `tools/` |

### What the Examiner reads

The Examiner's view is assembled in `src/examiner/record.ts`, whose head comment enumerates every
field:

- the contract, the operator's brief, the per-solve budget, and public examples;
- the reference harness's per-task outcomes from the last scored comparison (`poolOf`), the turn
  counts and objective measures of its valid answers (`referenceAnswers`), and which harness won
  each task together with the deciding measure (`carriedBy`);
- the last comparison in which the reference stood, including how often its own two rollouts
  disagreed in that A/A control (`outcomeSummaryLines`), and the identifiers of checks faulted by a
  `check-defect` ruling (`faultedOf`);
- on each subsequent invocation, only events reported since the Examiner was last informed (`heard`
  with `after`, `wakeMessage`);
- its walled home directory, persisted across sessions, and black-box access to run the reference
  harness (`try_reference`) without reading its contents.

By contrast, a drafting session receives only the domain prompt, the host's validation output for
each draft, and an empty home directory.

### Tools

- **Examiner** (`src/examiner/write.ts`): `propose_tasks`, `read_example`, `read_opening`, standard
  coding tools, `finish`, and two trial tools. `try_answer` runs the checks against the Examiner's
  own answer; a pass on a held-out task is logged as `task.feasible`. `try_reference` executes one
  or two billed solves under the reference harness using the campaign's setting. Each trial solve is
  tagged with the session identifier so `countedSolves` excludes it from all comparison, practice,
  and Builder folds while `spendOf` bills it to the Examiner. Calls are refused once the session's
  trial quota (`exam.started.limits.tries`) or budget reserve is exhausted, and rejections from
  `try_reference` are not sent to the Referee. A drafting session exposes `draft_exam` in place of
  the task gate (`src/examiner/shell.ts`).
- **Builder**: standard coding tools, `practice`, `read_trace`, `read_opening`, `check_harness`,
  `preview_harness`, and `finish`, together with the campaign tools from `AGENTS.md` section 4 when
  running under the campaign command.
- **Solver**: the five tools listed in `AGENTS.md` section 3. The solver writes its answer to
  `answer.json`, and calling `submit` with `malformed` flags the task instead.
- **Referee**: `probe_check`, `read_answer_file`, `read_check_program`, and `record_ruling`.

Older campaign logs may still contain `diagnosis.*` events from a retired Diagnoser seat.
