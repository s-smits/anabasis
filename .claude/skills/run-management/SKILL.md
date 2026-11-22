---
name: run-management
description: "Start, continue, keep, pause, copy, move, monitor, and stop authorised Anabasis campaigns via `bun run runs`: launch named campaigns, resume from logs on another login or commit, keep runs alive across provider waits, pause cleanly, copy stopped runs between worktrees, migrate runs across hosts, inspect run status and login capacity, reach remote hosts, and terminate runs cleanly. Use when asked to manage campaign lifecycles, check login capacity or fleet status, verify move readiness, or diagnose move refusals. Owns host-level run lifecycle; `run-improvement-campaign` owns experimental decisions, and `whole-run-investigation` analyses run logs."
---

# Run management

Each campaign runs as a single process writing to one append-only log (`tools/d2/harness-builder.ts`): it prepares the exam and conducts a single Builder conversation that edits the harness and invokes campaign tools for the Examiner, practice release, comparisons, and promotions. Host-level lifecycle operations are handled through one CLI, `bun run runs` (`tools/runs/cli.ts`), which discovers every campaign log across the repository's worktrees (`tools/runs/registry.ts`). Running `bun run runs` with no arguments lists all verbs, `<verb> --help` prints the options for a verb, and `help all` prints every verb's usage; invalid arguments print the same usage text. Run authorisation and measured-campaign conditions are defined in `AGENTS.md`, section 10.

Verbs that take a run name route automatically to the host holding that run, refusing if no host holds it or if multiple hosts hold the same name. Read-only verbs refresh cached copies of remote logs first, whereas `pulse` polls without copying logs. The central archive resides in `data/runs/` of the main worktree: `here/<name>/` stores locally retired campaigns and `<host>/<name>/` stores copies fetched from peers. Lifecycle verbs refuse to act on archived campaigns; use `copy <name> --to <worktree>` to restore one first.

| verb | purpose | file |
| --- | --- | --- |
| `fresh <pack> [<pack> ...] [--logins <list>] [--model opus\|sonnet\|gpt\|<provider>/<id>] [--effort hhmm] [--login N] [--budget 800] [--as <suffix>] [--at <c>] [--host <host>] [--yes] [-- <flags>]` | names a campaign, creates a detached worktree at a published commit, and launches it | `fresh.ts` |
| `launch <name> [--login N] [--yes] -- <flags>` | starts the campaign command under a new name in the current worktree | `manage.ts` |
| `continue <name> [--at <c>] [--login N] [--budget N] [--after <event>] [--yes] [-- <flags>]` | resumes a stopped campaign from its log | `manage.ts` |
| `pause <name> [--after <event>] [--eval] [--yes]` | pauses a campaign at a clean boundary; `--eval` then runs its external benchmark read (`runs bench <run> --wait`) | `manage.ts` |
| `keep <name> [--logins <list>] [--wait-hours 0.25] [--yes]` | keeps a campaign running across provider waits and process crashes | `keep.ts` |
| `copy <name> --to <worktree> [--yes]` | copies a stopped campaign into another worktree | `move.ts` |
| `move <name> --to <host> [--from <host>] [--login N] [--after <event>] [--hold] [--yes] [-- <flags>]` | pauses a campaign and resumes it on another host at the same commit | `move.ts` |
| `stop <name> ... [--yes]` | terminates each run's process and keeper and releases its claimed scratch directories | `stop.ts` |
| `status [--all]` | prints one summary row per run across this host and all hosts in `ANA_HOSTS` | `pulse.ts` |
| `usage [N ...] [--json]` | reports five-hour and weekly utilisation and active runs per login, refreshing configured host caches on full reports | `logins.ts` |
| `active` | lists active runs and seats per login by name | `logins.ts` |
| `sync [--yes \| --check] [--force]` | aligns system tools and Python environments across hosts | `sync.ts` |
| `search <pattern> [--regex] [--ignore-case] [--here] [--in logs\|notes\|all] [--max <chars>]` | searches campaign folders, notes, and docs across all hosts | `search.ts` |
| `fetch [<name>] [--from <host>]` | copies a peer's campaign (or all peer records) into the local archive; fetched copies omit installed packages and caches, so they are read-only. Without a name, also syncs benchmark score stores from `EVAL_RUNNER` peers into `data/bench/<benchmark>` | `move.ts` |
| `bench [<run>] [--bench <name>] [--host <name>] [--store <dir>] [--as <label>] [--harness <kept>] [--login N] [--wait] [--yes]` | executes a run's external benchmark read end-to-end: exports the promoted reference on the host holding the run, copies it into the score store, dry-runs both arms, and queues the reference followed by a Starter (prints the plan without `--yes`; see `run-improvement-campaign`, "The outside aim"). Without a run name, scores each completed reference-Starter pair once into `scored/<label>.txt`, locally or on `--host <name>` | `bench.ts` |
| `retire [--days 1] [--yes]` | releases orphaned seat roots and host scratch directories, archives idle campaigns, removes seeds and stale worktrees, refreshes peer records, and collects archives from benchmark hosts | `retire.ts` |
| `on <host> <verb ...>`, `hosts [--all] [--health]` | executes a verb on a remote host, or prints host status and health | `hosts.ts` |
| `loadwatch [<seconds>] [--once \| -s [-w 1m\|5m\|15m]]` | monitors CPU and load across hosts; `--once` prints one snapshot ending with hosts ordered least loaded first; `-s` prints a single line (`last 5m:`) of per-core load out of 100 (`-w` selects the window) | `loadwatch.ts` |
| `pulse [<part> ...] [--every 290] [--state <file>] [--no-readers]` | reports new events per run since the previous check | `pulse.ts` |
| `alerts [--state <file>]` | cron-oriented alert stream emitting one line per new milestone event | `alerts.ts` |
| `view <name>` | summarises a campaign's log state and the move table's recommended action | `view.ts` |
| `source <name> [--holds <c>]...` | reports each launch's commit and tree cleanliness, and checks whether specified fixes are ancestors | `receipt.ts` |
| `zip`, `replay`, `seed`, `rehearse` | handover packaging, log replay, seed creation, and scripted rehearsal | `zip-run`, `system-path-simulation` |

Every mutating verb prints its execution plan and makes no changes unless `--yes` is supplied.

## Start

```sh
bun --env-file=<file> run runs fresh <pack> [--model sonnet] [--login N] [--as <suffix>] --yes
bun --env-file=<file> run runs fresh <pack> --host <host> ... --yes   # on another host
```

`fresh` reads the operator's domain prompt `<pack>-prompt.txt` from `ANA_PROMPTS` (defaulting to `anabasis-prompts` beside the main worktree) and refuses any pack lacking one, because domain prompts require operator authorship. It names the campaign `<pack>-fresh-<model>[-<suffix>]-<host>[-r<n>]` inside project `<pack>-fresh`, assigns one model across all four seats (Opus by default), sets a default budget of 800 dollars unless `--budget` is given, and launches inside a new detached worktree `anabasis-<name>` at `--at` (defaulting to the current checkout's commit). `--effort` takes four characters from `lmhx` for Builder, Examiner, Referee, and Solver respectively (`hhmm` for Opus, `xxhh` for Sonnet, `hhhh` otherwise). `gpt` selects `openai-codex/gpt-6.1-sol` via the Codex CLI login (which `--login` does not affect); arbitrary models use `<provider>/<id>`. Claude is used unless the operator specifies another provider, and DeepSeek via DeepInfra is used only when explicitly requested. Solves default to 20 model turns and 30 minutes (`LIMITS`, `tools/d2/campaign.ts`).

**Host placement.** When `--host` is omitted, `fresh` selects from hosts below their concurrency cap by prioritising: fewest active runs billed to the selected login, then hosts that have previously run `<pack>-fresh`, then fewest active campaigns and seats, breaking ties by configuration order. Caps are governed by `ANA_RUN_CAP` locally and each peer's `capacity` in `ANA_HOSTS` (defaulting to 2); `--host here` forces local execution. Peers declaring a `packs` list accept only those packs, and those packs are restricted to those peers. Because placement counts are instantaneous observations that do not reserve slots, launch runs sequentially. Placement inspects run counts rather than CPU load, whereas solve deadlines measure wall-clock time; therefore run `bun run runs loadwatch --once` before any launch, `continue`, or `move`. Its final line orders responsive hosts by one-minute load per core, least loaded first (unresponsive hosts are omitted). If the least loaded host under its cap differs from the dry run's selection, specify it explicitly with `--host`; across large fleets, rely on this summary line rather than the frame above it. On remote peers, `fresh` prepares a detached controller worktree under Git's `ana-code/` with a frozen dependency install, leaving the peer's primary checkout untouched.

**Login selection.** For Claude seats, `fresh` honours `--login` or selects an eligible login with an open window and remaining capacity under `ANA_LOGIN_RUNS` across the fleet, preferring the account whose weekly window resets soonest. An explicit login at its cap is refused, as is any launch when fleet counts cannot be obtained. On remote peers, `fresh` verifies that the numbered token exists in the remote environment; if absent, transfer it via a pipe that never echoes the credential (see the operator's `CLAUDE.md`). No CLI verb prints or copies credentials. Non-Claude providers require no Claude login.

**Batch launches.** Passing multiple packs (`fresh <pack> <pack> ... --logins <list>`) constructs a single ordered plan, displayed in full without `--yes`. The planner accounts for each queued entry in its capacity estimates, pins a single commit, verifies all remote logins upfront, and launches sequentially, aborting on the first failure. `--host` applies only to single-pack launches. Record the prediction ledger before passing `--yes`.

`launch` is the lower-level primitive for explicit campaign flags:

```sh
cd <the worktree kept for the run>
bun --env-file=<file> run runs launch <name> [--login N] --yes -- \
  --project <project> <the pack's four flags, or --prompt-file <file> --solver <model>> \
  --budget <dollars> --builder <model> --examiner <model> --reviewer <model> \
  [--solve-model-turns N] [--minutes N] [--turns N] [--level 0.02]
```

Flags after `--` are forwarded to the campaign command (`flagsOf`, `tools/d2/campaign-terms.ts`), omitting `--name`. `launch` refuses any name already present in any worktree, any log with an active writer, uncommitted working-tree edits, and commits absent from any remote branch. It then runs `bun install --frozen-lockfile`, executes the campaign's `--dry-run`, and only if that succeeds spawns the campaign niced in its own process group, writing logs to `launch-run-<n>.out` and `.err` alongside the receipt `launch-run-<n>.json`. Unless `--hitl` is passed, a single `step` triggers promotion automatically.

- **Environment files are loaded only by Bun.** Pass `--env-file=<file>` to Bun; no verb opens environment files, and agents must never read, print, copy, or search them. `--login N` maps `CLAUDE_CODE_OAUTH_TOKEN<N>` to `CLAUDE_CODE_OAUTH_TOKEN` for the child process so no numbered key leaks. Omitting `--login` does not guess a numbered login, causing `claude/` dry runs to refuse unless the host holds only the plain unnumbered token (`plainOnly`, `tools/runs/logins.ts`). `continue` without `--login` reuses the login recorded in the previous receipt, which its dry run displays. `claude/<model>` and `claude-api/<model>` are distinct providers and therefore distinct experimental settings.
- **Fleet configuration.** `ANA_LOGINS` lists permitted logins, and `ANA_HOSTS` defines remote peers as JSON objects (`{name, ssh, tree, bun, envFiles, capacity, checks, packs}`). Store these in the git-ignored `.env.runs` (copied from `.env.runs.example`) and supply it as a second `--env-file`.
- **Concurrency and host load.** Because solve deadlines measure wall-clock time, each solve waits up to 30 minutes until one-minute load is at or below core count; `--loaded` bypasses this wait, recording the operator's acknowledgement that runtimes are not comparable.

Each launch receipt records flags, commit hash, tree cleanliness, load, and Bun version; because the campaign log hashes code by content, the receipt is the sole record of the commit hash. Immediately after launch, tag the commit using its first nine characters (`git tag -f run/<nine> <commit> && git push origin run/<nine>`). Because tags are public and campaign names embed host names, the tag omits the run name; any remote ref containing the commit satisfies `publishedAt`, and `runs source <name>` reports which commit a run executed.

A campaign name corresponds to `.ana/d2/<name>/`, chosen once and never reused: up to 128 characters from letters, digits, `.`, `_`, and `-`, with no `..` (`isSafePathSegment`). Every launch appends its host name so the same pack on two hosts receives distinct names. Record the name, project, and rationale in the ledger prior to launch.

## Continue, pause and words

```sh
bun --env-file=<file> run runs continue <name> [--at <commit>] [--login N] [--budget N] [--after <event>] --yes [-- <flags>]
bun run runs pause <name> [--after <word>[|<word>...]] --yes
```

`continue` resumes a stopped campaign in its worktree using the flags from its most recent receipt, excluding `--name` and `--budget` (the log tracks cumulative budget; pass `--budget` to raise it). Flags after `--` replace all stored flags, so adding an option such as `--promotions N` requires repeating the retained flags shown by a dry run of `continue`. `continue` enforces the same preconditions as `launch`, and additionally refuses `--at` another commit while a comparison is open (`openComparisons`), because an open comparison must finish under consistent code; it also refuses logins at their fleet cap, a second concurrent GPT run on one host, or launches when fleet counts are unavailable (`startRefusal`). A measured run must always continue at its opening commit; code fixes are measured only by fresh runs.

`pause` waits for the next matching event at a clean boundary where only the Builder's conversation is active (no open comparison, Examiner request, draft, solve, or Referee call), then stops the campaign. Supported boundary words are `compacted` (compaction of any seat: `build`, `exam`, `draft`, `referee`, or `solve`), `reported` (`comparison.reported`), `promoted` (`harness.promoted`), `examined` (`exam.finished`), and `finished` (`build.finished`); pipe-separated combinations such as `reported|promoted` trigger on whichever arrives first. `reported` alone also waits out any promotion whose starter confirmation comparison has not yet tallied, whereas `promoted` pauses immediately at promotion and leaves that confirmation unread. Event counting begins when the command is armed; omitting `--yes` displays what it would wait for. Because no seat conversation persists across process exits (pi-durable stores state in memory, and Claude Code runs without saved sessions), compaction offers no advantage over any other boundary: pausing terminates both the Builder conversation and any idle Examiner conversation. On continuation, a new Builder conversation opens with the previous session's notes from the last practised or frozen harness, informed of the restart (`startTold`), while the next Examiner request opens with the full record and its persisted home directory. Only `--after finished` preserves the Builder session intact.

`continue --after <event>` combines a clean pause with an immediate continuation, enabling clean login or commit switches. Just before stopping, it re-validates all start preconditions (working tree, remote commit, login capacity, dry run) so a refusal leaves the original run uninterrupted; if the run has already ended or already matches the target state, it reports this and exits (`leftAt`). Because a waiting `pause` or `continue` owns the stop action, only one waiter may exist per run at a time: launch it under `nohup` from a detached worktree at a published commit whose `HEAD` will not move until the waiter finishes. The default `--after next` drains the run to conserve credits: no new solve starts, and the process exits after the current solve or tool call completes (or one minute past the solve limit). Active turns continue billing until then; use `runs stop` to free a login immediately. Note that `--after next` writes a `PAUSE` `campaign.word` event to the log that blocks new solves in the running process for the solve limit plus two minutes; interrupting the command after that write leaves the run idle for that window unless restarted. Named boundary events write the pause word only immediately before stopping, so a precondition refusal leaves no lingering pause.

Operator steering words (`tools/d2/word.ts --name <name>`) take effect at the next move boundary and are invisible to all model seats: `--stop "<why>"` ends the campaign with status `operator`; `--budget N` updates the total budget cap; `--tasks "<why>"` requests an Examiner session first. Issue one word per invocation. By contrast, `--promotions N` after `--` is a campaign launch flag: it ends the campaign as `operator` upon reaching `N` promotions, persists across continuations, and is cleared with `--promotions none`.

## Keep

```sh
bun --env-file=<file> --env-file=<hosts file> run runs keep <name> [--logins <list>] [--wait-hours 0.25] --yes
```

`launch`, `continue`, `fresh`, and `move` automatically attach a keeper process to any run on a numbered login when at least one alternate login is configured (`keepsItself`, `tools/runs/manage.ts`); launching thus grants the keeper standing authority to switch across allowed logins. Set `ANA_KEEP=off` to disable automatic keepers for new launches. Runs without a numbered login cannot switch logins and receive no keeper.

The keeper draws candidate logins from `--logins`, then `ANA_LOGINS`, then the environment, polling once per minute (`turnOf`). Whenever a provider wait exceeds `--wait-hours`, it stops the run and resumes it on an available login under its cap whose weekly window resets soonest and whose five-hour window is forecast to last (`fiveHourWith`); logins at 100% utilisation or returning unreadable status are skipped. Before stopping the active writer, the keeper verifies that restart preconditions pass (`checkStart`). Cached login closures expire at their reset time or after `CLOSED_CACHE_MS`, and a keeper waiting for capacity retries every `ASK_MS`, querying the provider before claiming a login. If the campaign process dies without logging an ending, or exits with `environment`, the keeper resumes it on the same login if available and under cap (`atCap`), or otherwise on another available login. All other campaign endings are terminal and cause the keeper to exit; a `budget` ending (even mid-comparison) cannot be resolved by switching logins and requires raising the cap (`continue --budget N`) with operator approval. Runs without a `claude/` seat restart after crashes but sit through provider waits. Three consecutive restarts without a completed model turn terminate the keeper. All restarts remain at the worktree's commit; `keep.out` logs every switch, wait, and termination with timestamps, and `runs stop <name> --yes` stops both the campaign and its keeper.

## Copy and move

```sh
bun run runs copy <name> --to <worktree> --yes
bun --env-file=.env.runs run runs move <name> --from <host> --to <host> [--login N] --yes
```

`copy` is the sole sanctioned method for transferring a campaign between worktrees (`AGENTS.md`, section 5). It refuses active or kept runs and destinations already holding the campaign name, copies the directory intact, verifies log byte size, and moves the source directory to `.ana/moved/<name>-<stamp>`. Use `continue --at` at the destination only when no comparison is open, because the target worktree's commit becomes the executing codebase.

`move` validates the destination host, prepares the controller codebase, pauses the run at `--after` (`finished` by default), creates `anabasis-<name>` on the destination at the source commit, transfers the directory via `rsync` through the local host, verifies byte size, archives the source, and resumes the campaign with its preserved flags. `--hold` stops before resuming, and the pause terminates any attached keeper. Switching logins on the same host does not require `move`; use `continue --after <event> --login N` instead.

## Logins and hosts

```sh
bun run runs usage [N ...] [--json] [--open] [--closed]
bun --env-file=<file> --env-file=.env.runs run runs status [--all]
bun --env-file=<file> --env-file=.env.runs run runs on <host> status
bun --env-file=<file> --env-file=.env.runs run runs hosts [--all]
```

`usage` queries each login's rate-limit windows from the provider (falling back to response headers when direct queries are refused), appends observations to `.ana/logins-history.jsonl`, and forecasts pool exhaustion using whichever of the fitted model, weekly pace, or per-run burn rate achieved the lowest error over recent held-out hours (`modelLines`). Each login line displays `open` or `closed until <reset>` alongside its active run count against its effective limit: the minimum of its configured cap (`capOf`: `N:most` in `ANA_LOGIN_RUNS`, else its tier in `ANA_LOGIN_SUBS` where `max` = 1, `ultra`/`pro100` = 2, and `pro200` = 4, else a plain integer) and the number of runs its weekly quota can sustain (`fitOf`), flagging excess runs as `oversubscribed`. The weekly fit is an advisory forecast printed only by `usage` (noting when it is the tighter bound); lifecycle verbs enforce the hard cap (`atCap`), which `active` reports against. `active` lists live runs per login across all hosts based on each run's latest launch receipt; inspect it before launching, continuing, or moving a run, and manually account for any unnumbered seats or external sessions sharing a numbered login. Both `active` and `usage` flag unresponsive hosts as uncounted; starts and keeper switches fall back to the most recent archive snapshot (`asGathered`) and refuse if no snapshot exists.

`status` hides stopped runs that have been idle for more than a day unless `--all` is passed, and lists the newest archived campaigns. `hosts --health` reports load relative to core count, AC power status, disk usage, Bun version, active controllers, running campaigns, and top processes attributed to runs; never treat an unresponsive host as idle. Terminate attributed campaigns with `stop`, and leave unattributed processes, caches, and host power settings to the operator.

Remote commands execute from a clean detached controller at the nearest published ancestor of `HEAD` (`fresh`, `move`, and `continue --at` require their exact target commit). Cold controllers are allotted five minutes for setup, and subsequent requests have a 30-second timeout; an unresponsive peer fails closed and refuses admission rather than appearing empty. Environment files remain local to their host, and `ANA_HOP=1` prevents recursive fan-out. Skill scripts invoke peers via `scriptOn` and `askedScript` (`tools/runs/hosts.ts`), and scripts using `.claude/skills/main/cli.ts` accept `--host <name>`. Standalone scripts require loading `.env.runs` via `bun --env-file=.env.runs <script> ...`.

## Keep the machines' settings in step

Every remote invocation forwards `ANA_LOGINS`, `ANA_LOGIN_RUNS`, `ANA_LOGIN_SUBS`, `ANA_KEEP`, and the peer's `capacity` (`carriedTo`, `tools/runs/hosts.ts`) so peers do not maintain drifting local copies; any value resembling a credential is refused. `ANA_HOSTS` remains exclusively on the central host. `bun run runs sync` reconciles host-installed dependencies: `ANA_TOOLS` (tool versions resolved in sandbox path order) and `ANA_PYTHON` with `ANA_PYTHON_PACKAGES` (a uniform `uv`-managed Python environment across hosts, exposed to solves via `hostPython`, pinning shared transitive packages to the central host's exact versions to prevent install-time drift). Without flags, `sync` reports differences; `--yes` applies updates, re-verifies, and flags any installer that exited 0 without changing the observed version; `--check` exits 1 on any drift for automated monitoring. Any change visible to a solver seat is refused on a host with an active campaign (or an uncountable host) unless `--force` is passed, because solver environment changes require operator authority. `sync` never uninstalls software, modifies runs, or copies `.env` files; logins are transferred between hosts manually by the operator.

## What is refused

Move admission rules are owned by `AGENTS.md`, section 6 ("What refuses a move"). Always read the refusal message before choosing a remedy. When operating manually, a comparison requires these prior steps:

| Missing precondition | Command |
| --- | --- |
| Clean checker read, or explicit freeze over faults | `bun tools/c/accept.ts ... --name <name> [--admit <checks> \| --admit-authored] [--freeze [--despite "<why>"]]` |
| Held-out task preparation and initial practice release | `bun tools/d2/prepare.ts ... --name <name>` |
| Additional held-out frontier tasks | `bun tools/d1b/examine.ts ... --name <name> --session x-1` |

Checker acceptance requires operator authority (`AGENTS.md`, section 3 and rule 10). Passing `--predict "<sentence>"` to a manual comparison or round logs the pre-solve hypothesis before execution.

## Watch

```sh
bun run runs pulse [<part of a name> ...]
bun run runs view <name> [--level N] [--target N] [--practice N] [--past-stop "<why>"]
```

`pulse` summarises new events since the previous check, session starts, and missing processes that died without logging an ending (inspect their `launch-run-*.err`). `view` displays campaign state and concludes with the move table's recommendation (`decide`), which the Builder may choose not to follow; because `view` executes the current checkout's code, check the run's launch receipt before treating its output as a live run's exact decision logic. `pulse --here` restricts polling to the local host. Neither verb starts a run.

Status lines announce pending experimental steps from a single authoritative formatter (`tools/runs/said.ts`): exam progress counts, comparison capacity at start, promotion notices ("a pause should wait for its starter comparison"), starter comparison results beneath their reports, `ready to pause` with its exact command upon the second confirmed read, and a one-time `⚠ investigation due` notice pointing to `wri2p2.ts due` (while live) or `wri2p2.ts open` (once stopped). A live campaign whose first comparison has remained admissible for 75 minutes without starting emits a one-time `⚠ a first comparison admissible` notice (`heldOff`, `tools/runs/view.ts`); `runs view` shows the recommended move without interrupting the run. Terminal endings and unresponsive hosts are announced once upon state transition rather than repeated on every poll.

`bun run runs alerts` is the cron-friendly counterpart: it prints one stdout line per new promotion, starter comparison, keeper login switch, missing process, stall, or ending (reporting `ended <ending>, and went on` when a keeper restarted it between checks), prints nothing otherwise, and exits 0. It prints the `runs pause` command once two promotions have been read against the starter, but never executes it.

A session monitoring active runs attaches a single `Monitor` (`tail -n 0 -F`) to the alerts log written by the local cron job, re-arming it upon expiry so the session wakes whenever a step comes due. On hosts without that cron job, attach one `Monitor` to `bun run runs pulse --every 290 --state <file>`. Neither watcher pauses or stops campaigns.

Beneath each milestone event (contract freeze, comparison start or report, promotion, Examiner or Builder end, campaign open or end), `pulse` also prints findings from deterministic readers registered for that moment (`at`, `READERS`, `tools/wri/derive.ts`): `◆ <reader>: <line>` for lines matching the session or harness, or the reader's `gist` otherwise (capped at 3 lines per reader, 12 per run, and 30 per poll), referencing the full output directory. A single low-priority background pass per host (`tools/wri/pass.ts`) invokes a reader only when a registered moment is newer than its last run, bounded to 30 seconds every 4 minutes and only when a CPU core is free; polls with no new milestone events trigger no pass. Unprocessed moments are noted once (`· not read yet: <readers> of <moment>; <why>`, or `⚠` if the last pass failed) and appear on the subsequent poll once ready. Pass `--no-readers` to omit reader output. Cached reader outputs live in `.ana/pulse/moments/` and contain hidden exam-side values, so no model seat can access them (`test/runs-pulse-readers.test.ts`).

## Stop

```sh
bun run runs stop <name> ... [--yes]
```

`stop` terminates the process writing each campaign log along with its child processes, then releases scratch roots for all open solves, sessions, and drafts. Dead runs are cleaned up identically, and the daily `retire` job performs the same cleanup when archiving idle runs, including orphaned verifier cells and model home directories (`archiveIdle`, `releaseScratch`, `tools/runs/retire.ts`). Stopping is abrupt and writes no `campaign.ended` event. `continue` resumes from the log under the same name; the interrupted session's identifier is consumed, while any held-out tasks already admitted by an Examiner session remain intact. Prefer `pause` or an operator word whenever a clean boundary can be awaited. Stopping a live run requires operator authority. After stopping, verify that `writers(runNamed(name), processes())` (`tools/runs/registry.ts`) is empty and inspect any cleanup errors; scratch roots from older macOS runners may require `hdiutil detach` first (`release`, `tools/runs/stop.ts`).
