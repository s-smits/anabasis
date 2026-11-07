# 10. Runs with a real model

Read this before planning or starting a paid run, or changing its isolation (`AGENTS.md` section
10). Tuning a seat's prompt or terms is `system-path-simulation`'s case `optimize`, and `/goal`
(`.claude/commands/goal.md`) carries one objective across a session until every result has current
evidence or the next action needs new authority.

## What holds in all of them

Reasons and edges of section 10's nine conditions:

- **1.** A checkout that moves under a run would put it on two commits, hence `treeFault`.
- **3.** A prediction written after the result is a description instead of a test.
- **4.** A deadline counts elapsed time, so load from other rounds shifts the outcome.
- **5.** Also name no account or credential path in anything published.
- **7.** Resolve the prediction as held or falsified by its count.
- **9.** A measured run starts from the starter, from a prompt (`--prompt-file`), and reaches a
  typed ending at its opening commit without help; a seed, fork, stored pack or continuation at
  another commit starts with an exam, a promotion or code it did not earn. A paused run continues at
  its own commit, and a fix is measured by a fresh run.

## The wall, seat roots and the network

Every seat's commands run inside the wall in the system's `/bin/bash`, so pi's `bash` tool runs Bash
and nothing ships a shell (`stageCommandIsolation`, `src/wall/isolation.ts`; the worker in
`src/tools/env.ts`). Each seat gets a root on the host's disk with no cap, removed when the seat
ends (`src/wall/seat-root.ts`).

Each seat's wall is tested once per process before first use by one command launched as a seat's
commands are (`runWalled`): a canary in the repository and the `package.json` of its first other
worktree must be refused, and a file written in the seat's folder must read back. A failure refuses
the start (`walledBase`, `probeWall`, `src/tools/command.ts`). The verifier's cells share that base
without the seat's shell and are tested by the suite (`test/verify.test.ts`); only they run without
the network (`network`, `src/wall/base.ts`).
