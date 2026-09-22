---
name: run-climb-lab
description: "Read and improve the difficulty climb: whether a battery actually got harder, why the controller chose its action, and what a recorded transition supports. Use for a climb question standalone or from run-improvement-campaign."
---

# Run climb lab

One question: **when the product scores well, does the next battery get harder for a reason you can
name?** Everything here serves that. The controller owns the decision; the host verifier owns
correctness; this skill reads what they recorded and proposes the one change worth making.

## The goal: climb towards really hard tasks

Operator goal, 2026-09-18: **optimise the climb so the product ends up facing genuinely hard tasks.**
A campaign has reached it when one battery lands inside `climb.band` — 5 to 12 verified of 25 — on
tasks whose changed public requirement can be named. Two recorded numbers say whether a change moved
towards it, and both come from `difficulty-decisions/`:

- **climbs before the first in-band battery**, counted per campaign. Fewer is better; campaign
  `3fd52f9e-28` never got there in seven decisions, all `climb`, from 24/25 and 25/25 batteries.
- **the share of decisions placing `on` the aim** rather than `too-easy`. A campaign whose every
  placement is `too-easy` has a climb that moves labels, not demands.

Neither is a score to optimise by moving thresholds: the band, the Wilson owner and the battery
sizes are fixed policy (`thresholds.frozen.yaml`, `src/claim/estimation.ts`,
`src/run/battery-sizing.ts`). The way to move them is to make the next authored battery demand more
reasoning, and the way to prove it is a named changed public requirement.

## Four situations, and the first thing to read in each

Most climb questions arriving here are one of four. Read the named thing first; it decides whether
there is a study to run at all.

| situation | first read | what it usually turns out to be |
| --- | --- | --- |
| the score stays high and the level label keeps rising | `climb-velocity.mjs` edges across the campaign | `adjusted` or `widened` edges: the numbers moved, the demand did not. No study — name the changed public requirement instead |
| the score stays high but an edge already reads `escalated` | that edge's `delta checks`, `limits` and tier histogram | a real move whose measurement has not landed. Wait for the cases, not for another round |
| every case failed | the accepted artifacts beside their public tasks | an unpublished rule or a submission path a correct answer cannot use, far more often than a hard battery. `no-difficulty-evidence`, rebuild |
| the Builder ignored a page you wrote | `git show <opening source.commit>:<path>` | the page was not in the measured tree, so nothing delivered it. A prediction for the next launch, not a finding, and not a reason to edit the page again |

The fourth cost four rounds of `c1d2a7` before anyone checked: it opened at `e97f8e703`, and the
starter's `difficulty-ladder.md` was on the open stack and on no ancestor of that commit. Resolve
every model-visible surface against `opening.json`'s `source.commit`, never against the working
tree or the stack head.

Three flat edges followed by one `escalated` is one observation, not four. The experiment is the
escalation; the three before it are its cost, in this case eighteen solver cases of roughly fifty
minutes each. The reader and `c1d2a7`'s recorded edges are in
[run-improvement-campaign](../run-improvement-campaign/SKILL.md#read-the-climb-not-only-the-score);
this skill owns what to do when its verdict and the controller's `ClimbAction` disagree.

## Read the decision the controller actually made

The climb is not a vibe, it is four named actions. `decideDifficulty` in
`src/run/climb-readout.ts` returns exactly one of:

```text
placed | no-difficulty-evidence | repeated-failure-set | family-conflict
```

A `placed` decision carries its zone (`too-easy | over-aim | on-aim | under-aim | too-hard`); the
direction is the Builder's to choose, so there is no climb, hold or ease verb to read. The
readout's `allowance` counts consecutive off-aim rounds towards `POLICY.climb.offAimStreakRounds`.

Read the recorded decision before any prose about difficulty. `recordDifficultyDecision`
(`src/run/difficulty-decision.ts`) writes it; `readClimbBatteries` (`src/run/climb-history.ts`)
reads the batteries it saw, and `admitBattery` says which were admitted and which excluded and why.
Excluded batteries are the usual reason a climb looks stalled: a battery the threshold or bundle
identity excluded never reached the selector at all. `excludedSummary` names them.

The band is policy, not taste: `climbThresholds().band`, defaulting from `POLICY.climb.band`. A
score whose Wilson floor clears the band ceiling is the signal that the battery found no limit.

Replay before you theorise. The readers above are exported, so a script in `.scratch/` can run them
over every campaign on disk and count how often each action fired. That replay is how
`experiment-limit-held` was found to have fired in none of 24 recorded histories while appearing to
be the mechanism that made the product go harder, and how the repeat refusal was measured at 6 of
18 admitted rounds on one campaign and 7 of 25 across three.

## Tell a harder battery from a different one

A level label, a new family name, more scenarios, longer descriptions or fresh hashes establish
nothing. Changed bytes prove membership, not semantic difficulty.

Two mechanisms carry the distinction in source, and both are worth reading before claiming a climb:

- `publicBatteryFingerprint` and `priorPublicFingerprints` (`src/run/climb-history.ts`). A
  battery that does not grow the prior print set is the same public condition wearing new ids.
- Declared public-input variation at authoring validation: each family's applicable truth checks
  must share a `publicInput` path with two distinct values. That proves coverage, not difficulty.

So the honest reading of a transition is: which public requirement changed, and which reasoning
interaction it adds. If neither can be named from the recorded public inputs, the transition is
`unknown`, not `harder`. [references/task-difficulty.md](references/task-difficulty.md) holds the
longer form.

**No course is prescribed.** `climb.band` is 0.20 to 0.50, so a 25-task battery measures its limit
at 5 to 12 verified; a fresh product runs probe batteries of 5 to 10 tasks (`src/run/battery-sizing.ts`)
until one passes some but not all of its scored cases. `placeOnBand` owns the reading: the Wilson
interval decides significantly too easy or too hard, the point count decides under, on or over the
aim. A battery the solver mostly passes before a harder one failed found no limit.

`c1d2a7` is the same shape one campaign later: three batteries at the same score, two flat edges and
one escalation, read identically by the score and differently by the edge. Its recorded numbers are
in [run-improvement-campaign](../run-improvement-campaign/SKILL.md#read-the-climb-not-only-the-score)
and are not restated here; they have already drifted once between the two copies.

The three-stage course that used to sit here is retired, and campaign `3fd52f9e-28` is why. Told to
relax one named requirement at a time towards a higher count, it did exactly that and nothing else:
four consecutive batteries at `delta checks +0 limits +0 coupled +0 tooled +0 rules +0 roots +0
inputs +0 scenarios +0`, novelty 0.0000, with only the published magnitudes moving — 194 numbers by
12.82 per cent, then 116 by 4.79, then 138 by 2.00. A route named in a prompt becomes the route the
Builder takes, including when that route is a way of changing nothing. State the count the band
implies and leave the route to the Builder.

## Follow one transition end to end

```text
predecessor battery -> recorded decision and reason -> delivered author context
-> authored candidate -> admission -> successor battery or typed terminal
```

`AGENTS.md` governs what may be read off that chain: the three case kinds and their separate
denominators, the four evidence levels, and what a task-only comparison must hold fixed. Do not
restate it here — the two things this skill adds are that difficulty reads on the **changed
public-input subset**, so unchanged successes cannot dilute its failures, and that batteries order
by claim `createdAt`, so a before/after reading without chronology and the task-set identity is
refused rather than estimated.

## Choose one change

Name the owner, the live consumer, the decision it changes and the falsifier before editing. Prefer
deleting a competing owner or deriving the state to adding a mechanism. Then check the mechanism can
fire: replay it over recorded campaigns and count the rounds on which it would have engaged. A
refusal whose trigger is only reachable after the behaviour it exists to cause has already happened
is decoration — that is exactly what `experiment-limit-held` was.

Run focused positive and hostile checks in the smallest owning test file, apply `simplify`, and land
the commit on the PR it corrects.

## Review only what can change the decision

Read deterministic views first; `whole-run-investigation` owns evidence normalisation and the
packet rules. Ask a semantic session only about an owner, mechanism or causal alternative the bytes
left open. On 18 September a session audit of these files returned eight deletions; three were
checked against source before acting and two of the three were wrong, naming as absent a symbol
with two live call sites and a threshold whose removal the file already recorded correctly.

## Return

The recorded decision and its reason, the admitted and excluded batteries with counts, whether the
public condition grew and how, the verified / unaccepted / non-result denominators, the prediction
outcomes, the one change chosen with its falsifier, and the next question.
