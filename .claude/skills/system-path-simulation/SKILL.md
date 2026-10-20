---
name: system-path-simulation
description: "Test an uncertain Anabasis v2 path at the smallest real layer that can decide it: one fact from a log or a dry run, a walk of one value across the layers, a replay through this tree's readers, a round or campaign rehearsed on a seed with scripted seats and no Referee, or one live seat from a seed. Use to test a join, revisit a recorded position, size a comparison, or check what a kill or stop leaves. Not for reading a finished run (whole-run-investigation) or starting a paid one (run-management)."
---

# System path simulation

Use this when something has to work in the real system and no real actor has walked it yet: a
change crosses a join between two commands, a round is about to be sized, or a blocker is suspected
and unproven. Take the smallest real slice that can decide the question, and stop there.

v2 makes this cheap for one reason. A campaign is its folder, `.ana/d2/<name>`, and its log is its
record. A seed copies that log at a cut, the staged checks or drafted exam, the kept harnesses and
the Builder notes the cut still names (`seedCampaign`, `tools/runs/seed.ts`). A stored pack still
needs its pack and sweep on disk. Keep the source campaign available too: a drafted-exam rehearsal
reads its later tasks and answers from there (`draftedSource`, `tools/runs/rehearse.ts`).

## Pick the smallest case

| case | it answers | it costs | read |
| --- | --- | --- | --- |
| One fact | what a log, a campaign or the host says now | seconds | [one-fact](cases/one-fact.md) |
| Layer walk | whether one value survives every layer a change touches | minutes, no model | [layer-walk](cases/layer-walk.md) |
| Log replay | whether this tree still reads what real runs wrote | seconds for every log | [log-replay](cases/log-replay.md) |
| Rehearsal | whether commands join, and what a position of this size can read | no model; time depends on the solves and limits | [rehearsal](cases/rehearsal.md) |
| Live seat | what a real model does from a recorded position | a session's or a solve's dollars | [live-seat](cases/live-seat.md), `scripts/live-seat.ts` |
| The real run | everything a script cannot say | hours, tens of dollars | run-management, then `bun run runs pulse` |
| The open stack | which of a stack's changes hold with a real model before it lands, while its other fixes go on | one live seat a change, one after the other | [stack](cases/stack.md), `scripts/referee-seat.ts` |

A cheaper case that answers the question cancels every dearer one. Say which case you stopped at,
and why the next was not needed.

## Rules for every case

1. **Write the prediction first.** Before a simulation runs, write what it will read and why, in a
   file. Resolve each line after. A miss is the finding: the product does something you did not
   know, or your picture of it is stale. On 8 October 2026 one prediction missed because a round
   that scores nothing reads `not-scored`; another seed was cut before its only held task existed.
2. **Seed late, and from a real run.** A log a run wrote beats a position you would author. Cut
   right before the thing in question, and say in one line how the seed differs from the nearest
   real position: "exam-1 cut before its second Examiner session, then prepared with two practice
   tasks where the campaign released one".
3. **Build a position with the campaign's own commands.** Every event has one writer. Never append
   a line by hand, edit one, or put a harness state into `states/`. For a position no run stood in,
   cut earlier and run the real command with other flags.
4. **Write only to a seed.** `rehearse` and `scripts/live-seat.ts start` require `seed.json`.
   Production move commands have no such guard: use `sim-<what>` only for seeds.
5. **One variable.** Two rehearsals compare when one flag moved between them.
6. **Change the position, never the prompt.** A live seat is seated by the production command with
   the production prompt, and nothing tells the model what the simulation hopes for. If a prompt is
   what you are testing, that edit is the one variable.
7. **Your script's faults are not the product's.** When a rehearsal strays, ask first whether the
   script could have held. Eight solves "scripted to pass" were rejected on the first
   rehearsal: the pack's accept controls were stale, which `tools/c/accept.ts` already said. That
   was the script's choice of answer. The meter refusing a model with no list price was the
   product's, and right.
8. **Say what you did not run.** A rehearsal that went as scripted proves the joins and nothing of a
   model. Name the seats that were scripted and the layers skipped (below) wherever the result is
   repeated.
9. **A cleared condition lands in its owning test.** The rehearsal is how a broken join is found.
   The test in `test/` that fails without the fix is what keeps it found.
10. **Clean up.** A seed is listed by the pulse and read by `runs replay`.
    Move it to the Trash when its question is answered: `/usr/bin/trash .ana/d2/sim-<what>`.

## What a rehearsal walks, and what it cannot say

`bun run runs rehearse` dispatches to `roundCommand`, `sessionCommand` with `--no-comparison`,
`checkpointCommand` with `--id`, or `harnessBuilder` with `--campaign`. It supplies scripted seats.
Over a drafted exam the campaign's Examiner is scripted too; over a stored pack it has none and
ends when it needs one. Under the seats it walks:

- the campaign opened over its stored pack or staged drafted exam, its sets read from the log;
- the Builder session from `--parent latest`, the starter until a session has left a harness:
  its tools on the command wall, its ordinary root, its freeze and digest;
- each solve: its wall and root, the answer file and `submit`, the verifier on
  the staged check program, its verdict;
- the comparison: its terms written before its first solve, the reference harness, which is the
  last promoted harness or the starter until one is promoted, and the new one solved afresh, the
  paired sign-flip test, each harness at its one solve budget (`valid`), the report and the stop rule;
- going on from the log after a kill or a `bun run runs stop`, which finds a rehearsal as it finds
  a round and releases what its solves held.

Skipped, and so unproven by a rehearsal:

- every model, and the backends that reach one (the Claude Agent SDK, Codex, pi's own providers);
- practice solves, since the Builder's script calls none;
- the Referee. `--builder`, `--solver` and `--reviewer` are refused. So
  a scripted `fail`, an answer a check rejects, is ruled by nobody and sets its task aside, as a
  paid comparison's would with no reviewer; `tools/d2/settle.ts` on the seed walks the rest;
- paid model usage and realistic pressure on time or turns. A `none` script gives no answer and
  can reach its turn limit;
- supply, checker-read, cap and stop-rule admission (`admitComparison`, `admitSession`). The
  comparison's own terms still hold, including held-out status and exclusion of practice tasks.

A rehearsal is told from a paid round by three marks: `seed.json` beside its log, `(a seed)` in the
pulse, and `faux/script` as its Builder and solver wherever a reader names a model.

## What scripts read as

`--held old:new` says how a solve of a held-out task ends under the two harnesses of the
comparison: the reference harness, last promoted or the starter until one is promoted, and
the new one. Each is `pass`, a valid answer; `fail`, an answer a check rejects; or `none`, a solve
that submits with no answer, as one that reached its limits has none. `--starter` says how a solve
ends under the starter where it is neither side, for example in the control after a promotion.
It adds no third arm to a comparison.

The table uses four frontier tasks, two solves per side, `--level 0.10`, no retained tasks and
answers with no objective difference. These are the stand-in conditions in `test/round.test.ts`,
not the command defaults. `valid` lists task counts at zero, one and two valid solves, in that
order (`Valid`, `src/builder/comparison.ts`). At the default level of 0.02 four wins read
`no-step`; six untied tasks, all won, are needed (`sweepOf`, `src/kernel/compare.ts`).

| script | reading | why |
| --- | --- | --- |
| `--held none:pass` (the default script) | `step`, `valid.old` 4/0/0 and `valid.fresh` 0/0/4 | four wins give p 0.0625, below the explicit level of 0.10 |
| `--held pass:pass` | `no-step`, `valid` 0/0/4 twice | four ties between valid answers: the tasks leave a harness nothing to add |
| `--held none:none` | `no-step`, `unsolved` 4 | no harness answers; after two comparisons each task waits for a person's label unless feasibility is on record or its solves were cut by wall or context (`poolOf`) |
| `--held fail:pass` | `not-scored`, `aside` 4, `counted` 4-0 | no reviewer is seated, so each rejection sets its task aside until it is labelled |
| the same, then `settle.ts` with every label `earned` | `step` | the labels restore the tasks, and a settling makes no solve |
| `--reference <a kept digest> --held none:pass` | `step`, sixteen solves | only the two compared harnesses are solved; the starter adds no third arm |
| fewer than six frontier tasks, at `--level 0.02` | `no-step` at best in a rehearsal; a paid start is refused | rehearsals bypass supply admission, but the test still needs six wins |
| a Builder whose edit does not land | `no-change` | the harness froze to its parent's digest |
| `--campaign --held none:pass --starter pass --supply 40` over a drafted-exam seed | repeated promotions where each comparison has enough frontier wins | the Examiner proposes the source's later tasks, then copies of its answered tasks; a single `step` promotes outside `--hitl` (`stepOf`, `decide`) |

`check-defects` is out of a rehearsal's reach but for a check that cannot run: it takes a Referee's
ruling of a check defect to count one.

## What the first rehearsals settled

The rehearsals of 8 October 2026 found several joins that still matter:

- **A step takes four untied tasks, all won, at level 0.1.** A campaign that holds fewer cannot
  read one, and the comparison's admission now refuses it.
- **A round reports; promotion is a separate move.** A hand-run round writes no `harness.promoted`.
  The campaign command promotes a single `step` outside `--hitl` (AGENTS.md, sections 3 and 7).
- **A prediction made from a count taken while a session ran was wrong.** Seed from a log at rest.

What the product did:

- **A hard kill is survived.** `kill -9` 13 seconds into a round left 8 solves started and 4
  finished. Run again with the same `--session`, it went on from its log and reported as scripted.
- **A kill left roots behind, and session ids collided across campaigns.**
  `bun run runs stop <name> --yes` releases roots left by unfinished solves and sessions (`leftOpen`, `releaseRoot`),
  and `sessionDirs` names a Builder's root by its campaign too. Until 19 October roots on macOS
  held disk images; they are ordinary folders now (`src/verify/seat-root.ts`).
- **Claude Code went on after its solve closed.** On 8 October 2026, 14 of 35 solve records held
  a call after the one that ended the solve. A live probe traced this to an abort closing stdin
  while a turn was parked on `submit`. `close` now interrupts before aborting
  (`src/backends/claude.ts`); `test/claude-backend.test.ts` checks that join.
- **The pulse read a seed as a paid run**, with its source's dollars and its source's solves in
  flight. It now says `(a seed)`.
- **A reader caught a planted contradiction.** Two rehearsed rounds made one harness pass a task
  as the new side and fail it as the old, and `bun tools/wri/wri.ts read` said so unasked. Planting
  a condition and checking that its reader names it is a use of a rehearsal in its own right.

## Coverage

`test/runs-rehearse.test.ts` holds the seed and scripts. `test/checker-commands.test.ts` rehearses
two sessions and a checkpoint over a fixture pack when a command wall is available. A pass on one
platform proves only that platform's wall (AGENTS.md, section 9). The CLI has no mixed mode with a
live Builder and scripted solves; its Builder script runs no practice solve and seats no Referee.

## The result

End with these, in this order.

1. The question, and the case you stopped at.
2. The position: the seed, its source, where it was cut, and the one line of difference.
3. Each prediction beside its reading.
4. What was not run.
5. Each condition as `blocking`, `cleared` or `accepted-risk`. A blocking one names its owner and
   the smallest fix. An accepted one names who accepted it.
6. The seeds moved to the Trash, or which are kept and why.
