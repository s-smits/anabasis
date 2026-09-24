/**
 * When an authoring session next owes the Epoch Reviewer a reading, and over which bytes: after a
 * clear `correctness_check` whose agent, correctness-model or battery bytes changed since the last
 * review, that immutable snapshot; after the backstop interval, the live workspace. Both are
 * consulted at the completion of a host tool call, never inside one.
 *
 * The battery counts because `tasks.json` carries each task's hidden expectations and
 * `controls.json` the accept and reject artifacts that calibrate the checks, and neither is inside
 * `correctnessModelHash`. A tolerance widened in a hidden operand, or a reject control rewritten
 * until it no longer tests the fact it was named for, loosens the evaluation exactly as an edit to
 * `evaluator.ts` does, and with only the two bundle hashes compared a task-only round could adopt
 * that change without any review of it before its battery.
 */
import type { BuiltHarness } from "../author/campaign-types.ts";

type Fingerprint = BuiltHarness["fingerprint"];

/** Forty minutes. This bounds when a review happens, never how much one costs: the reviewer is the
 *  only component that reads the authoring tree against the original request, so its spend is not
 *  an axis for savings. */
export const REVIEW_INTERVAL_MS = 40 * 60_000;

/** What the next completed tool call owes the reviewer: a validated product snapshot, the live
 *  workspace, or nothing yet. */
type ReviewDue = { kind: "repair"; fingerprint: Fingerprint } | { kind: "backstop" } | null;

export class AuthoringReviewClock {
  /** The last clear `correctness_check`'s product, consumed by the next completed tool call. */
  private validated: Fingerprint | null = null;
  /** The product a review has already read. An adopted bundle counts as read, because the accepted
   *  product is reviewed after its battery. */
  private reviewed: Fingerprint | null;
  private dueAt: number;

  constructor(
    adopted: Fingerprint | null,
    private readonly intervalMs: number,
  ) {
    this.reviewed = adopted;
    this.dueAt = performance.now() + intervalMs;
  }

  /** A preview came back clear over these bytes. */
  validatedProduct(fingerprint: Fingerprint): void {
    this.validated = fingerprint;
  }

  /** The review this checkpoint owes, consuming the pending validation either way: a product the
   *  reviewer has already read is not repaired merely by being previewed again. */
  due(): ReviewDue {
    const fingerprint = this.validated;
    this.validated = null;
    if (
      fingerprint !== null &&
      (fingerprint.agentHash !== this.reviewed?.agentHash ||
        fingerprint.correctnessModelHash !== this.reviewed.correctnessModelHash ||
        fingerprint.taskSetHash !== this.reviewed.taskSetHash)
    ) {
      return { kind: "repair", fingerprint };
    }
    return performance.now() < this.dueAt ? null : { kind: "backstop" };
  }

  /** This product has now been read. A backstop review of the live workspace reads a draft that is
   *  still moving, so it settles nothing and records no product. */
  read(fingerprint: Fingerprint): void {
    this.reviewed = fingerprint;
  }

  /** The backstop restarts whenever a review ran, including one that produced no advice: the
   *  session has just paid for a reading either way. */
  restart(): void {
    this.dueAt = performance.now() + this.intervalMs;
  }
}
