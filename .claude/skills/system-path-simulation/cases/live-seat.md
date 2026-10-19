# Live seat

A real model in one seat, from a recorded position. Use it when the question is what a model does,
and a script would only say what you told it to. It spends money, so it needs the operator's word
to spend, and a size said before it starts (run-management's sizing: solves times dollars and minutes).

The first live seats from a seed ran on 18 and 19 October: the supply ablation, two Examiner
sessions over one seed of esp32-fresh-opus cut after its promotion, one as the Examiner is and one
with a copy of the reference harness in its home. What they taught is in "Run it with the script"
and in the rules below.

## Seat one thing

| the seat | the seed | the command | what is paid |
| --- | --- | --- | --- |
| An Examiner session | cut where the session should start | `bun --env-file=<file> tools/d1b/examine.ts <examine flags> --name sim-<what> --session x-<n>` | the Examiner's own turns |
| A round's solves, without its Builder | cut by `--events` right after a recorded `build.finished` | the round again, with that session's `--session` | the comparison's solves, under its `--cap` |
| A whole round | cut before the round's `build.started` | the round, with a `--session` the seed has not seen | a Builder session and every solve |
| One solve | none: it reads the stored sweep | `bun tools/m0/live-solve.ts <pack flags> --task <id> --live` | one solve |

The second row rests on a round keeping no state of its own: run again under a session whose
Builder finished, it compares from the log and does not build again. The kept harness is
in the seed's `states/`.

Each command asks its own admission before its first event and refuses the seed as it would the
campaign; a seed that is refused is a finding before a dollar is spent.

## Run it with the script

`scripts/live-seat.ts` starts a seat as `bun run runs launch` starts a campaign, and reads what it
wrote with the readers the campaign has:

```text
bun --env-file=<file> .claude/skills/system-path-simulation/scripts/live-seat.ts start \
  --tree <worktree> --name sim-<what> --out <scratch>/arm-a --cap 30 --minutes 90 --login 1 \
  --mention reference-harness -- tools/d1b/examine.ts --session x-9 --examiner <model> ...
bun .claude/skills/system-path-simulation/scripts/live-seat.ts read --seat <scratch>/arm-a
```

- `start` refuses a campaign that is no seed (rule 4), keeps the event the seat began at, the
  commit and the command in `<out>.json`, runs the command niced in a process group of its own on
  the login named, ends the group at `--cap` dollars billed since that event or at `--minutes`, and
  prints the reading when the group is gone. It prints each gate's word as it lands.
- Run `start` as one background command and wait for its end. It is the seat's end, so nothing
  re-arms a monitor every 30 minutes, and no turn ends with a seat running unwatched: the
  ablation's watcher did both on 18 October.
- `read` gives the stretch's minutes and billed dollars (`billedBetween`), its sessions and how
  they ended, the drafts proposed, each gate as `every`, `some`, `none`, `none, proved`, `package`
  or `unread` (`measuredGate`, `heldAtGate`), how many were held, the turns the reference's valid
  gate answers took (`gateAnswers`), the calls by tool, and with `--mention` the calls whose
  arguments name a text. It quotes no task and no answer.
- The `bun` on the PATH sends a command to a remote host where `RUN_REMOTE` is set (run-remote
  gates); `start` runs the seat with the Bun that runs it and `RUN_REMOTE=0`, since a seat's login
  and its seed are on this host. The ablation's second arm needed both by hand.

Two arms of one question are two seeds cut at the same event, each in a worktree of its own at the
commit that differs in the one variable, or at one commit with the variable as a flag where a
command takes one (`--reference-home on` since 19 October). Read both with `read` and set the
counts side by side: on 18 October arm A put 20 drafts and held 0, each answered in 3 of 3, for
$13.74 in 42 minutes.

## Smaller than a solve

A backend can be seated with no campaign at all: its own provider (`claudeProvider` in
`src/backends/claude.ts`), one prompt, one tool and the small model, in a script kept outside the
tree. It costs cents and answers what the backend's child does around one turn. On 2026-10-08 such
a probe closed a query on a parked `submit` and counted the child's calls and its lifetime, on the
tree before a fix and on the tree after. What it proves goes into the backend's test
(`test/claude-backend.test.ts`), since the probe itself is not kept.

One step up is one whole solve on the small model: `bun tools/m0/live-solve.ts … --live --solver
claude/<small model>`, which walks the wall, the tools, the verifier and the teardown for under a
dollar (343 s and $0.46 on 2026-10-08). Two things to know. The sweep's compaction window is refused
for a model served a smaller context, rightly, so that solve ran from a scratch copy of the command
with compaction off, and said so. And the teardown removes what Claude Code wrote: to read its own
record of its calls, copy `<solve>.host/model/Library/Caches/` out several times a second while the
solve runs. The solve's folders are under the system temp folder's `ana-built-bash`.

## Rules that are only this case's

- **The prompt is production's.** Nothing is added to tell the model it is in a simulation or what
  is hoped for. If a prompt is what you are testing, that edit is the one variable, and the seed is
  what holds everything else still.
- **The env file is a path.** `--env-file <file>` is passed on and never opened. Do not print it,
  copy it or look for another.
- **One live seat a login at a time.** A login at its session limit fails every solve in flight. On
  2026-10-08 that took three solves and $8.25 with it.
- **Size it in drafts, not in sessions.** An Examiner session that its gate refuses finishes on its
  own: on 18 October arm A finished after 20 drafts. Its dollars are its gate solves, about $0.25
  a draft at three solves of the reference, and its Examiner's turns besides.
- **A live seat's result is one sample.** One solve a side says the path works. It says nothing of
  a rate. Report it as a path proven, not as a model measured.

## What goes back to the campaign

Nothing. A seed's solves are never copied into the campaign they came from: they ran from a cut
log, under a session the campaign never held. When a live seat shows the real campaign should take
a step, the step is taken on the real campaign through run-management, and paid for there.
