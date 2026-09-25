---
name: launch-run
description: "Launch authorised Anabasis runs or model pairs through one Bun TypeScript command, or stop an identified run under existing user authority. Owns preparation, exact condition checks, startup and stop mechanics; whole-run-investigation's outcome reference assesses whether stopping is justified."
---

# Launch a run

Select the model with `--model astra`, `--model sol` or `--model opus`.
The launcher applies that model's complete standard preset automatically. Do not restate
effort or backend flags in ordinary launch requests or automations. Add optional flags only
when the user specifies a non-default requirement. `--condition` remains a legacy alias;
never supply both. The launcher's `CONDITIONS` table owns the model and three slot settings.

Use the TypeScript launcher from current main with the selected source's pinned Bun. It probes
the launched source before spending by running that tree's own `probe.ts`, which imports that
tree's product modules. A source whose modules moved therefore still probes: main's probe could
not open 03b8cb266, whose pi layer had replaced `src/backends/claude-backend.ts`, and the
launch of run 08c0f2 had to borrow the source tree's launcher. The launcher itself (options,
credential capture, gate, startup checks) stays main's; never select an older runtime or
silently drop the timed stop. Bun executes the launcher directly; no build step or generated
driver is needed. A launch request authorises the command.

```sh
bun .claude/skills/launch-run/scripts/launch.ts truss --model astra --source <resolved-full-sha>
bun .claude/skills/launch-run/scripts/launch.ts truss --model sol,opus --source <resolved-full-sha>
bun .claude/skills/launch-run/scripts/launch.ts truss truss --model sol,astra --source <resolved-full-sha> --stop-after-ms 14400000
bun .claude/skills/launch-run/scripts/launch.ts custom --prompt "<the user's exact one-line prompt>" --source <resolved-full-sha>
```

To continue a named run's project when the user asks for it ("continue from the truss run
above"), read that run's `opening.json` project id and add `--project <id>` with the same preset
or prompt. The controller then continues from the recorded campaign evidence on the new source;
the launcher refuses an opening that created a fresh project instead. There is no steering text:
the Builder chooses the next experiment from evidence.

Use one or two lines through `custom --prompt`, or the `truss` preset in `scripts/options.ts` (`--list` prints it).
Public files enter through `fullrun --context`; do not create `asks/`, verifier manifests or a second domain brief.
Put the requested pair in one invocation. It prepares each worktree once, runs one TypeScript
probe per run, gates the shared source once with `bun run gate`, then starts the runs in quick succession.
Keep the existing worktree checks and the detachment into the per-user service manager
(launchd on macOS, `systemd-run --user` on Linux; `scripts/service.ts` owns the difference); do
not add wrapper scripts, repeat installations or run a gate separately before this command.

Always resolve the latest intended published PR stack at launch time, including scheduled
launches, unless the user explicitly selects another revision. Fetch current heads and use
[stack-hop](../stack-hop/SKILL.md) to verify every child contains its latest published parent;
restack stale edges before launching. Use current `origin/main` only when no intended stack is
open. Pass the resolved full SHA explicitly through `--source`; the CLI's omitted-source
default remains `origin/main` and does not resolve the stack. Let the launcher fork that commit
into a fresh isolated run worktree. Keep the source checkout and existing runs untouched.

Model and budget defaults are Opus 5 medium/medium/medium, 25 tasks and 1,320 provider
turns per run. Sol uses high/high/medium; Astra uses medium/low/low; Fable 5.1 uses medium/medium/medium.
Each preset occurrence runs once per condition. Repeat a preset only for explicitly authorised
replicas; their run ids gain separate `r1`, `r2` markers. The four-run example above means two
truss runs per model. A preset authorises its exact prompt; never enrich it.

`truss` is the one preset: a best answer under a strict limit, several interacting requirements
and specified loss or fault scenarios in one request. Stacking them is what made truss tasks
hard: on the 2026-09-15 pack series one added interaction per task still passed 22 of 23
verified cases (Sol high), and all of them stacked inside the same mass limit passed 7 of 20
(Sol high) and 2 of 23 (Opus 5). A custom prompt of that shape stacks the same way. `--list`
prints the preset.

The probe reads source identity and parses the request using the selected product revision,
then initializes the real confined worker without a model turn, and runs one minimal Builder-slot
turn at low effort on every kind so a shared session or usage limit refuses before any spend, with
the provider's reset clause. Its temporary files stay
outside the closed checkout. The launcher verifies the opening's source, prompt, arguments,
budget and three model slots, rejects an immediate terminal, and checks that the process is
still running. Startup proves neither useful model work nor an outcome.

Claude uses `CLAUDE_CODE_OAUTH_TOKEN` from the main checkout's `.env`, or explicit `--env-file`,
and carries it into the run's frozen env. Codex conditions use the selected `CODEX_HOME/auth.json`, defaulting to the current account.
Capture each selected credential once per batch; keep snapshots private and secrets out of
arguments and reports. Report a missing credential; do not search other accounts or substitute keys.

Use `--help` for limits and paths; `--dry-run` plans without setup, secrets or launch.
Experiment predictions belong to the campaign workflow, outside this launch helper.

## See what is running

`bun run runs` answers "what is on this machine and what can I do about it" from recorded
evidence, so no part of it needs a process grep or a file timestamp.

```sh
bun run runs                    # every run, open ones first: state, loop position, cases, turns, pid, worktree
bun run runs show <runId>       # opening identity, authoring, batteries by claim time, terminal, recent rows
bun run runs stop <runId> --yes # the stop below, with the service and worktree read from the receipt
bun run runs resume <runId>     # the same prompt, pins, budget and project as a new run in that campaign
bun run runs pause              # why a fullrun cannot be paused, and what to use instead
bun run runs pulse [<runId> ...] # what moved since the last look, every 290 s; --once for one look
```

`pulse` watches every open run, or the ones named, and prints a status line per run in the terms
of its stage, then one line per event: `◆` a stage worth reading, `⚠` something that may be wrong,
`·` a smaller fact, each with the campaign file that holds it. The first look has nothing to differ
from, so it prints the status lines alone. A file written in a schema this tree no longer reads is
named as unread rather than shown as empty.

`stop` and `resume` print their plan and do nothing without `--yes`. A run whose process is gone
but which recorded no terminal reads `orphaned`, never `live`. A live run's provider-turn counter
lives in the ledger its owner holds open, so the listing reports it unknown rather than zero.

## Stop a run

Use [the outcome reference](../whole-run-investigation/references/outcome-review.md#whether-a-live-run-is-still-useful)
when the question is whether a run should stop. This section executes an authorised decision;
neither a timer nor a stopped run authorises a replacement or changes accounts/credentials.

`--stop-after-ms` is a soft boundary: the current round finishes and records before stopping.
For an authorised timed interruption use `--kill-after-ms`. The launcher starts an independent
launchd operator timer before starting each controller. The timer checks the exact service and
its loaded worktree plist, sends SIGTERM, gives closure 30 seconds, then uses launchd bootout
and verifies service absence. Fresh project allocation remains with the controller.

```sh
bun .claude/skills/launch-run/scripts/launch.ts truss --model sol --source <full-sha> --kill-after-ms 180000
```

The three-minute value is the signal time; termination can take another 35 seconds. For a
five-hour maximum, use `--kill-after-ms 17940000` (4 h 59 min), leaving one minute for closure.
The host must remain awake. Do not substitute the retired `--wall-deadline-ms` flags or describe
the soft round boundary as a maximum. A timed interruption can leave in-flight work unaccepted.

Read `<worktree>/.scratch/quick-run/launch.json` for the exact service, opening and source, and
`stop.json` beside it for the timer's outcome. The `.ready` sibling proves timer startup only.
Verify the controller terminal through the measured tree's evidence reader, the controller
lock holder and any captured child processes. Service absence alone does not prove that every
descendant was reaped. Preserve verified, unaccepted and non-result counts and all receipts;
never repair controller evidence or delete its lock to manufacture closure.

For an immediate authorised stop, read the launch receipt and invoke `scripts/stop.ts` in this
skill with
its exact `--worktree`, `--run`, `--service`, current epoch milliseconds as `--deadline`, and
`--grace 30000`. If a timer is already armed, do not start a competing one: signal the recorded
service with `launchctl kill TERM <service>` (Linux: `systemctl --user kill --kill-whom=main
--signal=SIGTERM <service>`), then inspect closure and use `launchctl bootout <service>` (Linux:
`systemctl --user stop <service>`) only for that still-owned service. Preserve the scheduled timer and its receipts.
Never use a broad process-name kill or stop a sibling run. After closure, the completed timer
service `<controller-service>.stop` may be booted out; keep its files for evidence.

A scheduled launch-and-stop automation must read this skill, pass the timed-stop flag in its
single launch command, retain exact per-run receipts, and verify closure after the deadline.
If timer readiness fails, do not launch the controller. If closure fails, report the owning run
and required action; do not silently launch replacements.

Return each run id, source, condition, project, current startup status and log. On a failure,
read the terminal and log before deciding what remains authorised. Do not silently launch
additional paid runs beyond the requested batch or stop a sibling. During a quiet Builder turn,
use `bun run outcome <campaignDir> --builder` in its worktree for recorded checkpoints.
Silence alone is not a reason to signal or relaunch.
