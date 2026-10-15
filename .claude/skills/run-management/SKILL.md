---
name: run-management
description: "Start, continue, pause, watch and stop authorised Anabasis v2 campaigns through `bun run runs`: launch a campaign under a name, go on with one from its log on another login or commit, pause one at a clean point, read what each run gained, and stop one and release what it held. Use when the operator asks to start, launch, resume, continue, move, pause or stop a campaign or a run, to check whether a campaign is ready for its next move, or why a move was refused. Owns the run's life on the host; run-improvement-campaign reads the table, and whole-run-investigation reads what a run did."
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
| `launch <name> [--login N] [--yes] -- <flags>` | starts the campaign command under a new name, in this worktree | `manage.ts` |
| `continue <name> [--at <c>] [--login N] [--budget N] [--after <event>] [--yes]` | runs a campaign again from its log, on the flags its last run kept | `manage.ts` |
| `pause <name> --after <event> [--yes]` | stops a campaign once its log gains one more of the event and nothing but its Builder's conversation is open | `manage.ts` |
| `stop <name> ... [--yes]` | ends the process that writes each log, and releases what its unfinished solves and sessions held | `stop.ts` |
| `pulse [<name>] [--once]` | what each run gained since the last look | `pulse.ts` |
| `view <name>` | one campaign as its log reads, and the move the table names next | `view.ts` |
| `zip`, `replay`, `seed`, `rehearse` | handover, readers over every log, a seed, a rehearsal | zip-run, system-path-simulation |

Without `--yes` every verb that acts says what it would do and does nothing. A start request
authorises one command once, not a second run beside it.

## Start

```sh
cd <the worktree kept for the run>
bun --env-file=<file> run runs launch <name> [--login N] --yes -- \
  --project <project> <the pack's four flags, or --prompt-file <file> --solver <model>> \
  --budget <dollars> --builder <model> --examiner <model> --reviewer <model> \
  [--solve-model-turns N] [--minutes N] [--turns N] [--level 0.1 --trigger 0.25]
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
  reaches the command. `claude/<model>` runs Claude Code on that login and `claude-api/<model>` on
  `ANTHROPIC_API_KEY`: two providers, so a solver on one is another setting than on the other.
- **One or two campaigns at a time on one host.** A solve's wall counts the clock. The command
  waits before each solve until the one-minute load is at or under the cores, or half an hour on,
  and says so once; `--loaded` starts it all the same, the operator's word that its times will not
  be compared.

What a campaign runs by is recorded once (`campaign.opened`), so the command run again by the
campaign's name alone goes on with the same terms, and one that names another term records it
again. A flag that names another setting than the record is refused with both
(`tools/d2/setting.ts`). A campaign runs unattended: it freezes an exam whose reading holds no
fault and promotes the harness the rule names without waiting. `--attended` makes both wait for
the operator's word, until `--no-attended`; add it only when the operator asks. `--minutes`
covers the whole conversation; one that ends at its limits or by `finish` is followed by a new one
on the Builder's notes, after the host makes what the table still owes, and three in a row that
make no campaign move end the campaign `finished`.

The receipt holds the flags, the commit and whether the tree was dirty, the load and cores it
started under, and the Bun (`tools/runs/receipt.ts`). The log holds the host's code by content and
no commit, so the receipt is where the commit is on record. Tag it once the run has started,
`git tag run/<name>/<n> <commit> && git push origin run/<name>/<n>`, with the receipt's `n`: a
pull-request branch is rewritten, and on 14 October two launch commits were reachable from no ref
the remote advertised; `run-source.ts` (attribution-and-proof) names the tag.

## Name the run and its project

A name is the campaign's folder, `.ana/d2/<name>/`, chosen once and never reused. Letters, digits,
`.`, `_` and `-`. It says four things, in this order:

```text
<pack>-<code>-<model>[-<host>][-r<n>]
```

| part | what it is | examples |
| --- | --- | --- |
| pack | the pack's short name, or the prompt file's stem | `buffer`, `truss`, `rh-ladder` |
| code | the published code: `pr<N>` for a pull request's head, `v<release>`, `main-<sha7>` | `pr172`, `v0.5.1`, `main-f8889fe` |
| model | the family of the solver's model | `opus`, `sonnet`, `haiku` |
| host | the host, where that is not the operator's own | `m1`, `m3` |
| `r<n>` | a second campaign on the same pack, code and model | `r2` |

Until 14 October names were chosen launch by launch (`buffer-149`, `main0_5_1`), and which code
and models ran had to be looked up in each receipt. A campaign continued keeps its name whatever
code it then runs: each receipt records the commit. The project (`--project`) groups the
campaigns that answer one question, `<pack>-<question>`; one that answers no new question goes
under the project of the one it continues. Write the name, the project and why into the
prediction ledger before the dry run, beside the prediction.

## Continue, move and pause

```sh
bun --env-file=<file> run runs continue <name> [--at <commit>] [--login N] [--budget N] [--after <event>] --yes
bun run runs pause <name> --after promoted|compacted|reported|finished --yes
```

`continue` runs a stopped campaign again in the worktree that holds its log, on the flags its last
`launch-run-<n>.json` kept, less `--name` and `--budget`: the record holds the total, which a
budget word may have set since, and `--budget` names another. It refuses as `launch` does, and
`--at` another commit while any comparison of the log, a ladder reading among them, began and has
not reported: that comparison goes on under its own terms and its own code, and the command would
refuse it there and end the campaign on its environment. A campaign that ended `environment` is
continued at the code it began the comparison under until the comparison reports.

`pause` waits until the log has gained one more of the event (`harness.promoted`,
`build.compacted`, `comparison.reported`, `build.finished`) at a point where no comparison,
Examiner session or draft is open, and then stops the run. The Builder's conversation is open
throughout a led campaign, and a pause cuts it: the campaign continued opens a new one on its
notes, and the session the stop fell inside has spent its id. `continue --after <event>` is that
pause and then the continue, which is how a run moves to another login or commit at a clean point.

A word left with `tools/d2/word.ts` acts at the next move boundary and spends no session:
`--stop "<why>"` ends the campaign `operator`, which is a pause the operator words; `--budget N`
sets its total; `--tasks "<why>"` asks for an Examiner session first. A word reaches no seat.

## What is refused, and where

Every refusal of a move is its own command's, asked before its first event, so a command started
by hand is refused where the campaign command would be. A comparison (`checkpoint.ts`,
`round.ts`) is refused by `admitComparison` (`src/builder/admission.ts`) on no held-out task, a
checker nobody has read, too few tasks to read a step at the trigger, no dollar cap, and a
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
bun run runs view <name> [--level N] [--trigger N] [--target N] [--practice N] [--past-stop "<why>"]
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
  campaign is continued: wait for the reset the provider names, or continue on another `--login`.
