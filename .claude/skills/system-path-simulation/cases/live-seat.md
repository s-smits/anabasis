# Live seat

A real model in one seat, from a recorded position, for when the question is what a model does. It
needs the operator's word and a size stated first (solves times dollars and minutes). The seats and
cuts are in [SKILL.md](../SKILL.md#3-seat-a-model); a round rerun under a session whose Builder
finished compares without building again, which seats its solves alone.

## The script

```text
bun --env-file=<file> .claude/skills/system-path-simulation/scripts/live-seat.ts start \
  --tree <worktree> --name sim-<what> --out <scratch>/arm-a --cap 30 --minutes 90 \
  --mention reference-harness -- tools/d1b/examine.ts --session x-9 --examiner <model> ...
bun .claude/skills/system-path-simulation/scripts/live-seat.ts read --seat <scratch>/arm-a
```

- `start` refuses a campaign that is no seed (rule 4), or one whose `checks/`, `exams/` or `states/`
  hold a dangling link (as `rsync -a` leaves; seed on the seating host, or copy with `rsync -aL`). It
  records the starting event, commit and command in `<out>.json`, runs the command niced in its own
  process group on the named login (`RUN_REMOTE=0`, `capturedExecPath`), polls the log every 30
  seconds, ends the group at `--cap` dollars billed since the start or at `--minutes` (an in-flight
  request can overshoot), prints each admission, ruling and session end as it lands, and the reading
  at the end. Run it as one background command. Inspect leftover roots with `bun run runs stop
  sim-<what>`.
- `read` reports minutes and dollars (`billedBetween`), sessions, drafts, each admission as `every`,
  `some`, `none`, `none, proved`, `package` or `unread` (`measuredGate`, `heldAtGate`), holds, the
  reference's room-solve turns (`gateAnswers`), calls by tool, and with `--mention` the calls naming a
  text, quoting no task or answer. On a seed's log it starts at the cut unless `--from` says otherwise.
- `watch --seat <prefix>` streams those lines until the seat ends, and only then returns.
- `due <prefix>...` prints what each seat wrote since it last looked (`<prefix>.seen`). With
  `--hook` it writes to stderr and exits 2, which a Claude Code Stop hook in the worktree's
  `.claude/settings.local.json` turns into a turn the agent must take:

  ```json
  { "hooks": { "Stop": [{ "hooks": [{ "type": "command",
    "command": "bun .claude/skills/system-path-simulation/scripts/live-seat.ts due <scratch>/arm-a <scratch>/arm-b --hook" }] }] } }
  ```

- `stop <prefix>...` ends seats whose question is answered and closes prefixes not yet seated, so a
  seating script still waiting seats nothing. On another host use `stop --host <name>`, never `pkill
  -f` over ssh, which matches the ssh session's own command line.
- `prompt --tree <worktree> --name sim-<what> -- tools/d1b/examine.ts <its flags>` prints what that
  Examiner session would be told, composed by the tree's code, and seats nothing.
- `compare <prefix>... [--gates N]`, `pairs <control>,<arm>...` and `calls <log or folder>...` read
  rounds of arms ([optimize](optimize.md), steps 3 and 6).

Two arms of one question are two seeds cut at the same event, each in a worktree at the commit that
differs in the one variable, or at one commit with the variable as a flag.

## Smaller than a solve

A backend can be probed with no campaign: its provider (`claudeProvider`,
`src/agent/backends/claude.ts`), one prompt, one tool and a small model, in a script outside the
tree; what it shows goes into `test/claude-backend.test.ts`. `bun tools/m0/live-solve.ts <pack
flags> --task <id> --live --solver <model>` runs one solve under a stored sweep's limits, which
differ from a campaign's `LIMITS` (`tools/d2/campaign.ts`).

## Rules of this case

- **The prompt is production's.** Nothing tells the model it is simulated or what is hoped for; if a
  prompt is under test, that edit is the variable and the seed holds everything else still.
- **The env file is a path.** `--env-file <file>` is passed on, never opened, printed or copied.
- **One live seat a login at a time.** A login at its session limit fails every solve in flight.
- **Size an Examiner seat in drafts.** A session its admission keeps refusing finishes on its own;
  its dollars are its turns and the `try_reference` solves it asks for, at most `--proposals`.
- **A seat is one sample.** Report it as a path proven, never as a model measured.

Nothing goes back to the campaign (`AGENTS.md`, section 10).
