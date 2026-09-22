/**
 * Estimation vocabulary (plan-pack W4, "Estimation and calibration"): raw success rates with
 * Wilson score intervals at the registered reporting confidence. Decisions use raw counts and
 * intervals only — nothing here smooths or fills an absent measurement.
 *
 * One interval, one confidence, one owner. Until 2026-09-18 a second implementation lived in
 * battery-difficulty.ts at a rounded z of 1.96 and answered [0, 1] rather than nothing at n = 0,
 * so one battery read two ways depending on which reader reached it first.
 */

/** The registered reporting confidence, declared beside the band as `climb.confidence`. */
export const REPORTING_CONFIDENCE = 0.95;

/** Two-sided normal quantile for {@link REPORTING_CONFIDENCE} — registered alongside it, not
 *  recomputed. test/frozen-manifest-binding.test.ts recovers one from the other. */
export const REPORTING_Z = 1.959963984540054;

interface WilsonBounds {
  lower: number;
  upper: number;
}

/**
 * Wilson score interval for `successes` out of `n` scored cases. Chosen over the normal
 * approximation because gate and battery denominators are small (single digits to low tens),
 * where a Wald interval becomes misleading near zero or full success.
 *
 * Null is the one answer for "this is not a sample": nothing scored, a malformed count, or more
 * successes than attempts. Each reader turns that null into its own refusal rather than a number,
 * so an unmeasured battery never reads as a measured one.
 */
export function wilsonInterval(successes: number, n: number): WilsonBounds | null {
  if (!Number.isInteger(successes) || !Number.isInteger(n) || n <= 0 || successes < 0 || successes > n) {
    return null;
  }
  const p = successes / n;
  const z2 = REPORTING_Z * REPORTING_Z;
  const denominator = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const spread = REPORTING_Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    lower: Math.max(0, (centre - spread) / denominator),
    upper: Math.min(1, (centre + spread) / denominator),
  };
}
