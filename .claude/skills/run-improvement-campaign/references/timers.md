# The loop's timers

[The Timers section](../SKILL.md#timers) owns the firing protocol and the set. This file holds what
a session needs when it arms, retimes or retires one: each timer's map, what a prompt carries, and
the readings that decide whether a timer stays.

## Each timer's map

A timer is kept only while its map can be filled in, and is retired at the firing its last column
names.

| Timer | Owner | Fact it reads | Decision it changes | Evidence it stays on | Retired when |
| --- | --- | --- | --- | --- | --- |
| driver | the session that runs the cycle | `wri2p2.ts due`; `runs active` against the cap; the queue's first ready entry | which one step is taken now, or none | a step taken that no event had announced | `timers.ts` shows it quiet in three firings of four over two days: lengthen it, or move what it found into `due` |
| chain | the firing that set it | `wri2p2.ts due` again | the next step, ten minutes after the last | `due` listed a step this session can take | `due` lists none; it sets no successor |
| milestone | the prediction that names the event | one event in one log, or one deadline | that row's outcome | the prediction's own row | it fires once |
| open decisions | the session that runs the cycle | the open decisions of `cycle.md` and the plan | a routine doubt decided, or a row put to the operator | a decision written with what would overturn it | two firings in a row write nothing new |
| morning read | the session that runs the cycle | the nightly local jobs' outcome and last exit, the hosts' disks, the stack against `main` | a finding in the backlog, or a row for the operator | a failure found that no line had announced | a local job writes these as lines the driver reads |
| handover | the operator's agreed time | the five points, the stack, the loop's own measures ([cycle-ledger.md](cycle-ledger.md)) | what the next session or the operator takes up | the handover section in `cycle.md` | it fires once |

No row reads a run's log on a schedule: the pulse and `runs alerts` report a run's events as they
land, with no model. Where a firing finds itself doing what a command could (counting live runs,
checking that a watcher still runs, looking for a marker), that check belongs in `due`, a verb of
`bun run runs` or a local job, and the firing reads its one line.

## What a prompt carries

A firing may arrive after compaction, in a session that remembers nothing of the cycle. Its prompt
therefore holds, in this order:

1. the timer's name, the day it was created and the day on which a recurring one is created again
   with the same prompt and its old id deleted (within seven days);
2. the cycle folder and the worktree to run commands from, as absolute paths;
3. the authority in the operator's words with their date, and the standing limits the cycle records
   (the cap on live runs, and what is never launched, continued, moved, paused or merged without a
   word);
4. the one command to read first, and "follow the firing protocol of run-improvement-campaign's
   Timers";
5. what a firing that finds nothing does: one line, no row, no timer change.

A prompt states a limit once and names no step the skill already orders. A firing is safe to run
twice: it reads `due` again instead of trusting what the last firing wrote, takes a step only where
`next` still prints it, and writes a prediction file before any `--yes`.

## Reading the timers

```sh
bun .claude/skills/run-improvement-campaign/scripts/timers.ts <transcript.jsonl | folder> ... [--since <ISO time>]
```

It prints one line a timer (id, schedule, firings, changed, quiet) and the totals for recurring and
one-shot timers. The split is read from each firing's tool calls and is an estimate. A recurring
timer whose firings are mostly quiet reads a condition: move the condition into `due` or a local
job, or retire the timer. Read the output with three questions. Which recurring timer is mostly quiet, and what condition was it polling? Which
change did a firing make that an event had already announced, so that two owners read one fact?
Which step in `cycle.md` waited for a firing that came late, and what would have announced it?
