---
name: run-improvement-campaign
description: "Run the Anabasis v2 improvement loop, the Super Loop: find the one link that holds the climb, choose one change against it, prove its path, put a prediction on record, launch, watch, read the log, decide the next move. Use when the operator asks to keep a campaign going, to run a pass of the loop, what to launch next, why a campaign is not climbing, or what a finished round means for the next one. Owns the choice of experiment and the reading of its evidence; the operator owns promotion, a freeze, a stop, spend and the solve's condition."
---

# Run improvement campaign

The loop is **walk → choose → prove → predict → launch → watch → read → decide**. One pass
answers one question about the system, from the log and from nothing else. It is v1's Super Loop on v2's
records: v1's pass read a controller's ledgers and a watcher's state file, and v2's reads a
campaign's `log.jsonl`, which is the whole run.

A climb in v2 is a chain of comparisons (`docs/plan.md`, Phases 5 and 6): a harness reads a step
against the reference harness, the step is repeated once on fresh solves, the operator promotes
the harness to reference, and a later harness reads a step against that one. One step is not a
climb. The loop exists to find what stands between the campaign and its next link of that chain,
lift it with one change, and confirm from the log that the chain moved.

A pass that cannot name the link it worked on has not been a pass of this loop, and a link is
named by the success factor it holds (`AGENTS.md`, "The five success factors"): supply, whether
the scored set holds tasks the reference fails; climb, whether the reference improves; honesty,
whether the test crowns a winner between two copies of one harness; verdicts, whether a person
agrees with the Referee; worth, how large the gain is, whether it transfers, and what it cost.
Say which one before choosing a change.

## Resume

Read the operator's handover file where one is kept; it is local and never published. Then read
what is true now, since a handover is a few hours old the moment it is written:

```sh
bun run runs pulse --once                      # every open run, in every worktree
bun run runs view <name>                       # one campaign: each step's handover, the climb,
                                               # and as its last line the move the plan's table names
bun .claude/skills/stack-pr/scripts/stack.ts   # the open stack and its top
bun tools/wri/wri.ts read --log <worktree>/.ana/d2/<name>/log.jsonl
```

The operator's newest instruction overrides the handover and this file. A continuing instruction
("keep patching", "launch the next one") authorises replacements inside its scope and nothing
beside it: a second run, a stop of a live one, a promotion, a freeze and a change of account each
need their own word.

Read with the newest tree. A reader older than the log it reads goes quiet or refuses, and that
is a missing producer in the tree you ran it from, not an absent signal: run it again from the
top of the open stack before concluding anything.

## The walk: which link holds the chain

A comparison's reading passes through these links in order. More faults are in view than links
holding the chain, so walk them from the first and stop at the first that fails. Links 1, 2 and 6
cap the reading: while one of them fails, a change anywhere below it is spent on nothing.

| # | link | it holds when | read it from |
| --- | --- | --- | --- |
| 1 | supply | enough held-out tasks are left untied for a step at the comparison's level | `bun tools/d2/harness-builder.ts --name <name> --dry-run`, and the view's set-up line |
| 2 | instrument | the checker has been read and stands, and rejections are ruled earned | `bun tools/c/accept.ts --name <name>`, `referee.finding`, tasks set aside |
| 3 | the reference's room | the reference harness is valid on about half its solves | `comparison.reported.valid.old` |
| 4 | the session | the Builder practised, and left a harness that differs in something a solver uses | `build.*`, `harness.version`, practice `verdict`s |
| 5 | size | the tally has enough untied tasks to clear its level | `scored`, `unsolved`, the preflight's notes |
| 6 | the host | solves started under a load below the cores, and the loads of the comparisons read together are alike | the reader's `HOST LOADED` and `LOAD MOVED` |
| 7 | the repeat | a checkpoint of the same two harnesses on fresh solves reads the step again, and the reference against itself reads none | `--id <id> --noise`, `STEP NOT REPEATED` |
| 8 | the next link | once promoted, the new reference still leaves room (link 3 again) | the operator's `tools/d2/promote.ts --harness <digest> --yes`, and `harness.promoted` in the log |

Link 3 is the one v1 never had and the one that most often decides. A reference valid on nearly
every solve leaves a harness nothing to add, and one valid on none leaves the comparison nothing
to pair. On 9 October the Starter passed 18 of 18 buffer solves at a two-hour wall and the round
read no step; at an eight-minute wall it was valid on 5 of 14 and the round read a step, 5 wins,
no loss, 2 ties. The same holds one link up: after that step the built harness was valid on 14 of
14, so no second round on those tasks at that budget could separate anything from it.

The plan's account of v1 (`docs/plan.md`, "Why v1 did not climb") names five blockers. Each is a
link here: an exam bounded by its author is link 3, label noise is link 2, variance between
repeated solves is link 7, breadth for depth is link 1, and a fail nobody acts on is link 4.

Lane 25 of [whole-run-investigation](../whole-run-investigation/SKILL.md) reads the chain of a
campaign that has one; this walk is for choosing what to do about it.

## 1. Choose one change

Choose from a recorded failure, wasted work or an open decision, never from what looks fragile.
Name the link, the owner of the bytes that would move it, and what would show the change wrong,
before writing code.

Most changes need no code. A budget, a wall, the tasks named to score, the number of solves a
side and a second Builder session are flags (`tools/d2/round.ts` lists them). Reach for source
only when no flag moves the link. When it is source, read the producer, its consumers and its
tests first: the mechanism usually exists with one caller written for the only case so far.

Prefer, in order: delete the competing owner, reuse the existing one, add the minimum. A source
change goes through [stack-pr](../stack-pr/SKILL.md), on top of the open stack, and its row in
`docs/transfer.md` moves in the same pull request.

Four changes are not this loop's to make, and each waits for the operator's word: freezing a
check program (`accept.ts --freeze`, `--admit`), promoting a harness (`promote.ts --yes`),
changing what a solver is given or told (the Starter, the shell, the limits a campaign runs
under), and stopping a live run. Bring each as one question with the evidence and a
recommendation, and go on with whatever does not depend on the answer.

After two comparisons miss the same way, or a prediction comes back wrong, walk the links again
before choosing. Do not try the next idea on the old link.

## 2. Prove the path before spending

[system-path-simulation](../system-path-simulation/SKILL.md) picks the smallest real layer that
can decide the question. For this loop three of its cases carry nearly everything:

- **A dry run** for the move the table names and what it can read: `bun tools/d2/harness-builder.ts --name <name> --dry-run`.
- **A replay** for a changed reader: `bun run runs replay` puts every recorded log through this
  tree's readers, at no provider cost.
- **A rehearsal** for a changed round: `bun run runs seed --from <campaign folder> --name <seed>`,
  then `bun run runs rehearse` over the seed with a script in each model seat.

For text a model reads, render the whole surface the model is given and read the composed
result. A fact stated by two owners is invisible in either producer alone. Then cost the literal
reading: can a session that follows the sentence to the letter still finish inside its wall?

A test double proves the interface it replaces and nothing behind it. A change to what a Builder
or a solver does is proved by a real session, and the cheapest real one is a single practice
solve or a round on two tasks.

## 3. Put the prediction on record

Before the first solve, say what the comparison will read:

```sh
bun tools/d2/checkpoint.ts <flags> --predict "<one sentence a count can settle>"
```

A comparison the campaign command makes takes no prediction on the command line: write it in the
local notes below before the move starts, with the comparison's id.

The sentence is written with the comparison's terms, decides nothing, and is printed beside the
reading at the end. Write it so a recorded count settles it: "the Starter is valid on 4 to 8 of
14 solves at 300 s", "at least four untied tasks, all won", "the A/A reads no step". "Improves"
is not a prediction.

The flag holds one sentence. When a launch moves more than one thing, keep the further rows in
a local notes file outside every campaign's folder, each with its claim, the link it observes
and its falsifier, written before the launch and resolved after it as held or falsified with the
log line that settled it. At least one row observes the link itself and not only the tally: a
tally can move for reasons the link never saw.

A prediction written after the first solve started is a description. Say so; do not backdate it.

## 4. Launch

[launch-run](../launch-run/SKILL.md) owns the command and its refusals. This loop adds what
decides whether the run can answer the question at all.

- **The worktree is the condition.** A run executes the source of the worktree it started in,
  and its receipt names the commit and whether the tree was dirty. Launch from a clean worktree
  at a published commit, detached, kept for that run alone. Do not edit `src/` there while the
  run lives, and never move a campaign's folder to another worktree.
- **One or two campaigns at a time on one host.** The campaign command waits for the host's
  load before a move that solves, and reads nothing of what the next start will add. On
  9 October three campaigns on one Mac held the one-minute load between 47 and 80, and that
  hour's readings were provisional. The cap and what a comparison of a given size can show are
  the move's own admission's (`src/builder/admission.ts`): read its notes in the campaign's
  output before spend, and score more tasks when the tie share on record is high.
- **Which provider account spends is the operator's choice.** Pass the file the operator named
  with `--env-file <path>`. Never open it, print it, copy it or look for another, and say in the
  report which run used which.
- **A chain of commands is a script, not a session.** A round followed by its checkpoint only on
  a step is a small shell script started with `nohup`, its output in a file. A background command
  of the session ends with the session.

## 5. Watch

```sh
bun run runs pulse --once [<name>]
```

The pulse says what each open run gained since the last look. Take a look when something could
have changed, not on a timer: a round's first `build.started`, its `build.finished`, the first
`solve.started` of the comparison, `comparison.reported`.

- **Quiet under a wall is work.** A solve writes nothing between its start and its verdict, and
  a Builder's practice solve holds its session the same way. Read quiet against the solve's wall
  and the session's `--minutes` before calling it a stall.
- **The process decides whether a run lives.** A receipt's pid that is gone before
  `comparison.reported` is a run to read in its `.err`, and a log that has not grown is a lead.
- **A provider's limit ends a comparison without a report.** It goes on from its log under the
  same id once the limit resets, and a solve counted is not solved again. A Builder session it
  ends is spent, and the next session pays for another.
- **Do not stop a run to fix it.** A commit that is not an ancestor of the run's commit cannot
  change that run, and `run-source.ts <campaign folder> --holds <commit>` (attribution-and-proof)
  says whether it is. Work found while a run lives is work for the next start.

While runs are live, keep the host for them: run focused tests only, and send a whole suite to
another machine or a VM ([stack-pr](../stack-pr/SKILL.md) says how).

## 6. Read

Read in this order, and the prose last: the ending, the reading, the tally, the noise, the
rulings, the load.

```sh
bun tools/wri/wri.ts read --log <log>          # the rows, the triggers, the host line
```

The report holds the reading at the budget the solves were told, the tally over tasks, each
harness by itself, and the reference against itself where `--noise` asked for
it. [launch-run](../launch-run/SKILL.md) says what each line is.

Evidence precedence:

```text
the log > a reader of the log > source and tests > a command's printed line > a PR body > prose
```

Keep four counts apart in every sentence: valid answers, rejected answers ruled earned, solves
with no answer, and non-results (a host fault, a provider's end, a task set aside). A comparison
that tallied no task gives an operational result and no rate.

Then resolve every prediction as held or falsified, with the count that settled it. A falsified
prediction is the most useful line of the pass: it says which belief about the system was wrong.

Before any sentence claims that something improved, take it through
[attribution-and-proof](../attribution-and-proof/SKILL.md). When the question is whether a
reading may be believed at all, or what a fail was, that is a
[whole-run-investigation](../whole-run-investigation/SKILL.md), sized to the question.

**A step is not read until it is repeated.** The round that found it is one draw. Launch the
checkpoint of the same two harnesses on fresh solves with `--noise`, on a host no busier than the
round's. Attribution-and-proof holds the questions that say whether the two together are more
than noise.

## 7. Decide

First say what happened to the link:

- **lifted**: the link moved and the chain followed. Walk again for the next one.
- **held**: the link moved and the chain did not, so the link was misnamed. Walk again from it,
  with this pass's counts as evidence.
- **unreached**: the link did not move, so the change never did what it was for. Repair its path
  (step 2), containment included, before naming another link.

Then choose one move. For the campaign itself the plan's table names it, and the view prints it
as its last line (`decide`, `src/builder/decide.ts`): read the exam, set the tasks apart, have
tasks written, build, compare, repeat a step, set the budget again, promote, or end. The stop
rule ends it (three moves in a row that could have shown a gain and showed none: a changed
harness counts once against one reference, where its comparison left room, and so does a session
that changed nothing), and so does the budget. One command makes the table's moves in turn,
under one total budget:

```sh
bun tools/d2/harness-builder.ts <the pack's flags> --name <name> --dry-run   # the move, and nothing made
bun tools/d2/harness-builder.ts <the pack's flags> --name <name> --budget <dollars> \
  --builder <model> --examiner <model> --reviewer <model> [--moves N]
```

It spends, so it takes the operator's word as a launch does, and `--unattended` is the
operator's to add. Where the pass disagrees with the table, say so with the counts: the table is
a default over the log, and what it cannot read is yours to bring. The moves it never names are
the system's own: change one flag and run again; fix the one owner the evidence names; delete a
mechanism nothing reads; investigate one consequential ambiguity.

After a repeated step the harness is the one to promote, and after the promotion the Examiner
writes the next epoch's tasks, the ones the harness now the reference fails. A campaign runs at
one budget since 11 October (`docs/simplify.md`, package A): there is no shorter budget to read a
step under and no budget rule to set one again. Build for difficulty from the one lever v1 found
to work, several requirements that share one limit (`docs/plan.md`, row F52).

Keep a negative result and its limits intact, and say which level of evidence each claim of the
pass reached (attribution-and-proof lists the four).

Close the pass in the handover: each campaign with its worktree, commit and last reading, each
prediction resolved, the link and what happened to it, the decisions that wait for the operator,
and the next command. Name no account and no credential path in anything that is published.

## Which skill each step uses

| step | every pass | when its trigger holds |
| --- | --- | --- |
| walk | the pulse, the reader, the table above | whole-run-investigation, lane 25, on a campaign with two comparisons or more |
| choose | one link, one owner, one falsifier | stack-pr when the change is source, with simplify over its diff |
| prove | a dry run of the campaign command | system-path-simulation: a replay for a reader, a rehearsal for a campaign |
| predict | `--predict`, before the first solve | further rows in the local notes |
| launch | launch-run, under the load rule | a checkpoint when two harnesses are meant as arms |
| read | the report, the reader, every prediction resolved | attribution-and-proof before a claim; whole-run-investigation when a reading is in doubt |
| decide | lifted, held or unreached; one move | harness-audit before the operator promotes or hands over; oracle-handover when the question is one the repository's own evidence cannot settle |

A step whose trigger did not hold is recorded as not triggered, so a skill left out is a
decision and not an omission.

## What has cost time here

Keep this list short and current. Replace an entry when its lesson has an owner elsewhere.

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
