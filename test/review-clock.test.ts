/**
 * Which validated previews owe the Epoch Reviewer a reading of their snapshot. The battery pair
 * carries the hidden expectations and the calibrating controls, so a change confined to it is a
 * change to what the evaluation demands and has to be read before adoption like any other.
 */
import { describe, expect, it } from "bun:test";
import type { FingerprintEvidence } from "../src/claim/fingerprint.ts";
import { AuthoringReviewClock } from "../src/gate/review-clock.ts";

const ADOPTED: FingerprintEvidence = {
  ok: true,
  slug: "fixture",
  agentHash: "agent-a",
  correctnessModelHash: "model-a",
  scoringHash: "scoring-a",
  taskSetHash: "tasks-a",
  agentFiles: [],
  correctnessModelFiles: [],
};
const HOUR = 60 * 60_000;

describe("AuthoringReviewClock", () => {
  it("owes a review when only the battery pair moved since the last reading", () => {
    const clock = new AuthoringReviewClock(ADOPTED, HOUR);
    const probe = { ...ADOPTED, taskSetHash: "tasks-b" };
    clock.validatedProduct(probe);
    expect(clock.due()).toEqual({ kind: "repair", fingerprint: probe });
    clock.read(probe);
    // The same battery previewed again is not a new product.
    clock.validatedProduct(probe);
    expect(clock.due()).toBeNull();
  });

  it("owes nothing for a preview of the product a review already read", () => {
    const clock = new AuthoringReviewClock(ADOPTED, HOUR);
    clock.validatedProduct({ ...ADOPTED });
    expect(clock.due()).toBeNull();
  });
});
