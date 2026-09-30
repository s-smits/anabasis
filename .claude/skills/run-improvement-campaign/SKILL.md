---
name: run-improvement-campaign
description: "Run the improvement loop: find the one link holding the climb, choose one change against it, prove its path, freeze a prediction, launch, read recorded bytes, decide the next move. Owns experiment selection and evidence reading; the product controller owns build, measure, climb, rebuild, claim and promotion. Also the Super Loop's Meta Agent: a second session that audits and steers the session driving the loop so it keeps moving (references/meta-agent.md)."
---

# Run improvement campaign

The loop is **diagnose → choose → prove → predict → launch → watch → assess → decide**. It exists to
answer one question at a time about the product, and its only currency is recorded bytes. This skill
selects experiments and reads their evidence. It never repairs controller output, never hand-writes
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

## Resume the actual campaign

Read the local `notes/current-state.md` (ignored, never published) and the handover it links. Recover the newest operator instruction,
published heads, live controllers, frozen predictions and outstanding proof. The operator's latest
domain, model and refactor choices override anything older, including this file.

A continuing instruction authorises replacements inside its scope; do not ask again each cycle.
Buying credits, changing accounts, stopping live runs and adding components need their own
authority. An old quota failure does not predict a newly authorised attempt.

Work per **authorised run slot**: domain, model condition, replica number. One slot per domain and
condition unless replicas are explicit. Check live controllers and recorded slot ownership before
launching. Close a terminal and its owned processes before replacing that slot; siblings continue.
Paired replicas keep identical source, prompts, efforts and budgets, and each result is reported
before any aggregate. Older runs finish on their frozen source; never rebase a live run tree.

Keep `notes/current-state.md` under 150 nonblank lines. Compress prose before deleting a fact, and
delete the paragraph explaining why the file is long before anything that names a head or a count.

## 1. Choose one change

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

Prefer, in order: delete the competing owner, reuse the existing one, then add the minimum. Apply
`simplify` to each improvement in the same commit. A frozen size in `tools/loc/source-policy.json`
is a budget, not an invitation to open a sibling file: get under it by collapsing what you added
and cutting the prose the change made redundant.

Two failure shapes are worth naming because both have cost whole rounds here:

- **A gate that cannot fire before the thing it exists to cause.** `experiment-limit-held` refused
  product changes while a product sat at a measured limit — reachable only after the Builder had
  already gone harder. It appeared in no recorded campaign across 24 histories. Before adding a
  refusal, replay it over recorded campaigns and count the rounds on which it would have fired.
- **A schema bump inside a reader.** Changing the packet shape made `readLatestRebuildAdvice`
  throw on all 47 recorded campaigns, so every `--project` continuation died in its first analyse
  step. A reader that meets a foreign schema reports absence; only unreadable bytes throw.

Before choosing, read what the last rounds actually moved. The adopted versions are on disk, so
"did the product change, or only its battery" costs nothing to answer:
diffing consecutive `campaigns/<campaign>/versions/` directories names the files that differed
between consecutive harnesses. Campaign `3fd52f9e-28` adopted four versions
whose agent bytes, brief and evaluator were byte-identical — four rounds spent on `tasks.json`
alone, which is a diagnosis no battery score states. When the question is capability rather than
movement, solve a fixed pack on each distinct harness and grade it through the real verifier, or
probe a measured tree with `harness-query`. All of it reads a finished run: like any
verifier detail it is protected from authoring, so a finding enters as your choice of the next
change and never as text a Builder reads.

Batch related corrections under their owner. Repair an open PR **in that PR**; a distinct
experiment gets its own child. A consolidated fix PR on the stack top hides which change repairs
which PR. Surrounding files — `.claude/skills/**`, `README.md`, `AGENTS.md` — go
to main once the operator approves the push, and `notes/**` stays local; a document coupled to unmerged source stays with that source. Skill *scripts*
are not text-only: they need a focused check before the push.

Batching is not a tidiness preference while a run is live. On 18 September eleven same-owner text
corrections went out as eleven stacked pull requests and nineteen composed gates, on the host
already carrying the run's six concurrent solves at load 9 to 26 — which then produced contention
failures that had to be triaged apart from two real ones. One of the eleven changed a plural.
Batch to one PR per owner and one gate per batch, and before triaging any failing gate record the
host load and what else is running, so the tests that condition owns are named before the rest are
read as defects.

Read the exact bytes you are about to overwrite, from the branch you are about to write to, in the
same turn as the write. The primary checkout is often on a stale branch while the target is main:
`git show origin/main:<path>` first. The same day, a survey of a stale tree authorised a rewrite
that deleted a peer session's work from main along with its recorded reason, found eight minutes
later by accident.

## 2. Prove the path before you spend

Use [system-path-simulation](../system-path-simulation/SKILL.md) before a changed condition is
launched, and when assessing a consequential failure. Each round records the uncertain
producer-to-consumer path, the smallest real layer that can decide it, and either executed
evidence or why existing evidence suffices. It is a proof choice, not a paid run.

The cheapest form has repeatedly been the strongest: a script in the worktree's gitignored
`.scratch/` that imports the **exported production function** and replays it over every recorded
campaign on disk. That is what found both failures above, at no provider cost, in minutes. Import
only exported symbols; if a replay needs a module-private helper, the replay is asking the wrong
question — find the exported reader whose answer you actually want.

For a defect in model-visible text, render the whole delivered surface from a recorded round's own
bytes and read the composed result — never diagnose from one producer. The defect that matters is
one fact stated by several owners, and it is invisible in every producer separately. On 18
September, rendering `renderRebuildAdvice` over a campaign's own `analysis/rebuild-advice-latest.json`
confirmed four defects and cleared four false leads that source-reading had suggested; the one fix
written from source alone added a third owner of a sentence that already had one, passed a full
composed gate, landed on main and was reverted six minutes later. Render before you gate: a render
costs seconds and a composed gate costs minutes.

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
  --claim "<expected observation>" --moved-variable "<change>" \
  --direction up|down|none --falsifier "<recorded observation that refutes it>"
```

`--run` names the ledger: `notes/predictions/<runId>.jsonl`, the one file `campaign.ts` reads back,
and whose open rows hold a closure. Pass `--ledger <path>` only to point somewhere else on purpose.
Until 2026-09-18 the two sides used different paths, so a run could close reporting no open
predictions while its frozen rows sat unadjudicated; freeze and closure now resolve one location.
Runs before that date left 79 rows, 20 of them unadjudicated, in `campaigns/<slug>/predictions.jsonl`
instead. They stay there — the campaign tree is controller-owned and those runs are long closed.
Read one with `list --ledger campaigns/<slug>/predictions.jsonl` when an old row matters.

Choose the run id yourself (`<preset>-<condition>-<UTC stamp>-<6 hex>`), freeze under it, then
launch with `--run <id>`. A dry-run's generated ids are not the next invocation's ids. Verify every
frozen timestamp precedes the actual opening; if that window was missed, say so rather than
backdating. Include the likely failure boundary; do not invent an expected failure to fill a row.

Write the claim so a recorded count settles it: "at least four iterations before any typed
terminal", "the next battery's verified count falls by at least three of 25", "at least three of
the first 8 batteries land between 1/n and n−1/n", "no task is carried unchanged after a full
pass". "Improves" is not a prediction. Several changed mechanisms make a composed-system test: it
can prove operation, while a causal claim needs a controlled replay or a matched comparison.

At least one row observes the constraint at its own link and not only in the pass rate: the next
edge label, a `coupled` count, a rehearsal verdict or a placement, whichever that link produces. A
pass rate can move for reasons the link never saw, and a link that moved under a flat pass rate is
a result of its own (§6). `prediction.ts` has no field for the link, so name it at the start of
`--moved-variable` in the climb reference's words, as in `--moved-variable "the solver: <change>"`.

## 4. Launch through one owner

Use [launch-run](../launch-run/SKILL.md). Its one command prepares the worktree, probes the real
worker, gates the shared source once and verifies startup. Do not run a gate first, add a staging
script or prepare dependencies again.

Before the command: resolve the latest published stack and prove every child contains its latest
published parent; restack stale edges. Surrounding-only main commits do **not** require a source
restack — check with a name-only diff rather than assuming. Pass the resolved full SHA through
`--source`; the omitted default is `origin/main` and does not resolve a stack. Check free disk
against the floor and that no controller already owns the slot; a loaded launchd service with no
pid is a finished run, not a live one.

Two launch arguments decide whether the run can answer a climb question at all:

- **`--project`**: omit it for a fresh project unless the operator asked to continue a named one.
- **`--stop-after-ms`**: the boundary is elapsed wall time, so a multi-hour provider reset wait
  counts against it in full. A climb is read over 8 or 12 rounds (AGENTS.md "Goals and the climb"),
  so a climb question needs a boundary that holds that many, or none: truss-sol-198d70 took 17 hours
  to measure twelve batteries. A boundary that ends a run at round three measures a bracket, never a
  line.

Credentials stay where they are. Point at the main checkout's `.env` with `--env-file`; never copy
an env, campaign, domain or config file between checkouts to make a command start. Report a missing
or drained credential — do not substitute another account's token.

Read the launch result. Verify the opening's full SHA, clean source, prompt, budget and all three
model slots; a mismatch is a failed condition, not a relabelled one. Startup proves no useful model
work. If the gate refuses, fix the finding at its owner and relaunch; a refusal before any provider
call costs nothing but time.

## 5. Watch quietly

Two watchers exist, and who is reading decides between them. **When a reader is attending, the
watch is `bun run runs pulse --once`** (`tools/runs/pulse.ts`, documented in
[launch-run](../launch-run/SKILL.md#see-what-is-running)), run from main as the last action of each
reply so the next look lands about 270 s later. It finds every open run itself and prints what moved
since the previous look: a round opened, a preview or rehearsal, a battery, a quiet Builder, a
non-result, the Builder's latest checkpoint line, and each recorded battery with its zone, the
off-aim streak it extends and a stall once one arrives. Nobody has to name a run, and a run
launched since the last look simply appears.

When nobody is reading, one detached watcher covers all live runs and speaks only on a stop row:

```sh
bun .claude/skills/run-improvement-campaign/scripts/campaign.ts \
  --campaigns /absolute/campaigns --run <runId> --run <runId> \
  --state /private/tmp/ana-watch-<wave>.json \
  --every 290 --stall-minutes 120 --disk-min-gib 20 --max-seconds 21600
```

Start it detached (Python `subprocess.Popen` with `start_new_session=True`, stdout to a literal
`/private/tmp` log): a background Bash call ends at 600 s and takes the watcher with it. For a
watch under thirty minutes, bounded polling every 290 s is cheaper than holding a monitor open.
Add `--completion-only` when the operator wants nothing until a terminal exists.

Dropping `--every` makes this command an attended tick too — each watched run's status, then every
row it holds, info included, and exit 0 — and that is the look to take when the question is which
move a row implies rather than what moved. It needs every run named, and a named run with no opening
yet reads as a `stop [reserved]` row, so start it after the openings exist.
Without `--state` the same command is the status report alone, with the per-file table when it
names one run and `--json` for the whole reading. The detached `--every` watcher stays deviation-only and holds info rows for the next
stop row, because nobody is reading it.

A watch is a process, so check for the process. On 2026-09-18 the last state file was written at
08:31 and `pgrep -f` for the watcher was empty from then until 18:50: the i03 claim and the i04 climb
decision both landed inside that window and neither was watched. A state file's mtime tells you when
a watcher last ran, never that one is running now.

The watchers above read runs. The session driving the loop needs a watcher of its own, because it
can stall where no run shows it: on 2026-09-28 the main session held its launch question in a dialog
for eight hours, and the two findings that made the question stale sat unread behind it.
[meta-agent](references/meta-agent.md) is that watcher. It is a second session that audits the main
one against a watch contract and steers it with bounded `CHECK` and `DIRECT` messages. It enforces
this loop's launch, pin, prediction, order, stop and closure rules. It tells the operator at once
when only the operator can unblock the main session.

Run the watch, and every other reader here, from `origin/main`. They are operator tooling and belong
to the current tree, not to the run's frozen source and not to an open stack that has not been
rebased. The same 18 September evening, the watch run from the stack top printed no climb row at all
for a campaign holding three `climb` decisions, because the status reader of the day only grew the `difficulty` field
in `df7a28ee0` that morning and the stack was 92 commits behind it. Run from main against the same
campaign it fired at once, naming three climbs in a row. **A reader that returns `null` or an empty
list for a field is a missing producer in the tree you ran it from, not an absent signal**; re-run
from main before concluding anything from a quiet reader.

Every tick reports **increments, never totals**. A new case prints one row naming its task and
family — `run-i02 mast-04 (splice): unaccepted, the agent produced no accepted submission` — and a
case already reported is never reported again. A restated "12 of 25 verified" says nothing a reader
can act on; a named task is something to open. The first tick over a run already in flight prints
the battery's id, not its backlog: history is not news.

Every `stop` row carries the move it implies, printed in brackets before the run id:

| act | what it means | what to do |
| --- | --- | --- |
| `surgical` | one owner is named and the fix is small | patch that owner on its PR, relaunch |
| `reserved` | something is wrong but the evidence names no owner | hold the product bytes, read the evidence, decide |
| `overhaul` | the measurement failed, not a detail inside it | rebuild the product or the battery; there is nothing inside to patch |

`overhaul` fires on a battery whose scored cases are all unaccepted
(a battery placed nowhere: no capability rate, no difficulty strike, nothing to patch
against), and on five typed non-results in a row — rule 6's threshold for stopping the schedule.
A completed run that verified cases carries no act at all.

### A battery mid-solve is silent, and that is not a stall

A Built solve writes nothing between the case starting and its verdict, so every mtime the watch
can sample freezes at the second the battery opened. Run `c1d2a7` held three cases open for 38
minutes on 2026-09-18 with `evidence 38 min ago, session wrote 38 min ago`, and the old rule would
have called it stalled at 120. The watch reads the **cases the battery has open** — one directory
per case under the retained version — against the harness's own `solve_minutes` from its accepted
`agent/config.yaml`. Under that wall the silence is work and no row fires; past it the host stopped
enforcing its own ceiling and the stall row is right. A `harness_trial` is the same silence one
level up: the Builder's call holds every checkpoint until the rehearsal is graded, and truss-opus
sat 57 minutes inside one on 2026-09-28 when the stall row fired on it. So the newest rehearsal, once it has
written its public task and until it writes its `checks.json`, is work too, under the workspace's
solve wall.

The status prints the same count, and beside it what the bundle is made of: files, nonblank lines,
tasks, families, checks, accept and reject controls, tools and presets, from the frozen version once
the gate accepted it and from the live epoch workspace before that. The counts come from the gate's
own bundle validator, so a file it refuses prints `?` beside the finding code — a wrapped
`{tasks: [...]}` reads as `? tasks` and `tasks-shape`, never as zero tasks. Size is not
quality — a long evaluator with two checks is weaker than a short one with six — so read the
declared counts, and read `presets` first: a bundle shipping `[]` beside an artifact-writer gave its
solver no shell, and no gate catches it.

Beside it, `authoring N commits: R rehearsal(s), S submit attempt(s)`. The commits are the epoch
workspace's reflog, because the Builder never commits and the host commits at each tool boundary.
The rehearsals and submits are not, and they used to be: the host commits only when the tree
changed, so a `correctness_check` or a resubmit over unchanged bytes wrote no reflog line and the
count came out short. They now come from the Builder's own execution records, the
`correctness_check` calls each session counted and the candidate submits the controller recorded,
with a controller stop left out because it closes a session rather than submitting to the gate.
The reflog reading once also counted "repair rounds" from the host's `(repair …)` commit messages,
and that count is gone with the rest of that reading: a repair round over unchanged bytes wrote no
line either, so it came out short for the same reason. Of the 210 epoch workspaces read that older way, the 167 whose submit was
accepted rehearsed a median of 2 times against 0 for the 31 that never got a candidate in, so the
shape to catch early is still rehearsals climbing while submits do not. An execution record under
an older schema is refused by name rather than read as zero: the line says `rehearsals and submits
unknown:` with the refusal, `--json` carries `session: null` beside it, and the watch stops once
per epoch on it, because none of the Builder limits can be read.

The watch names a bundle file **only on the tick that wrote it** — `wrote agent/tools.ts, 224 lines
(was 220)` — never on a first reading, where everything present is older than the watch, and never
again once the bundle is frozen. During a 46-minute authoring turn those rows and the commit line
are the only visible sign of what the Builder is doing.

### Read the climb, not only the score

The watch also reads `difficulty-decisions/`, the controller's own placement per battery, and
prints one row as each lands: `battery run-i02: 24/25 too-easy`. A decision stating **repeated
failures** or a **family conflict** is `surgical`, and one placed nowhere is `overhaul`. Otherwise it
moves by its zone: `too-hard` is `reserved`, and the other four zones are the band reading its own
score, printed as `info`. A row says how one battery landed, and only the run's line says whether
the climb moved; a stall `bun run runs pulse` names is the operator's to stop (§7).

Run `wri.ts climb` whenever a new `versions/<battery>/` directory appears, and at every read step
on a campaign that has landed off its aim twice. The edge label exists the moment a candidate is
adopted, hours before its battery scores (AGENTS.md "Goals and the climb", under "Reading the climb
as the operator"), so that is the moment to write the next experiment rather than wait for a score
that cannot surprise you. The round already in flight finishes and records.

```text
bun .claude/skills/whole-run-investigation/scripts/wri.ts climb <campaign dir> [--json]
```

[The climb reference](../whole-run-investigation/references/climb.md) owns the reading: the line and
its four numbers, the edge labels and the rows to read beside them, which reader answers which climb
question, what to read when a placement does not match the battery you saw, why a published limit,
a reviewer finding or a zero score is a lead and the case bytes are the measurement, and the walk
that finds the one link holding a flat line. Two rules stay here because they decide what this loop
does next. Before attributing anything to the Builder, run `git show <opening source.commit>:<path>`
for every surface your explanation depends on: a page absent there is an unmeasured surface and a
prediction for the next launch, never a Builder failure and never a reason to patch the page again,
since it was never delivered. And a reviewer finding cannot stop the battery that raises it, so when
one contradicts a standing prompt instruction, one of the two owners has to move, and the recorded
cases decide which.

### `[fullrun]` lines in your terminal during a gate are test fixtures

`test/climb-loop.test.ts` and its siblings print the controller's own log lines, including a
literal `api_error status 429: You've hit your session limit · resets 4pm (Europe/Amsterdam)` and a
project id that looks like a campaign. A gate run will interleave them with whatever else is on the
terminal. The live run's state is in its own log, which `lsof -p <pid>` names, and nowhere else.
On 18 September those fixture lines read as a provider outage on a run that was working normally.

### On a deviation

On a deviation read `campaign.ts --campaigns <dir> --run <id> --json`, then the named evidence. The
case ledger can be legitimately empty during a real battery. A live pid alone proves nothing, a
stale timestamp is a lead, and unknown usage is `null`, never zero. The watch names a blocked
Builder session once per epoch; [builder-blocking-loop](../builder-blocking-loop/SKILL.md) owns it.
A disk-floor deviation suspends new launches until resolved. Do not poll unchanged runs.

While a run is live, read nothing that opens its writable state — its sqlite ledger, its lock files,
anything under its campaign the controller writes. `productHistoryDirs` opens the `ControllerLedger`
on the live campaign's database, so rendering one advisory note costs a risk to a paid run. Defer it
to the terminal and say that is what you did. There is
no live provider-spend row: the controller records spend at the terminal, so a threshold on it
could only fire after the run it was meant to interrupt.

## 6. Close and assess from recorded bytes

Every terminal gets closure, including a short or zero-case run:

```sh
bun .claude/skills/run-improvement-campaign/scripts/campaign.ts \
  --campaigns /absolute/campaigns --run <runId> [--json]
bun .claude/skills/run-improvement-campaign/scripts/prediction.ts adjudicate \
  --run <runId> --id <prediction-id> \
  --outcome sufficed|partial|refuted|untriggered --evidence "<path and finding>"
```

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

Weight the **latest two runs** unless the operator widens it. Older runs measured older source; a
count from five runs ago describes a product that no longer exists. Compare runs of unequal length
over the shorter one's elapsed window and name that window. Changed tasks, verifier or models
change the measured condition, so a higher score alone proves no improvement. Fetch main and read
the ledger before adjudicating: another session may have closed the rows, and the ledger is
append-only. When a later PR retires the mechanism a row names, note the retirement beside the
row's outcome instead of freezing a replacement.

Subagent and reviewer reports are model output, not authority. Check every finding against the
source before acting on it.

### Track what the gate and the checks did, and backtrack a correction

A score says nothing about what the gate cost to reach it, and an evaluation correction changes the
exam without saying what the old answers were worth under it; neither shows in a denominator. So
every round, not only on a suspicion, read the `gates` lane and run every `replay --under` it lists.
Nine consecutive firmware corrections once went by with none regraded.

```sh
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.ts gates <campaign dir> [--json]
bun run replay -- <campaign>/<earlier runId> --under <campaign>/<corrected runId>
```

What an episode's ending and a replay's flips mean is lanes 27 and 28 of
[the catalogue](../whole-run-investigation/references/review-angles.md) and the `gates` lane in
[the deterministic lanes](../whole-run-investigation/references/deterministic-lanes.md); whether a
component keeps its place is [the gate audit](../whole-run-investigation/references/gate-audit.md),
where the lane's table goes. Read a stalled episode as a round lost to the gate rather than to the
domain. Nothing records a replay or reads its report, so its flips inform this round's judgement
while the advice still names the correction's issues `unmeasured`.

### When two batteries miss the band the same way, stop editing prose

Two batteries of one product off the band on the same side are a settled result, not an ambiguous
signal needing more diagnosis (AGENTS.md "While it runs"). They say the authoring loop cannot yet
author above this solver under the surfaces the run was served, and those surfaces are frozen at
its opening. A run of full passes is the common case (AGENTS.md "Goals and the climb", under "The
goal"). The stall `bun run runs pulse` names is a later point on the same line, and stopping there
is the operator's (§7).

On 18 September the second battery settled 6 of 6 at 08:26 with every case solved in one turn and
the tightest margin 6.7% under its limit, against the author's own pre-registered "at most 2". The
next two hours and fifty minutes went into eleven stacked pull requests, every one of them a
sentence removed from model-visible text, and a containment check in the middle of them recorded
that the live source predated the first of the stack. None of that work could reach the run it was
reacting to.

Before reacting to a live run at all, check containment: `git merge-base --is-ancestor <fix>
<opening sha>`. A commit that is not an ancestor of the run's opening cannot change that run,
whatever it fixes. Every patch written during a battery is work for the next launch, and calling it
a response to this one misreads both.

So on the second one: stop opening pull requests against any authoring surface, and write the
operator one message holding both batteries' verified counts, each case's turn count and margin to
its governing limit, what the Builder changed between them as `wri.ts climb` reads it, and one
named next experiment. Then wait. Work on an authoring surface after that point is work for the next
launch, and it should be scheduled as such rather than presented as a response to this one.

Why the line stayed flat is then a reading for the next launch, not an edit to this one.
[The climb reference](../whole-run-investigation/references/climb.md) walks the chain to the one
link that held it, including which sentence the Builder cited when it declined a stricter demand
(lane 36) and what its prose and notes say each round set out to do. That constraint is where §1
starts.

### Lifted, held or unreached: the constraint ledger

After adjudication, read the constraint at its own link first and on the line second. It is one of
three:

- **lifted**: the link moved and the line followed. Walk the chain again for the next constraint.
- **held**: the link moved and the line did not, so the constraint was misnamed. Restart the walk
  from that link, with this pass's rows as its evidence.
- **unreached**: the link did not move, so the change never did what it was for. Fix its path
  (§2), containment included, before naming another constraint.

Each pass writes one row to the local `notes/binding-constraints.md`, which is never published: the
date; the runs read; the constraint, as its link, its owner and its evidence with denominators; its
falsifier; the change, as PR and sha; the prediction ids frozen for it; and the outcome, once
adjudicated. The next pass reads it first. The ledger, these three outcomes and the Meta Agent's
`constraint` row were added on 2026-09-30 and have not yet been exercised on a recorded pass, so
the first passes that write it test the rule as well as the product; record where a pass did not
fit the row rather than bending the row to fit.

## 7. Decide the next move

The constraint's outcome (§6) comes first: it says whether the next move is a walk for a new
constraint, a walk from the same link, or a repair of the change's path. Then choose one: retain
and measure; fix the demonstrated owner; delete a mechanism with no consumer or
no decision effect; investigate a consequential ambiguity; or stop because the authorised programme
or the allowance ended, or because a run's climb stalled. The product owns its own within-run climb
and rebuild decisions, but never stops on one: a stall, as AGENTS.md "Goals and the climb" defines it
and `bun run runs pulse` names it, is the operator's to stop. Whether a
new wave of runs improved on the one it replaced is a [wave-audit](../wave-audit/SKILL.md), read
at the first battery, the third round and the terminal.

The goal that choice serves is the **healthy, ambitious climb** AGENTS.md "Goals and the climb"
owns, and what fails it is listed there under "Healthy" and "Its shape, and how progress is read".
Of two candidate moves, prefer the one that brings the next battery closer to the solver's limit on
a changed public requirement, provided every fail it could produce is earned on a published rule, and
weigh it against the run's line rather than its last zone: a move after which the line would sit at
n/n where it sat has not served the goal.
[The climb reference](../whole-run-investigation/references/climb.md) says how to read the four
numbers that show whether the line moved.

Track the four evidence levels separately — present in source, deterministically proved,
live-exercised, outcome-proved — and never let one stand in for the next. Keep negative results and
their limits intact. A live run is not a reason to keep changing code without a demonstrated need.

When you are choosing that move about the loop itself rather than the product,
[superloop-completeness-review](references/superloop-completeness-review.md) holds five lenses to
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
| read | `whole-run-investigation` rows A to I, then the safeguard census, then a diff of the campaign's adopted versions, then `wri.ts climb` once the campaign has two edges, then `wri.ts gates` and a `replay --under` for every correction it lists | its semantic lanes, the number the tier allows, when a recorded row stays unexplained; `whole-run-investigation`'s [climb reference](../whole-run-investigation/references/climb.md) on any climb row the watch printed, and whenever a transition needs attribution |
| adjudicate | `prediction.ts adjudicate` for every row, ledger kept in the local `notes/predictions/` | `attribution-and-proof` before any sentence claims improvement |
| diagnose | read `notes/binding-constraints.md` first and write this pass's row (§6); whenever two batteries miss the band the same way, `wri.ts climb` prints `flat: yes` or an adjudication is `refuted`, walk the chain per the [climb reference](../whole-run-investigation/references/climb.md#find-the-binding-constraint) | Luna lanes through `codex-luna-swarm` for the cross-run count at one link; `bounded-investigation` when a link is disputed |
| patch | fix on the owning PR; `simplify` on each diff; record the `system-path-simulation` proof choice and its result | `safeguards` when a fix adds a decision no record observes; a fresh replay when existing evidence does not cover the changed consumer |
| compose | merge in the compose tree, prove every head an ancestor; let `launch-run` own its one gate | `stack-hop` and `intelligent-rebase` when PR order changes or two fixes touch one file |
| launch | `launch-run`, freeze before the opening, detached watch, next wake | `whole-run-investigation`'s [outcome reference](../whole-run-investigation/references/outcome-review.md) assesses a suspected stall; a stop executes only under existing authority |
| weekly | the first wake on or after Monday 00:00 UTC runs the `safeguards` removal review and `weekly-run-review`, and writes the date in the snapshot | |

## What has actually cost time here

Keep this list short and current; replace an entry when its lesson is absorbed elsewhere.

- Blind gate retries. A push gate that dies at the 3600 s wall with no failing step named is a
  spinning step, not a slow suite: find the process holding the CPU first. Two blind retries cost
  two hours on 2026-09-07.
- Asking a session for a cause without giving it a falsifier.
- Naming a composed sha before the last head was pushed; it went stale within the hour.
- Freezing predictions after the opening, leaving rows only Git history dates before the run.
- Adding a mechanism whose trigger no recorded campaign reaches.
- Treating a provider 429 as a harness defect, or a harness defect as a provider 429. Only an
  explicit exhaustion message is exhaustion; investigate everything else.
- Running a reader from the run's tree or from an open stack, reading its empty field as an absent
  signal, and missing an alarm that fires from main. Two hours on 2026-09-18.
- Eleven pull requests against model-visible text after two batteries had shown that text is not the
  lever, none of them in the live source. Two hours fifty on 2026-09-18.
- Reading the climb only after a claim lands, when the adopted bytes carried the same verdict four
  hours earlier.

Upgrade this Skill when a cycle exposes duplicated work, missed closure or a wrong decision.
Replace the obsolete rule at its owner. Do not accumulate a checklist, a runtime layer, a scheduler
or another review component. Keep only instructions that change the next decision.
