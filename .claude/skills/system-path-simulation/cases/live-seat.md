# Live seat

A live seat places a real model in a single seat starting from a recorded campaign state when the
question depends on model behaviour or real provider/sandbox integration rather than deterministic
runtime logic. Seat types, cut points, archive-first screening, and concurrency rules live in
[SKILL.md](../SKILL.md#tier-3-scriptslive-seatts--report). Re-running a comparison round cut with
`--before g-<n>` compares without rebuilding the harness, seating only the comparison solves and
any triggered Auditor or pairwise judge.

## The script

```sh
bun --env-file=<env> .claude/skills/system-path-simulation/scripts/live-seat.ts start \
  --tree <worktree> --name sim-<what> --out <scratch>/arm-a --cap 6 --minutes 30 \
  --login <N> -- tools/eval/examine.ts --session x-9 --examiner <model> ...
bun .claude/skills/system-path-simulation/scripts/live-seat.ts read --seat <scratch>/arm-a
```

- `start` refuses any campaign that is not a seed (`sim-<what>` with `seed.json`) or that holds a
  dangling symlink (`rsync -a` leaves them; seed directly on the target host or copy with
  `rsync -aL`). It checks host 1-minute load (warning when overloaded), records the start event
  index, commit SHA, and command in `<out>.json`, executes the command under `nice` in its own
  process group on the named login, polls log growth every 5 s, stops the process tree and
  releases any leftover sandboxes (`tools/runs/stop.ts:release`) upon reaching `--cap` dollars
  billed or `--minutes` elapsed (in-flight API calls may still bill slightly past `--cap`),
  streams each event (`newsOf`) as it lands, and prints the summary reading on exit. Launch as one
  background command and wait for completion rather than polling.
- `read` reports elapsed minutes, billed dollars (`billedBetween`), sessions, tool calls, and
  `--mention` counts without quoting task or answer text, adapting its output to the active seat
  kinds:
  - **Draft:** `exam.drafted`, `referee.draft` verdicts, `contract.frozen`
  - **Builder:** `build.checkpoint`, practice solves (`finished/started`), promotions, reverts
  - **Comparison:** `comparison.started`/`reported`, comparison solves, `referee.finding` rulings
  - **Examiner:** `task.proposed`, `task.gate` outcomes, held count (historical pre-v0.14 room
    solves and turn spreads appear only when present in the log)
  - **Campaign endings:** `campaign.ended`
  On a seed log, `read` starts at the seed cut; `--log` accepts an absolute path and requires
  `--from <event>` outside a seed.
- `stop <prefix>...` terminates active seats' full process trees, releases their leftover
  sandboxes, and marks unstarted prefixes closed so waiting launch scripts do not start them. On
  remote hosts, prefer `stop` over `pkill -f` over SSH.
- `prompt --tree <worktree> --name sim-<what> -- tools/eval/examine.ts|draft.ts <its flags>`
  renders the exact system prompt, opening, tool descriptions, tool parameter schemas (`=== SCHEMA`),
  and nudges without launching a model or writing log events.
- `compare <prefix>... [--gates N]`, `pairs <control>,<arm>...`, and `calls <log or folder>...`
  aggregate paired arm rounds ([optimize](optimize.md)).

Two arms of an ablation use two seeds cut at the identical event (`sim-<what>-before` and
`sim-<what>-after`), either in separate worktrees differing by one commit or in one worktree
differing by a single CLI flag. Use `--reviewer` / `--reviewer-effort` on `tools/eval/draft.ts` to
override a seed's recorded draft reviewer explicitly.

## Probing smaller than a solve

A backend can be probed outside any campaign directly through its provider (`claudeProvider`,
`src/agent/backends/claude.ts`) using a scratch script; any confirmed behaviour belongs in
`test/claude-backend.test.ts`.

## Rules of this case

- **Use the production prompt verbatim.** Nothing may inform the model that it is in a simulation
  or hint at the desired outcome. When testing a prompt edit, that edit is the sole experimental
  variable and the seed holds every other condition constant.
- **Keep path checks surgical.** Bound Examiner seats with `--proposals` / `--turns`, Builder seats
  with `--moves 1 --turns` / `--practice-solves`, and standalone comparisons with `--cap`. Never
  run a \$15–\$40 single-draw arm hoping a <5% edge case fires when an archived event can be
  replayed at Tier 1–2.

Report a single live seat as a verified execution path (`exercised live`) rather than a
statistical measurement of model performance (`AGENTS.md` rule 6). Nothing produced by a seed enters a
production campaign.
