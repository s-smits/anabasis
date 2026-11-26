Read this reference before adding log events or readers, or before moving a campaign. It expands
`AGENTS.md` section 5.

## 5. The log

Four authoritative folds read campaign state from the log: task status (`held`, `released`,
`refused`, `disputed`, with legacy `ladder` read as `held`) in `src/kernel/task.ts`; paired
comparison outcomes in `src/kernel/compare.ts`; the stop rule, tasks awaiting human labels, and
cumulative spend in `src/kernel/reports.ts`; and per-seat execution traces (`solve.turn`,
`solve.call`, and session turns) exclusively in `src/kernel/trace.ts`.

A **condition** (`src/kernel/condition.ts`) is a content-addressed record capturing the contract,
harness, task version, model and effort, price table, runtime packages and Bun version, compaction
mode, tool trees, and sandbox isolation profile and platform (`tools/campaign/campaign.ts`). It omits
ambient executables on the host `PATH` (such as `python3`) because hashing them would invalidate all
prior solves whenever a campaign migrates between hosts; whether to include them remains an operator
decision. Instead, each launch receipt records the detected environment (`hostPython`,
`tools/runs/receipt.ts`), which `bun run runs source` displays.

The rules in `AGENTS.md` section 5 enforce a single principle: any secondary store or hand-edited
line creates a competing history. Historical event kinds remain readable because the log is an
archival experimental record, making log decoding the one intentional exception to the repository's
ban on backwards-compatibility paths (`tools/oxlint/HABITS.md`, 12.3).

Every seat's sandbox blocks access to the repository and all of its worktrees (`worktreesOf`,
`tools/campaign/campaign.ts`). `runs retire` moves any campaign idle for 24 hours into `data/runs/` in the
main worktree and deletes seed directories; the archive directory is git-ignored and likewise
blocked by the sandbox.
