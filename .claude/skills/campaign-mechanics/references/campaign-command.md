Read this for the hand commands, opening from a prompt, spending, endings and operator words. It
expands the first half of `AGENTS.md` section 6; terms and refusals are in `terms-and-refusals.md`.

## 6. A campaign's commands

Each command names the campaign (`--name`) and its pack: a stored pack by
`--root --sweep --cycle --bundle`, or none where the log drafted its own exam (`packNamed`,
`tools/d2/campaign.ts`). Each runs as `bun <file>`, and its head comment is its manual.

| Order | Command | What it records |
| --- | --- | --- |
| 0 | `tools/d1b/draft.ts` | The drafting session and the draft that stood (`exam.drafted`), with its reading |
| 1 | `tools/c/accept.ts [--admit <checks> \| --admit-authored] [--freeze]` | The checker's reading (`checker.read`) and the freeze (`contract.frozen`) |
| 2 | `tools/d2/prepare.ts` | The pack's tasks held out, practice released |
| 3 | `tools/d1b/examine.ts` | More held-out tasks from an Examiner session |
| 4 | `tools/d2/round.ts`, `session.ts`, `checkpoint.ts` | A Builder session and its comparison; a session alone under its own cap; a comparison of two kept harnesses |
| 5 | `tools/d2/settle.ts` | A packet for blind labels (rejections not ruled earned, three earned, three passes), then the labels; a pass labelled wrong is its side's fail |
| 6 | `tools/d2/promote.ts --harness <digest> --yes`, `import.ts` | `harness.promoted` (`--despite` where the rule names another); `harness.imported`, a harness built elsewhere |
| 7 | `tools/d2/close.ts --to <dir>` | Nothing; writes the handover outside the repository or under `data/harnesses/` |
| all | `tools/d2/harness-builder.ts --budget <dollars>` | `campaign.opened`, `campaign.move`, `build.checkpoint`, `campaign.ended` |

A harness letter (A is the starter; `namesOf`, `src/campaign/names.ts`) is a name and the digest its
identity.

### The campaign command

The last row runs everything above with the Builder leading (section 4). `--moves N` bounds the
campaign actions, `--dry-run` prints the table's advice, and `--handover <dir>` writes row 7's
handover at the end, which must open as the harness it was kept as. Each launch through
`bun run runs` writes a receipt, `launch-run-<n>.json`, holding the commit the log does not.

**The solve queue** (`tools/d2/host.ts`) waits for load at most half an hour (`campaign.waited`),
then off the record while the budget holds no reserve for the solve beside those in flight
(`affords`). A cancelled wait starts no solve: the comparison ends killed, or the practice solve
ends its Builder session.

**Opening from a prompt.** The first move is row 0. A draft stands once the host's reading, without
a model, finds no fault in its shape, sources, checks, objective, control answers and examples
(`draftFaults`, `src/examiner/draft.ts`; `draftReading`, `tools/d2/exam.ts`). Every check of a
drafted exam is its author's computation, so the launch's word admits them all and freezes the exam
when nothing else is at fault (`keepReading`, `tools/c/accept.ts`); under `--hitl` none is admitted,
the campaign ends `exam`, and `--admit <checks>` reads it again at row 1.

**Endings.** A Builder's `finish` ends one conversation. Between conversations the host makes any
move the table names that needs no Builder (`make`), releases owed practice (`releaseOwed`) and
starts a named Examiner session beside the next conversation (`campaignTools`). `finished` counts
idle conversations; one the provider crashed or a stop killed, or one the host refused, is not idle
(`idleOf`, `tools/d2/campaign-terms.ts`). `environment` follows a move that threw after it began,
unless its session is recorded as crashed (`goesOn`), and three provider-failed sessions in a row
that held no task and changed no harness (`crashedRun`, `src/campaign/ground.ts`); the row starts
again at the first turn served to a session that does not crash. A comparison
begun under other code refuses to continue, so resume it at its own code. Run again by name, a
campaign continues from its log, whatever ended the process: `test/campaign-kill.test.ts` ends the
command with SIGKILL at six points and holds the run after it to what no kill may change. A killed
writer's last line without its newline is no event; a read ends before it and the next append cuts
it (`src/kernel/log.ts`). A pack task proposed and not yet gated is put to its gate (`ungated`,
`tools/d2/prepare.ts`).

**Operator words** (`tools/d2/word.ts`) are `campaign.word` events, read at the next move's boundary
and by each campaign tool before it runs (`actionTurn`), never interrupting a move or being waited
for (`pendingWords`, `src/campaign/word.ts`). The event that acts on a word names it (`answers`), so
it acts once, and a stop followed by the same command is a pause. A `runs pause` word is answered by
its time instead: it holds the solves of the process it was left for during the solve limit and two
minutes (`paused`). `bun run runs stop` is the abrupt
form and writes no ending.
