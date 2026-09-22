/**
 * The controller's numeric policy: one value, one comment, one place.
 *
 * A value a `thresholds.frozen.yaml` row also declares is bound to it by
 * test/frozen-manifest-binding.test.ts; manifest rows are read through src/critic/manifest.ts
 * (`climb` via `climbThresholds` in src/run/climb-history.ts). Every other value is code-only, so
 * adding one moves no manifest digest.
 */

/** Declared so `band` is a pair rather than `number[]`; consumers destructure it as [lo, hi]. */
const CLIMB_BAND: [number, number] = [0.2, 0.5];

export const POLICY = {
  climb: {
    /** Manifest row `climb.band`: the pass-rate window a battery is measured against. Below it the
     *  tasks are too hard to read; above it no limit was found. `climbThresholds` owns the value
     *  and passes it to every consumer; this is the default for a caller with no manifest. */
    band: CLIMB_BAND,
    /** Consecutive rounds reading one side of the aim before the campaign stops; a round whose
     *  claim was refused counts with them. Three matches the observed point where operators
     *  stopped such runs by hand. Counted in batteries, not solves. Counted by `allowance` in
     *  src/run/climb-readout.ts and read by src/run/next-move.ts. */
    offAimStreakRounds: 3,
  },
  loop: {
    /** Consecutive batteries that recorded only typed non-results and created no claim before the
     *  loop closes with an environment terminal. Re-measuring an unavailable provider creates no
     *  evidence; a small allowance covers a transient outage. Read by src/run/full-run-round.ts. */
    environmentBlockedRounds: 3,
    /** Consecutive build-failed rounds before the loop stops trying, since the recomputed next
     *  decision often permits a retry. Read by src/run/full-run-round.ts. */
    buildFailedRounds: 3,
    /** Consecutive completed measurements after which the selector still asks to measure for
     *  feedback: the battery ran, yet no admitted feedback and no difficulty evidence reached the
     *  selector, so a further identical measurement creates nothing new. Matches
     *  `environmentBlockedRounds`. Read by src/run/full-run-round.ts. */
    stalledMeasureRounds: 3,
    /** Consecutive gate refusals carrying one findings hash before the authoring loop terminates,
     *  counting the current attempt. Eight sits between the longest observed streak that still
     *  converged and the shortest that did not. Read by src/gate/settlement.ts. */
    stalledFindingsRepeats: 8,
    /** Consecutive byte-identical resubmits of a refused authoring identity before the session ends
     *  as authoring-stalled; each strike below the ceiling returns a counted steering finding. A
     *  repeated findings digest on a changed tree is ordinary repair and counts nothing. Read by
     *  src/gate/candidate-memory.ts. */
    noopSubmitStrikes: 3,
    /** How often one workspace commit may be recorded as an unchanged candidate, across the
     *  campaign and across invocations, before the round closes as authoring-stalled. Unlike
     *  `noopSubmitStrikes`, each strike is a completed session whose candidate equals its round
     *  entry. Keyed by commit, so any write starts a new key. Read by
     *  src/run/full-run-build-step.ts. */
    unchangedCandidateStrikes: 3,
    /** Refused control censuses attributed to one tool id across a campaign before it ends as
     *  `verifier-required`. Counted by tool id, because each repair changes the tree while the
     *  failing tool run does not. Three matches `noopSubmitStrikes`. Read by
     *  src/author/tool-non-result.ts. */
    toolNonResultRefusals: 3,
  },
  battery: {
    /** The accepted range for a requested battery size. An out-of-range request fails rather than
     *  being clamped, because a silently changed size is a changed measurement condition. Read by
     *  src/run/battery-sizing.ts. */
    floor: 5,
    ceiling: 60,
    /** The size an operator who names none gets. */
    default: 25,
    /** The task counts a fresh product's batteries stay between until one passes some but not all of
     *  its scored cases; the Builder picks the size inside that range. */
    probe: { min: 5, max: 10 },
  },
};
