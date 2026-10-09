---
name: launch-run
description: "Launch an authorised Anabasis v2 round, checkpoint, Builder session or Examiner session through one command that first reads whether it can start and what it can report, or stop a named run. Use when the operator asks to launch, start, relaunch or stop a round, a checkpoint, an Examiner session or a run, to check whether a campaign is ready for one, or why a launch was refused. Owns the preflight, the start and the stop; whole-run-investigation reads what a run did."
---

# Launch a round

One command reads the campaign and the host, and starts the run only when it can say something.
A launch request authorises the command; it does not authorise a second run beside it.

```sh
bun run runs launch [--env-file <file>] [--loaded] [--dry-run] <the flags of tools/d2/round.ts>
bun run runs launch [--env-file <file>] [--loaded] [--dry-run] <the flags of tools/d2/checkpoint.ts>
bun run runs launch [--env-file <file>] [--loaded] [--dry-run] --no-comparison <the flags of tools/d2/session.ts>
```

Run it in the worktree whose source should run. Every flag but its own four goes to the command
unchanged, so `tools/d2/round.ts` stays the one owner of a comparison's flags and defaults. Flags
that hold `--id` are a checkpoint's: one comparison of two harnesses the campaign keeps, with no
Builder session. Flags that hold `--examiner` are an Examiner session's and go to
`tools/d1b/examine.ts`: see "An Examiner session" below.

With `--no-comparison` the flags are a Builder session's by itself (`tools/d2/session.ts`): a
round's session with no comparison after it. The plan's checkpoint is several sessions and then
one comparison (`docs/plan.md`, Phase 5), which is launched as that many sessions and then a
checkpoint with `--new latest`:

```sh
bun run runs launch --no-comparison <pack flags> --name <name> --session b-2 --builder <model> --cap 150
bun run runs launch --no-comparison <pack flags> --name <name> --session b-3 --builder <model> --cap 150
bun run runs launch <pack flags> --name <name> --id g2 --cap 375
```

A session takes a round's flags without those of a comparison, and needs its own `--cap`: no
practice solve starts that a reserve for it would take past the cap, and the Builder is told how
many solves are left, never a sum. It is refused on a checker nobody has read and after the stop
rule, as a comparison is, and it needs no held-out task, since it scores nothing. A session that
ended is finished: the next takes another `--session`.

The plan's first experiment is its first round (`docs/plan.md`, Phase 0). The Builder forks the
Starter Built Harness and builds on it, and the harness it leaves is compared with the starter on
eight tasks the operator names, read at the full limit and at budgets fixed beforehand. A round
starts from the starter and compares with it by default (`--parent latest`, `--reference
promoted`), so the round needs neither flag. `promoted` is the campaign's reference harness: the
starter until the operator promotes another with `tools/d2/promote.ts --harness <digest> --yes`,
which is logged, and that harness for every comparison after.

```sh
bun run runs launch <pack flags> --name <name> --session b-1 --builder <model> \
  --tasks <eight task ids> --cap 625 --budget turns=40 --budget turns=20
```

A budget names the model's `turns` or the attempt's `seconds`, or both: the two a solver can be
told and held to. A budget in `prompts` or `cpu` is refused. Every finished solve of the first
three rounds on 9 October was given one prompt, so that unit read what the full limit read, and
`--solve-turns`, which caps prompts, bound nothing. The CPU seconds of a solve's commands are
unknown once one of them is cut, so a budget in them left tasks unread. To hold a solve
to a number of the model's own turns, and tell the solver so, name `--solve-model-turns` once: a
solve that uses them all without an answer ends `turns-ended`, and every tool result says which
turn the solver is in. Without the flag the turns are not limited,
and a budget in `turns` is read after the fact of a solver that was told only its time. CPU is
still measured and reported for every solve, as a figure and no unit; the investigation's reader
counts the solves whose CPU a cut command left unmeasured (`CPU UNMEASURED`). The report holds each harness by itself at the full limit
and at each budget, as the tasks by how many of their solves were valid, and the command prints
it. For the first round the reference harness is the starter, so that line is what gate G0 reads:
the plan continues at the budget where the starter is valid on about half its solves.

## What comes before a comparison

A comparison reads sets that earlier commands put in the campaign's log (`tools/d2/campaign.ts`
lists them). The launcher refuses one whose sets are not there, and names the command that is
missing.

| the log needs | from |
| --- | --- |
| a checker that has been read, and that the operator has said stands | `bun tools/c/accept.ts ... --name <name> [--admit <checks>] --freeze` |
| the pack's tasks held out, and the practice tasks released | `bun tools/d2/prepare.ts ... --name <name>` |
| the tasks named to score, each confirmed against today's verifier | `bun tools/d2/prepare.ts ... --name <name> --tasks <task ids>` |
| further held-out tasks, where the pack's are too few | `bun tools/d1b/examine.ts ... --name <name> --session x-1` |

The reading puts every control to the checks twice, and the do-nothing answer, the smallest the
answer format allows, to every task: a task on which that answer is not rejected is a fault. A
check its author's own computation decides, with no installed instrument, is a fault too, until
`--admit` names it, which is the operator's word for that check. A comparison is refused while the
log holds no reading at all. One whose last reading holds faults and is not frozen starts, and the
launcher says so.

Name `--predict "<a sentence>"` on a round or a checkpoint to put on record what you expect it to
read. It is written with the comparison's terms before its first solve, decides nothing, and is
printed beside the reading when the comparison ends. A comparison gone on from its log keeps the
prediction it began with.

A task meets one gate, the shape of its package, and is a held-out task from then on. No stronger
solver, no screening and no anchor stands between a task and a comparison. So a task named to
score is first confirmed: `prepare.ts --tasks` says of each whether an answer the stored sweep
accepted still passes today's verifier, and exits 1 unless every one does. A rejection of a task
that fails this says nothing of the answer.

## What it refuses, and why

Most are refusals the 2026-10-08 truss rounds would have met. Eight rounds read `no-step` for over
$220, and none could have read anything else.

The first five below, and the stop rule, are the comparison's own admission
(`src/builder/admission.ts`). The launcher asks it before it spawns, and the round or the checkpoint
asks it again before its first event, so a command started by hand is refused the same way. A
rehearsal is exempt from them: its seats are scripts, which are paid nothing.

- **No held-out task.** `prepare.ts` has not run on this log.
- **A checker nobody has read.** `accept.ts` has not run on this log. In the first live rounds the
  reading was made after the solves, by hand, and on truss 22 of 32 solves had by then been
  rejected, 14 on one check.
- **Too few tasks to read a step.** At `--level 0.1` a step takes four untied tasks, all won. A
  comparison of fewer scored tasks is refused, and so is one the campaign's own tie share leaves
  too few untied: the share is that of the last tallied comparison made under the same solver
  and limits, and before any such comparison every scored task is counted. Run an Examiner
  session for more tasks, or change the budget so that fewer tie.
- **No dollar cap.** `--cap` is required: the billed dollars the comparison may hold. No solve
  starts that a reserve for it and for each one running (`--reserve`, $10) would take past the
  cap, and a comparison the cap cuts short reads `not-scored` and is finished. The plan proposes
  each phase's upper estimate plus a quarter. A note says when the cap holds a reserve for fewer
  solves than the comparison's test makes.
- **A campaign the stop rule has stopped.** Three checkpoints have passed without a step, which is
  where the plan stops a campaign. `--past-stop "<why>"` goes on all the same, and the reason is
  logged under the comparison's id (`stop.overridden`). Each further launch needs its own.
- **An id that has reported.** A comparison that reported is finished, and run again it only
  says what it said. Pass another `--session` or `--id`.
- **Already running.** A process in this worktree is writing this campaign's log.
- **A loaded host.** The one-minute load is over the core count. A run started into it slows
  every other, and reaches limits an idle host would not: on that day a practice solve took 12
  minutes of a Builder's 30. `--loaded` starts it anyway, for a run whose times will not be
  compared, and the receipt keeps the load.
- **An env file that is not there.** `--env-file` is Bun's own flag. The launcher passes the path
  on and never opens the file. Do not print it, copy it or search for another.
- **A spent session id.** A `--session` whose Builder started and did not end whole: it never
  finished, was killed or crashed. The round refuses it (`spent` in `src/builder/round.ts`), since
  a second session under one id would be a second try, and the launcher says so in the round's
  words before anything starts. Pass another `--session`. A checkpoint runs no session and has
  no id to spend.

`--dry-run` prints the preflight and the command, and starts nothing. Use it to answer "is this
campaign ready for a comparison?".

The preflight's notes say what a comparison of this size can show before it is paid for
(`src/kernel/size.ts`): the smallest results that clear its level, the chance of a step in the
plan's worked case with its ties counted, and the best case were no task to tie. They also say
when held-out tasks wait for a person's label and are not scored (`prepare.ts --keep`,
`--infeasible`), and when the solver or the limits named are not the ones the log's last solves
ran under, since what the earlier comparisons measured was then another setting's.

## The campaign's setting

Who solves, what a solve is held to and which tasks are scored are the campaign's, and its log
records them once (`tools/d2/setting.ts`): `--solver`, `--solver-effort`, `--solve-minutes`,
`--solve-turns`, `--solve-model-turns`, and `--tasks` or `--target`. The first comparison of a
campaign records what it names, with the stored cycle's own solver, the sweep's limits and twelve
tasks by the draw for the rest. After that, name none of them: a command runs under the record.
One that names another is refused, by the launcher and by the command, and says both. To change
the setting, as when the budget is set anew, pass `--new-setting` with what the campaign runs
under from then on. Nothing is carried over from the old record, and no tally on record speaks
for the new one.

A campaign that ran before 9 October holds solves and no record. Its setting is the one its last
test-side solves ran under, and the first command of this source there has to name it once: a
launch or a command that names another is refused, and the refusal gives the flags to type.
Recode's solver was held to 15 of its own turns, so its first command names
`--solve-model-turns 15` beside its solver and its wall, or says `--new-setting`.

A comparison that can start may still be read only after a person has labelled its rejections.
With no `--reviewer`, every rejected answer sets its task aside until `tools/d2/settle.ts` has
labels for it; with one, the Referee's ruling of a true fail counts. Say which was meant before
spend. What a comparison of a given shape reads is a free question: rehearse it on a seed first
(system-path-simulation).

## An Examiner session

```sh
bun run runs launch [--env-file <file>] [--loaded] [--dry-run] <the flags of tools/d1b/examine.ts>
```

It needs the campaign's log and no set in it: what it writes is held out beside what is there.
It is refused on a loaded host, beside another writer of the same log, for a missing env file, and
under a `--session` the log already holds: an Examiner session's id names one session, and its
tasks carry it.

A session makes no solve, so it takes no solver, no limits of a solve and no reviewer, and costs
the Examiner's own turns: $2.01 of the $48.45 the second live session spent when it still paid
for a stronger solver. At its opening it is told one outcome of every task the campaign holds:
one harness won, a tie between valid answers, no valid answer yet, or disputed. It is told no
count, no budget and no target.

A session ended by its provider reads `crashed` in `exam.finished`, with what the provider said.

## What a launch leaves

The round runs niced, in a process group of its own, and outlives the command and the session that
ran it. Beside the campaign's log:

- `launch-<session>.json`: the round's flags, the commit and whether the tree had uncommitted
  changes, the load and cores it started under, its pid.
- `launch-<session>.out` and `.err`: the round's report as it prints it, and whatever it wrote
  before it died.

Starting proves the process stayed up for eight seconds. It proves no model turn and no outcome.
Watch with `bun run runs pulse <name>`. The first sign of model work is a round's first
`build.started`, and for a checkpoint, which runs no session, its first `solve.started`. "The
process is gone before comparison.reported" is a run to read in its `.err`. For an Examiner
session the same line names `exam.finished`.

`bun run runs zip` carries the receipts and outputs at every level.

## Stop a run

```sh
bun run runs stop <name> ... [--yes]
```

Without `--yes` it prints the process that writes each named run's log and how many it started,
and ends nothing. With it, that process is ended first and then each one it started. A name is
matched whole, and no process group is signalled unless one of those processes leads it: a round
started by hand can share its group with a sibling round.

A stop also releases what the run held on the host: the capped root, a disk image on macOS, of each
solve and Builder session its log started and never finished. Only the ended process would have let
those go. A named run that is not running is released the same way, so a run that was killed or that
crashed is cleaned up by stopping it. Without `--yes` the roots are counted and left.

A stop is abrupt: the run writes no ending, and its log is as it was. What the stop cost depends
on where it fell, and the command says which.

- **After the Builder session finished**, or in a checkpoint: launched again under the same id,
  the comparison goes on from its log with the tasks and the terms it began with. A solve counted
  is not solved again, and its cap counts what was billed before the stop.
- **Inside the Builder session**: that session never finished, so its id is spent. The next launch
  needs another `--session` and pays for a Builder again.
- **An Examiner session**, wherever the stop fell: its id is spent. The tasks it had held out by
  then stay held out.

So when there is a choice, stop a round after its `build.finished`. Whether a run should be stopped
at all is a reading (whole-run-investigation); this command only carries out an authorised one, and
a stop does not authorise a replacement.

After a stop, run `bun run runs pulse --once <name>` and report it as stopped only when the run
reads `closed`.

## Not here yet

- Live solves start from their own command, with no preflight.
- No timed stop. v1's launcher armed one through the service manager; a v2 round ends by its own
  limits (`--minutes`, `--turns`).
- No probe turn before spend: a session or usage limit shows at the first turn, in the pulse.
  What it costs is bounded. A session whose own turn the provider fails ends `crashed` with the
  provider's words. A comparison stops once the provider has written nothing for the solves of
  three tasks in a row, writes no report, and goes on from its log when launched again under the
  same id: wait for the reset the provider names, or pass another `--env-file`.
- One round a command. A model pair is two commands, and what makes two rounds a comparison is
  model-condition-comparison's to say.
