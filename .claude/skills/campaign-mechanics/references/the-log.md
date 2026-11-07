Read this before adding events or readers, or moving a campaign. It expands `AGENTS.md` section 5.

## 5. The log

The folds that read the log are: a task's state (`held`, `released`, `refused`, `disputed`; an older
`ladder` reads as `held`) in `src/kernel/task.ts`; a comparison's pairs in `src/kernel/compare.ts`;
the stop rule, tasks awaiting a label and the dollars billed in `src/kernel/reports.ts`; and every
seat's trace (`solve.turn`, `solve.call` and each session's turns) in `src/kernel/trace.ts` alone.

A **condition** (`src/kernel/condition.ts`) is one content-addressed record of the contract,
harness, task version, model and effort, price table, runtime packages and Bun, compaction mode,
tool trees, and the sandbox by isolation profile and platform (`tools/d2/campaign.ts`). It leaves
out programs on the host's path, such as `python3`, because naming them would set every earlier
solve aside when a run moves host; whether to include them is the operator's call. Each launch's
receipt keeps what it found instead (`hostPython`, `tools/runs/receipt.ts`, printed by
`bun run runs source`).

Section 5's habits share one reason: a second store or a hand-written line is a second history. Old
event kinds stay readable because the log is evidence, the one exception to the ban on compatibility
paths (`tools/oxlint/HABITS.md`, 12.3).

Every seat's wall denies the repository and its worktrees (`worktreesOf`, `tools/d2/campaign.ts`).
`runs retire` moves a campaign idle for a day into `data/runs/` in the main worktree and deletes
seeds; the archive is ignored and walled too.
