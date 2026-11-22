Read this reference for the manual campaign commands, opening a campaign from a prompt, budget
enforcement, endings, and operator words. It expands the first half of `AGENTS.md` section 6;
recorded terms and refusals are documented in `terms-and-refusals.md`.

## 6. A campaign's commands

Every command identifies its campaign with `--name` and opens it over the exam its log drafted
(`packNamed`, `tools/d2/campaign.ts`). Each script runs as `bun <file>`, and its file header comment
serves as its usage manual.

| Order | Command | What it records |
| --- | --- | --- |
| 0 | `tools/d1b/draft.ts` | The drafting session and the accepted draft (`exam.drafted`) together with its validation reading |
| 1 | `tools/c/accept.ts [--admit <checks> \| --admit-authored] [--freeze]` | The checker validation reading (`checker.read`) and the contract freeze (`contract.frozen`) |
| 2 | `tools/d2/prepare.ts` | Held-out tasks admitted from the pack and initial practice tasks released |
| 3 | `tools/d1b/examine.ts` | Additional held-out tasks authored by an Examiner session |
| 4 | `tools/d2/round.ts`, `session.ts`, `checkpoint.ts` | A Builder session paired with its comparison; a standalone session under its own cap; or a comparison of two kept harnesses |
| 5 | `tools/d2/settle.ts` | A blind-labelling packet (rejections not ruled `earned`, three `earned` rejections, and three passes) followed by the human labels; a pass labelled invalid counts as a failure for that side |
| 6 | `tools/d2/promote.ts --harness <digest> --yes`, `import.ts` | `harness.promoted` (requiring `--despite` if the promotion rule selects another harness); `harness.imported` for a harness built externally |
| 7 | `tools/d2/close.ts --to <dir>` | Writes no log event; exports the handover bundle outside the repository or under `data/harnesses/` |
| all | `tools/d2/harness-builder.ts --budget <dollars>` | `campaign.opened`, `campaign.move`, `build.checkpoint`, `campaign.ended` |

A harness letter (`A` denotes the starter; `namesOf`, `src/campaign/names.ts`) is a human-readable
label, whereas the digest is its authoritative identity.

### The campaign command

Row `all` executes the full workflow above under Builder leadership (section 4). `--moves N` bounds
the number of campaign actions, `--dry-run` prints the move table's recommendation without acting,
and `--handover <dir>` writes the row 7 handover bundle at completion, verifying that it reopens as
the exact harness digest that was kept. Every launch through `bun run runs` writes a receipt
(`launch-run-<n>.json`) capturing the Git commit hash, which the log itself does not store.

**The budget** is a single campaign-wide total. The campaign terminates with `budget` once the
remaining balance falls below one solve's reserve or below the estimated cost of the next
comparison's test based on historical solve bills.

**The solve queue** (`tools/d2/host.ts`) waits up to 30 minutes for host load (`campaign.waited`),
and waits silently whenever the remaining budget cannot reserve the solve alongside those already in
flight (`affords`). Cancelling a wait prevents the solve from starting: a comparison ends as killed,
and a practice solve terminates its Builder session.

**Opening from a prompt.** The first step is row 0. A draft is accepted once model-free host
validation finds no fault in its schema, sources, checks, objective, control answers, or examples
(`draftFaults`, `src/examiner/draft.ts`; `draftReading`, `tools/d2/exam.ts`). Because every check in
a drafted exam is author-computed, the launch authorisation admits all of them and freezes the exam
provided no other fault is present (`keepReading`, `tools/c/accept.ts`). Under `--hitl`, no check is
admitted automatically, the campaign ends with `exam`, and `--admit <checks>` re-evaluates it at
row 1.

**Endings.** Calling `finish` closes one Builder conversation. Between conversations, the host runs
any move named by the table that does not require a Builder (`make`), releases owed practice tasks
(`releaseOwed`), and starts a named Examiner session alongside the next conversation
(`campaignTools`). The `finished` ending counts consecutive idle conversations; conversations ended
by a provider crash, a stop signal, or a host refusal do not count as idle (`idleOf`,
`tools/d2/campaign-terms.ts`). The `environment` ending occurs when a move throws after starting
(unless its session is recorded as crashed; `goesOn`), or after three consecutive provider-failed
sessions that neither admitted a task nor changed a harness (`crashedRun`,
`src/campaign/ground.ts`); that counter resets on the first turn served to a non-crashing session. A
comparison begun under different host code refuses to resume and must be continued at its original
commit. Re-invoking the command by campaign name resumes from the log regardless of how the previous
process exited: `test/campaign-kill.test.ts` sends `SIGKILL` at six distinct points and verifies
that the resumed run preserves all invariants. A truncated trailing line lacking a newline from a
killed writer is ignored on read and truncated before the next append (`src/kernel/log.ts`). Any
pack task proposed but not yet gated is submitted to its gate on resume (`ungated`,
`tools/d2/prepare.ts`).

**Operator words** (`tools/d2/word.ts`) are `campaign.word` events polled at each move boundary and
before each campaign tool executes (`actionTurn`); they never interrupt an in-flight move and are
never waited for (`pendingWords`, `src/campaign/word.ts`). The event that handles a word references
it (`answers`) so each word acts once, and a stop followed by re-running the same command functions
as a pause. A `runs pause` word is instead time-bounded: it holds new solves for the targeted
process over the solve limit plus two minutes (`paused`). `bun run runs stop` is the abrupt form and
writes no `campaign.ended` event.
