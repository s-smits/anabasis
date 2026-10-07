# Meta Agent: keep the main session moving

The Super Loop is usually driven by one long session, the main session. It fixes the owners,
publishes the stack, freezes the predictions, launches, watches and closes. It can stall in ways it
cannot see from the inside:

- a question held open on a dialog while the facts behind it change;
- a compaction that narrows the operator's plan;
- a finding that never reached it.

The Meta Agent is a second session that audits the main session read-only and steers it with bounded
messages, so that the loop keeps moving and nobody takes it over. It decides nothing that belongs to
the operator. It edits nothing the main session owns. It never touches a run.

The Meta Agent is [monitor-session-until-idle](../../monitor-session-until-idle/SKILL.md), applied to
a Claude Code target and to this loop's rules. That skill owns the three ledgers, the checker's
decision codes and the warning form. This page owns four things:

- what is different when the target is a Claude session;
- what the Meta Agent enforces for the Super Loop;
- how a message actually reaches the target;
- what to do when the target cannot move at all.

## Set up

**Reach the target first.** `SendMessage` reaches only sessions that share one Claude configuration
directory, so run the Meta Agent under the target's `$CLAUDE_CONFIG_DIR`. Resolve the target by its
session id, pid, registered name and working directory, then confirm that `ListAgents` lists that
name. A live session missing from the list re-registers when it is resumed with `claude --resume`.
Message that one name and nothing else, because a session with a similar name is not the target.
One Meta Agent message once went to a neighbouring session instead.

**Write the contract** outside every run tree, for example under the ignored
`notes/meta-agent/watch-contract.json`, as the monitor skill describes. The objective is the
operator's own words. A Super Loop cycle has the same closures every time, and each one closes only
on the receipt named here:

| closure | closed by |
| --- | --- |
| `fix_everything` | the owning commits named against the plan's items |
| `stack_published` | every head on origin, each edge `git merge-base --is-ancestor` proved |
| `predictions_frozen` | the ledger rows' timestamps, all before any opening |
| `openings` | each run's `opening.json`: full `source.commit`, all three slot pins, the matrix |
| `old_runs_stopped` | a `terminal.json` per old run, and the operator's word for each stop |
| `old_runs_analysed` | `campaign.ts` closure and `prediction.ts adjudicate` per terminal |
| `runs_watched` | readers run from main at each new battery, including the `climb` reading |
| `runs_closed` | the same closure and adjudication for each new terminal |
| `findings_routed` | a commit, a snapshot decision, a frozen row or a deletion (the completeness review's four exits) |
| `handover` | `notes/current-state.md` naming heads, run ids and the next action |

**Give the checker a Claude session.** `thread-state.ts` reads Codex thread snapshots only. For a
Claude target, pipe `session-state.ts` into the checker in its place:

```bash
bun .claude/skills/monitor-session-until-idle/scripts/session-state.ts <config dir> <session id> \
  | bun .claude/skills/monitor-session-until-idle/scripts/watch-contract.ts check - \
    notes/meta-agent/watch-contract.json
```

The reading itself is `readClaudeSession` in the shared [session module](../../main/session.ts),
which any skill script can import. It takes the registry record whose process still exists, because
a resumed session leaves its earlier process's record behind, or, when none is live, the record that
changed state last. It finds the transcript by session id, because it sits under the directory the
session started in rather than the one it works in. Its `processExists` is the one liveness probe
the skill scripts share: a refusal for permission means the process exists and the caller may not
signal it, as with another user's process or anything outside a sandbox's wall, so only ESRCH says
it is gone.

The script maps a `waiting` session to a turn in progress. A live session with no status it knows,
or a session no record names, gets an `unknown` turn, so the checker inspects it rather than letting
it stop; a wrong config dir reads that way too. Before it did, the checker read a target
held on a question as a stopped session. It then ordered a liveness `DIRECT` at a session that had
not stopped, and could not have read the message anyway. The `session` block in its output is for
you, not for the checker: `waitingFor`, `statusUpdatedAt` and `quietSeconds` are what tell you
the target is held on the operator rather than stalled.

**Schedule the tick** with a recurring session cron, twice an hour and off the hour (`7,37 * * * *`).
A session cron dies with the session and expires after seven days, so the Meta Agent's own session
stays open for the whole cycle. The tick prompt is fixed text. Write it once, with the target named:

```text
Meta Agent tick for the Super Loop that <target name> (<session id>, working in <tree>) runs.
1. bun .claude/skills/monitor-session-until-idle/scripts/session-state.ts <config dir> <session id>
   | bun .claude/skills/monitor-session-until-idle/scripts/watch-contract.ts check -
     notes/meta-agent/watch-contract.json
2. Read new raw evidence since the last tick: the transcript tail, `gh pr list --state open`,
   `bun run runs pulse --once` from main, and each new run's opening.json and prediction rows.
3. Update closures, claims and interventions with cited receipts.
4. Enforce the Super Loop rules; each violation is one DIRECT.
5. Act only on the checker's code. DIRECT or CHECK goes to <target name> in the warning form.
   VERIFY_INTERVENTION means reading the reply. CONTINUE means silence to the target.
   STOP_ELIGIBLE means the final raw audit.
6. Report a short status to the operator.
```

## Read the target

The registry record at `$CLAUDE_CONFIG_DIR/sessions/<pid>.json` holds the target's state as one of
`busy`, `idle` or `waiting`. `waiting` comes with `waitingFor`, and `statusUpdatedAt` says since
when. The transcript is JSON lines. The ones that matter are:

- assistant `text`;
- `tool_use` for any Bash that pushes, launches, stops or freezes a prediction;
- `tool_result`;
- `queue-operation` with `enqueue` and `remove`, which is how your own messages arrive;
- `attachment` of type `queued_command`, which is a queued message handed to the model.

A line count and the last timestamp are the cheapest cursor between ticks. Read only past it.

Quiet is not stalled, and the Meta Agent should know the two silences this loop produces:

- **A `harness_trial` rehearsal.** It runs one blind Built solve under the harness's solve wall, 120
  minutes by default. The Builder writes no checkpoint while it runs, so a gap of up to two hours in
  the pulse is work. Read the process tree and the mtime of the solve's
  `/private/var/tmp/ana-quick-run-*/ana-built-bash` before calling it anything.
- **A battery mid-solve.** It is silent for the reason SKILL.md gives under "Silence under a wall is
  work, not a stall".
- **A long check.** One firmware `correctness_check` ran 137 minutes on 2026-09-30 at several times
  the host's core count, and the Builder writes nothing until it returns. Read the run's
  `ana-claude-cli-*` store for an open `tool_use` before calling the silence a stall.

## How a message reaches the target

A message is delivered when the target's turn next moves, and what counts as moving depends on the
state:

| target state | what happens to a message |
| --- | --- |
| `busy` | attached to the model's context after its next tool result, usually within minutes |
| `idle` | starts a new turn at once |
| `waiting` | enqueued and not read; handed over only when the operator answers the dialog |

The third row is the one that stalls a cycle. On 2026-09-28 the main session asked its launch
question in a dialog at 01:51Z. Two `CHECK`s went to it at 05:10Z and 05:39Z. The first said two
runs had stopped on provider credit. The second said a third had too, which made the question's
placement of the new runs stale. Both sat in the queue until 10:07:54Z, the instant the
operator answered, and were dequeued in the same second. So the operator had answered a question
that had gone stale at 05:21Z. The main session reconciled the answer with the new facts at 10:09Z,
which is the only reason sending them still paid.

Nothing the Meta Agent sends can answer a dialog or a permission prompt. It may not try another
route either. Editing the target's registry or transcript is refused as session transcript
tampering, and it should be. So a `waiting` target is the operator's to unblock, and the Meta
Agent's job is to say so within one tick, plainly, in its status line:

- that a dialog is open on the target's screen;
- what it asks, and the answer it recommends;
- what has changed since it was asked;
- that nothing the Meta Agent sends will be read until it is answered.

"Your decisions are still needed" is not that sentence. It was the status line for most of that
morning, and the operator had to ask why the messages were not working. Still send the `CHECK` the
checker orders. It lands the moment the dialog closes, and it is how the target learns the facts
that changed while it waited. `VERIFY_INTERVENTION` then fires on every tick until the reply comes.
That is expected, and it never earns a second message.

## Authority

The Meta Agent may read anything read-only: the transcript, the registry, run evidence, pull
requests, and readers run from main. It may write its own contract and memory. It may send one
`CHECK` or `DIRECT` per unresolved issue to the one target, and report to the operator.

It may not do any of the following:

- relay approval;
- answer for the operator;
- launch, stop or change a run;
- edit source in the target's tree;
- message any session but the target.

Stops, spend, merges and account choices need the operator's word in the target session. A peer's
relay is not that word, and the main session rightly refuses to act on one. So a Meta Agent that
tries to approve by relay loses a round and gains nothing.

The operator's word also outranks the plan the Meta Agent enforces. The relayed plan said to verify
the six openings and then stop the old runs. At 10:07Z the operator chose "stop four, then launch"
because of host load. That is an operator-named exception. Record it on the closure with the
transcript line that holds it. Do not send a `DIRECT` against it.

## What the Meta Agent enforces

Each row is one `DIRECT`, sent only when its receipt shows the violation and no operator-named
exception covers it:

| rule | violation | deciding receipt |
| --- | --- | --- |
| launch source | an opening off the composed head, or any edge not ancestry-proved | `opening.json` `source.commit`; `git merge-base --is-ancestor` per edge |
| pins | an unpinned slot, which falls back to `gpt-5.6-luna`; a missing model and domain pair | the three slot pins in `opening.json` |
| predictions | a row frozen after its opening, or none | `notes/predictions/<runId>.jsonl` timestamps against `opening.json` `writtenAt` |
| order | old runs stopped before the new openings are verified | stop commands in the transcript against the opening receipts |
| stops | a stop without the operator's word in the target session | the operator's answer line against the stop line |
| readers | a reader run from a run tree, or from whichever of main and the stack top is older than the records it reads (SKILL.md, "Read from the newest tree") | the reader command's working directory and that tree's head |
| batching | pull requests against authoring text after two off-band batteries | SKILL.md, "When two batteries miss the band the same way, stop editing prose" |
| closure | a terminal with no `campaign.ts` closure or adjudication | `terminal.json` against the closure output and the ledger |
| climb | a new `versions/<battery>/` read without `wri.ts climb` | the directory's mtime against the reader call |
| constraint | a launch whose frozen predictions name no link, or a change aimed at a link other than the ledger's current constraint with no fresh walk recorded | the `movedVariable` text in `notes/predictions/<runId>.jsonl` against the latest row of `notes/binding-constraints.md` |
| watch | a live run with nothing watching it, such as a target turn that ended on a question while its runs had only launch monitors | `ps` for `campaign.ts --every` or a pulse loop; the target's armed monitors, crons and their timeouts |
| load | a launch while the host's one-minute load is above 25, or one that takes the live runs past six (SKILL.md §4) | a load reading in the target's transcript before its launch command, or none |

The ledger the `constraint` row reads got its first row on 2026-09-30, and that row has no outcome
yet (SKILL.md, "Lifted, held or unreached: the constraint ledger"), so the row's first `DIRECT`s
test the rule as well as the target.

Credit exhaustion is the environment's, and only an explicit message proves it, so read the run's
`terminal.json` before calling a stop exhaustion.

## Report to the operator

Each tick ends with a few lines to the operator:

- the phase;
- what moved, with its receipt;
- the contract counts;
- the gaps;
- the one decision that is the operator's, named where it is held.

Say where a decision is held, whether that is a dialog on the target's screen or a question in its
last message. Do not merely say that one is owed. When the checker returns `CONTINUE`, the target
hears nothing and the operator still gets the line.

When every closure is closed or held, run the final raw audit that
[monitor-session-until-idle](../../monitor-session-until-idle/SKILL.md) describes. Then report the
outcome, send a push notification and delete the cron.

## What has cost time here

- A launch dialog held for eight hours (01:51Z to 10:07Z) while the facts behind it changed. The
  status line said "decisions needed" and should have named the dialog. See "How a message reaches
  the target".
- A checker `DIRECT` ordered at a session that was only waiting, before the adapter mapped
  `waiting`.
- A `CHECK` that went stale within half an hour as a third run ran dry. Correct one like that
  with an addendum naming the earlier message's id, rather than a second fresh `CHECK`.
- Tool calls refused with no verdict while the permission classifier was down. Do the tick with
  read-only tools. Record the missed ledger entries on the next tick where writes work, and stop
  retrying well before ten refusals end the turn.
- Four runs left unwatched. The main session ended its turn at 10:23Z on the operator's placement
  question for a fifth and sixth run. Its only monitors were the launch tails, which expire after
  30 minutes. The checker's liveness `DIRECT` was right: the question held two runs, not the four
  already live.
