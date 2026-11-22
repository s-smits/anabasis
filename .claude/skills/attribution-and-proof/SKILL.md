---
name: attribution-and-proof
description: "Use after a comparison or system change, and before claiming in a PR, report, or message that a harness, model, or patch is improved, better, fixed, or constitutes a step. Establishes evaluation identities, separates outcome counts, checks replication and noise floors, attributes effects across harness components, and verifies whether a mechanism actually ran. Distinguishes measurement validity from solver exploitation and produces a structured evidence report."
---

# Attribution and proof

This skill frames empirical claims strictly from what the campaign log already records: first the owning mechanism, then the observed count, and finally what that count does not establish. It operates after an experiment has run and does not conduct lane investigations (which belong to [whole-run-investigation](../whole-run-investigation/SKILL.md)). Comparison mechanics are defined in `AGENTS.md`, section 7; evidence levels and claim requirements are defined in section 9.

## What a step does not say

A `step` (`readsStep`, `flipP` in `src/kernel/compare.ts`; legacy reports via `scoresIn`) is a single statistical draw under one fixed experimental condition. It does not establish:

- that the harness generalises to a different deadline, compute budget, solver, reasoning effort, or host codebase;
- which component drove the gain: only an ablation against `programs-of:<digest>` (the Starter paired with that harness's installed programs, `keptAs` in `tools/d2/campaign.ts`) separates installed programs from the guide and tools;
- that the solver's reasoning improved: pre-installing an engine saves setup time, which under a tight wall-clock deadline registers as a step;
- that the result will replicate on fresh draws.

## Rules

- **Verify identical conditions** using each solve's `condition.recorded`. Two harnesses are compared only within a single paired comparison; solves drawn from separate rounds are descriptive observations rather than a valid pair.
- **Treat multi-week trends as descriptive records.** A row in promotion-tuner's `trend.ts` marked `moved` does not establish causation when its windows span multiple releases, settings, or packs, and its external benchmark block (`--bench`) never promotes a harness or establishes a step.
- **Keep outcome categories separate**: valid answers, rejections broken down by Referee ruling, non-answer endings by kind, non-results, and tasks set aside. Every reported rate must include its denominator and state what was excluded.
- **Separate Referee verdicts, reviewer findings, and environment facts.** A Referee ruling is a model output, and causal ownership must come from the underlying log record rather than a model's hypothesis.
- **State explicitly what did not run.**

## Is the reading more than noise

Verify each of the following from the log before reporting a `step`.

- **Replication.** A fresh `--id` on the same harness pair draws new solves; until a subsequent independent reading confirms it, describe the result as a single draw at its significance level.
- **A/A control.** Inspect `noise`, which compares the reference harness against itself using mirrored halves of its solves across time, alternating which solve enters the first half from task to task so that at two solves per side the earlier solve leads on every second task (`compared`, `src/campaign/comparison.ts`; `pairsOf`). Any two-sided A/A step (`readsStepEitherWay`) must be reported alongside the candidate step.
- **Margin and sample size.** At a 0.02 significance level, 6-0 is the smallest unanimous tally that clears (p = 0.015625), whereas 5-0 does not; with equal margins, 8-1, 10-2, and 12-3 clear, while unequal margins require inspecting `flipP`. Report the retained-task tally separately, because gains on newly written tasks can mask regressions on earlier ones; an empty retained set is reported as `unmeasured`.
- **Statistical power and false-positive risk.** Report `scored.detectable` (the minimum winning share detected with 80% power), `scored.falseRate`, and the cumulative campaign risk from `riskLines` (`src/campaign/climb.ts`), noting that the latter is a sum of per-attempt rates rather than a strict upper bound.
- **Carrying measure.** Report `points` from validity and from the objective alongside the untied task count.
- **Host load and compute budget.** `HOST LOADED` and `LOAD MOVED` flags invalidate wall-clock comparisons. A comparison reflects only its configured turn and time limits; evaluating a different budget requires a new setting (`settingAsked`, `tools/d2/setting.ts`) and fresh solves.

## Validity and exploitation

Report measurement validity and solver exploitation separately, citing the specific checks and traces inspected for each.

- **Measurement validity**: classify as `demonstrated gap`, `no gap found in the named checks`, or `unassessed`. Coverage consists of the static checker inspection (`bun tools/c/accept.ts`), Referee rulings on rejections, and human labels plus blind pass sampling from `tools/d2/settle.ts`; no model reviews passing solves. Authored checks rely on the operator's `--admit` or `--admit-authored` grant, which launches without `--hitl` supply automatically (`planOf`, `src/campaign/opening.ts`).
- **Exploitation**: classify as `observed`, `not observed in the traces read`, or `unobservable`. Claiming `observed` requires a solver trace connecting what the solver received to the accepted answer through the checker gap. Distinguish four separate phenomena: an efficient valid solution, a checker gap, a bypass constructed in a harness, and a bypass actually exercised by a solver.

Never abbreviate a scoped negative finding as "no reward hacking".

## Was the mechanism live in run X?

```sh
bun run runs source <name> --holds <fix>
```

Verify in order and stop at the first failure:

1. **Commit provenance**: `launch-run-<n>.json` records the commit hash and whether the working tree was clean; a round launched manually without a receipt has unknown provenance.
2. **Ancestry**: `--holds` checks whether the fix commit is an ancestor of the run's commit; after a branch restack, cite the replayed commit hash.
3. **Emitted event**: verify the event kind, payload field, ending, or refusal text in `.out` that the mechanism emits when active.
4. **Trigger occurrence**: the absence of an event proves the mechanism was inactive only if its triggering condition actually occurred during the run.

## Procedure and report

Identify the single variable under test, verify that all other experimental identities match (checker, scored task set, resource limits, host load, and host code), inspect tasks individually, and classify attribution as `proven`, `likely`, `mixed`, or `unproven`.

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

The report contains only identifiers, digests, aggregate counts, and file paths; it never quotes task text, answers, hidden values, check failure output, or trace excerpts, and never reaches any model seat.
