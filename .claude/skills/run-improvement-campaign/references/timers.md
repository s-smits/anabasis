# The loop's timers

[The Timers section](../SKILL.md#timers) owns the firing protocol and the active set of timers. This reference specifies what a session needs when arming, retiming, or retiring a timer: the responsibility map for each timer, the required contents of a timer prompt, and the diagnostic readings that determine whether a timer remains justified.

## Each timer's map

A timer is retained only while every column of its map can be filled in concretely, and is retired at the firing specified in the final column.

| Timer | Owner | Fact it reads | Decision it changes | Evidence it stays on | Retired when |
| --- | --- | --- | --- | --- | --- |
| driver | the session running the cycle | `wri2p2.ts due`; `runs active` against the live cap; the queue's first ready entry | which single step to execute now, or none | a step taken that no event had already announced | `timers.ts` shows it quiet in three of four firings over two days: lengthen its interval, or move its trigger into `due` |
| chain | the firing that scheduled it | `wri2p2.ts due` again | executes the next step ten minutes after the previous one | `due` listed a step this session can take | `due` lists no actionable step; it schedules no successor |
| milestone | the prediction naming the deadline | a single deadline not marked by a log event (log events are awaited via `until.ts`, which is not a timer) | resolves that prediction row's outcome | the prediction's own row | after it fires once |
| open decisions | the session running the cycle | open decisions in `cycle.md` and `plan.md` | resolves a routine ambiguity, or escalates a row to the operator | a recorded decision stating what evidence would overturn it | two consecutive firings record nothing new |
| morning read | the session running the cycle | nightly local job outcomes and exit codes, host disk usage, and stack status relative to `main` | logs a backlog finding, or escalates a row to the operator | a failure detected that no alert line had announced | a local job emits these checks as lines read by the driver |
| handover | the operator's agreed handover time | the five points, stack state, and loop diagnostics ([cycle-ledger.md](cycle-ledger.md)) | determines what the next session or operator takes up | the handover section in `cycle.md` | after it fires once |

No timer polls a run's log on a fixed schedule: the pulse and `runs alerts` report campaign events as they land, without invoking a model. Whenever a firing performs deterministic checks that a script could handle (such as counting live runs, verifying that a watcher is running, or checking for a marker file), move that check into `due`, a `bun run runs` subcommand, or a local job so the firing reads a single summary line.

## What a prompt carries

A timer firing may execute after context compaction, in a session that retains no prior memory of the cycle. Its prompt therefore carries five items, in this order:

1. the timer's name, its creation date, and the date on which a recurring timer should be recreated with the same prompt and its old identifier deleted (within seven days);
2. the cycle directory and the worktree from which commands must be run, as absolute paths;
3. the operator's authority in their own words with its date, together with the cycle's standing constraints (the cap on live runs, and any actions that must never be launched, continued, moved, paused, or merged without explicit authorisation);
4. the single command to run first, followed by "follow the firing protocol of run-improvement-campaign's Timers";
5. the behaviour when nothing is due: emit one summary line, record no ledger row, and make no timer changes.

A prompt states each constraint once and omits steps already ordered by the skill. Every firing must be idempotent: it re-reads `due` instead of trusting what a previous firing wrote, executes a step only if `next` still prints it, and writes a prediction file before running any `--yes` command.

## Reading the timers

```sh
bun .claude/skills/run-improvement-campaign/scripts/timers.ts <transcript.jsonl | folder> ... [--since <ISO time>]
```

The script prints one summary line per timer (id, schedule, total firings, active firings, and quiet firings), followed by totals for recurring and one-shot timers. The active-versus-quiet split is estimated from each firing's tool calls. A recurring timer whose firings are predominantly quiet is polling a deterministic condition; move that condition into `due` or a local job, or retire the timer. Evaluate the output with three questions: which recurring timer is mostly quiet and what condition was it polling? Which action did a firing perform that an event had already announced, indicating two owners reading one fact? Which step in `cycle.md` waited for a late firing, and what event would have announced it earlier?
