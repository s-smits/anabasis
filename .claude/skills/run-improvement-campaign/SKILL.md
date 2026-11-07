---
name: run-improvement-campaign
description: "Run the Anabasis improvement loop, the Super Loop, and the iterations and release cycle around it: fork fresh campaigns, read each at its milestones and resolve predictions; as each reaches its trigger (two promotions, twelve hours, or a comparison that left no task untied), investigate it on a snapshot while it runs (`scripts/wri2p2.ts`), plan and implement what it found as one pull request on the top, and fork fresh runs at that head; land the release once a proof run at the top promotes twice. Inside the cycle each pass scores the five points, finds the link that holds the next promotion, fixes its owner, proves the path and predicts. Use when the operator asks to keep campaigns going, fork runs, work towards a release, run a pass or an hourly audit, read a promotion, investigate a campaign that is not promoting, or choose the next run. Owns the experiment and its evidence; AGENTS.md section 3 owns the operator's decisions."
---

# Run improvement campaign (the Super Loop)

Three loops, each inside the one before. The **release cycle** gathers the stack's pull requests
and lands them as one release on the operator's word, once a proof run at the stack's top has
promoted twice at one commit. Inside it, each **iteration** (WRI2P2, "The iteration" below) takes one fresh run that reached its
trigger, investigates it, vets, plans and implements what it found as one pull
request on the top of the stack, and forks fresh runs at that pull request's head, so the next
iteration measures the fix. Inside that, each **pass** is **score → walk → choose → prove →
predict → launch → watch → read → decide**: it asks what stands between a campaign and its next
promotion, fixes that link's owner, and leaves the fix to be measured by later runs. One pass
answers one question.

**Only a fresh campaign counts.** Follow `AGENTS.md`, section 10, item 9: open from a prompt, start
with the starter, and continue at the opening commit to a typed ending. Seeds, stored packs and
continuations at another commit prove paths and show no climb. The milestone belongs to the plan, as
factor 1 explains. No campaign seat is given a number of promotions to reach.

Honesty is not traded for climb. A more permissive level, a reused solve, a held-out task that
crossed the wall or a target told to the Examiner cannot establish a gain of the harness.

## The release cycle

A cycle runs on the operator's word for it ("work towards 0.6.4"), which covers its runs, their
stops and its patches, and its landing, release and next runs only where the word names them:
merging is the operator's (`AGENTS.md`, section 11). Record each grant and each decision still open.
Keep the cycle's ledger, `cycle.md` (each iteration's own plan is its `plan.md`), in one local file beside the handover, on the central host, the one machine
that keeps every cycle's files and gathers every host's records: the word, the threshold, the
reviews, and a log line per step. Every step below reads that file first.

**The order is fixed, and nothing moves a step ahead of the one before it:**

```text
iteration:  predict → fork at the top → run (2 promotions or 12 hours) → investigate → vet → plan → implement (one PR on the top) → prove → predict → fork at its head → ...
release:    proof run at the top to 2 promotions, unchanged → three reviewers → consolidate → land and release on the operator's word → fork at the release
```

### The iteration (WRI2P2): one run's trigger, one pull request

WRI2P2, the Whole Run Improvement Implementation Plan StackedPR Protocol (the operator's name:
two I's and two P's), is the whole sweep from one run's investigation to a stacked pull
request and a new run. The operator's protocol: "Repeat the protocol more and more
once 2-promotions come in of launching and improving, stack PR per fullRun Improvement iteration
(Plan + Implementation after WRI)", and the fresh runs after it are launched without asking ("you
can autonomously launch new runs after" it). One script reads where every run and every iteration
stands and prints the one step next, with its command:

```sh
bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts [<part> ...]   # every run moved in two days, and its step
bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts open <name>[,<name>]
bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts next <dir>
```

It reads every host's runs from the copies the central host's ten-minute gather keeps, so it asks no
host and needs no env file. It writes nothing but an investigation's files, through `wri.ts`; it
stops, launches and merges nothing. The whole-run investigation stays a tool of its own
(`wri.ts`), for a question that is no iteration.

1. **The trigger**, whichever comes first (operator): two promotions, twelve hours since
   the opening, a comparison that left no task untied ("they likely won't promote so that's a bit
   ironic that we need to wait"), or an ending after a comparison. The trigger stops nothing and no
   run carries a cap: each promotion alerts (`runs alerts`), and a run is paused on the operator's
   word after that promotion's starter comparison reports (`AGENTS.md`, factor 1). Resolve every row
   of the run's `predictions-<run>.md` whose event exists into its `outcomes-<run>.md`, and keep
   its `still-missing-<run>.md` (step 1 of the running window).
2. **Investigate** it with whole-run-investigation, opened by `wri2p2.ts open`, with the other
   triggered runs of the same code and pack as equals where there are any. `open` writes
   `iteration.json` into the investigation's folder (`{ "opened": <ISO>, "runs": [<names>] }`), and
   the gates below hold only a folder that carries it. A live run is read on a
   frozen copy (`wri.ts start --snapshot`) and goes on: stopping one is the operator's (`AGENTS.md`,
   section 3), and a run that will not promote is not stopped for its investigation. Then
   `wri2p2.ts next <dir>` at each step: the two blank sections, `lanes --agents 4`, one subagent a
   lane session (it prints each one's line), the collection and the synthesis. Before the vetting,
   `next` holds the iteration until each run it reads has its three files (step 1 of the running
   window), so each iteration shows whether its predictions were handled and what was left out. It
   looks for them only in `*-cycle-*` folders and the investigation's own, and refuses where two of
   them hold the same file.
3. **Vet, read across domains, then plan** (steps 6 and 7): `vetting.md`, `cross-domain.md` and
   `plan.md` in the investigation's folder. A fix found in one domain's run lands in every domain,
   so between the vetting and the plan one read-only subagent reads the vetted investigations of the
   other domains, the newest 5 to 10 and none from before the previous minor release (at 0.10.x,
   from 0.9.0 on). It writes `cross-domain.md`: for each confirmed problem, whether those domains
   show it and what differed where they do not, and whether an earlier investigation already fixed
   it, so a fix that did not hold is named as one; for each candidate fix, what it changes in each
   domain and how to keep that intact, with the cheapest test that would settle it. A plan row
   whose fix would move another domain names that domain's line there. The plan holds repairs and tunings: read [the levers](references/levers.md) against the binding
   link, and give each lever the run's evidence selects a row, tuned or kept with one checkable
   sentence. `plan.md`, linked from `cycle.md`, names `cross-domain.md`, each confirmed vetting row
   by its id (`vet-<n>`, such as `vet-3`) in a row or under `## Not done`, and at least three lever ids of
   `references/levers.md` (`E1`, `B2`). A row the operator must decide is asked now, and
   implementing goes on around it.
4. **Implement the plan as one pull request** on the top of the stack (step 8), with each row's
   hostile test, proved with `bun run land -- <top> --sanitize`, and name it in `plan.md` on a line
   of its own, `Pull request: #N`, which `next` reads. One iteration is one pull request, so a
   later reading can name the fix it measures. A row whose label an open pull request of your own
   already carries goes there instead, and the iteration's pull request names it.
5. **Predict, then fork at that pull request's head** (steps 1 and 2, with the top in place of the
   release), `--as forkedPR<N>`, by which `next` finds the runs that measure it. Each run's
   `predictions-<run>.md` is written before its `runs fresh ... --yes`, under the name the fork
   will give it, which the dry run of `runs fresh` (without `--yes`) prints. A fork's
   `predictions-<run>.md` holds a section `## Carried` that names each id its parent iteration's
   runs did not hold, as `<parent run>:<id>`, and links `still-missing-<parent run>.md`. The slot an ended
   run held goes to a fresh run at once, on the host and login with the most room under their caps.
   A slot free with no iteration to measure is filled at the current top too: capacity left idle
   measures nothing.

`next` names the steps in this order: `open`, `instruct`, `lanes`, `reports`, `isolated`,
`synthesise`, then for each run `predictions`, `outcomes`, `still-missing` and, for a fork, `carry`, then
`vet`, `across`, `plan`, `implement`, `launch`, `forks` (each fork's own `predictions` and `carry`)
and `done`. A folder without `iteration.json` takes the shared steps alone, as before the per-run
ledgers. Every gate but `done` is a default to deviate from with a recorded reason, never a wall
(operator: "to-be-deviated-from each time"): a row of `deviations.md` in the investigation's folder
(`| step | reason |`, the step alone or as `<step>:<run>` for one run) with a reason passes that
step, and `next` prints `deviated: <step> · <reason>` beside the step it reaches.

Iterations overlap. A second run can reach the trigger while the first's pull request is being written;
it starts its own iteration, and each pull request stacks on the one before. Nothing in an
iteration is merged: the release does that (steps 9 and 10).

A run is evidence about the code it ran (`AGENTS.md`, section 9), so a run left going while its code
is investigated measures code that is about to be replaced, and a release landed before the
investigation is read ships without what the investigation found. For example, v0.6.4 was landed
and six runs were forked on it while the investigation of the runs before them was still being read;
the operator stopped five of the six 20 minutes later, and the investigation's one patch became
v0.6.5. A deadline does not reorder the steps: where the investigation cannot be read in time, tell
the operator and ask, rather than land first.

### The running window, until two promotions or twelve hours a run

1. **Predict in `Predictions.md`**, a file of its own beside the cycle's `cycle.md`, written before
   step 2's `runs fresh ... --yes`: a fresh campaign makes its first solve minutes after it opens,
   and a row written after that is a description (section 3). The file holds one row for **every
   pull request merged since the last cycle's fork**, which the release note lists ("Includes N
   PRs from #a to #b") and `git log --merges <last fork>..<release>` confirms. A row's labels are
   its pull request's, which `bun run land` requires, and its lanes are those labels' lanes whose
   triggers read its events (whole-run-investigation's `references/lanes.md`, "Labels"; none for a
   label with no lanes). Where a row needs a lane outside them, the label is wrong, and the pull
   request is relabelled. Its group is `first` for code the runs are the first to run, `again` for
   code an earlier run ran under another condition, and `off-run` for tooling or text no seat
   reads, whose falsifier names what settles it instead (the next landing, a reader, the launch).
   A pull request without a run-side reading still gets its row.
   **One folder a cycle**: `cycle.md` and `Predictions.md`, spelled so, live together in
   `.ana/wri/<YYYY-MM-DD>-cycle-<release>/` of the central host's main checkout,
   dated by the fork and named by its release (`<YYYY-MM-DD>-cycle-v073`), beside the cycle's
   investigations. One ledger covers every run of the cycle, and an investigation of several runs
   reads it whole, so it is never copied into a run's or an investigation's folder: `wri.ts index`
   lists each recent run with the ledgers and investigations that name it. It goes in neither
   `notes/` nor `data/`: `data/runs/` and `data/derived/` belong to `runs fetch`, `retire` and
   `derive`, which replace a campaign's folder whole, so a file put there is lost at the next
   refresh. The file has three tables:

   ```text
   | id | PR | labels | lanes | group | claim, as a count | falsified by |
   | id | claim, as a count | lanes | falsified by |            (cycle-wide: supply, climb, honesty)
   | id | held, falsified, unreached or pending | event or count | time |   (Resolutions)
   ```

   The cycle-wide predictions are rows of the second table. A peer session's ledger for the same
   runs is read and linked, not repeated.
   **Each run keeps three files beside it**, in the same folder: `predictions-<run>.md`, written before
   that run's `runs fresh ... --yes`, holds the rows the run settles (the first table's rows its
   code runs, and its own, in the first table's columns), and `outcomes-<run>.md` holds one row for
   each prediction id and no other, in the Resolutions columns, written as each event lands and
   closed at the run's ending. An outcome is `held`, `falsified`, `unreached` or `pending`, the last
   only while a live run's event has not come. A third file, `still-missing-<run>.md`, names what
   the run still lacks: every id whose outcome is not `held` and each problem it shows that no fix
   holds yet, with where it is carried. Its section `## Intentionally opposed` (at least one line;
   `none` counts) names what stays missing on purpose, each as a
   trade-off: what leaving it out buys, what it costs, and why, from a trade-off of `AGENTS.md`
   section 1, a principle or the operator's word. A gap left by design is then never read as one
   forgotten, and the next iteration sees which trade-offs it inherits. `Predictions.md` links
   each run's three files, so the cycle reads whole from one file and each run from three.
   Every review first checks that `Predictions.md` and each run's `predictions-<run>.md` exist.
   Where one is missing, the review writes it before anything else, marked as written after
   launch, with the run's solves at the time of writing.
2. **Fork at the release**, once step 1 is on record. Take the commit the last release merged (`git
   tag` of `main`), or, inside an iteration, the head of the pull request it opened ("The
   iteration" above; the operator's word). A pull request above it that changes code a
   campaign runs need not hold up the fork; name it. Fork **one fresh campaign per runner host**,
   or the set the operator names, so each runs on a host no other campaign loads:
   `runs fresh <pack> --host <host> --at <commit> --login N --as <suffix> --yes`, after a dry run
   without `--yes`. Take the host list from `ANA_HOSTS` through `hostsOf`, never from a machine
   list in a script. The backend prepares each peer's controller at the commit; the login must
   already be available there. This explicit override belongs to the isolation condition; read
   `runs hosts --health` before selecting idle hosts. Ordinary forks omit `--host` and `--login`:
   `fresh` prefers the pack's prior eligible host and chooses a login below its fleet cap. Several
   packs sharing their flags can use one fresh batch. Launch the hosts one after the other: two
   `fresh --host` launches sent at once from one checkout have both exited 1, and each
   passed when run alone. Fresh performs the fleet login admission before each launch. Tag
   `run/<name>/1` at the commit and push the tag.
3. **Read the runs** with `scripts/wri2p2.ts` (above) at every review and at every milestone,
   and resolve each prediction the hour its event lands: a run's rows in its `outcomes-<run>.md`,
   the cycle-wide rows in the ledger's Resolutions. A defect seen
   live is noted for the plan of step 7; the run
   is not stopped to fix it (`AGENTS.md`, section 10, item 6).

### The improvement window, in this order

Steps 4 to 9 share one window of **twelve hours** from the last stop (operator): stop,
investigate, vet, plan, implement and consolidate, so the stack is proved by its end. Step 10 waits
for the operator's word to land. Where a step cannot finish inside the window, say what is left at
its end, and carry on in the same order; the window gives no step a reason to skip the one before.

4. **Stop** each run past the threshold on the operator's word, with `runs stop`, naming its host
   (`runs on <host> stop`), since two hosts may hold one name; one the operator keeps, such as an
   ablation, goes on and is read on a snapshot (`wri.ts start --snapshot`). A stop word
   (`tools/d2/word.ts --stop`) waits for the next move boundary, which inside a led campaign can be
   an Examiner session of an hour or more: two words once had not acted 20
   minutes later. A stopped run's log stays where it is. Resolve every prediction whose event
   exists, and mark the rest unreached, so its `outcomes-<run>.md` has a row for every id.
5. **Investigate** the stopped runs as equals with
   [whole-run-investigation](../whole-run-investigation/SKILL.md): start, lanes, collect, the
   isolated lanes 4 and 15 where their triggers and the reports call for them, then the synthesis.
6. **Vet** the synthesis: check each finding against the logs and against the head (a fix may
   already be on the stack), and mark it confirmed, plausible or refuted (whole-run-investigation,
   "Vetting"). Backtrack every row of `Predictions.md` and of each run's `predictions-<run>.md`
   there first, beside its row in `outcomes-<run>.md`: recount it from the logs,
   triage and vet each falsified row as a finding, and carry each unreached row into the next
   cycle's ledger. Sorting a finding by owner is triage, and checks nothing. A finding whose
   behaviour `AGENTS.md` documents as intended is an operator decision, not a defect: ask it then,
   with the evidence and a recommendation.
7. **Plan.** One row per confirmed finding, falsified prediction and defect seen live, each with
   its owner, the hostile test that fails without the fix, and the before-and-after it needs; the
   rows the operator must decide are asked now. Keep the plan in `plan.md` in the investigation's
   folder, linked from `cycle.md` (step 3 of the iteration).
8. **Implement** every row on the top of the stack through stack-pr, with its hostile test, or a
   line under "Not done" in the release. A peer session's open pull request is never changed; stack
   above it. Each patch is also simulated before and after (system-path-simulation,
   `cases/before-after.md`): its commit against the commit beneath it, on the same logs or the same
   seed cut from the run that showed the defect, at the smallest layer that shows it. A change to
   what a model seat reads, which one draw cannot read, is tuned in rounds of pairs
   (`cases/optimize.md`). The pull
   request states what moved against what was predicted. A fix is measured by the next cycle's
   runs, never by the runs it was found in. When a Codex swarm implements the rows, the primary
   commits what its sandbox cannot (no nested verifier wall, no git directories), stacks the patches
   with `git apply --3way`, folds later fixes into their commits, and runs the composed CI gate on the
   top, which found an interaction every commit had passed alone. A patch that rewrites the scheduler
   and changes the counting rule of the runs launched next is deferred, with its reason in the plan,
   until a recorded reading is shown to flip on it.
9. **Consolidate the open stack** before it lands, from the order its fixes were found into one
   structured by subject: review it in groups of related pull requests,
   fix what the reviews confirm in lanes, regroup related pull requests into one, publish, and
   prove it with `bun run land -- <top> --sanitize`. Its mechanics, and the word it needs, are
   stack-pr's section 10, "Consolidate the stack".
10. **Land and release.** `bun run land -- <top>` proves every commit; `--merge --tag v<x.y.z>`
   waits for CI, merges the native stack and cuts the release at the merge, with the notes GitHub
   generates. Then rewrite the notes as stack-pr section 9, "Release notes", sets out.
   Where the proof fails, do not land: report the commit and step.

   **A run proves the release, and `--sanitize` does not.** `land` proves that each commit passes
   its checks. Whether the stack still climbs takes a run. So a stack lands only once a fresh campaign
   launched at the top's head has reached **two promotions** with its code unchanged throughout
   (operator: "we need at least two promotions to merge it right (unchanged during the
   run) now that we're getting more serious").
   Four conditions decide whether that run proves the landing:
   - **The commit, unchanged.** Every launch in `bun run runs source <name>` names the top's head, or
     a commit whose `src`, `vendor` and `package.json` match it (`git diff --stat`), each with a clean
     tree, and `wri.ts read` row C names one host code. A run continued at another commit proves
     neither commit.
   - **The mechanisms ran.** Each pull request that changes a run's conditions shows the event its
     mechanism writes in that run's log (`AGENTS.md`, section 9, "A mechanism"). A pull request
     whose trigger never came is named as unmeasured in the release notes.
   - **No defect ending.** The run reached its second promotion with no `environment` ending and no crash. A
     credit or session limit is no defect (rule 15): continue it at the same commit.
   - **Nothing above it.** A pull request published above the run's commit is not proved by it. Land
     the proved top by its number and leave the newer one above. A pull request that changes what a
     seat reads waits for its paired round of seats first (system-path-simulation, `cases/optimize.md`),
     then for a run of its own. For example, #601, a draft rewording the seats, was stacked above
     v0.9.3's proved top before its round.

   The release notes name the proof run, its commit and its two `harness.promoted` events.
   A smaller release needs one such run at its top. A major release carries one big change and its
   own run.
   One cycle is one stack and one release (`AGENTS.md`, section 11), and the number tells a reader
   which runs may be read side by side. The patch moves (0.7.2 to 0.7.3) where the cycle's runs
   measure what the last release's runs measured. The minor moves (0.7 to 0.8) where the release
   changes what a run measures, such as a weight, the level, the step test, the task admission or the
   setting: the release says which, and no run of the earlier minor is read beside one of the new.
   The major moves only on the operator's word, for a break in the design.
11. **Predict and fork** the next cycle at the release's merge commit: steps 1 and 2 again.

**The threshold.** No run carries a cap on promotions. Each promotion alerts (`runs alerts`), and a
run is paused on the operator's word after that promotion's starter comparison reports, since a pause
before it leaves the promotion unconfirmed for good. **Two promotions** remain the trigger for
investigating a run, and stop nothing, and no hour stops a run either: one goes on until the operator
pauses it or it reaches its own ending. `--promotions N` stays an available flag (run-management).
`scripts/wri2p2.ts` names the step `open` at the threshold (`--promotions`, `--hours`), and times a live run to now, so a run in a long
wait still reaches its hours. The running window ends when every run the cycle stops has ended. The
#306 forks
reached their first promotion at 11.9 and 14.4 hours after their opening and their third at 17.8
and 19.1 hours (`wri.ts start`, lane 22); no run has yet been timed to its sixth. The A/A of every promoting
reading should read no step; the release says where one did. No seat is told the threshold and no
campaign stops at it (`AGENTS.md`, factor 1): the cycle pauses or stops the runs.

### The script: `scripts/wri2p2.ts`

The cycle's state is read by one script, the iteration's ("The iteration" above), so a review or a
timer is one line and nobody reads the runs by hand to decide the step. Its rows hold the host,
live or closed with its ending, promotions, comparisons and hours since the opening, and then each
run's step: `run`, `open` with the trigger, or the step its investigation has reached.

The cycle's reviews start from the pulse's lines (section "Timers"); each runs the script and takes
the step it names: at M1 after the fork, then at each run's comparisons and promotions, and
from `open` on, at each step it prints until `done`. Each review
may move the plan forward within the order above, and add, move or delete the cycle's own timers to
reach its goal.

## Resume

Read the operator's local handover where one is kept, then read the current evidence:

```sh
bun --env-file=.env.runs run runs status     # every run on this host and each host ANA_HOSTS lists
bun run runs pulse                    # open runs and endings since the last look
bun run runs view <name>                     # comparisons, climb and the table's next move
bun run runs source <name>                   # each launch's commit and whether it was clean
bun .claude/skills/stack-pr/scripts/stack.ts   # the open stack and its top
bun tools/wri/wri.ts read --log <worktree>/.ana/d2/<name>/log.jsonl
```

`status` and `pulse` ask every host `ANA_HOSTS` lists. WRI accepts campaign names from any host and
refreshes their copies automatically when invoked with the host environment loaded. `0 open` where a
campaign was launched calls for reading its ending. Use `AGENTS.md`, section 3, for the operator's
decisions and the authority a campaign launch gives once. Record continuing authority in the local
handover; the newest instruction governs it.

Read with source that knows the log's event kinds. If an older reader refuses or falls quiet, read
again from the current source before concluding that a signal is absent.

## The five points

Open and close each pass with these rows for each campaign. Say which point the pass moved.

| # | Point | Question | Read it from | Bar |
| --- | --- | --- | --- | --- |
| 1 | Climb | how many promotions from a fresh opening | `runs status`, `runs view`, the closing report's "Promotions" | `AGENTS.md`, factor 1 |
| 2 | Honesty | could a promotion be chance or drift | each report's `noise`; the closing report's "The chance of a false promotion" | the A/A comparisons and risk over every attempt |
| 3 | Supply | are there informative tasks | the campaign's `--dry-run`, the view's set-up line, `task.gate` | `AGENTS.md`, supply condition; admission also needs `comparisonFloor(level)` frontier tasks, a sweep plus two |
| 4 | Verdicts | does a person agree with the Referee | `tools/d2/settle.ts` | `AGENTS.md`, factor 3 |
| 5 | Economy | what each promotion cost | the closing report's "Work and spend", `promotionsWorth`, `worthLine` | at most three promotion attempts an epoch after set-up, unless the opening names another cost bar |

One line per campaign carries its worktree, opening commit, promotions, comparisons since the last
promotion, milestone, A/A results and dollars spent of its total. Read the closing report with:

```sh
bun tools/d2/close.ts --name <name> --to <scratch dir>
```

Point `--to` outside the repository, or under `data/harnesses/` of the main worktree, where a
campaign `runs fresh` launched writes its own at its end. Without `--solve`, this writes a handover
and runs no solve.

To read this cycle's runs against the last cycle's, or a live run against the finished ones, use
promotion-tuner's `scripts/table.ts`: `--rows recent` for the live runs beside the latest that
promoted, `--rows groups` for time to the first promotion, hours and dollars a rung, room on
validity, steps won by validity and confirmed promotions by release, pack and setting. Read the
room first: the hours of a cycle with none say nothing of ability. Supply binds before a comparison can say anything; economy reports and refuses
nothing.

A different level, target or number of solves a side changes what the instrument can show. Name that
change separately from a gain of the harness. The level and everything a solver is given belong to
the operator.

## The promotion chain

```text
prompt → Examiner drafts exam → host reads it → contract.frozen
Examiner drafts tasks → shape check (propose_tasks) → held out
                     → a bad package or a planted answer → refused
Builder practises and edits → comparison.reported: step → harness.promoted
                            → new epoch → Examiner writes for the new reference
```

Task admission uses `informative` in `src/kernel/compare.ts`, as the comparison does. A task leaves
room where the reference answers some solves, answers none while a valid answer is on record, or has
a valid answer beaten by a recorded objective measure. All reference solves passing therefore does
not by itself close a task. `AGENTS.md`, section 7, owns the full scoring procedure.

## Milestones: what to read, and when

Read each milestone the hour its event lands. Put the next prediction on record before the work it
predicts. Quiet between milestones is read against the limits of the work in flight.

| Milestone | Event | Read | Prediction it settles | Investigation |
| --- | --- | --- | --- | --- |
| M0 opened | receipt and `campaign.opened` | `runs source`: one commit, clean; fresh opening under section 10, item 9 | ledger written before the first solve | none |
| M1 exam | `exam.drafted`, `checker.read`, `contract.frozen` | faults by kind, `doNothing`, `admitted`, read when `contract.frozen` lands; a draft still open an hour after M0 is a lead to read, not a fault | frozen before `build.started` | none; assign an `exam` ending from its faults |
| M2 supply | first Examiner sessions' `task.gate` | held and refused by reason, objective gap, missing readings, dry run | held out of drafted, a range | none |
| M3 first reading | first `comparison.reported` | `valid.informative.old`, tested untied and tied, `scored.detectable`, A/A, load | reading and untied count | only if a `read` trigger fires |
| M4 step | `comparison.reported` with `reading: step` against the reference | tested margins, the retained tally apart, A/A | untied count and A/A result | none |
| M5 promotion | `harness.promoted` | supporting reading, untied tasks, A/A and campaign risk; `wri.ts climb --log <log>,<peer>,<peer>` | write M6 prediction now | first promotion, once M6's first Examiner session has ended |
| M6 next epoch | first Examiner session and first comparison after M5 | drafts held and refused by reason, frontier and retained sizes, objective gap | held out after M5 against before it | lane 22 with standing lanes, when owed at M5 |
| M7 ending | `campaign.ended` | ending kind, closing report, resolve every prediction | every open row | full investigation where the campaign promoted or an early ending raises an unresolved question |

An investigation follows its event and waits for a comparison's `comparison.reported`. Open it for
a question the readers cannot settle, a reading in doubt or an unclear failure owner. A timer alone
raises no question. A second promotion reopens lane 22 only where `wri.ts climb` shows something the
first did not. For an ending other than improvement patience, report "reached N promotions; further
improvement unresolved" (`AGENTS.md`, factor 1).

**A stall** is a campaign whose milestone has not moved while it bills. Report it with its milestone
and leave it running. Read an ending by its recorded kind first: credit and session limits follow
`AGENTS.md`, rule 15, and are no defect to fix. To act on a proved stall:

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

Start from the milestone: M1 points to link 2; M2 and no room to links 1 and 3; a retained loss to
7; a near miss to 5; promotion to 8. Walk from the first link and stop at the first failure. Links
1, 2 and 6 limit what the reading can establish.

| # | Link | Point | Holds when | Evidence |
| --- | --- | --- | --- | --- |
| 1 | supply | 3 | enough scorable frontier tasks remain for `comparisonFloor(level)` | dry run, set-up line, `task.gate` |
| 2 | instrument | 4 | exam stands and rejections have rulings or labels | `checker.read`, `contract.frozen`, `referee.finding`, tasks set aside |
| 3 | reference's room | 1 | the report finds informative tasks for the reference | `valid.informative.old`, `roomOf` |
| 4 | session | 1 | Builder practised and changed something the solver uses | `build.*`, `harness.version`, practice verdicts |
| 5 | size | 2 | the tested set has enough untied tasks and power at its margins | `scored`, `scored.unsolved`, `scored.detectable` |
| 6 | host | 2 | solve-start loads are read, including changes within a comparison | `HOST LOADED`, `LOAD MOVED`, `campaign.waited` |
| 7 | promotion | 2 | comparison against reference reads `step` | `step` row, `harness.promoted`, `noise` |
| 8 | next epoch | 1 | Examiner writes for the new reference and the tasks leave room | `harness.promoted`, subsequent `task.gate` and comparisons |

Read room by `informative`, rather than a target pass share. `noRoom` in `src/campaign/decide.ts`
requests an Examiner session after promotion even where the promotion's comparison leaves room. Lane
26 of [whole-run-investigation](../whole-run-investigation/SKILL.md) reads a campaign's chain; this
walk chooses what to do about it.

### What each link reads as, and its owner

1. **Supply:** rows `tasks` or `short`, too few scorable tasks, refused drafts. Owners:
   `systemPrompt` and `firstMessage` in `src/examiner/prompt.ts`, `heard` in
   `src/examiner/record.ts`, `propose_tasks` in `src/examiner/write.ts`, or `--exam-tasks`.
2. **Instrument:** an `exam` ending, checker faults, check-defect stops or tasks set aside.
   Owners: `planOf` in `src/campaign/opening.ts` and `readChecker` in `src/kernel/acceptance.ts`
   for a host fault; otherwise the check program's author. Follow `AGENTS.md`, section 3, for
   admissions and labels.
3. **Room:** row or ending `no-room`, zero `valid.informative.old`. Owners: tasks through link 1,
   with `roomOf` in `src/kernel/reports.ts` deciding the reading. A campaign has one budget.
4. **Session:** unchanged `build.finished`, idle conversations, every practice solve passed,
   or a change the solver never uses. Owners: `systemPrompt`, `SAID`, `firstMessage`,
   `continuation` and `usedLine` in `src/builder/prompt.ts`; `campaignStatus` and campaign tools in
   `tools/d2/campaign-actions.ts`; `idleOf` in `tools/d2/campaign-terms.ts`; session and practice terms.
5. **Size:** many ties, a near miss, or a high `scored.detectable`. `detectable` is the
   least winning share detected four times in five at these margins, in hundredths. It is power,
   not another threshold for the observed tally. Owners: `--target` in the next fresh
   campaign; `settingAsked` fixes the recorded target. The lasting cure for ties is link 1.
6. **Host:** `HOST LOADED`, `LOAD MOVED`, long waits or rising wall-ended solves. Read load before
   blaming the harness. Owner: the number of campaigns on that host; use the launch load rule.
7. **Promotion:** `no-step` near the level, a retained loss, or an A/A step. Owners: supply and
   size first. One `step` promotes (`stepOf`), its one test over the frontier and the retained
   tasks together, cleared on the scores; in an older log a
   first reading could buy a repeat, and the
   retained tasks were a second test that could read `regressed`. No retained task tallied is
   `unmeasured`.
8. **Next epoch:** refused drafts, idle conversations or few frontier tasks after promotion.
   Read `make` in `tools/d2/harness-builder.ts` and `campaignStatus` in
   `tools/d2/campaign-actions.ts`, then `ROWS`
   in `src/campaign/decide.ts`: its `build` row first releases owed practice (`practice`).

## 1. Choose one change, aimed at the next promotion

Choose from a recorded failure, wasted work or an open decision. Name the link, point, owner and
falsifier before writing code. Change the owner as far as the evidence carries: a prompt, tool
result, admission, table row or term. When an interface failure recurs, fix its schema, tool or
facts.

Read the producer, consumers and tests first. Prefer deleting a competing owner, then reusing the
existing one, then adding the minimum. A term needs flags rather than code: read the owning
command's options, including `tools/d2/round.ts` for session and comparison terms. Follow
[stack-pr](../stack-pr/SKILL.md) and the repository's delivery rules for source changes.

Use `AGENTS.md`, sections 2, 3 and 8, for design bounds, operator decisions and the wall. Bring a
decision with evidence and a recommendation ready, and continue independent work. After two
comparisons miss alike, or a prediction fails, walk the links again before choosing another change.

## 2. Prove the path before spending

[system-path-simulation](../system-path-simulation/SKILL.md) chooses the smallest real layer:

- **Dry run:** `bun tools/d2/harness-builder.ts --name <name> --dry-run`. Read the table's move
  and the facts it used. The launcher runs this before launch too.
- **Replay:** `bun run runs replay [<name>]` reads registered campaign logs through this tree's
  readers, without provider cost. For a changed admission or table,
  also show what it would have held out or named at the relevant milestone.
- **Rehearsal:** `bun run runs seed --from <campaign folder> --name <seed>`, then
  `bun run runs rehearse` over the seed. Scripts replace the working seats; no Referee runs, and
  an Examiner is scripted only over a drafted exam. Use `--campaign` for a campaign path.
- **One exam, two commits:** a fresh campaign drafts its own exam, so two fresh campaigns of one
  domain differ in their exam as well as in the change. For a mechanism that acts after the
  freeze (the Builder, the table, the comparison, the Examiner's writing), seed one finished
  campaign cut at its `contract.frozen` (`--events <its line>`) into a worktree at each commit,
  and run each seed on the source's launch flags (its `launch-run-1.json`), dry run first. Both
  arms hold one contract, one check program and the draft's tasks, and write the rest themselves.
  For example, a drafted ESP32 campaign cut at 21 of 2,387 events dry-ran at the stack's top with
  its log unchanged and named holding the drafted tasks next. The seed keeps the source's opening
  terms, its reserve included. Its promotions are no climb (`AGENTS.md`, section 10, item 9) and
  each arm is one stream, so the result is a lead for a fresh run, never a step. Each arm is a paid
  run and takes the operator's word.

For model-visible text, render and read the whole composed surface. Check for duplicated facts and
whether a literal reading can finish within its limits. A test double proves its interface; better
model behaviour needs the fresh campaign's real milestone, read against its prediction.

## 3. Put the prediction on record

The campaign command takes no `--predict`: its comparisons are the Builder's to request. Keep a
ledger outside campaign folders before the first solve, naming campaign, commit and milestone. In a
release cycle that ledger is the cycle's `Predictions.md` (step 1). A comparison made by hand takes:

```sh
bun tools/d2/checkpoint.ts <flags> --predict "<one sentence a count can settle>"
```

Use counts: "`contract.frozen` before `build.started` ", "`x-1` holds at least three drafts", "the
first comparison unties at least six tasks", "the A/A reads no step". Each row names its link and
falsifier. Include one row about the link and one about honesty. Resolve each as held, falsified or
withdrawn, with the event that settled it. A prediction made after work began is a description; say
so.

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
bun run runs pulse [<name>]
```

Read at each milestone and at the timer's predicted moment.

- A missing terminal event alone shows no stall. Solves can record `solve.turn` and `solve.call`
  before their verdict. Read quiet against the solve's deadline and the session's `--minutes`.
- A receipt's process gone before an ending calls for reading its `.err`. A log that stopped
  growing is a lead, not a process check.
- Read a quiet run's last event before naming its state. A `status` row saying "solving" or
  "working" hours after its last event is usually a `campaign.waited` naming its reset. An
  `environment` ending under a live keeper is a pause, not an end. Both have been misread:
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
[whole-run-investigation](../whole-run-investigation/SKILL.md) for a doubtful reading or failure
owner.

**A step is one draw.** Give the supporting reading, its untied tasks and margins, the retained
tally apart, A/A and campaign risk. A near miss buys no repeat. Use `scored.detectable` and the
margins to size the next comparison; a tally alone does not fix its power.

**Two runs side by side** compare the system at two commits, never two harnesses: each run drafted
its own exam (`AGENTS.md`, section 9). Match them by **active hours**, then check the match against
dollars billed and comparisons reported. Elapsed hours mislead, because runs sit in provider waits,
outages and stopped stretches for different lengths of time. Active hours are the time between
consecutive events, leaving out:

- any silence over ten minutes;
- every recorded `campaign.waited`;
- every stretch that ends in a `provider` non-result or an errored model turn before anything
  productive happens.

For example, r5 and r6 read 16 elapsed hours and 7.5 and 9.4 active hours: a DNS outage had failed
their solves as `provider` non-results for four hours. Name each setting the runs differ in (limits,
objective rule, promotion rule) beside the comparison. No reader in the tree computes active hours
yet, so give the script with the counts.

## 7. Decide

First say what happened to the link:

- **lifted:** the link moved and the chain followed. Walk again.
- **held:** the link moved but the chain did not. Walk again from that link with the new counts.
- **unreached:** the change never moved its link. Repair its path and containment before choosing another.

Choose one move. `decide` in `src/campaign/decide.ts` advises accept, prepare, examine, build,
compare, promote or end. A led Builder chooses its tools; code keeps admissions and scoring, and
`make` (`tools/d2/harness-builder.ts`) makes comparisons and promotions between conversations.

The stop rule counts since the last promotion (`stopRule`, `src/campaign/admission.ts`). A changed
harness/reference pair counts once when tallied with room or a step; a whole unchanged session
counts only where practice failed. A step shows gain. Starter comparisons, unscored comparisons and
non-step readings without room do not count. Improvement patience defaults to six (`PATIENCE`);
supply patience (`roomless`) uses the same limit for failed attempts to obtain tasks or room. Budget
and other endings remain distinct.

If the pass disagrees with the table, give the counts it cannot read. The loop's own moves are: fix
one owner and launch fresh, change one term and launch fresh, delete an unread mechanism, or
investigate a consequential ambiguity. Launch only within the operator's authority.

Close in the handover: five points, milestones, worktrees, commits, last readings, predictions, link
and result, decisions waiting, and next command. Keep negative results and their limits intact; name
each claim's evidence level from attribution-and-proof.

## Timers

For authorised unattended work, keep timers, their authority and one ledger row per firing in a
local file beside the handover. Timers arrange this procedure; they add no campaign scheduler.

### Every firing: one protocol

Every firing of every timer takes the same five steps, in this order. The order and the records are
fixed; what the session reads, which reader or lane it opens, and what it concludes between the
steps are its own judgment, held to the evidence and to recorded authority.

1. **Read the state.** `cycle.md`, `Predictions.md` beside it with each run's three files, and
   `scripts/wri2p2.ts` over the cycle's runs. Where `Predictions.md` or a run's
   `predictions-<run>.md` is missing, write it first (step 1 of the cycle).
2. **Resolve the predictions.** Each row whose event has landed or whose deadline has passed is
   `held` or `falsified` in its run's `outcomes-<run>.md`, or in Resolutions for a cycle-wide row,
   with the count from the log that settles it and the time; a row of a live run whose event has not
   come is `pending`, and one whose trigger can no longer come is `unreached`.
   A written resolution stays; a recount that disagrees adds a row beside it. A falsified row opens
   a triage row.
3. **Act.** Take the step `wri2p2.ts` names, within the cycle's order and the recorded authority
   for launches and stops, and read any milestone that landed (section "Milestones"); investigate
   after the event, never before it. Keep one triage list, rewritten each
   pass: problem, link, event or count, how found, and status, ranked by the first failed link and
   then by the number of runs showing it. Check a row against log and source, and prove it with a
   replay or rehearsal that passes its link.
4. **Re-arm.** Add, move or delete timers toward the cycle's goal (operator). Arm a
   one-shot at the next event a run's log predicts: for a comparison, scored tasks × solves a side
   × 2 × median solve minutes, divided by concurrent solves. Once every run the cycle forked has
   its `campaign.opened`, arm one one-shot for each row of the predictions whose claim names a time
   ("within 14 hours of its opening", "by 24 hours"), at the latest opening plus that time, so one
   firing reads every run. A one-shot that a later reading made early is re-armed, and a replaced
   timer is deleted by its id.
5. **Log.** One Firings row in `cycle.md`: the time with its UTC offset, what was found, the rows
   resolved, whether the firing was useful, when it should have fired, and each timer change. Speak
   to the operator only when a milestone landed, a run stalled or ended, or a prediction resolved;
   otherwise stay silent.

At step 4 of the cycle every row still open is marked `unreached`.

### The timers

| Timer | When | Its step 3 |
| --- | --- | --- |
| pulse (the watch and the cycle's driver) | every 290 seconds: one Monitor on `bun run runs pulse --every 290`, its actionable lines only | every run's milestone, ending and stall on every host; a line naming a milestone, an ending or a stall starts the protocol, with the first cycle step not done, ended runs closed out and `runs usage`; a run at the trigger starts an iteration, and a freed slot gets a fresh run at the top |
| milestone | one-shot at a predicted event, or at a prediction's deadline | the named milestone or row, and any investigation it owes |
| cycle review | one-shot at each step of the release cycle: the investigation's trigger at the latest opening plus twelve hours, and the end of the improvement window at the last stop plus twelve hours | the step `wri2p2.ts` names; at the window's end, what is proved and what is left |
| handover | one-shot at the agreed handover time | five points, changes and decisions waiting, and which timers were useful by their ledger rows |

The pulse is the one recurring watch (operator): no hourly or longer watch beside it. A
Claude Code Monitor lasts at most its tool's limit, so re-arm the same command at each expiry
notice; a one-off wait for a promotion never stands in for it, since that swap once left
the runs unwatched for hours. Pass `--state <file>` so a re-armed pulse says nothing twice.

A Claude Code timer (`CronCreate`) lives only in the session that armed it. It dies when that
session exits, and a recurring one expires after seven days. It fires only while the session is
idle, a few minutes off the time it names. So:

- Write each timer's prompt to stand alone, with absolute paths, `cycle.md`, `Predictions.md` and
  the rows it settles, the runs it reads, its authority, and "follow the firing protocol of
  run-improvement-campaign's Timers". It fires after compactions that will have dropped the context
  it was armed in.
- Review the one-shots from the ledger at each protocol run, not with a separate recurring Codex
  session: one fired four times in about eight and a half hours, and three of the
  four read a stale ledger, found no change or found the timer redundant.
- Write the time with its UTC offset in the ledger and the prompt (a clock change moves a local time).

Use [references/cycle-ledger.md](references/cycle-ledger.md) for the evidence fields. The release
cycle above owns the steps and authority for the next cycle too.

## Which skill each step uses

| Step | Every pass | When triggered |
| --- | --- | --- |
| cycle | the plan file and its log | run-management to fork and stop; whole-run-investigation on the stopped runs; system-path-simulation's before-and-after for each patch; stack-pr to implement on the open stack, its section 10 to consolidate it by subject, and `bun run land` to release |
| score | five points and milestone | none |
| walk | epoch, pulse, reader, link table | whole-run-investigation lane 21 for a campaign with a chain |
| choose | link, owner, falsifier | stack-pr for source; simplify over the diff |
| prove | replay and launch dry run | system-path-simulation rehearsal for a round or campaign path |
| predict | ledger before first solve | `--predict` on a manual comparison |
| launch | run-management and load rule | none |
| read | milestone and resolved predictions | attribution-and-proof before a claim; investigation when owed |
| decide | lifted, held or unreached; one move | harness-audit before handover; oracle-handover for a question repository evidence cannot settle |

Record an unmet trigger as not triggered. Change this skill when a pass exposes duplicated work, a
missed reading or a wrong decision; replace the rule at its owner and keep what changes the next
decision.
