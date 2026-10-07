/** The Judge aggregate reports whether a complete public-artifact comparison happened. It never
 * changes case truth or the score, and no disagreement grants it authority. Evidence
 * distinguishes intentional abstention from evaluator failure and records both model pins, from
 * which the Judge's independence is derived.
 *
 * The Judge has no control census, so a review is always `unvalidated`. An older record written
 * while one still ran is refused rather than read (operator decision). */

export type JudgeState = "off" | "unvalidated";

export type JudgeDecision = "non-result" | "incomplete-census" | "advisory-comparison";

export type JudgeEvidence =
  | { judge: "off" }
  | {
      judge: "unvalidated";
      judgePin: string;
      /** Content policy identity used by the census, when the session names one. */
      promptPolicyDigest?: string;
      /** The Built Harness backend pin, recorded beside judgePin so a reader can compare the two
       *  models: the evidence stores the basis rather than a classification that could disagree with
       *  it. Consumers assessing target or plateau decisions must also compare this pin with the
       *  battery record's backendPin. */
      evaluatedPin: string;
      /** The exact correctnessModel version whose battery this Judge reviewed. */
      correctnessModelId: string;
      /** Every battery subject offered to the Judge, including the ones an abort left unattempted,
       *  so truncated coverage never reads as complete coverage. */
      offered: number;
      /** Offered subjects that came back pass or fail. */
      verdicts: number;
      /** Offered subjects that came back undecided, which only a review recorded before 2026-09-30
       *  can hold — a subset of offered - verdicts, never a wrong answer and never a proof. */
      abstentions: number;
      /** Judge fails of a verifier pass a second sample repeated (`judgeCaseKind` "veto"): the
       *  cases the epoch reviewer settles and the claim reports beside its verifier rate. Every
       *  other disagreement count is read from the per-case rows. */
      vetoed: number;
    };

/** The controller records Judge aggregates as advisory evidence. Contradictory fields indicate
 * a producer or integrity error and must be reported before claim creation uses the record. */
export class InvalidReviewEvidenceError extends Error {
  readonly code = "JUDGE_EVIDENCE_INTEGRITY" as const;

  constructor(detail: string) {
    super(`judge evidence integrity violation: ${detail}`);
    this.name = "InvalidReviewEvidenceError";
  }
}

function judgeIntegrity(condition: boolean, detail: string): asserts condition {
  if (!condition) throw new InvalidReviewEvidenceError(detail);
}

function nonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/** The subjects the Judge answered: pass, fail or undecided. The one count of answers every
 *  completeness reading takes, so an undecided cannot count as an answer in one place and as a
 *  missing verdict in another. */
export function judgeAnswered(evidence: Extract<JudgeEvidence, { judge: "unvalidated" }>): number {
  return evidence.verdicts + evidence.abstentions;
}

/** What a review as a whole says, derived rather than stored: nothing came back, then answers
 *  missing from the offered battery, and only then an advisory comparison. Null when no Judge ran. */
export function judgeDecision(evidence: JudgeEvidence): JudgeDecision | null {
  if (evidence.judge === "off") return null;
  const answered = judgeAnswered(evidence);
  if (answered === 0) return "non-result";
  return answered < evidence.offered ? "incomplete-census" : "advisory-comparison";
}

/** Recalculate the aggregate relationships used by claim creation. Saved evidence may be older,
 * manually constructed or inconsistent, and matching the JudgeEvidence TypeScript shape cannot
 * establish that its counts agree. */
export function validateJudgeEvidence(evidence: JudgeEvidence): void {
  if (evidence.judge === "off") return;

  judgeIntegrity(evidence.judgePin.trim() !== "", "judgePin must be non-empty");
  if (evidence.promptPolicyDigest !== undefined) {
    judgeIntegrity(
      /^[a-f0-9]{64}$/.test(evidence.promptPolicyDigest),
      "promptPolicyDigest must be a lowercase sha256 digest",
    );
  }
  judgeIntegrity(evidence.evaluatedPin.trim() !== "", "evaluatedPin must be non-empty");
  judgeIntegrity(evidence.correctnessModelId.trim() !== "", "correctnessModelId must be non-empty");

  for (const count of ["offered", "verdicts", "abstentions"] as const) {
    judgeIntegrity(nonNegativeInteger(evidence[count]), `${count} must be a non-negative integer`);
  }
  judgeIntegrity(evidence.verdicts <= evidence.offered, "verdicts exceeds offered");
  // Abstentions are designed nulls, so they fit inside the unanswered part of the census.
  judgeIntegrity(
    evidence.abstentions <= evidence.offered - evidence.verdicts,
    "abstentions exceeds the unanswered census — an abstention is a designed null",
  );

  judgeIntegrity(
    nonNegativeInteger(evidence.vetoed) && evidence.vetoed <= evidence.verdicts,
    "vetoed must be a non-negative integer within verdicts",
  );
}
