Read this for Builder continuity, campaign tools, recorded moves, deadlines and compaction. This
expands `AGENTS.md` section 4.

## 4. The Harness Builder

The **Harness Builder** and the **Builder** are one model agent: it edits the harness and decides
when to ask for task writing and when to compare, with no coordinating model above it. The host
releases owed practice and promotes the harness a step names. After the host opens the exam and prepares the campaign, `tools/d2/harness-builder.ts` keeps one
Builder conversation and one workspace open while its campaign tools run, each through the same
admissions and commands as a move the operator launches.

`examine` returns immediately while the Examiner works alongside the Builder. A comparison goes on
beside it: its draw is fixed as it starts, so tasks held out later join the next one, and each of
its solves waits while others are in flight and the campaign's total left covers no more
(`queued`, `tools/d2/host.ts`).
Only the end of the conversation and a second `examine` wait for that session; until 5 November a
comparison and a promotion waited too, and jobstat Builders spent 39 to 86% of their conversations
in that wait. The host releases the practice owed (`releaseOwed`, `practiceDue`) as the session
holds a task or ends and as a conversation opens on tasks held out since the last release or
promotion, never while a comparison is unreported. A host halt or kill interrupts the session and records it as killed.

The model cannot choose a checker, a held-out task, a solve limit or a reference. When the decision
table requires another action, the tool performs it and reports the change (`comparedOf`,
`tools/d2/campaign-actions.ts`): a begun comparison goes on under its own terms and reads the
harness it froze; `compare` on an unchanged reference runs the table's own comparison or nothing; a
pair already read is compared again only when the table names it, since a second draw is a second
chance at a step (section 1, factor 2). A step is promoted by the host as its comparison reports
(`promoteOwed`), or under `--hitl` waits for the operator's `tools/d2/promote.ts`.

An action refused before starting, or one with nothing to do, writes no `campaign.move`. Examiner
sessions and comparisons record their move when they begin. The event carries the table row's code
and reason where the move is the one the table names, and `led` where the Builder chose another
(`asked` with the table's move in a log before 5 November). A refusal after that start
leaves the recorded move counted against `--moves`. The conversation is a `build` move with the
code `led`. The Builder is never told the table's move (section 2, consequence 1); until 5 November
each tool's result ended with it as a "Suggested action". The host still makes the Examiner session
the table names after a promotion (row `no-room`), and the endings code owns end the run inside a
conversation as between them. The
controller's private reasons (`campaign.move`, `campaign.ended`) never reach a seat's message.

A comparison of the working copy freezes a harness snapshot (`build.checkpoint`) without ending the
conversation. Its session limits cover the whole conversation, and its deadline counts only the
Builder's own time: the clock stops while a campaign action runs on the host's time, bounded by the
campaign's total and `--moves` (`Bench.within`, `src/builder/tools.ts`), since a comparison cut at
the deadline would read as a failed host. Usage is recorded before a tool can spend more. A
conversation ended at its limits or by a restart is followed by a new one, on the notes and results.

Every campaign runs so, and a log whose opening kept `led` reads the same. A Builder session by
hand (`tools/d2/session.ts`, `round.ts`) runs without the campaign tools; it differs from the
conversation only in the tools (`tools/d2/campaign-actions.ts`) and the texts (`SAID`,
`src/builder/prompt.ts`). The conversation is valued for its continuity: a simpler controller that
drops it is a regression. `test/builder-led.test.ts` proves it without a model; whether it
improves a campaign is unclaimed.

A Builder ends nearly every turn in a tool call, so a message sent between turns goes unseen, and
the standing facts are repeated where it reads, so a compaction needs no signal (`usedLine`,
`continuation`, `read_opening`). Whether the current harness was practised is read from counted
practice, never from a frozen snapshot.
