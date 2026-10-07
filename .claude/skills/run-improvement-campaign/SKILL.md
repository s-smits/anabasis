---
name: run-improvement-campaign
description: "Run the improvement loop, led by the solve-wall share and the follow-up of each earned fail, with signal a rare confirming event: find the one link holding the climb, choose one simple domain-agnostic change against it, measure it as a matched arm, freeze a prediction, launch, read recorded bytes, decide the next move. Owns experiment selection and evidence reading; the product controller owns build, measure, climb, rebuild, claim and promotion. Also the Super Loop's Meta Agent: a second session that audits and steers the session driving the loop so it keeps moving (references/meta-agent.md)."
---

# Run improvement campaign

The loop is **diagnose → choose → prove → predict → launch → watch → assess → decide**, and it is
judged on one scoreboard (below). It answers one question at a time about the product, and its only
currency is recorded bytes. This skill selects experiments and reads their evidence. It never repairs controller output, never hand-writes
a bundle, and never lets a model's prose stand in for a receipt.

Its organising move is lifting the binding constraint. A flat climb is held at one link of the
chain a round runs through, and there are always more faults in view than links holding the line.
The Super Loop finds the one link holding the climb back, lifts it with one change, confirms from
recorded bytes that the line moved, and goes to find the next. [The climb
reference](../whole-run-investigation/references/climb.md#find-the-binding-constraint) finds the
link; §1 to §4 aim one change and one prediction at it; §5 and §6 read whether the link moved and
whether the line followed; §7 sends the loop back to walk again, and the constraint ledger (§6)
carries each answer to the next pass. A pass that cannot name the constraint it attacked has not
been a pass of the Super Loop.

## The scoreboard

The goal is AGENTS.md's healthy, ambitious climb ("Goals and the climb"). A pass leads with the share
of the solve wall, which moves on every battery, and with what the next battery did with each earned
fail (both below); signal is the rare event that confirms a step. The scoreboard prints three numbers
per run, all read from recorded bytes:

1. **Signal of the first 8**: the batteries between 1/n and n−1/n among the first eight on the run's
   line, on the counts the controller placed, so a case the review settled against its check counts
   neither way. This is the climb reference's `horizon`.
2. **Hours to first signal**: from the opening to the claim of the first such battery. This is the
   climb's velocity in the time the operator pays for.
3. **Held fails**: of those batteries' fails, how many the review held, how many it settled against
   the check, and how many it left unsettled. Only a held fail locates the solver; the rest are leads.

`scoreboard.ts` prints them per run and per source and Builder model. It finds runs as `runs pulse`
does and reads each line through `wri.ts climb`'s own readers, so the three cannot disagree:

```sh
bun .claude/skills/run-improvement-campaign/scripts/scoreboard.ts --since <ISO date> [--match <text>] [--json]
```

**The baseline to beat.** On 2026-10-01, the 32 runs opened since 2026-09-29 had 152 batteries on
their lines and 5 with signal. Two runs had one signal battery in their first 8, at 0.5 and 1.7
hours, both from source a907460c; every other source and Builder read 0 of its first 8. Neither of
the two speaks for its source. The truss one held one earned fail from a 0.9-minute solve, on a task
that was changed before it passed. The firmware one's two fails were on an output vocabulary the task
never published, and the review settled both against the check one battery later.
The wave audit of the same day found no source-attributed improvement across 87 runs in five source
states. A pass rate, a zone, a preview count or a merged PR is not on the scoreboard.

**What the scoreboard cannot show, and what to read beside it.** AGENTS.md "Its shape, and how
progress is read" defines the climb step and why signal, its first link, is too rare to compare arms;
"Open gaps" ranks the four blockers, and a pass names the one it attacks. Two readings carry a
comparison that signal cannot:

- **The share of the solve wall** (`wri.ts walls`). Truss batteries that went on to fail a case used
  a median of 18.6% of the wall against 6.6% for full passes. A change that raises demand shows here
  first. The scoreboard prints it per run (median and latest battery) and per source and Builder,
  beside the earned fails (`wri.ts climb`'s follow-up), how many the next battery carried unchanged,
  and how many of those passed there after the agent changed.
- **One fixed pack.** Solve the same recorded hard tasks with both products through `harness-query`,
  but only for rounds of one campaign or a seeded continuation: a pack task is graded by its
  authoring product's correctness bundle, so it cannot compare two fresh campaigns (AGENTS.md "Open
  gaps", the third blocker).

When a battery does hold an earned fail, read what the next battery did with it (`wri.ts climb`, its
`follow-up` line), and keep the run going as AGENTS.md "Reading the climb as the operator" says.

Every link of the chain has a deterministic reader already in the tree. Read the one for the link a
change aims at beside the scoreboard, from the newest tree:

| link | reader | the number it gives |
| --- | --- | --- |
| what the round asked | `wri.ts climb <campaign>` | each edge's label and novelty; `carried` after a full pass |
| the solve and its wall | `wri.ts walls <campaign>` | misses at the solve wall; solver minutes against `solve_seconds` |
| rehearsal and submit | `wri.ts timeline <campaign>`; `runs pulse` | rehearsals before the first submit; minutes to the first clear preview |
| the checks and corrections | `wri.ts gates <campaign>`; `bun run replay -- … --under …` | correction rounds; verdicts a correction flipped |
| the readout back to the Builder | `wri.ts handoff <campaign>` | readings the next round received |
| the live line | `bun run runs pulse --once` | each battery's zone, the off-aim streak, a stall |

### Measure so that a change can show

The same audit says why nothing could be attributed. The model, the domain or the launch flags
moved with every source; one run stood per condition; and most runs stopped after one to three
rounds. Builder resampling alone separated two runs of one request and model (2d7812 placed a
signal battery, 3e4693 none in seven). So a climb change is measured as an arm:

- **One variable.** Arms share request, model slots and launch flags; from #118 on their
  `command.digest` is equal. A model upgrade is an arm of its own on unchanged source.
- **One starting product.** Seed every arm from one recorded product (§4), so each arm's first
  battery starts from the same demand.
- **Two runs an arm** when the claim is on the share of the solve wall or on a fixed pack. On
  signal of the first 8, two runs an arm cannot separate anything (above), so a signal difference at
  that size is a lead. One run an arm is a lead on any reading.
- **One change at a time.** Hold the tree still while an arm runs: almost no battery of the last week
  measured one change (AGENTS.md "What has cost whole rounds here").
- **Long enough to answer.** Eight batteries, or a prediction on the first three that says so.
  `--max-iterations 1` measures one battery and no line.
- **Launched together**, under the load rule (§4), so host load cannot separate the arms.

## Resume the actual campaign

Read the local `notes/current-state.md` (ignored, never published) and the handover it links.
Recover the newest operator instruction, published heads, live controllers, frozen predictions and
outstanding proof. The operator's latest domain, model and refactor choices override anything
older, including this file.

A continuing instruction authorises replacements inside its scope; do not ask again each cycle.
Buying credits, changing accounts, stopping live runs and adding components need their own
authority. An old quota failure does not predict a newly authorised attempt.

Work per **authorised run slot**: domain, model condition, replica number. One slot per domain and
condition unless replicas are explicit. Check live controllers and recorded slot ownership before
launching. Close a terminal and its owned processes before replacing that slot; siblings continue.
Paired replicas keep identical source, prompts, efforts and budgets, and each result is reported
before any aggregate. Older runs finish on their frozen source; never rebase a live run tree.

The operator's cadence is a pass every 4 to 6 hours with one firmware run kept going (2026-09-30).
Firmware is the primary domain because a truss battery spends hours in solver time and so teaches
slowly. The pass runs as a session cron over the local `notes/super-loop-pass.md`; a session cron
dies with its session and expires after seven days, so the handover names the cron, its next
firing and the file it runs.

**Read from the newest tree.** Read this skill, and run every reader it names, from whichever of
main and the published stack top contains the other's changes to what you are reading. A reader
older than the records it reads refuses them or goes quiet (on 2026-09-30 main's `wri.ts` aborted
seven of eight reads). **A reader that returns `null`, an empty list or a schema refusal is a
missing producer in the tree you ran it from, not an absent signal**: re-run it from the other tree.
The pulse is the operator's own look and runs in the main checkout (§5).

Keep `notes/current-state.md` under 150 nonblank lines. Compress prose before deleting a fact, and
delete the paragraph explaining why the file is long before anything that names a head or a count.

## 1. Choose one change

**Simple, domain-agnostic, and aimed at a reading that moves.** The change is the smallest one that
could move the share of the solve wall or what a run does with its earned fails, on a surface every
domain's round passes through: the round prompt, the battery contract and readout, the rehearsal,
the check host, the gate. A change to one domain's tasks or tools is a finding about that domain,
never a pass of this loop. Name the number, the arm and the size of the move before writing code. A
**climb change** aims at the scoreboard; an **instrument change** makes a number readable or two
arms comparable, and is worth a pass only when an arm cannot be read without it. When two passes'
arms have left the scoreboard where it was, the next change goes at another link, not the next
sentence on the same one. "No change" is a pass only while an arm is measuring.

Choose from a recorded failure, wasted work or an unresolved decision — not from a hunch about
what looks fragile. Name the owner and the falsifier before writing code. Read the producer, its
consumers and the existing tests before adding a mechanism; most of the time the mechanism you
need already exists with one caller hardcoded to the only case anyone needed so far.

Start from the current row of `notes/binding-constraints.md` (§6). Every choice names the link it
attacks, in the words of the climb reference's chain, and the owner of the bytes that would move
it. After two batteries miss the band the same way, or a prediction comes back `refuted`, walk the
chain again before choosing instead of trying the next idea on the old constraint. While a capping
link holds, choose it first; the climb reference says which links cap the line, and a change whose
effect has to pass a live cap is spent on nothing. Aiming at a link other than the ledger's current
constraint needs a fresh walk, recorded in the ledger, that moved the constraint there.

A constraint holds where its mechanism exists, so its ledger row names the domains it covers. The
walk of 2026-09-30 found limits within about 2% of a reference the Builder had found in minutes.
That witness ceiling looked like the link in the optimisation domains (truss, reserve, buffer),
where a longer search finds a better answer, and its experiment came back held (AGENTS.md prior 10).
Firmware and conformer are
conformance domains with no numeric optimum to search, and the same day's six-domain read put their
link at task demand and round length. So in every domain read that day the link is what the tasks
demand, not where their limits sit.
Behind both sits F2. A task is admitted only with a reference the Builder solved inside its own
round, so no task is harder than that round can solve. The Judge never sees the reference
(AGENTS.md, "Judges advise; the verifier decides"), so a reference's quality reaches the score only
through the limits and checks set from it.

Prefer, in order: delete the competing owner, reuse the existing one, then add the minimum. Apply
`simplify` to each improvement in the same commit. A frozen size in `tools/loc/source-policy.json`
is a budget, not an invitation to open a sibling file: get under it by collapsing what you added
and cutting the prose the change made redundant.

Record where each design choice comes from: recorded data, a source opened in this session, or
your own reasoning. The data decides; the literature's use is the alternatives the data never
tested. Before settling a mechanism others have studied (a judge, an abstention, a verifier split,
a search budget), spend one bounded check of about twenty minutes, quote what each opened source
says, and list its alternatives as considered or as the next experiment.

When the experiment is a removal, it goes under the ablation convention (AGENTS.md "Ablated
components"). The pass that reads its runs either strips it as if it was never there or restores
it. It never stays marked without a date to read it again.

Two failure shapes have each cost whole rounds:

- **A gate that cannot fire before the thing it exists to cause.** `experiment-limit-held` refused
  product changes while a product sat at a measured limit. It fired on no recorded campaign across
  24 histories. Before adding a refusal, replay it over recorded campaigns and count the rounds on
  which it would have fired.
- **A schema bump inside a reader.** A changed packet shape made `readLatestRebuildAdvice` throw on
  all 47 recorded campaigns, and every `--project` continuation died in its first analyse step. A
  reader that meets a foreign schema reports absence; only unreadable bytes throw.

Before choosing, read what the last rounds actually moved. Diffing consecutive
`campaigns/<campaign>/versions/` directories names the files that changed between harnesses.
Campaign `3fd52f9e-28` adopted four versions whose agent bytes, brief and evaluator were
byte-identical: four rounds spent on `tasks.json` alone, which no battery score states. When the
question is capability rather than movement, solve a fixed pack on each distinct harness through
the real verifier, or probe a measured tree with `harness-query`. Both read verifier detail, so a
finding enters as your choice of the next change and never as text a Builder reads.

Batch related corrections under their owner, one PR and one gate per batch, and repair an open PR
in that PR (`setup-pr` owns where a change goes). Skill *scripts* are source and need a focused
check before the push. Before triaging a failing gate, record the host load and what else is
running. A peer PR left on an old head blocks every new PR: message its owner the exact
`git rebase --onto` rather than stacking around it. Read the exact bytes you are about to overwrite,
from the branch you write to, in the same turn: main and the stack have each carried a paragraph of
this skill the other lacked.

## 2. Prove the path before you spend

Use [system-path-simulation](../system-path-simulation/SKILL.md) before a changed condition is
launched, and when assessing a consequential failure. Each round records the uncertain
producer-to-consumer path, the smallest real layer that can decide it, and either executed
evidence or why existing evidence suffices. It is a proof choice, not a paid run.

The cheapest form has repeatedly been the strongest: a script in the worktree's gitignored
`.scratch/` that imports the **exported production function** and replays it over every recorded
campaign on disk. That is what found both failure shapes above, at no provider cost, in minutes.
Import only exported symbols; if a replay needs a module-private helper, it is asking the wrong
question.

For a defect in model-visible text, render the whole delivered surface from a recorded round's own
bytes and read the composed result, never one producer. The defect that matters is one fact stated
by several owners, invisible in each producer alone. On 18 September a render of
`renderRebuildAdvice` over a campaign's own advice packet confirmed four defects and cleared four
false leads from source-reading. The one fix written from source alone added a third owner of a
sentence, landed on main and was reverted six minutes later. Render before you gate: a render costs
seconds and a gate minutes.

Then cost the literal reading, and ask three questions of any model-visible instruction: can the
stack carry it, can a Builder afford it at the battery's size and walls, and does a Builder that
follows it literally still submit inside its round? #89's witness-budget sentence passed its tests,
its gate and a layer walk that asked only the first; read literally it asked for about 50 hours a
battery, and the simulated Builder that carried it ran one 95-minute search and never submitted,
against 44.9 minutes for the arm without it. An instruction that asks for a search bounds it by the
remaining wall and keeps the best answer so far at each step.

A test double proves only the interface it replaces. For authoring changes, exercise the
production Builder entry and the current tool contract; for semantic verifier claims, push a
public-valid equivalent and a plausible wrong artifact through the real host. An accepted
candidate with matching controls settles nothing about domain meaning.

Check the whole delivery path, not only the changed file. A new credential, flag or env variable
must survive the launcher's frozen environment map: launchd freezes it at start, so a variable the
launcher does not capture is inert in exactly the runs it was written for.

## 3. Freeze a falsifiable prediction

One row per moved mechanism, frozen **before** the opening:

```sh
bun .claude/skills/run-improvement-campaign/scripts/prediction.ts freeze \
  --run <runId> --source <full-sha> \
  --claim "<expected observation>" --moved-variable "<link>: <change>" \
  --direction up|down|none --falsifier "<recorded observation that refutes it>"
```

`--run` names the ledger `notes/predictions/<runId>.jsonl`, the one file `campaign.ts` reads back
and whose open rows hold a closure; read an older campaign's own `predictions.jsonl` with
`list --ledger <path>`.

Choose the run id yourself in the launcher's form (launch-run names it), freeze under it, then
launch with `--run <id>`. A dry-run's generated ids are not the next invocation's ids. Verify every
frozen timestamp precedes the actual opening; if that window was missed, say so rather than
backdating. Include the likely failure boundary; do not invent an expected failure to fill a row.

Write the claim so a recorded count settles it: "at least four iterations before any typed
terminal", "the next battery uses a median share of the solve wall at least 10 points above this
one's", "the battery after each earned fail carries that task unchanged". "Improves" is not a
prediction. Several changed mechanisms make a composed-system test: it can prove operation, while a
causal claim needs a controlled replay or a matched comparison.

Every pass freezes at least one row on the wall share or the follow-up against a named arm: "arm B's
median share of the solve wall over its first 8 batteries is at least 5 points above arm A's", or
"arm B carries at least 2 earned fails unchanged into the battery after them where arm A carries at
most 1". Name the arm in `--moved-variable`.

At least one row also observes the constraint at its own link and not only in the pass rate: the next
edge label, a `coupled` count, a rehearsal verdict or a placement, whichever that link produces. A
pass rate can move for reasons the link never saw, and a link that moved under a flat pass rate is
a result of its own (§6). `prediction.ts` has no field for the link, so name it at the start of
`--moved-variable` in the climb reference's words.

## 4. Launch through one owner

Use [launch-run](../launch-run/SKILL.md). Its one command prepares the worktree, probes the real
worker, gates the shared source once and verifies startup. Do not run a gate first, add a staging
script or prepare dependencies again.

Before the command: resolve the latest published stack and prove every child contains its latest
published parent; restack stale edges. Surrounding-only main commits do **not** require a source
restack — check with a name-only diff rather than assuming. Pass the resolved full SHA through
`--source`; the omitted default is `origin/main` and does not resolve a stack. Check free disk
against the floor and that no controller already owns the slot.

**Launch nothing while the host's one-minute load is above 25** (`sysctl -n vm.loadavg`; the
operator set 25 on 2026-10-01, replacing the core count of 12). A Builder's checks compile in four
or five lanes at once, so every run added stretches every run already there. On 2026-09-30 eight firmware runs shared 12 cores at load 35 to
200, and six live Opus firmware rounds waited on their tools for 79 to 91% of their wall. One
`correctness_check` took 137 minutes, and eleven firmware epoch reviews ended at their one-hour cap.
The controller's own share of a check was 3 to 5 minutes; the rest was the checks' compiles, slowed
by the load. Under that load every arm is tool-bound, ablated or not, so arms cannot be compared on
round length. [launch-run](../launch-run/SKILL.md) owns the rule, its hold at six live runs and
the override.

Two launch arguments decide whether the run can answer a climb question at all:

- **`--project`**: omit it for a fresh project unless the operator asked to continue a named one.
- **`--stop-after-ms`**: the boundary is elapsed wall time, so a multi-hour provider reset wait
  counts against it in full. A climb is read over 8 or 12 rounds (AGENTS.md "Goals and the climb"),
  so a climb question needs a boundary that holds that many, or none: truss-sol-198d70 took 17 hours
  to measure twelve batteries. A boundary that ends a run at round three measures a bracket, never a
  line.

**Several arms from one recorded position.**
- **Seed a copy per arm.** A campaign holds one `.controller.lock`, so two runs cannot continue one
  project at once. Seed each arm with `seed-campaign.mts` republish
  `--into-root <main checkout> --relocate`, then launch it with `--project <seeded slug>`. Each seed
  takes about four minutes, and the product's tool tree is cloned rather than downloaded
  ([system-path-simulation](../system-path-simulation/SKILL.md), "an active tool tree").
- **Arms are stack levels, not sibling branches.** The landing candidate goes lowest. Above it sit
  measurement-only levels, each with a head tree that is one condition, each closed once its run is
  read. The firmware arms of 2026-09-30 were #90 to #92 on #89.
- **Build each level as a new branch with ordinary commits.** Moving an existing branch is a
  rewrite, and the guard refuses it.
- **Count the arms against the load rule above.** Three concurrent arms of one domain are three
  times its compile lanes.

Credentials stay where they are: point at the main checkout's `.env` with `--env-file`, never copy
an env, campaign or config file between checkouts, and report a missing credential.

Read the launch result. Verify the opening's full SHA, clean source, prompt, budget and all three
model slots; a mismatch is a failed condition, not a relabelled one. Startup proves no useful model
work. If the gate refuses, fix the finding at its owner and relaunch; a refusal before any provider
call costs nothing but time.

A stop is proved by the process, not by the command that asked for it: after any authorised stop,
`ps` for the controller pid and read its lock, because a controller can outlive its removed service.

## 5. Watch quietly

Two watchers exist, and who is reading decides between them. **When a reader is attending, the
watch is `bun run runs pulse --once`** (documented in
[launch-run](../launch-run/SKILL.md#see-what-is-running)), run in the main checkout as the last
action of each reply so the next look lands about 270 s later. It finds every open run itself and
prints what moved since the previous look: a round opened, a preview or rehearsal, a battery, a
quiet Builder, a non-result, the Builder's latest checkpoint line, and each recorded battery with
its zone, the off-aim streak it extends and a stall once one arrives.

When nobody is reading, one detached watcher covers all live runs and speaks only on a stop row:

```sh
bun .claude/skills/run-improvement-campaign/scripts/campaign.ts \
  --campaigns /absolute/campaigns --run <runId> --run <runId> \
  --state /private/tmp/ana-watch-<wave>.json \
  --every 290 --stall-minutes 120 --disk-min-gib 20 --max-seconds 21600
```

Start it detached (Python `subprocess.Popen` with `start_new_session=True`, stdout to a literal
`/private/tmp` log): a background Bash call ends at 600 s and takes the watcher with it. Add
`--completion-only` when the operator wants nothing until a terminal exists. Dropping `--every`
makes the same command an attended tick, printing each run's status and every row it holds, which
is the look to take when the question is which move a row implies. Without `--state` it is the
status report alone, with the per-file table when it names one run and `--json` for the whole
reading. Start it after the openings exist: a named run with no opening reads as `stop [reserved]`.

A watch is a process, so check for the process. On 2026-09-18 the last state file was written at
08:31 and `pgrep -f` found no watcher until 18:50; a claim and a climb decision both landed unwatched
inside that window. A state file's mtime says when a watcher last ran, never that one is running.

The session driving the loop needs a watcher of its own, because it can stall where no run shows
it: on 2026-09-28 it held its launch question in a dialog for eight hours while two findings that
made the question stale sat unread. [meta-agent](references/meta-agent.md) is that watcher, a second
session that audits the main one against a watch contract and steers it with bounded `CHECK` and
`DIRECT` messages.

Every tick reports **increments, never totals**. A new case prints one row naming its task and
family — `run-i02 mast-04 (splice): unaccepted, the agent produced no accepted submission` — and a
case already reported is never reported again. The first tick over a run already in flight prints
the battery's id, not its backlog.

Every `stop` row carries the move it implies, printed in brackets before the run id:

| act | what it means | what to do |
| --- | --- | --- |
| `surgical` | one owner is named and the fix is small | patch that owner on its PR, relaunch |
| `reserved` | something is wrong but the evidence names no owner | hold the product bytes, read the evidence, decide |
| `overhaul` | the measurement failed, not a detail inside it | rebuild the product or the battery; there is nothing inside to patch |

`overhaul` fires on a battery whose scored cases are all unaccepted, which places it nowhere, and on
five typed non-results in a row (rule 6's threshold for stopping the schedule). A completed run
that verified cases carries no act at all.

### Silence under a wall is work, not a stall

A Built solve writes nothing between the case starting and its verdict, and a `harness_trial` holds
every checkpoint until its rehearsal is graded. So the watch reads the **cases the battery has
open** against the harness's own `solve_seconds`, and the newest rehearsal against the workspace's
solve wall: under the wall the silence is work, and past it the host stopped enforcing its ceiling.
The status also prints what the bundle declares (files, tasks, families, checks, controls, tools,
presets; `?` where the gate's validator refuses a file) and `authoring N commits: R rehearsal(s),
S submit attempt(s)`. Read `presets` first: `[]` beside an artifact-writer gave the solver no shell.
The early shape is rehearsals climbing while submits do not: of 210 epoch workspaces, the 167 whose
submit was accepted rehearsed a median of 2 times, against 0 for the 31 that never got one in.

### Time goes to tools first

Read a slow round as tool time before model time. The epoch's `builder-execution.json` splits the
two after the round: the union of its custom calls' intervals is the wall the model spent waiting.
During the round the Builder's transcript does the same. Its Claude CLI project sits under the
run's TMPDIR at `ana-claude-cli-*/projects/<workspace path, / as ->/*.jsonl`, and each `tool_use` to
its `tool_result` is a wait. The six firmware rounds of 2026-09-30 waited 79 to 91% of their wall
that way (§4), so a slow firmware round is first a host-load and a check-length question. It is the
model's or the prompt's only after those are ruled out.

### Read the climb, not only the score

The watch reads `difficulty-decisions/`, the controller's own placement per battery, and prints one
row as each lands: `battery run-i02: 24/25 too-easy`. A decision stating **repeated failures** or a
**family conflict** is `surgical`, and one placed nowhere is `overhaul`. Otherwise it moves by its
zone: `too-hard` is `reserved`, and the other four zones are the band reading its own score,
printed as `info`. A row says how one battery landed; only the run's line says whether the climb
moved, and a stall the pulse names is the operator's to stop (§7).

A decision is filed under the round it opens and places the battery before it: decision `iN`
places battery `i(N−1)`. The stack's readers print both (`iN (reads iM)`), but a WRI snapshot of an
older run reads with that run's own source, which may print the bare round. Match them before
calling a placement wrong. A lane finding on 2026-09-30 that 7 of 15 placements disagreed was this
misreading; matched, all 16 agreed.

Run `wri.ts climb` whenever a new `versions/<battery>/` directory appears, and at every read step on
a campaign that has landed off its aim twice. The edge label exists the moment a candidate is
adopted, hours before its battery scores (AGENTS.md "Goals and the climb", under "Reading the climb
as the operator"), so that is the moment to write the next experiment. The round already in flight
finishes and records.

```text
bun .claude/skills/whole-run-investigation/scripts/wri.ts climb <campaign dir> [--json]
```

[The climb reference](../whole-run-investigation/references/climb.md) owns the reading: the line
and its four numbers, the edge labels, which reader answers which climb question, why a published
limit, a reviewer finding or a zero score is a lead while the case bytes are the measurement, and
the walk that finds the one link holding a flat line. Two rules stay here because they decide what
this loop does next. Before attributing anything to the Builder, run `git show <opening
source.commit>:<path>` for every surface your explanation depends on: a page absent there was never
delivered, so it is a prediction for the next launch, never a Builder failure. And a reviewer
finding cannot stop the battery that raises it, so when one contradicts a standing prompt
instruction, one of the two owners has to move, and the recorded cases decide which.

### On a deviation

Read `campaign.ts --campaigns <dir> --run <id> --json`, then the named evidence. The case ledger can
be legitimately empty during a real battery. A live pid alone proves nothing, a stale timestamp is
a lead, and unknown usage is `null`, never zero. The watch names a blocked Builder session once per
epoch; [builder-blocking-loop](../builder-blocking-loop/SKILL.md) owns it. A disk-floor deviation
suspends new launches until resolved. Do not poll unchanged runs.

While a run is live, read nothing that opens its writable state: its sqlite ledger, its lock files,
anything under its campaign the controller writes. `productHistoryDirs` opens the
`ControllerLedger` on the live campaign's database, so rendering one advisory note risks a paid
run. Defer it to the terminal and say so. There is no live provider-spend row: the controller
records spend at the terminal, so a threshold on it could only fire after the run it was meant to
interrupt.

## 6. Close and assess from recorded bytes

Every terminal gets closure, including a short or zero-case run:

```sh
bun .claude/skills/run-improvement-campaign/scripts/campaign.ts \
  --campaigns /absolute/campaigns --run <runId> [--json]
bun .claude/skills/run-improvement-campaign/scripts/prediction.ts adjudicate \
  --run <runId> --id <prediction-id> \
  --outcome sufficed|partial|refuted|untriggered|censored --evidence "<path and finding>"
```

Read the scoreboard first, over this pass's arms beside the baseline, and only then the closure.
Read in this order: terminal, case denominators, claims, promotion decisions, review spend,
safeguard census — then prose. Name the full SHA from `opening.json`; unresolved source is
`source-unresolved`. Report `verified`, `unaccepted` and `non-result` separately; zero verified
cases give an operational result and no capability rate. Run `bun run outcome -- --safeguards
<campaignDir>` once per run and record which ids fired and which stayed silent. The reader
reports firings only; separating a silent sensor from one no run reached, and any removal,
belong to the weekly review, not to this step.

Evidence precedence:

```text
recorded run bytes > verified evidence reader > source and tests > terminal/log line > PR body > prose
```

Weight the **latest two runs** unless the operator widens it; a count from five runs ago describes
a product that no longer exists. Compare runs of unequal length over the shorter one's elapsed
window and name that window. Changed tasks, verifier or models change the measured condition, so a
higher score alone proves no improvement. Fetch main and read the ledger before adjudicating:
another session may have closed the rows, and the ledger is append-only. When a later PR retires
the mechanism a row names, note the retirement beside the row's outcome instead of freezing a
replacement.

Subagent and reviewer reports are model output, not authority. Check every finding against the
source before acting on it.

### Track what the gate and the checks did, and backtrack a correction

A score says nothing about what the gate cost to reach it, and an evaluation correction changes the
exam without saying what the old answers were worth under it. So every round, not only on a
suspicion, read the `gates` lane and run every `replay --under` it lists. Nine consecutive firmware
corrections once went by with none regraded.

```sh
bun .claude/skills/whole-run-investigation/scripts/wri.ts gates <campaign dir> [--json]
bun run replay -- <campaign>/<earlier runId> --under <campaign>/<corrected runId>
```

What an episode's ending and a replay's flips mean is lanes 27 and 28 of
[the catalogue](../whole-run-investigation/references/review-angles.md) and the `gates` lane in
[the deterministic lanes](../whole-run-investigation/references/deterministic-lanes.md); whether a
component keeps its place is [the gate audit](../whole-run-investigation/references/gate-audit.md).
Read a stalled episode as a round lost to the gate rather than to the domain. Nothing records a
replay or reads its report, so its flips inform this round's judgement while the advice still
names the correction's issues `unmeasured`.

### When two batteries miss the band the same way, stop editing prose

Two batteries of one product off the band on the same side are a settled result, not an ambiguous
signal needing more diagnosis (AGENTS.md "While it runs"). They say the authoring loop cannot yet
author above this solver under the surfaces the run was served, and those surfaces are frozen at
its opening. A run of full passes is the common case (AGENTS.md "Goals and the climb", under "The
goal").

Before reacting to a live run at all, check containment: `git merge-base --is-ancestor <fix>
<opening sha>`. A commit that is not an ancestor of the run's opening cannot change that run,
whatever it fixes. On 18 September the second battery settled 6 of 6, against the author's own
pre-registered "at most 2". The next two hours and fifty minutes went into eleven PRs against
model-visible text, none of them in the live source.

So on the second one: stop opening PRs against any authoring surface, and write the operator one
message. It holds both batteries' verified counts, each case's turn count and margin to its
governing limit, what the Builder changed between them as `wri.ts climb` reads it, and one named
next experiment. Then wait. Authoring work after that point is work for the next launch and is
scheduled as such. Why the line stayed flat is a reading for that launch:
[the climb reference](../whole-run-investigation/references/climb.md) walks the chain to the one
link that held it, and that constraint is where §1 starts.

### Lifted, held or unreached: the constraint ledger

After adjudication, read the constraint at its own link first and on the line second. It is one of
three:

- **lifted**: the link moved and the line followed. Walk the chain again for the next constraint.
- **held**: the link moved and the line did not, so the constraint was misnamed. Restart the walk
  from that link, with this pass's rows as its evidence.
- **unreached**: the link did not move, so the change never did what it was for. Fix its path
  (§2), containment included, before naming another constraint.

Each pass writes one row to the local `notes/binding-constraints.md`, which is never published: the
date; the runs read; the constraint, as its link, its owner, the domains it covers and its evidence
with denominators; its falsifier; the change, as PR and sha; the prediction ids frozen for it; and
the outcome, once adjudicated; and the scoreboard line of each arm before and after. The next pass
reads it first. The first row, written on 2026-09-30,
named the witness ceiling, and it came back **held** the same evening, which moved the constraint
to task demand. Record where a pass did not fit the row rather than bending the row to fit.

## 7. Decide the next move

The constraint's outcome (§6) comes first: it says whether the next move is a walk for a new
constraint, a walk from the same link, or a repair of the change's path. Then choose one: retain
and measure; fix the demonstrated owner; delete a mechanism with no consumer or no decision effect;
investigate a consequential ambiguity; or stop because the authorised programme or the allowance
ended, or because a run's climb stalled. The product owns its own within-run climb and rebuild
decisions, but never stops on one: a stall, as AGENTS.md "Goals and the climb" defines it and
`bun run runs pulse` names it, is the operator's to stop. Whether a new wave of runs improved on the
one it replaced is a [wave-audit](../wave-audit/SKILL.md), read at the first battery, the third
round and the terminal.

The goal that choice serves is AGENTS.md's healthy, ambitious climb ("Goals and the climb"), read
first on the solve-wall share and the follow-up of each earned fail. Of two candidate moves, prefer
the one that brings the next battery closer to the solver's limit on a changed public requirement,
provided every fail it could produce is earned on a published rule. A move after which the line
would sit at n/n where it sat has not served the goal.

Four lessons point at an owner before the evidence is complete. A limit is only as tight as the
search behind its reference, and tightening one has not yet made a solver fail (AGENTS.md prior
10); difficulty has come from what the task demands. A control that equals the reference proves
nothing at the limit: it belongs on each side of the limit it guards. A verdict channel earns its
place by coverage, not precision. Broaden a rule before specialising it.

Track the four evidence levels separately — present in source, deterministically proved,
live-exercised, outcome-proved — and never let one stand in for the next. Keep negative results and
their limits intact. A live run is not a reason to keep changing code without a demonstrated need.

When you are choosing that move about the loop itself rather than the product,
[superloop-completeness-review](references/superloop-completeness-review.md) holds seven lenses to
hand independent sessions, each asking of one edge whether a producer's artifact reaches a consumer
that changes a decision. Its findings are only useful as the moves above: fix the owner, delete the
mechanism, or investigate. It schedules nothing and decides nothing.

Then write the handover and snapshot: source and composed head, run ids, proof, uncertainty, next
executable action. Name a composed sha only after every head is on origin and proved an ancestor.

## Which skill each step uses

Strict steps run every round. Judgement steps run when their trigger holds and are otherwise
recorded as `not triggered`, so a skipped skill is a decision rather than an omission.

| step | strict, every round | judgement, with its trigger |
| --- | --- | --- |
| read | the scoreboard over this pass's arms; from the newest tree, `whole-run-investigation` rows A to I, then the safeguard census, then a diff of the campaign's adopted versions, then `wri.ts climb` once the campaign has two edges, then `wri.ts gates` and a `replay --under` for every correction it lists | its semantic lanes, the number the tier allows, when a recorded row stays unexplained; the [climb reference](../whole-run-investigation/references/climb.md) on any climb row the watch printed, and whenever a transition needs attribution; the tool and model time split (§5) on any round slower than its walls explain |
| adjudicate | `prediction.ts adjudicate` for every row, ledger kept in the local `notes/predictions/` | `attribution-and-proof` before any sentence claims improvement |
| diagnose | read `notes/binding-constraints.md` first and write this pass's row (§6); whenever two batteries miss the band the same way, `wri.ts climb` prints `flat: yes` or an adjudication is `refuted`, walk the chain per the [climb reference](../whole-run-investigation/references/climb.md#find-the-binding-constraint) | Luna lanes through `codex-luna-swarm` for the cross-run count at one link; `bounded-investigation` when a link is disputed |
| patch | fix on the owning PR; `simplify` on each diff; render and cost any model-visible text (§2) before its push; record the `system-path-simulation` proof choice and its result | `safeguards` when a fix adds a decision no record observes; a fresh replay when existing evidence does not cover the changed consumer |
| compose | merge in the compose tree, prove every head an ancestor; let `launch-run` own its one gate | `stack-hop` and `intelligent-rebase` when PR order changes or two fixes touch one file |
| launch | matched arms (the scoreboard's rules), the load at or under 25 (§4), `launch-run`, freeze before the opening, detached watch, next wake | `whole-run-investigation`'s [outcome reference](../whole-run-investigation/references/outcome-review.md) assesses a suspected stall; a stop executes only under existing authority and is proved by the process |
| weekly | the first wake on or after Monday 00:00 UTC runs the `safeguards` removal review and `weekly-run-review`, and writes the date in the snapshot | |

## What has actually cost time here

Keep this list short and current; replace an entry when its lesson is absorbed elsewhere.

- Blind gate retries. A push gate that dies at the 3600 s wall with no failing step named is a
  spinning step, not a slow suite: find the process holding the CPU first. Two blind retries cost
  two hours on 2026-09-07.
- Asking a session for a cause without giving it a falsifier.
- Treating a provider 429 as a harness defect, or a harness defect as a provider 429. Only an
  explicit exhaustion message is exhaustion; investigate everything else.
- Launching a model-visible change before its simulation. #89 went live at 12:18Z on 2026-09-30 and
  its stewards started at 12:24Z. The defect that needed #90 was found by reading, after both paid
  runs carried it.
- Reading a tool-bound round as a slow model. The firmware arms of 2026-09-30 took up to five hours
  to a first clear preview and waited on their checks for 79 to 91% of it.
- Unmatched runs. 87 runs over five source states held no pair that isolated the source, so no
  pass before 2026-10-01 could say its change moved the climb (the scoreboard's arm rules).

Upgrade this Skill when a cycle exposes duplicated work, missed closure or a wrong decision.
Replace the obsolete rule at its owner. Do not accumulate a checklist, a runtime layer, a scheduler
or another review component. Keep only instructions that change the next decision.
