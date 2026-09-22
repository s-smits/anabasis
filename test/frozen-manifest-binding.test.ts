/**
 * The manifest is declared policy; an executable restatement that drifts from it is a blocking
 * inconsistency (tenet 8). The new-file ceiling drifted exactly this way: the gate moved to 600
 * on 2026-08-03 while the manifest said 400 until 2026-08-14, and nothing noticed for eleven
 * days. These tests compare climb, review, size and calibration values with their manifest
 * rows, so changes to those values must also update the declared policy.
 */
import { describe, expect, it } from "bun:test";
import { EVALUATOR_CALIBRATION_POLICY } from "../src/claim/calibration.ts";
import { frozenRow } from "../src/critic/manifest.ts";
import { isNumber } from "../src/meta/json-shape.ts";
import { POLICY } from "../src/critic/policy.ts";
import { REVIEW_TURN_TIMEOUT_MS } from "../src/review/review-session.ts";
import { REPORTING_CONFIDENCE, REPORTING_Z } from "../src/claim/estimation.ts";
import { NEW_FILE_CEILING, NEW_FUNCTION_CEILING } from "../tools/loc/source-policy.ts";

/** Abramowitz and Stegun 7.1.26, whose error stays under 1.5e-7 — far tighter than the distance
 *  between two confidence levels anyone would choose. */
function standardNormalCdf(z: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const poly = (((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592;
  const erf = 1 - poly * t * Math.exp(-((z / Math.SQRT2) ** 2));
  return 0.5 * (1 + (z < 0 ? -erf : erf));
}

describe("executable restatements match thresholds.frozen.yaml", () => {
  it("POLICY.climb defaults equal the climb row", () => {
    const row = frozenRow("climb");
    expect(row["band"]).toEqual(POLICY.climb.band);
  });

  it("the review turn timeout equals judgeRuntime.turnTimeoutMs", () => {
    expect(frozenRow("judgeRuntime")["turnTimeoutMs"]).toBe(REVIEW_TURN_TIMEOUT_MS);
  });

  it("the source-policy ceilings equal the sizeCeiling row", () => {
    const row = frozenRow("sizeCeiling");
    expect(row["newFileLines"]).toBe(NEW_FILE_CEILING);
    expect(row["newFunctionLines"]).toBe(NEW_FUNCTION_CEILING);
  });

  it("the control corpus floors equal the evaluatorCalibration row", () => {
    const row = frozenRow("evaluatorCalibration");
    expect(row["minimumKnownPasses"]).toBe(EVALUATOR_CALIBRATION_POLICY.minimumKnownPasses);
    expect(row["minimumKnownFailures"]).toBe(EVALUATOR_CALIBRATION_POLICY.minimumKnownFailures);
    expect(Object.keys(row).length).toBe(2);
  });

  it("the reporting z is the normal quantile of the declared confidence", () => {
    // The manifest declares the confidence a reader can argue about; the source declares the z that
    // confidence implies. Recovering one from the other is what keeps them from drifting apart: a
    // z of 1.645 (90 per cent) or 2.576 (99 per cent) fails here while still looking plausible.
    const { confidence } = frozenRow("climb");
    if (!isNumber(confidence)) throw new Error("climb.confidence is not a number in the manifest");
    expect(REPORTING_CONFIDENCE).toBe(confidence);
    expect(2 * standardNormalCdf(REPORTING_Z) - 1).toBeCloseTo(confidence, 6);
  });
});
