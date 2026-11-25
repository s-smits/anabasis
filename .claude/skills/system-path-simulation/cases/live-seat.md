# Live seat

A live seat places a real model in a single seat starting from a recorded campaign state when the
question depends on model behaviour rather than deterministic runtime logic. Seat types, cut
points, budget sizing, and concurrency rules are defined in
[SKILL.md](../SKILL.md#3-seat-a-model). Re-running a comparison round after a recorded
`build.finished` compares without rebuilding the harness, thereby seating only the comparison
solves.

## The script

```text
bun --env-file=<file> .claude/skills/system-path-simulation/scripts/live-seat.ts start \
  --tree <worktree> --name sim-<what> --out <scratch>/arm-a --cap 30 --minutes 90 \
  -- tools/eval/examine.ts --session x-9 --examiner <model> ...
bun .claude/skills/system-path-simulation/scripts/live-seat.ts read --seat <scratch>/arm-a
```

- `start` refuses any campaign that is not a seed (rule 4) or that contains a dangling symlink (as
  `rsync -a` can leave behind; prefer seeding directly on the target host, or copy with
  `rsync -aL`). It records the starting event index, commit SHA, and command in `<out>.json`,
  executes the command under `nice` in its own process group on the specified login, terminates it
  upon reaching `--cap` dollars billed since start or `--minutes` elapsed (note that an in-flight
  API request can slightly overshoot the cap), streams each admission, ruling, and session ending
  as it occurs, and prints the summary reading on exit. Launch it as a single background command;
  `bun run runs stop sim-<what>` lists any leftover root processes.
- `read` reports elapsed minutes and billed dollars (`billedBetween`), sessions, drafts, task
  admissions by outcome category, holds, turn counts of the reference's valid answers to
  pre-v0.14 `try_reference` probes (`gateAnswers`; empty on current trees), tool call counts, and (with `--mention`) calls matching a
  given string without quoting any task or answer content. On a seed log it starts at the seed cut;
  `--log` accepts an absolute path and requires `--from <event>` outside a seed. Under the current
  admission schema (`TASK_ADMISSION`, `src/examiner/write.ts`), task admissions record only whether
  a draft passed or was refused, so current seats report `package`, whereas `every`, `some`,
  `none`, and `none, proved` appear only when reading historical logs.
- `watch --seat <prefix>` streams seat events until the seat terminates, then returns.
- `due <prefix>...` prints events written by each seat since the previous check (`<prefix>.seen`).
  With `--hook`, it writes updates to stderr and exits 2, which a Claude Code `Stop` hook in the
  worktree's `.claude/settings.local.json` turns into a mandatory agent turn:

  ```json
  { "hooks": { "Stop": [{ "hooks": [{ "type": "command",
    "command": "bun .claude/skills/system-path-simulation/scripts/live-seat.ts due <scratch>/arm-a <scratch>/arm-b --hook" }] }] } }
  ```

- `stop <prefix>...` terminates active seats once their question is answered and marks unstarted
  prefixes closed so waiting launch scripts do not start them. On remote hosts, use
  `stop --host <name>` rather than `pkill -f` over SSH, which can match the SSH session's own
  command line.
- `prompt --tree <worktree> --name sim-<what> -- tools/eval/examine.ts <its flags>` renders the exact
  prompt that the Examiner session would receive under that tree's code without launching a model;
  it currently supports only Examiner sessions.
- `compare <prefix>... [--gates N]`, `pairs <control>,<arm>...`, and `calls <log or folder>...`
  aggregate paired arm rounds ([optimize](optimize.md), steps 3 and 6).

Two arms of an ablation use two seeds cut at the identical event, either in separate worktrees
differing by one commit or in one worktree differing by a single CLI flag.

## Probing smaller than a solve

A backend can be probed outside any campaign directly through its provider (`claudeProvider`,
`src/agent/backends/claude.ts`) using a scratch script; any confirmed behaviour belongs in
`test/claude-backend.test.ts`.

## Rules of this case

- **Use the production prompt verbatim.** Nothing may inform the model that it is in a simulation
  or hint at the desired outcome. When testing a prompt edit, that edit is the sole experimental
  variable and the seed holds every other condition constant.
- **Budget Examiner seats in drafts.** An Examiner's spend scales with its turns, bounded by
  `--proposals`.

Report a single live seat as a verified execution path rather than a statistical measurement of
model performance. Nothing produced by a seed enters a production campaign.
