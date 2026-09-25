import type { JudgeEvidence } from "../claim/judge.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import type {
  JudgeAttempt,
  JudgeCallContext,
  JudgeInput,
  JudgeObservation,
  JudgeRequest,
  JudgeSession,
  JudgeSubjectEvidence,
} from "./judge-contract.ts";
import { isNonResultKind } from "../claim/record-events.ts";
export type {
  Judge,
  JudgeAttempt,
  JudgeCallContext,
  JudgeInput,
  JudgeObservation,
  JudgePublicContext,
  JudgePublicDomain,
  JudgePublicTask,
  JudgeRequest,
  JudgeSession,
  JudgeSubjectEvidence,
} from "./judge-contract.ts";
import { JUDGE_PUBLIC_CONTEXT_DECLARATION, projectDeclared } from "./declared-projection.ts";
import { SANITIZER_VERSION, sanitizeForEvaluator } from "./sanitize.ts";
import { isBoolean, isString } from "../meta/json-shape.ts";

import { RATIONALE_MAX, errorText, noVerdictAttempt } from "./judge-drivers.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { isProviderResourceBudgetInterruption } from "../run/provider-resource-budget.ts";
export { sessionJudge } from "./judge-drivers.ts";
/**
 * The one gate a model-visible judge input passes: the declared-key allowlist, then the versioned
 * sanitizer. The allowlist runs first because the sanitizer only normalizes bytes at whatever depth
 * it finds them; declared-projection.ts is what removes an undeclared field nested in a declared
 * object, which the root rebuilt here cannot reach. The sanitizer takes `unknown` because it must
 * accept arbitrary submitted artifacts, so its result is unknown too. Text is shortened and
 * oversized containers can become truncation markers. The cast below retains the caller's public
 * contract for use by the prompt renderer; `modified` and `actions` disclose sanitization.
 */
function sanitizeJudgeInput(input: JudgeInput) {
  const sanitized = sanitizeForEvaluator({
    publicContext: projectDeclared(input.publicContext, JUDGE_PUBLIC_CONTEXT_DECLARATION),
    submittedArtifact: input.submittedArtifact,
  });
  // SAFETY: the input root is controller-built; arbitrary nested content is sanitized for display, not executed as a typed domain object.
  return { value: sanitized.value as JudgeInput, sanitized };
}

function boundedRationale(rationale: string | null): boolean {
  return isString(rationale) && rationale.trim().length > 0 && rationale.length <= RATIONALE_MAX;
}

/** A fail carries the rules it cites; a pass and an abstention carry none. */
function rulesFitVerdict(attempt: JudgeAttempt): boolean {
  const { rules } = attempt;
  return attempt.verdict === false
    ? rules.length > 0 && rules.every((rule) => rule.length > 0)
    : rules.length === 0;
}

/** An operational failure must state both its cause and kind: a non-abstention null with
 *  error: null would read as a verdict that never happened for no stated reason, and an error
 *  without a typed kind would record the flattened-prose state errorKind exists to remove. Both
 *  are malformed here, so a foreign Judge implementation cannot reintroduce them. */
function typedFailure(attempt: JudgeAttempt): boolean {
  return (
    attempt.verdict === null &&
    !attempt.abstained &&
    attempt.rationale === null &&
    isString(attempt.error) &&
    attempt.error.length > 0 &&
    isNonResultKind(attempt.errorKind ?? undefined)
  );
}

/** Exactly one of the three attempt states: a verdict, an abstention, or a typed failure. */
function attemptWellFormed(attempt: JudgeAttempt): boolean {
  const answered =
    boundedRationale(attempt.rationale) &&
    attempt.error === null &&
    attempt.errorKind === null &&
    rulesFitVerdict(attempt);
  const validVerdict = answered && isBoolean(attempt.verdict) && !attempt.abstained;
  const validAbstain = answered && attempt.verdict === null && attempt.abstained;
  return (
    (validVerdict || validAbstain || typedFailure(attempt)) &&
    Number.isInteger(attempt.turns) &&
    attempt.turns >= 0
  );
}

async function attemptOf(
  session: JudgeSession,
  judgeInput: JudgeInput,
  context: JudgeCallContext,
): Promise<JudgeAttempt> {
  try {
    const attempt = await session.invoke(judgeInput, context);
    if (!attemptWellFormed(attempt)) throw new Error("judge returned a malformed tri-state attempt");
    return attempt;
  } catch (error) {
    if (isProviderResourceBudgetInterruption(error)) throw error;
    return noVerdictAttempt(errorText(error), "transport", 0);
  }
}

/** A verdict contradicting the verifier stands only when a second fresh sample returned the same
 *  verdict. A fail always carries its citations, so a confirmed fail is a cited one. */
export function confirmedDisagreement(
  evidence: Pick<JudgeSubjectEvidence, "verdict" | "confirmation">,
): boolean {
  return isBoolean(evidence.verdict) && evidence.confirmation?.verdict === evidence.verdict;
}

/** `verifierVerdict` never reaches the Judge; it decides only whether a contradicting verdict is
 *  sampled again. */
export async function judgeSubject(
  session: JudgeSession,
  request: JudgeRequest,
  subjectKind: JudgeSubjectEvidence["subjectKind"],
  verifierVerdict: boolean | null = null,
): Promise<JudgeSubjectEvidence> {
  // `sanitizeJudgeInput` rebuilds the public root, which leaves the controller's `subjectId`
  // behind, and then removes every undeclared field at every depth below it.
  const { value: judgeInput, sanitized } = sanitizeJudgeInput(request);
  const context = { subjectId: request.subjectId, subjectKind };
  const attempt = await attemptOf(session, judgeInput, context);
  const contradicts =
    isBoolean(verifierVerdict) && isBoolean(attempt.verdict) && attempt.verdict !== verifierVerdict;
  const confirmation = contradicts ? { confirmation: await attemptOf(session, judgeInput, context) } : {};
  return {
    schema: "judge-subject/v3",
    subjectId: request.subjectId,
    subjectKind,
    judgePin: session.pin,
    verifierBlind: true,
    sanitizer: { version: sanitized.version, modified: sanitized.modified, actions: sanitized.actions },
    publicContextDigest: hashJsonValue(judgeInput.publicContext),
    judgeInputDigest: hashJsonValue(judgeInput),
    ...attempt,
    ...confirmation,
  };
}

/** Aggregation input is controller-built in-process; any internal contradiction between an
 *  observation's fields is a product defect and throws before the record can be saved as evidence. */
function observationIntegrity(condition: boolean, detail: string): asserts condition {
  if (!condition) throw new Error(`judge observation integrity violation: ${detail}`);
}

/** Controller-owned aggregation. Only this projection sees both judge and verifier verdicts.
 *  `evaluatedPin` is the built agent's backend pin, recorded so independence can be derived from
 *  the two pins, never asserted by a caller. The Judge has no control census, so the evidence is
 *  always `unvalidated`: every disagreement it records is advice. */
export function summarizeJudge(
  session: JudgeSession | undefined,
  correctnessModelId: string,
  evaluatedPin: string,
  battery: readonly JudgeObservation[],
  offered?: { battery: number },
): JudgeEvidence {
  if (session === undefined) return { judge: "off" };
  // The battery denominator counts every offered subject: an operational abort must
  // not shrink the census, or truncated coverage reads as complete coverage.
  const offeredBattery = offered?.battery ?? battery.length;
  observationIntegrity(
    offeredBattery >= battery.length,
    `offered (${offeredBattery}) cannot be below the ${battery.length} completed battery observations`,
  );
  for (const row of battery) {
    observationIntegrity(
      row.evidence.subjectKind === "battery-case",
      `battery observation "${row.evidence.subjectId}" has subjectKind "${row.evidence.subjectKind}"`,
    );
    observationIntegrity(
      row.evidence.judgePin === session.pin,
      `subject "${row.evidence.subjectId}" was judged by "${row.evidence.judgePin}", not aggregate session "${session.pin}"`,
    );
    observationIntegrity(
      row.evidence.sanitizer.version === SANITIZER_VERSION,
      `subject "${row.evidence.subjectId}" passed sanitizer "${row.evidence.sanitizer.version}" but this controller runs "${SANITIZER_VERSION}"`,
    );
  }
  const batteryVerdicts = battery.filter((row) => isBoolean(row.evidence.verdict)).length;
  const batteryAbstentions = battery.filter((row) => row.evidence.abstained).length;
  const comparable = battery.filter(
    (row) => isBoolean(row.evidence.verdict) && isBoolean(row.verifierVerdict),
  );
  const disagreements = comparable.filter((row) => row.evidence.verdict !== row.verifierVerdict);
  const passFailed = disagreements.filter(
    (row) => row.verifierVerdict === true && row.evidence.verdict === false,
  );
  const vetoed = passFailed.filter((row) => confirmedDisagreement(row.evidence)).length;
  return {
    judge: "unvalidated",
    judgePin: session.pin,
    ...keyIfDefined("promptPolicyDigest", session.promptPolicyDigest),
    evaluatedPin,
    correctnessModelId,
    offered: offeredBattery,
    verdicts: batteryVerdicts,
    abstentions: batteryAbstentions,
    disagreements: disagreements.length,
    disagreementDenominator: comparable.length,
    verifierPassJudgeFail: passFailed.length,
    vetoed,
  };
}
