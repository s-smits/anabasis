Expands `AGENTS.md` §6 (recorded terms, practice release, refusals, defaults). Commands live in `campaign-command.md`.

## Recorded conditions

- **Opening (`campaign.opened`)**: stores project (`--project`, dashboard-only, or derived via `projectOf`), total budget, reserve, `--patience`, seat models, `--hitl` (`attended`), domain prompt, solver, and latest move terms (`TERMS` in `src/campaign/opening.ts`: `level`, `minutes`, `turns`, `practice`, `promotions`). Subsequent calls inherit unless overridden; once a comparison starts, `--level` locks (rule 4); once an exam drafts, `--prompt` locks.
- **Setting (`campaign.setting`, `tools/d2/setting.ts`)**: locks experimental conditions once (`startSetting`, `settingOf`) for solver model/effort/window/limits (`--solver`, `--solver-effort`, `--solver-window`, `--solve-minutes`, `--solve-model-turns`), `--target` and `--solves`. Conflicting flags are refused. Legacy logs bind to their last test-side solves (`firstRecord`, `campaignFor`). Default `--solver-window` is 300k tokens (`SETTING_OPTIONS`), refusing 200k-context models.

## Practice release

Triggered after comparisons/promotions (`practiceDue`, `src/campaign/scheduler.ts`) and executed by host (`releasePendingPractice`, `tools/d2/campaign-actions.ts`) on task admission, Examiner finish, Builder opening with fresh admissions, and non-promoting readings (releasing 1 task if none were newly admitted). Never releases while a comparison is unreported; excludes tasks doubted by a reference rejection (`practicePool`, `poolOf`). Priority order (`releaseOrder`, `src/kernel/reports.ts`):
1. Tasks the reference failed across two comparisons;
2. Half (rounded down, counting already released) of tasks leaving headroom on the reference's last reading;
3. Remaining tasks in deterministic hash order (passing tasks still expose the objective).

Inspects reference solves only, so candidate wins never influence practice selection (rule 3). Pre-release comparison solves stay exam-side; Builder sees only its own practice solves (`practiceRan`, `src/kernel/solves.ts`).

## Move refusals

`admission` (`src/campaign/admission.ts`) runs before a comparison logs its first event and refuses on: no held-out tasks; fewer than `comparisonFloor` frontier tasks (`held-short`: step floor + 2 buffer); missing `--cap`; unvalidated checker; cap below estimated test cost from historical bills (`cap-short`, ending on `budget` if no comparison is open); or stopped campaign without `--past-stop` (`stop.overridden`). `admitSession` requires cap, validated checker, passing stop rule, and non-spent `--session` (`spent`, `src/builder/session.ts`). Already-started moves resume without re-checking; rehearsals are exempt. Check order: admission → terms → stop override → setting.

## Defaults & Examiner finish

- `--target`/`--solves`: `SIZE` (`src/kernel/size.ts`); `GAP_FLOOR` is shared across tally, admission, frontier and `headroomOf`; `--defects` applies to manual comparisons only.
- `--reserve`: sits above observed single-solve bills (gates launch; never interrupts running solves; inspect with `scripts/bills.ts` before changing).
- Selectors default to `--parent latest`, `--reference promoted`.
- Builder gets 24 `--practice-solves` (trimmed by remaining budget via `practiceLeft`, `src/builder/tools.ts`). Examiner gets 240 min, 200 turns, 36 proposals (`tools/d1b/examine.ts`).
- Examiner ends on meeting `tasksToAskFor` (`src/campaign/scheduler.ts`: practice + floor before comparison 1, comparison target thereafter, ≥1 sweep), calling `finish` twice without a proposal, or hitting proposal cap. Early `finish` declines without stating a numeric count. The first two endings suspend the session for the next wake.
