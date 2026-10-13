# Anabasis

Anabasis builds a harness for one technical domain: the guide and the programs with which a
solving model answers that domain's tasks. Every mechanism in it serves one question:

> Is the new harness better than the reference harness, for this solver, on tasks neither was
> built on?

A campaign answers it in code. An Examiner writes the tasks and a Builder writes the harness,
practising only on the tasks released to it. Both harnesses then solve the same held-out tasks
afresh, under the same limits. A hidden check program decides whether each answer is valid, a
Referee rules on every rejection before it counts, and a one-sided sign test over the tasks reads
a step or none. A step read twice names the new harness for promotion, which is the operator's
word, and the next harness is built against it. Each campaign keeps one append-only log, and
every state is read from it.

## Run it

Bun 1.4.2 only.

```sh
bun install --frozen-lockfile
bun tools/d2/harness-builder.ts --name <name> --project <project> --prompt "<the domain, in your words>" \
  --solver <model> --budget <dollars> --builder <model> --examiner <model> --reviewer <model>
bun run runs view <name>
```

The head comment of `tools/d2/harness-builder.ts` is its manual, and the `launch-run` skill says
how a campaign is started for real: niced, in its own process group, with its output in two files.

## Read

- `AGENTS.md`: the working contract. What the system is for, who decides what, how a result is
  read, and how code is written here so that it passes its checks the first time.
- `docs/plan.md`: the plan of record.
- `docs/v1.md`: what v1 recorded, and why it did not climb. `docs/transfer.md`: what came over
  from v1, and what was replaced or dropped.

## History

Until 11 October 2026 this repository held v1, whose Builder wrote the harness, its tasks and its
checks, and whose harness was scored on that Builder's own tests. v2 was built in a repository of
its own and then merged in here with its history. v1's last tree is `5bc9988`.

MIT licensed: see `LICENSE`, and `THIRD_PARTY_NOTICES.md` for the code copied from other projects.
