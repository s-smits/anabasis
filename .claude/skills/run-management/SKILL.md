---
name: run-management
description: "Start, continue, keep, pause, copy, watch and stop authorised Anabasis v2 campaigns through `bun run runs`: launch a campaign under a name, go on with one from its log on another login or commit, keep one going across logins until it ends on its own terms, pause one at a clean point, copy a stopped one to another worktree, move one to another host, read each run's status and each login's room, reach the other hosts, and stop one and release what it held. Use when the operator asks to start, launch, resume, continue, move, keep, pause, copy or stop a campaign or a run, which logins have room, how the runs stand on any host, whether a campaign is ready for its next move, or why a move was refused. Owns the run's life on the host; run-improvement-campaign reads the table, and whole-run-investigation reads what a run did."
---

# Run management

A campaign is one command over one log (`tools/d2/harness-builder.ts`): it prepares the exam and
opens one live Builder conversation, which edits the harness and calls campaign tools for the
Examiner, practice release, comparison and promotion. The decision table supplies public advice;
the commands keep their admissions, budget and privacy checks. `--no-builder-led` opens one whose
every move the host makes as the table names it; the opening keeps the term either way.

Use the verbs of one CLI for a run's life on the host, `bun run runs`
(`tools/runs/cli.ts`), over every run log in the repository's worktrees (`tools/runs/registry.ts`).
`continue`, `pause`, `keep`, `copy`, `move`, `stop` and `source` take a campaign's whole name,
and refuse one no worktree holds and one two worktrees hold. `view` reads the named campaign in
the current worktree, or the archive's where no worktree holds it; `pulse` matches parts of names
across worktrees, and `zip` and `replay` also across the archive. The archive is `data/runs/` of
the main worktree, which git ignores: `here/<name>/` for this machine's campaigns that `retire`
moved out of their worktrees, and `<host>/<name>/` for copies of a host's. No verb acts on an
archived campaign; `copy <name> --to <worktree>` brings this machine's back to go on with.

| verb | what it does | file |
| --- | --- | --- |
| `fresh <pack> [--model opus\|sonnet\|gpt] [--effort hhmm] [--login N] [--budget 800] [--as <suffix>] [--at <c>] [--host <host>] [--yes] [-- <flags>]` | names a campaign from a blank project, makes its worktree at a published commit and launches it there | `fresh.ts` |
| `launch <name> [--login N] [--yes] -- <flags>` | starts the campaign command under a new name, in this worktree | `manage.ts` |
| `continue <name> [--at <c>] [--login N] [--budget N] [--after <event>] [--yes] [-- <flags>]` | runs a campaign again from its log, on its kept flags or their replacement after `--` | `manage.ts` |
| `pause <name> --after <event> [--yes]` | stops a campaign once its log gains one more of the event and nothing but its Builder's conversation is open | `manage.ts` |
| `keep <name> [--logins 2,3,4] [--wait-hours 1] [--yes]` | keeps a campaign going: moves it off a long provider wait, and continues it after a death or an `environment` ending | `keep.ts` |
| `copy <name> --to <worktree> [--yes]` | copies a stopped campaign whole to another worktree, from a worktree or the archive, and sets the source aside | `manage.ts` |
| `move <name> --to <host\|here> [--from <host\|here>] [--login N] [--after <event>] [--hold] [--yes] [-- <flags>]` | pauses a campaign at a clean point, takes its folder whole to a new worktree on the other machine at the same commit, sets the source aside and continues it there on its kept flags | `move.ts` |
| `stop <name> ... [--yes]` | ends the process that writes each log, and its keeper, and releases what its unfinished solves and sessions held | `stop.ts` |
| `status [--all]` | one row a run: the live ones and those whose log moved in a day, with tree, commit, login, open comparison, comparisons reported, promotions and ending; then each host `ANA_HOSTS` lists, all asked at once and each printed as it answers, within 30 s | `pulse.ts` |
| `logins [N ...] [--json]` (also `usage`) | each login's five-hour and weekly use; without numbers or `--json`, also the pool forecast | `logins.ts` |
| `fetch <name> [--from <host>]` | a copy of a campaign another machine holds, to read here, into the archive as `data/runs/<host>/<name>/` | `move.ts` |
| `retire [--days 1] [--yes]` | moves each campaign no process writes or keeps, idle for `--days`, into the archive whole (a seed, `seed.json` beside its log, is deleted instead, the archive's too), and deletes each worktree nothing uses (a week for one with uncommitted work); then the same on every host, whose archive comes here. A daily job runs it with `--yes`; nothing else in an archive is deleted | `retire.ts` |
| `on <host> <verb ...>`, `hosts [--all]` | any verb on another host over ssh; `status` on each other host alone. A verb that names a run goes to its host by itself | `hosts.ts` |
| `pulse [<part of a name> ...] [--once] [--every 290] [--state <file>]` | what each run gained since the last look; state defaults to `.ana/runs-pulse.json` | `pulse.ts` |
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
to write. It names the run `<pack>-fresh-<model>[-<suffix>][-r<n>]` and its project `<pack>-fresh`,
seats one model in all four seats (`--effort` a letter a seat of `lmhx`, by default `hhmm` for
Opus, `xxhh` for Sonnet and `hhhh` for GPT), takes a budget of 800 dollars unless `--budget`,
makes the worktree `anabasis-<name>` beside the main worktree, detached at `--at` (this
checkout's commit by default), and launches there as below. Opus is the default model. `gpt`
seats `openai-codex/gpt-6.1-sol` through the Codex CLI's login, which `--login` does not select.
The solve defaults are the campaign's: 20 model turns and 30 minutes (`LIMITS`,
`tools/d2/campaign.ts`).

`--host` runs it on a host `ANA_HOSTS` lists, at `--at` or this checkout's commit, using the
host's name as the suffix unless `--as` names one. That host's tree must have the `fresh` verb.
Flags after `--` go to the campaign command. Write the prediction ledger before `--yes`.

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
  reaches the command. With no `--login` and no unnumbered login, the one numbered login held is
  taken, and two or more are refused. `claude/<model>` runs Claude Code on that login and `claude-api/<model>` on
  `ANTHROPIC_API_KEY`: two providers, so a solver on one is another setting than on the other.
- **What the operator's machines hold is environment, too.** `ANA_LOGINS` names the logins a run
  may take (`2,3,4`; every login the environment holds where unset), and `ANA_HOSTS` the other
  hosts, a JSON list of `{name, ssh, tree, bun, envFiles}`. Copy `.env.runs.example` to
  `.env.runs`, which Git ignores; `.env.runs.example` stays tracked. Fill in your own and
  pass it with a second `--env-file`.
- **One or two campaigns at a time on one host.** A solve's wall counts the clock. The command
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
`<pack>-fresh-<model>[-<suffix>][-r<n>]`. A suffix
may be given with `--as`; otherwise a remote launch uses its host's configured name. A campaign
continued keeps its name. The project (`--project`) groups campaigns for the operator. Write
the name, the project and why into the prediction ledger before the launch, beside the prediction.

## Continue, move and pause

```sh
bun --env-file=<file> run runs continue <name> [--at <commit>] [--login N] [--budget N] [--after <event>] --yes [-- <flags>]
bun run runs pause <name> --after promoted|compacted|reported|finished --yes
```

`continue` runs a stopped campaign again in the worktree that holds its log, on the flags its last
`launch-run-<n>.json` kept, less `--name` and `--budget`: the record holds the total, which a
budget word may have set since, and `--budget` names another. Flags after `--` replace the kept
flags. It refuses as `launch` does, and refuses `--at` another commit while any comparison began
and has not reported (`openComparisons`). That comparison needs its own code until it reports.
For a measured run, continue at its opening commit and measure a fix with a fresh run
(`AGENTS.md`, section 10, item 9).

`pause` waits until the log has gained one more of the event (`harness.promoted`,
`build.compacted`, `comparison.reported`, `build.finished`) at a point where no comparison,
Examiner session or draft is open, and then stops the run. The Builder's conversation is open
throughout a led campaign, and a pause cuts it: the campaign continued opens a new one on its
notes, and the session the stop fell inside has spent its id. `continue --after <event>` is that
pause and then the continue, which is how a run moves to another login or commit at a clean point.

A word left with `tools/d2/word.ts` acts at the next move boundary and spends no session:
`--stop "<why>"` ends the campaign `operator`, which is a pause the operator words; `--budget N`
sets its total; `--tasks "<why>"` asks for an Examiner session first. Name the
campaign with `--name <name>` and leave one word per command. A word reaches no seat.

## Keep a campaign going

```sh
bun --env-file=<file> --env-file=<hosts file> run runs keep <name> [--logins 2,3,4] [--wait-hours 1] --yes
```

A keeper takes its logins from `--logins`, then `ANA_LOGINS`, then the numbered logins in the
environment (`allowedLogins`). It looks at the run once a minute and takes one of four turns
(`turnOf`). While the process lives and its log ends on a provider wait with more than
`--wait-hours` left until the reset, it stops the run and
continues it on the login with room whose week resets soonest. Where the process is gone and the
log holds no ending, or the ending `environment`, it continues on the same login where that
login is recorded and its wait has expired, otherwise on one with room. Any other
ending is the campaign's own, and the keeper leaves. A login it moved off is not taken again until
the wait named for it is over; with no login left it says so once and waits. Three continues in a
row that leave the log as it was end the keeper: something it cannot mend ends the run each time.

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
bun --env-file=.env.runs run runs move <name> --to <host> [--login N] --yes
bun --env-file=.env.runs run runs move <name> --from <host> --to here [--login N] --yes
```

One end is this machine and the other a host `ANA_HOSTS` lists. The verb checks first that the
destination has no worktree `anabasis-<name>`, then pauses the run at its next `--after` event
(`finished` by default), makes that worktree beside the destination's repository at the commit the
source stands at, takes the folder over with rsync, checks the log's size, sets the source aside
under `.ana/moved/` and runs `continue` there on the kept flags, a path under the folder of the
source's worktrees named under the destination's. `--hold` stops before the continue and prints
it. Without `--yes` it reads both ends and moves nothing. Stop a `runs keep` of the campaign first.
A change of login on one machine needs no move: `continue --after <event> --login N`.

## Logins and other hosts

```sh
bun --env-file=<file> --env-file=.env.runs run runs logins [N ...] [--json]
bun --env-file=<file> --env-file=.env.runs run runs status [--all]
bun --env-file=<file> --env-file=.env.runs run runs on <host> status
bun --env-file=<file> --env-file=.env.runs run runs hosts [--all]
```

`logins` reads each login's five-hour and weekly window from the provider's usage endpoint, or
from the rate-limit headers of a one-token request where that is refused, and keeps a snapshot
in `.ana/logins-history.jsonl` of the main worktree after each call with a usable weekly reading,
keeping eight days. With no numbers or `--json`, it forecasts when the pool runs out at the
week's pace and a recent pace from a reading 2 to 24 hours old (`poolLines`). A login has room
for a move when its week is under 90%, its five hours under 100%, and neither window is refused
(`room`), which is what `keep` reads.
`status` hides stopped seeds and stopped runs whose logs have not changed for a day unless `--all`.
Below this machine's rows it shows each host `ANA_HOSTS` lists. A verb that names a run (`stop`,
`continue`, `pause`, `keep`, `view`, `source`, `copy`) goes to wherever the run is: a name no
worktree here holds is asked of every host at once, and the verb runs on the one that holds it, so
`runs stop a b c --yes` stops runs on three machines. `view` runs in the worktree that holds its
campaign, since the move it names is that tree's code. A host's tree needs a commit that has this,
as `fresh --host` needs one that has `fresh`. `on` runs any verb in a host's worktree under a login
shell there, with that host's env files and `ANA_HOSTS` empty, which Bun keeps over an env file's: a
verb run on another host reaches no further one, and two machines that list each other do not loop.
`hosts` is the other hosts' `status` alone.

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
`--predict "<sentence>"` on a checkpoint or round started by hand puts on record what it should
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
may decline. `view` reads the campaign in the current worktree. Neither starts anything.

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
(`continue`), and the session the stop fell inside has spent its id. A checkpoint, or a round
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
