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

Everything that happens to a run on the host is a verb of one CLI, `bun run runs`
(`tools/runs/cli.ts`), over every run log in the repository's worktrees (`tools/runs/registry.ts`).
A verb that acts on one run takes a campaign's whole name, and refuses one no worktree holds and
one two worktrees hold.

| verb | what it does | file |
| --- | --- | --- |
| `fresh <pack> [--model opus\|sonnet] [--effort hhmm] [--login N] [--as <suffix>] [--at <c>] [--host <host>] [--yes]` | names a campaign from a blank project, makes its worktree at a published commit and launches it there | `fresh.ts` |
| `launch <name> [--login N] [--yes] -- <flags>` | starts the campaign command under a new name, in this worktree | `manage.ts` |
| `continue <name> [--at <c>] [--login N] [--budget N] [--after <event>] [--yes]` | runs a campaign again from its log, on the flags its last run kept | `manage.ts` |
| `pause <name> --after <event> [--yes]` | stops a campaign once its log gains one more of the event and nothing but its Builder's conversation is open | `manage.ts` |
| `keep <name> [--logins 2,3,4] [--wait-hours 1] [--yes]` | keeps a campaign going: moves it off a long provider wait, and continues it after a death or an `environment` ending | `keep.ts` |
| `copy <name> --to <worktree> [--yes]` | copies a stopped campaign whole to another worktree, and sets the source aside | `manage.ts` |
| `move <name> --to <host\|here> [--from <host\|here>] [--login N] [--after <event>] [--hold] [--yes] [-- <flags>]` | pauses a campaign at a clean point, takes its folder whole to a new worktree on the other machine at the same commit, sets the source aside and continues it there on its kept flags | `move.ts` |
| `stop <name> ... [--yes]` | ends the process that writes each log, and its keeper, and releases what its unfinished solves and sessions held | `stop.ts` |
| `status [--all]` | one row a run: the live ones and those whose log moved in a day, with tree, commit, login, open comparison, comparisons reported, promotions and ending; then each host `ANA_HOSTS` lists, all asked at once and each printed as it answers, within 30 s | `pulse.ts` |
| `logins [N ...] [--json]` | each login's five-hour and weekly use, and when the pool runs out | `logins.ts` |
| `on <host> <verb ...>`, `hosts [--all]` | any verb on another host over ssh; `status` on each other host alone | `hosts.ts` |
| `pulse [<name>] [--once]` | what each run gained since the last look | `pulse.ts` |
| `view <name>` | one campaign as its log reads, and the move the table names next | `view.ts` |
| `source <name> [--holds <c>]...` | each run's commit, its tree, where the commit is published, whether it holds a fix | `receipt.ts` |
| `zip`, `replay`, `seed`, `rehearse` | handover, readers over every log, a seed, a rehearsal | zip-run, system-path-simulation |

Without `--yes` every verb that acts says what it would do and does nothing. A start request
authorises one command once, not a second run beside it.

## Start

A measured campaign starts with one command, from a checkout at the commit it runs:

```sh
bun --env-file=<file> run runs fresh <pack> [--model sonnet] [--login N] [--as <suffix>] --yes
bun --env-file=<file> run runs fresh <pack> --host <host> ... --yes   # on another host
```

It reads the operator's prompt, `<pack>-prompt.txt` in `ANA_PROMPTS` (by default
`anabasis-prompts` beside the checkout), and refuses a pack with none: a prompt is the operator's
to write. It names the run `<pack>-fresh-<model>[-<suffix>][-r<n>]` and its project `<pack>-fresh`,
seats one model in all four seats (`--effort` a letter a seat of `lmhx`, by default `hhmm` for
Opus and `xxhh` for Sonnet), takes a budget of 800 unless `--budget`, makes the worktree
`anabasis-<name>` beside the checkout, detached at `--at` (this checkout's commit), and launches
there as below. `--host` runs it on a host `ANA_HOSTS` lists, at this checkout's commit, the host's name the
suffix unless `--as` names one; the host's own tree runs the verb, so it needs a commit that has it. Flags after `--` go to the campaign command. Without `--yes` it prints what it
would do. Write the prediction ledger before `--yes`.

`launch` is the step under it, for a campaign that is not a fresh opening:

```sh
cd <the worktree kept for the run>
bun --env-file=<file> run runs launch <name> [--login N] --yes -- \
  --project <project> <the pack's four flags, or --prompt-file <file> --solver <model>> \
  --budget <dollars> --builder <model> --examiner <model> --reviewer <model> \
  [--solve-model-turns N] [--minutes N] [--turns N] [--level 0.02]
```

The flags after `--` are the command's own, listed at the head of `tools/d2/harness-builder.ts`,
without `--name`. Before it starts anything the verb refuses a name any worktree holds a campaign
of, a log a process already writes, a worktree with a change no commit names, and a commit no
remote branch holds. It then installs (`bun install --frozen-lockfile`), runs the command's own
`--dry-run`, and starts it only where that passed: niced, in a process group of its own, which
`stop` ends, and outliving the verb. Its output goes beside the log as `launch-run-<n>.out` and
`.err`, next to the receipt the command keeps as `launch-run-<n>.json`.

- **The env file is Bun's to read.** `bun --env-file=<file> run runs …` loads it into the verb's
  process, which hands the environment on; nothing in the repository opens the file. Do not
  print, copy or search for it. `--login N` runs the command on the login the environment holds as
  `CLAUDE_CODE_OAUTH_TOKEN<N>`, passed on as `CLAUDE_CODE_OAUTH_TOKEN`, and no numbered key
  reaches the command. With no `--login` and no unnumbered login, the one numbered login held is
  taken, and two or more are refused. `claude/<model>` runs Claude Code on that login and `claude-api/<model>` on
  `ANTHROPIC_API_KEY`: two providers, so a solver on one is another setting than on the other.
- **What the operator's machines hold is environment, too.** `ANA_LOGINS` names the logins a run
  may take (`2,3,4`; every login the environment holds where unset), and `ANA_HOSTS` the other
  hosts, a JSON list of `{name, ssh, tree, bun, envFiles}`. Copy `.env.runs.example` to
  `.env.runs`, which git ignores as it does every `.env.*` but the example, fill in your own, and
  pass it with a second `--env-file`: the code is the same for every operator, and no login or
  host of one is in the repository.
- **One or two campaigns at a time on one host.** A solve's wall counts the clock. The command
  waits before each solve until the one-minute load is at or under the cores, or half an hour on,
  and says so once; `--loaded` starts it all the same, the operator's word that its times will not
  be compared.

What a campaign runs by is recorded once (`campaign.opened`), so the command run again by the
campaign's name alone goes on with the same terms, and one that names another term records it
again. A flag that names another setting than the record is refused with both
(`tools/d2/setting.ts`). A campaign runs unattended: it admits a drafted exam's checks, freezes
an exam whose reading holds no fault and promotes the harness the rule names without waiting.
`--hitl` makes all three wait for the operator's word, until `--no-hitl`; add it only when the
operator asks. `--minutes`
covers the whole conversation; one that ends at its limits or by `finish` is followed by a new one
on the Builder's notes, after the host makes what the table still owes, and three in a row that
make no campaign move end the campaign `finished`.

The receipt holds the flags, the commit and whether the tree was dirty, the load and cores it
started under, and the Bun (`tools/runs/receipt.ts`). The log holds the host's code by content and
no commit, so the receipt is where the commit is on record. Tag it once the run has started,
`git tag run/<name>/<n> <commit> && git push origin run/<name>/<n>`, with the receipt's `n`: a
pull-request branch is rewritten, and on 14 October two launch commits were reachable from no ref
the remote advertised; `bun run runs source <name>` names the tag.

## Name the run and its project

A name is the campaign's folder, `.ana/d2/<name>/`, chosen once and never reused: letters,
digits, `.`, `_` and `-`. `fresh` makes it, `<pack>-fresh-<model>[-<suffix>][-r<n>]`, the suffix
naming a host that is not the operator's own; each receipt records the commit, so a campaign
continued keeps its name whatever code it then runs. Until 16 October names were chosen launch by
launch, and `<pack>-<code>-<model>` names (`buffer-pr172-opus`) are of those days. The project
(`--project`) groups the campaigns that answer one question. Write the name, the project and why
into the prediction ledger before the launch, beside the prediction.

## Continue, move and pause

```sh
bun --env-file=<file> run runs continue <name> [--at <commit>] [--login N] [--budget N] [--after <event>] --yes
bun run runs pause <name> --after promoted|compacted|reported|finished --yes
```

`continue` runs a stopped campaign again in the worktree that holds its log, on the flags its last
`launch-run-<n>.json` kept, less `--name` and `--budget`: the record holds the total, which a
budget word may have set since, and `--budget` names another. It refuses as `launch` does, and
`--at` another commit while any comparison of the log began and has not reported (an old ladder
reading, which no move goes on with since 16 October, is none): that comparison goes on under its own terms and its own code, and the command would
refuse it there and end the campaign on its environment. A campaign that ended `environment` is
continued at the code it began the comparison under until the comparison reports. A run continued
at another commit no longer climbed by itself, and its promotions count for nothing (AGENTS.md,
section 10, rule 9): continue a measured run at its own commit only, and measure a fix with a new
fresh run.

`pause` waits until the log has gained one more of the event (`harness.promoted`,
`build.compacted`, `comparison.reported`, `build.finished`) at a point where no comparison,
Examiner session or draft is open, and then stops the run. The Builder's conversation is open
throughout a led campaign, and a pause cuts it: the campaign continued opens a new one on its
notes, and the session the stop fell inside has spent its id. `continue --after <event>` is that
pause and then the continue, which is how a run moves to another login or commit at a clean point.

A word left with `tools/d2/word.ts` acts at the next move boundary and spends no session:
`--stop "<why>"` ends the campaign `operator`, which is a pause the operator words; `--budget N`
sets its total; `--tasks "<why>"` asks for an Examiner session first. A word reaches no seat.

## Keep a campaign going

```sh
bun --env-file=<file> --env-file=<hosts file> run runs keep <name> [--logins 2,3,4] [--wait-hours 1] --yes
```

A keeper looks at the run once a minute and takes one of four turns (`turnOf`). While the run's
process lives and its log ends on a provider wait longer than `--wait-hours`, it stops the run and
continues it on the login with room whose week resets soonest. Where the process is gone and the
log holds no ending, or the ending `environment`, it continues the run on the same login. Any other
ending is the campaign's own, and the keeper leaves. A login it moved off is not taken again until
the wait named for it is over; with no login left it says so once and waits. Three continues in a
row that leave the log as it was end the keeper: something it cannot mend ends the run each time.

Each continue is `runs continue`, with its refusals: a run whose open comparison began under
other code is continued at that code. With `--yes` the keeper runs by itself, its output in
`keep.out` beside the log, one keeper a run; `runs stop <name> --yes` ends the run and its keeper
both. The keeper is authorised to stop and continue its run for a move of login, and for nothing
else. Until 15 October this was shell loops and a wrapper a login, each moving one run.

## Copy a campaign to another worktree

```sh
bun run runs copy <name> --to <worktree> --yes
```

The one sanctioned way to move a campaign's folder (AGENTS.md, section 10, rule 1). It refuses a
run that a process writes or a keeper keeps, and a target that holds the name. It copies the
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
from the rate-limit headers of a one-token request where that is refused, and keeps a snapshot an
hour in `.ana/logins-history.jsonl` of the main worktree, from which it forecasts when the pool
runs out at the week's pace and at the last 14 hours'. A login has room for a move when its week
is under 90% and allowed, and its five hours under 100% (`room`), which is what `keep` reads.
`status` hides seeds and runs quiet for a day unless `--all`, and below this machine's rows shows
each host `ANA_HOSTS` lists, so one command on any machine whose `.env.runs` lists the others
shows every run. `on` runs any verb in a host's worktree under a login shell there, with that
host's env files and `ANA_HOSTS` empty, which Bun keeps over an env file's: a verb run on another
host reaches no further one, and two machines that list each other do not loop. `hosts` is the
other hosts' `status` alone. None of these reads `.ana/` content beyond events and counts.

## What is refused, and where

Every refusal of a move is its own command's, asked before its first event, so a command started
by hand is refused where the campaign command would be. A comparison (`checkpoint.ts`,
`round.ts`) is refused by `admitComparison` (`src/builder/admission.ts`) on no held-out task, a
checker nobody has read, too few tasks to read a step at the level, no dollar cap, and a
campaign the stop rule has stopped (`--past-stop "<why>"`, logged as `stop.overridden`). A
comparison that began goes on from its log under its terms; one that reported says what it said.
A Builder session (`session.ts`) is refused on no cap, an unread checker, the stop rule, and a
`--session` whose Builder started and did not end whole (`spent`). An Examiner session refuses a
`--session` the log holds. The campaign command takes the next free id for each. A rehearsal is
exempt by name: its seats are scripts.

By hand, what a comparison needs first:

| the log needs | from |
| --- | --- |
| a checker read, with no fault left, or frozen over its faults | `bun tools/c/accept.ts ... --name <name> [--admit <checks>] [--freeze]` |
| the pack's tasks held out, the practice released | `bun tools/d2/prepare.ts ... --name <name>` |
| further held-out tasks | `bun tools/d1b/examine.ts ... --name <name> --session x-1` |

A check its author's own computation decides is a fault until `--admit` names it, the operator's
word for that check. `--predict "<sentence>"` on a checkpoint or round started by hand puts on
record what it should read, before its first solve.

## Watch

```sh
bun run runs pulse [<name>]
bun run runs view <name> [--level N] [--target N] [--practice N] [--past-stop "<why>"]
```

The pulse says what each run gained since the last look; the first sign of model work is a
session's first `build.started` or `exam.started`, and a process gone before
`comparison.reported` is a run to read in its `.err`. The view prints the campaign as its log
reads, and its last line is the move the table names for this log (`decide`), which the Builder
may decline. Neither starts anything.

## Stop

```sh
bun run runs stop <name> ... [--yes]
```

With `--yes` the process that writes each named log is ended first, then each one it started; no
process group is signalled unless one of those processes leads it. A stop also releases the capped
root of each solve, Builder session, Examiner session and draft the log started and never
finished, which only the ended process would have let go; a named run that is not running is
released the same way, so a killed run is cleaned up by stopping it.

A stop is abrupt: the run writes no ending. A campaign goes on from its log under the same name
(`continue`), and the session the stop fell inside has spent its id. A checkpoint, or a round
after its `build.finished`, goes on under the same id with its terms; an Examiner session's id is
spent wherever the stop fell, and the tasks it held out stay held out. Prefer `pause` or a word
where a clean point can be waited for. Whether a run should be stopped is a reading
(whole-run-investigation) and the operator's word; after a stop, `bun run runs pulse --once
<name>` must read `closed`.

## Not here yet

- No timed stop: a session ends by its own limits, a campaign by its budget and its patience.
- No probe turn before spend: a session or usage limit shows at the first turn, in the pulse. A
  session the provider fails ends `crashed` with the provider's words; a comparison stops once
  the provider has written nothing for three tasks in a row, and goes on from its log when the
  campaign is continued: wait for the reset the provider names, or let `keep` move it.
