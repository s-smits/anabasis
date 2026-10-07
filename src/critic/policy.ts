/**
 * The controller's numeric policy: one value, one comment, one place. Centralising these was an
 * operator direction against repeating numeric literals at their consumers.
 *
 * `thresholds.frozen.yaml` is declared policy, and a value here that a manifest row also declares
 * is bound to it by test/frozen-manifest-binding.test.ts. Reading a manifest row is
 * src/critic/manifest.ts's job, not this file's: `climb` is read through `climbThresholds`
 * (src/run/climb-history.ts) and `evaluatorCalibration` through `EVALUATOR_CALIBRATION_POLICY`
 * (src/run/accept-control-independence.ts). Every other value below is code-only, so adding one
 * moves no manifest digest.
 *
 * Where a value's history is long, it is written once at the consumer that acts on it and named
 * here by file. A number still states why it is that number.
 */

/** Declared so `band` is a pair rather than `number[]`; consumers destructure it as [lo, hi]. */
const CLIMB_BAND: [number, number] = [0.2, 0.5];

export const POLICY = {
  climb: {
    /** Manifest row `climb.band`, the pass-rate window `placeOnBand` places a battery against
     *  (AGENTS.md "Goals and the climb"; its history is beside the row in thresholds.frozen.yaml).
     *  `climbThresholds` (src/run/climb-history.ts) is its one reader; every other consumer takes the
     *  band as a parameter, and the default it declares is this row, for a caller with no manifest.
     *  Reading this constant directly gives one number several owners, which agree until a manifest
     *  override moves the recorded placement while the sizing gate still holds the code-owned
     *  ceiling. */
    band: CLIMB_BAND,
  },
  loop: {
    /** Consecutive batteries that recorded only typed non-results and created no claim before the
     *  loop closes with an environment terminal. Re-measuring an unavailable provider creates no
     *  evidence, however many rounds it is given, and a small allowance still covers a transient
     *  outage. Read by src/run/full-run-round.ts, and by src/run/battery-reuse.ts as the bound on
     *  remeasuring a battery the environment cut short. */
    environmentBlockedRounds: 3,
    /** Consecutive build-failed rounds before the loop stops trying. One failed authoring round used
     *  to end the campaign, and the recomputed next decision often permits a retry. Read by
     *  src/run/full-run-round.ts as `AUTHORING_STALL_LIMIT`, which explains there why a held
     *  candidate is counted against the same allowance. */
    buildFailedRounds: 3,
    /** Consecutive byte-identical resubmits of a refused authoring identity before the session ends
     *  as authoring-stalled. One repeat used to end it outright, which stopped sessions that had a
     *  changed next move already in the transcript; each strike below the ceiling now returns a
     *  counted steering finding instead. A refused submit whose findings digest
     *  repeats on a changed tree is ordinary repair and counts nothing. Read by
     *  src/gate/candidate-memory.ts. */
    noopSubmitStrikes: 3,
    /** Consecutive turns without one successful tool call that end the round as `no-progress`. Codex
     *  blocks a goal after three automatic turns without a tool call, or three whose commands all
     *  failed (codex-rs/ext/goal/src/accounting.rs); one count covers both cases here. Read by
     *  src/author/builder-turn-loop.ts. */
    stalledTurns: 3,
  },
  battery: {
    /** The accepted range for a requested battery size. An out-of-range request fails rather than
     *  being clamped, because a silently changed size is a changed measurement condition. Read by
     *  src/run/battery-sizing.ts. */
    floor: 5,
    ceiling: 60,
    /** The size an operator who names none gets. */
    default: 25,
    /** The task counts a fresh product's probe batteries stay between, until `batterySizingGate`
     *  (src/run/battery-sizing.ts) graduates the product; the Builder picks the size inside. */
    probe: { min: 5, max: 10 },
  },
};
