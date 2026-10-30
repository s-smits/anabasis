Read this before you change what a seat reads, is told or may call: a prompt, a tool, a seat's view
or what the Examiner is told of the log. It holds `AGENTS.md` section 3 up to "What waits for the
operator".

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

What the **Examiner** reads is a view of the log (`src/examiner/record.ts`, whose head comment
lists each line): the contract, the brief, the budget every solve is held to and examples; a line a
task with the reference's outcome and valid answers' turns in its last scored comparisons
(`histories`, `poolOf`), whether a valid answer is on record, how far one of the reference's or
its author's betters the reference's, and which harness won it on which measure (`carriedBy`), by
the operator's word of 20 October; a summary of the reference (`measuredLine`, `heldOn`); the
current reference's admission results, objective gaps (`reference.gap` of `task.gate`), refusals
and interrupted drafts; the last session's `finish` and home, with the reference harness; and the
checks, through `try_answer`. A drafting session reads the prompt, the host's reading of each
draft, and an empty walled home.

What the **Examiner** never reads: a target, a harness's name, or the other harness's measures or
valid-solve counts. Of the reference's solves it hears counts, turns and measures only, and it
solves nothing itself.

The tools of each model seat, as its source names them:

- Examiner: `propose_tasks` (no solve), or `try_task` and `wait` where the host can have the
  reference solve a draft; then `read_example`, `try_answer`, `read_opening`, `bash`, `read`,
  `write` and `finish`. Task admission runs in the background, and only awaiting it pauses the
  four-hour clock (`settled`, `src/examiner/write.ts`; `src/examiner/session.ts`). An answer that
  passed `try_answer` is checked again under its task's id, and a pass on a held task is logged as
  `task.feasible` for the Referee. The walled home is carried between sessions with a fresh
  `reference-harness/`, and task admission is its only way into the exam. A drafting session has
  `draft_exam`, its only way in, `read_opening`, `bash`, `read`, `write` and `finish` (`src/examiner/shell.ts`).
- Builder: `read`, `bash`, `edit`, `write`, `practice`, `read_trace`, `read_opening`,
  `check_harness`, `preview_harness` and `finish`; in the campaign command also `examine`,
  `release_practice`, `compare`, `promote`, `campaign_status` and `wait`.
- Solver: `read`, `bash`, `edit`, `write` and `submit`. Its answer is the file `answer.json`;
  `submit` with `malformed` states the task is malformed, instead of an answer.
- Referee: `probe_check`, `read_check_program` and `record_ruling`.

An older log may hold `diagnosis.*` events from a removed Diagnoser seat.

