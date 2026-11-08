Read this before changing a seat's prompt, tools or view of campaign history. It expands the seat
list in `AGENTS.md` section 3.

## 3. The seats

| Seat | Reads | Never reads | Source |
| --- | --- | --- | --- |
| Examiner | The view below | A target, a harness's name, the other harness's measures | `src/examiner/` |
| Builder | Section 1's closed list, its notes, the other kept harnesses (`kept/`) | Anything else of the exam side | `src/builder/` |
| Solver | The task's public part, the rules, the harness, its limits | Checks and hidden values | `src/solver/`, `src/harness/`, `src/tools/` |
| Verifier | The answer, the task, the check program, the engines | n/a | `src/kernel/verify.ts`, `src/wall/` |
| Referee | Task with hidden values, rules, answer, refusing checks, check program | The harness, the trace, the Builder | `src/referee/referee.ts` |
| Host | The log | n/a | `src/kernel/`, `tools/` |

### What the Examiner reads

The view is built in `src/examiner/record.ts`, whose head comment lists every field:

- the contract, the operator's brief, the solve budget and examples;
- the reference's outcomes per task from the last scored comparison (`poolOf`), the turns and
  measures of its valid answers (`referenceAnswers`), and which harness won each task and on which
  measure (`carriedBy`);
- the last comparison the reference stood in, with how often its own two solves differed in that A/A
  (`stoodLines`), and the checks a `check-defect` ruling faulted, by id (`faultedOf`);
- at each later ask, only what reported since it was last told (`heard` with `after`,
  `wakeMessage`);
- its walled home with the reference harness, carried between sessions.

A drafting session instead receives the prompt, the host's reading of each draft and an empty home.

### Tools

- **Examiner** (`src/examiner/write.ts`): `propose_tasks`, `read_example`, `read_opening`, the
  coding tools, `finish`, and two tries. `try_answer` runs the checks on its own answer, and a pass
  on a held task is logged as `task.feasible`. `try_reference` runs one or two billed solves on the
  reference harness under the campaign's setting; each names the session, so `countedSolves` keeps
  it out of every comparison, practice and Builder fold and `spendOf` bills it to the Examiner. It
  refuses once the session's tries (`exam.started.limits.tries`) or the reserve are spent, and no
  Referee rules its rejections. A drafting session has `draft_exam` instead of the gate
  (`src/examiner/shell.ts`).
- **Builder**: the coding tools, `practice`, `read_trace`, `read_opening`, `check_harness`,
  `preview_harness` and `finish`, plus section 4's campaign tools in the campaign command.
- **Solver**: section 3's five tools; the answer is `answer.json`, and `submit` with `malformed`
  flags the task instead.
- **Referee**: `probe_check`, `read_check_program`, `record_ruling`.

An older log may hold `diagnosis.*` events from a removed Diagnoser seat.
