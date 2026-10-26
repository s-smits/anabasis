# The transitivity probe's runs

The record of the runs `studies/transitivity/README.md` set out, kept as that protocol's "Keep the
record" asks: what the readers printed, which holds counts, digests and ids and no task content.
The seeds' logs hold hidden values and stay on the exam side; they were zipped outside the
repository on 26 October (`bun run runs zip sim-tp-epoch1 sim-tp-bfeb sim-tp-bfeb-c --medium`,
28.6 MB) before `bun run runs retire` could delete them.

Every run ran at commit `87f0b07e`, on a macOS runner, through `live-seat.ts`, from 25 October
23:09 UTC to 26 October 02:31 UTC. The readings were made with `studies/transitivity/read.ts` at
`789b1987`.

| Run | Arm | Seed, events | Billed | Folder |
| --- | --- | --- | --- | --- |
| r-1 | A | `sim-tp-epoch1`, 6440 to 8246 | $11.37, 19 min | `r-1/` |
| tx-1 | B's tasks | `sim-tp-bfeb`, 15867 to 19363 | $14.97, by difference: `tx-1/seat.txt` reads the seed from 15867 to its end, f-1's $19.98 included | `tx-1/` |
| f-1 | B | `sim-tp-bfeb`, 16731 to 19363 | $19.98, 76 min | `f-1/` |

Spent: $46.32 of the operator's $80, the sum of the three arms' rounded bills ($46.31 unrounded).
Arm C (c-1) was not run, since P-B held; its seed
`sim-tp-bfeb-c` was made and holds no solve.

Each folder holds `terms.json` (the seed, the commit, the first event and the command as
launched), and for a comparison `read.txt` (`read.ts`) and `report.txt` (the checkpoint's own
closing lines). `tx-1/seat.txt` (`live-seat.ts read`) holds the Examiner's gate counts, and
`tx-1/result.json` its closing record.

## How the predictions resolved

- **P-A held.** r-1, together without the bill: 1-0-23 of 24 tasks, so 23 tie and `6a42fac4` loses
  none. Both harnesses were valid in every solve of every task (0/0/0/0/24 a side). With the bill
  the new side wins all 24, the tree's own reading `step`, on the bill alone.
- **tx-1** held out 25 tasks against `bfeb41cd` and refused one, ending `supplied`.
- **P-B held.** f-1, frontier without the bill: 24-0-0, untied 24, p below 0.0001. The retained
  tasks read 7-0-1 (p 0.0078), together 31-0-1. The A/A reads no step either way; its tie share is
  22% and its flip rate 14%. `f-1/read.txt` gives the set's digest, `6136fffa` of 32 tasks, with
  the frontier all of epoch 5.

One count bears on P-B and is read from the seed's log, by solve (`solve.started` with
`comparison` f-1, its `condition`'s harness, and `solve.finished`): `6a42fac4` passed 128 of its
128 solves. `bf461326` passed 97, and its solver flagged the task malformed in the other 31, over
11 tasks (`tx-1-013`, `-014`, `-015`, `-016`, `-018`, `-019`, `-021`, `-023`, `-025`, `-026` and
`x-3-017`), with no rejection and no other ending. The other side answered each of those tasks in
every solve. A flag counts as the flagging side's own fail (`AGENTS.md`, rule 7) whether or not
the task is sound, and no check was read to say which. Ten of those tasks are on the frontier and
`x-3-017` is retained. So of the 24 frontier wins, 10 come from validity on flagged tasks, and the
other 14 from the objective between valid answers.

## What this does not show

One reading is one draw. "The later promotions carry over" is said without qualification only
once a second reading of the same pair on fresh solves holds it (`AGENTS.md`, section 9). The
wins on the 11 flagged tasks say that `bf461326`'s solver gives up on them; they do not say which
promotion after it removed that. No check was audited here: the passes stay unread by a person,
and no rejection occurred to rule.
