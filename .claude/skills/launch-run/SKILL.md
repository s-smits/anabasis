---
name: launch-run
description: "Launch an authorised Anabasis v2 round through one command that first reads whether the round can report anything, or stop a named run. Use when the operator asks to launch, start, relaunch or stop a round or a run, to check whether a campaign is ready for one, or why a launch was refused. Owns the preflight, the start and the stop; whole-run-investigation reads what a run did."
---

# Launch a round

One command reads the campaign and the host, and starts the round only when it can say something.
A launch request authorises the command; it does not authorise a second round beside it.

```sh
bun run runs launch [--env-file <file>] [--loaded] [--dry-run] <the flags of tools/d2/round.ts>
```

Run it in the worktree whose source should run. Every flag but its own three goes to `round.ts`
unchanged, so `tools/d2/round.ts` stays the one owner of a round's flags and defaults.

## What comes before a round

A round reads sets that four earlier commands put in the campaign's log (`tools/d2/campaign.ts`
lists them). The launcher refuses a round whose sets are not there, and names the command that is
missing.

| the log needs | from |
| --- | --- |
| a checker the operator has said stands | `bun tools/c/accept.ts ... --name <name> --freeze` |
| the pack's tasks through gates 1 to 4 | `bun tools/m1/admit-sweep.ts ... --log <log> --feasible` |
| tasks held outside the anchor, to screen | `bun tools/d1b/examine.ts ... --name <name> --session x-1` |
| the anchor's draw and the practice releases | `bun tools/d2/prepare.ts ... --name <name>` |

## What it refuses, and why

Most are refusals the 2026-10-08 truss rounds would have met. Eight rounds read `no-step` for over
$220, and none could have read anything else.

- **Nothing to screen.** A scoring round with no task held outside the anchor leaves its scored set
  empty, and a step rests on the scored set alone. The pack gave 25 task versions: 14 stopped at
  gate 2 as too hard, 6 at gate 4 for too few controls, 4 became the anchor and 1 was released.
  Run an Examiner session first.
- **No feasible task, or no anchor.** `admit-sweep.ts` or `prepare.ts` has not run on this log.
- **Already running.** A process in this worktree is writing this round's log.
- **A loaded host.** The one-minute load is over the core count. A round started into it slows
  every other, and reaches walls an idle host would not: on that day a practice solve took 12
  minutes of a Builder's 30. `--loaded` starts it anyway, for a round whose times will not be
  compared, and the receipt keeps the load.
- **An env file that is not there.** `--env-file` is Bun's own flag. The launcher passes the path
  on and never opens the file. Do not print it, copy it or search for another.
- **A spent session id.** A `--session` whose Builder started and did not end whole: it never
  finished, was killed or crashed. The round refuses it (`spent` in `src/builder/round.ts`), since
  a second session under one id would be a second try, and the launcher says so in the round's
  words before anything starts. Pass another `--session`.

`--target 0` is let through with a line saying what it is: a round that scores no task, reads its
anchor alone and cannot read `step`. Use it to prove plumbing and say so wherever its reading is
repeated. The round's report holds its target, so a later reader can tell.

`--dry-run` prints the preflight and the command, and starts nothing. Use it to answer "is this
campaign ready for a round?".

## What a launch leaves

The round runs niced, in a process group of its own, and outlives the command and the session that
ran it. Beside the campaign's log:

- `launch-<session>.json`: the round's flags, the commit and whether the tree had uncommitted
  changes, the load and cores it started under, its pid.
- `launch-<session>.out` and `.err`: the round's report as it prints it, and whatever it wrote
  before it died.

Starting proves the process stayed up for eight seconds. It proves no model turn and no outcome.
Watch with `bun run runs pulse <name>`: its first `build.started` is the first sign of model work,
and "the process is gone before comparison.reported" is a round to read in its `.err`.

`bun run runs zip` carries the receipts and outputs at every level.

## Stop a run

```sh
bun run runs stop <name> ... [--yes]
```

Without `--yes` it prints the process that writes each named run's log and how many it started,
and ends nothing. With it, that process is ended first and then each one it started. A name is
matched whole, and no process group is signalled unless one of those processes leads it: a round
started by hand can share its group with a sibling round.

A stop is abrupt: the round writes no ending, and its log is as it was. What the stop cost depends
on where it fell, and the command says which.

- **After the Builder session finished**, in the screening or the scoring solves: launched again
  with the same `--session`, the round goes on from its log. A solve counted is not solved again.
- **Inside the Builder session**: that session never finished, so its id is spent. The next launch
  needs another `--session` and pays for a Builder again.

So when there is a choice, stop a round after its `build.finished`. Whether a run should be stopped
at all is a reading (whole-run-investigation); this command only carries out an authorised one, and
a stop does not authorise a replacement.

After a stop, run `bun run runs pulse --once <name>` and report it as stopped only when the run
reads `closed`.

## Not here yet

- Examiner sessions and live solves start from their own commands, with no preflight. The pulse
  and `stop` do know a running Examiner session, and a round is refused while one writes its log.
- No timed stop. v1's launcher armed one through the service manager; a v2 round ends by its own
  limits (`--minutes`, `--turns`).
- No probe turn before spend: a session or usage limit shows at the first turn, in the pulse.
- One round a command. A model pair is two commands, and what makes two rounds a comparison is
  model-condition-comparison's to say.
