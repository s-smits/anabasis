---
name: launch-run
description: "Start an authorised Anabasis v2 campaign through its one command, which asks the log before each move whether the move can report anything, or stop a named run and release what it held. Use when the operator asks to start, launch, resume or stop a campaign or a run, to check whether a campaign is ready for its next move, or why a move was refused. Owns the start and the stop; run-improvement-campaign reads the table, and whole-run-investigation reads what a run did."
---

# Start and stop a campaign

One command prepares the exam and opens one live Builder conversation
(`tools/d2/harness-builder.ts`). The Builder edits the harness and calls campaign tools for the
Examiner, practice release, comparison and promotion. The decision table supplies public advice;
the commands keep their admissions, budget and privacy checks. That is a campaign that opens now.
`--no-builder-led` opens one whose every move the host makes as the table names it, a Builder
session among them; the opening keeps the term either way, so a later command of the campaign
need not name it, and a campaign opened before the term runs by the host. A start request
authorises that command once; it does not authorise a second run beside it.

Until 11 October a launcher (`bun run runs launch`) read the log and the host and then started
one round, one checkpoint, one session or one Examiner session. Every refusal it held is asked by
the command of the move itself before its first event (`src/builder/admission.ts`), the campaign
command waits for the host's load before a move that solves, and the launcher went
(`docs/simplify.md`, D2). What follows is what replaced it.

## Start

Run the command in the worktree whose source should run, niced, in a process group of its own,
with its output in two files, and the key in Bun's own `--env-file`:

```sh
cd <the worktree>
set -m
nice -n 19 bun --env-file=<file> tools/d2/harness-builder.ts \
  --name <name> --project <project> <the pack's four flags, or --prompt-file <file> --solver <model>> \
  --budget <dollars> --builder <model> --examiner <model> --reviewer <model> \
  [--solve-model-turns N] [--minutes N] [--turns N] [--level 0.1 --trigger 0.25] [--attended] \
  > <dir>/launch.out 2> <dir>/launch.err &
```

Its flags are the command's own, listed at the head of `tools/d2/harness-builder.ts`. What it
runs by is recorded once (`campaign.opened`), its project among it, which a campaign is not opened
without and keeps, so the command run again by the campaign's name
alone goes on from the log with the same terms, and one that names another term records it
again. A flag that names another setting than the campaign's record is refused with both: the
setting does not change, and another setting is another campaign (`tools/d2/setting.ts`).

`--dry-run` prints the next move and makes none: it answers "is this campaign ready for its next
move, and which is it?". `--moves N` makes at most that many. A campaign runs unattended: it
freezes an exam whose reading holds no fault and promotes the harness the rule names without
waiting when the Builder requests an eligible promotion. `--attended` makes both wait for the
operator's word, and the campaign keeps it until `--no-attended`; add it only when the operator
asks. `--sessions` now shapes comparison advice only. `--minutes` covers the whole live
conversation, including its nested tools: a wall that falls inside a comparison or an Examiner
session is read where that action ends, and a conversation that ends at its limits is followed by
a new one on the Builder's notes, so the command goes on to a typed ending. `finish` ends the
conversation and this run of the command; it does not compare or promote the harness, and the
same command run again goes on with a new conversation.

Three things about the shell line:

- **The env file is Bun's to read.** `--env-file` is Bun's own flag, and nothing in the
  repository opens the file. Do not print it, copy it or search for another. Which account
  spends is named by the model's provider and is the operator's: `claude/<model>` runs Claude
  Code on the login in `CLAUDE_CODE_OAUTH_TOKEN`, and `claude-api/<model>` runs the same CLI on
  the key in `ANTHROPIC_API_KEY`. They are two providers, so a solver on one is another setting
  than a solver on the other.
- **Its own process group.** `bun run runs stop` signals a process group, and only one that a
  process writing the log leads: a campaign started in the shell's own group is not stopped by
  it. An interactive shell gives a background job a group of its own; a bash or zsh script does
  the same with `set -m` before the `&` (dash refuses `set -m` without a terminal: use bash).
- **One or two campaigns at a time on one host.** A solve's wall counts the clock, and a loaded
  host moves every solve's time. The command waits before a move that solves until the host's
  one-minute load is at or under its cores, and says so once; `--loaded` starts the move all the
  same, which is the operator's word that its times will not be compared.

The command keeps a receipt beside the log, `launch-run-<n>.json` (`tools/runs/receipt.ts`):
its flags, the commit and whether the tree had uncommitted changes, the load and cores it started
under. The log holds the host's code by content and no commit, so the receipt is where the commit
is on record, and `bun run runs zip` carries it at every level.

## What is refused, and where

Every refusal is the move's own command's, asked before its first event, so a command started by
hand is refused where the campaign command would be refused. A rehearsal is exempt by name: its
seats are scripts, which are paid nothing.

A comparison (`tools/d2/checkpoint.ts`, `tools/d2/round.ts`) is refused by its admission
(`admitComparison`, `src/builder/admission.ts`) on:

- **No held-out task.** `prepare.ts` has not run on this log.
- **A checker nobody has read.** `accept.ts` has not run on this log. In the first live rounds the
  reading was made after the solves, by hand, and on truss 22 of 32 solves had by then been
  rejected, 14 on one check.
- **Too few tasks to read a step.** At `--trigger 0.25` a first reading takes two untied tasks,
  all won. A comparison of fewer scored tasks is refused, and so is one the campaign's own tie
  share leaves too few untied. The Builder receives advice to ask the Examiner for more.
- **No dollar cap.** The campaign command passes each move what is left of its total; a command
  started by hand names `--cap`. No solve starts that a reserve for it and for each one running
  (`--reserve`) would take past the cap, and a comparison the cap cuts short reads `not-scored`.
- **A campaign the stop rule has stopped.** `--past-stop "<why>"` goes on all the same, and the
  reason is logged (`stop.overridden`).

A comparison that began goes on from its log under its id, unasked, with the terms it began with.
One that reported is finished: run again it says what it said and ends.

A Builder session (`tools/d2/session.ts`) is refused by its own admission (`admitSession`) on a
cap it has none of, a checker nobody has read and the stop rule, and under a `--session` whose
Builder started and did not end whole (`spent`, `src/builder/session.ts`): a second session under
one id would be a second try. An Examiner session (`tools/d1b/examine.ts`) solves nothing and needs
the campaign's log and no set in it; it is refused under a `--session` the log already holds. The
campaign command takes the next free id for each.

What the launcher alone used to refuse, and nothing asks since: a second process writing the
same log in this worktree, and a flag the move's command would refuse at its first line. Read
`bun run runs pulse` before a start, and `--dry-run` for the flags.

## What comes before a comparison

A comparison reads sets that earlier moves put in the campaign's log (`tools/d2/campaign.ts`
lists them). The host prepares the exam before the conversation; later the Builder chooses
when to request task writing or practice release, and in a host-run campaign the table does. By hand they are:

| the log needs | from |
| --- | --- |
| a checker that has been read, with no fault left in its last reading, or frozen by the operator over its faults | `bun tools/c/accept.ts ... --name <name> [--admit <checks>] [--freeze]` |
| the pack's tasks held out, and the practice tasks released | `bun tools/d2/prepare.ts ... --name <name>` |
| further held-out tasks, where the pack's are too few | `bun tools/d1b/examine.ts ... --name <name> --session x-1` |

The reading puts every control to the checks twice, and the do-nothing answer, the smallest the
answer format allows, to every task: a task on which that answer is not rejected is a fault. A
check its author's own computation decides, with no installed instrument, is a fault too, until
`--admit` names it, which is the operator's word for that check.

Name `--predict "<a sentence>"` on a checkpoint or a round started by hand to put on record what
you expect it to read. It is written with the comparison's terms before its first solve, decides
nothing, and is printed beside the reading when the comparison ends.

## Watch, and read what comes next

```sh
bun run runs pulse [<name>]
bun run runs view <name> [--level N] [--trigger N] [--target N] [--practice N] [--past-stop "<why>"]
```

The pulse says what each run gained since the last look. The first sign of model work is a
session's first `build.started` or `exam.started`, and a checkpoint's first `solve.started`; "the
process is gone before `comparison.reported`" is a run to read in its `.err`.

The view prints the campaign as its log reads: the set-up, what each Examiner session, Builder
session and comparison handed over, and the climb. Its last line is the one move the table names
for this log (`decide`, `src/builder/decide.ts`), asked with the five flags above and, for those
it does not name, the terms the campaign's opening keeps: advice the Builder receives. The
Builder may choose a different admitted action. The view starts nothing.

## Stop a run

```sh
bun run runs stop <name> ... [--yes]
```

Without `--yes` it prints the process that writes each named run's log and how many it started,
and ends nothing. With it, that process is ended first and then each one it started. A name is
matched whole, and no process group is signalled unless one of those processes leads it: a round
started by hand can share its group with a sibling.

A stop also releases what the run held on the host: the capped root, a disk image on macOS, of
each solve, Builder session and Examiner session its log started and never finished. Only the
ended process would have let those go. A named run that is not running is released the same way,
so a run that was killed or that crashed is cleaned up by stopping it. Without `--yes` the roots
are counted and left.

A stop is abrupt: the run writes no ending, and its log is as it was. What the stop cost depends
on where it fell, and the command says which.

- **A campaign** goes on from its log under the same `--name`, and the session the stop fell
  inside has spent its id: the next takes another, and pays for that seat again. A word left
  with `tools/d2/word.ts --stop "<why>"` ends a campaign at its next move boundary and spends
  none, so prefer the word where a move's end can be waited for.
- **A checkpoint, or a round after its `build.finished`**, started by hand: run again under the
  same id, the comparison goes on from its log with the tasks and the terms it began with. A
  solve counted is not solved again, and its cap counts what was billed before the stop.
- **Inside a Builder session**, or **an Examiner session** wherever the stop fell: that session
  never finished, so its id is spent. The tasks an Examiner session had held out by then stay
  held out.

Whether a run should be stopped at all is a reading (whole-run-investigation); this command only
carries out an authorised one, and a stop does not authorise a replacement. After a stop, run
`bun run runs pulse --once <name>` and report it as stopped only when the run reads `closed`.

## Not here yet

- No timed stop. v1's launcher armed one through the service manager; a v2 session ends by its
  own limits (`--minutes`, `--turns`), and a campaign by its budget and its patience.
- No probe turn before spend: a session or usage limit shows at the first turn, in the pulse. A
  session whose own turn the provider fails ends `crashed` with the provider's words. A
  comparison stops once the provider has written nothing for the solves of three tasks in a
  row, writes no report, and goes on from its log when the campaign is run again: wait for the
  reset the provider names, or pass another `--env-file`.
