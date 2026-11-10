---
name: run-improvement-campaign
description: "Run the Anabasis improvement loop (the Super Loop) and its iterations and release cycle: fork fresh campaigns, read their milestones and resolve predictions; at a run's trigger (two promotions, twelve hours, or a comparison that left no task untied), investigate it on a snapshot (`scripts/wri2p2.ts`), implement the findings as one pull request on the top, and fork fresh runs at its head; land the release once a proof run at the top promotes twice. Each pass scores the five points, finds the link that holds the next promotion, fixes its owner, proves the path and predicts. Use when the operator asks to keep campaigns going, fork runs, work towards a release, run a pass or an hourly audit, read a promotion, investigate a campaign that is not promoting, or choose the next run. Owns the experiment and its evidence; AGENTS.md section 3 owns the operator's decisions."
---

# Run improvement campaign (the Super Loop)

The loop is an experiment over code versions in three nested cycles. A **release cycle** lands the
stack's pull requests as one release, on the operator's word, once a proof run at the top has
promoted twice. Each **iteration** (WRI2P2) investigates one fresh run that reached its trigger, turns
the findings into one pull request on the top and forks fresh runs at its head, which measure the
fix. A **pass** asks what holds the next promotion: score, walk, choose, prove, predict, launch,
watch, read, decide.

Only a fresh campaign is evidence of climb (`AGENTS.md`, section 10, item 9); seeds, stored packs and
continuations at another commit prove paths only. No gain is bought with honesty: a looser level, a
reused solve, a leaked held-out task or a target given to the Examiner establishes nothing.

## What to do when

Within the fixed order and the operator's decisions below, which lane, lever or reading, and how far
to go in one sitting, is the session's judgement. Read the script first and decide after it.

| When | Read first | Then |
| --- | --- | --- |
| starting, resuming or woken with nothing named | `wri2p2.ts due`, then `cycle.md` | the live run's trigger it lists, else the longest-standing step; `next <dir>` prints it whole |
| a report, promotion, starter read or ending lands | `runs view <name>`; comparison-reading's `starter-reads.ts` after a promotion | "Milestones"; resolve that run's predictions with the log's length; at a trigger, `wri2p2.ts open` |
| a slot is free | `runs active`, `runs usage`, the cycle's `run-queue.md` | the iteration's step 5: its `predictions-<run>.md`, the dry run, then `runs fresh` |
| lanes are out, or a synthesis is written | `wri2p2.ts next <dir>`, `wri2p2.ts ledger <dir>` | the iteration's steps 2 and 3 |
| a fix is ready | stack-pr's `stack.ts`, repository-practice's `preflight.ts` | step 4, its before-and-after, then step 5 |
| a run bills while its milestone stays put | `runs pulse <name>`, `wri.ts read --log <log>` | "A stall", then "The walk" |
| a step has stood for two days, or two sessions hold one step | the hours `due` prints; the rows of `cycle.md` | take it, pass it in `deviations.md`, or name its one holder in `cycle.md` |
| a handover is due, or a timer fires with nothing to do | `timers.ts <the session's transcripts>` | "Timers": retire or retime it; then the five points |

## The release cycle

A cycle runs on the operator's word for it ("work towards 0.6.4"). That word covers the cycle's runs,
their stops and its patches; landing, the release and the next runs need it only where it names
them, and merging is always the operator's (`AGENTS.md`, section 11). Record each grant and each open
decision in the cycle's ledger, `cycle.md`, which every step reads first.

The order is fixed, and no step moves ahead of the one before it:

```text
iteration:  predict → fork at the top → run (2 promotions or 12 hours) → investigate → vet → plan → implement (one PR on the top) → prove → predict → fork at its head → ...
release:    proof run at the top to 2 promotions, unchanged → three reviewers → consolidate → land and release on the operator's word → fork at the release
```

A run measures the code it ran, so a release landed before its investigation is read ships without
the findings. Where a deadline leaves no time, ask the operator instead of landing first.

### The cycle's files

A cycle's files live in one folder of the central host's main checkout,
`.ana/wri/<YYYY-MM-DD>-cycle-<release>/` (dated by the fork, such as `2026-11-07-cycle-v073`), beside
its investigations, and never under `data/`, whose campaign folders `fetch`, `retire` and `derive`
replace whole. `wri.ts index` lists each recent run with the ledgers that name it, so a ledger is
never copied.

- `cycle.md`: the word, the threshold, the reviews and one log line per step, laid out as
  [references/cycle-ledger.md](references/cycle-ledger.md).
- `run-queue.md`: the runs to launch next, in order, each with `ready: yes` or `ready: no` and the
  gate that moves it to yes on evidence in the ledger. A timer launches only an entry marked ready
  and never marks one.
- Two files for each run, each the one owner of its fact. `predictions-<run>.md`, written before
  that run's `--yes` (the first solve comes minutes after the opening), holds the rows it settles in
  a table whose first column is `id`:

  ```text
  | id | PR | labels | lanes | group | claim, as a count | falsified by |
  ```

  The cycle's runs between them carry one row for every pull request merged since the last cycle's
  fork (`git log --merges <last fork>..<release>`), even one no run reads, and the cycle-wide rows
  on supply, climb and honesty. A row's lanes are its labels' lanes (whole-run-investigation's
  `references/lanes.md`, "Labels"); needing another lane means the label is wrong. Its group is
  `first` (code no run has run), `again` (run before under another condition) or `off-run` (no seat
  reads it; settled by a landing, a reader or the launch). `outcomes-<run>.md` gives each of its ids,
  and no other, one outcome, `held`, `falsified`, `unreached`, or `pending` while a live run's event
  has not come, and records the log's length it was read at on a line of its own,
  `Log events at resolution: <n>`, which `next` prints; once the log grows past it, `next` reopens
  every `unreached` or `pending` row, since a run continued after its trigger may yet reach them.
- What a run leaves undone and what it leaves out on purpose belong to the `plan.md` of the
  iteration that read it: `## Not done` for each row the pull request does not carry, with where it
  is carried, and `## Intentionally opposed` (at least one line; `none` counts) for what stays
  missing on purpose, as a trade-off from `AGENTS.md` section 1, a principle or the operator's
  word, so that a gap left by design is not read as one forgotten.
- The views are derived and never written by hand:
  `bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts ledger <dir>` prints, for a cycle's
  or an investigation's folder, the cycle view (every prediction of its runs with its outcome, a
  stale one marked) and each run's still-missing view (the ids it did not hold beside its plan's two
  sections). Until 8 November a cycle's `Predictions.md` kept resolutions of its own and each run a
  `still-missing-<run>.md` that restated the plan, so each fact had two owners (`AGENTS.md` rule 12);
  those files stay as written and are still read, and no new one is written.

A review that finds a run's `predictions-<run>.md` missing writes it first, marked as written after
launch with the run's solves at that moment.

### The iteration (WRI2P2)

WRI2P2 (Whole Run Improvement, Implementation, Plan, Stacked PR Protocol) goes from one run's
trigger to a stacked pull request and fresh runs at its head; those runs are launched without
asking. One script reads where every run and iteration stands and prints the next step with its
command:

```sh
bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts [<part> ...] [--promotions 2] [--hours 12] [--days 2]
bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts due [<part> ...] [--days 2]
bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts open <name>[,<name>] [--out <dir>]
bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts next <dir>
```

It reads the central host's gathered copies of every host's runs, needing no ssh or env file, writes
only an investigation's files, and stops, launches and merges nothing. With no verb it prints one row
a run with its step: `run`, `open` with its trigger, or the step its investigation has reached;
`due` prints the same reading in a few lines, as a timer takes it.

1. **Trigger.** Whichever comes first: two promotions, twelve hours since the opening, a scored
   comparison that left no task untied, or an ending after a comparison. The trigger stops nothing.
   Resolve the run's predictions into `outcomes-<run>.md`, with the log's length.
2. **Investigate** with whole-run-investigation, opened by `wri2p2.ts open` with the other triggered
   runs of the same code and pack as equals. `open` reads live runs on a frozen copy
   (`wri.ts start --snapshot`) and writes `iteration.json` (`{ "opened": <ISO>, "runs": [<names>] }`),
   which the later gates require. A run is never stopped for its investigation; stopping is the
   operator's. Then follow `wri2p2.ts next <dir>` through the instructions, `lanes --agents 4` with
   one subagent a lane, the collection and the synthesis. Before the vetting, `next` waits until each
   run has its two files, looking only in `*-cycle-*` folders and the investigation's own, and
   refuses where two of them hold the same file.
3. **Vet, read across domains, plan.** Vet each finding against the logs and the head (a fix may
   already be on the stack) as confirmed, plausible or refuted (whole-run-investigation, "Vetting"),
   in `vetting.md` with rows `vet-<n>`. Recount every prediction first, so that `vetting.md` names
   every prediction id: a falsified row becomes a finding, an unreached one carries to the next
   ledger. Behaviour `AGENTS.md` documents as intended is an operator decision, asked with evidence
   and a recommendation. A fix found in one domain lands in all of them, so a read-only subagent
   then reads the newest 5 to 10 vetted investigations of the other domains, none from before the
   previous minor release, and writes `cross-domain.md`: for each confirmed problem, whether those
   domains show it, what differed where they do not, and whether an earlier fix failed to hold; for
   each candidate fix, what it changes in each domain and the cheapest test that would settle it.
   The plan, `plan.md` (linked from `cycle.md`), has one row per confirmed finding, falsified
   prediction and live defect, with its owner, a hostile test that fails without the fix, and the
   before-and-after it needs. It holds tunings as well as repairs: read [the
   levers](references/levers.md) against the binding link, and give each lever the evidence selects
   a row, tuned or kept with one checkable sentence. `next` requires `plan.md` to name
   `cross-domain.md`, every confirmed `vet-<n>` (in a row or under `## Not done`) and at least three
   lever ids such as `E1`, and to hold `## Intentionally opposed`. Ask the rows the operator must decide now, and implement around them.
4. **Implement** the plan as one pull request on the top through [stack-pr](../stack-pr/SKILL.md),
   proved with `bun run land -- <top> --sanitize`, and name it in `plan.md` on its own line,
   `Pull request: #N`. A row whose label one of your own open pull requests carries goes there; a peer's
   pull request is stacked above, never changed; a row left out goes under "Not done". Simulate each
   patch against the commit beneath it on the same logs or seed (system-path-simulation,
   `cases/before-after.md`), and tune a change to what a model seat reads in paired rounds
   (`cases/optimize.md`), since one draw cannot read it. The pull request states what moved against
   what was predicted; the next runs, never those it was found in, measure the fix. Patches a Codex
   swarm writes are stacked by the primary with `git apply --3way`, and the composed gate runs on the
   top, since commits that pass alone can interact.
5. **Predict, then fork at that head** with `--as forkedPR<N>`, by which `next` finds the runs that
   measure it. Take each name from the dry run of `runs fresh` and write its
   `predictions-<run>.md` first, with a `## Carried` section naming each id the parent runs did not
   hold, as `<parent run>:<id>`. A slot an ended run frees goes at once to the first entry of
   `run-queue.md` marked `ready: yes`, and where the queue holds none, to a fresh run at the current
   top only where the cycle's word covers it; idle capacity measures nothing.

`next` walks these gates in order: `open`, `instruct`, `lanes`, `reports`, `isolated`, `synthesise`;
for each run `predictions`, `outcomes` and, for a fork, `carry`; then `vet`,
`across`, `plan`, `implement`, `launch`, `forks` and `done`. A folder without `iteration.json` takes
the shared gates only. Every gate but `done` is a default rather than a wall: a row
`| <step> | <reason> |` in the folder's `deviations.md` (the step, or `<step>:<run>`) passes it, and
`next` prints `deviated: <step> · <reason>`.

Iterations overlap: a second run can trigger while the first's pull request is being written, and
each pull request stacks on the one before. Nothing in an iteration is merged; the release does that.

### The running window

1. **Predict** in the ledgers ("The cycle's files"), before the fork.
2. **Fork** at the commit the last release merged (`git tag` on `main`), or at an iteration's pull
   request head, naming any pull request above it. For a cycle, fork one fresh campaign per runner
   host, or the set the operator names, after a dry run:
   `runs fresh <pack> --host <host> --at <commit> --login N --as <suffix> --yes`. Take hosts from
   `ANA_HOSTS` (`hostsOf`) after `runs hosts --health`, and launch them one after another, since
   concurrent `fresh --host` launches from one checkout fail. Ordinary forks let `fresh` place them;
   placement does not ask whether a peer holds the pack's prompt, so a pack whose prompt only the
   central host holds takes `--host here`. Name a pull request's head by its number in the ledger
   and read it (`gh pr view <n> --json headRefOid`) at the launch itself, also in a script that
   launches once a login frees a slot: a landing beneath replays the pull requests above it onto new
   heads. Tag `run/<name>/1` at the commit and push it.
3. **Read** with `wri2p2.ts` at every review and milestone, resolving each prediction the hour its
   event lands. A defect seen live goes into the plan; the run is not stopped to fix it. When the
   stack moves while runs are live, each `measures` line of `wri2p2.ts due` counts the files of the
   code a solve runs (`codeOf`, `tools/d2/campaign.ts`: `src`, `vendor`, the campaign commands under
   `tools/d2`, `tools/c` and `tools/d1b`, and the packages) that differ between a live run's commit
   and the commit the command runs from, none of which is measured until a run is forked there. So
   stack what no run runs (other tools, tests, skills) as it is ready, gather what a run does run
   into the iteration's one pull request, and fork at its head before stacking the next.

### The improvement window

Steps 4 to 9 share twelve hours from the last stop. Where a step cannot finish in time, say what is
left and continue in order; the window never justifies skipping a step.

4. **Stop** a run past the threshold only where the operator's word names it, with
   `runs on <host> stop <name>` (two hosts can hold one name); every other run runs on and is read
   on a snapshot. A stop word
   (`tools/d2/word.ts --stop`) acts only at the next move boundary. Resolve the predictions and mark
   the rest `unreached`.

Steps 5 to 8 investigate, vet, plan and implement the stopped runs as equals, as in the iteration's
steps 2 to 4, with the isolated lanes 4 and 15 of
[whole-run-investigation](../whole-run-investigation/SKILL.md) where called for.

9. **Consolidate** the stack by subject before it lands: review in groups, fix confirmed findings,
   regroup, publish, and prove with `bun run land -- <top> --sanitize` (consolidate-stack).
10. **Land and release** on the operator's word: `bun run land -- <top>` proves every commit, and
    `--merge --tag v<x.y.z>` waits for CI, merges and cuts the release; then rewrite the notes as
    stack-pr section 9 sets out. Where the proof fails, report the commit and step and do not land.
11. **Predict and fork** the next cycle at the release's merge commit.

### A run proves the release

`--sanitize` proves that each commit passes its checks; only a run shows that the stack still
climbs. Every stack, a patch that changes nothing a seat reads included, lands only once a fresh
campaign launched at the top's head has reached two promotions under four conditions:

- **One commit throughout.** Every launch in `bun run runs source <name>` names the head, or a commit
  whose code a solve runs (`codeOf`) matches it, each with a clean tree, and `wri.ts read` row C
  names one host code.
- **The mechanisms ran.** Each pull request that changes a run's conditions shows its event in the
  log (`AGENTS.md`, section 9); one whose trigger never came is named unmeasured in the notes.
- **No defect ending**: no `environment` ending and no crash before the second promotion. A credit
  or session limit is not a defect (rule 15); continue at the same commit.
- **Nothing above it.** A pull request above the run's commit is not proved by it; land the proved top
  by number. One that changes what a seat reads waits for its paired round of seats, then its own run.

The notes name the proof run, its commit and its two `harness.promoted` events. The version tells
which runs may be compared: the patch moves where runs measure what the last release's measured, the
minor where the release changes what a run measures (a weight, the level, the step test, task
admission, the setting, what a seat is told; never compare runs across minors).

The major moves to 1 at the release whose runs meet the v1.0 bar's measured rows (`docs/plan.md`,
"The v1.0 bar, now"): the climb milestone, six confirmed promotions in one fresh campaign at one
commit of the release line and then in a second domain; honesty, no A/A step in the ten comparisons
after the sixth; verdicts, the Referee's agreement on 30 blind labels; and the wall on both
operating systems. A row whose threshold the operator has not set (the validity share, a dollar
target, systems, outside) is reported in the notes and holds nothing back. After 1.0 the major
moves only where a reading stops meaning what it meant: the question of `AGENTS.md` section 1, what
crosses the wall, or a factor's bar (operator, 8 November 2026: "decide upon what counts as a major
version").

### The threshold

No run carries a cap. Each promotion alerts (`runs alerts`), and a run is paused on the operator's
word only after that promotion's starter comparison reports, since an earlier pause leaves it
unconfirmed for good (`AGENTS.md`, factor 1). Two promotions trigger an investigation and stop
nothing; `--promotions N` remains available (run-management).

## Resume

Read the local handover, then the evidence:

```sh
bun --env-file=.env.runs run runs status     # every run here and on each host ANA_HOSTS lists
bun run runs pulse                           # open runs and endings since the last look
bun run runs view <name>                     # comparisons, climb and the table's next move
bun run runs source <name>                   # each launch's commit and whether it was clean
bun .claude/skills/stack-pr/scripts/stack.ts # the open stack and its top
bun tools/wri/wri.ts read --log <worktree>/.ana/d2/<name>/log.jsonl
```

Record continuing authority in the handover; the newest instruction governs.

## The five points

Open and close each pass with these per campaign, and say which point the pass moved.

| # | Point | Question | Read it from | Bar |
| --- | --- | --- | --- | --- |
| 1 | Climb | promotions from a fresh opening | `runs status`, `runs view`, closing report "Promotions" | `AGENTS.md`, factor 1 |
| 2 | Honesty | could a promotion be chance or drift | each report's `noise`; closing report "The chance of a false promotion" | A/A comparisons and risk over all attempts |
| 3 | Supply | are there informative tasks | `--dry-run`, the view's set-up line, `task.gate` | `comparisonFloor(level)` frontier tasks |
| 4 | Verdicts | does a person agree with the Referee | `tools/d2/settle.ts` | `AGENTS.md`, factor 3 |
| 5 | Economy | what each promotion cost | closing report "Work and spend", `promotionsWorth`, `worthLine` | at most three attempts an epoch after set-up |

The closing report is `bun tools/d2/close.ts --name <name> --to <scratch dir>`, with `--to` outside
the repository or under `data/harnesses/`.

promotion-tuner's `scripts/table.ts` (`--rows recent`, `--rows groups`) sets this cycle's runs beside
earlier ones; read room first, since hours without room say nothing about ability. A changed level,
target or solves a side changes the instrument, not the harness, and is the operator's.

## Milestones

Read each milestone the hour it lands, with the next prediction on record. Room is `informative`
(`AGENTS.md`, section 7).

| Milestone | Event | Read | Investigation |
| --- | --- | --- | --- |
| M0 opened | receipt, `campaign.opened` | `runs source`: one clean commit, fresh opening | none |
| M1 exam | `exam.drafted`, `checker.read`, `contract.frozen` | faults by kind, `doNothing`, `admitted`; a draft open an hour after M0 is a lead | none; an `exam` ending is read from its faults |
| M2 supply | first `task.gate` | held and refused by reason, objective gap, dry run | none |
| M3 first reading | first `comparison.reported` | `valid.informative.old`, untied and tied, `scored.detectable`, A/A, load | only on a `read` trigger |
| M4 step | `reading: step` against the reference | tested margins, retained tally apart, A/A | none |
| M5 promotion | `harness.promoted` | supporting reading, untied tasks, A/A, campaign risk; `wri.ts climb --log <log>,<peer>` | first promotion, after M6's first Examiner session |
| M6 next epoch | first Examiner session and comparison after M5 | drafts held and refused, frontier and retained sizes | lane 22, when owed at M5 |
| M7 ending | `campaign.ended` | ending kind, closing report, every open prediction | full, where it promoted or an early ending leaves a question |

For an ending other than improvement patience, report "reached N promotions; further improvement unresolved".

**A stall** is a campaign that bills while its milestone stays put; a credit or session limit is not
one (rule 15). Report it and leave it running. To act on it, find the first move after the last
advance of the chain, name its link with the event, then run a pass on that link and launch fresh at
the fix.

## The walk: which link holds the next promotion

Enter from the milestone (M1 at link 2; M2 or no room at 1 and 3; a retained loss at 7; a near miss
at 5; a promotion at 8) and stop at the first link that fails. Lane 21 of
[whole-run-investigation](../whole-run-investigation/SKILL.md) reads the chain; the walk acts on it.

| # | Link | Point | Holds when | Fails as | Owner |
| --- | --- | --- | --- | --- | --- |
| 1 | supply | 3 | enough frontier tasks for `comparisonFloor(level)` | rows `tasks` or `short`, refused drafts | `src/examiner/prompt.ts`, `heard` (`record.ts`), `propose_tasks` (`write.ts`), `shortOf` (`decide.ts`) |
| 2 | instrument | 4 | the exam stands and rejections are ruled | `exam` ending, checker faults, tasks set aside | `planOf` (`src/campaign/opening.ts`), `readChecker` (`src/kernel/acceptance.ts`), else the check's author |
| 3 | room | 1 | the reference has informative tasks | `no-room`, zero `valid.informative.old` | link 1; `roomOf` (`src/kernel/reports.ts`) |
| 4 | session | 1 | the Builder changed something the solver uses | unchanged `build.finished`, idle sessions, all practice passed | `src/builder/prompt.ts`, `tools/d2/campaign-actions.ts`, `idleOf` (`tools/d2/campaign-terms.ts`) |
| 5 | size | 2 | enough untied tasks and power at the margins | many ties, near miss, high `scored.detectable` | `--target` of the next campaign; lastingly link 1 |
| 6 | host | 2 | loads read at each solve start | `HOST LOADED`, `LOAD MOVED`, long `campaign.waited` | campaigns per host |
| 7 | promotion | 2 | the comparison reads `step` | `no-step` near the level, retained loss, A/A step | links 1 and 5 first; `stepOf` |
| 8 | next epoch | 1 | the Examiner writes for the new reference with room | refused drafts, few frontier tasks after promotion | `make` (`tools/d2/harness-builder.ts`), `ROWS` (`src/campaign/decide.ts`) |

`scored.detectable` is power (the smallest winning share detected four times in five at these
margins), not a threshold on the tally. One `step` promotes, from one test over frontier and retained
tasks together.

## The pass

1. **Choose one change** from a recorded failure, wasted work or an open decision, and name its link,
   point, owner and falsifier before writing code. Read the producer, consumers and tests; prefer
   deleting a competing owner, then reusing one, then adding the minimum. A term is a flag, not code
   (`tools/d2/round.ts`). After two alike misses or a failed prediction, walk again.
2. **Prove the path before spending,** at the smallest real layer (system-path-simulation): the dry run
   `bun tools/d2/harness-builder.ts --name <name> --dry-run`; `bun run runs replay [<name>]` through
   this tree's readers; `bun run runs seed --from <campaign folder> --name <seed>` then
   `bun run runs rehearse` with scripted seats and no Referee. To compare two commits on one exam,
   seed a finished campaign cut at its `contract.frozen` (`--events <its line>`) into a worktree at
   each commit and run both on the source's launch flags. That removes the exam as a confound, but
   each arm is a paid run on the operator's word and yields a lead, not a step. Render model-visible
   text whole and check it for duplicated facts.
3. **Predict** in a ledger outside campaign folders, before the first solve: a run's `predictions-<run>.md`
   in a cycle, and `bun tools/d2/checkpoint.ts <flags> --predict "<sentence>"` for a comparison by hand.
   Use counts ("`contract.frozen` before `build.started`", "the first comparison unties at least six
   tasks", "the A/A reads no step"), including one row on the link and one on honesty.
4. **Launch fresh** through [run-management](../run-management/SKILL.md) with `bun run runs fresh
   <pack>`, the authorised budget and terms, `--hitl` only on request, the dry run and the launch as
   separate commands, and at most two campaigns a host (one for a cycle's forks).
5. **Watch** with `bun run runs pulse [<name>]`. A missing terminal event is no stall, since solves
   log `solve.turn` and `solve.call` before their verdict; read quiet against the deadline. A
   "solving" row hours after its last event is usually a `campaign.waited` naming a reset, and an
   `environment` ending under a live keeper is a pause. Give a keeper two or more logins, or it waits
   out a weekly limit; where that wait outlasts the run's use, bring the stop to the operator.
   Attribute a process by its parent `harness-builder.ts --name`.
6. **Read** ending, reading, tally, ties, A/A, rulings and load, then the epoch's drafts
   (`bun tools/wri/wri.ts read --log <log>`), with the evidence order of `AGENTS.md`, section 9, and
   no exam-side text quoted. A step is one draw: report its untied tasks, margins, retained tally,
   A/A and campaign risk, and use attribution-and-proof before any claim. Two runs side by side
   compare the system at two commits, never two harnesses, since each drafted its own exam. Match
   them on active hours (time between events, excluding silences over ten minutes, `campaign.waited`
   and stretches ending in a `provider` non-result), and name each setting they differ in. No reader
   computes active hours, so give the script with the counts.
7. **Decide.** Say whether the link **lifted** (moved, and the chain followed), **held** (moved, the
   chain did not) or was **unreached** (never moved; repair the path first). `decide`
   (`src/campaign/decide.ts`) advises the move; the stop rule (`stopRule`,
   `src/campaign/admission.ts`) counts eligible moves since the last promotion. Where the pass
   disagrees with the table, give the counts the table cannot read. The loop's own moves are to fix
   one owner or one term and launch fresh, delete an unread mechanism, or investigate a
   consequential ambiguity, within the operator's authority. Close in the handover with the five
   points, predictions, the link's result, open decisions and the next command, negative results
   included.

## Timers

A timer wakes a model for a judgement. Whether anything is due is a condition, and code reads it
with no model: the anti-stall hook's pulse and `runs alerts` (a local job runs it) report each
report, promotion, starter read, ending and stall as it lands, a subagent's ending wakes its
session, and `wri2p2.ts due` prints each step owed with the hours it has stood. So no timer polls a
run or a folder, and none repeats a fact one of these reports. Keep each timer with its id, schedule
and authority in `cycle.md`; [references/timers.md](references/timers.md) holds each timer's map and
what its prompt carries.

Every firing follows one protocol; what it reads and concludes between steps is the session's
judgement.

1. **Read the state**: the clock (`date -u`), `wri2p2.ts due`, then in `cycle.md` the authority, the
   queue and which session holds a step. Where nothing is owed and no slot is free, answer in one
   line and write nothing.
2. **Take one step** within recorded authority: the trigger or step `due` lists first that no other
   session holds, a free slot's fork, or a landed milestone. Resolve the predictions whose event
   landed or whose deadline passed, with the settling count and time; a live run's unmet row stays
   `pending`, and one that can no longer trigger is `unreached`. A written resolution stays, and a
   disagreeing recount adds a row; a falsified row opens a row in the one triage list (problem,
   link, event, status), ranked by first failed link and then by how many runs show it.
3. **Chain or rest**: where `due` still lists a step this session can take, set a one-shot ten
   minutes on that carries the same prompt; otherwise one at the next event a log predicts (for a
   comparison, scored tasks × solves a side × 2 × median solve minutes ÷ concurrent solves). Delete
   replaced timers by id.
4. **Log** one row where something changed: the time the clock gave, what moved, the rows resolved
   and the timer changes. Speak to the operator only when a milestone landed, a run stalled or
   ended, or a prediction resolved.

| Timer | When | It wakes the session to |
| --- | --- | --- |
| none: the pulse and the alerts | as an event lands; the pulse every 290 s through the hook, or where a session has none, one Monitor on `bun run runs pulse --every 290 --state <file>` | read that milestone and follow the protocol: a triggered run starts an iteration, a freed slot goes as the iteration's step 5 says |
| driver | recurring, every two hours, with its ten-minute chain while steps are owed | the protocol, for a step no event announces |
| milestone | one-shot at a predicted event or deadline | that milestone or row |
| open decisions | recurring, every four hours | decide the routine doubts, each with what would overturn it, and list for the operator those section 3 reserves |
| morning read | recurring, once a day after the nightly local jobs | read what changes once a night and no job reports: those jobs' outcome and last exit, the hosts' disks, where the stack stands on `main` |
| handover | one-shot at the agreed time | the five points, changes, open decisions and the loop's own measures |

At a handover the timers are counted with `timers.ts` instead of asked
([references/timers.md](references/timers.md), "Reading the timers"), and the loop's own measures
are recorded as [references/cycle-ledger.md](references/cycle-ledger.md) lays them out.

The pulse is the one recurring watch of a run, and a one-off wait never stands in for it. A
`Monitor` expires within half an hour and each re-arm is a model turn, so it serves a bounded wait.
A `CronCreate` timer lives only in its session, fires only while it is idle, and expires after seven
days if recurring, so each prompt stands alone after compaction, carrying what
[references/timers.md](references/timers.md) lists.

## Which skill each step uses

run-management runs the campaigns, whole-run-investigation reads them, system-path-simulation proves
paths, stack-pr implements and lands, attribution-and-proof precedes a claim, harness-audit a
handover, and oracle-handover takes what the repository cannot settle. Change this skill where a pass
exposes duplicated work or a wrong decision, replacing the rule at its owner.
