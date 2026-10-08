# One fact

Most questions that sound like a simulation are one fact a reader already gives. Ask the reader
before building anything.

| the fact | the command | it writes |
| --- | --- | --- |
| Can this campaign start a round, and what would stop it? | `bun run runs launch --dry-run <the round's flags>` | nothing |
| Which sets does a log hold? | the dry run's first line, or `bun run runs replay <name>` | nothing |
| Is a run alive, and what did it last do? | `bun run runs pulse --once <name>` | the pulse's own state file |
| Is there supply for a round? | `bun tools/d1b/supply.ts --log <log>` | nothing |
| Which sessions ran, from which parent, with which reading? | `bun tools/wri/wri.ts read --log <log>`, row F and the `CHAIN` line | nothing |
| Under what did two rounds run, and do they compare? | `bun run runs compare <name> ...` | nothing |
| Does the checker stand on its controls? | `bun tools/c/accept.ts <pack flags> --name <campaign>` | its reading, as `checker.read` |
| What would a solver of this task be shown? | `bun tools/m0/live-solve.ts <pack flags> --task <id>`, without `--live` | nothing |
| What does the host still hold of a run? | `mount \| grep ana-built-bash`, `pgrep -fl tools/d2/round.ts` | nothing |

Three commands look like readers and are not. `tools/d2/prepare.ts` draws the anchor and releases
the practice tasks, once and for good. `tools/c/accept.ts` appends what it read, and with `--freeze`
writes `contract.frozen`. Run any of them on a seed when the fact you want is what it would do.

## A fact no reader gives

Read the log with the product's own readers, not with a parser of your own: `read`
(`src/kernel/log.ts`), `taskStates` (`src/kernel/task.ts`), `setsOf` and `carriable`
(`tools/d2/campaign.ts`), `conditionsOf` (`src/kernel/condition.ts`), `stopRule`
(`src/builder/round.ts`). A reader of your own agrees with the product until the day an event's
shape moves, and then it is wrong in silence.

What the log holds whole, and so answers without a run:

- every tool call, as `solve.call`, `build.call` and `exam.call`, with its `tool` and its `args`;
- every verdict, with the answer it was given;
- every condition a solve ran under, the host's code by content among them;
- a session-written task entire, in its `task.proposed`.

What it does not hold: the prompts. They are rendered from source, so a question about what a model
was shown is answered by the tree that ran, at the commit its launch receipt names. For a solver,
`live-solve.ts` without `--live` builds the condition and prints what the solver would read, with no
model called.

## When one fact is not enough

A fact says how the system stands. It does not say what a command will do from there. When the
question is "what happens next", cut a seed at that point and rehearse it ([rehearsal](rehearsal.md)).
