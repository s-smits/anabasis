Read this for campaign commands, exam preparation, spending, endings and operator instructions. This
expands the first half of `AGENTS.md` section 6; settings and admission are in
`terms-and-refusals.md` .

## 6. A campaign's commands

A campaign runs as a sequence of commands over one log. Each names the campaign (`--name`) and the
pack it opens over: a stored pack, by four flags together (`--root --sweep --cycle --bundle`), or
none, for a campaign whose own log drafted its exam (`packNamed`, `tools/d2/campaign.ts` ). The head
comment of each file is its manual and lists its flags.

| Order | Command | What it puts in the log |
| --- | --- | --- |
| 0 | `bun tools/d1b/draft.ts --name <name> --session d-1 --examiner <model>` | For a campaign opened from a prompt: the Examiner's drafting session, and the whole draft that stood (`exam.drafted`), read by the host without a model |
| 1 | `bun tools/c/accept.ts ... [--admit <checks> \| --admit-authored] [--freeze [--despite "<why>"]]` | What the check program was seen to do (`checker.read`), and the operator's word that the contract and that version stand (`contract.frozen`) |
| 2 | `bun tools/d2/prepare.ts ... [--practice N]` | The pack's tasks held out and the practice tasks released |
| 3 | `bun tools/d1b/examine.ts ... --session x-1 --examiner <model>` | More held-out tasks, written by an Examiner session |
| 4 | `bun tools/d2/round.ts ... --session b-1 --builder <model>` | A Builder session, then the comparison of the harness it left with the reference |
| 4 | `bun tools/d2/session.ts ... --session b-2 --builder <model>` | A Builder session with no comparison after it, under its own dollar cap; several may precede one standalone comparison |
| 4 | `bun tools/d2/checkpoint.ts ... --id g2` | One comparison of two kept harnesses, without a Builder session |
| 5 | `bun tools/d2/settle.ts ... --session b-1` | The comparison's packet for blind labels (section 1, factor 3): every rejection ruled a check defect or unclear, or unruled, plus three ruled earned and three passes, drawn by id. Once answered: the labels and the report again; a pass labelled wrong is its side's fail. Until then the report says `unsettled`, and no promotion waits for it |
| 6 | `bun tools/d2/promote.ts --name <name> --harness <digest> --yes` | The operator's word that a kept harness is the reference from then on (`harness.promoted`). Without `--yes` it shows the harness and records nothing; one the rule would not promote needs `--despite "<why>"`. `--harness` takes a digest or the letter the view prints (A for the starter, then B, C in the order the log first names each; `namesOf`, `src/campaign/names.ts`): the letter is a name, the digest the identity |
| 6 | `bun tools/d2/import.ts --name <name> --harness <dir> [--note "<why>"]` | The operator's word that a harness built elsewhere is kept by this campaign (`harness.imported`), under its digest, so `--parent`, `--reference` and `promote.ts` can name it. It is no session, so `latest` does not move |
| 7 | `bun tools/d2/close.ts ... --to <dir> [--harness <letter\|digest>]` | Nothing. It writes the handover, outside the repository or under the ignored `data/harnesses/`: the reference harness (or the one `--harness` names) as a self-contained directory, the public rules, and the closing report |
| all | `bun tools/d2/harness-builder.ts ... --budget <dollars> --builder <model> --examiner <model> --reviewer <model>` | The opening (`campaign.opened`), the Builder's requested moves (`campaign.move`), frozen versions inside its conversation (`build.checkpoint`) and its ending (`campaign.ended`) |

### The campaign command

The last row opens the exam and then runs the Builder with campaign tools (section 4); its head
comment is the full account. `--moves N` bounds the campaign actions, and `--dry-run` prints the
table's advice and makes no move. Outside `--hitl` it freezes an exam whose reading shows no fault
and promotes the harness the rule names (section 3); under `--hitl` it runs only once every fault of
its checks is admitted, and reports a step without promoting it.

Launching, continuing, pausing and stopping go through `bun run runs` (the skill `run-management` ),
and each run keeps a receipt beside the log, `launch-run-<n>.json` (`tools/runs/receipt.ts`), which
holds the commit the log does not. Every practice, comparison and room solve enters the solve queue:
it starts once the one-minute load is at or under the cores, or after half an hour
(`campaign.waited`, `tools/d2/host.ts` ; `--loaded` skips the wait), and waits off the record while
the budget holds no reserve for it beside the solves in flight (`affords`). A cancelled wait starts
no solve: a comparison so cancelled ends killed, a practice solve ends its Builder session, and a
room solve leaves its draft refused unmeasured.

**It opens over a stored pack, or from a prompt** (`--prompt "<text>"` or `--prompt-file <path>` ,
with `--solver` ), whose first move is the draft of row 0. A draft stands once the host's reading,
without a model, finds no fault: its shape, a source on every rule, one check per rule, every
control answer through the checks twice, the smallest answer refused on every example, and each
field of an accept control answer moving some check's verdict or the objective (`draftReading`,
`tools/d2/exam.ts` ; `unreadFields` , `src/kernel/acceptance.ts` ). It does not wait for the
reference's measurement: `draft.finished` records that as complete, interrupted with its first
cancellation source, or not run. A killed solve records that source (`CancellationOrigin`,
`src/kernel/solve.ts` ; an unlabelled external abort is `caller` ); older events leave it unknown,
and an abrupt process termination promises no ending. The reading cannot tell whether a rule belongs
to the field. Every check of a drafted exam is its author's own computation, and the launch is the
operator's word for each (rule 10): the exam is read with `--admit-authored` and frozen if nothing
else is at fault. Under `--hitl` the campaign ends on its exam there, and goes on when run again
with `--admit <checks>` .

**The budget covers the whole campaign.** Each move receives the total `--budget` minus recorded
spending. The campaign ends when the remaining amount is below one solve's reserve (`--reserve`).
The host does not forecast a move's final cost. A comparison cut short by its cap reads `not-scored`
.

**It ends in one of seven ways**, and the log's last event says which (`campaign.ended`):

- `budget`;
- `stop` (the stop rule, section 7);
- `exam`;
- `no-room`;
- `environment`;
- `operator`;
- `finished` (three Builder conversations in a row made no campaign move, the last ending by
  `finish` or at its limits).

A Builder's `finish` ends one conversation, never the campaign. Between conversations the host makes
whatever move the table names that needs no Builder, a comparison or a promotion (`hostOwed`,
`tools/d2/harness-builder.ts` ), and an Examiner session the table names starts beside the next
conversation (`campaignTools`, `tools/d2/campaign-actions.ts` ). A reading with no room is advice to
request other tasks, and supply patience over such readings ends the campaign, conversation or not
(`roomless`, section 7). A conversation the provider crashed or a stop killed, an Examiner session
beside it that ended so without holding out a task, and one the host refused do not count towards
the three idle ones (`idleOf`, `tools/d2/campaign-terms.ts` ), and the status a Builder reads counts
the idle conversations before its own. A campaign ended `finished` and run again by name opens a new
conversation, as after the operator's stop.

A comparison started under different code cannot continue here. Its recorded terms refuse the
continuation, ending the campaign on `environment` ; resume at the original code until it reports. A
move that threw after it began ends it on its environment, unless its session is recorded as crashed
(`goesOn`); so do three Builder or Examiner sessions in a row that the provider failed before they
held out a task or changed a harness (`crashedRun`, `src/campaign/ground.ts` ). Such a session was
refused a turn, so it is not idle for supply patience. Run again by name, the campaign continues
from its log and the count starts again.

With `--handover <dir>` it then writes row 7's handover. The harness is copied whole, with the
programs a kept state names by a link, and must open there as the harness it was kept as. The
closing report is a view of the log without task names or checks, and says what was audited: the
Referee's rulings, what labels settled, the comparisons still unsettled, and whether a person read a
packet's passes.

**The operator steers a running campaign by leaving it a word** (`tools/d2/word.ts`), one
`campaign.word` event: `--stop "<why>"` ends it `operator` , `--tasks "<why>"` has an Examiner write
other tasks before anything else is built or compared, and `--budget <dollars>` sets its total from
then on. A word is read at the next move's boundary, and inside a live Builder conversation by each
campaign tool before it runs (`actionTurn`, `tools/d2/campaign-actions.ts` ); it never interrupts a
move in flight and is never waited for (`pendingWords`, `src/campaign/word.ts` ); the event that
acts on it names it (`answers`), so it acts once, and a stop followed by the same command is a
pause. No seat reads a word or its reason. `bun run runs stop` is the abrupt form, which writes no
ending.
