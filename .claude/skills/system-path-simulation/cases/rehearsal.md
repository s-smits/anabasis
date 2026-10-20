# Rehearsal

A round, session, checkpoint or campaign on a seed, with scripted seats and no Referee. It answers
whether commands still join after a change, and what a position of a given size can read at all.
It calls no model; its duration depends on the solves and their limits.

## Seed

```sh
bun run runs seed --from <campaign folder> --name sim-<what> [--before <session> | --events <n>]
```

Run it in the worktree whose source should run. The seed is `.ana/d2/sim-<what>` there: the log cut,
`checks/`, `exams/` and `states/` copied where present, the Builder notes named by retained
`build.started` events, and `seed.json` saying where it came from. Receipts, outputs and notes of
sessions beyond the cut are left out (`seedCampaign`). The source is only read, so a running
campaign can be seeded; a torn last line is left behind. Prefer a log at rest for a repeatable cut.

- `--before <session>` keeps what came before a Builder or an Examiner session started.
- `--events <n>` keeps the first n events, for a position inside a session.
- With neither, the whole log.

It prints the sets the seed holds. Read them before going on: a seed with no held-out task
rehearses a round that scores nothing.

For a position no run stood in, cut before the event that fixed it and run the real command again.
To rehearse with other practice tasks, cut before the first release and release once more:

```sh
bun tools/d2/prepare.ts <pack flags> --name sim-<what> --practice 2
```

## Rehearse

```sh
bun run runs rehearse <pack flags> --name sim-<what> --session r-1 \
  --solves 1 --target 6 --level 0.02 --minutes 10 --turns 10 \
  [--tasks <task ids>] [--held old:new] [--starter pass|fail|none] [--supply N]
```

The flags are `tools/d2/round.ts`'s, less the three that name a model. The pack flags are the
campaign's `--root`, `--sweep`, `--cycle` and `--bundle`. Omit them for a seed that drafted its exam.
Keep the round small unless its size is the question. Its setting is still the seed's: a recorded
target or task list cannot be changed by these flags. Six frontier wins clear 0.02; four do not.

- The Builder's script appends one line to the harness's guide through its walled shell, then calls
  `finish`. It forks `--parent latest`, the starter until a session has left a harness. The same
  edit from the same parent gives the same digest.
- A solve's script ends one of three ways. For `pass` it writes an answer on record that the
  checks accepted into `answer.json`, with the harness's `write` or its `bash`, and submits it. For
  `fail` it does the same with one a check rejected. For `none` it submits with no answer written,
  as a solve that reached its limits has none.
- `--held old:new` says how a solve of a held-out task ends under the reference harness and the
  new. `--reference promoted` is the default: the last promoted harness, or the starter until one
  is promoted. `none:pass` scripts wins, which read a step only with enough frontier tasks at the
  level. `--starter` applies where the starter is neither side, for example in a campaign's control
  after a promotion. A comparison adds no third arm after a step.
- In a campaign the admission gate seats the same scripted solver, under the promoted reference
  as `old`, with three fresh solves per draft (18 October 2026). Five rehearsals seated none, while
  esp32-fresh-opus refused 45 of 50 drafts after promotion. The scripted
  Examiner tries each available recorded valid answer through `try_answer`, so an unanswered draft
  can be held on that proof. `pass:pass` refuses an answered draft unless an answer on record
  beats the reference by the objective (`informative`). A campaign with no task admitted can
  reach `no-room` or `exam` at its patience.
- `--tasks` names the scored tasks by id, as the first round does, in place of `--target`'s draw.
- A rehearsal needs no `--cap`: a script is paid nothing.
- It bypasses supply, checker-read and stop-rule admission, while its comparison's own terms still
  apply (`admitComparison`). A small rehearsal running does not prove a paid start would be admitted.

No reviewer reads a rehearsal, so a scripted `fail` is a rejection nobody ruled on. It sets its
task aside, the report's `counted` holds the tally were it to stand, and `tools/d2/settle.ts` on
the seed settles it on labels, as a paid comparison with no reviewer is settled.

For a stored pack the script reads graded passes from the sweep, then pack controls, then answers
accepted or rejected in the seed's log (`answersOf`). For a drafted exam it reads staged controls
and the source campaign's accepted answers, then the seed's verdicts (`draftedSource`). A missing
`pass` or `fail` answer makes the script give none and report a stray at the end, with exit 1;
`none` needs no answer.

With `--campaign`, use the flags of `tools/d2/harness-builder.ts` that name no model. The Builder
script follows public action advice. A drafted-exam seed supplies the source's later proposed tasks
to `scriptedExaminer`, then up to `--supply N` copies of its answered tasks. Keep the source folder
available. A stored-pack campaign has no scripted Examiner and ends when it needs one.

## Rehearse a session by itself

With `--no-comparison` the flags are a Builder session's (`tools/d2/session.ts`): the scripted
Builder forks the latest harness, adds its line and finishes, and nothing is compared. The plan's
checkpoint, several sessions and then one comparison, is walked as that many of these and then a
checkpoint with `--new latest`. `test/checker-commands.test.ts` walks two and a checkpoint over a
fixture pack on every run of the suite, on a host that has a command wall.

```sh
bun run runs rehearse <pack flags> --name sim-<what> --session b-2 --no-comparison
bun run runs rehearse <pack flags> --name sim-<what> --session b-3 --no-comparison
bun run runs rehearse <pack flags> --name sim-<what> --id g2 --new latest
```

## Rehearse a checkpoint

Flags that hold `--id` are a checkpoint's (`tools/d2/checkpoint.ts`): one comparison of two kept
harnesses, with no Builder session. It compares the latest harness a session left with the
reference, the last promoted harness or the starter until one is promoted. The seed must keep a new
harness: rehearse a session or round first. At four solves a side the report reads the reference
against itself on halves of its own solves too:

```sh
bun run runs rehearse <pack flags> --name sim-<what> --id g2 --tasks <task ids> \
  --solves 4 --held pass:pass
```

A scripted solve gives a recorded answer or none; it shows no model's ability within the budget.

## Read it

It prints the round's report, then the stop rule, then each harness by itself as the tasks by how
many of their solves were valid, then one of two last lines.

- `the rehearsal went as scripted`, exit 0. No solve strayed, and an isolated Builder session or
  round left a changed harness. A checkpoint runs no Builder. Read `reading` against the prediction.
- `the rehearsal did not go as scripted`, exit 1, with each stray named. Find out whose fault it is
  before anything else (rule 7): read the named solve's `solve.call` and `verdict` in the seed's log.

Then put the seed through the readers a real run meets, since a join can break after the report:

```sh
bun run runs pulse --once sim-<what>
bun run runs view sim-<what>
bun tools/wri/wri.ts read --log .ana/d2/sim-<what>/log.jsonl
```

## More than one round

A second round on the same seed takes another `--session`. Its Builder goes on from the harness
the first left, and it is compared with the reference on fresh solves of both. The reference is
the last promoted harness, or the starter until one is promoted. To compare with the first round's
harness explicitly, name it:

```sh
bun run runs rehearse ... --session r-2 --reference <the report's fresh digest>
```

## Kill and resume

Start the rehearsal in the background, `kill -9` it part-way, and run the same command again. A kill
after `build.finished` goes on from the log. A kill inside the Builder session spends the session's
id, as a stop does (run-management).

A kill can leave the ordinary root of each unfinished solve or session.
`bun run runs stop sim-<what>` names them, and with `--yes` releases them. While it runs this is the stop a paid
round gets: it ends the process and what it started, then releases. A seed's stop reads only what
the seed wrote after its cut (`leftOpen`), so what its source still has open is never touched.
Until 19 October macOS roots held disk images. For a root still mounted by that older code,
`stop.ts` requires `hdiutil detach` first. Current stops remove folders and end their remaining processes.

## Plant a condition for a reader

A script can put into a log exactly the thing a reader exists to notice, at no cost. Write what the
reader should say, rehearse, and read. `--held fail:pass` plants rejections under the reference
harness alone, which the investigation's reader should name as `SET ASIDE BY SIDE` and
`READING MOVES WITH THE SET-ASIDE`. A reader that stays silent on its own planted condition is a
`blocking` finding against the reader.

## Afterwards

`/usr/bin/trash .ana/d2/sim-<what>` for each seed, once its result is written down.
