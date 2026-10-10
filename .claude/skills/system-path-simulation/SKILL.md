---
name: system-path-simulation
description: "Test an uncertain Anabasis v2 path at the smallest real layer that can decide it, before a paid round is asked to: one fact from a log or a dry run, a walk of one value across the layers a change touches, a replay of every recorded log through this tree's readers, a whole round rehearsed on a seeded copy of a campaign with a script in each model seat (`bun run runs seed`, `bun run runs rehearse`), or one live seat from a seed. Use when the operator asks whether a change will work in the real system, to simulate or rehearse a round, to stand again in a position a past run stood in, what a campaign of a given size can read, or what a kill or a stop leaves behind. Not for reading a finished run (whole-run-investigation) or starting a paid one (launch-run)."
---

# System path simulation

Use this when something has to work in the real system and no real actor has walked it yet: a
change crosses a join between two commands, a round is about to be sized, or a blocker is suspected
and unproven. Take the smallest real slice that can decide the question, and stop there.

v2 makes this cheap for one reason. A campaign is its folder, `.ana/d2/<name>`, and its log is its
whole position: a round reads nothing that is not in the log, the check program staged beside it or
the harness states it kept. So a position is a log cut at a line, and any position a real run stood
in can be stood in again by a copy.

It is v1's skill rebuilt for that fact. What v1 needed and v2 does not is at the end.

## Pick the smallest case

| case | it answers | it costs | read |
| --- | --- | --- | --- |
| One fact | what a log, a campaign or the host says now | seconds | [one-fact](cases/one-fact.md) |
| Layer walk | whether one value survives every layer a change touches | minutes, no model | [layer-walk](cases/layer-walk.md) |
| Log replay | whether this tree still reads what real runs wrote | seconds for every log | [log-replay](cases/log-replay.md) |
| Rehearsal | whether a round's commands join, and what a position of this size can read | about 25 s a round, no model | [rehearsal](cases/rehearsal.md) |
| Live seat | what a real model does from a recorded position | a session's or a solve's dollars | [live-seat](cases/live-seat.md) |
| The real run | everything a script cannot say | hours, tens of dollars | launch-run, then `bun run runs pulse` |

A cheaper case that answers the question cancels every dearer one. Say which case you stopped at,
and why the next was not needed.

## Rules for every case

1. **Write the prediction first.** Before a simulation runs, write what it will read and why, in a
   file. Resolve each line after. A miss is the finding: the product does something you did not
   know, or your picture of it is stale. Six predictions were written for five rehearsals on
   2026-10-08. Four held. One missed because a round that scores nothing reads `not-scored`, a word
   the stack had gained under the note being worked from. One missed because the seed was cut
   before the session that made the campaign's only held task.
2. **Seed late, and from a real run.** A log a run wrote beats a position you would author. Cut
   right before the thing in question, and say in one line how the seed differs from the nearest
   real position: "exam-1 cut before its second Examiner session, then prepared with two practice
   tasks where the campaign released one".
3. **Build a position with the campaign's own commands.** Every event has one writer. Never append
   a line by hand, edit one, or put a harness state into `states/`. For a position no run stood in,
   cut earlier and run the real command with other flags.
4. **Write only to a seed.** `rehearse` refuses a campaign with no `seed.json`. No other command
   knows the difference, so the name is the guard: seeds are `sim-<what>`, and nothing but a seed is.
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
10. **Clean up.** A seed is listed by the pulse and matched by `runs compare` and `runs replay`.
    Move it to the Trash when its question is answered: `/usr/bin/trash .ana/d2/sim-<what>`.

## What a rehearsal walks, and what it cannot say

`bun run runs rehearse` is `tools/d2/round.ts` with a script in its two model seats
(`roundCommand(args, seated)`). Under the seats everything is a paid round's:

- the campaign opened over the real pack, its sets read from the log;
- the Builder session, which forks the Starter Built Harness as the plan's first round does: its
  tools on the command wall, its capped root, its freeze and digest;
- each solve: its wall and disk cap, the answer file and `submit`, the verifier on
  the staged check program, its verdict;
- the comparison: its terms written before its first solve, the reference harness, which is the
  starter unless `--reference` names another, and the new one solved in turn, the sign test, each
  harness by itself at every budget (`valid`), the report and the stop rule;
- going on from the log after a kill or a `bun run runs stop`, which finds a rehearsal as it finds
  a round and releases what its solves held.

Skipped, and so unproven by any rehearsal:

- every model, and the backends that reach one (the Claude Agent SDK, Codex, pi's own providers);
- practice solves, since the Builder's script calls none;
- the Referee and the Diagnoser. A flag that names a model is refused, `--reviewer` among them. So
  a scripted `fail`, an answer a check rejects, is ruled by nobody and sets its task aside, as a
  paid comparison's would with no reviewer; `tools/d2/settle.ts` on the seed walks the rest;
- time and money. A scripted solve takes 3 to 4 seconds and reaches no wall.

A rehearsal is told from a paid round by three marks: `seed.json` beside its log, `(a seed)` in the
pulse, and `faux/script` as its Builder and solver wherever a reader names a model.

## What scripts read as

`--held old:new` says how a solve of a held-out task ends under the two harnesses of the
comparison: the reference harness, which is the starter unless `--reference` names another, and
the new one. Each is `pass`, a valid answer; `fail`, an answer a check rejects; or `none`, a solve
that submits with no answer, as one that reached its limits has none. `--starter` says how a solve
ends under the starter where it is neither of the two, which is after a promotion only. The table
is what `src/builder/round.ts` reads, as its tests hold it on stand-ins (`test/round.test.ts`), at
four scored tasks. It has not been rehearsed on the truss pack since the comparison was rewritten
on 2026-10-09: the first rehearsal on a seed should write these as its predictions.

| script | reading | why |
| --- | --- | --- |
| `--held none:pass` (the default) | `step`, `valid` 4/0/0 and 0/0/4 | four wins are p 0.0625; the starter is a side of the test, so nothing more is solved |
| `--held pass:pass` | `no-step`, `valid` 0/0/4 twice | four ties between valid answers: the tasks leave a harness nothing to add |
| `--held none:none` | `no-step`, `unsolved` 4 | no harness answers; twice in a row and each task waits for a person's label |
| `--held fail:pass` | `not-scored`, `aside` 4, `counted` 4-0 | no reviewer is seated, so each rejection sets its task aside until it is labelled |
| the same, then `settle.ts` with every label `earned` | `step` | the labels restore the tasks, and against the starter there is nothing more to solve |
| `--reference <a built digest> --held none:pass` | `step`, with `against` 4-0 | after a promotion a step is held to the starter, which is solved because the test cleared and answers nothing |
| the same with `--starter pass` | `step`, with `against` 0-0-4 | against the starter every task ties between valid answers, and as many wins as losses is enough |
| the same with `--held fail:pass`, then `settle.ts` with every label `earned` | `starter-unread` | a settling makes no solve, so the new harness is compared with the starter in a checkpoint of its own |
| fewer than three tasks held out | refused at launch; `no-step` at best if run | at 0.20 a step takes three untied tasks, all won |
| a Builder whose edit does not land | `no-change` | the harness froze to its parent's digest |

`check-defects` is out of a rehearsal's reach but for a check that cannot run: it takes a Referee's
ruling of a check defect to count one. So is `below-starter`: a script ends every solve of a side
alike, and losing to the starter while beating the reference harness takes a side that is valid
only some of the time.

## What the first rehearsals settled

About seventeen rounds run to their report, one kill and five stops on 2026-10-08, with no model
call. They ran under the design before the plan after the v1 review, which screened candidates
and read an anchor; what they found about that design went with it. What they found about a
round's size still holds in the new arithmetic:

- **A step takes four untied tasks, all won, at level 0.1.** A campaign that holds fewer cannot
  read one, and the launcher now refuses it.
- **A step does not move the reference harness.** The next comparison is against the harness the
  campaign started with until the operator names another with `--reference`; the Builder goes on
  from the latest harness a session left.
- **A prediction made from a count taken while a session ran was wrong.** Seed from a log at rest.

What the product did:

- **A hard kill is survived.** `kill -9` 13 seconds into a round left 8 solves started and 4
  finished. Run again with the same `--session`, it went on from its log and reported as scripted.
- **A kill or a stop left disk images attached.** The four solves in flight at the kill stayed
  mounted, as did the Builder roots of two sessions stopped hours earlier with `bun run runs stop`,
  a third of a gigabyte each. A Builder's root was named for its session id alone, so another
  campaign on the host that asked for that id was refused with a bare `EEXIST`. Both are mended:
  `bun run runs stop <name> --yes` releases what a run's unfinished solves and sessions left,
  whenever it was stopped or killed, and a Builder's root is named for its campaign too.
- **The mend failed its first rehearsal.** A stop two seconds into four solves gave up at its first
  root: three had a folder and an image and no volume, and a detach of that exits 1. A release now
  passes over a root with nothing mounted. Four more stops, from a third of a second in to after the
  solves ended, left nothing, and a stopped round went on under its session and read `step`.
- **Claude Code went on after its solve closed.** The host folders the day's solves left behind
  each held a log Claude Code wrote after its solve's teardown, and 14 of 35 held a call made after
  the one that ended the solve. A live seat on the small model showed why for cents: closed on a
  parked `submit`, Claude Code lived two to three seconds more and called `submit` twice again,
  each a model request no meter read. An abort closes its stdin and gives it two seconds, which it
  spends on its turn. The close now interrupts the turn first, and the same probe then called
  nothing and was gone inside a second. One whole solve on that model, its logs copied out five
  times a second, then ended on its `submit` with no call after it, Claude Code gone within 0.56 s
  and no folder left. A leftover nobody asked about was the lead.
- **The pulse read a seed as a paid run**, with its source's dollars and its source's solves in
  flight. It now says `(a seed)`.
- **A reader caught a planted contradiction.** Two rehearsed rounds made one harness pass a task
  as the new side and fail it as the old, and `bun tools/wri/wri.ts read` said so unasked. Planting
  a condition and checking that its reader names it is a use of a rehearsal in its own right.

## Not here yet

- **A scripted Examiner.** `exam.call` holds each call whole, so a session can be replayed from a
  log. Nothing does it, and an Examiner session is rehearsed only live.
- **A live Builder over scripted solves**, which would prove the Builder's seat for a dollar or two.
- **Practice solves and reviewers in a rehearsal.**
- **A rehearsal in the test suite.** The tests hold the script and the seed. The joins were walked
  on the truss pack by hand, and no fixture pack walks them on every gate.
- **Linux.** Every rehearsal so far ran on the Darwin wall and its disk images.

## The result

End with these, in this order.

1. The question, and the case you stopped at.
2. The position: the seed, its source, where it was cut, and the one line of difference.
3. Each prediction beside its reading.
4. What was not run.
5. Each condition as `blocking`, `cleared` or `accepted-risk`. A blocking one names its owner and
   the smallest fix. An accepted one names who accepted it.
6. The seeds moved to the Trash, or which are kept and why.

## From v1

Kept: the smallest real layer, the ladder of cases, seed late and from a past run, the one line of
difference, predictions written first, script faults apart from product faults, a cleared condition
in its owning test, the three-word result.

Gone with what they served: stewards and their accounts, position packets, the Judge and Epoch
Reviewer replays, the tool-tree relocation and the fifteen-turn rule. v1 hand-built a position
because its state was spread over a controller and many files. v2's is one log, so a position is
cut and never built.
