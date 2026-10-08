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

It prints the sets the seed holds. Read them before going on: a seed with nothing held outside the
anchor rehearses a round that scores nothing.

For a position no run stood in, cut before the event that fixed it and run the real command again.
To rehearse a smaller anchor, cut before `anchor.drawn` and draw once more:

```sh
bun tools/d2/prepare.ts <pack flags> --name sim-<what> --anchor 1 --practice 0
```

## Rehearse

```sh
bun run runs rehearse <pack flags> --name sim-<what> --session r-1 \
  --screen 1 --fails 1 --solves 1 --anchor-floor 1 --target 4 --minutes 10 --turns 10 \
  [--held old:new] [--anchor old:new]
```

The flags are `tools/d2/round.ts`'s, less the three that name a model. The pack flags are the
campaign's `--root`, `--sweep`, `--cycle` and `--bundle`. Keep the round small as above unless its
size is the question.

- The Builder's script appends one line to the harness's guide through its walled shell, then calls
  `finish`. So the new harness differs from its parent by one line, and its digest is the same in
  every rehearsal from that parent.
- A solve's script hands the harness's own artifact-writer an answer on record and submits it: for
  a pass an answer the checks accepted, for a fail the task's first reject control.
- `--held old:new` says how a solve of a task outside the anchor ends under the old harness and
  the new, each `pass` or `fail`. `--anchor old:new` says the same for the anchor. The defaults are
  `fail:pass` and `pass:pass`.

The answers on record come from three places, in this order: a stored solve the sweep graded a
pass, the pack's own controls, and for a task a session wrote the answer its stronger solve was
accepted on and the controls gate 4 passed. A task with no answer for its scripted ending stops the
rehearsal with its name.

## Read it

It prints the round's report, then the three-session rule, then one of two last lines.

- `the rehearsal went as scripted`, exit 0. Every solve ended as its script said and the Builder
  changed the harness. Now read `reading` against the prediction you wrote.
- `the rehearsal did not go as scripted`, exit 1, with each stray named. Find out whose fault it is
  before anything else (rule 7): read the named solve's `solve.call` and `verdict` in the seed's log.

Then put the seed through the readers a real run meets, since a join can break after the report:

```sh
bun run runs pulse --once sim-<what>
bun run runs compare sim-<what>
bun tools/wri/wri.ts read --log .ana/d2/sim-<what>/log.jsonl
```

## More than one round

A second round on the same seed takes another `--session`. To build on the first, name the harness
it left and score what it admitted:

```sh
bun run runs rehearse ... --session r-2 --parent <the report's fresh digest> --admitted
```

## Kill and resume

Start the rehearsal in the background, `kill -9` it part-way, and run the same command again. A kill
after `build.finished` goes on from the log. A kill inside the Builder session spends the session's
id, as a stop does (launch-run). Afterwards read `mount | grep ana-built-bash`: a root still listed
there for a solve of the seed is one the kill left.

## Plant a condition for a reader

A script can put into a log exactly the thing a reader exists to notice, at no cost. Write what the
reader should say, rehearse, and read. Two rounds whose scripts made one harness pass the anchor
and then fail it drew `ANCHOR RATE BY ROUND` from the investigation's reader on 2026-10-08. A reader
that stays silent on its own planted condition is a `blocking` finding against the reader.

## Afterwards

`/usr/bin/trash .ana/d2/sim-<what>` for each seed, once its result is written down.
