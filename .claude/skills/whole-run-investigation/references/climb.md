# Reading the difficulty climb

One question sits under every climb reading: when the product scores well, does the next battery
get harder for a reason you can name? The verifier owns correctness and the controller records a
placement, but neither writes a task. This reference reads what they recorded, says whether a
battery got harder or only different, finds the link that holds a flat line, and proposes the one
change worth making. Inside a whole-run
investigation it is the `climb` lane's ground and the reading behind lanes 5, 6, 9, 10, 11 and 20,
and behind the authorship lanes 33 to 38 wherever a climb depends on what the Builder wrote.

What the climb is for, the band and its zones, who hears the placement, what the Builder is asked
and the incidents behind each of those rules live in AGENTS.md "Goals and the climb", and this
reference does not restate them. It says how to read a recorded run against that section: which
command, which rows, and what each row can and cannot say.

## The line

Progress is read on a line rather than a zone (AGENTS.md "Goals and the climb", under "Its shape,
and how progress is read"). `wri.ts climb` draws it from the claimed batteries, adopted or not, in
claim order and on the counts the controller placed, so a case a review settled against its check
counts neither way. Below the batteries and edges it prints four lines:

| line | what it counts |
| --- | --- |
| `velocity` | the batteries between 1/n and n−1/n and which ones, how many sat on the aim, passed whole or passed nothing, and the mean swing in points a battery: AGENTS.md's *signal* and *swing* |
| `horizon` | the same signal count over the first 8 and the first 12 batteries |
| `flat` | whether the latest batteries meet the stall `runs pulse` names, `STALL_BATTERIES` (`tools/runs/pulse.ts`) in a row on one side of the aim with none closer than the closest before them |
| `carried` | the tasks measured again unchanged in id, public input and family checks after a full pass |

Read these before any zone. `--json` carries the same line as `climb-velocity/v2`; a `v1` reading in
an older archive holds an endpoint slope under `velocity` instead, which read truss-sol-198d70 and
reserve 6a8ca0 identically and gave custom-sol-f0fb83 "50 more at this rate", so do not compare the
two. Across the 50 local runs with two or more claimed batteries on 2026-09-30, 26 of 277 placed
batteries carried signal and 251 were full passes.

Each edge between consecutive adopted versions gets one structural label from the check tiers and
counts in `brief.json` and `tasks.json` (`verdictOf`, whose meanings the header of
`scripts/climb-velocity.ts` lists): `restated`, `adjusted`, `narrowed`, `widened`, `eased`,
`escalated` or `replaced`. The label needs no case, so it exists the moment a version is adopted,
hours before its battery scores. It is a reading and not a forecast (AGENTS.md "Goals and the
climb", under "Reading the climb as the operator"), so name the changed public requirement from the
task rows beside it, and read the edge's novelty, numbers moved, delta and `carried` rows with it.
`adjusted` names no direction, because a moved limit is a climb only when it moves inward, and
`replaced` is no reading at all: fewer than half the task ids carried over, so the task bytes need
reading by hand. A rule published in another `correctness-model/` file moves neither task-side row;
the source row names which of those files changed digest.

Three recorded edges show what the rows beside a label add. Truss c1d2a7's tier histogram held at
`easy 0  medium 9  hard 6  frontier 0` for three batteries, eighteen cases at roughly fifty minutes
each, and all three read 6/6, which a battery reads whether its tasks moved or not. Its first two
edges read `widened` at novelty 0.0000 and 0.0038, and its third, `escalated` at novelty 0.0884, was
the one that changed what the solver had to reason about; that was legible before a case ran. One
firmware run's edge on 2026-09-28 read `escalated` with every structural count unchanged and then
passed 6 of 6, while its next edge read `widened` at novelty 0.27 with two new families and scored 2
of 6, so new tasks and scenarios can ask more at an unchanged tier. And truss-sol-2d7812's new load
sites and forbidden volume read `widened`, two inputs more, which only the task rows name as a new
requirement.

## Find the binding constraint

A flat line is held by one link of the chain a round runs through, and the useful reading names
that link rather than every fault on the way. This section is a method and holds no findings: a
constraint an earlier note named enters here as a hypothesis to test on this run's bytes.

The chain, in the order a round runs it, and what tests each link:

| link | what can hold the line there | tested by |
| --- | --- | --- |
| what the Builder is told | a surface that asks for less than the round needs, or gives a reason to decline ("What the round was told") | lane 36; lane 17 on the `handoff` census table |
| the tasks, limits and checks it writes | a demand that did not move, or moved only in size | the edge label and `carried` row of `wri.ts climb`; lane 20 on 3c `REPEATED CONDITION`; lane 31 |
| the reference and witness solve | limits at the reference's values; a reference that replays stored answers | lanes 33 and 5, on 1c `PERFECT BATTERY OVER AIM` and block 1 `UNTRIPPED IN SHIPPING` |
| rehearsal and submit | bytes submitted untested, or on one passing rehearsal | lane 11 on 6 `SUBMITTED BYTES NEVER REHEARSED`; lane 9 on 6 `REHEARSAL NOT-RUN` |
| the solver | a wall the Builder set; a tool or program that grades a candidate | the `walls` lane and lane 22; lane 34 on 1b `CHECK CODE IN SOLVER REACH`; lane 23, isolated, on 1b `CHECK TOOL IN SOLVER TRACE`, with lane 34 beside it |
| the checks | a check that observes too little, or refuses right answers | lane 6 on 1c `REACH-ONLY CHECKS`; lane 35; lane 38 on 3b `FAMILY UNMOVED all-fail` |
| admission and placement | a refusal that cost the round, a battery held or excluded, a size set on unaccepted cases | lane 27 on the `gates` triggers; row B and the readout's `admitted` and `excluded`; row G; lane 24 on 4c `DECISION ON CENSORED BATTERY`; lane 37 |
| the readout back to the Builder | a reading that never reached the next round, or reached it and was declined | the `handoff` tables and lane 17; lane 10 on 4b `OFF-AIM STREAK`, with lane 36 beside it |

**Test the capping links first.** A grader the solver can reach, a wall that stops the solve before
the task does, and limits set at the reference's values each cap the line whatever the demand says,
so read lanes 34 and 23, the `walls` lane and lanes 5 and 33 before any link upstream of them. A
change aimed at the demand while one of these holds is spent on nothing. The mirror case is a check
that refuses right answers (lane 38): it makes a battery read partial, so a line that seems to have
moved may be held by a check rather than lifted by a task.

**Walk back from the flat battery.** Start at the latest full pass and step back one link at a time,
asking whether this link explains every symptom after it. The constraint is the earliest link that
does. A later link showing some of the symptoms is contributing, and an earlier one that explains
nothing downstream is not the constraint however wrong it looks. Keep an original defect apart from
a failure to diagnose or repair it: a reviewer finding the Builder declined is a readout link, and
the defect it named sits at its own link. Where two links bind only together, name the pair. Limits
at the reference's values and a solver holding the reference's method were one such pair on reserve
6a8ca0 (AGENTS.md "Goals and the climb", under "What the Builder is asked, round by round"), where
tightening alone was met by the same optimiser. At each link, ask what the round's incentives made
sensible: a sentence, a tool description or a gate can make the locally reasonable choice the one
that keeps the line flat, as the kickoff's wording did for the Builders on 887c163ee that declined
every stricter demand (same section).

**Name a rival that predicts a different observation.** For the leading link, state its strongest
innocent explanation, such as a solver that really is that capable or a request whose field has no
harder requirement, and the recorded observation that separates the two. Where no recorded
observation does, say so and choose the smallest discriminator rather than a confident story.

**Look across runs.** A constraint read on one run is a hypothesis about the product. Count how many
recorded runs broke at the same link by replaying the exported reader over every campaign on disk
(`readClimbBatteries` and `readClimbReadout`, `wri.ts climb --json` per campaign, `wri.ts census` for
the gate) rather than re-deriving each reading by hand. Count distinct runs and conditions, not
reports, since two notes about one run are one observation, and a run whose round never reached the
link is no opportunity, neither a break nor a hold. Count within one kind of domain before claiming
a transfer. Limits at the reference's values bind where a longer search finds a better answer, in
the optimisation domains (truss, reserve, buffer). A conformance domain such as firmware has no
optimum to search, and on 2026-09-30 its flat line read at the tasks' demand and the round's length
instead.

**Hand over one constraint.** The output is the link, the owner of the bytes that would move it (a
bundle file, `environment`, `controller-source` with the file named, or `judge`, as the catalogue
names owners), the observation that would disprove it, and the cheapest test that separates it from
its rival: an existing receipt or a deterministic replay before a live probe, and a live probe at the
smallest layer `system-path-simulation` can decide before any paid run. That goes to
`run-improvement-campaign`, whose experiment choice turns it into one change and one frozen
prediction.

## Who can move difficulty

The controller writes no task and states no course, so every change in difficulty is the Builder's
choice, and a climb that stalls is a question about what the Builder was shown and what it chose.
Which component hears which reading is AGENTS.md "Goals and the climb", under "Who hears the
placement, and what it drives". Check it in the measured tree rather than from memory: the
`ReadoutRow` comment in `src/run/climb-readout.ts` names the fields that are the controller's and the
reviewer's, and `readoutHistoryDocuments` strips the zone, aim, `toAim` and Wilson interval from every
row before the Builder's history source is built. The off-aim streak the digest prints is
`offAimStreaks` in `scripts/digest-ledgers.ts`, computed from the recorded placements, and nothing in
the run reads it. Lane 36 asks what pressure the round text put on the Builder towards harder tasks,
and lane 10 whether its calibration improved round over round.

The Builder's freedom is recorded, so read it rather than infer it. `builder-path-record.jsonl`
holds one row per guard decision: c1d2a7's Builder took 85 with no refusal, used 7 of the 15 tools
exposed to it, and left every wall in `agent/config.yaml` at its seeded default although each can
be raised tenfold. A thin bundle from a session like that is a choice the prompt shaped, not a
session the host boxed in.

## The record the controller wrote

`recordDifficultyDecision` (`src/run/difficulty-decision.ts`) writes one file per round at
`difficulty-decisions/<runId>-<digest>.json`, holding `schema`, `runId`, `slug`, `digest` and
`difficulty`, the `ClimbReadout` itself. The schema is `difficulty-decision/v10`, and a reader takes
that and refuses any other, because an earlier version could carry a field of the same name that
meant something else: v6 set a battery with a repeated failing core aside with no placement, where
v7 on places it and states the core beside it. The record carries no wording revision, since v9
dropped the frame revision v8 carried. From v10 a row's `verified` and `passed` leave out the cases the
battery's completed review settled against the one check that decided them, and `settled` counts them.

Inside the readout, read these fields and nothing looser:

| field | what it says |
|---|---|
| `band`, `admitted`, `excluded` | the band the run measured against, how many batteries `admitBattery` let into the history, and what `excludedSummary` names as left out; zero admitted beside exclusions means every measurement was refused, not that nothing ran, and an exclusion is the usual reason a climb looks stalled |
| `decision.placement` | `placeOnBand` (`src/claim/battery-difficulty.ts`) over the deciding sample, or null when no battery is recorded, every attempt was refused at submission (`refused` says how many) or the sample could not be placed |
| `decision.repeated` | the failing core the last two batteries of one task set share, as `cases` and the two `scores`, stated beside the placement rather than instead of it |
| `decision.conflict` | one family significantly too easy beside one significantly too hard, named as `easy` and `hard` |
| `decision.censored` | families the environment censored whole, about which the placement says nothing |
| `decision.evidence` | every battery the decision derives from, by `runId` and `batterySha256` |
| a row's `zone`, `aim`, `toAim`, `wilson` | the zone `placeOnBand` gave, as AGENTS.md "Goals and the climb" defines the five under "The band and the placement"; `aim` the pass counts inside `band` at the row's size; `toAim` the signed distance in verified passes, negative above the aim; `wilson` the interval at `REPORTING_Z` (`src/claim/estimation.ts`) |
| a row's `passed`, `verified`, `unaccepted`, `nonResults` | passes out of verified cases, with the other two kinds beside them; `passed` is null when the claim was refused |
| a row's `effort`, `familyEffort`, `solveWallMinutes`, `wallBound` | solve effort against the Builder's own `solve_minutes`, and how many unaccepted cases ran to within `WALL_BOUND_SHARE` (`src/run/climb-history.ts`) of that wall |
| a row's `regrade` | the earlier battery whose recorded solves this one graded again |

There is no climb, hold or ease verb, no level label and no ladder to read, and a note naming one
describes a mechanism the source no longer has. `readClimbReadout` rebuilds the readout over the
admitted history and `readClimbBatteries` (`src/run/climb-history.ts`) is the history it reads;
both are exported, so replay them over every campaign on disk before theorising about what a round
was told.

A round the loop threw away looks exactly like a round that changed nothing. A refused claim holds
the candidate whatever refused it (`candidate-claim-refused`, `src/run/candidate-promotion.ts`), and
the next round reseeds from the last adopted product (AGENTS.md "After it ends"), while the climb
still admits a battery whose claim was refused only for an environment clause
(`ENVIRONMENT_CLAUSES`, `src/run/climb-battery-admission.ts`). On 2026-09-18, on a source that did
not yet admit it, truss c1d2a7's fourth battery, its first with failing cases at 3 of 5, lost its
claim to one unproven model identity and appeared in neither `admitted` nor `excluded`, and the next
decision's digest was byte-identical to the one before. So when a placement does not match the last
battery you saw, first match the labels. A decision is filed under the round it opens and places the
battery before it, so decision `iN` reads battery `i(N−1)`. This tree's readers print both (`iN
(reads iM)`), but a snapshot of an older run reads with that run's own source, which may print the
round alone. On 2026-09-30 a lane counted 7 of 15 placements on buffer 3af96d as disagreeing for
exactly this reason; matched, all 16 agreed. Then read in order the battery's `claims/<battery>.json` (`claim.ok` and the clause
names), its `promotions/<battery>.json` (`decision`, promoted or held), the run's `fullrun.log`,
which names both, and the decision's `admitted`, `excluded` and `evidence[]`, asking whether the
battery is in any of them.

## What the round was told

What each surface says today is AGENTS.md "Goals and the climb", under "What the Builder is asked,
round by round". Each one is a condition identity, so read it from the measured tree with
`git show <opening source.commit>:<path>`, and date a run against the changes below before
explaining its Builder by today's wording:

- the **kickoff**'s request line (`src/run/direct-input.ts`): from 2026-09-30 it says that a
  stricter demand on a requirement the request names is not an added requirement;
- the **system prompt**'s intent clause (`src/author/builder-start-prompt.ts`): from 2026-09-30, an
  ambitious round expects its battery to fail some cases on the rules it publishes;
- the **round prompt** (`src/author/builder-session.ts`): from 2026-09-30, a battery whose every
  rehearsal passed has its hardest tasks' demand changed once before submit. `harness_trial`
  (`src/builder/harness-trial.ts`) states the round's passes with the largest wall share and
  tool-call count any pass took; before 2026-09-30 it counted one-turn passes, which every pi solve is;
- the **readout** and `renderBatteryContract` (`src/run/climb-readout.ts`): from 2026-09-30 the
  no-limit line names the next tasks as ones the Builder expects the solver to fail and says to
  carry none of the passed tasks forward unchanged. A run measured before an earlier change opened
  with the calibration target, the aim and the no-limit count at the round's size.
  `renderProbeSizing` (`src/run/battery-sizing.ts`) states the probe range.

The round states no plan. What it set out to do is in the Builder's prose and notes, and what it
did is in the accepted bytes, which alone decide the operation it is attributed as. Read the prose
before judging the round, because it states the gap the Builder saw and a score cannot: the fourth
round of 3fd52f9e-10 opens "every rule the harness enforced was a rule about members" and adds two
public checks from a published joint standard, which no reading of the three flat rounds before it
would have predicted. A run whose
source predates the removal of `EXPERIMENT.json` recorded one beside each accepted submit, and a
readout row there carries it as `experiment`; nothing reads either, and an older note describing
`experiment-plan/v2`, a family score or a pass range describes a mechanism this source does not
have.

## Battery size and graduation

Lane 37 reads a battery's size against the evidence it could have produced, so recompute the size
from `batterySizingGate` (`src/run/battery-sizing.ts`) over `POLICY.battery` rather than from the
rule as remembered. The rule and the reason a probe graduates only at or under the aim are AGENTS.md
"Goals and the climb", under "The three parts of the climb" and "Who hears the placement, and what
it drives". The gate's branches run in this order. A requested size at or below the probe ceiling
is used as it stands. With no adopted product, the round gets the probe range. A product already
past the probe ceiling gets `smallestSizeHoldingTooEasy` over its last landing, or the requested
size when nothing smaller holds or the landing cannot be read, so a missing identity leaves the
requested size in place. Otherwise the product graduates only when its last battery passed at least
one scored case and landed at or under the aim, and until then it stays on probes. The landing is
`admittedClimbRow`'s count, so a case the Epoch Reviewer settled against its check counts neither
way.

Two consequences are easy to miss. A scored case includes an unaccepted one, so a probe whose
solver submitted nothing on half its tasks and passed the rest has graduated, although it measured
a door rather than a limit. And the solver's time is the Builder's own setting: `solve_minutes` in
`agent/config.yaml` defaults to 120, and the host accepts anything from a tenth of that to ten
times it (`HOST_LIMIT_FACTOR` in `src/correctness-bundle/harness-config.ts`), so a battery that
reads too hard at a twelve-minute wall has measured the wall the Builder chose.

## Six situations, and what to read first

| situation | first read | what it usually is |
|---|---|---|
| every battery passes every case | `wri.ts climb` `velocity`, `flat` and `carried` lines, then the edges | a flat line: tasks carried unchanged, or inputs grown at unchanged checks and limits |
| score stays high, task ids and hashes keep changing | `wri.ts climb` edges | `adjusted` or `widened`: numbers moved, demand did not |
| score high but an edge already reads `escalated` | that edge's changed checks, limits and tier histogram, then the task rows | a move in the checks whose cases have not landed; name the changed public requirement before expecting fails, since a label is a reading and not a forecast |
| some cases failed, placement over or on the aim | the battery's `fails` line in `wri.ts climb` | fails held by the review are a limit; fails settled against their check, or all on one check across families, are a check the public rules do not support |
| every case failed | accepted artifacts beside their public tasks, then lane 38 | an unpublished rule, an unusable submission path, or checks refusing right answers |
| the Builder ignored a page you wrote | `git show <opening source.commit>:<path>` | the page was not in the measured tree |

The last one has cost rounds before. A starter page on no ancestor of the opening's commit was
never in front of the Builder, and every round that waited for it was the cost of resolving a
surface against the working tree, so resolve every model-visible surface against the opening.
Three flat edges and then one `escalated` are one observation, and the three before it are its
cost.

Some climb questions have a tempting wrong reader. Each row names the reader that answers and the
one that does not:

| you want to know | read | not |
| --- | --- | --- |
| whether the run is climbing | the `velocity`, `horizon`, `flat` and `carried` lines | the zone, the score, or a monotonic approach to the aim |
| whether the Builder was asked for more | whether the latest battery passed every verified case, which sends the no-limit line (`noLimitLine`) | the zone, which the Builder never hears |
| how the next battery is sized | the placement in `difficulty-decisions/` | the score |
| whether the tasks got harder | the edge labels and the tier histogram, with the task rows beside them | new task ids or a longer description |
| whether the Builder read a starter file | the bundle bytes and the Builder's notes | read counts in `builder-path-record.jsonl`: the Builder reads through `bash`, so zero proves nothing |
| whether a battery is hard or merely unsolvable | `artifact.json` beside `public-task.json` in the settled cases | a reviewer finding, a published limit or a zero score |
| whether a slow solve met the wall | `solver.toolCalls` in `case-result.json`, and the row's `wallBound` | `max_turns` or the turn count, since every pi solve records one turn |

## Harder, or only different

Family names, more scenarios, longer text and fresh hashes prove membership, not difficulty.
`publicBatteryFingerprint` says whether the public condition changed, and declared public-input
variation proves coverage only. So a transition is `harder` only when a changed public requirement
and the reasoning interaction it adds can be named from the recorded inputs; otherwise it is
`unknown`. Moving a published magnitude is the cheapest edit and the easiest to mistake for a
climb, and tightening a feasible limit towards a stronger witness is legitimate, but neither proves
a task harder by itself; blind measurement decides. The two flat routes reserve 6a8ca0 took, limits
at its reference's values and inputs grown at unchanged checks, are in AGENTS.md "Goals and the
climb", under "What the Builder is asked, round by round". What they add to a reading is that from
i03 its solver submitted the reference's own answer on 3 to 7 of each battery's 7 tasks, so a limit
binds only where the solver's search falls short of the witness.

A limit read from the task file is a lead, and so are a reviewer finding and a zero score; the
measurement is `artifact.json` beside `public-task.json` in the settled cases. Truss c1d2a7
published every mass limit at its stored reference design's catalogue mass with zero tolerance,
which read as unreachable. Its Epoch Reviewer called that a `curriculum-defect` over 39 probes, and
five commits were written on the reading before all three cases passed, 20 to 39 per cent inside
their limits, in 45 to 59 tool calls. What such a limit measures is the reference's search: the
starter has the Builder store a search's best artifact under `reference/` and replay it inside the
gate's wall, so the author's one session for the whole battery bounds the reference while the
solver spends a whole per-task wall, and a limit at the author's own best clears easily.

Read difficulty on the changed public-input subset, so unchanged successes cannot dilute its
failures; order batteries by claim `createdAt`, and refuse a before-and-after reading that lacks
the chronology and task-set identity. A redesigned battery has no one-to-one map back to its
predecessor, so split outcomes into changed and unchanged tasks per family. A task probe holds the
agent and the scoring program fixed while a rebuild may not, so their score movements have
different attribution. Follow `predecessor → decision → delivered context → candidate → admission
→ successor or terminal` and report the furthest branch reached.

## Slack, calibration and what moved

A pass can mean an easy task, a check that observes too little, or both, so a battery sitting
`over-aim` or `too-easy` has not found a limit and does not say which of the three it is. Lane 5
reads the limits: `UNTRIPPED IN SHIPPING` and `PERFECT BATTERY OVER AIM` where no accepted artifact
came near a boundary the request depends on. Lane 6 reads the checks, and `REACH-ONLY CHECKS` where
one cannot bind to what it judges. Lane 35 recomputes a sample of passes with arithmetic the Builder
did not write, which is the only reading that separates a thin check from an easy task. Lane 33
asks what the reference witness proved, and lane 34 whether a solver tool reported every margin the
checks read, which would make a hard-looking limit easy to meet.

The calibration side is the Builder's measuring before it paid. Lane 11 reads bytes submitted that
its own rehearsal never tested, `SUBMITTED BYTES NEVER REHEARSED`, and lane 9 families the rehearsal
could not grade, `REHEARSAL NOT-RUN`. `OFF-AIM STREAK` sends the round-over-round reading to lanes
10 and 36. What the Builder then changed, and whether the changed bytes carry a changed demand, is
lane 20's question, with `REPEATED CONDITION` the case where they carry none; whether changed source
reached anything is lane 21's. At the other end, a battery that fails everything is read by lane
38 before it is called hard, because a verified fail can be a right answer the checks refused.

## Effort is not difficulty

Each row states the solve effort — median and longest minutes against `solve_minutes`, median tool
calls — by battery and by family. Within one battery, effort does not separate the passes from the
fails, so it cannot stand in for difficulty. What it can do is expose a wall: a family whose
unaccepted cases all ran to the wall was stopped by the Builder's own setting, and `wallBound`
counts them.

Read tool calls (`solver.toolCalls` in `case-result.json`) and each accepted value's margin to its
published limit, never turns, since every pi solve records one turn. Truss c1d2a7 passed 6 of 6
twice with its tightest answer 6.7 per cent inside its limit and its loosest 30.8: "6 of 6" invites a
harder battery, and the margins say the axis being moved is the wrong one. Across campaign
3fd52f9e-28 the median solve took 24 tool calls and 11.5 of its 120 minutes, the longest 68 calls
and 43 minutes, and failed cases averaged 43 calls against 25 for passes. Campaign 846c029d-3 took
exactly 4 calls and 0.4 minutes in all 460 accepted cases, the regime whose proposer tool was the
reference solve, which is lane 34's question. A solver using a tenth of its wall is not held back by
it; truss cb274b, whose misses all ran to the wall (AGENTS.md "Goals and the climb", under "What one
battery can say"), is the opposite reading.

## A task that demands a decision

For the family, name the artifact and the judgement it demands, the public relation and installed
capability it needs, the plausible wrong artifacts each check must reject, and the axis expected to
make it harder with its realised value in the task bytes: interacting constraints, resource limits,
dependency depth, distractors, cross-source facts. The demand comes from the request's own field,
never from a rule the Builder added to it, which is lane 31's question. Withhold a sufficient
construction algorithm across everything the agent reads; a reusable algorithm or bounded search
is support, and a tool analysing a design as a check does is lane 34's. Check coupled copies of
a public value, such as a number duplicated inside an opaque JSON string, before a one-path move,
against the adopted predecessor rather than the latest held candidate.

## Choosing one change

Start from the constraint the walk in "Find the binding constraint" named. Name the owner, the live
consumer, the decision changed and the falsifier, then replay the mechanism over recorded campaigns
and count the rounds it would have engaged; a refusal reachable only after the behaviour it exists
to cause is decoration. Prefer deleting a competing owner to adding one. Return the recorded
decision and its placement, the admitted and excluded batteries, whether the public condition grew
and how, the three denominators, what the Builder's notes say the round set out to change, the
binding constraint with its falsifier, the change, and the next question. Paid work stays with
`run-improvement-campaign` and `launch-run`.
