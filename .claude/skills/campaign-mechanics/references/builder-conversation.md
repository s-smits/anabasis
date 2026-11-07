Read this for the Builder and Examiner conversations, recorded moves and the Builder's clock. It
expands `AGENTS.md` section 4.

## 4. The Harness Builder

One Builder conversation and one workspace stay open while campaign tools run
(`tools/d2/harness-builder.ts`). Continuity is the point of the design: a controller that drops the
conversation is a regression. `test/builder-led.test.ts` proves the path without a model; a gain
from it is unclaimed.

**Nothing blocks the Builder except the Examiner.** `examine` returns at once and the Examiner works
alongside. A comparison runs beside the conversation with its draw fixed at the start, so tasks held
later join the next one; its solves wait while the remaining total covers no more (`queued`,
`tools/d2/host.ts`). Only the conversation's end and a second `examine` wait for the Examiner. When
comparisons and promotions blocked, Builders spent 39 to 86% of their conversations waiting.

**The Examiner conversation rests between asks.** Each `examine` is one ask (`conversing`,
`tools/d2/campaign-actions.ts`). Once the ask has supplied its tasks or its `finish` is accepted, it
records `exam.finished` and waits, off every clock, for the next ask, which wakes it with what
reported since (`wakeMessage`, `src/examiner/prompt.ts`), never a count or a target. Each ask has
full limits. The conversation ends with the Builder's (`closing`), at a halt, or where an ask
crashed or met a limit; the next ask then opens afresh from the log (`heard`) with the carried home.
Rehearsals open every ask afresh.

**The table chooses conditions instead of the model.** Where the table needs another action than the
one asked, the tool does it and says so (`comparedOf`), which is how section 4's three invariants
hold. The host promotes a step as its comparison reports (`promoteOwed`), or under `--hitl` waits
for `promote.ts`, and starts the Examiner session the table names after a promotion.

**What is recorded.** A move writes `campaign.move` when it begins, with the table's row and reason
where it is the table's move and `led` where the Builder chose another (`asked` in an older log);
the conversation itself is a `build` move coded `led`. A refused or empty action writes nothing; a
refusal after the start still counts against `--moves`. The Builder is never told the table's move,
and the controller's reasons never reach a seat.

**The clock.** A comparison of the working copy freezes a snapshot (`build.checkpoint`) without
ending the conversation. Session limits cover the whole conversation, but the deadline counts only
the Builder's own time: it stops while a campaign action runs, since a comparison cut at the
deadline would read as a failed host (`Bench.within`, `src/builder/tools.ts`). A conversation ended
by limits or a restart is followed by a new one on the notes and results.

A message sent between turns goes unseen, since a Builder ends nearly every turn in a tool call, so
standing facts are repeated in every tool result and compaction needs no signal (`usedLine`,
`continuation`, `read_opening`). A session by hand (`tools/d2/session.ts`, `round.ts`) lacks the
campaign tools and has its own texts (`SAID`, `src/builder/prompt.ts`).
