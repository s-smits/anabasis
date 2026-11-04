# Scoring a promoted jobstat harness on JobBench against Harness²

Status: the scoring path is present in source (`studies/harness2/score.ts`, #592) and exercised
on 4 November 2026 for Harness²'s held-out harness and the Starter. No jobstat campaign has
promoted a harness yet, so the arm this study exists for, a promoted harness, has not been scored.

## The question

Does a harness that Anabasis built on its own jobstat exam score higher on JobBench than the
harness Harness² built on a neighbouring JobBench task, for one solver, under one judge?

Every arm is one frozen harness. The solver is the same for every arm (Opus 5.5 at high, $5 and
3600 s an attempt, a second attempt only when none is delivered), and so are the task's prompt and
input files and the rollout's environment. JobBench's own `eval/judge.py` scores each deliverable
against the task's `RUBRICS.json`, on Opus 5.5 at medium, with the same flags for every arm. The
score is the rubric points awarded out of the task's maximum. Only the harness differs.

The arms:

- **builtSolver(Opus 5.5)**: the campaign's promoted reference, written out by `claude-export.ts`
  (`--arm <campaign>`). This is the arm the study exists for.
- **Harness² held-out** (`--arm heldout`): task N under the harness Harness²'s sweep built on task
  N-1 of the same profession. Neither harness was built on the task it is scored on, so these are
  the fair tasks, those that are not a profession's first.
- **bareSolver(Opus 5.5)** (`--arm starter`): the Starter Built Harness, the floor both are read
  against.

One input still differs, and every reading says so: Harness² built its harness from this judge's
scores on a neighbouring task, while Anabasis built its harness from its own checks and never saw
JobBench (`studies/harness2/README.md`, "Read every result against how uneven the comparison is").

## Intended changes

1. **Score the first jobstat campaign that reaches two promotions.** Score its reference on the
   fair tasks the Harness² and Starter arms already hold, then print `score.ts table`. A session
   job checks every half hour and hands the scoring to one subagent when a campaign gets there.
2. **Correct the pilot's label.** In the pilot of 3 November the arm named "anabasis" was the
   Starter (digest `6af25e7a`, exported from a campaign that had promoted nothing), so its 298 of
   550 is a bareSolver score, not a built one. The pilot's `final.json` and any text that cites it
   should say so.
3. **Two rollouts an arm and task before any claim.** One rollout a task is weak evidence (rule 6).
   The pilot's per-task scores move by up to 24 rubric points between arms on one task. A reading
   that names a winner needs at least two rollouts a side, read as a paired test over tasks.
4. **One judge at a time across arms.** `score.ts` judges one task at a time within an arm and
   attributes dollars by the shim log's window. Two arms judged at once share windows, so each
   arm's judge dollars count the other's too. Run arms one after another, or judge several arms in
   one process.
5. **Carry a harness's own tools across the export.** `claude-export.ts` drops `agent/tools.ts` and
   `agent/tools-spec.json`, since Claude Code has no pi tools. A built harness whose gain sits in
   its own tools loses that gain on JobBench. Either port the tools (an MCP server or a script in
   `scripts/toolchain`) or score on pi, and say in each reading which one ran.
6. **Name the login a bench pays from.** The study's wrappers take a fixed login from the
   environment. A bench is a paid simulation and should take `--login` and appear in
   `runs active` as a seat does.

7. **Read a size that can show something.** Five fair tasks with one rollout each cannot clear
   0.02 even at five wins to none (a sign-flip p of 1/32). Add rollouts, a Starter A/A beside the
   comparison, and per-task paired differences beside the summed points, since a summed total
   weighs each task by its maximum.
8. **A rollout ended by a limit is a non-result** (plausible, from the code). `rolloutLog` counts an
   attempt as run once it emits a `result`, so a rollout cut by a session limit would be judged on
   an empty output and score 0. Read `is_error` and the stop reason, and retry such a rollout
   (rule 7).
9. **Name each arm's tree in its record.** A held-out record stores `heldout` rather than the
   harness of the task before, so the record alone does not say which tree solved it.
10. **Close the store to the solver, or widen the check.** The workspace has no wall, the store
    holds other arms' deliverables for the same task, and the trajectory check looks only for
    `RUBRICS.json`, `eval_result` and `judged`. Add the store root, `model_output` and the JobBench
    checkout to it, and give the workspace a neutral label rather than the arm's name.
11. **Price every build on one meter.** Harness²'s build is read from Claude Code's
    `total_cost_usd` and a campaign's from `billedAll` at list price.

## How it came to be

- **3 November 2026.** The pilot set Anabasis against Harness² on eight JobBench statistics tasks.
  On the fair five, scores out of 296 were: Starter 202 (the pilot's "Base", Harness²'s own base
  harness), Harness² k=1 194, Harness² held-out 146, and the arm labelled Anabasis 168. The judge
  cost about $422 over 243 calls.
- **4 November, about 05:00 UTC.** The operator asked to "run 10% of the jobstat comparison to
  optimize and prepare the system - use latest jobstat harness present", with the existing copy
  mechanism for the harness. The first plan scored the newest kept jobstat harness, a Builder's
  unpromoted candidate, beside Harness²'s held-out harness and Base. The operator: "why 'scores it
  against Base.' ? we want to compare it against harness2 - ensure inputs and outputs are the same
  right? What are we measuring exactly? use the same judge to set up the scores for the harness".
  Base left the plan.
- The operator, on the unpromoted candidate: "okay so we first have to wait for a promotion, test
  for now on the bareSolver yeah". The candidate's arm was stopped mid-rollout and the Starter took
  its place. The operator then asked for a job "when jobstat has reached 2 promotions to launch
  subagent to handle everything regarding this", and: "we can run harness2 already right now". The
  Harness² held-out and Starter arms run on statisticians/task2, then on the other four fair tasks.
- The operator then asked for an independent reviewer "to see if the comparison is fair and
  inputs/outputs make sense". It found the solve, the tools and the judge's flags equal for both
  arms, and items 7 to 11 above. It also found that the remaining tasks ran all of one arm before
  the other, so a later login limit or a busier host would fall on one arm only; the remaining tasks
  were rerun as pairs, both arms side by side one task at a time. Its reading of what the score
  measures: the transfer gain of a harness Harness² built on a sibling task, over
  bareSolver(Opus 5.5), and not yet Harness² against a harness Anabasis built.
