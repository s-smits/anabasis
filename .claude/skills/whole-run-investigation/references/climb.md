# Reading the difficulty climb

One question: when the product scores well, does the next battery get harder for a reason you can
name? The controller owns the decision and the verifier owns correctness; this reads what they
recorded and proposes the one change worth making. Inside a whole-run investigation it is the
`climb` lane's ground and the reading behind lanes 5, 6, 9, 10, 11 and 20: lanes 5 and 6 ask
whether the checks left slack for the battery to sit above the aim, lanes 9, 10 and 11 whether the
Builder could and did calibrate its count before paying for it, and lane 20 what actually moved
between batteries.

## The goal and its two numbers

A campaign has reached the operator's goal (2026-09-18) when one battery lands inside
`climb.band` (`src/critic/policy.ts`) — 5 to 12 verified of 25 — on tasks whose changed public
requirement can be named. Two counts from `difficulty-decisions/` say whether a change moved
towards it: batteries before the first in-band placement, and the share of placements `on-aim`
rather than `too-easy` or `over-aim`. Neither moves by touching thresholds; the band, the Wilson
owner and the battery sizes are frozen policy.

## The record the controller wrote

`recordDifficultyDecision` (`src/run/difficulty-decision.ts`) writes one file per round under
`difficulty-decisions/<runId>-<digest>.json`, with the schema `DIFFICULTY_DECISION_SCHEMA` names;
a reader takes that schema and refuses any other. The record carries the run, the slug, the
measured-condition digest, `frame: FRAME_REVISION` and the `ClimbReadout` itself. The frame matters
because every sentence the readout sent the Builder is a line of `FRAME`
(`src/run/climb-readout-frame.ts`), so two records at different revisions were authored under
different wording and are different conditions.

Inside the readout, read these fields and nothing looser:

| field | what it says |
|---|---|
| `decision` | `placed`, or one of the three set-aside shapes `no-difficulty-evidence`, `repeated-failure-set`, `family-conflict`, whose pooled rate is not difficulty evidence |
| a row's `zone` | `placeOnBand` (`src/claim/battery-difficulty.ts`): `too-hard`, `under-aim`, `on-aim`, `over-aim` or `too-easy`; the two outer zones are Wilson-significant, the inner three are the point count against the aim |
| a row's `toAim` | signed distance in verified passes from the aim; negative is above it |
| a row's `wilson` | the interval at `REPORTING_Z` (`src/claim/estimation.ts`), the only sample-size owner |
| a row's `setAside` | the set-aside action when the round was not placed |
| `admitted` and `excluded` | what `admitBattery` let in and what `excludedSummary` names; an excluded battery is the usual reason a climb looks stalled |
| `allowance` | the `OffAimAllowance`: `rounds` on one `side` of the aim, how many `placed` and how many `refused` |
| a row's target | the Builder's `EXPERIMENT.json` `{comparator, verifiedPasses}` with `result` `met`, `missed`, `undetermined` or `unadmitted`, and `missedBy` when missed |

There is no climb, hold or ease verb, no level label and no ladder to read, and a note that names
one is describing a mechanism the source no longer has. `readClimbReadout`
(`src/run/climb-readout.ts`) rebuilds the readout over the admitted history, and
`readClimbBatteries` (`src/run/climb-history.ts`) is the history it reads. Both are exported, so
replay them over every campaign on disk before theorising about what a round was told.

## Four situations, and what to read first

| situation | first read | what it usually is |
|---|---|---|
| score stays high, task ids and hashes keep changing | `wri.mjs climb` edges | `adjusted` or `widened`: numbers moved, demand did not |
| score high but an edge already reads `escalated` | that edge's delta checks, limits and tier histogram | a real move whose cases have not landed; wait for them |
| every case failed | accepted artifacts beside their public tasks | an unpublished rule or unusable submission path; `no-difficulty-evidence`, rebuild |
| the Builder ignored a page you wrote | `git show <opening source.commit>:<path>` | the page was not in the measured tree |

The last one has cost rounds before: a starter page that is on no ancestor of the opening's commit
was never in front of the Builder, and every round that waited for it to be read was the cost of
resolving a surface against the working tree. Resolve every model-visible surface against the
opening, never the working tree. Three flat edges then one `escalated` are one observation, and
the three before it are its cost.

## Harder, or only different

Family names, more scenarios, longer text and fresh hashes prove membership, not difficulty.
`publicBatteryFingerprint` (`src/run/climb-history.ts`) says whether the public condition changed, and declared public-input variation proves coverage only. So a
transition is `harder` only when a changed public requirement and the reasoning interaction it
adds can be named from the recorded inputs; otherwise it is `unknown`. Moving a published
magnitude is the cheapest edit and the easiest to mistake for a climb, which is why no course is
prescribed: a Builder told to relax one named requirement at a time can move only magnitudes for
battery after battery, and the fingerprints will say the public condition did not grow.

Read difficulty on the changed public-input subset so unchanged successes cannot dilute its
failures, order batteries by claim `createdAt`, and refuse a before/after reading that lacks the
chronology and task-set identity. A redesigned battery has no one-to-one map back to its
predecessor, so split outcomes into changed and unchanged tasks per family. A task probe holds the
agent and verifier fixed; a rebuild may not, so its score movement has different attribution.
Follow the chain `predecessor → decision → delivered context → candidate → admission → successor
or terminal` and report the furthest branch actually reached.

## Slack, calibration and what moved

A battery that sits `over-aim` or `too-easy` while its checks all pass has not found a limit, and
the reason is one of two. Either the checks have slack, so that no accepted artifact tripped the
check the request depends on — lane 5's `UNTRIPPED IN SHIPPING` and `PERFECT BATTERY OVER AIM`
where the limit is anchored to the Builder's own reference, lane 6's `REACH-ONLY CHECKS` where the
check cannot bind to what it judges; or the Builder declared a target its own rehearsal
contradicted or never tested, which is lane 11's `SUBMITTED BYTES NEVER REHEARSED` and `REHEARSAL
CONTRADICTS TARGET`, or could not test, which is lane 9's `REHEARSAL NOT-RUN`. The `allowance` says
how many rounds the streak has run and on which side; `OFF-AIM STREAK` and `TARGET MISSED` send the
round-over-round reading to lane 10. What the Builder then changed, and whether the changed bytes
carry a changed demand, is lane 20's question, and `REPEATED CONDITION` is the case where they
carry none; whether the changed source reached anything is lane 21's.

## A task that demands a decision

For the family, name the artifact and judgement it demands, the public relation and installed
capabilities it needs, the plausible wrong artifacts each check must reject, and the axis expected
to make it harder with its realised value in the task bytes — interacting constraints, resource
limits, dependency depth, distractors, cross-source facts. Withhold a sufficient construction
algorithm across everything the agent reads; a tool that evaluates a proposed design can be
legitimate support. Check coupled copies of a public value (a number duplicated inside an opaque
JSON string) before a one-path move, against the adopted predecessor rather than the latest held
candidate.

## Choosing one change

Name the owner, live consumer, decision changed and falsifier, then replay the mechanism over
recorded campaigns and count the rounds it would have engaged; a refusal reachable only after the
behaviour it exists to cause is decoration. Prefer deleting a competing owner to adding one. Return
the recorded decision and its zone, admitted and excluded batteries, the allowance, the target and
its result, whether the public condition grew and how, the three denominators, the prediction
outcomes, the change with its falsifier and the next question. Paid work stays with
`run-improvement-campaign` and `launch-run`.
