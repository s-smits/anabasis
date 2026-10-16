---
name: run-improvement-campaign
description: "Run the Anabasis v2 improvement loop, the Super Loop, towards a campaign's next promotion: score the five points, find the link of the promotion chain that holds the campaign, fix that link's owner (a prompt, a tool result, the gate, the move table, a term), prove its path, put a prediction on record, continue the same campaign at the fixing commit, watch, read the log, decide. Use when the operator asks to keep a campaign going, to run a pass of the loop, to continue a stalled run, what to launch next, why a campaign is not promoting, or what a finished round means for the next one. Owns the choice of experiment and the reading of its evidence; the operator owns the level, a freeze, a stop, spend and the solve's condition."
---

# Run improvement campaign

The loop is **score → walk → choose → prove → predict → continue → watch → read → decide**, and
it serves one number: promotions in one campaign. A promotion is one step of the climb, a harness
that beat the reference on held-out tasks twice, on fresh solves (`AGENTS.md`, factor 1). The
operator's aim is six or more in one run, and the plan's milestone is twelve. Each pass asks what
stands between a campaign and its next promotion, fixes the owner of that link, continues the same
campaign from its log at the fixing commit, and reads from the log whether the chain moved. One
pass answers one question, from the log and nothing else.

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
bun .claude/skills/stack-pr/scripts/stack.ts   # the open stack and its top
bun tools/wri/wri.ts read --log <worktree>/.ana/d2/<name>/log.jsonl
```

The operator's newest instruction overrides the handover and this file. A continuing instruction
("keep patching", "continue the stalled runs") authorises fixes and continuations inside its scope
and nothing beside it: a new run, a stop of a live one, a level, a freeze and a change of login
each need their own word.

Read with the newest tree. A reader older than the log it reads goes quiet or refuses, and that is
a missing producer in the tree you ran it from, not an absent signal: run it again from the top of
the open stack before concluding anything.

## The five points

Open every pass with these rows for each live campaign, and close it with the same rows. A pass
that cannot say which point it moved has not been a pass of this loop.

| # | point | the question | read it from | bar |
| --- | --- | --- | --- | --- |
| 1 | Climb | how many promotions, and does the ladder rise | `bun run runs status`, `bun run runs view <name>`, "The ladder" of `bun tools/d2/close.ts --name <name> --to <scratch dir>` | six in one campaign, then twelve |
| 2 | Honesty | could a promotion be chance or drift | the A/A beside each comparison at four solves a side; the campaign's false-promotion risk under close.ts's "Work and spend" (`falsePromotion`); the starter's share on each ladder | no A/A step; the risk printed over every attempt |
| 3 | Supply | does the scored set hold tasks the reference sometimes fails | `bun tools/d2/harness-builder.ts --name <name> --dry-run`, the view's set-up line, the gate's outcomes (`task.gate`) | four informative tasks before each comparison |
| 4 | Verdicts | does a person agree with the Referee | `tools/d2/settle.ts` | `AGENTS.md`, factor 3 |
| 5 | Economy | what each promotion cost in dollars and hours | close.ts's "Work and spend" (`promotionsWorth`, `worthLine`) | at most three promotion attempts an epoch |

One line a campaign carries the rows: its worktree and commit, promotions in comparisons, the
comparisons since its last promotion, the open move, the A/A steps in its controls, dollars spent
of its total. close.ts writes nothing into the campaign; point `--to` at a scratch folder outside
the repository.

Supply is listed third because the operator ranks the climb and its honesty first, and it still
binds first where it fails. Verdicts move only when the operator labels; economy gates nothing.

A change of instrument is not a climb. Another level, target, trigger or number of solves a side
changes what a reading can show, not what a harness can do: name it as an instrument change, and
never count the promotion it allows as a gain of the harness. The level and everything a solver is
given are the operator's.

## The promotion chain

Know where a promotion comes from before choosing what to change. Each arrow has one owner.

```text
Examiner drafts ─► gate, three reference solves (try_task): some valid ─► held out
                                                             none, the author's answer passes ─► 1 in 3 ladder
                                                             all valid ─► refused
Builder practises and edits ─► compare: frontier at or under the trigger ─► repeat owed (unfinished)
repeat on fresh solves, on tasks the first did not score ─► both together clear the level (twice)
─► the host promotes ─► the host reads the ladder ─► a new epoch: each draft is gated on the new reference
```

Where the chain stopped on the record of 15 and 16 October:

- **After a promotion, supply.** Of the drafts the gate refused after a promotion, 62 of 76 were
  refused because the new reference answered them in all three solves: main0_5_1 12 of 12,
  buffer-159-opus 17 of 21, recode-151 33 of 43; before a promotion a third to a half of drafts
  were held out. recode-151's three comparisons after its promotion scored 3, 4 and 6 tasks.
- **After a promotion, an idle Builder.** main0_5_1's nine conversations after its promotion
  changed nothing and asked for nothing, and the Examiner session the host then made (`hostOwed`)
  held 0 of 12 drafts.
- **A near miss on size.** buffer-159-opus's g-4 read 3-0 with 8 tied and its repeat g-5 2-0 with
  10 tied: 5-0 together, p = 1/32, at a level of 0.02, which takes 6-0. One untied task more would
  have promoted.

On this record a second promotion was held at links 1, 3 and 8, and once at link 5. A pass after
a promotion starts at link 8.

## The walk: which link holds the next promotion

Read first where the campaign stands in its epoch, the stretch since its last promotion. No
comparison yet points at links 1 and 3; a reading under the trigger at 7; a step and repeat that
missed the level by a task at 5; a fresh promotion at 8. Then walk the links in order from the
first and stop at the first that fails. Links 1, 2 and 6 cap the reading: while one of them fails,
a change below it is spent on nothing.

| # | link | point | it holds when | read it from |
| --- | --- | --- | --- | --- |
| 1 | supply | 3 | enough held-out tasks are left untied for a step at the comparison's level | the dry run, the view's set-up line, `task.gate` |
| 2 | instrument | 4 | the checker has been read and stands, and rejections are ruled earned | `bun tools/c/accept.ts --name <name>`, `referee.finding`, tasks set aside |
| 3 | the reference's room | 1 | the reference harness is valid on about half its solves | `comparison.reported.valid.old` |
| 4 | the session | 1 | the Builder practised, and left a harness that differs in something a solver uses | `build.*`, `harness.version`, practice `verdict`s |
| 5 | size | 2 | the tally has enough untied tasks to clear its level | `scored`, `unsolved`, the reading's `detectable` |
| 6 | the host | 2 | solves started under a load below the cores, and the loads of the comparisons read together are alike | the reader's `HOST LOADED` and `LOAD MOVED` |
| 7 | the repeat | 2 | the same two harnesses on fresh solves read the step again, and the reference against itself reads none | the `unfinished` row, `STEP NOT REPEATED` |
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

## The protocol: continue a held campaign

The count of promotions is one campaign's, so a campaign the chain stopped in is not replaced: it
is fixed and goes on from its log, the same run launched from the state it reached. A new campaign
starts the count from nothing and is the last resort. Every pass that finds a held campaign runs
these seven steps.

1. **Backtrack.** Read the log from its end back to the last move that moved the chain: the last
   promotion, the last comparison that left room, the last Examiner session that held a task out.
   The first move after it that showed nothing is where the campaign went wrong. `runs view` lists
   the moves; the reader's rows say what each one found.
2. **Name the link** from the walk's table, and its point, with the event that shows it.
3. **Fix the owner** that link names below, as far as the evidence carries (section 1), through
   [stack-pr](../stack-pr/SKILL.md), and publish it: a continuation runs only at a commit a remote
   branch holds.
4. **Prove it** (section 2): a replay over this campaign's log and the other promoted ones, then
   the continuation's own preview, which checks out nothing and starts nothing:
   `bun --env-file=<file> run runs continue <name> --at <commit>`.
5. **Predict** what the next move will read (section 3), in the local notes, before it starts.
6. **Continue**: the same command with `--yes`. It refuses a run a process still writes and a
   comparison that began under other code and has not reported, which goes on under its own terms
   at its own commit. `--after reported` waits for that comparison, pauses the run at a clean point
   and continues it at the new commit: that stops a live run, so it takes the operator's word.
   `--login N` and the file passed as `--env-file` are the operator's choice.
7. **Read the first move after it** against the prediction, and say lifted, held or unreached
   (section 7).

### What each link reads as, its owner, and how the campaign goes on

1. **Supply.**
   Reads as: the dry run or the view finds too few scorable tasks; rows `tasks` or `short`; drafts
   the gate refused (`task.gate`).
   Fix: what the Examiner is told and its gate: `src/examiner/prompt.ts` (`systemPrompt`,
   `firstMessage`), the lines `heard` builds in `src/examiner/record.ts`, `try_task` in
   `src/examiner/write.ts`; or the term `--exam-tasks`.
   Goes on: the next Examiner session is the test; predict how many drafts it holds out.
2. **Instrument.**
   Reads as: a checker nobody has read, an exam fault, a comparison stopped on its check defects,
   tasks set aside by `check-defect` or `unclear` rulings.
   Fix: not the loop's. A check is its author's (rule 2), and a freeze, an `--admit` and the labels
   are the operator's. Bring the rulings and the tasks set aside as one question.
   Goes on: nothing that scores until the word is on record; a campaign ended `exam` then
   continues.
3. **The reference's room.**
   Reads as: row or ending `no-room`; `valid.old` on every solve or on none; the report's room line.
   Fix: the tasks, through link 1's owners, never the budget, of which a campaign has one. Where
   no session has left a harness but the reference, a control (row `unread`) reads whether new
   tasks leave room before a Builder session is paid for.
   Goes on: the table names the Examiner session.
4. **The session.**
   Reads as: `build.finished` with nothing changed; conversations that made no campaign move
   (`idleOf`); every practice solve passed, so nothing was failed to work on (hold `unshown`); a
   harness that differs in nothing a solver uses.
   Fix: what the Builder is told and can do: `src/builder/prompt.ts` (`systemPrompt`, `SAID`,
   `firstMessage`, `continuation`, `usedLine`); the facts under each campaign tool and each turn
   (`campaignStatus`, the conversation's `hook`) and the campaign tools themselves, both in
   `tools/d2/campaign-actions.ts`; or the terms `--sessions`, `--minutes`, `--turns`,
   `--practice`, `--practice-solves`.
   Goes on: the next conversation opens on the last one's notes; a campaign ended `finished` goes
   on with a new conversation.
5. **Size.**
   Reads as: `detectable` above the share of untied tasks the step won; most of the scored set
   tied; a near miss.
   Fix: `--target` or `--solves`, instrument changes, recorded at the next comparison's start. The
   lasting cure for ties is link 1: tasks the reference sometimes fails tie less. The level is the
   operator's.
   Goes on: the next comparison takes the terms; one that began keeps its own.
6. **The host.**
   Reads as: `HOST LOADED`, `LOAD MOVED`, long `campaign.waited`, wall-ended solves rising.
   Fix: fewer campaigns on that host. The campaign command already waits for the load before a
   solve; no flag of a run fixes a crowded host.
   Goes on: the same campaign, under a load below the cores. Moving a live run is a stop.
7. **The repeat.**
   Reads as: row `unfinished` with a repeat owed; `STEP NOT REPEATED`; `compare` refusing the repeat
   for want of tasks its first stage did not score.
   Fix: supply first where the campaign holds fewer unscored tasks than the target. The repeat is
   of the harness the reading froze, whatever `harness/` holds since. One that cleared the trigger
   and not the level buys no third reading: the next harness is the next attempt.
   Goes on: the host makes the repeat between conversations (`hostOwed`).
8. **The next link.**
   Reads as: `harness.promoted`, then drafts refused because the new reference answered them in
   every gate solve, idle conversations, comparisons that score a few tasks.
   Fix: what the Examiner is told of the change (the lines `heard` builds, `src/examiner/record.ts`),
   what the Builder is told after a promotion (`campaignStatus`), and what the host makes between
   conversations (`hostOwed`, `tools/d2/harness-builder.ts`; `ROWS` and `HOLDS`,
   `src/builder/decide.ts`).
   Goes on: the same campaign at that commit; predict how many drafts the first Examiner session
   after it holds out.

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
  `bun tools/d2/harness-builder.ts --name <name> --dry-run`. A continuation runs it itself before
  it starts anything.
- **A replay** for a changed reader, gate or table row: `bun run runs replay` puts every recorded
  log through this tree's readers, at no provider cost. Replay the campaigns that promoted, and say
  what the change would have held out or named there.
- **A rehearsal** for a changed round: `bun run runs seed --from <campaign folder> --name <seed>`,
  then `bun run runs rehearse` over the seed with a script in each model seat.

For text a model reads, render the whole surface the model is given and read the composed result.
A fact stated by two owners is invisible in either producer alone. Then cost the literal reading:
can a session that follows the sentence to the letter still finish inside its wall?

A test double proves the interface it replaces and nothing behind it. A change to what a Builder
or an Examiner does is proved by a real session, and the cheapest real one is the campaign's next
move after its continuation, read against its prediction.

## 3. Put the prediction on record

Before the first solve, say what the move will read. A comparison made by hand takes it on its
command line:

```sh
bun tools/d2/checkpoint.ts <flags> --predict "<one sentence a count can settle>"
```

The campaign command takes no prediction, since its moves are the Builder's to ask for: write it
in a local notes file outside every campaign's folder before the continuation starts, with the
campaign, the commit and the move it is about.

Write each row so that a recorded count settles it: "x-8 holds at least 3 of its drafts", "the
repeat unties at least 6 tasks", "the A/A reads no step", "the Builder's first conversation after
the continuation makes a campaign move". "Improves" is not a prediction. Each row names the link it
observes and its falsifier, and is resolved after as held or falsified with the log line that
settled it. At least one row observes the link itself and one the honesty of the reading: a tally
can move for reasons the link never saw.

A prediction written after the first solve started is a description. Say so; do not backdate it.

## 4. Continue, or launch

[run-management](../run-management/SKILL.md) owns the commands and their refusals. This loop adds
what decides whether the run can answer the question at all.

- **The worktree is the condition.** A run executes the source of the worktree it started in, and
  its receipt names the commit and whether the tree was dirty. A campaign continues in the worktree
  that holds it, at a published commit, and `runs continue --at` checks that commit out there and
  installs it. Do not edit `src/` in a run's worktree while the run lives, and never move a
  campaign's folder but by `bun run runs copy`.
- **Continue before launching.** A held campaign goes on by the protocol. Launch a new one only
  when no campaign can take the change, and with the operator's word for that run.
- **One or two campaigns at a time on one host.** The campaign command waits for the host's load
  before each solve, and reads nothing of what the next start will add. On 9 October three
  campaigns on one Mac held the one-minute load between 47 and 80, and that hour's readings were
  provisional. What a comparison of a given size can show is its admission's
  (`src/builder/admission.ts`): read its notes in the campaign's output before spend.
- **Which provider account spends is the operator's choice.** Pass the file the operator named
  with `--env-file <path>`, and the login with `--login N`. Never open, print or copy the file, or
  look for another, and say in the report which run used which.
- **A chain of commands is a script, not a session.** Start it with `nohup`, its output in a file.
  A background command of the session ends with the session.

## 5. Watch

```sh
bun run runs pulse --once [<name>]
```

The pulse says what each open run gained since the last look. Look when something could have
changed, not on a timer: an Examiner session's end and what it held out, a Builder conversation's
end, the first `solve.started` of a comparison, `comparison.reported`, `harness.promoted`.

- **Quiet under a wall is work.** A solve writes nothing between its start and its verdict, and a
  Builder's practice solve holds its session the same way. Read quiet against the solve's wall and
  the session's `--minutes` before calling it a stall.
- **The process decides whether a run lives.** A receipt's pid that is gone before an ending is a
  run to read in its `.err`, and a log that has not grown is a lead.
- **A provider's limit ends a comparison without a report.** It goes on from its log under the
  same id once the limit resets, and a solve counted is not solved again. A Builder session it ends
  is spent, and the next session pays for another.
- **Do not stop a run to fix it.** `bun run runs source <name> --holds <commit>` says whether a
  commit can change a run. Work found while a run lives is work for its next continuation.

While runs are live, keep the host for them: run focused tests only, and send a whole suite to
another machine ([stack-pr](../stack-pr/SKILL.md) says how).

## 6. Read

Read in this order, and the prose last: the ending, the reading, the tally, the ties, the A/A, the
rulings, the load. Then the epoch: what the Examiner's sessions since the last promotion held out,
held for the ladder and had refused, and why the gate refused them.

```sh
bun tools/wri/wri.ts read --log <log>          # the rows, the triggers, the host line
```

Evidence precedence:

```text
the log > a reader of the log > source and tests > a command's printed line > a PR body > prose
```

Keep four counts apart in every sentence: valid answers, rejected answers ruled earned, solves with
no answer, and non-results (a host fault, a provider's end, a task set aside). A comparison that
tallied no task gives an operational result and no rate.

Then resolve every prediction as held or falsified, with the count that settled it. A falsified
prediction is the most useful line of the pass: it says which belief about the system was wrong.

Before any sentence claims that something improved, take it through
[attribution-and-proof](../attribution-and-proof/SKILL.md). When the question is whether a reading
may be believed at all, or what a fail was, that is a
[whole-run-investigation](../whole-run-investigation/SKILL.md), sized to the question.

**A step is not read until it is repeated,** and a promotion is not a climb until the ladder is read
after it. Name each promotion with its two readings, their untied tasks, the A/A beside each and the
campaign's false-promotion risk at that point. Record a near miss as one, with the task that was
short: it is the cheapest evidence of what size the next comparison needs.

## 7. Decide

First say what happened to the link:

- **lifted**: the link moved and the chain followed. Walk again for the next one.
- **held**: the link moved and the chain did not, so the link was misnamed. Walk again from it,
  with this pass's counts as evidence.
- **unreached**: the link did not move, so the change never did what it was for. Repair its path
  (step 2), containment included, before naming another link.

Then choose one move. The plan's table suggests one, and the view prints it as its last line
(`decide`, `src/builder/decide.ts`): read the exam, set the tasks apart, have tasks written, build,
compare, repeat a step, promote, read the ladder, or end. A led campaign's Builder chooses its
moves through campaign tools and reads the table as advice; code keeps admissions and scoring, and
the host makes what the table names between conversations. The stop rule ends a campaign at its
patience of moves that could have shown a gain and showed none, counted only since the last
promotion, and the budget ends it too.

```sh
bun tools/d2/harness-builder.ts <the pack's flags> --name <name> --dry-run   # the move, and nothing made
```

Where the pass disagrees with the table, say so with the counts: the table is a default over the
log, and what it cannot read is yours to bring. The moves it never names are the loop's own: fix
the one owner the evidence names and continue; change one term and continue; delete a mechanism
nothing reads; investigate one consequential ambiguity. A campaign runs unattended to a typed
ending, and `--hitl` is the operator's to add. Every run and continuation spends, so it takes the
operator's word as a launch does.

Keep a negative result and its limits intact, and say which level of evidence each claim of the
pass reached (attribution-and-proof lists them).

Close the pass in the handover: the five points for each campaign, with its worktree, commit and
last reading; each prediction resolved; the link and what happened to it; the decisions that wait
for the operator; and the next command. Name no account, host or credential path in anything that
is published.

## Which skill each step uses

| step | every pass | when its trigger holds |
| --- | --- | --- |
| score | the five points, from status, view and close | none |
| walk | the epoch, the pulse, the reader, the link table | whole-run-investigation, lane 25, on a campaign with two comparisons or more |
| choose | one link, one owner, one falsifier | stack-pr when the change is source, with simplify over its diff |
| prove | a replay, and the continuation's preview | system-path-simulation: a rehearsal for a changed round or campaign |
| predict | one row before the first solve | further rows in the local notes |
| continue | run-management, the protocol's step 6, under the load rule | a launch, on the operator's word, when no campaign can take the change |
| read | the report, the reader, the epoch's gate, every prediction resolved | attribution-and-proof before a claim; whole-run-investigation when a reading is in doubt |
| decide | lifted, held or unreached; one move | harness-audit before a handover; oracle-handover when the repository's evidence cannot settle the question |

A step whose trigger did not hold is recorded as not triggered, so a skill left out is a decision
and not an omission.

## What has cost time here

Keep this list short and current. Replace an entry when its lesson has an owner elsewhere.

- **A promotion that left the Examiner nothing to write.** On 15 and 16 October three promoted
  campaigns had 62 of 76 refused drafts answered by the new reference in every gate solve, and one
  Builder sat through nine conversations with nothing to work on. Read link 8 the hour a campaign
  promotes, not after its patience.
- **A step one task short of the level.** buffer-159-opus read 5-0 over two readings where 6-0
  promoted, with 18 ties beside its 5 wins. Read `detectable` before a repeat starts.
- **A stalled campaign replaced instead of continued.** Each new campaign starts its count from
  nothing; the protocol continues the one that stalled.
- **Rounds that could read nothing.** Eight truss rounds on 8 October cost over $220 with no
  held-out task, and each could only say that none was scored. The comparison's own admission
  refuses that now; the dry run is still the first command of every pass.
- **Too many runs on one host.** Three campaigns at once made an hour of readings provisional.
- **A bundle or a report taken before the event it cites.** Wait for `comparison.reported`.
- **Reading a wall-bound round as a weak harness.** Check link 6 before link 4.
- **A stack that moved mid-task.** Other sessions stacked eight pull requests in one afternoon;
  read the top again before every branch and every push.

Change this skill when a pass exposes duplicated work, a missed reading or a wrong decision, and
replace the rule at its owner. Do not grow it into a checklist, a scheduler or another review
component. Keep only what changes the next decision.
