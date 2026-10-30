Read this for Builder continuity, campaign tools, recorded moves, deadlines and compaction. This
expands `AGENTS.md` section 4.

## 4. The Harness Builder

The **Harness Builder** and the **Builder** are one model agent: it edits the harness and decides
when to ask for task writing, release practice, compare or promote, with no coordinating model above
it. After the host opens the exam and prepares the campaign, `tools/d2/harness-builder.ts` keeps one
Builder conversation and one workspace open while its campaign tools run, each through the same
admissions and commands as a move the operator launches.

`examine` returns immediately while the Examiner works alongside the Builder. Comparisons,
promotions and the end of the conversation wait for that Examiner session. The host releases owed
practice as tasks are held out. A host halt or kill interrupts the session and records it as killed.

The model cannot choose a checker, a held-out task, a solve limit or a reference. When the decision
table requires another action, the tool performs it and reports the change (`comparedOf`,
`tools/d2/campaign-actions.ts`): a begun comparison goes on under its own terms and reads the
harness it froze; `compare` on an unchanged reference runs the table's own comparison or nothing; a
pair already read is compared again only when the table names it, since a second draw is a second
chance at a step (section 1, factor 2); and `promote` names the harness the rule names (`step`,
`src/campaign/decide.ts`).

An action refused before starting, or one with nothing to do, writes no `campaign.move`. Examiner
sessions and comparisons record their move when they begin. The event carries the table row's code,
or `asked` plus the recommendation when the Builder chooses differently. A refusal after that start
leaves the recorded move counted against `--moves`. The conversation is a `build` move with the
code `led`. `decide` (section 7) advises at the opening, under each tool's result and after a turn
without a call. The Builder may ignore its advice, apart from the Examiner session after a promotion
(row `no-room`), and the endings code owns end the run inside a conversation as between them. The
controller's private reasons (`campaign.move`, `campaign.ended`) never reach a seat's message.

A comparison of the working copy freezes a harness snapshot (`build.checkpoint`) without ending the
conversation. Its session limits cover the whole conversation, and its deadline counts only the
Builder's own time: the clock stops while a campaign action runs on the host's time, bounded by the
campaign's total and `--moves` (`Bench.within`, `src/builder/tools.ts`), since a comparison cut at
the deadline would read as a failed host. Usage is recorded before a tool can spend more. A
conversation ended at its limits or by a restart is followed by a new one, on the notes and results.

The conversation is a term of the campaign, kept by its opening: `--builder-led`, on for any
campaign that opens now. Under `--no-builder-led`, or in a campaign on record without the term, the
host makes every move the table names. The modes differ only in `converse`
(`tools/d2/harness-builder.ts`), the tools and advice (`tools/d2/campaign-actions.ts`), the texts
(`SAID`, `src/builder/prompt.ts`) and a session's span (`soFar`, `src/campaign/handover.ts`). The
conversation is valued for its continuity: a simpler controller that drops it is a regression.
`test/builder-led.test.ts` proves the mode without a model; whether it improves a campaign is
unclaimed until an ablation reads it.

A Builder ends nearly every turn in a tool call, so a message sent between turns goes unseen, and
the standing facts are repeated where it reads, so a compaction needs no signal (`usedLine`,
`continuation`, `read_opening`). Whether the current harness was practised is read from counted
practice, never from a frozen snapshot.
