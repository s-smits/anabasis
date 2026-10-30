Read this before adding an event, a store or a reader over a campaign's log, before moving or archiving a campaign, and when asking what a condition names. It holds `AGENTS.md` section 5 in full.

## 5. The log

A campaign's record is one append-only JSONL file, `.ana/d2/<name>/log.jsonl`, one event a line
(`src/kernel/log.ts`). Every state and every report is a view over it; nothing else is stored as
truth.

- An append is synced before it returns; a read refuses a torn or unknown line.
- A task's state (`held`, `released`, `refused`, `disputed`; an older `ladder` reads as `held`) is a
  fold over the log (`src/kernel/task.ts`), as are a comparison's pairs (`src/kernel/compare.ts`),
  the stop rule, the tasks awaiting a label (`src/kernel/reports.ts`) and the dollars billed.
- A **condition** is everything that could change a solve's result, as one content-addressed record
  (`src/kernel/condition.ts`): contract, harness, task version, model and effort, price table, the
  runtime's packages and Bun, compaction mode, tool trees, and the sandbox by isolation profile and
  platform (`tools/d2/campaign.ts`). Two solves are comparable only when their conditions differ in
  the one thing compared.
- Every seat's trace is in the log (`solve.turn`, `solve.call`, and each session's turns and calls),
  read only by `src/kernel/trace.ts`.

Four habits follow:

1. **Add no second store.** A fact a command needs later is an event it reads back; a file beside
   the log that holds state is a second history.
2. **Add no second reader of one fact.** Find the fold that already reads it and call that.
3. **Never edit a log, and never write an event by hand.** A hand-written line records a history
   that did not happen. Move or copy a campaign only with `bun run runs copy`, `move` and `retire`,
   which carry its folder whole.
4. **Keep old event kinds readable.** The source keeps no compatibility paths
   (`tools/oxlint/HABITS.md`, 12.3); the log is the exception, being evidence, so `EVENT_KINDS`
   still lists kinds no command writes.

`.ana/` is ignored by Git, and every seat's wall denies the repository and its worktrees
(`worktreesOf`, `tools/d2/campaign.ts`). After a day idle, `bun run runs retire` moves a campaign
whole into the archive, `data/runs/` of the main worktree, also ignored and walled (a seed it
deletes), and nothing else deletes a log or trace there. The log holds hidden values and verdicts, so it stays on the exam side: keep it out of
prompts, pull requests and pastes.
