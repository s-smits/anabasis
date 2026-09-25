/**
 * The controller's numeric policy: one value, one comment, one place. Centralising these was an
 * operator direction against repeating numeric literals at their consumers.
 *
 * `thresholds.frozen.yaml` is declared policy, and a value here that a manifest row also declares
 * is bound to it by test/frozen-manifest-binding.test.ts. Reading a manifest row is
 * src/critic/manifest.ts's job, not this file's: `climb` is read through `climbThresholds`
 * (src/run/climb-history.ts) and `evaluatorCalibration` through `EVALUATOR_CALIBRATION_POLICY`
 * (src/claim/calibration.ts). Every other value below is code-only, so adding one moves no
 * manifest digest.
 *
 * Where a value's history is long, it is written once at the consumer that acts on it and named
 * here by file. A number still states why it is that number.
 */

/** Declared so `band` is a pair rather than `number[]`; consumers destructure it as [lo, hi]. */
const CLIMB_BAND: [number, number] = [0.2, 0.5];

export const POLICY = {
  climb: {
    /** Manifest row `climb.band`. The pass-rate window a battery is measured against: below it the
     *  tasks are too hard to read, above it no limit was found. Read through the manifest by
     *  `climbThresholds` (src/run/climb-history.ts), which is the value's one owner; every other
     *  consumer receives it. The Builder's battery contract and src/run/battery-sizing.ts take the
     *  band as a parameter and the controller passes `climbThresholds(...).band`; the default they
     *  declare is this row, for a caller with no manifest. Reading this constant directly instead
     *  gives one number three owners, which agree until a manifest override moves the recorded
     *  placement while the Builder's prompt still quotes these counts and the sizing gate still
     *  holds the code-owned ceiling. */
    band: CLIMB_BAND,
    // Gate audit 2026-09-25 (docs/gate-audit.md, off-aim-allowance-stop): commented out (unsure): the Builder owns the route after an off-aim streak, which stays a readout fact
    // /** Consecutive rounds that read one side of the aim before the campaign stops. A round counts
    //  *  when it placed off the aim on that side, and a round whose claim was refused counts with it,
    //  *  because measuring nothing is the same repetition with nothing to place. Three is where the
    //  *  operator has stopped a campaign by hand, so the number matches an observed stopping point
    //  *  rather than being derived. Counted in batteries and not in solves, so a six-task probe
    //  *  campaign stops at the same point as a 25-task one. Counted by `allowance` in
    //  *  src/run/climb-readout.ts and read by src/run/next-move.ts. */
    // offAimStreakRounds: 3,
  },
  loop: {
    /** Consecutive batteries that recorded only typed non-results and created no claim before the
     *  loop closes with an environment terminal. Re-measuring an unavailable provider creates no
     *  evidence, however many rounds it is given, and a small allowance still covers a transient
     *  outage. Read by src/run/full-run-round.ts. */
    environmentBlockedRounds: 3,
    /** Consecutive build-failed rounds before the loop stops trying. One failed authoring round used
     *  to end the campaign, and the recomputed next decision often permits a retry. Read by
     *  src/run/full-run-round.ts as `AUTHORING_STALL_LIMIT`, which explains there why a held
     *  candidate is counted against the same allowance. */
    buildFailedRounds: 3,
    // Gate audit 2026-09-25 (docs/gate-audit.md, repeated-findings-stall): commented out (unsure): one refusal repeated over changed bytes is repair in progress, not a proven stall
    // /** Consecutive gate refusals carrying one findings hash before the authoring loop terminates,
    //  *  counting the current attempt. Eight sits strictly between the deepest observed convergent
    //  *  streak — one hash repeated six times before the gates cleared — and the observed
    //  *  non-convergent one, which repeated a hash fourteen times. Read by src/gate/settlement.ts. */
    // stalledFindingsRepeats: 8,
    /** Consecutive byte-identical resubmits of a refused authoring identity before the session ends
     *  as authoring-stalled. One repeat used to end it outright, which stopped sessions that had a
     *  changed next move already in the transcript; each strike below the ceiling now returns a
     *  counted steering finding instead. A refused submit whose findings digest
     *  repeats on a changed tree is ordinary repair and counts nothing. Read by
     *  src/gate/candidate-memory.ts. */
    noopSubmitStrikes: 3,
    /** How often one workspace commit may be recorded as an unchanged candidate, across the whole
     *  campaign and across invocations, before the round closes as authoring-stalled.
     *  `noopSubmitStrikes` does not cover this: it counts refused resubmits inside one session,
     *  while every strike here is a completed session whose candidate equals its own round entry,
     *  so the in-session counter starts at zero again. Keyed by commit, so a Builder that writes
     *  anything starts a new key. Read by src/run/full-run-build-step.ts. */
    unchangedCandidateStrikes: 3,
    // Gate audit 2026-09-25 (docs/gate-audit.md, tool-non-result-ceiling): commented out (unsure): a tool that cannot run is an environment fact each run records, not a Builder stall
    // /** Refused control censuses attributed to one tool id across a campaign before it ends as
    //  *  `verifier-required`. Counted by tool id rather than candidate identity because each repair
    //  *  changes the tree while the unsuccessful tool run does not, so the no-op strike counter sees
    //  *  a different tree every time. Three matches `noopSubmitStrikes`: report the defect, allow the
    //  *  repair, end the repetition. Read by src/author/tool-non-result.ts. */
    // toolNonResultRefusals: 3,
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
