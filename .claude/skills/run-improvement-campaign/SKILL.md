---
name: run-improvement-campaign
description: "Run the Anabasis v2 improvement loop, the Super Loop, and the release cycle around it: fork fresh campaigns at the last release, read each at its milestones and resolve predictions, then stop them, investigate them, plan and implement the patches, land the release, and only then fork the next cycle. Inside the cycle each pass scores the five points, finds the link that holds the next promotion, fixes its owner, proves the path and predicts. Use when the operator asks to keep campaigns going, fork runs, work towards a release, run a pass or an hourly audit, read a promotion, investigate a campaign that is not promoting, or choose the next run. Owns the experiment and its evidence; AGENTS.md section 3 owns the operator's decisions."
---

# Run improvement campaign (the Super Loop)

Two loops, one inside the other. The **release cycle** runs fresh campaigns at a release until
each has six promotions, then stops them, investigates them, patches what the
investigation and the predictions found, and lands the patches as the next release, which the next
cycle's campaigns run. Inside it, each **pass** is **score → walk → choose → prove → predict →
launch → watch → read → decide**: it asks what stands between a campaign and its next promotion,
fixes that link's owner, and leaves the fix to be measured by the next cycle's runs. One pass
answers one question.

**Only a fresh campaign counts.** Follow `AGENTS.md`, section 10, item 9: open from a prompt,
start with the starter, and continue at the opening commit to a typed ending. Seeds, stored packs
and continuations at another commit prove paths and show no climb. The milestone belongs to the
plan, as factor 1 explains. No campaign seat is given a number of promotions to reach.

Honesty is not traded for climb. A more permissive level, a reused solve, a held-out task that
crossed the wall or a target told to the Examiner cannot establish a gain of the harness.

## The release cycle

A cycle runs on the operator's word for it ("work towards 0.6.4"), which covers its runs, their
stops, its patches, its landing and the next runs. Keep the cycle's plan in one local file beside the
handover: the word, the threshold, the checkpoints, and a log line per step. Every step below reads
that file first.

**The order is fixed, and nothing moves a step ahead of the one before it:**

```text
run (6 promotions a run) → stop → investigate → vet → plan → implement → consolidate → land and release → fork → run
```

A run is evidence about the code it ran (`AGENTS.md`, section 9), so a run left going while its
code is investigated measures code that is about to be replaced, and a release landed before the
investigation is read ships without what the investigation found. On 22 October v0.6.4 was landed
and six runs were forked on it while the investigation of the runs before them was still being
read; the operator stopped five of the six 20 minutes later, and the investigation's one patch
became v0.6.5. A deadline does not reorder the steps: where the investigation cannot be read in
time, tell the operator and ask, rather than land first.

### The running window, until six promotions a run

1. **Fork at the release.** Take the commit the last release merged (`git tag` of `main`), or the
   top of the stack where the operator names it. A pull request above it that changes code a
   campaign runs need not hold up the fork; name it. Fork **one fresh campaign per runner host**,
   or the set the operator names, so each runs on a host no other campaign loads:
   `runs fresh <pack> --host <host> --at <commit> --login N --as <suffix> --yes`, after a dry run
   without `--yes`. Take the host list from `ANA_HOSTS` through `hostsOf`, never from a machine
   list in a script. The backend prepares each peer's controller at the commit; the login must
   already be available there. This explicit override belongs to the isolation condition; read
   `runs hosts --health` before selecting idle hosts. Ordinary forks omit `--host` and `--login`:
   `fresh` prefers the pack's prior eligible host and chooses a login below its fleet cap. Several
   packs sharing their flags can use one fresh batch. Launch the hosts one after the other: on 22
   October two `fresh --host` launches sent at once from one checkout both exited 1, and each
   passed when run alone. Fresh performs the fleet login admission before each launch. Tag
   `run/<name>/1` at the commit and push the tag.
2. **Predict** before the first solve (section 3): one ledger for the cycle, with at least one row
   per pull request the runs carry, each naming that pull request, its link and its falsifier. A
   peer session's ledger for the same runs is read and linked, not repeated.
3. **Read the runs** with `scripts/cycle.ts` (below) at every checkpoint and at every milestone,
   and resolve each prediction the hour its event lands, in the ledger's Resolutions. A defect seen live is noted for the plan of step 7; the run
   is not stopped to fix it (`AGENTS.md`, section 10, item 6).

### The improvement window, in this order

4. **Stop** each run `scripts/cycle.ts` names at the step `stop`: those at or past the threshold,
   on any host. Repeat until every run the cycle forked is closed before the investigation starts:
   `runs stop <name> ... --yes`, which goes to each run's host, and then `runs status` must read
   each `closed`. Keep only a run the operator names as kept, such as an ablation. A stop word
   (`tools/d2/word.ts --stop`) waits for the next move boundary, which inside a led campaign can be
   an Examiner session of an hour or more: on 21 October two words left at 23:44 had not acted 20
   minutes later. A stopped run's log stays where it is. Resolve every prediction whose event
   exists, and mark the rest unreached.
5. **Investigate** the stopped runs as equals with
   [whole-run-investigation](../whole-run-investigation/SKILL.md): start, lanes, collect, the
   isolated lanes 5 and 19 where their triggers and the reports call for them, then the synthesis.
6. **Vet** the synthesis: check each finding against the logs and against the head (a fix may
   already be on the stack), and mark it confirmed, plausible or refuted (whole-run-investigation,
   "Vetting"). Sorting a finding by owner is triage, and checks nothing. A finding whose
   behaviour `AGENTS.md` documents as intended is an operator decision, not a defect: ask it then,
   with the evidence and a recommendation.
7. **Plan.** One row per confirmed finding, falsified prediction and defect seen live, each with
   its owner, the hostile test that fails without the fix, and the before-and-after it needs; the
   rows the operator must decide are asked now. Keep the plan in the cycle's file.
8. **Implement** every row on the top of the stack through stack-pr, with its hostile test, or a
   line under "Not done" in the release. A peer session's open pull request is never changed; stack
   above it. Each patch is also simulated before and after (system-path-simulation,
   `cases/before-after.md`): its commit against the commit beneath it, on the same logs or the same
   seed cut from the run that showed the defect, at the smallest layer that shows it. The pull
   request states what moved against what was predicted. A fix is measured by the next cycle's
   runs, never by the runs it was found in.
9. **Consolidate the open stack** before it lands, from the order its fixes were found into one
   structured by subject: review it in groups of related pull requests,
   fix what the reviews confirm in lanes, regroup related pull requests into one, publish, and
   prove it with `bun run land -- <top> --sanitize`. Its mechanics, and the word it needs, are
   stack-pr's section 10, "Consolidate the stack".
10. **Land and release.** `bun run land -- <top>` proves every commit; `--merge` waits for CI and
   merges the native stack. Then `git tag v<x.y.z> <merge>` and `gh release create`, in the form of
   the last release: one sentence on what the release changes, "Includes N PRs from #a to #b,
   merged into `main` at `<sha>`", one paragraph per change with its recorded counts, and
   **Validation and limits** with the land counts, the CI run and what the stopped runs showed. Where the proof fails, do not land: report the commit and step.
11. **Fork** the next cycle at the release's merge commit: step 1 again.

**The threshold.** Stop each run at **six promotions** (operator, 25 October, matching the
milestone). The running window ends when every run the cycle stops has ended, never at a time on
the clock. The #306 forks
reached their first promotion at 11.9 and 14.4 hours after their opening and their third at 17.8
and 19.1 hours (`wri.ts start`, lane 31), so a window of six takes about two days. The A/A of every promoting
reading should read no step; the release says where one did. No seat is told the threshold and no
campaign stops at it (`AGENTS.md`, factor 1): the cycle stops the runs.

### The script: `scripts/cycle.ts`

The cycle's state is read by one script, so a checkpoint or a timer is one line and nobody reads
the runs by hand to decide the step:

```sh
bun --env-file=.env.runs .claude/skills/run-improvement-campaign/scripts/cycle.ts \
  <run> ... [--keep <run>]... [--threshold 6]
```

It finds each named run on this machine or on a host `ANA_HOSTS` lists, and prints one row a run
(host, live or closed with its ending, promotions, comparisons and hours since its opening) and
then the step, with the commands that take it. Other hosts are asked through `askedScript`, in
each host's configured tree: a host that fails, or does not answer within the runs CLI's deadline,
leaves its runs `unread`.

| Step | When | Prints |
| --- | --- | --- |
| `stop` | a run the cycle stops is live at or past the threshold | the `runs stop ... --yes` for those runs |
| `run` | the remaining live runs have fewer promotions than the threshold | each such run and its count |
| `investigate` | none is live | the `runs fetch` of each run on another host, and the `wri.ts start` over all of them |
| `unread` (exit 1) | a run is found on no host that answered | the runs not found; no step is read past one that may be live |

A run named with `--keep`, such as an ablation the operator keeps going, is shown and never waited
for or stopped. The script reads and prints; it stops, fetches and launches nothing. The session or
timer that runs it takes the step, under the cycle's word. A host answers by running the script in
its own tree with `--here`, so a host's tree must hold the script: bring it to the release's commit
before the fork, as step 1 does.

The cycle's checkpoints are one-shot timers (section "Timers"), each of which runs the script and
takes the step it names: about 30 minutes after the fork for M1, then at each run's comparisons and
promotions, and once the script reads `stop`, at each step of the improvement window. Each
checkpoint may move the plan forward within the order above, and add, move or delete the cycle's
own timers to reach its goal.

## Resume

Read the operator's local handover where one is kept, then read the current evidence:

```sh
bun --env-file=.env.runs run runs status     # every run on this host and each host ANA_HOSTS lists
bun run runs pulse --once                    # open runs and endings since the last look
bun run runs view <name>                     # comparisons, climb and the table's next move
bun run runs source <name>                   # each launch's commit and whether it was clean
bun .claude/skills/stack-pr/scripts/stack.ts   # the open stack and its top
bun tools/wri/wri.ts read --log <worktree>/.ana/d2/<name>/log.jsonl
```

`status` and `pulse` ask every host `ANA_HOSTS` lists. WRI accepts campaign names from any host
and refreshes their copies automatically when invoked with the host environment loaded. `0 open` where
a campaign was launched calls for reading its ending. Use `AGENTS.md`, section 3, for the
operator's decisions and the authority a campaign launch gives once. Record continuing authority
in the local handover; the newest instruction governs it.

Read with source that knows the log's event kinds. If an older reader refuses or falls quiet,
read again from the current source before concluding that a signal is absent.

## The five points

Open and close each pass with these rows for each campaign. Say which point the pass moved.

| # | Point | Question | Read it from | Bar |
| --- | --- | --- | --- | --- |
| 1 | Climb | how many promotions from a fresh opening | `runs status`, `runs view`, the closing report's "Promotions" | `AGENTS.md`, factor 1 |
| 2 | Honesty | could a promotion be chance or drift | each report's `noise`; the closing report's "The chance of a false promotion" | the A/A controls and risk over every attempt |
| 3 | Supply | are there informative tasks | the campaign's `--dry-run`, the view's set-up line, `task.gate` | `AGENTS.md`, supply condition; admission also needs `sweepOf(level)` frontier tasks |
| 4 | Verdicts | does a person agree with the Referee | `tools/d2/settle.ts` | `AGENTS.md`, factor 3 |
| 5 | Economy | what each promotion cost | the closing report's "Work and spend", `promotionsWorth`, `worthLine` | at most three promotion attempts an epoch after set-up, unless the opening names another cost bar |

One line per campaign carries its worktree, opening commit, promotions, comparisons since the last
promotion, milestone, A/A results and dollars spent of its total. Read the closing report with:

```sh
bun tools/d2/close.ts --name <name> --to <scratch dir>
```

Point `--to` outside the repository. Without `--solve`, this writes a handover and runs no solve.
Supply binds before a comparison can say anything; economy reports and gates nothing.

A different level, target or number of solves a side changes what the instrument can show. Name
that change separately from a gain of the harness. The level and everything a solver is given
belong to the operator.

## The promotion chain

```text
prompt → Examiner drafts exam → host reads it → contract.frozen
Examiner drafts tasks → package gate → three reference solves (try_task)
                     → informative, or none valid and author's answer passes → held out
                     → no room or no reading → refused
Builder practises and edits → comparison.reported: step → harness.promoted
                            → new epoch → Examiner writes for the new reference
```

The gate uses `informative` in `src/kernel/compare.ts`, as the comparison does. A task leaves room
where the reference answers some solves, answers none while a valid answer is on record, or has a
valid answer beaten by a recorded objective measure. All reference solves passing therefore does
not by itself close a task. `AGENTS.md`, section 7, owns the full scoring procedure.

## Milestones: what to read, and when

Read each milestone the hour its event lands. Put the next prediction on record before the work
it predicts. Quiet between milestones is read against the limits of the work in flight.

| Milestone | Event | Read | Prediction it settles | Investigation |
| --- | --- | --- | --- | --- |
| M0 opened | receipt and `campaign.opened` | `runs source`: one commit, clean; fresh opening under section 10, item 9 | ledger written before the first solve | none |
| M1 exam | `exam.drafted`, `checker.read`, `contract.frozen` | faults by kind, `doNothing`, `admitted`, read when `contract.frozen` lands; a draft still open an hour after M0 is a lead to read, not a fault | frozen before `build.started` | none; assign an `exam` ending from its faults |
| M2 supply | first Examiner sessions' `task.gate` | held and refused by reason, objective room, missing readings, dry run | held out of drafted, a range | none |
| M3 first reading | first `comparison.reported` | `valid.informative.old`, tested untied and tied, `scored.detectable`, A/A, load | reading and untied count | only if a `read` trigger fires |
| M4 step | `comparison.reported` with `reading: step` against the reference | tested margins, the retained tally apart, A/A | untied count and A/A result | none |
| M5 promotion | `harness.promoted` | supporting reading, untied tasks, A/A and campaign risk; `wri.ts climb --log <log>,<peer>,<peer>` | write M6 prediction now | first promotion, once M6's first Examiner session has ended |
| M6 next epoch | first Examiner session and first comparison after M5 | drafts held and refused by reason, frontier and retained sizes, objective room | held out after M5 against before it | lane 31 with standing lanes, when owed at M5 |
| M7 ending | `campaign.ended` | ending kind, closing report, resolve every prediction | every open row | full investigation where the campaign promoted or an early ending raises an unresolved question |

An investigation follows its event and waits for a comparison's `comparison.reported`. Open it
for a question the readers cannot settle, a reading in doubt or an unclear failure owner. A timer
alone raises no question. A second promotion reopens lane 31 only where `wri.ts climb` shows
something the first did not. For an ending other than patience, report "reached N promotions;
further improvement unresolved" (`AGENTS.md`, factor 1).

**A stall** is a campaign whose milestone has not moved while it bills. Report it with its
milestone and leave it running. Read an ending by its recorded kind first: credit and session
limits follow `AGENTS.md`, rule 15, and are no defect to fix. To act on a proved stall:

1. Read backwards to the last promotion, comparison with room, or Examiner session that held a
   task out. Find the first subsequent move that did not advance the chain. Use `runs view` and
   the whole-run reader's rows.
2. Name the link and point, with the event that shows it.
3. Fix the owner through [stack-pr](../stack-pr/SKILL.md), and publish the fixing commit.
4. Prove the path by replaying the affected logs and, where needed, a rehearsal.
5. Predict the stalled milestone for the new campaign.
6. Launch fresh at the fixing commit. The old campaign reaches its own ending or the operator stops it.
7. Read the prediction as lifted, held or unreached (section 7).

## The walk: which link holds the next promotion

Start from the milestone: M1 points to link 2; M2 and no room to links 1 and 3; a retained loss to 7;
a near miss to 5; promotion to 8. Walk from the first link and stop at the first failure.
Links 1, 2 and 6 limit what the reading can establish.

| # | Link | Point | Holds when | Evidence |
| --- | --- | --- | --- | --- |
| 1 | supply | 3 | enough scorable frontier tasks remain for `sweepOf(level)` | dry run, set-up line, `task.gate` |
| 2 | instrument | 4 | exam stands and rejections have rulings or labels | `checker.read`, `contract.frozen`, `referee.finding`, tasks set aside |
| 3 | reference's room | 1 | the report finds informative tasks for the reference | `valid.informative.old`, `roomOf` |
| 4 | session | 1 | Builder practised and changed something the solver uses | `build.*`, `harness.version`, practice verdicts |
| 5 | size | 2 | the tested set has enough untied tasks and power at its margins | `scored`, `scored.unsolved`, `scored.detectable` |
| 6 | host | 2 | solve-start loads are read, including changes within a comparison | `HOST LOADED`, `LOAD MOVED`, `campaign.waited` |
| 7 | promotion | 2 | comparison against reference reads `step` | `step` row, `harness.promoted`, `noise` |
| 8 | next epoch | 1 | Examiner writes for the new reference and the tasks leave room | `harness.promoted`, subsequent `task.gate` and comparisons |

Read room by `informative`, rather than a target pass share. `noRoom` in `src/campaign/decide.ts`
requests an Examiner session after promotion even where the promotion's comparison leaves room.
Lane 25 of [whole-run-investigation](../whole-run-investigation/SKILL.md) reads a campaign's chain;
this walk chooses what to do about it.

### What each link reads as, and its owner

1. **Supply:** rows `tasks` or `short`, too few scorable tasks, refused drafts. Owners:
   `systemPrompt` and `firstMessage` in `src/examiner/prompt.ts`, `heard` in
   `src/examiner/record.ts`, `try_task` in `src/examiner/write.ts`, or `--exam-tasks`.
2. **Instrument:** an `exam` ending, checker faults, check-defect stops or tasks set aside.
   Owners: `planOf` in `src/campaign/opening.ts` and `readChecker` in `src/kernel/acceptance.ts`
   for a host fault; otherwise the check program's author. Follow `AGENTS.md`, section 3, for admissions and labels.
3. **Room:** row or ending `no-room`, zero `valid.informative.old`. Owners: tasks through link 1,
   with `roomOf` in `src/kernel/reports.ts` deciding the reading. A campaign has one budget.
4. **Session:** unchanged `build.finished`, idle conversations, every practice solve passed,
   or a change the solver never uses. Owners: `systemPrompt`, `SAID`, `firstMessage`,
   `continuation` and `usedLine` in `src/builder/prompt.ts`; `campaignStatus` and campaign tools in
   `tools/d2/campaign-actions.ts`; `idleOf` in `tools/d2/campaign-terms.ts`; session and practice terms.
5. **Size:** many ties, a near miss, or a high `scored.detectable`. `detectable` is the
   least winning share detected four times in five at these margins, in hundredths. It is power,
   not another threshold for the observed tally. Owners: `--target` and `--solves` in the next fresh
   campaign; `settingAsked` fixes the recorded target. The lasting cure for ties is link 1.
6. **Host:** `HOST LOADED`, `LOAD MOVED`, long waits or rising wall-ended solves. Read load before
   blaming the harness. Owner: the number of campaigns on that host; use the launch load rule.
7. **Promotion:** `no-step` near the level, a retained loss, or an A/A step. Owners: supply and
   size first. One `step` promotes (`stepOf`), its one test over the frontier and the retained
   tasks together, cleared on the scores and on the scores without the bill; until 19 October a first reading could buy a repeat, and until 20 October the
   retained tasks were a second test that could read `regressed`. No retained task tallied is
   `unmeasured`.
8. **Next epoch:** refused drafts, idle conversations or few frontier tasks after promotion.
   Owners: `heard`, `campaignStatus`, `hostOwed` in `tools/d2/harness-builder.ts`, and `ROWS` and
   `HOLDS` in `src/campaign/decide.ts`.

## 1. Choose one change, aimed at the next promotion

Choose from a recorded failure, wasted work or an open decision. Name the link, point, owner and
falsifier before writing code. Change the owner as far as the evidence carries: a prompt, tool
result, gate, table row or term. When an interface failure recurs, fix its schema, tool or facts.

Read the producer, consumers and tests first. Prefer deleting a competing owner, then reusing the
existing one, then adding the minimum. A term needs flags rather than code: read the owning command's
options, including `tools/d2/round.ts` for session and comparison terms. Follow
[stack-pr](../stack-pr/SKILL.md) and the repository's delivery rules for source changes.

Use `AGENTS.md`, sections 2, 3 and 8, for design bounds, operator decisions and the wall. Bring a
decision with evidence and a recommendation ready, and continue independent work. After two
comparisons miss alike, or a prediction fails, walk the links again before choosing another change.

## 2. Prove the path before spending

[system-path-simulation](../system-path-simulation/SKILL.md) chooses the smallest real layer:

- **Dry run:** `bun tools/d2/harness-builder.ts --name <name> --dry-run`. Read the table's move
  and the facts it used. The launcher runs this before launch too.
- **Replay:** `bun run runs replay [<name>]` reads registered campaign logs through this tree's
  readers, without provider cost. For a changed gate or table,
  also show what it would have held out or named at the relevant milestone.
- **Rehearsal:** `bun run runs seed --from <campaign folder> --name <seed>`, then
  `bun run runs rehearse` over the seed. Scripts replace the working seats; no Referee runs, and
  an Examiner is scripted only over a drafted exam. Use `--campaign` for a campaign path.

For model-visible text, render and read the whole composed surface. Check for duplicated facts
and whether a literal reading can finish within its limits. A test double proves its interface;
better model behaviour needs the fresh campaign's real milestone, read against its prediction.

## 3. Put the prediction on record

The campaign command takes no `--predict`: its comparisons are the Builder's to request. Keep a
ledger outside campaign folders before the first solve, naming campaign, commit and milestone.
A comparison made by hand takes:

```sh
bun tools/d2/checkpoint.ts <flags> --predict "<one sentence a count can settle>"
```

Use counts: "`contract.frozen` before `build.started`", "`x-1` holds at least three drafts",
"the first comparison unties at least six tasks", "the A/A reads no step". Each row names its
link and falsifier. Include one row about the link and one about honesty. Resolve each as held,
falsified or withdrawn, with the event that settled it. A prediction made after work began is a
description; say so.

## 4. Launch fresh

[run-management](../run-management/SKILL.md) owns commands and refusals. Check these conditions:

- A worktree kept for the run alone, detached at a clean published commit, with its own frozen
  install. Its receipt names the commit and dirty state. Follow `AGENTS.md`, section 10, for
  keeping that condition fixed and using `runs copy` or `runs move`.
- `bun run runs fresh <pack>` opens from the operator's prompt with a new run name. Set the
  authorised budget and terms. Use `--hitl` only when requested. For a manual launch, run dry run
  and launch as separate commands: a shell line containing both can match the live-process check.
- One campaign a host for a cycle's forks, at most two on any host. Each solve waits for load,
  but that wait cannot predict the next launch's load. Install the toolchain on the host where the
  campaign runs.
- Use the operator's chosen provider account through run-management's credential procedure.
  Keep its identity in the local handover; publish no account, login number or credential path.
- Start a chain of commands with `nohup` and output in a file; do not rely on a session's background job.

## 5. Watch

```sh
bun run runs pulse --once [<name>]
```

Read at each milestone and at the timer's predicted moment.

- A missing terminal event alone shows no stall. Solves can record `solve.turn` and `solve.call`
  before their verdict. Read quiet against the solve's wall and the session's `--minutes`.
- A receipt's process gone before an ending calls for reading its `.err`. A log that stopped
  growing is a lead, not a process check.
- Read a quiet run's last event before naming its state. A `status` row saying "solving" or
  "working" hours after its last event is usually a `campaign.waited` naming its reset. An
  `environment` ending under a live keeper is a pause, not an end. On 20 October both were misread:
  a weekly limit as a stall, and three paused runs as finished.
- `waitOut` in `src/solver/run.ts` waits for a named provider reset, inside the solve it ended and
  after a session crash (`tools/d2/host.ts`). After an interruption, continue
  at the run's own commit; counted solves stand. Apply `AGENTS.md`, rule 15, to provider limits.
- A keeper moves only among the logins it was given. With one login it waits out a weekly limit,
  which can take days. Give a keeper two or more logins. Where a run's wait outlasts its use (its
  commit is days behind the stack by the reset), bring the operator the stop with that reset.
- A process search by run name also matches the sandboxes of other runs, because each seat's wall
  names every worktree it denies. Attribute a process by its parent `harness-builder.ts --name`.
- Do not stop a live run to fix it. `runs source <name> --holds <commit>` checks containment.
  A fix is measured by the next fresh campaign.

While runs are live, run focused tests and send a whole suite to another runner through stack-pr.

## 6. Read

Read ending, reading, tally, ties, A/A, rulings and load, then the epoch's held and refused drafts.

```sh
bun tools/wri/wri.ts read --log <log>
```

Use the evidence order and separate outcomes and denominators in `AGENTS.md`, section 9. A
comparison that tallied no task gives an operational result and no rate. Quote no exam-side text.
Resolve predictions with counts. Before claiming improvement, use
[attribution-and-proof](../attribution-and-proof/SKILL.md). Use
[whole-run-investigation](../whole-run-investigation/SKILL.md) for a doubtful reading or failure owner.

**A step is one draw.** Give the supporting reading, its untied tasks and margins, the retained
tally apart, A/A and campaign risk. A near miss buys no repeat. Use `scored.detectable` and the
margins to size the next comparison; a tally alone does not fix its power.

**Two runs side by side** compare the system at two commits, never two harnesses: each run
drafted its own exam (`AGENTS.md`, section 9). Match them by **active hours**, then check the
match against dollars billed and comparisons reported. Wall hours mislead, because runs sit in
provider waits, outages and stopped stretches for different lengths of time. Active hours are the
time between consecutive events, leaving out:

- any silence over ten minutes;
- every recorded `campaign.waited`;
- every stretch that ends in a `provider` non-result or an errored model turn before anything
  productive happens.

On 20 October r5 and r6 read 16 wall hours and 7.5 and 9.4 active hours: a DNS outage had failed
their solves as `provider` non-results for four hours. Name each setting the runs differ in
(limits, objective rule, promotion rule) beside the comparison. No reader in the tree computes
active hours yet, so give the script with the counts.

## 7. Decide

First say what happened to the link:

- **lifted:** the link moved and the chain followed. Walk again.
- **held:** the link moved but the chain did not. Walk again from that link with the new counts.
- **unreached:** the change never moved its link. Repair its path and containment before choosing another.

Choose one move. `decide` in `src/campaign/decide.ts` advises accept, prepare, examine, build,
compare, promote or end. A led Builder chooses its tools; code keeps admissions and scoring, and
`hostOwed` makes comparisons and promotions between conversations.

The stop rule counts since the last promotion (`stopRule`, `src/kernel/reports.ts`). A changed
harness/reference pair counts once when tallied with room or a step; a whole unchanged session
counts only where practice failed. A step shows gain. Controls, unscored comparisons and non-step
readings without room do not count. Patience defaults to six (`PATIENCE`); `roomless` separately uses it
for failed attempts to obtain tasks or room. Budget and other endings remain distinct.

If the pass disagrees with the table, give the counts it cannot read. The loop's own moves are:
fix one owner and launch fresh, change one term and launch fresh, delete an unread mechanism, or
investigate a consequential ambiguity. Launch only within the operator's authority.

Close in the handover: five points, milestones, worktrees, commits, last readings, predictions,
link and result, decisions waiting, and next command. Keep negative results and their limits intact;
name each claim's evidence level from attribution-and-proof.

## Timers

For authorised unattended work, keep timers, their authority and one ledger row per firing in a
local file beside the handover. Timers arrange this procedure; they add no campaign scheduler.

| Timer | When | Does |
| --- | --- | --- |
| watch | hourly, off the hour | every run's milestone and possible stall on every host |
| pass | every three hours | rewrite ranked triage, rehearse its top row, fix the owner, review timer usefulness |
| milestone | one-shot at the predicted event | read the named milestone and any investigation it owes |
| cycle checkpoint | one-shot at each step of the release cycle | run `scripts/cycle.ts` over the cycle's runs, take the step it names within the order, log it, and re-arm or delete the cycle's timers |
| handover | one-shot at the agreed handover time | five points, changes and decisions waiting |

Each watch and pass estimates the next event from that run's log and arms a one-shot. For a
comparison, estimate scored tasks × solves a side × 2 × median solve minutes, divided by concurrent
solves. If early, re-arm from the new evidence. Investigate after the event.

Keep one triage list, rewritten each pass: problem, link, event or count, how found, and status.
Rank by the first failed link, then the number of runs showing it. Check against log and source;
prove a row with a replay or rehearsal that passes its link. A failed prediction opens a row.

Each firing records what it found, whether useful and when it should have fired. Review those
rows: three empty watches may justify two-hour spacing; M3 or M5 approaching needs a one-shot.
Timers act only within recorded authority, including authority for launches and stops.

A Claude Code timer (`CronCreate`) lives only in the session that armed it. It dies when that
session exits, and a recurring one expires after seven days. It fires only while the session is
idle, a few minutes off the time it names. So:

- Write each timer's prompt to stand alone, with absolute paths, the ledger file, the runs it reads
  and its authority. It fires after compactions that will have dropped the context it was armed in.
- Every timer may move its work forward and patch or tune the timers (add, move, delete) to reach
  the goal it serves (operator, 21 October). Say so in its prompt, and log each change.
- A watch speaks to the operator only when a milestone landed, a run stalled or ended, or a
  prediction resolved. Otherwise it writes its ledger row and stays silent.
- When a timer is replaced (an hour moved, a run added), delete the old one by its id. A one-shot
  that a later reading made early is re-armed, not left to fire on stale facts.
- The handover timer reads the other timers' ledger rows and says which were useful.

## Which skill each step uses

| Step | Every pass | When triggered |
| --- | --- | --- |
| cycle | the plan file and its log | run-management to fork and stop; whole-run-investigation on the stopped runs; system-path-simulation's before-and-after for each patch; stack-pr to implement on the open stack, its section 10 to consolidate it by subject, and `bun run land` to release |
| score | five points and milestone | none |
| walk | epoch, pulse, reader, link table | whole-run-investigation lane 25 for a campaign with a chain |
| choose | link, owner, falsifier | stack-pr for source; simplify over the diff |
| prove | replay and launch dry run | system-path-simulation rehearsal for a round or campaign path |
| predict | ledger before first solve | `--predict` on a manual comparison |
| launch | run-management and load rule | none |
| read | milestone and resolved predictions | attribution-and-proof before a claim; investigation when owed |
| decide | lifted, held or unreached; one move | harness-audit before handover; oracle-handover for a question repository evidence cannot settle |

Record an unmet trigger as not triggered. Change this skill when a pass exposes duplicated work,
a missed reading or a wrong decision; replace the rule at its owner and keep what changes the next decision.
