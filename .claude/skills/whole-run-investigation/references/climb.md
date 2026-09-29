# Reading the difficulty climb

One question sits under every climb reading: when the product scores well, does the next battery
get harder for a reason you can name? The verifier owns correctness and the controller records a
placement, but neither writes a task. This reference reads what they recorded, says whether a
battery got harder or only different, and proposes the one change worth making. Inside a whole-run
investigation it is the `climb` lane's ground and the reading behind lanes 5, 6, 9, 10, 11 and 20,
and behind the authorship lanes 33 to 38 wherever a climb depends on what the Builder wrote.

## The goal and its two numbers

A campaign has reached the operator's goal when one battery lands inside `climb.band` — `[0.2,
0.50]` in `thresholds.frozen.yaml`, read through `climbThresholds`, which is 5 to 12 verified of 25
— on tasks whose changed public requirement can be named. Two counts from `difficulty-decisions/`
say whether a change moved towards that: how many batteries came before the first in-band
placement, and what share of placements were `on-aim` rather than `too-easy` or `over-aim`. Neither
moves by touching a threshold, because the band, the Wilson owner and the battery sizes are frozen
policy.

## Who can move difficulty

The controller writes no task. It sizes the battery, measures it, places it on the band and hands
the Builder a readout of the counts, and from there every change in difficulty is the Builder's
choice: which families to change, which limits to tighten, which requirement to add. So a climb
that stalls is a question about what the Builder was shown and what it chose, and never about a
controller course, since there is none to read. Lane 36 asks what pressure the round text put on
the Builder towards harder tasks, and lane 10 whether its calibration improved round over round.

The pressure is weaker than it looks from outside, and it helps to know exactly how. The placement
zone, the aim, the distance to the aim and the Wilson interval are the controller's and the
reviewer's: the `ReadoutRow` comment in `src/run/climb-readout.ts` says so, and
`readoutHistoryDocuments` strips all four before the Builder's history source is built. The Builder
reads its measured counts, the limit sentence and the witness sentence, and is shown no count to
aim at. The off-aim streak is not a controller fact at all in the current source: the
WRI digest computes it from the recorded placements (`offAimStreaks` in
`scripts/digest-ledgers.ts`), and nothing in the run stops or changes on it.

## The record the controller wrote

`recordDifficultyDecision` (`src/run/difficulty-decision.ts`) writes one file per round at
`difficulty-decisions/<runId>-<digest>.json`, holding `schema`, `runId`, `slug`, `digest` and
`difficulty`, the `ClimbReadout` itself. The schema is `difficulty-decision/v9`, and a reader takes
that and refuses any other, because an earlier version could carry a field of the same name that
meant something else: v6 set a battery with a repeated failing core aside with no placement, where
v7 on places it and states the core beside it. The record carries no wording revision, since v9
dropped the frame revision v8 carried.

Inside the readout, read these fields and nothing looser:

| field | what it says |
|---|---|
| `band`, `admitted`, `excluded` | the band the run measured against, how many batteries `admitBattery` let into the history, and what `excludedSummary` names as left out; zero admitted beside exclusions means every measurement was refused, not that nothing ran, and an exclusion is the usual reason a climb looks stalled |
| `decision.placement` | `placeOnBand` (`src/claim/battery-difficulty.ts`) over the deciding sample, or null when no battery is recorded, every attempt was refused at submission (`refused` says how many) or the sample could not be placed |
| `decision.repeated` | the failing core the last two batteries of one task set share, as `cases` and the two `scores`, stated beside the placement rather than instead of it |
| `decision.conflict` | one family significantly too easy beside one significantly too hard, named as `easy` and `hard` |
| `decision.censored` | families the environment censored whole, about which the placement says nothing |
| `decision.evidence` | every battery the decision derives from, by `runId` and `batterySha256` |
| a row's `zone`, `aim`, `toAim`, `wilson` | `too-hard`, `under-aim`, `on-aim`, `over-aim` or `too-easy`; the outer two are Wilson-significant at `REPORTING_Z` (`src/claim/estimation.ts`), the inner three the point count against the aim; `toAim` is the signed distance in verified passes, negative above the aim |
| a row's `passed`, `verified`, `unaccepted`, `nonResults` | passes out of verified cases, with the other two kinds beside them; `passed` is null when the claim was refused |
| a row's `effort`, `familyEffort`, `solveWallMinutes`, `wallBound` | solve effort against the Builder's own `solve_minutes`, and how many unaccepted cases ran to that wall |
| a row's `regrade` | the earlier battery whose recorded solves this one graded again |

There is no climb, hold or ease verb, no level label and no ladder to read, and a note naming one
describes a mechanism the source no longer has. `readClimbReadout` rebuilds the readout over the
admitted history and `readClimbBatteries` (`src/run/climb-history.ts`) is the history it reads;
both are exported, so replay them over every campaign on disk before theorising about what a round
was told.

## What the round was told

`renderBatteryContract` opens each round with the limit sentence, the witness sentence and the
publication boundary, and states no count at any size, because a count per size reads as something
to author towards. The limit sentence says that only a battery passing some but not all of its
cases can locate a limit, and only where the checks that failed it are right; the readout adds a
no-limit line when the latest battery passed every verified case. A run measured before that change
opened with the calibration target — the aim and the no-limit count at the round's size — so read
the sentence from the measured tree. `renderProbeSizing` states the probe range. The witness sentence tells the Builder that a passing artifact, like its
reference, proves a task feasible and never difficult, and that only a blind measured battery shows
where it lands. Read these as the words that were served, from the measured tree, before deciding
what the Builder ignored.

The round states no plan. What it set out to do is in the Builder's prose and notes, and what it
did is in the accepted bytes, which alone decide the operation it is attributed as. A run whose
source predates the removal of `EXPERIMENT.json` recorded one beside each accepted submit, and a
readout row there carries it as `experiment`; nothing reads either, and an older note describing
`experiment-plan/v2`, a family score or a pass range describes a mechanism this source does not
have.

## Battery size and graduation

`batterySizingGate` in `src/run/battery-sizing.ts` decides the size from `POLICY.battery`, and its
branches are worth reading exactly, because lane 37 reads a battery's size against the evidence it
could have produced. A requested size at or below the probe ceiling is used as it stands. With no
adopted product, the round gets the probe range. A product that already graduated to more than
probe-ceiling tasks gets `smallestSizeHoldingTooEasy` over its last landing: the smallest size
above the probe ceiling at which the last pass rate, floored, would still read `too-easy`, or the
requested size when nothing smaller holds or the landing cannot be read, so a missing identity
leaves the requested size in place. Otherwise the product graduates only when its last battery
passed at least one scored case and landed at or under the aim, and until then it stays on probes.

Two consequences are easy to miss. A scored case includes an unaccepted one, so a probe whose
solver submitted nothing on half its tasks and passed the rest has graduated, although it measured
a door rather than a limit. And the solver's time is the Builder's own setting: `solve_minutes` in
`agent/config.yaml` defaults to 120, and the host accepts anything from a tenth of that to ten
times it (`HOST_LIMIT_FACTOR` in `src/correctness-bundle/harness-config.ts`), so a battery that
reads too hard at a twelve-minute wall has measured the wall the Builder chose.

## Four situations, and what to read first

| situation | first read | what it usually is |
|---|---|---|
| score stays high, task ids and hashes keep changing | `wri.ts climb` edges | `adjusted` or `widened`: numbers moved, demand did not |
| score high but an edge already reads `escalated` | that edge's changed checks, limits and tier histogram | a real move whose cases have not landed; wait for them |
| every case failed | accepted artifacts beside their public tasks, then lane 38 | an unpublished rule, an unusable submission path, or checks refusing right answers |
| the Builder ignored a page you wrote | `git show <opening source.commit>:<path>` | the page was not in the measured tree |

The last one has cost rounds before. A starter page on no ancestor of the opening's commit was
never in front of the Builder, and every round that waited for it was the cost of resolving a
surface against the working tree, so resolve every model-visible surface against the opening.
Three flat edges and then one `escalated` are one observation, and the three before it are its
cost.

## Harder, or only different

Family names, more scenarios, longer text and fresh hashes prove membership, not difficulty.
`publicBatteryFingerprint` says whether the public condition changed, and declared public-input
variation proves coverage only. So a transition is `harder` only when a changed public requirement
and the reasoning interaction it adds can be named from the recorded inputs; otherwise it is
`unknown`. Moving a published magnitude is the cheapest edit and the easiest to mistake for a
climb, and tightening a feasible limit towards a stronger witness is legitimate, but neither proves
a task harder by itself; blind measurement decides.

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
unaccepted cases all ran to `solve_minutes` was stopped by the Builder's own setting, and
`wallBound` counts them.

## A task that demands a decision

For the family, name the artifact and the judgement it demands, the public relation and installed
capability it needs, the plausible wrong artifacts each check must reject, and the axis expected to
make it harder with its realised value in the task bytes: interacting constraints, resource limits,
dependency depth, distractors, cross-source facts. The demand comes from the request's own field,
never from a rule the Builder added to it, which is lane 31's question. Withhold a sufficient
construction algorithm across everything the agent reads, while a tool that evaluates a proposed
design can be legitimate support. Check coupled copies of a public value, such as a number
duplicated inside an opaque JSON string, before a one-path move, against the adopted predecessor
rather than the latest held candidate.

## Choosing one change

Name the owner, the live consumer, the decision changed and the falsifier, then replay the
mechanism over recorded campaigns and count the rounds it would have engaged; a refusal reachable
only after the behaviour it exists to cause is decoration. Prefer deleting a competing owner to
adding one. Return the recorded decision and its placement, the admitted and excluded batteries,
whether the public condition grew and how, the three denominators, the plan's scored range, the
change with its falsifier, and the next question. Paid work stays with `run-improvement-campaign`
and `launch-run`.
