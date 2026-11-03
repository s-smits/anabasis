# A JobBench pilot of Harness² against Anabasis

Status: running on 3 November 2026, from 01:24 to about 09:00. This file is its protocol, fixed
before each arm's first solve; the result is added once the report is out. It is a pilot: one
stream an arm and single solves, so a difference is a lead, not a step (`AGENTS.md`, rules 1 and
6). Read it against "Read every result against how uneven the comparison is" in the README.

## The question

On eight JobBench statistics tasks, scored by JobBench's own judge, how do four systems built on one
solver compare in judged score, dollars and hours: Claude Code with an empty guide, Harness² adapting
on each scored task, Harness²'s harness frozen and moved to a task it never saw, and the harness an
Anabasis campaign built without seeing any of the eight?

## Fixed for every arm

- **Tasks:** the 8 JobBench tasks of three professions: biostatisticians (2), statisticians (3) and
  social science research assistants (3), at the revision Harness²'s download records.
- **Domain text:** one shared text of 389 words, 79% of it Harness²'s own domain text and the rest
  tuned so that an Anabasis Examiner can draft from it. Harness² reads it as its JobBench domain
  text; the Anabasis campaign reads it as the operator's prompt.
- **Scoring:** the Harness² fork's Claude Code runner (`jb_claude_runner.py`) with the benchmark's
  task prompt unchanged: `claude -p` on Opus 5.5 at effort high, every Claude Code tool (shell and
  web search included), a $5 cap a rollout, a 3600 s timeout, no turn cap, and a second attempt when
  a rollout leaves no deliverable.
- **Judge:** JobBench's `eval/judge.py` on Opus 5.5 at effort medium.
- **Models:** Opus 5.5 in every seat of both systems: the solver of every arm, Harness²'s improver,
  and the Anabasis Builder and Examiner (high), Referee (medium) and solver (high).

## The four arms

| Arm | Build | What is scored |
| --- | --- | --- |
| Base | none | the stock Claude Code surface with an empty `CLAUDE.md`: Harness²'s own first rollout of each task |
| Harness² k=1 | adapts on each scored task: 4 rollouts and 3 improver sessions a task, a library a profession | its delivered output on each task |
| Harness² held-out | none beyond the k=1 sweep | task N of a profession (N = 2, 3) solved once by the final harness the sweep built on task N-1, frozen. Tasks of a profession run in order and a library holds only earlier tasks, so that harness never saw task N. Task 1 has no such harness, so the arm scores 5 tasks, and every arm is also read on those 5 |
| Anabasis | one fresh campaign from the shared text, at the stack's top, which never sees the 8 tasks; stopped at 06:30 if it has not ended | its reference harness at the stop, written out by `studies/shared/claude-export.ts` and solved once a task |

Two totals are read: all 8 tasks, and the 5 held-out tasks with every arm on the same 5, which is
the fair one. The k=1 arm adapts on the task it is scored on, and the held-out arm and Anabasis do
not.

## Dollars and time

- **Rollouts and improver sessions:** Claude Code's `total_cost_usd` in each stream's `result`
  event, which the runner prints on each attempt line and Harness²'s proposer writes into each
  task's summary. A session killed before its `result` event reports none; such sessions are
  counted apart and priced from their messages' token counts at list price, marked as estimates.
- **The Anabasis build:** the campaign log's bill at list price (`tools/d2/close.ts`).
- **The judge:** each call's `total_cost_usd`.
- **Time:** wall clock from an arm's first event to its last, an arm and a task.

Every arm's dollars are split into build, solve and judge.

## Predictions, before each arm's first solve

- **P1.** The Anabasis campaign reports at least one comparison by 06:30: `comparison.reported` at
  least 1.
- **P2.** It promotes no harness by 06:30, so its scored harness is the starter:
  `harness.promoted` 0.
- **P3.** Harness² k=1 costs more than 5 times the Base arm's solve dollars over the 8 tasks.
- **P4.** Fewer than 10% of all rollouts end without a deliverable for an infrastructure reason.
- **P5**, written before the held-out arm's first solve: on the 5 held-out tasks, Harness²
  held-out scores below Harness² k=1 in summed judged score.

## Limits known before the result

- **Runtime gap.** An Anabasis seat runs Claude Code through the Agent SDK with its own system
  prompt and pi's tools; every arm is scored by `claude -p` with Claude Code's own prompt and tools
  and the harness as `CLAUDE.md`. Scoring is the same for every arm, so the gap bears only on how an
  Anabasis harness built on one surface carries to the other. The export's note says what of a
  campaign's solve is not there (`claude-export.ts`).
- **The campaign's limits.** Anabasis builds at 20 model turns and 30 minutes a solve and is scored
  under the runner's limits.
- **Size.** 8 tasks, one stream an arm, no A/A, one judge call a task.
