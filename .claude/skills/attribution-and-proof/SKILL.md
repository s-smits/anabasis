---
name: attribution-and-proof
description: "Use after a comparison or system change, and before claiming in a PR, report, or message that a harness, model, or patch is improved, better, fixed, or constitutes a step. Establishes evaluation identities, separates outcome counts, checks replication and noise floors, attributes effects across harness components, and verifies whether a mechanism actually ran. Distinguishes measurement validity from solver exploitation and produces a structured evidence report."
---

# Attribution and proof

Frame empirical claims strictly from the campaign log: first the owning mechanism, then the observed count, and finally what that count does not establish (`AGENTS.md` sections 7 and 9). Lane investigations belong to [whole-run-investigation](../whole-run-investigation/SKILL.md).

## 1. What a step does not establish

A `step` (`isSignificant`, `flipP` in `src/kernel/compare.ts`; legacy reports via `scoresIn`) is a single statistical draw under one fixed condition. It does not establish:
- generalisation to a different deadline, compute budget, solver, reasoning effort, or host codebase;
- which component drove the gain (only an ablation against `programs-of:<digest>`, the Starter paired with that harness's installed programs via `keptAs` in `tools/d2/campaign.ts`, separates installed programs from the guide and tools);
- improved solver reasoning (pre-installing an engine saves setup time under a wall-clock deadline);
- replication on fresh draws.

## 2. Verification checklist before claiming a step

- **Identical conditions**: verify `condition.recorded` across both arms within a single paired comparison; solves from separate rounds are descriptive only, and multi-week [promotion-tuner](../promotion-tuner/SKILL.md) `trend.ts` rows (`moved`, `--bench`) are descriptive records rather than causal steps.
- **Separate outcome categories**: report valid answers, rejections by Referee ruling, non-answer endings by kind, non-results, and set-aside tasks with explicit denominators. Keep Referee rulings (model outputs) distinct from log-proven causal ownership.
- **Replication and A/A noise**: check whether a fresh `--id` confirmed the pair, and report `noise` (the reference's time-mirrored A/A control in `compared`, `src/campaign/comparison.ts`; `pairsOf`, one-sided `isSignificant`, counted where powered) alongside any candidate step.
- **Margin, sample size, and power**: at level 0.02, 6-0 is the smallest unanimous tally that clears (`p = 0.015625`; 8-1, 10-2, 12-3 at equal margins). Report the retained-task tally (`unmeasured` when empty), `scored.detectable`, `scored.falseRate`, cumulative risk (`riskLines`, `src/campaign/climb.ts`), and `points` from validity vs the objective.
- **Host load and budget**: check `HOST LOADED` and `LOAD MOVED`; evaluating a different turn/time limit requires a new setting (`settingAsked`, `tools/d2/setting.ts`) and fresh solves.
- **Measurement validity vs exploitation**: classify validity (`demonstrated gap`, `no gap found in the named checks`, or `unassessed` across `bun tools/c/accept.ts`, Referee rulings, and `tools/d2/settle.ts` labels/pass samples; note `--admit` / `--admit-authored` in `planOf`, `src/campaign/opening.ts`) separately from solver exploitation (`observed`, `not observed in the traces read`, or `unobservable`, distinguishing an efficient valid solution, a checker gap, a harness bypass, and an exercised bypass). Never abbreviate a scoped check as "no reward hacking".

## 3. Was the mechanism live in run X?

```sh
bun run runs source <name> --holds <fix>
```

Verify in order and stop at the first failure: (1) commit provenance in `launch-run-<n>.json`, (2) ancestry via `--holds` (citing the replayed SHA after a restack), (3) emitted event/field/refusal in the log or `.out`, and (4) whether the triggering condition actually occurred during the run.

## 4. Structured evidence report

Classify attribution as `proven`, `likely`, `mixed`, or `unproven`, and report using only identifiers, digests, aggregate counts, and file paths (never task text, answers, hidden values, check outputs, or trace excerpts):

```text
Claim:
Condition and identities:
Reference harness / New harness:
Tally (wins, losses, ties, p, unsolved, set aside):
Each harness by itself (valid solves), at the setting's budget:
Repeat, A/A noise, and host load:
Non-results and exclusions:
Changed owner and attribution (proven | likely | mixed | unproven):
Proved without a model:
Validity and exploitation, with coverage:
Unrun or provisional:
Evidence (log, event ids, commit):
```
