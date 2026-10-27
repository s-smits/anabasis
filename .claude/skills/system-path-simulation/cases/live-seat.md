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
| An Examiner session | cut where the session should start | `bun --env-file=<file> tools/d1b/examine.ts <examine flags> --name sim-<what> --session x-<n>` | the Examiner's turns, admission solves and their Referee rulings where seated |
| A round's solves, without its Builder | cut by `--events` right after a recorded `build.finished` | the round again, with that session's `--session` | the comparison's solves, under its `--cap` |
| A whole round | cut before the round's `build.started` | the round, with a `--session` the seed has not seen | a Builder session and every solve |
| One Referee ruling | cut by `--events` right before the recorded ruling | `scripts/referee-seat.ts --solve <id> --reviewer <model>`, as `start`'s command | one ruling: its replay, probes and model turns |
| One solve | none: it reads the stored sweep | `bun tools/m0/live-solve.ts <pack flags> --task <id> --live` | one solve |

The second row rests on a round keeping no state of its own: run again under a session whose
Builder finished, it compares from the log and does not build again. The kept harness is
in the seed's `states/`.

Campaign commands apply their own admission to a seed as they do to its source campaign. The
stored-sweep probe is separate and applies no campaign admission.

## Run it with the script

`scripts/live-seat.ts` starts a seat as `bun run runs launch` starts a campaign, and reads what it
wrote with the readers the campaign has:

```text
bun --env-file=<file> .claude/skills/system-path-simulation/scripts/live-seat.ts start \
  --tree <worktree> --name sim-<what> --out <scratch>/arm-a --cap 30 --minutes 90 \
  --mention reference-harness -- tools/d1b/examine.ts --session x-9 --examiner <model> ...
bun .claude/skills/system-path-simulation/scripts/live-seat.ts read --seat <scratch>/arm-a
```

- `start` refuses a campaign that is no seed (rule 4), keeps the event the seat began at, the
  commit and the command in `<out>.json`, runs the command niced in a process group of its own on
  the login named, ends the group at `--cap` dollars billed since that event or at `--minutes`, and
  prints the reading when the group is gone. It checks every 30 seconds, so an in-flight request
  can take it past the named bound. It prints each gate, ruling and session end as it lands. An abrupt end can leave
  roots; inspect them with `bun run runs stop sim-<what>` and follow run-management for cleanup.
- Run `start` as one background command and wait for its end. It is the seat's end, so nothing
  re-arms a monitor every 30 minutes, and no turn ends with a seat running unwatched: the
  ablation's watcher did both on 18 October.
- `read` gives the stretch's minutes and billed dollars (`billedBetween`), its sessions and how
  they ended, the drafts proposed, each gate as `every`, `some`, `none`, `none, proved`, `package`
  or `unread` (`measuredGate`, `heldAtGate`), how many were held, the turns the reference's valid
  gate answers took (`gateAnswers`), the calls by tool, and with `--mention` the calls whose
  arguments name a text. It quotes no task and no answer.
- `watch --seat <prefix>` prints the same lines for a seat already running, from where it began,
  until its process group is gone, then the reading: one Monitor in Claude Code, or any agent's
  line reader, follows a seat that another command started.
- `due <prefix>...` prints what each seat wrote since `due` last looked (kept in `<prefix>.seen`).
  With `--hook` it writes them to stderr and exits 2 when there is any, so an agent harness that
  reads exit codes stops the agent from ending its turn with a seat's events unread. In Claude Code
  that is a Stop hook in the worktree's `.claude/settings.local.json`, removed with the seats:

  ```json
  { "hooks": { "Stop": [{ "hooks": [{ "type": "command",
    "command": "bun .claude/skills/system-path-simulation/scripts/live-seat.ts due <scratch>/arm-a <scratch>/arm-b --hook" }] }] } }
  ```

- `stop --seat <prefix>` ends a seat this host started once its question is answered, and its
  `start` prints the reading with that reason. `compare <prefix>...` sets several seats' counts in
  columns, each cut after its first N gates with `--gates N`. `prompt --tree <worktree> --name
  sim-<what> -- tools/d1b/examine.ts <its flags>` prints what that Examiner session would be told,
  composed by the tree's own code, and seats nothing. All three serve rounds of arms
  ([optimize](optimize.md)).
- `start` uses `capturedExecPath`, the Bun that runs it, and sets `RUN_REMOTE=0` for the seat.
  Its seed and selected login stay on the local runner.

Two arms of one question are two seeds cut at the same event, each in a worktree of its own at the
commit that differs in the one variable, or at one commit with the variable as a flag where a
command takes one (`--reference-home on|off`, on by default since 19 October). Read both with
`read` and set the counts side by side.

## Smaller than a solve

A backend can be seated with no campaign at all: its own provider (`claudeProvider` in
`src/agent/backends/claude.ts`), one prompt, one tool and the small model, in a script kept outside the
tree. It answers what the backend's child does around one turn. On 8 October 2026 such
a probe closed a query on a parked `submit` and counted the child's calls and its lifetime, on the
tree before a fix and on the tree after. What it proves goes into the backend's test
(`test/claude-backend.test.ts`), since the probe itself is not kept.

One step up is `bun tools/m0/live-solve.ts <pack flags> --task <id> --live --solver <model>`.
It walks the wall, tools, verifier and teardown using a stored sweep's harness and limits. It is
a legacy sweep probe, not a campaign solve under the current default of 20 model turns and
30 minutes (`LIMITS`, `tools/d2/campaign.ts`). Size it from the source before asking to run it.

## Rules that are only this case's

- **The prompt is production's.** Nothing is added to tell the model it is in a simulation or what
  is hoped for. If a prompt is what you are testing, that edit is the one variable, and the seed is
  what holds everything else still.
- **The env file is a path.** `--env-file <file>` is passed on and never opened. Do not print it,
  copy it or look for another.
- **One live seat a login at a time.** A login at its session limit fails every solve in flight. On
  8 October 2026 that took three solves and $8.25 with it.
- **Size it in drafts, not in sessions.** An Examiner session that its gate refuses finishes on its
  own: on 18 October arm A finished after 20 drafts. Its dollars are its gate solves, about $0.25
  a draft at three solves of the reference, and its Examiner's turns besides. That is a dated
  measurement, not a price estimate for another model or domain.
- **A live seat's result is one sample.** One solve a side says the path works. It says nothing of
  a rate. Report it as a path proven, not as a model measured.

## What goes back to the campaign

Nothing. A seed's solves stay in its log. AGENTS.md, section 10, owns what a measured run may use:
it opens fresh and continues at its own commit. A seed proves a path and shows no climb.
