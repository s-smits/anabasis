// One declaration of the catalogue's current shape, read by the manifest parser, the report
// validator, the manifest composer and the archive validator. The four used to carry their own
// literal 26 / A-H / five-verdict copies, so an added lane meant editing every copy and the
// archive validator refusing a new archive until all of them agreed.
//
// Numbering is never renumbered: a lane whose producer left the product keeps its number and reads
// `no-opportunity`. An archive is valid only under the current shape; one written under an older
// shape is refused.

/** Semantic angles the current catalogue declares (1..ANGLE_COUNT, contiguous, in order). */
export const ANGLE_COUNT = 36;
export const ANGLE_FILES = ["review-angles.md", "review-angles-boundaries.md"];

// These sessions must retain their own evidence boundary even under explicit grouping.
export const ISOLATED_ANGLES = new Map([
  [15, "carries the private trace-challenge packet"],
  [36, "derives its valid-alternative corpus before reading verifier internals"],
]);
export const MIN_AUTO_SESSIONS = ISOLATED_ANGLES.size + 2; // two more seats separate blinded pairs

/** Deterministic rows the primary reviewer settles, in catalogue order. */
export const DETERMINISTIC_ROWS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];

/** Digest verdicts, in ledger order. The last three are settled by trace-digest blocks 1c, 3b
 *  and 4c. */
export const DIGEST_VERDICTS = [
  "discrimination-inertness",
  "submit-stall-shape",
  "evidence-integrity",
  "solver-process",
  "saturation-ledger",
  "check-informativeness",
  "family-wise-coverage",
  "role-spend-and-censoring",
];

/** Deterministic-first reading order. Triggers select depth in a full review; only an explicitly
 *  targeted review uses them to omit a session. */
export const DETERMINISTIC_FIRST_ANGLES = new Set([2, 11, 13, 14, 16, 18, 23, 24, 25, 26, 28, 31]);

export function angleNumbers() {
  return Array.from({ length: ANGLE_COUNT }, (_, index) => index + 1);
}
