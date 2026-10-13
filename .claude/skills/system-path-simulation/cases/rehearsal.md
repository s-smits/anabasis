# Rehearsal

A whole round on a copy of a campaign, with a script where each model sits. It answers two kinds of
question: whether a round's commands still join after a change, and what a position of a given size
can read at all. It takes about 25 seconds and calls no model.

## Seed

```sh
bun run runs seed --from <campaign folder> --name sim-<what> [--before <session> | --events <n>]
```

Run it in the worktree whose source should run. The seed is `.ana/d2/sim-<what>` there: the log cut,
`checks/` and `states/` copied, and `seed.json` saying where it came from. The source is only read,
so a campaign that is still running can be seeded. A torn last line is left behind.

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
  --solves 1 --target 4 --minutes 10 --turns 10 \
  [--tasks <task ids>] [--held old:new] [--starter pass|fail|none] [--supply N]
```

The flags are `tools/d2/round.ts`'s, less the three that name a model. The pack flags are the
campaign's `--root`, `--sweep`, `--cycle` and `--bundle`. Keep the round small as above unless its
size is the question.

- The Builder's script appends one line to the harness's guide through its walled shell, then calls
  `finish`. The session forks the Starter Built Harness, as the plan's first round does, so the
  new harness is the starter with a one-line guide, and its digest is the same in every rehearsal
  from that parent.
- A solve's script ends one of three ways. For `pass` it writes an answer on record that the
  checks accepted into `answer.json`, with the harness's `write` or its `bash`, and submits it. For
  `fail` it does the same with one a check rejected. For `none` it submits with no answer written,
  as a solve that reached its limits has none.
- `--held old:new` says how a solve of a held-out task ends under the reference harness and the
  new. The reference harness is the starter unless `--reference` names another. The defaults are
  `none:pass`, which script a step. `--starter` says how a solve ends under the starter where it
  is neither of the two: after a promotion it is solved only when the comparison reads a step.
- `--tasks` names the scored tasks by id, as the first round does, in place of `--target`'s draw.
- A rehearsal needs no `--cap`: a script is paid nothing.

No reviewer reads a rehearsal, so a scripted `fail` is a rejection nobody ruled on. It sets its
task aside, the report's `counted` holds the tally were it to stand, and `tools/d2/settle.ts` on
the seed settles it on labels, as a paid comparison with no reviewer is settled.

The answers on record come from three places, in this order: a stored solve the sweep graded a
pass, the pack's own controls, and every answer a verdict in the seed's log accepted or rejected,
which is where a task a session wrote gets one. A task with no answer for a `pass` or a `fail`
stops the rehearsal with its name; `none` needs no answer.

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
starter, so the seed has to hold one: rehearse a round on it first. The plan's gate G2 is a
checkpoint at four solves a side, which reads the starter against itself beside it:

```sh
bun run runs rehearse <pack flags> --name sim-<what> --id g2 --tasks <task ids> \
  --solves 4 --held pass:pass
```

Every scripted solve uses the same few turns, so a rehearsal shows nothing of where a budget
binds.

## Read it

It prints the round's report, then the stop rule, then each harness by itself as the tasks by how
many of their solves were valid, then one of two last lines.

- `the rehearsal went as scripted`, exit 0. Every solve ended as its script said and the Builder
  changed the harness. Now read `reading` against the prediction you wrote.
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
the first left, and it is compared with the same reference harness, the starter, on fresh solves
of both. To compare with the first round's harness instead, as after a promotion, name it:

```sh
bun run runs rehearse ... --session r-2 --reference <the report's fresh digest>
```

## Kill and resume

Start the rehearsal in the background, `kill -9` it part-way, and run the same command again. A kill
after `build.finished` goes on from the log. A kill inside the Builder session spends the session's
id, as a stop does (launch-run).

A kill leaves the capped root of each solve it fell in mounted. `bun run runs stop sim-<what>` names
them, and with `--yes` releases them. The same command while the rehearsal runs is the stop a paid
round gets: it ends the process and what it started, then releases. A seed's stop reads only what
the seed wrote after its cut, so what its source still has open is never touched.

## Plant a condition for a reader

A script can put into a log exactly the thing a reader exists to notice, at no cost. Write what the
reader should say, rehearse, and read. `--held fail:pass` plants rejections under the reference
harness alone, which the investigation's reader should name as `SET ASIDE BY SIDE` and
`READING MOVES WITH THE SET-ASIDE`. A reader that stays silent on its own planted condition is a
`blocking` finding against the reader.

## Afterwards

`/usr/bin/trash .ana/d2/sim-<what>` for each seed, once its result is written down.
