# Reading the difficulty climb

One question: when the product scores well, does the next battery get harder for a reason you can
name? This absorbed the former `run-climb-lab` skill and its `task-difficulty` reference. The
controller owns the decision and the verifier owns correctness; this reads what they recorded and
proposes the one change worth making.

## The goal and its two numbers

A campaign has reached the operator's goal (2026-09-18) when one battery lands inside
`climb.band` — 5 to 12 verified of 25 — on tasks whose changed public requirement can be named. Two
counts from `difficulty-decisions/` say whether a change moved towards it: climbs before the first
in-band battery, and the share of placements `on` the aim rather than `too-easy`. Neither moves by
touching thresholds; the band, the Wilson owner and the battery sizes are frozen policy.

## Four situations, and what to read first

| situation | first read | what it usually is |
|---|---|---|
| score stays high, level label keeps rising | `wri.mjs climb` edges | `adjusted` or `widened`: numbers moved, demand did not |
| score high but an edge already reads `escalated` | that edge's delta checks, limits and tier histogram | a real move whose cases have not landed; wait for them |
| every case failed | accepted artifacts beside their public tasks | an unpublished rule or unusable submission path; `no-difficulty-evidence`, rebuild |
| the Builder ignored a page you wrote | `git show <opening source.commit>:<path>` | the page was not in the measured tree |

The last one cost `c1d2a7` four rounds: it opened at `e97f8e703` and the starter's
`difficulty-ladder.md` was on no ancestor of that commit. Resolve every model-visible surface
against the opening, never the working tree. Three flat edges then one `escalated` are one
observation, and the three before it are its cost.

## The decision the controller made

`decideDifficulty` in `src/run/climb-readout.ts` returns `placed | no-difficulty-evidence |
repeated-failure-set | family-conflict`, and a `placed` decision carries its zone from
`placeOnBand`. There is no climb, hold or ease verb to read. `recordDifficultyDecision`
(`src/run/difficulty-decision.ts`) writes it, `readClimbBatteries` (`src/run/climb-history.ts`)
reads the batteries it saw, `admitBattery` says which were admitted, and `excludedSummary` names
the excluded ones — the usual reason a climb looks stalled. These readers are exported, so replay
them over every campaign on disk before theorising: that is how `experiment-limit-held` was found
to have fired in none of 24 recorded histories.

## Harder, or only different

Level labels, family names, more scenarios, longer text and fresh hashes prove membership, not
difficulty. `publicBatteryFingerprint` and `priorPublicFingerprints` say whether the public
condition grew, and declared public-input variation proves coverage only. So a transition is
`harder` only when a changed public requirement and the reasoning interaction it adds can be named
from the recorded inputs; otherwise it is `unknown`. Moving a published magnitude is the cheapest
edit and the easiest to mistake for a climb, which is why no course is prescribed: `3fd52f9e-28`,
told to relax one named requirement at a time, moved only magnitudes for four batteries at novelty
0.0000.

Read difficulty on the changed public-input subset so unchanged successes cannot dilute its
failures, order batteries by claim `createdAt`, and refuse a before/after reading that lacks the
chronology and task-set identity. A redesigned battery has no one-to-one map back to its
predecessor, so split outcomes into changed and unchanged tasks per family. A climb holds the agent
and verifier fixed; a rebuild may not, so its score movement has different attribution. Follow the
chain `predecessor → decision → delivered context → candidate → admission → successor or terminal`
and report the furthest branch actually reached.

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
the recorded decision and reason, admitted and excluded batteries, whether the public condition
grew and how, the three denominators, the prediction outcomes, the change with its falsifier and
the next question. Paid work stays with `run-improvement-campaign` and `launch-run`.
