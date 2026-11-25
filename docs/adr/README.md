# Architecture Decision Records

Non-obvious architectural, statistical, security, and evaluation-integrity decisions moved out of inline code comments (`ana/no-comments`). Each record states the decision, its rationale, and its owning source modules.

| ADR | Title | Primary owners |
| --- | --- | --- |
| [0001](0001-evaluation-wall-and-information-channels.md) | Evaluation wall and cross-wall information channels | `src/builder/`, `src/examiner/`, `src/harness/`, `src/kernel/reports.ts` |
| [0002](0002-os-command-wall-and-isolation.md) | OS command wall, Seatbelt/Bubblewrap isolation, and seat roots | `src/wall/`, `src/tools/command.ts`, `src/tools/env.ts`, `src/meta/holder.ts` |
| [0003](0003-verifier-isolation-and-checker-acceptance.md) | Offline verifier cells, checker acceptance, and archive reading | `src/kernel/verify.ts`, `src/kernel/check-child.ts`, `src/kernel/acceptance.ts`, `src/meta/zip.ts` |
| [0004](0004-paired-comparison-statistics-and-sampling.md) | Paired comparison scoring, Wilcoxon sign-flip test, and task sampling | `src/kernel/compare.ts`, `src/campaign/round.ts`, `src/campaign/climb.ts` |
| [0005](0005-campaign-decision-table-and-log-model.md) | Append-only campaign log, decision table, and pause boundaries | `src/kernel/log.ts`, `src/campaign/decide.ts`, `src/campaign/word.ts`, `src/kernel/trace.ts` |
| [0006](0006-agent-backends-compaction-and-billing.md) | Agent backends, context compaction, deadlines, and billing | `src/agent/`, `src/solver/run.ts`, `src/kernel/solve.ts`, `src/kernel/meter.ts` |
| [0007](0007-harness-storage-digests-and-memory.md) | Content-addressed harness storage, tree stamps, and Builder memory | `src/harness/open.ts`, `src/builder/kept.ts`, `src/builder/memory.ts` |
| [0008](0008-referee-adjudication-and-meta-primitives.md) | Referee agreement bars, answer submission, and runtime primitives | `src/audit/`, `src/tools/answer.ts`, `src/meta/` |
