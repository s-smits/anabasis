# 10. Runs with a real model

Read this before planning or starting a paid model run, or changing its isolation. This expands the
nine run conditions and OS wall in `AGENTS.md` section 10.

A run with a real model spends the operator's money and needs the operator's word; a launch request
authorises the runs it names and no others. The skills own the procedure, by the table in
`AGENTS.md` section 10; tuning a seat's prompt or terms is `system-path-simulation` 's case
`optimize`.

`/goal` (`.claude/commands/goal.md`) carries one operator objective across a session's turns until
every result has current evidence or the next action needs new authority.

## What holds in all of them

1. **The worktree is the condition.** A run executes its worktree's source, so each starts from a
   clean worktree of its own at a published commit (`runs fresh`, or `git worktree add --detach`),
   never a checkout moved under it: a paid seat refuses a main worktree or one holding
   `ana-followed` (`treeFault`). Do not edit `src/` there while the run lives.
2. **Prove the path first, without a model**: a dry run, a replay or a rehearsal on a seed
   (`run-improvement-campaign`, "Prove the path before spending").
3. **Put one prediction on record before the first solve**, settled by a recorded count (`--predict`,
   or for a campaign the starting session's ledger). One written after is a description.
4. **One or two rounds at a time on one host**: a deadline counts elapsed time.
5. **Never open, print or copy the file passed as `--env-file`**, and name no account or credential
   path in anything published.
6. **Do not stop a run to fix it**: what a live run shows is work for the next start.
7. **Read the log's events and the report before any agent's prose**, and resolve the prediction as
   held or falsified by its count.
8. **Report every attempt that started as spent**, the unsuccessful ones included.
9. **A measured run opens a fresh project and climbs on its own.** A run whose promotions are read
   opens a new project from a prompt (`--prompt-file`), starts from the starter, and runs at its
   opening commit to a typed ending with no help. A seed, a fork, a stored pack or a continuation at
   another commit starts with an exam, a promotion or code it did not earn, and its promotions do
   not count towards this measurement. A run continues at its own commit after a pause, a restart or
   a change of login; a
   fix is measured by a new fresh run, never by continuing one at the fixed code.

## The wall, seat roots and the network

A solve and a Builder session run on either operating system, behind Seatbelt on macOS and
Bubblewrap on Linux. Every seat's commands run inside that wall in the system's `/bin/bash` (3.2.57
on macOS, 5.1 on Linux), so pi's tool named bash runs Bash, and nothing ships or installs a shell
(`stageCommandIsolation`, `src/wall/isolation.ts`; the worker in `src/tools/env.ts`). Seats have
no disk cap. Each gets a root on the host's disk, which is removed when the seat ends using the
filesystem operations still available (`src/wall/seat-root.ts`). An unavailable wall is a typed
non-result, never an unconfined run.

Each seat's wall is tested once per process before its first use, by one command launched the way a
seat's commands are (`runWalled`). The wall test checks that a canary in the repository and the
`package.json` of its first other worktree are refused, and that a file written in the seat's own
folder reads back; a failed wall test refuses the start and prints its lines (`walledBase`,
`probeWall`, `src/tools/command.ts`). The verifier's cells share that base, are launched without
the seat's shell, and have no start-up wall test of their own; the suite tests them
(`test/verify.test.ts`). Every seat reaches the network, both harnesses alike; only the verifier's
cells run without it (`network`, `src/wall/base.ts`).
