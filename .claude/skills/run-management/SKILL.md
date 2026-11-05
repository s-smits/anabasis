---
name: run-management
description: "Start, continue, keep, pause, copy, watch and stop authorised Anabasis campaigns through `bun run runs`: launch a campaign under a name, go on with one from its log on another login or commit, keep one going across logins until it ends on its own terms, pause one at a clean point, copy a stopped one to another worktree, move one to another host, read each run's status and each login's capacity, reach the other hosts, and stop one and release what it held. Use when the operator asks to start, launch, resume, continue, move, keep, pause, copy or stop a campaign or a run, which logins have room, how the runs stand on any host, whether a campaign is ready for its next move, or why a move was refused. Owns the run's life on the host; run-improvement-campaign reads the table, and whole-run-investigation reads what a run did."
---

# Run management

A campaign is one command over one log (`tools/d2/harness-builder.ts`): it prepares the exam and
opens one live Builder conversation, which edits the harness and calls campaign tools for the
Examiner, practice release, comparison and promotion. The decision table supplies public advice;
the commands keep their admissions, budget and privacy checks.

Use the verbs of one CLI for a run's life on the host, `bun run runs`
(`tools/runs/cli.ts`), over every run log in the repository's worktrees (`tools/runs/registry.ts`).
A bare `bun run runs` lists every verb with what it does, and `<verb> --help` its options.
`continue`, `pause`, `keep`, `copy` and `stop` route a whole campaign name to its machine. A missing
host or more than one original refuses the route. `view` and `source` read through this checkout,
refreshing remote records first; `replay` and `zip` discover matching campaigns on every machine.
`pulse` polls every machine without copying logs. The archive is `data/runs/` of
the main worktree, which git ignores: `here/<name>/` for this machine's campaigns that `retire`
moved out of their worktrees, and `<host>/<name>/` for copies of a host's. No verb acts on an
archived campaign; `copy <name> --to <worktree>` brings this machine's back to go on with.

| verb | what it does | file |
| --- | --- | --- |
| `fresh <pack> [<pack> ...] [--logins <allowed-list>] [--model opus\|sonnet\|gpt\|<provider>/<id>] [--effort hhmm] [--login N] [--budget 800] [--as <suffix>] [--at <c>] [--host <host>] [--no-keep] [--yes] [-- <flags>]` | names a campaign from a blank project, makes its worktree at a published commit and launches it there | `fresh.ts` |
| `launch <name> [--login N] [--no-keep] [--yes] -- <flags>` | starts the campaign command under a new name, in this worktree | `manage.ts` |
| `continue <name> [--at <c>] [--login N] [--budget N] [--after <event>] [--no-keep] [--yes] [-- <flags>]` | runs a campaign again from its log, on its kept flags or their replacement after `--` | `manage.ts` |
| `pause <name> [--after <event>] [--yes]` | stops a campaign at its next finished solve or tool call, or, with a clean-point event, once its log gains one more of it and nothing but its Builder's conversation is open | `manage.ts` |
| `keep <name> [--logins <list>] [--wait-hours 0.25] [--yes]` | keeps a campaign going: moves it off a provider wait on either limit, and continues it after a death or an `environment` ending. A run on a numbered login gets one by itself; this verb attaches one to a run that has none | `keep.ts` |
| `copy <name> --to <worktree> [--yes]` | copies a stopped campaign whole to another worktree, from a worktree or the archive, and sets the source aside | `move.ts` |
| `move <name> --to <host> [--from <host>] [--login N] [--after <event>] [--hold] [--yes] [-- <flags>]` | pauses a campaign at a clean point, takes its folder whole to a new worktree on the other machine at the same commit, sets the source aside and continues it there on its kept flags | `move.ts` |
| `stop <name> ... [--yes]` | ends the process that writes each log, and its keeper, and releases what its unfinished solves and sessions held | `stop.ts` |
| `status [--all]` | one row a run: the live ones and those whose log moved in a day, with tree, commit, login, open comparison, comparisons reported, promotions and ending, and on a closed row the hours until it leaves; under the rows, the closed runs it leaves out and the archive's newest campaigns; then each host `ANA_HOSTS` lists, all asked at once and each printed as it answers, within 30 s after cold preparation | `pulse.ts` |
| `usage [N ...] [--json]` | each login's five-hour and weekly use and, without `--json`, how many runs and simulation seats are live on it on every host (`1/2 active`, out of the most `ANA_LOGIN_RUNS` or its subscription in `ANA_LOGIN_SUBS` lets it carry, such as `2,N:4` or `N:ultra`); without numbers or `--json`, also the pool forecast | `logins.ts` |
| `active` | the runs and simulation seats live on each login by name, on this machine and every host, asking no provider | `logins.ts` |
| `sync [--yes \| --check] [--force] [--host <name>]...` | what differs from this machine's settings on each host, changing nothing unless `--yes`; `--check` exits 1 on any difference; nothing to do with no hosts | `sync.ts` |
| `search <pattern> [--regex] [--ignore-case] [--host <name>]... [--here] [--in logs\|notes\|all] [--max <chars>]` | searches campaign folders, notes and docs on all hosts concurrently; private extra note roots come from `ANA_SEARCH_ROOTS` in `.env.runs`; reports each engine and spills complete matches to a temporary log when output is cut | `search.ts` |
| `fetch [<name>] [--from <host>]` | a copy of a campaign another machine holds, to read here, into the archive as `data/runs/<host>/<name>/`; with no name, the records (log and receipts) of every campaign the other machines hold, which a timer on the central machine runs every ten minutes | `move.ts` |
| `retire [--days 1] [--yes]` | moves each campaign no process writes or keeps, idle for `--days`, into the archive whole (a seed, `seed.json` beside its log, is deleted instead, the archive's too), and deletes each worktree nothing has used for a week (two for one with uncommitted work) and each local branch no worktree holds that nothing has used for a week, tagging a commit nothing else holds; then refreshes each other host's records here. A daily job on every host runs it with `--yes`; nothing else in an archive is deleted | `retire.ts` |
| `on <host> <verb ...>`, `hosts [--all]` | any verb on another host over ssh; `status` on each other host alone. A verb that names a run goes to its host by itself | `hosts.ts` |
| `pulse [<part of a name> ...] [--once] [--every 290] [--state <file>] [--no-readers]` | what each run gained since the last look, and what every reader of its log says that this observer has not seen; state defaults to `.ana/runs-pulse.json` | `pulse.ts` |
| `view <name>` | one campaign as its log reads, and the move the table names next | `view.ts` |
| `source <name> [--holds <c>]...` | each run's commit, its tree, where the commit is published, whether it holds a fix | `receipt.ts` |
| `zip`, `replay`, `seed`, `rehearse` | handover, readers over every log, a seed, a rehearsal | zip-run, system-path-simulation |

`fresh`, `launch`, `continue`, `pause`, `keep`, `copy`, `move` and `stop` require `--yes` for
their proposed launch, stop or transfer. `fresh` still fetches `origin` without it.
Run authority and the conditions for a measured campaign are in `AGENTS.md`, section 10.

## Start

A measured campaign starts with one command, from a checkout at the commit it runs:

```sh
bun --env-file=<file> run runs fresh <pack> [--model sonnet] [--login N] [--as <suffix>] --yes
bun --env-file=<file> run runs fresh <pack> --host <host> ... --yes   # on another host
```

It reads the operator's prompt, `<pack>-prompt.txt` in `ANA_PROMPTS` (by default
`anabasis-prompts` beside the main worktree), and refuses a pack with none: a prompt is the operator's
to write. It names the run `<pack>-fresh-<model>[-<suffix>]-<host>[-r<n>]` and its project `<pack>-fresh`,
seats one model in all four seats (`--effort` a letter a seat of `lmhx`, by default `hhmm` for
Opus, `xxhh` for Sonnet and `hhhh` for GPT and any other model), takes a budget of 800 dollars unless `--budget`,
makes the worktree `anabasis-<name>` beside the main worktree, detached at `--at` (this
checkout's commit by default), and launches there as below. Opus is the default model. `gpt`
seats `openai-codex/gpt-6.1-sol` through the Codex CLI's login, which `--login` does not select,
and any other model a backend serves goes as its `<provider>/<id>`, at `hhhh` and named by its id:
`--model openrouter/deepseek/deepseek-v4.1-flash-1017` makes `<pack>-fresh-deepseek-v4.1-flash-1017`.
A run or a simulation seats Claude unless the operator names another model, and DeepInfra serves
DeepSeek alone, only where the operator names DeepSeek (operator, 31 October).
The solve defaults are the campaign's: 20 model turns and 30 minutes (`LIMITS`,
`tools/d2/campaign.ts`).

Without `--host`, `fresh` first takes, among machines below their capacity, the one where the
run's login pays for the fewest live runs, so that one login's limit leaves every machine
working. It then prefers a machine whose catalogue already holds a campaign of project
`<pack>-fresh`, and then the fewest live campaigns and simulation seats. This machine's cap is `ANA_RUN_CAP`; each peer's is its `capacity` in
`ANA_HOSTS`, both 2 where unset. A missing count or catalogue refuses placement. Ties follow
configuration order, with this machine first. `--host here` selects this machine explicitly;
`--host <host>` selects a peer. Every name ends with its machine's: a peer's `ANA_HOSTS` name, or this machine's short hostname for a run placed here, after `--as` where one is named.
An explicit host selects the destination; a remote receiver rechecks its cap before launching.
Counts are observations, so launch
sequentially; they reserve no slot against another launcher.
A peer whose `ANA_HOSTS` entry lists `packs` is kept for them: `fresh` puts no other pack there
and none of those packs on any other machine, whether it chooses or `--host` names the machine.

A peer's controller is prepared automatically at `--at` or this checkout's commit: fetch, a
detached worktree under Git's `ana-code/`, then a frozen install. Its configured checkout stays
in place. Without `--yes`, a remote fresh prints its plan and prepares no launch controller.
Read controllers can be prepared while checking placement.
Flags after `--` go to the campaign command. Write the prediction ledger before `--yes`.

For Claude Code seats, `fresh` takes `--login` or chooses from `allowedLogins` using the same
`readLogins` and `room` as the keeper: a usable window, the week that resets soonest first, and
room under `ANA_LOGIN_RUNS` across the fleet. An explicit login at its cap is refused too.
The count uses each configured checkout's existing `active --here` before preparing any source;
a missing answer refuses the launch. Before remote launch preparation, `active --here --login N`
answers only whether that environment holds the numbered key. A missing key refuses with a
request to carry the login first. Use the operator's own credential procedure; no value is
printed or carried by these commands. Seats billed through another provider need no Claude login.

Several packs before `--` make one ordered batch. `fresh <pack> <pack> ... --logins <allowed-list>`
prints the complete host and login plan without launching; repeat with `--yes` to execute it.
The planner reserves each earlier entry in its own counts and affinity catalogue, so repeated
packs stay together where room remains. It reads provider usage once, checks every selected
remote login before the first launch, pins one published commit and launches sequentially through
single-run admission. Any failed launch exit stops the remainder. The configured capacities and
login caps must allow the requested total; the plan reserves nothing against another session.
An explicit `--host` belongs to a single pack. Campaign flags belong after `--`.

Use the operator's authorised carriage procedure to pipe only the selected numbered token line
into the destination's environment without printing it, then retry the same command.

`launch` is the step under it, also available when the campaign needs explicit flags:

```sh
cd <the worktree kept for the run>
bun --env-file=<file> run runs launch <name> [--login N] --yes -- \
  --project <project> <the pack's four flags, or --prompt-file <file> --solver <model>> \
  --budget <dollars> --builder <model> --examiner <model> --reviewer <model> \
  [--solve-model-turns N] [--minutes N] [--turns N] [--level 0.02]
```

The flags after `--` are the command's own, parsed by `flagsOf` in `tools/d2/campaign-terms.ts`,
without `--name`. Until 19 October 2026, `--trigger` bought a repeat and `--margin` set an
objective margin. Both flags are now refused. One reading of `step` promotes outside `--hitl`.
Before it starts anything the verb refuses a name any worktree holds a campaign
of, a log a process already writes, a worktree with a change no commit names, and a commit no
remote branch holds. It then installs (`bun install --frozen-lockfile`), runs the command's own
`--dry-run`, and starts it only where that passed: niced, in a process group of its own, which
`stop` ends, and outliving the verb. Its output goes beside the log as `launch-run-<n>.out` and
`.err`, next to the receipt the command keeps as `launch-run-<n>.json`.

- **The env file is Bun's to read.** `bun --env-file=<file> run runs …` loads it into the verb's
  process, which hands the environment on; these verbs do not open the file. Do not
  print, copy or search for it. `--login N` runs the command on the login the environment holds as
  `CLAUDE_CODE_OAUTH_TOKEN<N>`, passed on as `CLAUDE_CODE_OAUTH_TOKEN`, and no numbered key
  reaches the command. With no `--login` the environment goes on less its numbered keys and no
  login is guessed: the command's dry run refuses a seat whose provider holds no credential, so a
  run with a `claude/` seat names its login, as `fresh` and `keep` do. A machine that holds only the
  plain `CLAUDE_CODE_OAUTH_TOKEN`, and no numbered login is allowed, runs every campaign on it
  (`plainOnly`, `tools/runs/logins.ts`). `claude/<model>` runs Claude Code on that login and `claude-api/<model>` on
  `ANTHROPIC_API_KEY`: two providers, so a solver on one is another setting than on the other.
- **What the operator's machines hold is environment, too.** `ANA_LOGINS` names the logins a run
  may take (`2,3,4`; every login the environment holds where unset), and `ANA_HOSTS` the other
  hosts, a JSON list of `{name, ssh, tree, bun, envFiles, capacity, checks, packs}`; only a host
  with `checks` takes the check runner's tasks, that many at once. Copy `.env.runs.example`
  to `.env.runs`, which Git ignores; `.env.runs.example` stays tracked, with every setting
  commented out, so a copy as it stands keeps every run on one machine. Fill in your own and pass
  it with a second `--env-file`.
- **One or two campaigns at a time on one host.** A solve's deadline counts elapsed time. The command
  waits before each solve until the one-minute load is at or under the cores, or half an hour on,
  and says so once; `--loaded` starts it all the same, the operator's word that its times will not
  be compared.

`AGENTS.md`, sections 3 and 6, own the campaign's recorded terms, setting, unattended operation
and `--hitl`. `--minutes` bounds the Builder's own time across its conversation; the clock stops
while a campaign action runs (`Bench.within`, `src/builder/tools.ts`). After `finish` or its
limits, a new conversation opens on the Builder's notes, after the host makes what the table
still owes. Three conversations in a row without a campaign move end it `finished` (`idleOf`).

The receipt holds the flags, the commit and whether the tree was dirty, the load and cores it
started under, and the Bun (`tools/runs/receipt.ts`). The log holds the host's code by content and
no commit, so the receipt is where the commit is on record. Tag it once the run has started,
`git tag run/<name>/<n> <commit> && git push origin run/<name>/<n>`, with the receipt's `n`: a
pull-request branch may be rewritten; `bun run runs source <name>` names the tag.

## Name the run and its project

A name is the campaign's folder, `.ana/d2/<name>/`, chosen once and never reused. It starts
with a letter or digit, uses only letters, digits, `.`, `_` and `-`, has at most 128 characters
and contains no `..` (`isSafePathSegment`). `fresh` makes it,
`<pack>-fresh-<model>[-<suffix>]-<host>[-r<n>]`. A suffix
may be given with `--as`; every launch adds its machine's name to it, so one pack sent to two hosts
opens two names and a name says where it runs. A campaign
continued keeps its name. The project (`--project`) groups campaigns for the operator. Write
the name, the project and why into the prediction ledger before the launch, beside the prediction.

## Continue, move and pause

```sh
bun --env-file=<file> run runs continue <name> [--at <commit>] [--login N] [--budget N] [--after <event>] --yes [-- <flags>]
bun run runs pause <name> [--after next|compacted|reported|finished] --yes
```

`continue` runs a stopped campaign again in the worktree that holds its log, on the flags its last
`launch-run-<n>.json` kept, less `--name` and `--budget`: the record holds the total, which a
budget word may have set since, and `--budget` names another. Flags after `--` replace the kept
flags. It refuses as `launch` does, and refuses `--at` another commit while any comparison began
and has not reported (`openComparisons`). That comparison needs its own code until it reports.
It also refuses, before any pause, a login at its cap of live runs across the fleet, a GPT run on
a machine that already carries one, and a fleet it could not count (`startRefusal`), counting
every live run but the one it starts. `move` asks the same of the destination, and a keeper waits
on it instead. For a measured run, continue at its opening commit and measure a fix with a fresh run
(`AGENTS.md`, section 10, item 9).

`pause` waits until the log has gained one more of the event (`build.compacted`, `comparison.reported`, `build.finished`) at a point where no comparison,
Examiner session or draft is open, and then stops the run. The Builder's conversation is open
throughout a led campaign, and a pause cuts it: the campaign continued opens a new one on its
notes, and the session the stop fell inside has spent its id. `continue --after <event>` is that
pause and then the continue, which is how a run moves to another login or commit at a clean point.
`--after next`, the default of `pause`, waits only for the next finished solve or tool call any
seat records (`solve.finished` or a `*.call`), looking every second, and stops the run there with
whatever is open: the quickest way to free a login. A comparison it cuts goes on under its own
terms when the run continues, and a cut solve is solved again.

A word left with `tools/d2/word.ts` acts at the next move boundary and spends no session:
`--stop "<why>"` ends the campaign `operator`, which is a pause the operator words; `--budget N`
sets its total; `--tasks "<why>"` asks for an Examiner session first. Name the
campaign with `--name <name>` and leave one word per command. A word reaches no seat.

A cap on promotions is a campaign flag, not a pause: `--promotions N` after `--` at `fresh`,
`launch` or `continue` ends the campaign `operator` once its log holds N promotions (the `stop` row,
`src/campaign/decide.ts`), and the opening keeps it, so a continue that names none runs by it;
`--promotions none` lifts it. Unset, a campaign has no cap. The Builder is told only that the
campaign is at its operator gate.

## Keep a campaign going

```sh
bun --env-file=<file> --env-file=<hosts file> run runs keep <name> [--logins <list>] [--wait-hours 0.25] --yes
```

`launch`, `continue`, `fresh` and the continue at the end of a `move` each leave the run a keeper by
themselves, on the machine it runs on, where it pays by a numbered login and another login is allowed
(`keepsItself`, `tools/runs/manage.ts`). A keeper may then spend on another allowed login with nobody
asked. `--no-keep` leaves one run without one. `ANA_KEEP=off` in `.env.runs` leaves every run started
from that machine without one, on a peer too, and ends no keeper already running. A run started before
this, or with `--no-keep`, takes one by the verb above. A run with no numbered login, GPT's or a plain
login's, gets none: it has nowhere to move.

A keeper takes its logins from `--logins`, then `ANA_LOGINS`, then the numbered logins in the
environment (`allowedLogins`). It looks at the run once a minute and takes one of four turns
(`turnOf`). While the process lives and its log ends on a provider wait, on the week's limit or the
five hours', with more than `--wait-hours` left until the reset, it stops the run and
continues it on the login with capacity whose week resets soonest, of those read to last their five
hours with this run added. Less than that is left to the login's own reset, since a move cuts the
Builder's conversation.

That forecast is `fiveHourWith` (`tools/runs/logins.ts`, whose comment says how it reads a login). A
login at 100% or over is not taken, and neither is one it cannot read: a move spends on another login,
so it needs a reading to say it may. With nothing to take the keeper says why once, stops nothing, and
reads the logins again every ten minutes.

Where the process is gone and the
log holds no ending, or the ending `environment`, it continues on the same login where that
login is recorded, its wait has expired and it is below its cap of live runs across the fleet
(`atCap`), otherwise on one with capacity. Any other
ending is the campaign's own, and the keeper leaves. A run with no `claude/` seat bills no login: it
goes on without one after a death, so no login's count holds it, and sits out a provider wait, since a
restart would meet the same limit. A login it moved off is not taken again until
the wait named for it is over. Three continues in a
row without an answered model turn from any seat end the keeper: something it cannot mend ends the run each time.

Each restart uses `start` from `manage.ts`, at the current worktree's commit and with the same
refusals as `runs continue`; it does not switch commits. With `--yes` the keeper runs by itself,
its output in `keep.out` beside the log, one keeper a run; `runs stop <name> --yes` ends the run and its keeper
both. Authorising `keep` covers its login moves and restarts after a death or an `environment`
ending, until it ends on its own terms or reaches its restart limit.

## Copy a campaign to another worktree

```sh
bun run runs copy <name> --to <worktree> --yes
```

The one sanctioned way to move a campaign's folder between worktrees (`AGENTS.md`, section 10,
item 1). It refuses a run that a process writes or a keeper keeps, and a target that holds the name. It copies the
folder whole, links as links, checks that the log arrived at its size, and renames the source to
`.ana/moved/<name>-<stamp>` in its own worktree, so one worktree holds the name. Continue it there
with `continue --at` only where no comparison is open, since the target worktree's commit is the
code it then runs.

## Move a campaign to another machine

```sh
bun --env-file=.env.runs run runs move <name> --from <host> --to <host> [--login N] --yes
```

Each end is a host `ANA_HOSTS` lists or this machine, named by its own short host name (`hostname
-s`; `here` also names it) and the default `--from`; between two hosts the folder passes through
this machine, since rsync takes one remote side. The verb checks first that the
destination has no worktree `anabasis-<name>`, prepares its code, then pauses the run at its next `--after` event
(`finished` by default), makes that worktree beside the destination's repository at the commit the
source stands at, takes the folder over with rsync, checks the log's size, sets the source aside
under `.ana/moved/` and runs `continue` there on the kept flags, a path under the folder of the
source's worktrees named under the destination's. `--hold` stops before the continue and prints
it. Without `--yes` it reads both ends and moves nothing. The pause ends a `runs keep` of the campaign, running or not.
A change of login on one machine needs no move: `continue --after <event> --login N`.

## Logins and other hosts

```sh
bun run runs usage [N ...] [--json]   # `bun run runs` loads .env and .env.runs itself
bun --env-file=<file> --env-file=.env.runs run runs status [--all]
bun --env-file=<file> --env-file=.env.runs run runs on <host> status
bun --env-file=<file> --env-file=.env.runs run runs hosts [--all]
```

`active` names the runs a process writes on each login, on this machine and on each host (each asked
`active --here` at once), by the login each run's last launch named. Every login `ANA_LOGINS` names
gets a line, runs that name none get one, and so do hosts that did not answer; a host whose tree
predates `active` is one. Count it before a launch, a continue or a move.

`usage` reads each login's five-hour and weekly window from the provider's usage endpoint, or
from the rate-limit headers of a one-token request where that is refused, and keeps a snapshot
in `.ana/logins-history.jsonl` of the main worktree after each call with a usable weekly reading,
keeping eight days. With no numbers or `--json`, it forecasts when the pool runs out at the
week's pace and a recent pace from a reading 2 to 24 hours old (`poolLines`). A login has room
for a move when neither its week nor its five hours is used up and neither window is refused, the
week that resets soonest first, a nearly spent one included (`room`), which is what `keep` and
`fresh` read; `keep` also asks `fiveHourWith`, and `fresh`, which a person words, does not. Each login's head line reads its live runs on every
host out of the most it carries: the lower of its cap and the runs its week
left fits until its reset, each active 16 of 24 hours, at the rate a run spent between earlier
readings (`fitOf`). More live runs than the week fits reads `oversubscribed`, as `2/1`. The cap is
the login's own `N:most` in `ANA_LOGIN_RUNS`, then its subscription in `ANA_LOGIN_SUBS` (two runs on
`max` or the Codex login's `pro100`, four on `ultra` or `pro200`, printed on its line), then the bare number there (`capOf`); a `subs` line
sums the subscriptions' most against the runs live on them.
`status` hides stopped seeds and stopped runs whose logs have not changed for a day unless `--all`;
a stopped row says how many hours it has left, and the lines under the rows count the hidden runs
and name the archive's three newest campaigns, so an agent reading `status` alone knows they ran.
Below this machine's rows it shows each host `ANA_HOSTS` lists. Mutating named verbs ask every
host for the name before acting, so a duplicate or a host that does not answer refuses the
operation. `runs stop a b c --yes` routes all three names itself. `view`, `source`, `replay` and
the tuner use fresh log and receipt copies; WRI, harness audit, seed and zip fetch artefacts too.
Copies live under `data/runs/<host>/<name>/`, and a failed refresh leaves the previous copy intact
and refuses the read. Explicit log paths select an offline copy. The view's table is this
checkout's code, so compare the launch receipt before treating it as a running campaign's advice.

Remote reads and ordinary routed verbs use a clean detached controller at the nearest published
ancestor of this checkout's HEAD, using all remote tips in `git merge-base`. When that differs
from HEAD, stderr says so once. `fresh`, `move` and `continue --at` require their exact published
commit. A cold controller gets five minutes for fetch, detached worktree creation and a frozen
install, before fan-out starts each request's 30-second deadline. Ready controllers reuse their
install. A preparation lock is reclaimed when older than five minutes or its holder has gone.
After an install, prune controllers beyond the newest three by readiness time; process arguments
and working directories protect live controllers. Failed process inspection preserves them.
`continue --at` resolves that revision here, and uses its launcher on the peer.
Environment files stay on their own machine and relative names remain relative to the configured
checkout, and a host's own `.env.runs` always loads last, which `runs sync` generates. A login shell
supplies its tools, and `ANA_HOP=1` prevents recursive fan-out. A keeper started there drops it, and
so counts every host that machine's own `ANA_HOSTS` lists. `on` remains an explicit override. `hosts` shows peer statuses; `hosts --health` includes this machine and
every peer in one reading. The shared `scriptOn` and
`askedScript` in `tools/runs/hosts.ts` provide the same boundary to skill scripts, and any script
that parses through `.claude/skills/main/cli.ts` runs on a peer with `--host <name>`.

`hosts --health` reports load against cores, performance cores where reported, the charger,
sizes of run data, archive, controllers and other worktrees, Bun and controller readiness, live
campaigns and seats, and the three busiest processes with their owning run. It marks load above
cores, and warns of a disk below 10% free. Unknown OS facts are labelled; an unavailable
machine is not an empty one. Use `stop <name> --yes` for an attributed campaign. Leave termination
of unassigned processes manual because their owner is unknown. Cache eviction and power settings
remain manual because they can affect work outside a campaign.

Transport reuses private temporary SSH control sockets for five minutes, with a 20-second
connection deadline and 15-second keepalives. Fan-out reports elapsed time, including preparation,
and a timed-out peer refuses admission rather than contributing an empty count.

`view <name>` and `pulse` explain the last provider reset or load wait. A dead run without an
ending, or a quiet live one, includes a bounded tail of its newest regular launch stderr.
Remote record snapshots carry that tail and the remote liveness observation; a local pid never
stands for a remote process. Pulse labels this machine separately from its peers.

Direct skill and WRI commands need the host environment too: use
`bun --env-file=.env.runs <script> ...`, or export `ANA_HOSTS`. No script opens that file itself.

## Keep the machines' settings in step

One machine's `.env.runs` holds the settings, and `bun run runs sync` carries them to every host
`ANA_HOSTS` lists. With no flag it prints what differs on each machine and changes nothing; `--yes`
applies that, then reads again and exits 1 on anything left; `--check` prints the same and exits 1 on
a difference or a host that did not answer, for a timer. `--host <name>` narrows it, `here` among the
names. With no host and no `ANA_PYTHON` it says there is nothing to do and exits 0 with no ssh.

- **Settings.** A host's `<tree>/.env.runs` is generated from this machine's `ANA_LOGINS`,
  `ANA_LOGIN_RUNS`, `ANA_LOGIN_SUBS`, `ANA_KEEP` and `ANA_SEARCH_ROOTS`, its entry's `capacity` as
  `ANA_RUN_CAP`, and its entry's `settings` over those. A file that does not say it was generated is
  refused by name, with its keys named and its values unread. Anything else, a credential above all,
  is refused and its value never printed. A running process keeps the environment it started with, so
  the file reaches what starts after it: a peer's next verb or keeper then obeys `ANA_LOGINS`.
- **`ANA_HOSTS` stays on the one machine.** A peer that held it would gather every listed host's
  records at its daily `retire`. So a keeper started on a peer counts that machine alone, under the
  caps the generated file gives it.
- **Python.** `ANA_PYTHON` pins one version on every machine through `uv`, in
  `~/.local/share/ana-python`, ahead of everything else on the wall's path where it exists and absent
  from it otherwise. `ANA_PYTHON_PACKAGES` are kept in it, with pip checked present. It uninstalls
  nothing, and a package nobody named is reported and stays. A seat's home is its own, so a seat's `uv`
  reads no `uv.toml` from the real home, which is why sync reports that file and does not carry it.
  What a solve finds is `hostPython`, which verifies the result as it does a launch's receipt.
- **Refused.** A Python move under a live campaign, or where the live count cannot be read, is refused
  unless `--force`. A runner reinstall here is refused unless `--force` while hosts are listed and none
  sets `checks`, because that install would run every check on this machine. A version `uv` does not
  offer and a machine with no `uv` are refused whatever the flag. Settings are carried either way:
  nothing running reads them. No sync stops, edits or restarts a run.
- **Not carried:** `.env` and anything passed as `--env-file`, since a login goes between hosts by the
  operator's hand alone; `ANA_HOSTS`; and whatever a machine's own scripts hold.

## What is refused, and where

`AGENTS.md`, section 6, "What refuses a move", owns the admissions for commands run by hand
and by the campaign. Read the refusal before choosing a remedy; the campaign command takes the
next free session or comparison id itself (`nextId`).

By hand, what a comparison needs first:

| the log needs | from |
| --- | --- |
| a checker read, with no fault left, or frozen over its faults | `bun tools/c/accept.ts ... --name <name> [--admit <checks> \| --admit-authored] [--freeze [--despite "<why>"]]` |
| the pack's tasks held out, the practice released | `bun tools/d2/prepare.ts ... --name <name>` |
| further held-out tasks | `bun tools/d1b/examine.ts ... --name <name> --session x-1` |

For acceptance authority, see `AGENTS.md`, section 3 and section 8, rule 10.
`--predict "<sentence>"` on a standalone comparison or round started by hand puts on record what it should
read, before its first solve.

## Watch

```sh
bun run runs pulse [<part of a name> ...] [--once]
bun run runs view <name> [--level N] [--target N] [--practice N] [--past-stop "<why>"]
```

The pulse says what each run gained since the last look; it reports session starts
(`build.started`, `exam.started`) and a process gone before its expected ending. Read the
launch's `.err` when a process disappears. The view prints the campaign as its log
reads, and its last line is the move the table names for this log (`decide`), which the Builder
may decline. `view` uses this checkout's reader on a fresh copy where needed. `pulse --here`
limits a poll to this machine. Each observer has its own remote cursors under the main worktree,
so they survive controller changes; a local `--state` path is never sent to a peer. Neither starts
a run.

Each look also runs every deterministic reader (`READERS`, `tools/wri/derive.ts`) over each run whose
log moved, and says what this observer has not seen:

- **What it says.** `◆ <reader>: <line>` for a line it has not said, at most 3 a reader, 12 a run and
  30 a look, and `◆ the readers' full text: <folder>` for the rest. A line that moved only in a number
  waits for the first result past a milestone. A reader's first result is remembered and not said, as
  a trigger's is on a first look. `--no-readers` leaves all of this out.
- **What it cost.** One pass a host (`tools/wri/pass.ts`) does the reading at the lowest priority, one
  reader at a time, for at most 30 s once in 4 minutes however many sessions look, and each reader
  starts only where the one-minute load leaves a core under the line where a solve waits. A look waits
  for it at most 20 s. Under load the readers are shed, and said to be.
- **What a cut says.** `⚠ not read since the last look: <readers>; <why>` names each reader that read
  nothing past this observer's last look, on a log that moved since, whatever stopped it. It comes
  again until the reader catches up, and what the reader then says comes as ordinary news. A pass
  outlives a look the hook's limit killed, and a killed look moves no cursor, so its events come
  again. A peer holds its cursor until its caller returns the token it printed, so a look that never
  read a peer's answer hears it again; a peer with no answer within 33 s prints `⚠ no answer` and the
  look exits 1.
- **Where it lies.** Results lie in the main worktree's `.ana/pulse/readers/`, and each observer's copy
  of a reader with news in `<state>.d/<run>/`. Both hold hidden values as the log does, and no seat can
  read them (`test/runs-pulse-readers.test.ts`). A result may come from another session's commit.

## Stop

```sh
bun run runs stop <name> ... [--yes]
```

With `--yes` the process that writes each named log is ended first, then each one it started; no
process group is signalled unless one of those processes leads it. A stop also releases the
root of each solve, Builder session, Examiner session and draft the log started and never
finished, which only the ended process would have let go; a named run that is not running is
released the same way, so a killed run is cleaned up by stopping it.

A stop is abrupt: the run writes no ending. A campaign goes on from its log under the same name
(`continue`), and the session the stop fell inside has spent its id. A standalone comparison, or a round
after its `build.finished`, goes on under the same id with its terms; an Examiner session's id is
spent wherever the stop fell, and the tasks it held out stay held out. Prefer `pause` or a word
where a clean point can be waited for. Whether a run should be stopped is a reading
(whole-run-investigation) and the operator's word. Afterwards, verify that
`writers(runNamed(name), processes())` from `tools/runs/registry.ts` is empty and inspect any
release failures printed by `stop`. The pulse may still say `reported` for a stopped run whose
last work reported (`stage`).

For roots left by a Mac runner before 19 October 2026, `stop` may report a mounted disk image
it cannot remove. Detach that image with `hdiutil detach` before stopping the run again
(`release`, `tools/runs/stop.ts`).
