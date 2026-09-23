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
 * resets the counter like any other delivery. One whose claim was refused counts instead. Read as a
 * delivery it would reset the counter on a battery that was almost entirely non-results, the
 * declared allowance would never engage, and authoring round after authoring round would open
 * against a dead provider until the Builder's own turn was refused. A dead provider is not
 * remeasured merely because rounds remain.
 */
export function nextBlockedRounds(prev: number, result: IterationResult): number {
  const { measure } = result.steps;
  if (measure === null) return prev;
  // Whether the environment carried this battery far enough to say anything. A written claim
  // normally proves it completed turns, with one exception: the provider-stop rule ends scheduling
  // after five consecutive provider non-results and records the battery `provider-stopped`, and
  // the claim it then writes is a refusal for that same dead provider rather than evidence that
  // the provider worked.
  const delivered =
    measure.claim !== null && (measure.claim.created || measure.disposition !== "provider-stopped");
  return delivered ? 0 : prev + 1;
}

/** Count consecutive completed measurements the selector cannot read. A round counts when it opened
 *  on the evidence-free measure reason and closed with nothing the selector reads: no written claim
 *  (the difficulty evidence) and no admitted feedback. The entry decision is the reliable carrier
 *  of the reason, because `nextDecision` is recomputed solely for failed builds and unadopted
 *  candidates and stays null on a reused round — but the entry alone counted the round that
 *  finally produced evidence, and at the third such round `loopTerminal` ended the run before the
 *  next selection could read what it had just been given, which is why the exit check is here too.
 *  Any round of another shape resets the count. Nothing else bounds this spin: the default round
 *  cap that once ended it by accident is gone. */
export function nextStalledMeasureRounds(prev: number, result: IterationResult): number {
  const { measure } = result.steps;
  const stalledEntry =
    measure !== null &&
    result.decision.move === "measure" &&
    result.decision.reason.startsWith(MEASURE_FOR_FEEDBACK_REASON);
  const feedbackRows = result.steps.admission?.feedback.length ?? 0;
  const readable = measure?.claim != null || feedbackRows > 0;
  // The count resets when a measure-for-feedback round writes what the selector reads.
  return stalledEntry && !readable ? prev + 1 : 0;
}
