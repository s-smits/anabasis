import type { IterationResult } from "./full-run-round.ts";
import { MEASURE_FOR_FEEDBACK_REASON } from "./next-move.ts";

/**
 * Count consecutive environment-blocked batteries. A null claim after an executed battery states
 * exactly that (harness-measure claims contract): every attempted case recorded as a typed
 * non-result of an environment-owned kind, which is what `BatteryVerificationNonResult` is raised
 * on after the battery record is already on disk. Rounds that ran no battery leave the counter
 * unchanged — only a completed measurement can say whether the environment recovered.
 *
 * A provider-stopped battery that still created a claim measured enough cases to be read, so it
 * resets the counter. One whose claim was refused counts, so a dead provider is not remeasured
 * merely because rounds remain.
 */
export function nextBlockedRounds(prev: number, result: IterationResult): number {
  const { measure } = result.steps;
  if (measure === null) return prev;
  // A written claim shows the environment carried the battery, except a refused claim on a
  // `provider-stopped` battery, which records the same dead provider.
  const delivered =
    measure.claim !== null && (measure.claim.created || measure.disposition !== "provider-stopped");
  return delivered ? 0 : prev + 1;
}

/** Count consecutive completed measurements the selector cannot read. A round counts when it opened
 *  on the evidence-free measure reason and closed with nothing the selector reads: no written claim
 *  (the difficulty evidence) and no admitted feedback. The entry decision carries the reason, since
 *  `nextDecision` stays null on a reused round; the exit check keeps a round that finally produced
 *  evidence from counting. Any round of another shape resets the count. */
export function nextStalledMeasureRounds(prev: number, result: IterationResult): number {
  const { measure } = result.steps;
  const stalledEntry =
    measure !== null &&
    result.decision.move === "measure" &&
    result.decision.reason.startsWith(MEASURE_FOR_FEEDBACK_REASON);
  const feedbackRows = result.steps.admission?.feedback.length ?? 0;
  const readable = measure?.claim != null || feedbackRows > 0;
  return stalledEntry && !readable ? prev + 1 : 0;
}
