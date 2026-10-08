# Live seat

A real model in one seat, from a recorded position. Use it when the question is what a model does,
and a script would only say what you told it to. It spends money, so it needs the operator's word
to spend, and a size said before it starts (launch-run's sizing: solves times dollars and minutes).

As of 2026-10-08 no live seat has been run from a seed. What follows is what a seed makes possible
by construction, since a seed is a campaign's folder and every command takes `--name`. Treat the
first one as a simulation of this case too: predict it, and write down what it found.

## Seat one thing

| the seat | the seed | the command | what is paid |
| --- | --- | --- | --- |
| An Examiner session | cut where the session should start | `bun run runs launch --env-file <file> <examine flags> --name sim-<what> --session x-<n>` | the Examiner, and each stronger solve |
| A round's solves, without its Builder | cut by `--events` right after a recorded `build.finished` | the round again, with that session's `--session` | the screening and scoring solves |
| A whole round | cut before the round's `build.started` | the round, with a `--session` the seed has not seen | a Builder session and every solve |
| One solve | none: it reads the stored sweep | `bun tools/m0/live-solve.ts <pack flags> --task <id> --live` | one solve |

The second row rests on a round keeping no state of its own: run again under a session whose
Builder finished, it screens and scores from the log and does not build again. The kept harness is
in the seed's `states/`.

Start each through `bun run runs launch`, so the preflight reads the seed as it would the campaign
and the receipt keeps the commit. `--dry-run` first: a seed that would be refused is a finding
before a dollar is spent.

## Smaller than a solve

A backend can be seated with no campaign at all: its own provider (`claudeProvider` in
`src/backends/claude.ts`), one prompt, one tool and the small model, in a script kept outside the
tree. It costs cents and answers what the backend's child does around one turn. On 2026-10-08 such
a probe closed a query on a parked `submit` and counted the child's calls and its lifetime, on the
tree before a fix and on the tree after. What it proves goes into the backend's test
(`test/claude-backend.test.ts`), since the probe itself is not kept.

## Rules that are only this case's

- **The prompt is production's.** Nothing is added to tell the model it is in a simulation or what
  is hoped for. If a prompt is what you are testing, that edit is the one variable, and the seed is
  what holds everything else still.
- **The env file is a path.** `--env-file <file>` is passed on and never opened. Do not print it,
  copy it or look for another.
- **One live seat a login at a time.** A login at its session limit fails every solve in flight. On
  2026-10-08 that took three stronger solves and $8.25 with it.
- **A live seat's result is one sample.** One solve a side says the path works. It says nothing of
  a rate. Report it as a path proven, not as a model measured.

## What goes back to the campaign

Nothing. A seed's solves are never copied into the campaign they came from: they ran from a cut
log, under a session the campaign never held. When a live seat shows the real campaign should take
a step, the step is taken on the real campaign through launch-run, and paid for there.
