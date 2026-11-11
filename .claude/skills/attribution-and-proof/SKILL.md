---
name: attribution-and-proof
description: "Use after a comparison or system change, and before claiming that a harness, model or patch is improved, better, fixed or a step in a PR, report or message. Establish the evaluation identities, separate outcome counts, replication, harness attribution and whether the mechanism ran. Distinguish measurement validity from whether the system used the mechanism. Produce the prescribed evidence report."
---

# Attribution and proof

This skill words a claim from what the log already holds: the owner, then the count, then what
the count does not show. It runs after the experiment and reads no lanes, unlike
[whole-run-investigation](../whole-run-investigation/SKILL.md). The comparison is `AGENTS.md`,
section 7; evidence levels and the claim table are section 9.

## What a step does not say

A `step` (`readsStep`, `flipP` in `src/kernel/compare.ts`; older reports through `scoresIn`) is one
draw under one condition. It does not say:

- that the harness is better under another deadline, budget, solver, effort or host code;
- which part did it: only a comparison against `programs-of:<digest>` (the Starter with that
  harness's programs, `keptAs` in `tools/d2/campaign.ts`) separates programs from guide;
- that the solver reasons better: an installed engine saves setup time, which a short deadline
  reads as a step;
- that it would read so again.

## Rules

- **Match the identities** in each solve's `condition.recorded`. Two harnesses are set side by side
  only by one standalone comparison; solves from separate rounds are a description, never a pair.
- **Keep the counts apart**: valid answers, rejections by ruling, endings without an answer by
  kind, non-results, and tasks set aside. Every rate has a denominator and names what it left out.
- **Keep verdicts, reviewer findings and environment facts apart.** A Referee ruling is a model's
  output, and an owner comes from the record behind the number, never a model's guess.
- **Say what did not run.**

## Is the reading more than noise

Answer from the log before writing "step".

- **Repeated?** A new `--id` on the same pair draws fresh solves; until a later reading holds, call
  it one draw at its level.
- **A/A.** Read `noise`, the reference against itself on halves of its solves mirrored in time,
  the mirror running on from task to task so that at two a side the earlier solve is the first half
  on every other task (`compared`, `src/campaign/comparison.ts`; `pairsOf`); a step either way (`readsStepEitherWay`) is reported beside the step.
- **How thin?** At 0.02, 6-0 is the least that clears (p = 0.015625) and 5-0 does not; with equal
  margins 8-1, 10-2 and 12-3 clear, and unequal margins need `flipP`. Give the retained tally apart,
  since a gain on new tasks can offset a loss on old ones; an empty retained set is `unmeasured`.
- **Power and risk.** Give `scored.detectable` (least winning share found four times in five),
  `scored.falseRate`, and the campaign estimate from `riskLines` (`src/campaign/climb.ts`), a sum of
  attempt rates rather than a bound.
- **Which measure?** Give `points` from validity and the objective beside the untied count.
- **Load and budget.** `HOST LOADED` and `LOAD MOVED` mark incomparable times. A comparison reads
  only its own turns and deadline; another budget needs a new setting (`settingAsked`,
  `tools/d2/setting.ts`) and fresh solves.

## Validity and exploitation

Report the two apart, each with its checks and traces.

- **Measurement validity**: `demonstrated gap`, `no gap found in the named checks` or `unassessed`.
  Coverage is the checker's reading (`bun tools/c/accept.ts`), the Referee on each rejection, and
  the labels and blind pass sample of `tools/d2/settle.ts`; no model reviews a pass. An authored check stands on the
  operator's `--admit` or `--admit-authored`, which a launch without `--hitl` supplies (`planOf`,
  `src/campaign/opening.ts`).
- **Exploitation**: `observed`, `not observed in the traces read` or `unobservable`. `observed`
  needs a trace joining what the solver was given to the accepted answer through the gap. An
  efficient solution, a checker gap, a bypass someone built and one a solver used are four things.

Never shorten the scoped negative to "no reward hacking".

## Was the mechanism live in run X?

```sh
bun run runs source <name> --holds <fix>
```

Check in order and stop at the first that fails:

1. **The commit**: `launch-run-<n>.json` names it and whether the tree was clean; a round started
   by hand has none, so its commit is unknown.
2. **Containment**: `--holds` asks whether the fix is an ancestor; after a restack, name the
   replayed commit.
3. **The event** the mechanism writes: a kind, a field, an ending, a refusal's words in the `.out`.
4. **The trigger**: an absent event shows an absent mechanism only where its trigger occurred.

## Procedure and report

Name the variable that moved, check every other identity (checker, scored set, limits, load, host
code), read the tasks one by one, and mark attribution `proven`, `likely`, `mixed` or `unproven`.

```text
Claim:
Condition and identities:
Reference harness:
New harness:
Tally (wins, losses, ties, p, unsolved, set aside):
Each harness by itself (valid solves), at the setting's budget:
Repeat and noise:
Host load:
Non-results and what was left out:
Changed owner:
Attribution:
Proved without a model:
Validity and exploitation, with coverage:
Reviewer findings (advisory):
Unrun or provisional:
Evidence (log, event ids, commit):
```

The report carries ids, digests, counts and paths, never a task's text, an answer, a hidden value,
a check's failure text or a trace passage, and it reaches no seat.
