## How to read this bundle

A run is its log. `log.jsonl` holds one event a line, `{at, kind, data}`, appended in order, and it
is the whole record: every gate, session, turn, tool call, verdict and reading. A run with no ending
in its log was still running when it was zipped, or is of a kind that reports none, and its last line
may be cut. `NOTES.md`, when the bundle has one, is the sender's own reading: check it against the
log before repeating it.

**Choose a level by the question.** Light answers what a run did and how it was read, and is the one
to hand a reviewing model under a size cap. Medium adds the checker and what a harness installed,
for why one answer was refused. Verbose adds the source each worktree ran at its commit, for what a
model was told: the prompts are rendered by `src/builder/prompt.ts` and `src/solve/prompt.ts` and are
not in the log.

**Read in this order.**

1. `MANIFEST.json`, `runs`: each run's worktree, commit and ending. Two runs at different commits
   differ by that source before they differ by anything a model did.
2. `task.proposed`, `task.gate`, `task.state`, `task.feasible`: which task versions entered the exam
   and have a valid answer on record. A later author proof (`task.feasible`) keeps only the version
   and session, never the answer. The remaining gates below describe older runs. Gate 1 is the
   package's shape, gate 2 a pass by the stronger condition (a fail there is `too-hard`), gate 3 the
   check rerun on that pass, gate 4 the three reject controls. Gate 5 is screening, logged as the
   state it gives: `admitted` tasks are the scored set. `anchor.drawn` names the anchor's tasks and
   `released` ones are the Builder's practice; neither is ever scored.
3. `build.started` to `build.finished`: one Builder session from the harness `parent`. Its
   `build.turn`s are what it said, its `build.call`s every tool call with arguments and result, and
   `build.finished` says how it ended (`finished`, or a limit such as `wall`), whether the harness
   changed and whether the one it left is `broken`.
4. `solve.started` to `solve.finished`: one solve. Its harness is
   `condition.recorded.condition.harness` for the solve's `condition`: the session's `parent` is the
   old harness, `build.finished.harness` the new. The `ending` is a `pass`, a `fail` with its kind,
   or a `non-result` with its kind and reason. `verdict` holds the answer and the checks that blocked
   it.
5. `anchor.scored` and `comparison.reported`: the two tests and the round's reading.
6. `states/<digest>/agent/`: the harness a session kept, as the solver had it. The guide is
   `BUILT_AGENTS.md`, the tools are `tools.ts` and their kinds are in `tools-spec.json`.
7. `memory/<session>/`: the notes a Builder session left the next, `MEMORY.md` and
   `SCRATCHPAD.md`, and its helper files under `scratch/`. They are the Builder's own words and no
   part of a harness.

**What a bundle cannot answer.** What the harness a session started from held, unless an earlier
session of the same run kept it: the Builder's changes are its `build.call`s. How a check decides,
below medium: a `verdict` names the checks that blocked an answer and no more. What a model was
prompted with, below verbose.

**Do not conclude from a bundle**

- that a harness is no better because a round read `no-step`. A step rests on the scored set's test,
  and the anchor only guards it. A report whose `scored` wins, losses and ties are all 0 had no
  scored task, and could not have stepped. Its `target` is how many it asked for: 0 is a round that
  was never going to score one, and a report without the field is from source that did not record
  it. A `launch-<session>.json` beside the log holds the flags a round was started with.
- that a solver is weak because every solve under one harness ended `fail` with `no-answer`. In a
  run before 2026-10-09, read that harness's `tools-spec.json` first: submit then took only an answer
  an `artifact-writer` had prepared. Since then the answer is the file `answer.json`.
- anything from a `non-result`. It is no measurement: count passes, fails and non-results apart, and
  rates over passes and fails alone.
- that two solves are alike in time. `solve.started.load` is the host's load when the solve began,
  and `cores`, from 9 October, the cores it is a load on. A wall reached under a heavy load is not
  the wall reached on an idle host.

`checks/` at medium is the checker's own source and reference, and it stays out of any prompt
written for a Builder or a solver. A `correctness-model/` inside a harness is a copy of it that the
run's Builder could read: two runs that differ in having one differ in what their Builders knew.
