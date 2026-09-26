# Aligned authoring policy

AGENTS.md states the rules; this file exists for one narrower job. A census asks of each
model-visible string: **does this number have an owner in source, and did the surface derive it or
spell it?** A literal in a prompt is the shape to flag, because a constant that moves leaves the
literal behind. Fix a misalignment at its owner and pin it in the owning test, importing the
constant (`test/builder-start-prompt.test.ts` does this for walls).

Every number here is a copy. When it and the source disagree the source wins and this file is the
thing to correct.

| Number a surface may state | Owner in source | Today |
| --- | --- | --- |
| pass counts: first battery, aim, no-limit-found | `bandLandmarks` (`src/claim/battery-difficulty.ts`) over the band the controller passes, `climbThresholds(...).band` (`src/run/climb-history.ts`), which reads the manifest row `climb.band` and falls back to `POLICY.climb.band` (`src/critic/policy.ts`) | band [0.2, 0.5]; 25 tasks → about 3 first, 5 to 12 aim, 18 and up too easy |
| which side of the band a battery landed | `placeOnBand` (`src/claim/battery-difficulty.ts`), Wilson at `REPORTING_Z` (`src/claim/estimation.ts`) | interval decides too easy or too hard; point count decides under, on, over |
| battery size | `POLICY.battery` (`src/critic/policy.ts`), re-exported as `BATTERY_SIZE` by `src/run/battery-sizing.ts`, which owns the decisions taken from it | floor 5, default 25, ceiling 60; probe 5 to 10 until one battery passes some but not all |
| solver walls | `SETTINGS.solver` (`src/truth/harness-config.ts`) | solve 120 min, 24 turns, shell 300 s, 900 s at most; `agent/config.yaml` may raise each up to ten times |
| verifier and gate walls | `SETTINGS.gate`, read by `src/verify/host.ts`, `src/truth/evaluator-process.ts`, `src/run/census-gate.ts` | reference solve 120 s, tool run 300 s, check with its runs 600 s, census 30 min |
| battery solve concurrency | `SETTINGS.battery` (`src/truth/harness-config.ts`), read by `src/truth/verification-runner.ts` | 3 solves at once |
| Builder bash | `ISOLATED_TIMEOUT_MS` (`src/builder/candidate-isolation-runtime.ts`), `BASH_TIMEOUT_MAX_MS` (`src/builder/bash-install-env.ts`) | 10 min default, 2 h at most, for builds |
| trial bounds | the provider budget (`src/run/builder-campaign.ts`, `createHarnessTrialTool` in `src/builder/harness-trial.ts`) | no count of its own; each rehearsal is one measured case, graded under the battery's own `check_seconds` and `tool_run_seconds` |
| control calibration | manifest row `evaluatorCalibration` (`thresholds.frozen.yaml`), read by `EVALUATOR_CALIBRATION_POLICY` (`src/claim/calibration.ts`) | at least 5 accepts and 5 rejects, told as an authoring requirement and measured by no gate |
| session and round strikes | `POLICY.loop` (`src/critic/policy.ts`) | `unchangedCandidateStrikes` 3, `noopSubmitStrikes` 3 |
| review clock and hold | `REVIEW_INTERVAL_MS` (`src/gate/review-clock.ts`), `READER_DEADLINE_MS` (`src/review/review-reader.ts`) | a review after 40 min without one; a held submit waits at most 1 h |
| Epoch Reviewer probes | `PROBE_BUDGET`, `VALUE_MAX_CHARS` (`src/review/review-probe.ts`) | 8 probes per review, replacement values up to 4,000 characters |

The model-visible difficulty surface is `renderBatteryContract` (`src/run/climb-readout.ts`),
whose every sentence is a line of `FRAME` (`src/run/climb-readout-frame.ts`). It derives the first
battery's count, the no-limit count and the aim from the band it is passed, so a band change
rewrites the sentences with it, and `FRAME_REVISION` records the wording a decision was rendered
from.

## Retired spellings a census should flag as stale

- `PASS_COURSE` and the staged "about 3, then 15, then 22 of 25". **No course is prescribed.** The
  prompts state the count the band implies and leave the route to the Builder. Campaign
  `3fd52f9e-28` is why: told to relax one named requirement at a time towards a higher count, it
  ran four consecutive batteries at delta checks +0, limits +0, coupled +0, tooled +0, rules +0,
  roots +0, inputs +0, scenarios +0, novelty 0.0000, moving only published magnitudes — 194 numbers
  by 12.82 per cent, then 116 by 4.79, then 138 by 2.00.
- "aim at 8 to 18 of 25", and `climb.band` of [0.2, 0.6].
- "only its expected check" or "exactly [expectedCheckId]" — the retired exact-set reject rule.
  Blockers `[match, shadow]` with `expectedCheckId: "match"` pass.
- One reject per check-by-family cell, which asked a 6-check, 5-family truss for 30 rejects.
- A preview ceiling, a probe budget or a no-submit strike.
- `judgeBackendFor`, `--judge-backend`, `HARNESS_JUDGE_BACKEND`, and any Judge control census,
  bait corpus or review standing.
- The duplicate Wilson implementation, `wilsonZ` and `minLevelN`. Neither is a row any more:
  `thresholds.frozen.yaml` names both only in comments recording their removal on 2026-09-18, and
  nothing under `src` produces either. The one quantile is `REPORTING_Z` in
  `src/claim/estimation.ts`, and the battery-size floor is `POLICY.battery.floor`, which is 5.
  `climbThresholds` (`src/run/climb-history.ts`) is a `policyRow` whose schema is `{band}`, and
  `policyRow` fills its record from the schema's own keys, so a yaml row cannot add one back. What
  went with `minLevelN` is the placement discard; the readout (`src/run/climb-readout.ts`) places
  every admitted row it can size.
- Any refusal the gate audit of 2026-09-25 commented out, stated to a model as a rule. A
  commented-out refusal is not enforced, so a surface describing it teaches a constraint nothing
  holds. `docs/gate-audit.md` lists them under "Commented out (unsure)"; in `POLICY` that covers
  `offAimStreakRounds`, `stalledFindingsRepeats` and `toolNonResultRefusals`, and the rest are
  validators such as `reject-discrimination`, `task-variation` and `published-rules`. Search the
  census for the behaviour, not only the name, because a prompt states the rule in prose.

## Three findings that are not copies of a constant

- **Limits come from a strengthened reference.** For a lightest, cheapest or fastest request the
  limit is the difficulty. Run `805bcc` set limits at 1.08 times a weak reference and its solves
  cleared them by a wide margin: those limits measured feasibility, not quality. Strengthen the
  reference solve until it matches the best candidate the Builder can construct, `harness_trial`
  included.
- **The solver keeps the construction method.** Tools may compute and return candidates, never the
  remaining decision. The Built prompt treats a first passing candidate as a baseline to beat, and
  a published limit as a margin to widen rather than a box to tick.
- **A long verifier run is a tool defect.** Of 184,953 recorded tool runs, 99 per cent took under
  16 s. A truss analysis past five minutes is something to repair, not a reason for a longer wall.
