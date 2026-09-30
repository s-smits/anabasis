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
the launched source before spending by running that tree's own `probe.ts`, whose static imports
resolve in the launched tree, so a source whose modules moved still probes: main's probe could
not open 03b8cb266, whose pi layer had replaced `src/backends/claude-backend.ts`, and the
launch of run 08c0f2 had to borrow the source tree's launcher. The two copies meet only at
`probeArgs` and the JSON the probe prints, which is why neither changes shape without the other.
The launcher itself (options, credential capture, gate, startup checks) stays main's, and
`launch.json` records its commit as `launcher`; never select an older runtime or
silently drop the timed stop. Bun executes the launcher directly; no build step or generated
driver is needed. A launch request authorises the command.

```sh
bun .claude/skills/launch-run/scripts/launch.ts truss --model astra --source <resolved-full-sha>
bun .claude/skills/launch-run/scripts/launch.ts truss --model sol,opus --source <resolved-full-sha>
bun .claude/skills/launch-run/scripts/launch.ts truss truss --model sol,astra --source <resolved-full-sha> --stop-after-ms 14400000
bun .claude/skills/launch-run/scripts/launch.ts --prompt "<the user's exact one-line prompt>" --source <resolved-full-sha>
```

To continue a named run's project when the user asks for it ("continue from the truss run
above"), read that run's `opening.json` project id and add `--project <id>` with the same preset
or prompt. The controller then continues from the recorded campaign evidence on the new source;
the launcher refuses an opening that created a fresh project instead. There is no steering text:
the Builder chooses the next experiment from evidence.

Use one or two lines through `--prompt`, or the `truss` preset in `scripts/options.ts` (`--list` prints it).
A `--prompt` run is named `standard`; name `standard` again for replicas, and `custom`, its name
before 2026-09-30, still parses. A run id reads `<preset>-<model>-<instant>-pr<N>-<sha7>`: the pull
request that carried the source commit, or `main-<sha7>` on main's head, and the commit's first
seven hex. `runs pulse` drops the instant.
Public files enter through `fullrun --context`; do not create `asks/`, verifier manifests or a second domain brief.
Put the requested pair in one invocation. It prepares each worktree once, runs one TypeScript
probe per run, settles the shared source's gate once, then starts the runs in quick succession.
`--gate auto`, the default, runs `bun run gate` only when the commit has no whole-gate pass in
`ana-gate-passed` under the common Git directory, the record the pre-push hook writes when a tip
passes on a checkout holding only its own bytes; a pass the launcher runs on its clean run tree is
recorded there the same way, so one commit is gated once however many batches launch it. Of the
25 launch gates recorded between 2026-09-24 and 2026-09-28, 22 passed, two were ended by the host
and the one refusal was of a commit never pushed, so a published stack head, which the hook has
already gated, rarely leaves the launch gate anything to find. `--gate run` gates regardless; `--gate skip` launches without it and says so in
every receipt.
Keep the existing worktree checks and the detachment into the per-user service manager
(launchd on macOS, `systemd-run --user` on Linux; `scripts/service.ts` owns the difference); do
not add wrapper scripts, repeat installations or run a gate separately before this command.

Always resolve the latest intended published PR stack at launch time, including scheduled
launches, unless the user explicitly selects another revision. Fetch current heads and use
[stack-hop](../stack-hop/SKILL.md) to verify every child contains its latest published parent;
restack stale edges before launching. Use current `origin/main` only when no intended stack is
open. The launcher records where that commit came from — the pull request carrying it, whether it was that PR's head, and the stack down to main, read from `gh pr list` — as `sourceRef` in `opening.json` and `launch.json`, and `bun run runs show` prints it and says whether the PR has moved since. Pass the resolved full SHA explicitly through `--source`; the CLI's omitted-source
default remains `origin/main` and does not resolve the stack. Let the launcher fork that commit
into a fresh isolated run worktree. Keep the source checkout and existing runs untouched.

Model and budget defaults are Opus 5.5 medium/medium/medium, 25 tasks and 1,320 provider
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

Each run's `launch.json` moves through `starting`, then `started` once the opening matched, or
`start-unconfirmed` when it could not tell, or `refused` with the `stage` (`prepare` or `gate`)
and the error that stopped the batch before any controller started. It records the gate's
decision, seconds and load, the launcher commit, and the credential's account as a 12-hex digest.
It says nothing about whether the run is still going: that is `bun run runs`, read from the
controller's own evidence.

Claude uses `CLAUDE_CODE_OAUTH_TOKEN` from the main checkout's `.env`, or explicit `--env-file`,
and carries it into the run's frozen env. Codex conditions use the selected `CODEX_HOME/auth.json`, defaulting to the current account.
Capture each selected credential once per batch; keep snapshots private and secrets out of
arguments and reports. Report a missing credential; do not search other accounts or substitute keys.

Before any launch, compare the host's one-minute load with its cores (`sysctl -n vm.loadavg
hw.ncpu`) and count the open runs in `bun run runs`, firmware runs above all: each firmware Builder
compiles in 4–5 lanes of its own, and the Epoch Reviewer's probes run the same compilers. Do not
launch while load is above the core count. A launch into that load slows every sibling as well as
itself, and it confounds any comparison of round length, because every arm is then bound by its
tools. [The Super Loop's launch step](../run-improvement-campaign/SKILL.md#4-launch-through-one-owner)
records what 2026-09-30 measured under it.

Before a Claude-backed launch, read `.accounts/usage` in the main checkout, where it exists. It is
local and untracked, prints each numbered account's 5-hour and weekly windows, marks the plain
`CLAUDE_CODE_OAUTH_TOKEN`'s account, and prints no token. If the plain account's week or 5-hour
window is `rejected` or near full, launch through `.accounts/launch claudeN <the same arguments>`
on an account with room. That script passes that account's private env file as `--env-file`. A
run lasts hours, so a window near full at launch ends the run with a provider limit partway
through. Choosing among the operator's numbered accounts this way is authorised (2026-09-29) and is
not a substitution. Put each run on an account no steward is using, and never print or copy
the env files.

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

`pulse --once` is the watch after a launch. Run it from main as the last action of each reply, so
the next look lands about 270 s later and opens on what moved. For a watch nobody is reading, the
detached, stop-row-only watcher is `campaign.ts` in
[run-improvement-campaign](../run-improvement-campaign/SKILL.md#5-watch-quietly).

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

`launchctl bootout` ends the service's own process, which is the `bun run fullrun` wrapper. The
controller under it can outlive the wrapper with PPID 1 and keep its campaign lock (2026-09-30).
`stop.ts`, which both `runs stop` and the timer run, therefore reads the service's pid before
removal, and once the service is gone it SIGKILLs a process group of that id that still exists. The
outcome is then `controller-killed`, naming the group, and `runs stop` exits 1 because the
controller wrote no terminal. A stop made by hand with `launchctl` has no such check. So after any
stop, run `bun run runs` again. A run that still reads `live` from "campaign lock held by a live
holder" has a controller running without its service, and the pid beside it is that controller.
The stop is observed only when the run reads `closed`, or reads `orphaned` because the lock holder
proved dead. Until then, report the stop as unobserved, with that pid.

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
