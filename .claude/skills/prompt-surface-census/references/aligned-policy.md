# Aligned authoring policy

AGENTS.md states the rules; this file exists for one narrower job. A census asks of each
model-visible string: **does this number have an owner in source, and did the surface derive it or
spell it?** A literal in a prompt is the shape to flag, because a constant that moves leaves the
literal behind. Fix a misalignment at its owner and pin it in the owning test, importing the
constant (`test/builder-start-prompt.test.ts` does this for walls).

The two climb rows name their owner and the section of AGENTS.md "Goals and the climb" that says
what the value means, rather than the value. Every other number here is a copy. When it and the
source disagree the source wins and this file is the thing to correct.

| Number a surface may state | Owner in source | Today |
| --- | --- | --- |
| which side of the band a battery landed, read by the controller and the reviewer only | `placeOnBand` (`src/claim/battery-difficulty.ts`), Wilson at `REPORTING_Z` (`src/claim/estimation.ts`), over `climbThresholds(...).band` (`src/run/climb-history.ts`), which reads the manifest row `climb.band` and falls back to `POLICY.climb.band` (`src/critic/policy.ts`) | the `climb.band` row in `thresholds.frozen.yaml`, its ceiling's history beside it; what the interval and the point count decide is AGENTS.md "Goals and the climb", under "The band and the placement" |
| battery size | `POLICY.battery` (`src/critic/policy.ts`), re-exported as `BATTERY_SIZE` by `src/run/battery-sizing.ts`, which owns the decisions taken from it | the values in `POLICY.battery`; the probe and its graduation are AGENTS.md "Goals and the climb", under "The three parts of the climb", and the sizing decisions under "Who hears the placement, and what it drives" |
| solver walls | `SETTINGS.solver` (`src/correctness-bundle/harness-config.ts`) | solve 120 min, 24 turns, shell 300 s, 900 s at most; `agent/config.yaml` may raise each up to ten times |
| verifier and gate walls | `SETTINGS.gate`, read by `src/verify/host.ts`, `src/correctness-bundle/evaluator-process.ts`, `src/run/census-gate.ts` | reference solve 120 s, tool run 300 s, check with its runs 600 s, census 30 min |
| battery solve concurrency | `SETTINGS.battery` (`src/correctness-bundle/harness-config.ts`), read by `src/correctness-bundle/verification-runner.ts` | 3 solves at once |
| Builder bash | `ISOLATED_TIMEOUT_MS` (`src/builder/candidate-isolation-runtime.ts`), `BASH_TIMEOUT_MAX_MS` (`src/builder/bash-install-env.ts`) | 10 min default, 2 h at most, for builds |
| trial bounds | the provider budget (`src/run/builder-campaign.ts`, `createHarnessTrialTool` in `src/builder/harness-trial.ts`) | no count of its own; each rehearsal is one measured case, graded under the battery's own `check_seconds` and `tool_run_seconds` |
| control calibration | manifest row `evaluatorCalibration` (`thresholds.frozen.yaml`), read by `EVALUATOR_CALIBRATION_POLICY` (`src/run/accept-control-independence.ts`) | at least 5 accepts and 5 rejects, told as an authoring requirement and measured by no gate |
| session and round strikes | `POLICY.loop` (`src/critic/policy.ts`) | `noopSubmitStrikes` 3 |
| review clock and hold | `REVIEW_INTERVAL_MS` (`src/gate/review-clock.ts`), `READER_DEADLINE_MS` (`src/review/review-reader.ts`) | a review after 40 min without one; a held submit waits at most 1 h |
| Epoch Reviewer probes | `PROBE_BUDGET`, `VALUE_MAX_CHARS` (`src/review/review-probe.ts`) | 8 probes per review, replacement values up to 4,000 characters |
| Epoch Reviewer findings | `MAX_FINDINGS` (`src/review/epoch-review-findings.ts`) | 6 per review |
| Judge rationale | `RATIONALE_MAX` (`src/review/judge-drivers.ts`) | 400 characters |

The model-visible difficulty surfaces are `renderBatteryContract` and `renderReadout`
(`src/run/climb-readout.ts`), the size sentences `taskCountSentence` and `renderProbeSizing`
(`src/run/battery-sizing.ts`), and, for the reviewer only, `readingSentence` with its `ZONE_WORDS`
(`src/run/climb-readout.ts`). What each may state, and why the placement stays with the controller
and the reviewer, is AGENTS.md "Goals and the climb", under "Who hears the placement, and what it
drives". So flag any zone, aim, share or count to author towards on these surfaces, and any band or
battery-size number a surface spells rather than derives from its owner.

## Retired spellings a census should flag as stale

- `PASS_COURSE` and the staged "about 3, then 15, then 22 of 25". No course is prescribed (AGENTS.md
  prior 10, and "Goals and the climb", under "Tried and taken out"). Campaign `3fd52f9e-28`, the
  prior's incident, was told to relax one named requirement at a time towards a higher count and
  ran four consecutive batteries at delta checks +0, limits +0, coupled +0, tooled +0, rules +0,
  roots +0, inputs +0, scenarios +0, novelty 0.0000, moving only published magnitudes — 194 numbers
  by 12.82 per cent, then 116 by 4.79, then 138 by 2.00.
- "aim at 8 to 18 of 25", and `climb.band` of [0.2, 0.6]: superseded values, whose history sits
  beside the row in `thresholds.frozen.yaml`.
- Any aim or no-limit count in a Builder surface ("25 tasks: aim 5 to 12 passing, 18 or more finds
  no limit"), `bandLandmarks`, and the plan advice reading a pass range against the aim, all taken
  out (AGENTS.md "Goals and the climb", under "Tried and taken out").
- "only its expected check" or "exactly [expectedCheckId]" — the retired exact-set reject rule.
  Blockers `[match, shadow]` with `expectedCheckId: "match"` pass.
- One reject per check-by-family cell, which asked a 6-check, 5-family truss for 30 rejects.
- A preview ceiling, a probe budget or a no-submit strike.
- `judgeBackendFor`, `--judge-backend`, `HARNESS_JUDGE_BACKEND`, and any Judge control census,
  bait corpus or review standing.
- The duplicate Wilson implementation, `wilsonZ` and `minLevelN` (AGENTS.md "Goals and the
  climb", under "Tried and taken out"). `thresholds.frozen.yaml` names both only in comments
  recording their removal, nothing under `src` produces either, and `climbThresholds`
  (`src/run/climb-history.ts`) is a `policyRow` whose schema is `{band}`, so a yaml row cannot add
  one back. A surface derives the quantile from `REPORTING_Z` (`src/claim/estimation.ts`) and the
  battery-size floor from `POLICY.battery.floor`.
- Any refusal the gate audits deleted, stated to a model as a rule. A deleted refusal is not
  enforced, so a surface describing it teaches a constraint nothing holds. `docs/gate-audit.md`
  lists them under "Deleted"; in `POLICY` that covered `offAimStreakRounds`,
  `stalledFindingsRepeats` and `toolNonResultRefusals`, and the rest are validators such as
  `task-variation` and `representation-blocking`. The reverse holds
  too: every code STARTER.md's Gates section names is one some source still emits, which
  `test/gate-decisions.test.ts` checks. Search the census for the behaviour, not only the name,
  because a prompt states the rule in prose.

## Three findings that are not copies of a constant

- **Limits come from a strengthened reference.** For a lightest, cheapest or fastest request the
  limit is where the difficulty sits. Run `805bcc` set limits at 1.08 times a weak reference and
  its solves cleared them by a wide margin: those limits measured feasibility, not quality.
  Strengthen the reference solve until it matches the best candidate the Builder can construct,
  `harness_trial` included. A limit tightened to even a strong reference is still not a harder task
  by itself, since the change has to be one the passing solves' own steps do not settle (AGENTS.md
  "Goals and the climb", under "What the Builder is asked, round by round").
- **The solver keeps the construction method.** Tools may compute and return candidates, never the
  remaining decision. The Built prompt treats a first passing candidate as a baseline to beat, and
  a published limit as a margin to widen rather than a box to tick.
- **A long verifier run is a tool defect.** Of 184,953 recorded tool runs, 99 per cent took under
  16 s. A truss analysis past five minutes is something to repair, not a reason for a longer wall.
