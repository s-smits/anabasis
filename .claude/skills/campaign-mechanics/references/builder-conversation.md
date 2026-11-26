Read this reference for the Builder and Examiner conversations, recorded campaign moves, and the
Builder's clock. It expands `AGENTS.md` section 4.

## 4. The Harness Builder

A single Builder conversation and workspace remain open across campaign tool calls
(`tools/campaign/harness-builder.ts`). Conversational continuity is central to the design, so any
controller change that drops the Builder conversation is a regression. `test/builder-led.test.ts`
verifies this execution path without a live model; any empirical gain from continuity itself remains
unclaimed.

**Nothing blocks the Builder except the Examiner.** Calling `examine` returns immediately while the
Examiner runs concurrently. A comparison runs alongside the conversation with its held-out task draw
fixed at launch, so tasks admitted later enter the next comparison; individual solves wait in the
queue whenever the remaining budget cannot reserve additional concurrent solves (`queued`,
`tools/campaign/host.ts`). Only ending the conversation or issuing a second `examine` call waits for an
active Examiner. Running comparisons and promotions asynchronously eliminates the substantial idle
waiting that occurred when those actions blocked the Builder conversation.

**The Examiner conversation rests between requests.** Each `examine` call represents one request
(`conversing`, `tools/campaign/campaign-actions.ts`). Once the request has supplied the needed tasks or
its `finish` call is accepted, it logs `exam.finished` and suspends without consuming any timer
until the next request arrives. The next request resumes it with only the events reported since it
last ran (`wakeMessage`, `src/examiner/prompt.ts`), providing neither a target count nor a numeric
goal. Each request receives fresh turn and proposal limits. The Examiner conversation closes
together with the Builder conversation (`closing`), on a campaign halt, after a crash or limit
exhaustion, or on the first request following a promotion (`examineAction`); the subsequent request
then opens a fresh conversation from the log (`heard`) while preserving its home directory.
Rehearsals always open each request afresh.

**The move table enforces conditions rather than directing the model.** When the move table requires
a different action from the one the Builder requested, the tool executes the required action and
reports what it ran (`comparedOf`), preserving the three invariants in `AGENTS.md` section 4. The
host promotes a winning candidate as soon as its comparison reports a step (`promoteOwed`), or waits
for `promote.ts` under `--hitl`, and starts the post-promotion Examiner session specified by the
table.

**Recorded moves.** Starting a move appends `campaign.move` to the log, tagged with the move table's
row and reason when it matches the table, or `led` when the Builder initiated a different action
(`asked` in older logs); the Builder conversation itself is recorded as a `build` move coded `led`.
Actions refused before starting or producing no effect write nothing, whereas a refusal occurring
after a move starts still counts against `--moves`. The Builder is never shown the move table's
recommendation, and controller rationales never cross to any seat.

**The Builder's clock.** Comparing the working directory freezes a harness snapshot
(`build.checkpoint`) without ending the conversation. Session turn limits span the entire
conversation, whereas the wall-clock deadline tracks only the Builder's active time and pauses while
a campaign tool runs; otherwise a long comparison hitting the Builder deadline would be misreported
as a host failure (`Bench.within`, `src/builder/tools.ts`). When a conversation terminates due to
limits or a restart, a new conversation opens with the saved notes and results.

Because the Builder ends almost every turn with a tool call, messages injected between turns are
never observed. Standing campaign facts are therefore included in every tool result so that context
compaction requires no separate signal (`usedLine`, `continuation`, `read_opening`). Manual sessions
(`tools/campaign/session.ts`, `round.ts`) omit the campaign tools and use separate prompt texts (`SAID`,
`src/builder/prompt.ts`).
