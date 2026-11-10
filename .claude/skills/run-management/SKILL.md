---
name: run-management
description: "Start, continue, keep, pause, copy, move, watch and stop authorised Anabasis campaigns through `bun run runs`: launch a campaign under a name, continue one from its log on another login or commit, keep one going across logins until it ends on its own terms, pause one at a clean point, copy a stopped one to another worktree, move one to another host, read each run's status and each login's capacity, reach the other hosts, and stop one and release what it held. Use when the operator asks to start, launch, resume, continue, move, keep, pause, copy or stop a campaign or a run, which logins have room, how the runs stand on any host, whether a campaign is ready for its next move, or why a move was refused. Owns the run's life on the host; run-improvement-campaign reads the table, and whole-run-investigation reads what a run did."
---

# Run management

A campaign is one process over one log (`tools/d2/harness-builder.ts`): it prepares the exam and
holds one Builder conversation, which edits the harness and calls campaign tools for the Examiner,
practice, comparison and promotion. Its life on the host is managed by one CLI, `bun run runs`
(`tools/runs/cli.ts`), over every run log in the repository's worktrees (`tools/runs/registry.ts`).
A bare `bun run runs` lists the verbs and `<verb> --help` gives their options. Run authority and the
conditions of a measured campaign are in `AGENTS.md`, section 10.

Verbs that name a run route to the machine that holds it, and refuse where the host is missing or
more than one holds the name. Reading verbs refresh copies of remote records first; `pulse` polls
without copying logs. The archive is `data/runs/` of the main worktree: `here/<name>/` for this
machine's retired campaigns and `<host>/<name>/` for copies of a peer's. No verb acts on an archived
campaign; `copy <name> --to <worktree>` brings one back.

| verb | what it does | file |
| --- | --- | --- |
| `fresh <pack> [<pack> ...] [--logins <list>] [--model opus\|sonnet\|gpt\|<provider>/<id>] [--effort hhmm] [--login N] [--budget 800] [--as <suffix>] [--at <c>] [--host <host>] [--yes] [-- <flags>]` | names a campaign, makes its worktree at a published commit and launches it there | `fresh.ts` |
| `launch <name> [--login N] [--yes] -- <flags>` | starts the campaign command under a new name in this worktree | `manage.ts` |
| `continue <name> [--at <c>] [--login N] [--budget N] [--after <event>] [--yes] [-- <flags>]` | runs a campaign again from its log | `manage.ts` |
| `pause <name> [--after <event>] [--yes]` | stops a campaign at a clean point | `manage.ts` |
| `keep <name> [--logins <list>] [--wait-hours 0.25] [--yes]` | keeps a campaign going across provider waits and deaths | `keep.ts` |
| `copy <name> --to <worktree> [--yes]` | copies a stopped campaign to another worktree | `move.ts` |
| `move <name> --to <host> [--from <host>] [--login N] [--after <event>] [--hold] [--yes] [-- <flags>]` | pauses a campaign and continues it on another machine at the same commit | `move.ts` |
| `stop <name> ... [--yes]` | ends each run's process and keeper and releases what it held | `stop.ts` |
| `status [--all]` | one row a run, here and on each host `ANA_HOSTS` lists | `pulse.ts` |
| `usage [N ...] [--json]` | each login's five-hour and weekly use and live runs | `logins.ts` |
| `active` | the runs and seats live on each login, by name | `logins.ts` |
| `sync [--yes \| --check] [--force]` | aligns tools and Python across hosts | `sync.ts` |
| `search <pattern> [--regex] [--ignore-case] [--here] [--in logs\|notes\|all] [--max <chars>]` | searches campaign folders, notes and docs on all hosts | `search.ts` |
| `fetch [<name>] [--from <host>]` | copies a peer's campaign, or every peer's records, into the archive | `move.ts` |
| `retire [--days 1] [--yes]` | archives idle campaigns, deletes seeds and stale worktrees, refreshes peers' records | `retire.ts` |
| `on <host> <verb ...>`, `hosts [--all] [--health]` | a verb on another host; each host's status or health | `hosts.ts` |
| `pulse [<part> ...] [--every 290] [--state <file>] [--no-readers]` | what each run gained since the last look | `pulse.ts` |
| `alerts [--state <file>]` | the same for cron, one line per new event | `alerts.ts` |
| `view <name>` | one campaign as its log reads, and the table's next move | `view.ts` |
| `source <name> [--holds <c>]...` | each launch's commit and tree, and whether it holds a fix | `receipt.ts` |
| `zip`, `replay`, `seed`, `rehearse` | handover, readers over every log, a seed, a rehearsal | zip-run, system-path-simulation |

Every verb that launches, stops or transfers prints its plan and does nothing without `--yes`.

## Start

```sh
bun --env-file=<file> run runs fresh <pack> [--model sonnet] [--login N] [--as <suffix>] --yes
bun --env-file=<file> run runs fresh <pack> --host <host> ... --yes   # on another host
```

`fresh` reads the operator's prompt, `<pack>-prompt.txt` in `ANA_PROMPTS` (default
`anabasis-prompts` beside the main worktree), and refuses a pack without one, since the prompt is the
operator's. It names the run `<pack>-fresh-<model>[-<suffix>]-<host>[-r<n>]` in project
`<pack>-fresh`, seats one model in all four seats (Opus by default), takes 800 dollars unless
`--budget`, and launches in a new worktree `anabasis-<name>` detached at `--at` (default: this
checkout's commit). `--effort` gives one letter of `lmhx` for each of Builder, Examiner, Referee and
solver (`hhmm` for Opus, `xxhh` for Sonnet, `hhhh` otherwise). `gpt` seats
`openai-codex/gpt-6.1-sol` through the Codex CLI's login, which `--login` does not select; another
model goes as `<provider>/<id>` and is named by its id. Claude is seated unless the operator names
another model, and DeepSeek through DeepInfra only where the operator names DeepSeek. Solves default
to 20 model turns and 30 minutes (`LIMITS`, `tools/d2/campaign.ts`).

**Placement.** Without `--host`, `fresh` takes, among machines below their cap, the one where the
run's login pays for the fewest live runs, then one that already ran project `<pack>-fresh`, then the
fewest live campaigns and seats, ties in configuration order. The caps are `ANA_RUN_CAP` here and
each peer's `capacity` in `ANA_HOSTS`, both 2 where unset; `--host here` picks this machine. A peer whose entry lists `packs` takes
only those packs, and they go nowhere else. Counts are observations that reserve nothing, so launch
one after another. On a peer, `fresh` prepares a controller at the commit (fetch, a detached worktree
under Git's `ana-code/`, a frozen install) and leaves the configured checkout alone.

**Login.** For Claude seats, `fresh` takes `--login` or chooses, from the allowed logins, one with a
usable window and room under `ANA_LOGIN_RUNS` across the fleet, the week that resets soonest first;
an explicit login at its cap is refused, and so is a launch whose fleet count is missing. On a peer
it first checks that the environment holds the numbered key and, if not, asks for the login to be
carried by the operator's procedure, which pipes the one line without printing it. No verb prints or
carries a credential. Seats billed by another provider need no Claude login.

**Batches.** Several packs make one ordered plan (`fresh <pack> <pack> ... --logins <list>`), printed
in full without `--yes`. The planner reserves each entry in its own counts, pins one commit, checks
every remote login first and launches sequentially, stopping at the first failure. `--host` applies
to a single pack. Write the prediction ledger before `--yes`.

`launch` is the step underneath, for explicit flags:

```sh
cd <the worktree kept for the run>
bun --env-file=<file> run runs launch <name> [--login N] --yes -- \
  --project <project> <the pack's four flags, or --prompt-file <file> --solver <model>> \
  --budget <dollars> --builder <model> --examiner <model> --reviewer <model> \
  [--solve-model-turns N] [--minutes N] [--turns N] [--level 0.02]
```

The flags after `--` are the campaign command's (`flagsOf`, `tools/d2/campaign-terms.ts`), without
`--name`. It refuses a name any worktree holds, a log a process writes, an uncommitted change and a
commit no remote branch holds; then it installs with `bun install --frozen-lockfile`, runs the
command's `--dry-run`, and only if that passes starts it niced in its own process group, with output
in `launch-run-<n>.out` and `.err` beside the receipt `launch-run-<n>.json`. Outside `--hitl`, one
`step` promotes.

- **The env file is Bun's to read.** `bun --env-file=<file> run runs …` loads it into the process; no
  verb opens it, and you never print, copy or search it. `--login N` passes the login held as
  `CLAUDE_CODE_OAUTH_TOKEN<N>` on as `CLAUDE_CODE_OAUTH_TOKEN`, and no numbered key reaches the
  command. Without `--login` no login is guessed, so a `claude/` seat's dry run refuses; a machine
  holding only the plain token uses it (`plainOnly`, `tools/runs/logins.ts`). `claude/<model>` and
  `claude-api/<model>` are two providers, so they make two settings.
- **Machine settings are environment.** `ANA_LOGINS` lists the logins a run may take, and
  `ANA_HOSTS` the peers as JSON `{name, ssh, tree, bun, envFiles, capacity, checks, packs}`. They live
  in the ignored `.env.runs`, copied from `.env.runs.example`, and pass as a second `--env-file`.
- **One or two campaigns a host.** Deadlines count elapsed time, so each solve waits until the
  one-minute load is at or under the cores, for up to half an hour; `--loaded` skips the wait, the
  operator's word that its times will not be compared.

The receipt records flags, commit, dirty state, load and Bun; the log holds code by content, so the
commit is on record only there. Once the run starts, tag it:
`git tag run/<name>/<n> <commit> && git push origin run/<name>/<n>`.

A name is the folder `.ana/d2/<name>/`, chosen once and never reused: letters, digits, `.`, `_`,
`-`, at most 128 characters, no `..` (`isSafePathSegment`). Every launch appends its machine's name,
so one pack on two hosts makes two names. Write the name, project and reason into the ledger before
the launch.

## Continue, pause and words

```sh
bun --env-file=<file> run runs continue <name> [--at <commit>] [--login N] [--budget N] [--after <event>] --yes [-- <flags>]
bun run runs pause <name> [--after <word>[|<word>...]] --yes
```

`continue` reruns a stopped campaign in its worktree on the flags of its last receipt, less `--name`
and `--budget` (the log holds the total; `--budget` names another); flags after `--` replace them
all, so adding one, such as `--promotions N`, means repeating the kept ones, which `continue`
without `--yes` prints.
It refuses as `launch` does, refuses `--at` another commit while a comparison is open
(`openComparisons`), since that comparison needs its own code, and refuses a login at its fleet cap,
a second GPT run on one machine, or a fleet it cannot count (`startRefusal`). A measured run continues
at its opening commit; a fix is measured by a fresh run.

`pause` waits for one more event its word names at a point with no comparison, Examiner session or
draft open, then stops the run. The words are `compacted` (`build.compacted`), `reported`
(`comparison.reported`), `promoted` (`harness.promoted`), `examined` (`exam.finished`) and
`finished` (`build.finished`); words joined by `|`, as `reported|promoted`, wait for the first of
their events. A pause right after `promoted` leaves that promotion's starter comparison unread. A pause cuts the Builder's
conversation, so the continued campaign opens a new one on its notes. `continue --after <event>`
pauses and continues, which moves a run to another login or commit cleanly. `--after next`, the
default, drains the run to save credit: no further solve starts, and it stops at the next finished
solve or tool call, or a minute past the solve limit. Sessions spend until then; `runs stop` frees a
login at once. Its pause word (`campaign.word`, `PAUSE`) is in the log once written and holds every
new solve of the running process for the solve limit and two minutes, so a pause or `continue
--after next` interrupted after it leaves the run idle that long; only a restarted process ignores
it, so arm the command once the decision is made.

A word (`tools/d2/word.ts --name <name>`) acts at the next move boundary and reaches no seat:
`--stop "<why>"` ends the campaign `operator`; `--budget N` sets its total; `--tasks "<why>"` asks for
an Examiner session first. One word per command. `--promotions N` after `--` is a campaign flag
instead: it ends the campaign `operator` at N promotions, the opening keeps it, and
`--promotions none` lifts it.

## Keep

```sh
bun --env-file=<file> --env-file=<hosts file> run runs keep <name> [--logins <list>] [--wait-hours 0.25] --yes
```

`launch`, `continue`, `fresh` and `move` give a run on a numbered login a keeper of its own where
another login is allowed (`keepsItself`, `tools/runs/manage.ts`); that launch gives the keeper the
word to spend on another allowed login. `ANA_KEEP=off` gives new runs none. A run with no numbered
login has nowhere to move and gets none.

The keeper takes its logins from `--logins`, `ANA_LOGINS`, then the environment, and checks once a
minute (`turnOf`). On a provider wait longer than `--wait-hours`, it stops the run and continues it
on the login with room whose week resets soonest and whose five hours are forecast to last
(`fiveHourWith`); a login at 100% or unreadable is not taken. Where the process died without an
ending, or ended `environment`, it continues on the same login if that is ready and under its cap
(`atCap`), otherwise on one with room. Any other ending is the campaign's own, and the keeper leaves;
a `budget` ending, even inside a comparison, is one no login can finish, and only a raised total
(`continue --budget N`, the operator's dollar cap) goes on with it.
A run with no `claude/` seat restarts after a death but sits out provider waits. Three continues in a
row without an answered model turn end the keeper. Restarts stay at the worktree's commit; output
goes to `keep.out`, and `runs stop <name> --yes` ends run and keeper both.

## Copy and move

```sh
bun run runs copy <name> --to <worktree> --yes
bun --env-file=.env.runs run runs move <name> --from <host> --to <host> [--login N] --yes
```

`copy` is the one sanctioned way between worktrees (`AGENTS.md`, section 5). It refuses a live or kept
run and a target holding the name, copies the folder whole, checks the log's size, and renames the
source to `.ana/moved/<name>-<stamp>`. Continue there with `continue --at` only while no comparison is
open, since the target's commit becomes the code it runs.

`move` checks the destination, prepares its code, pauses the run at its `--after` event (`finished`
by default), makes `anabasis-<name>` there at the source's commit, transfers the folder with rsync
through this machine, checks the size, sets the source aside and continues on the kept flags.
`--hold` stops before the continue. The pause ends any keeper. A change of login on one machine needs
no move: `continue --after <event> --login N`.

## Logins and hosts

```sh
bun run runs usage [N ...] [--json] [--open] [--closed]
bun --env-file=<file> --env-file=.env.runs run runs status [--all]
bun --env-file=<file> --env-file=.env.runs run runs on <host> status
bun --env-file=<file> --env-file=.env.runs run runs hosts [--all]
```

`usage` reads each login's windows from the provider (or rate-limit headers where refused), keeps a
history in `.ana/logins-history.jsonl`, and forecasts when the pool runs out by whichever of the
model, the week pace and the per-run rate read the last held-out hours best (`modelLines`). Each login
line shows `open` or `closed until <reset>` and its live runs out of the most it carries: the lower of
its cap (`capOf`: its `N:most` in `ANA_LOGIN_RUNS`, else its subscription in `ANA_LOGIN_SUBS`, two
for `max` or `pro100` and four for `ultra` or `pro200`, else the bare number) and the runs its week
can fit (`fitOf`), with more marked `oversubscribed`. `keep` and `fresh` read room the same way.
`active` names the live runs on each login across hosts, by each run's last launch; count it before a
launch, continue or move, and add by hand any seat without `--login` or session on a numbered login.

`status` hides stopped runs idle for a day unless `--all`, and names the archive's newest campaigns.
`hosts --health` reports load against cores, the charger, disk sizes, Bun, controllers, live
campaigns and the busiest processes with their run; an unanswering machine is not an empty one. End
an attributed campaign with `stop`; leave unattributed processes, caches and power settings to a
person.

Remote verbs run from a clean detached controller at the nearest published ancestor of HEAD
(`fresh`, `move` and `continue --at` need their exact commit). A cold controller gets five minutes
to prepare, then each request 30 seconds; a peer that times out refuses admission instead of counting
as empty. Env files stay on their own machine. `ANA_HOP=1` prevents recursive fan-out. Skill scripts
reach peers through `scriptOn` and `askedScript` (`tools/runs/hosts.ts`), and any script parsed by
`.claude/skills/main/cli.ts` takes `--host <name>`. Direct scripts need the host environment:
`bun --env-file=.env.runs <script> ...`.

## Keep the machines' settings in step

Every remote verb carries `ANA_LOGINS`, `ANA_LOGIN_RUNS`, `ANA_LOGIN_SUBS`, `ANA_KEEP` and the host's
`capacity` with it (`carriedTo`, `tools/runs/hosts.ts`), so no peer holds a copy to drift, and a value
that looks like a credential is refused. `ANA_HOSTS` stays on the central machine. `bun run runs sync`
aligns what does live on each machine: `ANA_TOOLS`, a table of tools and versions read in the wall's
path order, and `ANA_PYTHON` with `ANA_PYTHON_PACKAGES`, one Python through `uv` on every machine
(what a solve finds is `hostPython`). With no flag it prints the differences; `--yes` applies and
rechecks; `--check` exits 1 on any difference, for a timer. A change a seat would see is refused on a
host with a live campaign, or an uncountable one, unless `--force`, because what a solver is given is
the operator's. A runner reinstall here is refused without `--force` while hosts are listed and none
sets `checks`, since every check would then run here. Sync uninstalls nothing, never touches a run, and never carries `.env` or an env
file: logins move between hosts by the operator's hand.

## What is refused

`AGENTS.md`, section 6, "What refuses a move", owns the admissions. Read the refusal before choosing
a remedy. By hand, a comparison first needs:

| the log needs | from |
| --- | --- |
| a checker read without faults, or frozen over them | `bun tools/c/accept.ts ... --name <name> [--admit <checks> \| --admit-authored] [--freeze [--despite "<why>"]]` |
| the pack's tasks held out, practice released | `bun tools/d2/prepare.ts ... --name <name>` |
| more held-out tasks | `bun tools/d1b/examine.ts ... --name <name> --session x-1` |

Acceptance is the operator's (`AGENTS.md`, section 3 and rule 10). `--predict "<sentence>"` on a
comparison or round by hand records what it should read before its first solve.

## Watch

```sh
bun run runs pulse [<part of a name> ...]
bun run runs view <name> [--level N] [--target N] [--practice N] [--past-stop "<why>"]
```

`pulse` reports what each run gained since the last look, session starts, and a process gone before
its ending (read its launch `.err`). `view` prints the campaign and, last, the move the table names
(`decide`), which the Builder may decline; it uses this checkout's code, so check the receipt before
reading it as a live run's advice. `pulse --here` polls this machine only. Neither starts a run.

A look's lines name the step a run has come to owe, each from one owner (`tools/runs/said.ts`): the
exam's milestones in counts, what a comparison can read as it starts, a promotion with "a pause
should wait for its starter comparison", each starter comparison under its report, `ready to pause`
with its command at the second read, and once, when a campaign reaches it, `⚠ investigation due`
with the command that opens one. A closed run's reason and a host that stops answering are said
when they turn, not at every look.

`bun run runs alerts` is the cron watch: one stdout line per new promotion, starter comparison,
keeper move, missing process, ending or stall, nothing otherwise, and exit 0. It prints the `runs
pause` command once two promotions are read against the starter, and never runs it.

Each look also says, under each moment among a run's new events (the contract's freeze, a
comparison's start, a report, a promotion, an Examiner's or Builder's end, a campaign's opening or
ending), what the deterministic readers that
name that moment (`at`, `READERS`, `tools/wri/derive.ts`) found of it: `◆ <reader>: <line>` for each
line naming its session or harness, or its `gist` where none does (at most 3 a reader, 12 a run, 30
a look), with the full text in a named folder. One low-priority pass a host (`tools/wri/pass.ts`)
runs a reader only once one of its moments lies past what it read, at most 30 s every 4 minutes and
only with a core free; a look whose new events hold no moment starts none. A moment not yet read is
named once (`· not read yet: <readers> of <moment>; <why>`, `⚠` where the last pass failed) and its
lines come at the look that
finds them. `--no-readers` skips them. Results lie in `.ana/pulse/moments/` and hold hidden values,
so no seat can read them (`test/runs-pulse-readers.test.ts`).

## Stop

```sh
bun run runs stop <name> ... [--yes]
```

`stop` ends the process writing each log and the processes it started, then releases the roots of
every solve, session and draft left open; a dead run is cleaned up the same way. A stop is abrupt and
writes no ending. `continue` goes on from the log under the same name; the session the stop cut has
spent its id, and an Examiner session's held-out tasks stay held. Prefer `pause` or a word where a
clean point can be waited for. Whether to stop is a reading and the operator's word. Afterwards check
that `writers(runNamed(name), processes())` (`tools/runs/registry.ts`) is empty, and read any release
failures; a root from an older Mac runner may need `hdiutil detach` first (`release`,
`tools/runs/stop.ts`).
