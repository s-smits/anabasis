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
| pass counts: first battery, aim, no-limit-found | `bandLandmarks` (`src/claim/battery-difficulty.ts`) on `POLICY.climb.band` | band [0.2, 0.5]; 25 tasks → about 3 first, 5 to 12 aim, 18 and up too easy |
| which side of the band a battery landed | `placeOnBand` (`src/claim/battery-difficulty.ts`), Wilson at `REPORTING_Z` (`src/claim/estimation.ts`) | interval decides too easy or too hard; point count decides under, on, over |
| battery size | `BATTERY_SIZE` (`src/run/battery-sizing.ts`) | floor 5, default 25, ceiling 60; probe 5 to 10 until one battery passes some but not all |
| solver turns, shell walls | `SETTINGS.solver` (`src/truth/harness-config.ts`) | 24 turns, shell 300 s, 900 s at most; `agent/config.yaml` may raise each up to ten times |
| verifier walls | `SETTINGS.gate`, read by `src/verify/host.ts`, `src/truth/evaluator-process.ts`, `src/run/census-gate.ts` | tool run 300 s, check with its runs 600 s, census 30 min |
| Builder bash | `ISOLATED_TIMEOUT_MS` (`src/builder/candidate-isolation-runtime.ts`), `BASH_TIMEOUT_MAX_MS` (`src/builder/bash-install-env.ts`) | 10 min default, 2 h at most, for builds |
| trial bounds | `MAX_CALLS` (`src/builder/harness-trial.ts`) | 16 calls, 30 s verifier deadline |
| control calibration | `publicRuleFindings` (`src/truth/controls.ts`) | at least 5 accepts and 5 rejects; one accept per applicable check-by-family cell; one attributed reject per applicable check and per family, one reject may serve both |
| session and round strikes | `POLICY.loop` (`src/critic/policy.ts`) | `unchangedCandidateStrikes` 3, `noopSubmitStrikes` 3, `stalledFindingsRepeats` 8 |

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
- The duplicate Wilson implementation. `wilsonZ` is still declared at `thresholds.frozen.yaml:70`
  with no source consumer; the one quantile is `REPORTING_Z` in `src/claim/estimation.ts`.
  `minLevelN` went with it, and this list said otherwise until 2026-09-23. It claimed the name was
  still the battery-size floor in `src/run/battery-sizing.ts`; that file declares no such symbol,
  and the floor there is `POLICY.battery.floor`, which is 5. Nothing under `src` produces
  `minLevelN` today — `climbThresholds` (`src/run/climb-history.ts`) is a `policyRow` whose schema
  is `{band}`, and `policyRow` fills its record from the schema's own keys, so a yaml row cannot
  add one. What went with the name is the placement discard; the readout
  (`src/run/climb-readout.ts`) places every admitted row it can size.

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
