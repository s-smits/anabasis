Expands `AGENTS.md` §6 (commands, opening, budget, endings, operator words). Terms and refusals live in `terms-and-refusals.md`.

## Commands (`bun <file> --name <name>`; header comments hold full flags)

| Order | Command | Events written |
| --- | --- | --- |
| 0 | `tools/eval/draft.ts` | `exam.drafted` + validation reading |
| 1 | `tools/eval/accept.ts [--admit <checks> \| --admit-authored] [--freeze]` | `checker.read`, `contract.frozen` |
| 2 | `tools/campaign/prepare.ts` | Admitted pack tasks + initial practice releases |
| 3 | `tools/eval/examine.ts` | Additional Examiner-authored held-out tasks |
| 4 | `tools/campaign/round.ts`, `session.ts`, `checkpoint.ts` | Builder + comparison; standalone session; two-harness comparison |
| 5 | `tools/campaign/settle.ts` | Blind packet (unruled/non-earned + 3 `earned` + 3 passes) + human labels (invalid pass = failure) |
| 6 | `tools/campaign/promote.ts --harness <digest> --yes`, `import.ts` | `harness.promoted` (`--despite` to override); `harness.imported` |
| 7 | `tools/campaign/close.ts --to <dir>` | None; exports handover under `data/harnesses/` or outside repo |
| all | `tools/campaign/harness-builder.ts --budget <usd>` | `campaign.opened`, `campaign.move`, `build.checkpoint`, `campaign.ended` |

Harness letters (`A` = starter; `namesOf`, `src/campaign/names.ts`) are display labels; digests are authoritative.

## Campaign command (`harness-builder.ts`)

Runs Builder-led loop (§4): `--moves N` bounds actions, `--dry-run` prints next move without acting, `--handover <dir>` exports and verifies digest reopen on exit. Launches via `bun run runs` write `launch-run-<n>.json` capturing the Git commit.

- **Budget & solve queue (`tools/campaign/host.ts`)**: campaign-wide USD cap ends on `budget` when remaining balance falls below 1 solve reserve or next comparison's estimated test cost. Solve queue waits ≤30 min for host load (`campaign.waited`) and silently while remaining budget cannot cover in-flight + new solve (`affords`). Cancelling a wait kills the comparison or ends the Builder session.
- **Prompt opening**: row 0 validates schema, sources, checks, objective, controls and examples (`draftFaults`, `src/examiner/draft.ts`; `draftReading`, `tools/campaign/exam.ts`). Standard launch admits author-computed checks and freezes if otherwise clean (`keepReading`, `tools/eval/accept.ts`); `--hitl` refuses auto-admission, ends `exam`, and waits for `--admit`.
- **Endings & crash recovery**: between Builder conversations, host runs non-Builder moves (`make`), releases owed practice (`releasePendingPractice`) and wakes Examiner (`campaignTools`). `finished` counts consecutive idle Builder conversations (excluding crashes/signals/refusals via `idleOf`, `campaign-terms.ts`). `environment` fires on post-start throw (unless recorded crashed, `goesOn`) or 3 consecutive provider-failed sessions with no admission or harness edit (`crashedRun`, `state.ts`; resets on first served turn). Open comparisons refuse cross-commit resumption. Re-running by `--name` recovers cleanly from `SIGKILL` (`test/campaign-kill.test.ts`), truncates torn trailing lines (`src/kernel/log.ts`), and submits ungated pack tasks (`ungated`, `prepare.ts`).
- **Operator words (`tools/campaign/signal.ts`)**: `campaign.word` events polled at move boundaries and pre-tool (`actionTurn`, `pendingSignals`, `src/campaign/signal.ts`), answered once (`answers`). `runs pause` writes a time-bounded pause holding new solves for solve-limit + 2 min (`paused`); `runs stop` kills abruptly without `campaign.ended`.
