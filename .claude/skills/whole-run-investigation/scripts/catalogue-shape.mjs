// One declaration of the catalogue's current shape, read by the manifest, the report validator,
// the archive scaffold and the archive validator, so an added lane is one edit here rather than
// one per reader.
//
// Numbering is never renumbered: a lane whose producer left the product keeps its number and reads
// `no-opportunity`. An archive is valid only under the current shape; one written under an older
// shape is refused.

export const SHA256 = /^[0-9a-f]{64}$/;
export const GIT_SHA = /^[0-9a-f]{40}$/;

/** Semantic lanes the current catalogue declares (1..ANGLE_COUNT, contiguous, in order). */
export const ANGLE_COUNT = 26;
export const ANGLE_FILES = ["review-angles.md"];

// These two lanes keep their own evidence boundary even under explicit grouping, and launch only
// when their deterministic trigger has fired. Their numbers are owned here and nowhere else.
export const PUBLIC_ONLY_LANE = 7;
export const TRACE_CHALLENGE_LANE = 23;
export const ISOLATED_ANGLES = new Map([
  [PUBLIC_ONLY_LANE, "freezes its public-only alternative corpus before reading verifier internals"],
  [TRACE_CHALLENGE_LANE, "carries the private trace-challenge packet"],
]);
export const MIN_AUTO_SESSIONS = ISOLATED_ANGLES.size + 1; // one seat for the open lanes

/** Deterministic rows the primary reviewer settles, in catalogue order, with their titles. */
export const DETERMINISTIC_ROW_TITLES = {
  A: "campaign identity",
  B: "claim and promotion state",
  C: "workspace and Git",
  D: "static conformance",
  E: "fingerprint and gate census",
  F: "F2 solvability",
  G: "case partition",
  H: "runtime identity and isolation",
  I: "served-model attestation",
};
export const DETERMINISTIC_ROWS = Object.keys(DETERMINISTIC_ROW_TITLES);

/** Digest verdicts, in ledger order. Each is settled by one block of `digest.mjs`. */
export const DIGEST_VERDICTS = [
  "discrimination-inertness",
  "submit-stall-shape",
  "evidence-integrity",
  "solver-process",
  "check-informativeness",
  "family-wise-coverage",
  "role-spend-and-censoring",
  "band-placement",
  "rehearsal-ledger",
  "toolchain-retention",
];

export function angleNumbers() {
  return Array.from({ length: ANGLE_COUNT }, (_, index) => index + 1);
}

/** The exact prompt one lane receives: the manifest composes it, and the report validator hashes
 *  it again to prove the launch sent what the manifest recorded. */
export function leafPrompt(instructions, task) {
  return `${instructions.trim()}\n\n${task.trim()}\n\nAuthority: read-only. Do not edit files or change external state.`;
}
