/**
 * Three sensors for the Main Judge after its control census went (operator decision 2026-09-14).
 * Each appends one safeguard line and changes nothing else: the Judge stays advice and the verifier
 * decides. They watch the shapes that census used to catch, and the ones its removal could invite,
 * so a later review can see whether "advice only" holds up in live runs rather than only in the
 * contract.
 */
import { type SafeguardContext, safeguardTriggered } from "../meta/safeguard.ts";
import type { BatteryCensus, JudgeReviewsResult } from "./judge-reviews.ts";
import type { RebuildAdvicePacket } from "../author/rebuild-advice.ts";

/** The recorded review fields the sensors read; a test builds them without the rest of the record. */
export type JudgeReviewFacts = Pick<JudgeReviewsResult, "runId" | "exit" | "provisional"> & {
  /** The sensors read whether a census was revalidated and nothing inside it, so the field names
   *  the one part of the record any of them could rely on — and a rename of it still fails here. */
  census: Pick<BatteryCensus, "runId"> | null;
};
/** The packet fields the rebuild sensor reads. */
export type JudgeAdviceFacts = Pick<RebuildAdvicePacket, "runId" | "judge">;

/** The disagreement floor that blocked before 2026-09-14: at least three verifier-fail/Judge-pass
 *  cases and at least a fifth of the verified battery. It is kept for one purpose, to count how
 *  often the shape it once blocked on actually occurs. */
export function atFormerBlockThreshold(exit: JudgeReviewsResult["exit"]): boolean {
  return exit.kind === "advisory" && exit.verifierFailJudgePass >= Math.max(3, Math.ceil(exit.verified / 5));
}

/** A complete review in which the Judge passed every case the verifier failed and disputed none it
 *  passed: the Judge said "pass" to everything it saw, which is exactly the blind spot a control
 *  census used to catch. */
export function judgePassedEveryReviewedCase(judges: JudgeReviewFacts, verifiedFails: number): boolean {
  const { exit } = judges;
  return (
    judges.census !== null &&
    judges.provisional === null &&
    verifiedFails >= 1 &&
    exit.verifierFailJudgePass === verifiedFails &&
    exit.verifierPassJudgeFail === 0
  );
}

/** Called once per measured battery after the Judge review is recorded. */
export function safeguardJudgeReview(
  judges: JudgeReviewFacts,
  verifiedFails: number,
  context?: SafeguardContext,
): void {
  const { exit } = judges;
  const where = `run=${judges.runId}`;
  if (atFormerBlockThreshold(exit)) {
    safeguardTriggered(
      "48-judge-disagreement-at-former-block-threshold",
      `${where}: the Judge passed ${exit.verifierFailJudgePass} of ${exit.verified} verified cases the verifier failed, at or above the max(3, 20%) floor that blocked before 2026-09-14; it is advice now and blocks nothing`,
      context,
    );
  }
  if (judgePassedEveryReviewedCase(judges, verifiedFails)) {
    safeguardTriggered(
      "49-judge-passed-every-reviewed-case",
      `${where}: the Judge passed all ${verifiedFails} verifier-failed cases and disputed no verifier pass over ${exit.verified} verified cases; a Judge that passes everything discriminates nothing, and no control census now measures that`,
      context,
    );
  }
}

/** Called once per settled rebuild. The rebuild read a packet carrying Judge disagreement, and its
 *  accepted bytes were classified "evaluation": the agent, public tasks and submission schema
 *  stayed fixed while the checker, its controls or the hidden expectations moved.
 *  experiment-freeze.ts decides that classification, and `correctnessModelHash` alone cannot, since
 *  it excludes tasks.json and controls.json. The shape is "the Judge grumbled, the Builder changed
 *  the evaluation". The advice may well have been right; the line exists so a later review can read
 *  how often the evaluation side moves right after the Judge, rather than the agent or the
 *  tasks. */
export function safeguardJudgeAdviceThenEvaluatorRepair(
  move: string,
  advice: JudgeAdviceFacts | null,
  accepted: string | null,
  context?: SafeguardContext,
): void {
  if (move !== "rebuild" || advice?.judge?.exit !== "advisory" || accepted !== "evaluation") {
    return;
  }
  safeguardTriggered(
    "50-judge-advice-then-evaluator-only-repair",
    `rebuild after ${advice.runId}: the advice packet carried Judge disagreement (families: ${advice.judge.contestedFamilies.join(", ") || "none named"}) and the accepted bytes changed only the evaluation side (checker, controls or hidden expectations; agent, public tasks and schema fixed); the verifier still decided every pass, the evaluation moved after the Judge`,
    context,
  );
}
