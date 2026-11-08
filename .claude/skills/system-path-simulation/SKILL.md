---
name: system-path-simulation
description: "Test an uncertain Anabasis path before a real run walks it: read the record (one fact, a replay of every log, or a synthetic log in memory), rehearse (the real commands on a seed with scripted seats, or one value walked through its tests), or seat a model (a live Examiner session, round or Referee ruling from a seed, or rounds of paired seats that tune a prompt or term against one count), each runnable before and after a change. Use to test a join, revisit a recorded position, size a comparison, check what a kill or stop leaves, simulate an open stack's changes before it lands, or tune the Examiner's, Referee's or Builder's prompt or terms (cases/optimize.md). Not for reading a finished run (whole-run-investigation) or starting a paid campaign (run-management)."
---

# System path simulation

Use this when a path has to work in the real system and no real actor has walked it yet: a change
crosses a join between two commands, a round is about to be sized, or a blocker is suspected. Take
the cheapest option that can decide the question, and stop there.

Simulation is cheap because a campaign's log is its whole state. A **seed** copies that log cut at
one event, with the checks or drafted exam, kept harnesses and Builder notes the cut still names
(`seedCampaign`, `tools/runs/seed.ts`), so any recorded position can be restored and run forward. A
stored pack still needs its pack and sweep on disk, and a drafted-exam rehearsal reads later tasks
from its source (`draftedSource`, `tools/runs/rehearse.ts`), so keep the source.

## Three options

The options form a ladder of fidelity against cost. Each answers something the one below cannot.

| option | what runs | cost | it answers | it cannot say |
| --- | --- | --- | --- | --- |
| **1. Read the record** | this tree's readers over recorded or synthetic events; nothing is written | seconds | what a fold, a reader or a seat's message makes of a pattern | what a command does from the last event |
| **2. Rehearse** | the real commands, wall, verifier and comparison on a seed, with scripted seats and no Referee | minutes, no model | whether the commands join, and what a position of this size can read | what a model does |
| **3. Seat a model** | the real commands with a real model in one or more seats of a seed | dollars | what a model does from a recorded position | a rate: one seat is one sample |

Say which option you stopped at and why the next was unnecessary. [before-after](cases/before-after.md)
runs any option at two commits, [optimize](cases/optimize.md) repeats that over option 3 in rounds,
and [stack](cases/stack.md) orders the simulations of an open stack before it lands.

## Rules

1. **Write the prediction first**, in a file, and resolve each line after the run. A miss is the
   finding: the product does something you did not know, or your model of it is stale.
2. **Seed late, and only from a real run.** Cut right before the event in question, from a log at
   rest, and state in one line how the seed differs from the nearest real position.
3. **Build a position with the campaign's own commands.** Never append or edit a line by hand, or
   put a harness into `states/`; for a position no run reached, cut earlier and run the real command
   with other flags. Hand-built events stay in memory (the synthetic log).
4. **Write only to a seed.** `rehearse` and `live-seat.ts start` require `seed.json`; production
   commands do not, so name seeds `sim-<what>`.
5. **One variable.** Two rehearsals compare when one flag moved; two commits compare on the same
   input. A tuning series fixes its outline before its first round ([optimize](cases/optimize.md),
   step 5).
6. **Change the position, never the prompt**, unless the prompt is the variable. A live seat runs the
   production command with the production prompt, and nothing tells the model what you hope for.
7. **Separate the script's faults from the product's.** When a rehearsal strays, first ask whether
   the script chose a bad answer (stale accept controls, which `tools/c/accept.ts` reports).
8. **Say what did not run**: the scripted seats and the skipped layers, wherever the result is
   repeated.
9. **A cleared condition lands in its owning test** in `test/`, which fails without the fix.
10. **Clean up.** The pulse lists seeds and `runs replay` reads them: `/usr/bin/trash
    .ana/d2/sim-<what>` once the question is answered. `bun run runs retire` removes one idle for a
    day.

Readers and `runs seed --from <name>` resolve names across `ANA_HOSTS`. A seat's records and pids
stay on its host, so every script here takes `--host <name>` and runs there at this tree's published
commit (`.claude/skills/main/cli.ts`), as in `bun --env-file=.env.runs
.claude/skills/system-path-simulation/scripts/live-seat.ts due --host <name> ~/sim-r11/arm`.

## 1. Read the record

Use the product's own readers, never a parser of your own, which agrees with the product until an
event's shape moves and then fails silently. [one-fact](cases/one-fact.md) asks what a log or the
host says now (`harness-builder.ts --name <name> --dry-run`, `runs view`, `wri.ts read --log <log>`,
`live-solve.ts` without `--live`); [log-replay](cases/log-replay.md) whether this tree still reads
every recorded log (`bun run runs replay [<name> ...]`); [synthetic](cases/synthetic.md) what a
reader does with a pattern no log holds yet (`scripts/synthetic.ts <example or scenario> [--tree
<worktree>]`). The log holds no prompt, so what a model saw is answered by the tree at its receipt's
commit.

## 2. Rehearse

```sh
bun run runs seed --from <campaign folder> --name sim-<what> [--before <session> | --events <n>]
bun run runs rehearse [<pack flags>] --name sim-<what> --session r-1 [--held old:new] [--starter pass|fail|none] [--supply N]
bun run runs rehearse --name sim-<what> --campaign [--held ...] [--starter ...] [--supply N]
```

Every seat runs a script on pi's faux provider, so the joins are real and the behaviour is whatever
the script says. It skips models and backends, practice solves, the Referee (a scripted `fail` waits
for `tools/d2/settle.ts`), time pressure and admission (`admitComparison`, `admitSession`), and is
marked by `seed.json`, `(a seed)` in the pulse and `faux/script` as its model. No mode mixes a live
Builder with scripted solves. [rehearsal](cases/rehearsal.md) has the forms and what each script
reads as; the smallest rehearsal is a [layer walk](cases/layer-walk.md).

## 3. Seat a model

It spends money, so it needs the operator's word naming the seats, model, effort and login, and a
size stated first (run-management's sizing). [live-seat](cases/live-seat.md) covers the script.

```sh
bun --env-file=<file> .claude/skills/system-path-simulation/scripts/live-seat.ts start \
  --tree <worktree> --name sim-<what> --out <scratch>/arm --cap <dollars> --minutes <n> --login N \
  -- <the production command and its flags, with the operator's model and effort>
```

| seat | seed cut | command |
| --- | --- | --- |
| An Examiner session | where the session should start | `tools/d1b/examine.ts --session x-<n> --examiner <model> --examiner-effort <e> ...` |
| A round's solves, without its Builder | right after a recorded `build.finished` (`--events`) | the round again with that `--session` |
| A round or campaign stretch | before `build.started`, or at rest | the round or `harness-builder.ts`, every seat's model named |
| One Referee ruling | right before the recorded ruling (`--events`) | `scripts/referee-seat.ts --solve <id> --reviewer <model>` as `start`'s command |
| One solve | none; it reads the stored sweep | `bun tools/m0/live-solve.ts <pack flags> --task <id> --live` |

- **The env file is a path**, passed on and never opened, printed or copied.
- **One live seat a login at a time.** A login that hits its session limit fails every solve in
  flight.
- **A seat is one sample.** It proves a path and measures no rate (rule 6 of `AGENTS.md`); whether a
  change moves a count is [optimize](cases/optimize.md)'s question.

Nothing returns to the campaign: a seed's solves stay in its log, and a seed shows no climb
(`AGENTS.md`, section 10, condition 9).

## The result

1. The question, and the option and case you stopped at.
2. The seed, its source, its cut and its one line of difference; for a change, both commits.
3. Each prediction beside its reading.
4. What did not run.
5. Each condition as `blocking` (with owner and smallest fix), `cleared` or `accepted-risk` (with who
   accepted it).
6. For option 3, the dollars and minutes billed, every started seat counted as spent.
7. The seeds trashed, or kept and why.
