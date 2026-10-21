# Studies

This folder holds measurements of Anabasis taken outside a campaign's own reading: against another
system on a published benchmark, or against a variant of itself with one mechanism switched off.
Each one lives in a folder of its own, named after what it compares, and starts with a protocol
written before the first solve.

A campaign decides through its comparison (`AGENTS.md`, rule 1). A study never promotes a
harness, sets a reading or moves a campaign. It answers a different question, such as "does a harness
built without the benchmark score on it", and its result is a claim of its own, worded as section 9
of `AGENTS.md` says.

## What a folder holds

- `README.md`: the protocol. It states the question, the arms, what each arm may see, the
  conditions held equal, the metric, the statistics, and the hazards, before anything is run.
- Predictions, written so that a recorded count settles each one, committed before the first solve
  they are about (`AGENTS.md`, section 10, item 3).
- The prompts a campaign opens from, where an arm opens one.
- Any adapter code, under the same lint, format and size rules as the rest of the tree. Code that
  belongs to the host goes in `src/` or `tools/`, and the study names it.
- Where it compares against another system: one entry point, `run.ts`, whose `setup` clones that
  system into `external/<system>/` at a pinned commit and lays the study's additions over it, and
  every change the study makes to it, as a `git diff` beside the entry point that `setup` applies.
  Where the other system has a reader of its own results, the study runs it in that system's own
  environment instead of porting it.
- Result summaries: counts, conditions and the commit and host they were read at.

Two folders beside the studies serve all of them. `shared/` holds the code more than one study
uses. `runs/<study>/` holds the record of every run a study made, one folder each, tracked, so
that a result can be read again by anyone: the job's terms, each solve's score and trajectory,
its bill, and the commit and runner it ran at. A run that failed or was cut short is kept with
the rest (`AGENTS.md`, section 10, item 8).

## The local clone

The other system's code, the benchmarks it downloads and the benchmark's raw job folders, which
copy each task with its tests, live in `studies/external/`, one folder that `.gitignore` keeps out
of the repository for every study: a clone in `external/<system>/`. A new study adds nothing to
`.gitignore`. Inside the checkout they sit behind every seat's wall, which denies the repository and its worktrees, so no
Builder, Examiner or solver of a blind arm can read a benchmark's hidden tests or rubrics there. A
clone elsewhere on disk would be open to them.

The clone belongs to one worktree. Removing the worktree, `git clean -fdx`, or the retirement of
an idle worktree deletes it with the raw job folders it holds, so a run's record is copied into
`runs/` when the run ends. `run.ts setup` rebuilds the clone.

## What a folder never holds

- A campaign's log, its traces or a kept harness. They stay under `.ana/` and `data/runs/`, which
  hold hidden values and are behind every seat's wall.
- The other system's code, or a benchmark's tasks, rubrics or hidden tests. Benchmarks come under
  their own licences, and all of them stay in the ignored clone. A trajectory quotes the task's
  instruction, so a benchmark's licence decides whether its trajectories may be published, and
  a study's protocol names that decision before the first is committed.
- Credentials, provider accounts, host names or paths on the operator's machines.

The level of each study (planned, present in source, and on up the ladder) is kept in
`docs/plan.md`, like every other row, and not here.
