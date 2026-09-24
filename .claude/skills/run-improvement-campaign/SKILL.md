---
name: run-improvement-campaign
description: "Run the improvement loop: choose one change, prove its path, freeze a prediction, launch, read recorded bytes, decide the next move. Owns experiment selection and evidence reading; the product controller owns build, measure, climb, rebuild, claim and promotion."
---

# Run improvement campaign

The loop is **choose → prove → predict → launch → watch → assess → decide**. It exists to answer
one question at a time about the product, and its only currency is recorded bytes. This skill
selects experiments and reads their evidence. It never repairs controller output, never
hand-writes a bundle, and never lets a model's prose stand in for a receipt.

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
straight to main, and `notes/**` stays local; a document coupled to unmerged source stays with that source. Skill *scripts*
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
terminal", "the next battery's verified count falls by at least three of 25". "Improves" is not a
prediction. Several changed mechanisms make a composed-system test: it can prove operation, while
a causal claim needs a controlled replay or a matched comparison.

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
  counts against it in full. When the question needs several rounds, give a generous boundary or
  omit it. The last two runs reached three and two iterations; a repeat refusal cannot fire before
  round three.

Credentials stay where they are. Point at the main checkout's `.env` with `--env-file`; never copy
an env, campaign, domain or config file between checkouts to make a command start. Report a missing
or drained credential — do not substitute another account's token.

Read the launch result. Verify the opening's full SHA, clean source, prompt, budget and all three
model slots; a mismatch is a failed condition, not a relabelled one. Startup proves no useful model
work. If the gate refuses, fix the finding at its owner and relaunch; a refusal before any provider
call costs nothing but time.

## 5. Watch quietly

One watcher covers all live runs:

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

**When a reader is attending, drop `--every` and run one pass per reply**, started as the last
action of each message so the next tick lands about 270 s later — inside the 300 s prompt cache, and
longer whenever the reading itself takes longer, which is the intended cost. A single pass is an
attended tick: each watched run's status, then every row it holds, info included, and exit 0.
Without `--state` the same command is the status report alone, with the per-file table when it
names one run and `--json` for the whole reading. The detached `--every` watcher stays deviation-only and holds info rows for the next
stop row, because nobody is reading it.

A watch is a process, so check for the process. On 2026-09-18 the last state file was written at
08:31 and `pgrep -f` for the watcher was empty from then until 18:50: the i03 claim and the i04 climb
decision both landed inside that window and neither was watched. A state file's mtime tells you when
a watcher last ran, never that one is running now.

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
(AGENTS.md's `no-difficulty-evidence`: no capability rate, no difficulty strike, nothing to patch
against), and on five typed non-results in a row — rule 6's threshold for stopping the schedule.
A completed run that verified cases carries no act at all.

### A battery mid-solve is silent, and that is not a stall

A Built solve writes nothing between the case starting and its verdict, so every mtime the watch
can sample freezes at the second the battery opened. Run `c1d2a7` held three cases open for 38
minutes on 2026-09-18 with `evidence 38 min ago, session wrote 38 min ago`, and the old rule would
have called it stalled at 120. The watch reads the **cases the battery has open** — one directory
per case under the retained version — against the harness's own `solve_minutes` from its accepted
`agent/config.yaml`. Under that wall the silence is work and no row fires; past it the host stopped
enforcing its own ceiling and the stall row is right.

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

The watch also reads `difficulty-decisions/`, the controller's own `ClimbAction` per battery, and
prints one row as each lands: `battery run-i02: placed, 24/25 too-easy`. This is the half a score
cannot show. A high score says the battery was easy; only the decision says whether the next one
asks for more, and only a run of them says whether asking worked.

- **three batteries in a row placed `too-easy`** is one `overhaul` row: the level moved and no
  battery found the limit. The streak reads the zone the band recorded, counted in batteries, since a
  `--run` continuation can decide one battery twice. Campaign `3fd52f9e-28` recorded seven such
  placements while its Builder moved only published magnitudes. Rebuild what the tasks demand, not
  their numbers.
- a `placed` decision moves by its zone: `too-hard` is `reserved`, and the other four zones are the
  band reading its own score, printed as `info`. Of the other three actions,
  **`repeated-failure-set`** and **`family-conflict`** are `surgical` and **`no-difficulty-evidence`**
  is `overhaul`.

The decision reads the score. `wri.mjs climb` reads the other side of the same question — the
task bytes — and unlike the decision it works on a battery that has not scored yet:

```text
bun .claude/skills/whole-run-investigation/scripts/wri.mjs climb <campaign dir> [--json]
```

Per battery it prints the check-tier histogram and a median structural row; per edge, one of
`restated`, `adjusted`, `narrowed`, `widened`, `eased` or `escalated`. Only `escalated` changes what
the solver has to reason about. Run it whenever a new `versions/<battery>/` directory appears, and
at every read step on a campaign that has landed off its aim twice. It is read-only, it costs
nothing, and it is the only reader that answers "did anything get harder" before the battery it
describes is paid for.

Run `c1d2a7`, read this way on 18 September while its fourth battery was still measuring:

| edge | verdict | what moved | outcome |
| --- | --- | --- | --- |
| i01 → i02 | `widened` | +3 inputs, +3 scenarios, 305 numbers moved by 8.33% median, novelty 0.0000 | 6/6 |
| i02 → i03 | `adjusted` | +1 input, 12 numbers moved, novelty 0.0038 | 6/6 |
| i03 → i04 | `escalated` | +2 checks, +1 limit, +1 tooled check, +2 rules, +36 inputs; frontier 0 → 2 | unobservable |

The tier histogram held at `easy 0  medium 9  hard 6  frontier 0` for three batteries and moved only
at the fourth. Those three — eighteen solver cases at roughly fifty minutes each — bought no
difficulty evidence, and the score could not say so: all three read 6/6, which reads identically
whether the tasks moved or not. A campaign whose last two edges are `restated`, `adjusted` or
`widened` is not climbing, whatever its `ClimbAction` says. Read the edge before writing the round
up, and do not describe a battery as adding a constraint class until this reader shows the checks
that carry it.

### The surface you steer with may not be in the measured tree

A model-visible page — a starter file, a prompt section, a tool description — steers a run only if
it is an ancestor of the run's own `source.commit`. `c1d2a7` opened at `e97f8e703`, and the
starter's `difficulty-ladder.md` was on the open stack and on no ancestor of it: four rounds were
read against a page the run could not see, and the reading would have blamed the Builder for
ignoring it.

So before attributing anything to the Builder, read `source.commit` out of `opening.json` and run
`git show <commit>:<path>` for every surface your explanation depends on. Absent means the run
measured a condition your reasoning does not describe. That is an unmeasured surface and a
prediction for the next launch, never a Builder failure — and never a reason to patch the page
again, since the page was never delivered.

### Which reader answers which climb question

| you want to know | read | not |
| --- | --- | --- |
| whether the next battery will be asked for more | `difficulty-decisions/`, the `ClimbAction` the watch prints | the score |
| whether the tasks actually got harder | `wri.mjs climb` edge verdicts and the tier histogram | the level label, new task ids, or a longer description |
| whether a page could have steered the Builder at all | `git show <opening source.commit>:<path>` | the working tree or the stack head |
| whether the Builder read a starter file | the authored `EXPERIMENT.json` and the bundle bytes | read counts in `builder-path-record.jsonl`; the Builder reads through bash, so zero proves nothing |
| whether a battery is hard or merely unsolvable | `artifact.json` beside `public-task.json` in the settled cases | a reviewer finding, a published limit, or a zero score |
| whether a slow solve is the wall | `solver.toolCalls` in `case-result.json` | `max_turns` or the solve wall, which no recorded truss case approached |

Open [the climb reference](../whole-run-investigation/references/climb.md) on any of these: it owns the attribution, the goal
these rows serve — a battery inside `climb.band`, 5 to 12 verified of 25, on a named changed public
requirement — and the difference between a harder battery and a differently-labelled one.

### A round the loop threw away looks exactly like a round that changed nothing

The one row that decides whether a climb is stuck is the battery's score, and a battery can be
measured, recorded, and then removed from the difficulty population without the decision saying so.
Check that before concluding the Builder is repeating itself.

On 18 September the truss run `…c1d2a7` scored 6/6 three rounds running, and its fourth battery
scored 3 of 5 — the first failing cases of the run, against the Builder's own pre-registered
`at-most 2`. The decision written for round 5 said `"6/6 … significantly too easy"` with
`"admitted": 3` and `"excluded": []`, and its digest was byte-identical to round 4's. Battery i04
was in neither list. Two readers had removed it, and the chain runs:

1. the battery's claim was refused — here for one clause, `runtime-model-identity-unproven`, after
   a transient provider disconnect lost one of five cases' identity records;
2. a refused claim leaves the candidate's claim stage at `measured`, so promotion **held** it;
3. a held version is not an adopted version, so `productHistoryDirs` did not offer its run
   directory to `admitBattery`, which is where a battery earns its named exclusion;
4. the next round therefore reseeded the Builder from the last **adopted** product — round 3 — so
   the authored bundle of the one experiment that worked was rolled back as well.

Steps 3 and the identity double-read are fixed in PR #804. **Step 2 is not**: a candidate whose
claim was refused only for unproven model identity still loses its authored product, and the next
rebuild starts from the round before it. That is an open decision for the operator, because the
gate it would widen (`candidate-claim-refused`) exists for a real case — run a7f9ac, where a
session limit cut a battery to 14 verified and 11 non-results and its refused-claim candidate
replaced a product measured at 24/25.

What to read, in order, when a decision's placement does not match the last battery you saw:

- `campaigns/<slug>/claims/<battery>.json` — `claim.ok` and the clause names;
- `campaigns/<slug>/promotions/<battery>.json` — `decision`, `promoted` or `held`;
- the run's own `fullrun.log`, which names both in one line each;
- the decision's `admitted`, `excluded` and `evidence[]`, and whether the battery is in any of them.

### `[fullrun]` lines in your terminal during a gate are test fixtures

`test/climb-loop.test.ts` and its siblings print the controller's own log lines, including a
literal `api_error status 429: You've hit your session limit · resets 4pm (Europe/Amsterdam)` and a
project id that looks like a campaign. A gate run will interleave them with whatever else is on the
terminal. The live run's state is in its own log, which `lsof -p <pid>` names, and nowhere else.
On 18 September those fixture lines read as a provider outage on a run that was working normally.

### Read the edge before you pay for the battery

`wri.mjs climb` reads its tier histogram and its structural row from the authored bytes under
`versions/<battery>/`. Neither needs a case. So the newest edge verdict exists the moment a
candidate is adopted, hours before the battery it describes has been measured, and the reader says
so: on 18 September it read the still-unmeasured i04 as `undated, unclaimed, no verified case` and
printed its complete row beside the settled three.

Run it when the version directory appears, not when the claim lands. Campaign 3fd52f9e-10's second
and third rounds were `widened` and `adjusted` in their adopted bytes, and each then spent about
four hours of solves to confirm a 6 of 6 that settled nothing. Novelty across those edges ran
0.0000, 0.0038, 0.0884: the round that changed what the solver must reason about is an order of
magnitude away from the two that did not, and it is legible before a single case runs.

Every verdict but `escalated` says this battery asks the solver for nothing the last one did not.
That is a reading, not a stop order: the product owns its own round, and a round already in flight
finishes and records. It is the moment to write the next experiment rather than to wait four hours
for a score that cannot surprise you.

### A limit read from the task file is not yet evidence

Run `c1d2a7` published every task's `massLimitKg` to three decimals — the catalogue mass of its own
stored reference design — and compared it "with a tolerance of 0 kg". Read that way it looks
unreachable, and its Epoch Reviewer called it a `curriculum-defect` with 39 probes behind it. Five
commits were written on that reading before the first cases settled and refuted it: all three
passed, with accepted designs at 202.07 kg against the 253.192 kg limit, 213.166 against 336.197 and
434.616 against 710.678, in 45 to 59 solver tool calls. The limits were 20 to 39 per cent loose.

What that measured is the Builder's reference search, not the tasks: a bounded search lands well
above what a capable solver with a shell reaches, so a limit at the author's own best clears
easily. Headroom above it makes a loose limit looser, and F2 already refuses a limit the reference
cannot meet. The gate wall does not bind that search either — `STARTER.md` tells the Builder to
store the search's best artifact per task under `reference/` and replay it inside the wall, which
`c1d2a7` did with a 17-line `index.ts` over 2351 lines of stored geometry. What binds is the
authoring session, so the dial is method rather than effort: the solver spends a whole per-task
wall searching while the Builder has one session for the whole battery. The lever a reviewing
session holds is the authoring text, never the bundle.

So wait for the case bytes. A published limit, a reviewer finding and a zero-pass score are each a
lead; `artifact.json` beside `public-task.json` is the measurement. When a battery does pass
nothing, read what blocked every case — an unpublished rule, a submission path a correct answer
cannot use, a requirement no published tool can meet — before reading the battery as hard.

A reviewer finding still cannot stop the battery that raises it: a `curriculum-defect` is never
repairable in its own session (`epoch-review-public.ts`), because its public act is "vary this in
the fresh battery". When such a finding contradicts a standing prompt instruction, one of the two
owners has to move, and which one is a question for the recorded cases, not for the finding.

The walls are not what stops a solve, so do not reach for them. Across every recorded truss case,
`solver.turns` and `solver.completedTurns` are 1: the pi loop spends one turn and calls tools inside
it, so `max_turns` is never approached and a number of turns means nothing to the solver. The
measure that moves is `solver.toolCalls` in `case-result.json`, and beside it the margin between
each accepted value and its published limit. Those two decide what a ceiling battery means: `c1d2a7`
scored 6 of 6 twice, and the per-case rows say every case settled in one turn with the tightest
answer still 6.7% inside its limit and the loosest 30.8%. "Passed 6 of 6" invites a harder battery;
"passed 6 of 6, first turn, a third under the limit" says the axis being moved is the wrong one. Campaign `3fd52f9e-28`, the most
recent: median 24 calls and 11.5 minutes of a 120-minute wall, longest 68 calls and 43 minutes, and
the cases it failed took 43 calls on average against 25 for the ones it passed. `846c029d-3` is the
contrast, at exactly 4 calls and 0.4 minutes in all 460 accepted cases — the regime whose proposer
tool was the reference solve. A solver using a tenth of its time is not held back by its budget.

Freedom is recorded, so do not infer it. `builder-path-record.jsonl` carries one row per guard
decision: `c1d2a7` took 85 with zero refusals, exposed 15 tools and used 7, and left every wall in
`agent/config.yaml` at its seeded default though each is raisable tenfold. A thin bundle from a
session like that is a choice the prompt shaped, not a session the host boxed in.

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

### When two batteries miss the band the same way, stop editing prose

Two consecutive batteries of one product outside the band on the same side is a settled result, not
an ambiguous signal needing more diagnosis. It says the authoring loop cannot yet author above this
solver, and it says the binding constraint is not the wording of any instruction, because the
instruction channel is exactly what the two batteries held fixed.

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
its governing limit, what the Builder changed between them as `wri.mjs climb` reads it, and one
named next experiment. Then wait. Work on an authoring surface after that point is work for the next
launch, and it should be scheduled as such rather than presented as a response to this one.

Read the Builder's own `EXPERIMENT.json` before judging the round. It states the gap the Builder saw
and the target it set itself, and a score cannot. The fourth round of 3fd52f9e-10 opens "every rule
the harness enforced was a rule about members", adds two public checks from a published joint
standard, and pre-registers about 1 of 5 passing with a stated fallback if 4 or more do. That is the
mechanism working, and no reading of the three flat rounds in front of it would have predicted it.

## 7. Decide the next move

Choose one: retain and measure; fix the demonstrated owner; delete a mechanism with no consumer or
no decision effect; investigate a consequential ambiguity; or stop because the authorised programme
or the allowance ended. The product owns its own within-run climb and rebuild decisions.

The standing goal for that choice, set by the operator on 2026-09-18, is to **optimise the climb
towards really hard tasks**: prefer the change that shortens the run of `too-easy` placements before
a battery lands inside the band. A change that raises a score, adds tasks or renames levels without
moving a placement off `too-easy` has not served it. [the climb reference](../whole-run-investigation/references/climb.md)
holds the two recorded numbers that say whether it moved.

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
| read | `whole-run-investigation` rows A to H, then the safeguard census, then a diff of the campaign's adopted versions, then `wri.mjs climb` once the campaign has two edges | its semantic angles, at most five lanes, when a recorded row stays unexplained; `whole-run-investigation`'s [climb reference](../whole-run-investigation/references/climb.md) on any climb row the watch printed, and whenever a transition needs attribution |
| adjudicate | `prediction.ts adjudicate` for every row, ledger kept in the local `notes/predictions/` | `attribution-and-proof` before any sentence claims improvement |
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
