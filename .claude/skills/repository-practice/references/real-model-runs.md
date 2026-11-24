# 10. Runs with a real model

Read this reference before planning or launching a paid run, or before modifying seat isolation
(`AGENTS.md` section 10). Tuning a seat's prompt or move terms follows `system-path-simulation`
(case `optimize`), and `/goal` (`.claude/commands/goal.md`) tracks a single objective across a
session until every requirement has current evidence or the next action requires additional
authority.

## What holds in all of them

Rationale and edge cases for the nine conditions in `AGENTS.md` section 10:

- **1.** A checkout that changes underneath a live run mixes two commits in one campaign, which
  `treeFault` prevents.
- **3.** A prediction recorded after inspecting outcomes is a post-hoc description rather than a
  testable hypothesis.
- **4.** Because solve deadlines measure wall-clock elapsed time, concurrent load from other rounds
  alters timeout behaviour.
- **5.** Never include account identifiers or credential file paths in any published text.
- **7.** Resolve each pre-registered prediction explicitly as `confirmed`, `refuted`, or `not-observed` using its deciding
  count.
- **9.** A measured run begins from the starter harness and a domain prompt (`--prompt-file`) and
  runs to a typed ending at its opening commit without manual intervention. Starting from a seed,
  fork, stored pack, or later commit inherits an exam, promotion, or code change that the run did
  not earn. A paused run resumes at its original commit, and any code fix is evaluated on fresh
  runs.

## The wall, seat roots, and the network

All seat commands execute inside the OS sandbox under the system's `/bin/bash`, so pi's `bash` tool
invokes system Bash without shipping a custom shell (`stageCommandIsolation`,
`src/wall/isolation.ts`; worker environment in `src/tools/env.ts`). Each seat receives an uncapped
root directory on local disk, deleted when the seat terminates (`src/wall/seat-root.ts`).

Each seat's sandbox is verified once per process before first use via a probe command executed under
the same isolation wrapper as seat commands (`runWalled`): reading a canary file in the repository
and `package.json` in the first sibling worktree must fail, while writing and reading back a file in
the seat's own directory must succeed. Any probe failure aborts launch (`walledBase`, `probeWall`,
`src/tools/command.ts`). Verifier cells share the same isolation base without the seat shell and are
covered by `test/verify.test.ts`; only verifier cells run with network access disabled (`network`,
`src/wall/base.ts`).
