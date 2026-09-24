/** The Judge aggregate reports whether a complete public-artifact comparison happened. It never
 * changes case truth or the score, and no disagreement grants it authority. Evidence
 * distinguishes intentional abstention from evaluator failure and records both model pins, from
 * which the Judge's independence is derived.
 *
 * The Judge has no control census, so a review is always `unvalidated`. An older record written
 * while one still ran is refused rather than read (operator decision). */

export type JudgeState = "off" | "unvalidated";

export type JudgeDecision =
  | "non-result"
  | "no-battery-verdicts"
  | "incomplete-census"
  | "advisory-comparison";

export type JudgeEvidence =
  | { judge: "off" }
  | {
      judge: "unvalidated";
      judgePin: string;
      /** Content policy identity used by the census, when the session names one. */
      promptPolicyDigest?: string;
      /** The Built Harness backend pin. Independence is derived from it and judgePin by
       *  `evaluatorIndependence` wherever it is needed, so the evidence stores the basis rather than
       *  a classification that could disagree with it. Consumers assessing target or plateau
       *  decisions must also compare this pin with the battery record's backendPin. */
      evaluatedPin: string;
      /** The exact correctnessModel version whose battery this Judge reviewed. */
      correctnessModelId: string;
      /** Every battery subject offered to the Judge, including the ones an abort left unattempted,
       *  so truncated coverage never reads as complete coverage. */
      offered: number;
      /** Offered subjects that came back with a boolean verdict. */
      verdicts: number;
      /** Designed abstentions (the evaluator said "cannot decide", with a reason) — a subset of
       *  offered - verdicts, never a wrong answer and never a proof of anything. */
      abstentions: number;
      disagreements: number;
      disagreementDenominator: number;
      /** Of `disagreements`, the Judge fails of a verifier pass; the rest are Judge passes of a
       *  verifier fail. */
      verifierPassJudgeFail: number;
      /** Of `verifierPassJudgeFail`, the fails that cite a shown rule: the cases the epoch reviewer
       *  settles and the claim reports beside its verifier rate. */
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

/** What a review as a whole says, derived rather than stored, in the order the counts rule each
 *  other out: nothing came back, then verdicts missing from the offered battery, then no
 *  comparable pair to read, and only then an advisory comparison. Null when no Judge ran. */
export function judgeDecision(evidence: JudgeEvidence): JudgeDecision | null {
  if (evidence.judge === "off") return null;
  if (evidence.verdicts === 0) return "non-result";
  if (evidence.verdicts < evidence.offered) return "incomplete-census";
  if (evidence.disagreementDenominator === 0) return "no-battery-verdicts";
  return "advisory-comparison";
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

  judgeIntegrity(nonNegativeInteger(evidence.disagreements), "disagreements must be a non-negative integer");
  judgeIntegrity(
    nonNegativeInteger(evidence.disagreementDenominator),
    "disagreementDenominator must be a non-negative integer",
  );
  judgeIntegrity(
    evidence.disagreementDenominator <= evidence.verdicts,
    "disagreementDenominator cannot exceed completed battery verdicts",
  );
  judgeIntegrity(
    evidence.disagreements <= evidence.disagreementDenominator,
    "disagreements cannot exceed disagreementDenominator",
  );
  judgeIntegrity(
    nonNegativeInteger(evidence.verifierPassJudgeFail) &&
      evidence.verifierPassJudgeFail <= evidence.disagreements,
    "verifierPassJudgeFail must be a non-negative integer within disagreements",
  );
  judgeIntegrity(
    nonNegativeInteger(evidence.vetoed) && evidence.vetoed <= evidence.verifierPassJudgeFail,
    "vetoed must be a non-negative integer within verifierPassJudgeFail",
  );
}
