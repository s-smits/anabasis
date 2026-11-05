---
name: system-path-simulation
description: "Test an uncertain Anabasis path before a real run walks it, by one of three options: read the record (one fact, a replay of every log through this tree's readers, or a synthetic log built in memory), rehearse (the real commands on a seed with scripted seats and no Referee, or one value walked through its owning tests), or seat a model (one live Examiner session, round or Referee ruling from a seed, and rounds of paired live seats that tune a prompt or a term against one count). Any option can be run before and after a change, with the commit as the one variable. Use to test a join, revisit a recorded position, size a comparison, check what a kill or stop leaves, simulate an open stack's changes before it lands, or tune the Examiner's, the Referee's or the Builder's prompt or terms (cases/optimize.md). Not for reading a finished run (whole-run-investigation) or starting a paid campaign (run-management)."
---

# System path simulation

Use this when something has to work in the real system and no real actor has walked it yet: a
change crosses a join between two commands, a round is about to be sized, or a blocker is suspected
and unproven. Take the cheapest option that can decide the question, and stop there.

v2 makes this cheap for one reason. A campaign is its folder, `.ana/d2/<name>`, and its log is its
record. A seed copies that log at a cut, with the staged checks or drafted exam, the kept harnesses
and the Builder notes the cut still names (`seedCampaign`, `tools/runs/seed.ts`). A stored pack
still needs its pack and sweep on disk. Keep the source campaign available too: a drafted-exam
rehearsal reads its later tasks and answers from there (`draftedSource`, `tools/runs/rehearse.ts`).

## Three options

The options differ in what runs, and so in what each can say. Each one says something the cheaper
options cannot, and nothing the next one up needs to repeat.

| option | what runs | what it writes | it costs | it answers | it cannot say |
| --- | --- | --- | --- | --- | --- |
| **1. Read the record** | this tree's readers, over recorded events or events built in memory | nothing | seconds | what a log, a fold or a seat's message makes of a pattern, recorded or not | what a command does from the log's last line |
| **2. Rehearse** | the real commands, wall, roots, verifier and comparison, with every seat scripted and no Referee | a seed | minutes, no model | whether the commands join, and what a position of this size can read at all | what a model does |
| **3. Seat a model** | the real commands with a real model in one or more seats of a seed, the rest as the seed recorded it | a seed, and the bill | a session's or a solve's dollars | what a model does from a recorded position | a rate: one seat is one draw (rule 6 of `AGENTS.md`) |

A cheaper option that answers the question cancels every dearer one. Say which option you stopped
at, and why the next was not needed.

Two things sit across the options rather than beside them:

- **Before and after** runs any option twice, at the commit without a change and at the commit
  with it, so the commit is the one variable ([before-after](cases/before-after.md)). Tuning a
  prompt in rounds of paired live seats is before and after over option 3
  ([optimize](cases/optimize.md)).
- **The open stack** is the order of work for simulating a stack's changes before it lands, while
  its other fixes go on ([stack](cases/stack.md)). Each simulation in it is one of the three.

A real campaign is none of these: it is run-management's, then `bun run runs pulse`.

## Rules for every option

Readers accept campaign names across `ANA_HOSTS`: `live-seat.ts read --log <name> --from <event>`
refreshes a copy when the host environment is loaded, and `runs seed --from <name>` resolves and
fetches its source. A seat's records and process ids stay on the machine that seated it, so a seat
elsewhere is read, compared and stopped there: every script here takes `--host <name>` and runs on
that host at this tree's published commit, with a path under this home naming the same path under
the host's (`.claude/skills/main/cli.ts`), as in `bun --env-file=.env.runs
.claude/skills/system-path-simulation/scripts/live-seat.ts due --host <name> ~/sim-r11/arm`. Never
read a remote pid as local.

1. **Write the prediction first.** Before a simulation runs, write what it will read and why, in a
   file. Resolve each line after. A miss is the finding: the product does something you did not
   know, or your picture of it is stale. On 8 October 2026 one prediction missed because a round
   that scores nothing reads `not-scored`; another seed was cut before its only held task existed.
2. **Seed late, and from a real run.** A log a run wrote beats a position you would author. Cut
   right before the thing in question, from a log at rest, and say in one line how the seed differs
   from the nearest real position: "exam-1 cut before its second Examiner session, then prepared
   with two practice tasks where the campaign released one".
3. **Build a position with the campaign's own commands.** Every event has one writer. Never append
   a line by hand, edit one, or put a harness state into `states/`. For a position no run stood in,
   cut earlier and run the real command with other flags. Events built by hand stay in memory
   (option 1's synthetic log) and reach no folder.
4. **Write only to a seed.** `rehearse` and `scripts/live-seat.ts start` require `seed.json`.
   Production move commands have no such guard: use `sim-<what>` only for seeds.
5. **One variable.** Two rehearsals compare when one flag moved between them. Two commits compare
   on the same input, and the commit is then the variable. Rounds of tuning compare only within one
   series, whose outline (positions, seats, caps, task admission count, host class) no round moves
   ([optimize](cases/optimize.md), step 5).
6. **Change the position, never the prompt.** A live seat is seated by the production command with
   the production prompt, and nothing tells the model what the simulation hopes for. If a prompt is
   what you are testing, that edit is the one variable.
7. **Your script's faults are not the product's.** When a rehearsal strays, ask first whether the
   script could have held. Eight solves "scripted to pass" were rejected on the first rehearsal: the
   pack's accept controls were stale, which `tools/c/accept.ts` already said. That was the script's
   choice of answer. The meter refusing a model with no list price was the product's, and right.
8. **Say what you did not run.** A rehearsal that went as scripted proves the joins and nothing of a
   model. Name the seats that were scripted and the layers skipped wherever the result is repeated.
9. **A cleared condition lands in its owning test.** A simulation is how a broken join is found.
   The test in `test/` that fails without the fix is what keeps it found.
10. **Clean up.** A seed is listed by the pulse and read by `runs replay`. Move it to the Trash when
    its question is answered: `/usr/bin/trash .ana/d2/sim-<what>`. `bun run runs retire` deletes
    one left idle for a day, in a worktree or in the archive.

## 1. Read the record

Nothing runs but readers, and nothing is written. Read the log with the product's own readers
(`read`, `taskStates`, `taskSets`, `poolOf`, `stopRule`, `conditionsOf`), never with a parser of
your own, which agrees with the product until an event's shape moves and is then wrong in silence.

| case | the question | the command | read |
| --- | --- | --- | --- |
| One fact | what a log, a campaign or the host says now: the next move, the sets, supply, a run's state, what a solver would be shown | `harness-builder.ts --name <name> --dry-run`, `runs view`, `runs replay <name>`, `wri.ts read --log <log>`, `live-solve.ts` without `--live` | [one-fact](cases/one-fact.md) |
| Log replay | whether this tree still reads what real runs wrote, after a change to an event's shape, a fold or a reader | `bun run runs replay [<name> ...]` over every log in the repository's worktrees | [log-replay](cases/log-replay.md) |
| Synthetic log | whether a reader turns a pattern no log holds yet into the intended step: a threshold's edge, a promotion between readings, what a seat is told, the next move, a count changed in one place | `scripts/synthetic.ts <example or scenario> [--tree <worktree>]` | [synthetic](cases/synthetic.md) |

The log holds every tool call (`solve.call`, `build.call`, `exam.call`) with its arguments, every
verdict with its answer, every condition a solve ran under and every task a session wrote. It does
not hold the prompts: they are rendered from source, so what a model was shown is answered by the
tree at the commit its receipt names. Two commands look like readers and are not:
`tools/d2/prepare.ts` releases practice tasks for good, and `tools/c/accept.ts` appends its reading.
Run them on a seed.

A synthetic log proves what a reader does with the shapes you built. When a reading surprises you,
check the writer before the reader: a shape no writer produces can mislead.

## 2. Rehearse

The real commands on a seed, with scripted seats on pi's faux provider. It calls no model; its
duration depends on the solves and their limits.

```sh
bun run runs seed --from <campaign folder> --name sim-<what> [--before <session> | --events <n>]
bun run runs rehearse [<pack flags>] --name sim-<what> --session r-1 [--held old:new] [--starter pass|fail|none] [--supply N]
bun run runs rehearse --name sim-<what> --campaign [--held ...] [--starter ...] [--supply N]
```

`rehearse` dispatches to `roundCommand`, `sessionCommand` with `--no-comparison`,
`checkpointCommand` with `--id`, or `harnessBuilder` with `--campaign`
([rehearsal](cases/rehearsal.md) has each form, the kill and resume, and planting a condition for a
reader). Over a drafted exam the campaign's Examiner is scripted too; over a stored pack it has
none and ends when it needs one.

**The smallest rehearsal is a layer walk**: one value a change moves, followed from where it is
written to where it is last read through each layer's owning test, several of which run the real
writer against the real reader on the faux provider (`test/solve-run.test.ts` runs a whole solve
under the real wall). A join with no such test is the finding ([layer-walk](cases/layer-walk.md)).

### What it walks, and what it cannot say

It walks:

- the campaign opened over its stored pack or staged drafted exam, its sets read from the log;
- the Builder session from `--parent latest`, the starter until a session has left a harness: its
  tools on the command wall, its ordinary root, its freeze and digest;
- each solve: its deadline and root, the answer file and `submit`, the verifier on the staged check
  program, its verdict;
- the comparison: its terms written before its first solve, the reference harness (the last
  promoted or the starter), the new one solved afresh, the paired sign-flip test, each harness at
  its one solve budget (`valid`), the report and the stop rule;
- going on from the log after a kill or a `bun run runs stop`, which finds a rehearsal as it finds a
  round and releases what its solves held.

It skips, and so leaves unproven:

- every model, and the backends that reach one (the Claude Agent SDK, Codex, pi's providers);
- practice solves, since the Builder's script calls none;
- the Referee: `--builder`, `--solver` and `--reviewer` are refused, so a scripted `fail` is ruled
  by nobody and sets its task aside; `tools/d2/settle.ts` on the seed walks the rest;
- paid usage, and realistic pressure on time or turns: a `none` script gives no answer and can
  reach its turn limit;
- supply, checker-read, cap and stop-rule admission (`admitComparison`, `admitSession`). The
  comparison's own terms still hold, including held-out status and the exclusion of practice tasks.

A rehearsal is told from a paid round by three marks: `seed.json` beside its log, `(a seed)` in the
pulse, and `faux/script` as its Builder and solver wherever a reader names a model. The CLI has no
mixed mode with a live Builder and scripted solves: a real Builder is option 3's whole round.

### What scripts read as

`--held old:new` says how a solve of a held-out task ends under the reference harness and the new:
`pass`, a valid answer; `fail`, an answer a check rejects; or `none`, a solve that submits with no
answer. `--starter` says how a solve ends under the starter where it is neither side, as in the
control after a promotion; it adds no third arm.

The table uses four frontier tasks, two solves a side, `--level 0.10`, no retained tasks and answers
with no objective difference: the stand-in conditions of `test/round.test.ts`, not the command
defaults. `valid` lists task counts at zero, one and two valid solves (`Valid`,
`src/campaign/comparison.ts`). At the default level of 0.02 four wins read `no-step`; six untied
tasks, all won, are needed (`sweepOf`, `src/kernel/compare.ts`).

| script | reading | why |
| --- | --- | --- |
| `--held none:pass` (the default) | `step`, `valid.old` 4/0/0 and `valid.fresh` 0/0/4 | four wins give p 0.0625, below the explicit level of 0.10 |
| `--held pass:pass` | `no-step`, `valid` 0/0/4 twice | four ties between valid answers |
| `--held none:none` | `no-step`, `unsolved` 4 | no harness answers; after two comparisons each task waits for a label unless a valid answer is on record or its solves were cut by a deadline or context (`poolOf`) |
| `--held fail:pass` | `not-scored`, `aside` 4, `counted` 4-0 | no reviewer is seated, so each rejection sets its task aside until it is labelled |
| the same, then `settle.ts` with every label `earned` | `step` | the labels restore the tasks; a settling makes no solve |
| `--reference <a kept digest> --held none:pass` | `step`, sixteen solves | only the two compared harnesses are solved |
| fewer than six frontier tasks at `--level 0.02` | `no-step` at best; a paid start is refused | rehearsals bypass supply admission, but the test still needs six wins |
| a Builder whose edit does not land | `no-change` | the harness froze to its parent's digest |
| `--campaign --held none:pass --starter pass --supply 40` over a drafted-exam seed | repeated promotions where each comparison has enough frontier wins | the Examiner proposes the source's later tasks, then copies of its answered tasks; a single `step` promotes outside `--hitl` (`stepOf`, `decide`) |

`check-defects` is out of a rehearsal's reach but for a check that cannot run: it takes a Referee's
ruling to count one.

### What the first rehearsals settled

The rehearsals of 8 October 2026 found joins that still matter:

- **A step takes enough untied tasks, all won.** A campaign that holds fewer cannot read one, and
  the comparison's admission now refuses it.
- **A round reports; promotion is a separate move.** A hand-run round writes no `harness.promoted`.
  The campaign command promotes a single `step` outside `--hitl` (`AGENTS.md`, sections 3 and 7).
- **A hard kill is survived.** `kill -9` 13 seconds into a round left 8 solves started and 4
  finished. Run again with the same `--session`, it went on from its log and reported as scripted.
- **A kill left roots behind, and session ids collided across campaigns.** `bun run runs stop
  <name> --yes` releases roots left by unfinished solves and sessions (`leftOpen`, `releaseRoot`),
  and `sessionDirs` names a Builder's root by its campaign too.
- **Claude Code went on after its solve closed.** 14 of 35 solve records held a call after the one
  that ended the solve. A live probe traced it to an abort closing stdin while a turn was parked on
  `submit`; `close` now interrupts before aborting (`src/agent/backends/claude.ts`,
  `test/claude-backend.test.ts`).
- **The pulse read a seed as a paid run.** It now says `(a seed)`.
- **A reader caught a planted contradiction.** Two rehearsed rounds made one harness pass a task as
  the new side and fail it as the old, and `wri.ts read` said so unasked.

`test/runs-rehearse.test.ts` holds the seed and scripts, and `test/checker-commands.test.ts`
rehearses two sessions and a standalone comparison over a fixture pack where a command wall is
available. A pass on one platform proves only that platform's wall (`AGENTS.md`, section 9).

## 3. Seat a model

A real model in one or more seats, from a recorded position. It spends money, so it needs the
operator's word, which names the seats, the model, the effort and the login, and a size said before
it starts (run-management's sizing). `scripts/live-seat.ts start` seats the production command on
a seed, niced in a process group of its own on the login named, ends it at `--cap` dollars or
`--minutes`, and prints the reading when the group is gone; `read`, `watch`, `due`, `stop`,
`compare`, `pairs`, `calls` and `prompt` read and end what it seated ([live-seat](cases/live-seat.md)).

```sh
bun --env-file=<file> .claude/skills/system-path-simulation/scripts/live-seat.ts start \
  --tree <worktree> --name sim-<what> --out <scratch>/arm --cap <dollars> --minutes <n> --login N \
  -- <the production command and its flags, with the operator's model and effort>
```

| the seat | the seed's cut | the command | what is paid |
| --- | --- | --- | --- |
| An Examiner session | where the session should start | `tools/d1b/examine.ts --session x-<n> --examiner <model> --examiner-effort <e> ...` | the Examiner's turns, its tries and their Referee rulings where seated |
| A round's solves, without its Builder | right after a recorded `build.finished` (`--events`) | the round again with that session's `--session` | the comparison's solves, under its `--cap` |
| A whole round or campaign stretch | before a round's `build.started`, or at rest | the round or `harness-builder.ts`, with every seat's model and effort | each seat's sessions and every solve |
| One Referee ruling | right before the recorded ruling (`--events`) | `scripts/referee-seat.ts --solve <id> --reviewer <model>` as `start`'s command | one ruling: its replay, probes and model turns |
| One solve | none: it reads the stored sweep | `bun tools/m0/live-solve.ts <pack flags> --task <id> --live` | one solve |

Three rules are this option's own:

- **The env file is a path.** It is passed on and never opened, printed or copied.
- **One live seat a login at a time.** A login at its session limit fails every solve in flight; on
  8 October 2026 that took three solves and $8.25 with it. Two seats at once take two logins.
- **A seat's result is one sample.** It proves a path and measures no rate. Whether a prompt or a
  term moves a count is rounds of paired seats against two draws of one commit, read on a graded
  loss beside the count ([optimize](cases/optimize.md)).

Nothing goes back to the campaign: a seed's solves stay in its log, and a seed shows no climb
(`AGENTS.md`, section 10, condition 9).

## The result

End with these, in this order.

1. The question, and the option and case you stopped at.
2. The position: the seed, its source, where it was cut, and the one line of difference. For a
   change, the commits before and after it, and what moved between the two arms.
3. Each prediction beside its reading.
4. What was not run: the seats scripted, the layers skipped.
5. Each condition as `blocking`, `cleared` or `accepted-risk`. A blocking one names its owner and
   the smallest fix. An accepted one names who accepted it.
6. For option 3, the dollars and minutes billed, every started seat counted as spent.
7. The seeds moved to the Trash, or which are kept and why.
