---
name: run-improvement-campaign
description: "Run the Anabasis v2 improvement loop, the Super Loop, towards more promotions in one fresh campaign: score the five points, read each campaign at its milestone, find the link of the promotion chain that holds it, fix that link's owner (a prompt, a tool result, the gate, the move table, a term), prove its path, put a prediction on record, launch a fresh campaign at the fixing commit, watch, read the log, decide. Use when the operator asks to keep campaigns going, to run a pass or the hourly audit, what to read at a promotion, when to run a whole-run investigation, why a campaign is not promoting, or what to launch next. Owns the choice of experiment and the reading of its evidence; the operator owns the level, a freeze, a stop, spend and the solve's condition."
---

# Run improvement campaign

The loop is **score → walk → choose → prove → predict → launch → watch → read → decide**, and it
serves one number: promotions in one campaign that climbed by itself. A promotion is one step of
the climb, a harness that beat the reference on held-out tasks by more than the level allows, on
fresh solves (`AGENTS.md`, factor 1; until 19 October twice). The operator's aim is six or more in one run, and the plan's milestone is twelve. Each
pass asks what stands between a campaign and its next promotion, fixes the owner of that link, and
measures the fix with a new campaign opened fresh at the fixing commit. One pass answers one
question, from the log and nothing else.

**Only a fresh campaign counts** (the operator, 16 October: "it's cheating to re-initiate as an
existing project and then hope it'll reach second, it should do it autonomously from the start").
A measured campaign opens a blank project from a prompt (`--prompt-file`), its Examiner drafts the
exam, the starter is its first reference, and nothing is billed before it opens. It runs at the
commit it opened at to its own typed ending. A seed, a fork, a campaign over a stored pack or with
an `--admit` list, and a run continued at another commit (`runs continue --at`) count for no
promotion; they are rehearsals and replays. A campaign goes on from its log at its own commit after
a pause, a host restart or a provider's limit, and that is no new condition.

The count is the operator's and this loop's, never the product's. No Builder or Examiner prompt,
table row, tool result or status names a number of promotions to reach (`AGENTS.md`, factor 1).
Tune everything that leads to a promotion, and tell no seat to want one.

Honesty comes second and is not traded for the first. A promotion bought by a lower level, a
skipped repeat, a reused solve, a held-out task that crossed the wall or a target told to the
Examiner is no promotion, and the pass that made it moved the count backwards.

## Resume

Read the operator's handover file where one is kept; it is local and never published. Then read
what is true now, since a handover is a few hours old the moment it is written:

```sh
bun run runs status                            # every run: N compared, * Nx promotion *, the login
bun run runs pulse --once                      # every open run, what it gained since the last look
bun run runs view <name>                       # one campaign: each step, the climb, and as its
                                               # last line the move the plan's table names
bun run runs source <name>                     # each launch's commit: one commit is a fresh run
bun .claude/skills/stack-pr/scripts/stack.ts   # the open stack and its top
bun tools/wri/wri.ts read --log <worktree>/.ana/d2/<name>/log.jsonl
```

The pulse reads the worktrees of the host it runs on: run it on every host that holds a campaign.
`0 open` on a host where a campaign was launched is a run that ended, to be read before anything
else.

The operator's newest instruction overrides the handover and this file. A continuing instruction
("keep patching", "re-launch the runs") authorises fixes and fresh launches inside its scope and
nothing beside it: a stop of a live run, a level, a freeze and a change of login each need their
own word.

Read with the newest tree. A reader older than the log it reads goes quiet or refuses, and that is
a missing producer in the tree you ran it from, not an absent signal: run it again from the top of
the open stack before concluding anything.

## The five points

Open every pass with these rows for each live campaign, and close it with the same rows. A pass
that cannot say which point it moved has not been a pass of this loop.

| # | point | the question | read it from | bar |
| --- | --- | --- | --- | --- |
| 1 | Climb | how many promotions, from a fresh opening | `bun run runs status`, `bun run runs view <name>`, "Promotions" of `bun tools/d2/close.ts --name <name> --to <scratch dir>` | six in one campaign, then twelve |
| 2 | Honesty | could a promotion be chance or drift | the A/A beside each comparison at four solves a side; "The chance of a false promotion" in close.ts | no A/A step; the risk printed over every attempt |
| 3 | Supply | does the scored set hold tasks the reference sometimes fails | `bun tools/d2/harness-builder.ts --name <name> --dry-run`, the view's set-up line, the gate's outcomes (`task.gate`) | four informative tasks before each comparison |
| 4 | Verdicts | does a person agree with the Referee | `tools/d2/settle.ts` | `AGENTS.md`, factor 3 |
| 5 | Economy | what each promotion cost in dollars and hours | close.ts's "Work and spend" (`promotionsWorth`, `worthLine`) | at most three promotion attempts an epoch |

One line a campaign carries the rows: its worktree and its one commit, promotions in comparisons,
the comparisons since its last promotion, its milestone (below), the A/A steps in its controls,
dollars spent of its total. close.ts writes nothing into the campaign; point `--to` at a scratch
folder outside the repository.

Supply is listed third because the operator ranks the climb and its honesty first, and it still
binds first where it fails. Verdicts move only when the operator labels; economy gates nothing.

A change of instrument is not a climb. Another level, target or number of solves a side
changes what a reading can show, not what a harness can do: name it as an instrument change, and
never count the promotion it allows as a gain of the harness. The level and everything a solver is
given are the operator's.

## The promotion chain

Know where a promotion comes from before choosing what to change. Each arrow has one owner.

```text
prompt ─► Examiner drafts the exam ─► the host's reading: no fault ─► frozen (contract.frozen)
Examiner drafts tasks ─► gate, three reference solves (try_task): some valid, or none and the author's answer passes ─► held out
                                                                   all valid ─► refused
Builder practises and edits ─► compare: frontier at or under the level, retained not regressed (step)
─► the host promotes ─► a new epoch: each draft is gated on the new reference
```

Where the chain stopped on the record of 15 and 16 October:

- **Before the first task, the exam.** Three fresh campaigns opened at 246ea006 on 16 October, two
  buffer and one esp32, ended `exam` five to ten minutes in: each draft stood, and the reading held
  one fault, the objective, which the launch did not admit beside the checks (#186).
- **After a promotion, supply.** Of the drafts the gate refused after a promotion, 62 of 76 were
  refused because the new reference answered them in all three solves: main0_5_1 12 of 12,
  buffer-159-opus 17 of 21, recode-151 33 of 43; before a promotion a third to a half of drafts
  were held out. recode-151's three comparisons after its promotion scored 3, 4 and 6 tasks.
- **After a promotion, an idle Builder.** main0_5_1's nine conversations after its promotion
  changed nothing and asked for nothing, and the Examiner session the host then made (`hostOwed`)
  held 0 of 12 drafts. Since 16 October every Examiner session the table names starts as a conversation opens.
- **A near miss on size.** buffer-159-opus's g-4 read 3-0 with 8 tied and its repeat g-5 2-0 with
  10 tied: 5-0 together, p = 1/32, at a level of 0.02, which takes 6-0. Since 19 October one
  reading promotes, and a 5-0 reads no step and buys nothing.

None of those campaigns was fresh by the rule above: their counts locate links, and measure none.

## Milestones: what to read, and when

A fresh campaign passes the same milestones in order. Read each the hour its event lands, put its
prediction on record before the next one starts, and open a whole-run investigation only where the
last column says so. Quiet between milestones is work (section 5).

| milestone | the event | read | the prediction it settles | investigation |
| --- | --- | --- | --- | --- |
| M0 opened | the receipt and `campaign.opened` | `runs source`: one commit, clean; no pack flags, no `--admit` | the ledger written now, before the first solve | none |
| M1 exam | `exam.drafted`, `checker.read`, then `contract.frozen` | the reading's faults by kind and count, `doNothing`, `admitted`; within twenty minutes of M0 | frozen before the first `build.started` | none; an `exam` ending is a host defect or the operator's, read from the faults' kinds |
| M2 supply | the first Examiner sessions' `task.gate` | held out, refused all valid, refused none valid; the dry run's set-up line | held out of drafted, a range | none |
| M3 first reading | the first `comparison.reported` | room (`valid.old`), untied and tied, `detectable`, the A/A, the load (`wri.ts read`) | the reading's word and its untied count | only if a trigger of `read` fires |
| M4 step | a reading at or under the level against the reference | its untied and tied counts, the retained tasks, the A/A beside it | the step's untied count, and that its A/A reads no step | none |
| M5 promotion | `harness.promoted` | the reading it rests on with its untied tasks, the A/A beside it, the false-promotion risk at that point (close.ts); `wri.ts climb --log <log> --with <peers>` | written for M6 now | at the first promotion, once M6 has read its first Examiner session |
| M6 next epoch | the first Examiner session and the first comparison after M5 | drafts refused because the new reference answered them all, the frontier and retained sizes | held out after M5 against before it | lane 31 with the standing lanes, when it was owed at M5 |
| M7 ending | `campaign.ended` | the ending's kind; close.ts whole; every ledger row resolved; "reached N promotions; further improvement unresolved" unless patience ended it | every open row | a full one where the campaign promoted or ended before its budget, sized to the question |

Three rules hold the column on investigations. An investigation reads after the event it is about
and never mid-comparison: wait for `comparison.reported`, as a bundle does. One is opened by a
question the log raises and the readers cannot settle, a reading in doubt or a fail whose owner is
unclear, never on a timer. And a second promotion opens lane 31 again only where `wri.ts climb`
shows something the first did not.

**A stall** is a campaign whose milestone has not moved while it bills, or an ending before its
budget. The hourly audit reports it with its milestone and leaves it running. To act on it:

1. **Backtrack.** Read the log from its end back to the last move that moved the chain: the last
   promotion, the last comparison that left room, the last Examiner session that held a task out.
   The first move after it that showed nothing is where the campaign went wrong. `runs view` lists
   the moves; the reader's rows say what each one found.
2. **Name the link** from the walk's table, and its point, with the event that shows it.
3. **Fix the owner** that link names, as far as the evidence carries (section 1), through
   [stack-pr](../stack-pr/SKILL.md), and publish it: a fresh run launches only at a published commit.
4. **Prove it** (section 2): a replay of the stalled log and the others that reached the same
   milestone, saying what the change would have done there.
5. **Predict** the milestone where the stalled campaign went wrong, for the new campaign (section 3).
6. **Launch a fresh campaign** at the fixing commit (section 4). The stalled one runs on to its own
   ending, or stops on the operator's word.
7. **Read that milestone** in the new campaign against the prediction, and say lifted, held or
   unreached (section 7).

## The walk: which link holds the next promotion

Read first the campaign's milestone. M1 points at link 2; M2 and a first reading with no room at
links 1 and 3; a `regressed` reading at 7; a reading that missed the level by a task at 5; a promotion at 8. Then walk the links in order from the first and stop at the first that
fails. Links 1, 2 and 6 cap the reading: while one of them fails, a change below it is spent on
nothing.

| # | link | point | it holds when | read it from |
| --- | --- | --- | --- | --- |
| 1 | supply | 3 | enough held-out tasks are left untied for a step at the comparison's level | the dry run, the view's set-up line, `task.gate` |
| 2 | instrument | 4 | the exam is frozen, the checker stands, and rejections are ruled earned | `checker.read`, `contract.frozen`, `referee.finding`, tasks set aside |
| 3 | the reference's room | 1 | the reference harness is valid on about half its solves | `comparison.reported.valid.old` |
| 4 | the session | 1 | the Builder practised, and left a harness that differs in something a solver uses | `build.*`, `harness.version`, practice `verdict`s |
| 5 | size | 2 | the tally has enough untied tasks to clear its level | `scored`, `unsolved`, the reading's `detectable` |
| 6 | the host | 2 | solves started under a load below the cores, and the loads of the comparisons read together are alike | the reader's `HOST LOADED` and `LOAD MOVED` |
| 7 | the promotion | 2 | a comparison against the reference reads a step, its retained tasks do not regress, and the reference against itself reads none | the `step` row, `harness.promoted`, the report's `noise` |
| 8 | the next link | 1 | the promoted reference still leaves room (link 3 again), and the Examiner writes what it fails | `harness.promoted`, then `task.gate` in the next sessions |

Link 3 is the one v1 never had and the one that most often decides. On 9 October the Starter
passed 18 of 18 buffer solves at a two-hour wall and the round read no step; at an eight-minute
wall it was valid on 5 of 14 and the round read 5 wins, no loss, 2 ties. Link 8 is link 3 one
epoch up: the built harness was then valid on 14 of 14, and no second round on those tasks at
that budget could separate anything from it.

The plan's account of v1 (`docs/plan.md`, "Why v1 did not climb") names five blockers. Each is a
link here: an exam bounded by its author is link 3, label noise is link 2, variance between
repeated solves is link 7, breadth for depth is link 1, and a fail nobody acts on is link 4.
Lane 25 of [whole-run-investigation](../whole-run-investigation/SKILL.md) reads the chain of a
campaign that has one; this walk is for choosing what to do about it.

### What each link reads as, and its owner

1. **Supply.** Reads as: the dry run or the view finds too few scorable tasks; rows `tasks` or
   `short`; drafts the gate refused (`task.gate`). Owner: what the Examiner is told and its gate,
   `src/examiner/prompt.ts` (`systemPrompt`, `firstMessage`), the lines `heard` builds in
   `src/examiner/record.ts`, `try_task` in `src/examiner/write.ts`; or the term `--exam-tasks`.
2. **Instrument.** Reads as: an `exam` ending, a fault in `checker.read`, a comparison stopped on
   its check defects, tasks set aside by `check-defect` or `unclear` rulings. Owner: the host's
   reading and what the launch admits (`planOf`, `src/builder/opening.ts`; `readChecker`,
   `src/kernel/acceptance.ts`) for a fault of a kind every draft can carry, as the objective was;
   otherwise not the loop's. A check is its author's (rule 2), and a freeze, an `--admit` and the
   labels are the operator's.
3. **The reference's room.** Reads as: row or ending `no-room`; `valid.old` on every solve or on
   none; the report's room line. Owner: the tasks, through link 1's owners, never the budget, of
   which a campaign has one.
4. **The session.** Reads as: `build.finished` with nothing changed; conversations that made no
   campaign move (`idleOf`); every practice solve passed (hold `unshown`); a harness that differs in
   nothing a solver uses. Owner: what the Builder is told and can do, `src/builder/prompt.ts`
   (`systemPrompt`, `SAID`, `firstMessage`, `continuation`, `usedLine`), the facts under each
   campaign tool (`campaignStatus`) and the tools in `tools/d2/campaign-actions.ts`; or the terms
   `--sessions`, `--minutes`, `--turns`, `--practice`, `--practice-solves`.
5. **Size.** Reads as: `detectable` above the share of untied tasks the step won; most of the
   scored set tied; a near miss. Owner: `--target` or `--solves`, instrument changes made in the
   next fresh campaign, whose setting holds `--target` once recorded (`settingAsked`). The lasting
   cure for ties is link 1. The level is the operator's.
6. **The host.** Reads as: `HOST LOADED`, `LOAD MOVED`, long `campaign.waited`, wall-ended solves
   rising. Owner: fewer campaigns on that host; no flag of a run fixes a crowded host.
7. **The promotion.** Reads as: a `no-step` near the level, a `regressed` reading, an A/A that
   reads a step. Owner: supply first, and size (link 5). Since 19 October one reading at the level
   promotes, and a near miss buys nothing: the next harness is the next attempt. Until then a
   reading under a trigger bought a repeat on fresh solves, and the two read together promoted.
8. **The next link.** Reads as: `harness.promoted`, then drafts refused because the new reference
   answered them in every gate solve, idle conversations, comparisons that score a few tasks.
   Owner: what the Examiner is told of the change (`heard`), what the Builder is told after a
   promotion (`campaignStatus`), and what the host makes between conversations (`hostOwed`,
   `tools/d2/harness-builder.ts`; `ROWS` and `HOLDS`, `src/builder/decide.ts`).

## 1. Choose one change, aimed at the next promotion

Choose from a recorded failure, wasted work or an open decision, never from what looks fragile.
Name the link, the point, the owner of the bytes that would move it, and what would show the
change wrong, before writing code.

Be ambitious where the log names the link. A pass that finds the chain held at one owner changes
that owner as far as the evidence carries, in one pull request, and does not add a sentence beside
it: rewriting a prompt, a tool result, the gate or a table row is in scope, and so is deleting the
mechanism that held the chain. A fix that only words a prompt more strongly has usually missed its
owner: when the same interface failure recurs, change the schema, the tool or the facts, not the
sentence (`AGENTS.md`, section 13).

A term is a flag and needs no code (`tools/d2/round.ts` lists them). When the change is source,
read the producer, its consumers and its tests first: the mechanism usually exists with one caller
written for the only case so far. Prefer, in order: delete the competing owner, reuse the existing
one, add the minimum. A source change goes through [stack-pr](../stack-pr/SKILL.md), on top of the
open stack, and its row in `docs/transfer.md` moves in the same pull request.

The bounds of an ambitious change are `AGENTS.md`'s, not this file's. A model is given facts and
never a course, an author facts and no target (section 2); nothing crosses the wall but the closed
list, with its test (rule 3); terms are fixed before the first solve (rule 4). Telling the
Examiner that the reference changed, and how many of its own drafts the new one answered, is a
fact. Telling it to write harder tasks, or a share to reach, is a course.

Five changes wait for the operator's word, each brought as one question with the evidence and a
recommendation: the level, a freeze or `--admit`, a promotion by `--despite`, what a solver is
given or told (the Starter, the shell, the limits a campaign runs under), and stopping a live run.
Go on with whatever does not depend on the answer.

After two comparisons miss the same way, or a prediction comes back wrong, walk the links again
before choosing. Do not try the next idea on the old link.

## 2. Prove the path before spending

[system-path-simulation](../system-path-simulation/SKILL.md) picks the smallest real layer that
can decide the question. For this loop three of its cases carry nearly everything:

- **A dry run** for the move the table names and what it can read:
  `bun tools/d2/harness-builder.ts --name <name> --dry-run`. A launch runs it itself first.
- **A replay** for a changed reader, gate or table row: `bun run runs replay` puts every recorded
  log through this tree's readers, at no provider cost. Replay the campaigns that reached the
  milestone the change is for, and say what it would have held out or named there.
- **A rehearsal** for a changed round: `bun run runs seed --from <campaign folder> --name <seed>`,
  then `bun run runs rehearse` over the seed with a script in each model seat. A seed proves a path
  and counts for nothing.

For text a model reads, render the whole surface the model is given and read the composed result.
A fact stated by two owners is invisible in either producer alone. Then cost the literal reading:
can a session that follows the sentence to the letter still finish inside its wall?

A test double proves the interface it replaces and nothing behind it. A change to what a Builder or
an Examiner does is proved by a real session, and the cheapest real one is the fresh campaign's
milestone the change is for, read against its prediction.

## 3. Put the prediction on record

The campaign command takes no prediction, since its moves are the Builder's to ask for: write a
ledger in the local notes, outside every campaign's folder, before the campaign's first solve, with
the campaign, its commit and the milestones each row is about. A comparison made by hand takes it
on its command line:

```sh
bun tools/d2/checkpoint.ts <flags> --predict "<one sentence a count can settle>"
```

Write each row so that a recorded count settles it: "`contract.frozen` before the first
`build.started`", "x-1 holds at least 3 of its drafts", "the first comparison unties at least 6 tasks", "the
A/A reads no step". "Improves" is not a prediction. Each row names the link it observes and its
falsifier, and is resolved after as held, falsified or withdrawn with the log line that settled it.
At least one row observes the link itself and one the honesty of the reading: a tally can move for
reasons the link never saw.

A prediction written after the first solve started is a description. Say so; do not backdate it.

## 4. Launch fresh

[run-management](../run-management/SKILL.md) owns the commands and their refusals. This loop adds
what decides whether the run can answer the question at all.

- **The worktree is the condition.** A run executes the source of the worktree it started in, and
  its receipt names the commit and whether the tree was dirty. Each fresh campaign gets a new
  worktree, detached at a published commit, with its own `bun install --frozen-lockfile`, kept for
  that run alone. Do not edit `src/` there while the run lives, and never move a campaign's folder
  but by `bun run runs copy`.
- **A fresh opening.** `bun run runs fresh <pack>` ([run-management](../run-management/SKILL.md)):
  a new name and project, the host's prompt, the operator's total, no pack flags, no `--admit`, no
  `--hitl` unless the operator asks.
  Run the dry run and the launch as two commands: the launch refuses while any process line holds
  the campaign's `harness-builder.ts --name <name>`, and a shell line that carries the dry run is
  one.
- **One or two campaigns at a time on one host.** The campaign command waits for the host's load
  before each solve, and reads nothing of what the next start will add. On 9 October three
  campaigns on one Mac held the one-minute load between 47 and 80, and that hour's readings were
  provisional. A toolchain is the host's: launch where the campaign will run.
- **Which provider account spends is the operator's choice.** Pass the file the operator named
  with `--env-file <path>`, and the login with `--login N`. Never open, print or copy the file, or
  look for another, and say in the report which run used which.
- **A chain of commands is a script, not a session.** Start it with `nohup`, its output in a file.
  A background command of the session ends with the session.

## 5. Watch

```sh
bun run runs pulse --once [<name>]
```

The pulse says what each open run gained since the last look. Look at each milestone's event, at
the moment a timer predicts for it (section Timers), and once within twenty minutes of a launch
for M1, since an exam that ends does so there.

- **Quiet under a wall is work.** A solve writes nothing between its start and its verdict, and a
  Builder's practice solve holds its session the same way. Read quiet against the solve's wall and
  the session's `--minutes` before calling it a stall.
- **The process decides whether a run lives.** A receipt's pid that is gone before an ending is a
  run to read in its `.err`, and a log that has not grown is a lead.
- **A provider's limit ends a comparison without a report.** It goes on from its log under the
  same id once the limit resets, at the run's own commit, and a solve counted is not solved again.
- **Do not stop a run to fix it.** `bun run runs source <name> --holds <commit>` says whether a
  commit can change a run. Work found while a run lives is work for the next fresh one.

While runs are live, keep the host for them: run focused tests only, and send a whole suite to
another machine ([stack-pr](../stack-pr/SKILL.md) says how).

## 6. Read

Read in this order, and the prose last: the ending, the reading, the tally, the ties, the A/A, the
rulings, the load. Then the epoch: what the Examiner's sessions since the last promotion held out
and had refused, and why the gate refused them.

```sh
bun tools/wri/wri.ts read --log <log>          # the rows, the triggers, the host line
```

Evidence precedence:

```text
the log > a reader of the log > source and tests > a command's printed line > a PR body > prose
```

Keep four counts apart in every sentence: valid answers, rejected answers ruled earned, solves with
no answer, and non-results (a host fault, a provider's end, a task set aside). A comparison that
tallied no task gives an operational result and no rate. Read a fault or a ruling by its kind and
count; quote nothing from the exam side.

Then resolve every prediction as held or falsified, with the count that settled it. A falsified
prediction is the most useful line of the pass: it says which belief about the system was wrong.

Before any sentence claims that something improved, take it through
[attribution-and-proof](../attribution-and-proof/SKILL.md). When the question is whether a reading
may be believed at all, or what a fail was, that is a
[whole-run-investigation](../whole-run-investigation/SKILL.md), at the milestone the table names.

**A step is one draw.** Name each promotion with the reading it rests on, its untied tasks, the
A/A beside it and the campaign's false-promotion risk at that point; until 19 October a step was
repeated on fresh solves before it promoted. Record a
near miss as one, with the task that was short: it is the cheapest evidence of what size the next
comparison needs.

## 7. Decide

First say what happened to the link:

- **lifted**: the link moved and the chain followed. Walk again for the next one.
- **held**: the link moved and the chain did not, so the link was misnamed. Walk again from it,
  with this pass's counts as evidence.
- **unreached**: the link did not move, so the change never did what it was for. Repair its path
  (step 2), containment included, before naming another link.

Then choose one move. The plan's table suggests one, and the view prints it as its last line
(`decide`, `src/builder/decide.ts`): read the exam, set the tasks apart, have tasks written, build,
compare, promote, or end. A led campaign's Builder chooses its moves through
campaign tools and reads the table as advice; code keeps admissions and scoring, and the host makes
what the table names between conversations. The stop rule ends a campaign at its patience of moves
that could have shown a gain and showed none, counted only since the last promotion, and the budget
ends it too.

Where the pass disagrees with the table, say so with the counts: the table is a default over the
log, and what it cannot read is yours to bring. The moves it never names are the loop's own: fix
the one owner the evidence names and launch fresh; change one term and launch fresh; delete a
mechanism nothing reads; investigate one consequential ambiguity. Every launch spends, so it takes
the operator's word.

Keep a negative result and its limits intact, and say which level of evidence each claim of the
pass reached (attribution-and-proof lists them).

Close the pass in the handover: the five points and the milestone of each campaign, with its
worktree, commit and last reading; each prediction resolved; the link and what happened to it; the
decisions that wait for the operator; and the next command. Name no account, host or credential
path in anything that is published.

## Timers

A session left to run unattended keeps the loop going with its own timers (operator,
16 October). Each wakes the session; what it reads is still the milestone's. Keep the jobs, the
authority they act under and one ledger row a firing in one local file beside the handover.

| timer | when | does |
| --- | --- | --- |
| watch | hourly, off the hour | the audit: every run on every host, its milestone, a stall (section Milestones) |
| pass | every three hours | one pass of this loop: the triage list rewritten, one rehearsal aimed at its top row, that row's owner fixed; a review of the timers against the ledger |
| milestone | one-shot, at the moment a watch or pass predicts | reads the milestone it was armed for and runs what the table owes there |
| handover | one-shot, before the operator wakes | the five points, what changed, the decisions waiting |

**Predict the moment, and rather check once too often.** Every watch and pass names each live
run's milestone, estimates from that run's own log when the next one's event lands (a
comparison: scored tasks × solves a side × 2 × its median solve minutes, over the solves that run
at once), and arms a one-shot then. A check that finds nothing costs minutes, and a missed M1 or
M6 has cost hours. One that fires early re-arms itself for the new estimate, often one or two
hours on: a whole-run investigation is owed at its milestone, never before its event.

**Triage is one ranked list**, in the same file, rewritten each pass: each open problem with its
link, the event or count that shows it, what found it (a fresh run, a rehearsal, a replay, a
misfire), and its status. Rank by the first link the chain stops at, then by how many runs show
it, and check a row against the log and the source before ranking it. A row is proved only by a
replay or a rehearsal that shows the chain going past its link; a rehearsal whose prediction
fails opens a row.

**A misfire is evidence.** Every firing writes its row: what it found, whether it was useful, and
when it should have fired. The pass reads the rows and retimes: a watch that found nothing three
times in a row may go to two hours; a run near M3 or M5 gets its one-shot. A timer acts only
within the authority the file records: a launch, a stop and every decision of the operator's
need the operator's word written there, not a timer's reading of it.

## Which skill each step uses

| step | every pass | when its trigger holds |
| --- | --- | --- |
| score | the five points and the milestone, from status, view and close | none |
| walk | the epoch, the pulse, the reader, the link table | whole-run-investigation, lane 25, on a campaign with two comparisons or more |
| choose | one link, one owner, one falsifier | stack-pr when the change is source, with simplify over its diff |
| prove | a replay, and the launch's dry run | system-path-simulation: a rehearsal for a changed round or campaign |
| predict | the ledger before the first solve | `--predict` on a comparison made by hand |
| launch | run-management, a fresh worktree, under the load rule | none |
| read | the milestone's row, the reader, every prediction resolved | attribution-and-proof before a claim; whole-run-investigation at the milestone the table names |
| decide | lifted, held or unreached; one move | harness-audit before a handover; oracle-handover when the repository's evidence cannot settle the question |

A step whose trigger did not hold is recorded as not triggered, so a skill left out is a decision
and not an omission.

## What has cost time here

Keep this list short and current. Replace an entry when its lesson has an owner elsewhere.

- **A count from a run that did not climb by itself.** buffer-159-opus's two promotions came over
  four launches at three commits, the first a minute after a relaunch, and count for nothing. Open
  every measured run fresh, and read `runs source` before quoting a count.
- **Fresh campaigns that ended at M1.** On 16 October three ended `exam` within ten minutes on the
  one fault the launch did not admit, and the pulses that hour read `0 open` on both hosts without
  being read as endings. Look at M1 within twenty minutes of every launch.
- **A promotion that left the Examiner nothing to write.** On 15 and 16 October three promoted
  campaigns had 62 of 76 refused drafts answered by the new reference in every gate solve, and one
  Builder sat through nine conversations with nothing to work on. Read M6 the hour a campaign
  promotes, not after its patience.
- **A step one task short of the level.** buffer-159-opus read 5-0 over two readings where 6-0
  promoted, with 18 ties beside its 5 wins. Read `detectable` before a comparison starts.
- **Rounds that could read nothing.** Eight truss rounds on 8 October cost over $220 with no
  held-out task. The comparison's own admission refuses that now; the dry run is still the first
  command of every pass.
- **Too many runs on one host.** Three campaigns at once made an hour of readings provisional.
- **A bundle or a report taken before the event it cites.** Wait for `comparison.reported`.
- **Reading a wall-bound round as a weak harness.** Check link 6 before link 4.
- **A stack that moved mid-task.** Read the top again before every branch and every push.

Change this skill when a pass exposes duplicated work, a missed reading or a wrong decision, and
replace the rule at its owner. Do not grow it into a checklist or another review component; the
timers are a section and no scheduler of their own. Keep only what changes the next decision.
