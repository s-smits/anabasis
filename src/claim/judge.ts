/** The Judge aggregate reports whether a complete public-artifact comparison happened. It never
 * changes case truth or the score, and no disagreement grants it authority. Evidence
 * distinguishes intentional abstention from evaluator failure and records the Judge's
 * independence classification derived from the model pins.
 *
 * The Judge has no control census, so a review is always `unvalidated`. A record from before
 * 2026-09-14, when one ran, is refused rather than read (operator decision 2026-09-22). */
import { type EvaluatorIndependence, evaluatorIndependence } from "./calibration.ts";
import type { NonResultKind } from "./record-events.ts";

export type JudgeState = "off" | "unvalidated";

export type JudgeDecision =
  | "non-result"
  | "no-battery-verdicts"
  | "incomplete-census"
  | "advisory-comparison";

type JudgeCensusCounts = {
  controls: number;
  battery: number;
  total: number;
};

export type JudgeEvidence =
  | { judge: "off" }
  | {
      judge: "unvalidated";
      judgePin: string;
      /** Content policy identity used by the census, when the session names one. */
      promptPolicyDigest?: string;
      /** The Built Harness backend pin, used with judgePin to recalculate `independence`.
       *  PR #67 found that storing only a classification left the validator unable to check
       *  its basis. Consumers assessing target or plateau decisions must also compare this
       *  pin with the battery record's backendPin. */
      evaluatedPin: string;
      /** The exact correctnessModel version whose battery this Judge reviewed. */
      correctnessModelId: string;
      /** `controls` is 0: the Judge has no control census. */
      censusSize: JudgeCensusCounts;
      verdicts: JudgeCensusCounts;
      /** Designed abstentions (the evaluator said "cannot decide", with a reason) — a subset of
       *  censusSize - verdicts, never a wrong answer and never a proof of anything. */
      abstentions: JudgeCensusCounts;
      disagreements: number;
      disagreementDenominator: number;
      disagreementRate: number | null;
      verifierPassJudgeFail: number;
      verifierFailJudgePass: number;
      /** Of `verifierPassJudgeFail`, the fails that cite a shown rule: the cases the epoch reviewer
       *  settles and the claim reports beside its verifier rate. */
      vetoed: number;
      decision: JudgeDecision;
      /** How independent this evaluator is from the evaluated model — derived from the two
       *  pins, never asserted. */
      independence: EvaluatorIndependence;
      /** Typed causes of evaluator errors in this census, counted per NonResultKind. Present
       *  only when at least one attempt failed, so a zero-verdict census names what failed
       *  (provider, protocol, transport) instead of flattening every cause into prose.
       *  Diagnostic only — validity and decision never read it. */
      errorKinds?: Partial<Record<NonResultKind, number>>;
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

/** The decision the aggregate fields imply, in the order those fields rule each other out: no
 *  verdicts at all, then an incomplete census, then no battery verdict to compare, and only then
 *  an advisory comparison. */
function aggregateDecision(evidence: Exclude<JudgeEvidence, { judge: "off" }>): JudgeDecision {
  if (evidence.verdicts.total === 0) return "non-result";
  if (evidence.verdicts.battery < evidence.censusSize.battery) return "incomplete-census";
  if (evidence.disagreementRate === null) return "no-battery-verdicts";
  return "advisory-comparison";
}

/** Recalculate the aggregate relationships used by claim creation. Saved evidence may be
 * older, manually constructed or inconsistent; matching the JudgeEvidence TypeScript shape
 * cannot establish that its counts, classifications and decisions agree. */
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

  for (const component of ["controls", "battery", "total"] as const) {
    const census = evidence.censusSize[component];
    const verdicts = evidence.verdicts[component];
    judgeIntegrity(nonNegativeInteger(census), `censusSize.${component} must be a non-negative integer`);
    judgeIntegrity(nonNegativeInteger(verdicts), `verdicts.${component} must be a non-negative integer`);
    judgeIntegrity(verdicts <= census, `verdicts.${component} exceeds censusSize.${component}`);
  }
  judgeIntegrity(
    evidence.censusSize.controls === 0,
    "censusSize.controls must be 0: a control census stood behind this review, and none has run since 2026-09-14",
  );
  judgeIntegrity(
    evidence.censusSize.total === evidence.censusSize.controls + evidence.censusSize.battery,
    "censusSize.total must equal controls + battery",
  );
  judgeIntegrity(
    evidence.verdicts.total === evidence.verdicts.controls + evidence.verdicts.battery,
    "verdicts.total must equal controls + battery",
  );
  // Abstentions are designed nulls: bounded by the uncompleted census componentwise.
  for (const component of ["controls", "battery", "total"] as const) {
    judgeIntegrity(
      nonNegativeInteger(evidence.abstentions[component]),
      `abstentions.${component} must be a non-negative integer`,
    );
    judgeIntegrity(
      evidence.abstentions[component] <= evidence.censusSize[component] - evidence.verdicts[component],
      `abstentions.${component} exceeds the unanswered census — an abstention is a designed null`,
    );
  }
  judgeIntegrity(
    evidence.abstentions.total === evidence.abstentions.controls + evidence.abstentions.battery,
    "abstentions.total must equal controls + battery",
  );

  judgeIntegrity(nonNegativeInteger(evidence.disagreements), "disagreements must be a non-negative integer");
  judgeIntegrity(
    nonNegativeInteger(evidence.disagreementDenominator),
    "disagreementDenominator must be a non-negative integer",
  );
  judgeIntegrity(
    evidence.disagreementDenominator <= evidence.verdicts.battery,
    "disagreementDenominator cannot exceed completed battery verdicts",
  );
  judgeIntegrity(
    evidence.disagreements <= evidence.disagreementDenominator,
    "disagreements cannot exceed disagreementDenominator",
  );
  judgeIntegrity(
    nonNegativeInteger(evidence.verifierPassJudgeFail) && nonNegativeInteger(evidence.verifierFailJudgePass),
    "directional disagreement counts must be non-negative integers",
  );
  judgeIntegrity(
    evidence.verifierPassJudgeFail + evidence.verifierFailJudgePass === evidence.disagreements,
    "directional disagreement counts must sum to disagreements",
  );
  judgeIntegrity(
    nonNegativeInteger(evidence.vetoed) && evidence.vetoed <= evidence.verifierPassJudgeFail,
    "vetoed must be a non-negative integer within verifierPassJudgeFail",
  );

  const derivedRate =
    evidence.disagreementDenominator === 0 ? null : evidence.disagreements / evidence.disagreementDenominator;
  judgeIntegrity(
    evidence.disagreementRate === derivedRate,
    `disagreementRate must equal disagreements/disagreementDenominator (${String(derivedRate)})`,
  );

  const derivedDecision = aggregateDecision(evidence);
  judgeIntegrity(
    evidence.decision === derivedDecision,
    `decision=${evidence.decision} contradicts aggregate fields (expected ${derivedDecision})`,
  );

  const derivedIndependence = evaluatorIndependence(evidence.judgePin, evidence.evaluatedPin);
  judgeIntegrity(
    evidence.independence === derivedIndependence,
    `independence=${evidence.independence} contradicts the evidence's pins (derived ${derivedIndependence} from ${evidence.judgePin} vs ${evidence.evaluatedPin})`,
  );
}
