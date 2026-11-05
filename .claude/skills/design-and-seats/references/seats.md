Read this before changing a seat's prompts, tools or view of campaign history. This expands
`AGENTS.md` section 3 up to "What waits for the operator".

## 3. The seats

Each seat has one job and a closed view. "Reads" is what the host hands it; "Never" is what the wall
keeps from it.

| Seat | Job | Reads | Never | Source |
| --- | --- | --- | --- | --- |
| **Examiner** (model) | Writes tasks against a fixed contract and check program; from a prompt, first drafts that exam (rules with sources, format, a check per rule, examples, control answers) | Below | Below | `src/examiner/` |
| **Builder** (model) | Edits `harness/`, chooses campaign tools, ends with a frozen harness version | Section 1's closed list, its notes, the other kept harnesses (`kept/`) | What section 1 keeps out | `src/builder/` |
| **Solver** (model) | Answers one task inside a harness: pi's coding agent plus what the harness adds | The task's public part, the rules, the harness, its limits and use | The checks and the hidden values | `src/solver/`, `src/harness/`, `src/tools/` |
| **Verifier** (code) | Runs every applicable check on one answer, each in a fresh walled cell | The answer, the task, the check program, the engines | n/a | `src/kernel/verify.ts`, `src/wall/` |
| **Referee** (model) | Rules each rejection `earned`, `check-defect` or `unclear` before it counts | The verifier's side only: task with hidden values, rules, answer, refusing checks, check program | The harness, the solver's trace, the Builder | `src/referee/referee.ts` |
| **Host** (code) | Everything in section 2's first column | The log | n/a | `src/kernel/`, `tools/` |
| **Operator** (person) | See below | Every report and refusal | n/a | n/a |

The **Examiner** reads the following view of the log (`src/examiner/record.ts`):

- The contract, operator brief, solve budget and examples.
- Per-task reference outcomes from the last scored comparison (`poolOf`), the turns of each of the
  reference's valid answers in it and, under an objective, what each measured (`referenceAnswers`),
  and whether a valid answer exists.
- Which harness won each task and on which measure (`carriedBy`), authorised on 20 October.
- The last comparison the reference stood in, from its side, with how often its own two solves
  differed in that comparison's A/A where it sat on the old side (`lastLine`).
- The checks a `check-defect` ruling found at fault on an answer to a task (`faultedOf`), by id.
- The promotion line.
- At each later ask of its conversation, only what reported since it last wrote: the last
  comparison's line, the tasks compared since under the reference's outcome, a promotion among them,
  and its limits from here (`heard` with `after`, `wakeMessage`).
- Its home, with the reference harness, and check results obtained through `try_answer`.
- Of each solve its `try_reference` asked of the reference harness: whether it was valid, its turns
  and measure, or whether the checks refused its answer, a limit ended it or it gave none, or that it
  could not run. That reply is the one place a try is told: a later session's record tells none.

A drafting session instead receives the prompt, the host's reading of each draft and an empty walled
home. The module's head comment lists the exact fields delivered.

What the **Examiner** never reads: a target, a harness's name, or the other harness's measures or
valid-solve counts. Of the reference's solves it hears counts, turns and measures only, and never an
answer, a trace or the check that refused one, its own tries included.

The tools of each model seat, as its source names them:

- Examiner: `propose_tasks`, which puts each draft to the gate and solves none (until 1 November
  `try_task` and `wait` had the reference solve a draft), then `read_example`, `try_answer`,
  `try_reference`, `read_opening`, `bash`, `read`, `write` and `finish` (`src/examiner/write.ts`).
  `try_reference` runs one or two fresh solves of an instance by the reference harness in force,
  through the comparison's launcher and solve queue under the campaign's setting, each start naming
  the session, so that `countedSolves` keeps them out of every comparison, practice and Builder fold
  and `spendOf` bills them to the Examiner. It refuses once the session's tries (`--proposals` by
  default, in `exam.started.limits.tries`) are spent or the budget holds no reserve for its solves.
  A solve that could not run uses no try. No Referee rules its rejections, since they decide
  nothing. A scripted Examiner is given no tries. An answer that
  passed `try_answer` is checked again under its task's id, and a pass on a held task is logged as
  `task.feasible` for the Referee. The walled home is carried between sessions with a fresh
  `reference-harness/`, and the gate is its only way into the exam. A drafting session has
  `draft_exam`, its only way in, `read_opening`, `bash`, `read`, `write` and `finish`
  (`src/examiner/shell.ts`).
- Builder: `read`, `bash`, `edit`, `write`, `practice`, `read_trace`, `read_opening`,
  `check_harness`, `preview_harness` and `finish`; in the campaign command also `examine`,
  `compare`, `campaign_status` and `wait`.
- Solver: `read`, `bash`, `edit`, `write` and `submit`. Its answer is the file `answer.json`;
  `submit` with `malformed` states the task is malformed, instead of an answer.
- Referee: `probe_check`, `read_check_program` and `record_ruling`.

An older log may hold `diagnosis.*` events from a removed Diagnoser seat.
