/**
 * The one owner of "scored" and "passed" over battery case rows. Every producer — the eval
 * runner's score, the denominator counts, the evidence events — and every reader imports these
 * predicates rather than restating them. The counts were once defined separately in four places,
 * and with four copies one changed alone makes a correct aggregate look inconsistent, or lets an
 * incorrect one pass; with one, the question cannot arise.
 */
import { type CaseOutcomeFields, classifyCaseOutcome } from "./case-record.ts";
import type { RuntimeIdentityCaseEvidence, RuntimeModelIdentity } from "./runtime-model-identity.ts";
import { capturedStructuredClone } from "../meta/json-runtime.ts";
import { REPORTING_CONFIDENCE, wilsonInterval } from "./estimation.ts";
import { ENVIRONMENT_OWNED_NONRESULT_KINDS, type NonResultKind } from "./record-events.ts";

type ScorableCase = CaseOutcomeFields;

/**
 * The battery's estimation evidence, reported per condition: scored tasks, successes, failures,
 * the raw success rate and its Wilson interval at the registered reporting confidence, plus every
 * excluded (censored) outcome by non-result kind. The excluded tally is there so the denominator's
 * composition is stated rather than inferred by subtracting counts a reader assembles by hand.
 * Rates over zero scored tasks are null, because an absent measurement is absent and a 0 would
 * read as a measured floor. It is built beside `scoredCases` and `passedCount` so the estimate and
 * the score share one denominator predicate and cannot drift apart.
 */
export type EstimationEvidence = {
  method: "wilson";
  confidence: number;
  conformingScoredTasks: number;
  successes: number;
  failures: number;
  rawSuccessRate: number | null;
  intervalLower: number | null;
  intervalUpper: number | null;
  /** Censored outcomes by non-result kind — excluded from the denominator, stated by count. */
  excluded: Record<string, number>;
};

/** A case row carrying the per-completed-turn provider identities its solve reported. */
interface RuntimeIdentityCase extends ScorableCase {
  taskId: string;
  solver: { turns: number; completedTurns: number; runtimeIdentities: RuntimeModelIdentity[] };
}

/** Cases in the score denominator: truth-verified and unaccepted attempts, never non-results. */
export function scoredCases<T extends ScorableCase>(cases: readonly T[]): T[] {
  return cases.filter((c) => classifyCaseOutcome(c) !== "non-result");
}

/**
 * The all-environment-blocked battery predicate: zero cases verified, every case has an eligible
 * kind, no battery-time product finding invalidated discrimination, and no case failed at the
 * verifier boundary. Returns those kinds for the evidence message, or null when any ownership
 * premise is absent. A kind label alone never proves its owner.
 *
 * It lives beside `scoredCases` so run-verdict ownership and denominator membership cannot drift
 * apart: the same non-result predicate that empties the denominator decides who owns the run.
 */
export function environmentBlockedBattery(
  cases: readonly (ScorableCase & { taskId: string; runtimeNonResultKind: NonResultKind | null })[],
  evidence: {
    /** Battery-time product findings (including an authored, unbound non-result) always win over
     *  a kind label. A kind is ownership vocabulary, not provenance by itself. */
    discriminationClaimable: boolean;
    /** Cases whose non-result was produced before the verifier boundary. */
    solverOriginCaseIds: ReadonlySet<string>;
  },
): NonResultKind[] | null {
  if (!evidence.discriminationClaimable || cases.length === 0 || scoredCases(cases).length > 0) return null;
  const kinds = cases.flatMap((c) => (c.runtimeNonResultKind === null ? [] : [c.runtimeNonResultKind]));
  if (kinds.length !== cases.length) return null;
  // Timeout joins the environment's kinds here alone, where solver-origin evidence backs it below.
  if (!kinds.every((k) => k === "timeout" || ENVIRONMENT_OWNED_NONRESULT_KINDS.has(k))) return null;
  // A failure at the verifier boundary cannot be classified as solver-origin from its kind alone.
  if (cases.some(({ taskId }) => !evidence.solverOriginCaseIds.has(taskId))) return null;
  return kinds;
}

/** Passing cases among the verified — `pass === true`, never truthiness over null. */
export function passedCount(cases: readonly ScorableCase[]): number {
  return cases.filter((c) => classifyCaseOutcome(c) === "pass").length;
}

export function estimationEvidence(
  cases: readonly (ScorableCase & { runtimeNonResultKind: NonResultKind | null })[],
): EstimationEvidence {
  const scored = scoredCases(cases);
  const successes = passedCount(cases);
  // Null prototype, because the kind label on a case row can come from a correctness model
  // evaluator's relayed result and the type union is erased at runtime. "__proto__" and
  // "constructor" have to tally as own properties: on a plain object the count silently vanishes
  // into the prototype, and a censored case disappears from the recorded evidence rather than
  // being reported as missing.
  const excluded: Record<string, number> = Object.create(null);
  for (const c of cases) {
    if (c.runtimeNonResult === null) continue;
    const kind = c.runtimeNonResultKind ?? "unclassified";
    excluded[kind] = (excluded[kind] ?? 0) + 1;
  }
  const interval = wilsonInterval(successes, scored.length);
  return {
    method: "wilson",
    confidence: REPORTING_CONFIDENCE,
    conformingScoredTasks: scored.length,
    successes,
    failures: scored.length - successes,
    rawSuccessRate: scored.length === 0 ? null : successes / scored.length,
    intervalLower: interval === null ? null : interval.lower,
    intervalUpper: interval === null ? null : interval.upper,
    excluded,
  };
}

/** The per-scored-case runtime-identity census `Claim.create` audits. Built here beside
 *  `scoredCases` so the census filters cases by the same non-result
 *  predicate the score derives from: the census case ids and the scored case ids always align, and
 *  no second walker can drift them apart. */
export function runtimeIdentityCensus(cases: readonly RuntimeIdentityCase[]): RuntimeIdentityCaseEvidence[] {
  return scoredCases(cases).map((c) => ({
    caseId: c.taskId,
    turns: c.solver.turns,
    completedTurns: c.solver.completedTurns,
    identities: capturedStructuredClone(c.solver.runtimeIdentities),
  }));
}
