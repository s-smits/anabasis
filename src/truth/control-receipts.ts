/**
 * Saved results for each control. The control runner records what happened; this module shapes
 * those results, checks them against the declared corpus, and calculates the summary totals a claim
 * compares against. Hidden values, correctness-model issues, commands and other private execution
 * details stay out, because a receipt is read by the author's side of the boundary.
 *
 * Which tool ran for a control is deliberately not copied here either. The host's own evidence rows
 * already carry that under the control's subjectId, and `grounding-coverage.ts` reads them there, so
 * a copy would be a second version of the same fact that could disagree with the first.
 */
import { isNonResultKind, type NonResultKind } from "../claim/record-events.ts";
import type { DiscriminationClaimabilityFinding } from "../claim/discrimination-claimability.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { compareCodeUnits, stableJson } from "../meta/stable-json.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import type { CorrectnessModelResult } from "../verify/correctness-model-result.ts";
import type { VerifierContractCode } from "../../vendor/correctness-model-bundle/contract-error.ts";
import type {
  ControlReceipt,
  ControlReceiptOutcome,
  ControlReceiptSide,
  DiscriminationExecution,
} from "./battery-record.ts";
import type { ControlCorpus } from "./controls.ts";
import { observedBlockingCheckIds } from "../../vendor/correctness-model-bundle/control-results.ts";

export type ControlEvaluation =
  | CorrectnessModelResult
  | { threw: string; authorClassification?: VerifierContractCode }
  | { hostNonResult: string }
  | { cleanupPending: true }
  | { unknownTask: true };

export interface ReceiptSession {
  observationsByControlId: Map<string, ControlReceiptSide[]>;
}

type ReceiptTotals = Pick<
  DiscriminationExecution,
  "acceptsPassed" | "rejectsFailed" | "rejectsAttributed" | "attributedCheckIds"
>;

type DeclaredControl = ControlCorpus["accept"][number] | ControlCorpus["reject"][number];
type DeclaredReceiptControl = { kind: "accept" | "reject"; control: DeclaredControl };

const RECEIPT_KEYS = [
  "schema",
  "controlId",
  "taskId",
  "kind",
  "expectedOutcome",
  "expectedCheckId",
  "observedOutcome",
  "observedBlockingCheckIds",
  "nonResultKind",
] as const;

const NOT_CHECKED: ControlReceiptSide = {
  attempt: 1,
  outcome: "non-result",
  blockingCheckIds: [],
  nonResultKind: "verifier",
};

type ReceiptSettlement = {
  controlReceipts: ControlReceipt[];
  findings: DiscriminationClaimabilityFinding[];
  totals: ReceiptTotals;
};

/** The result of checking a saved JSON value before its rows are matched to the declared controls
 *  and summed into the totals `Claim.create` compares against the saved summary. Extra fields,
 *  hidden values and verifier detail are rejected rather than ignored, and `totals` stays null
 *  unless every row is valid, unique and declared, so a partially readable receipt set produces no
 *  number at all. */
type ReceiptSetCheck = {
  findings: DiscriminationClaimabilityFinding[];
  totals: ReceiptTotals | null;
};

/** The expected check a reject names, or null. Accept controls declare none. */
function expectedCheckIdOf(control: DeclaredControl): string | null {
  return "expectedCheckId" in control ? control.expectedCheckId : null;
}

/** `subject` names the control the message quotes, which is what lets author feedback fold one
 *  repair across every control that shares it instead of listing them one by one. */
export function controlReceiptInvalidFinding(
  message: string,
  subject?: string,
): DiscriminationClaimabilityFinding {
  return { code: "DISCRIMINATION_CONTROL_RECEIPT_INVALID", message, ...keyIfDefined("subject", subject) };
}

/** The one attribution rule: an accept passes with no blocking check, and a reject is attributed
 *  when its expected check is among the checks that blocked it. Other checks may fail on that reject
 *  as well — what proves nothing is a reject that fails somewhere else but not on its named check.
 *  Until 2026-09-14 the blocking set had to be exactly the expected check, and 61 recorded truss
 *  epochs spent most of their refusal rows on that cascade rule, with the adopted evaluators growing
 *  checks that pass on a broken declaration just to satisfy it. */
export function sideMatchesExpected(
  side: ControlReceiptSide,
  expectedOutcome: "pass" | "fail",
  expectedCheckId: string | null,
): boolean {
  if (side.outcome !== expectedOutcome) return false;
  if (expectedOutcome === "pass") return side.blockingCheckIds.length === 0;
  return expectedCheckId !== null && side.blockingCheckIds.includes(expectedCheckId);
}

/** The receipt's observed outcome as the side the runner recorded first. */
export function primarySide(receipt: ControlReceipt): ControlReceiptSide {
  return {
    attempt: 1,
    outcome: receipt.observedOutcome,
    blockingCheckIds: receipt.observedBlockingCheckIds,
    nonResultKind: receipt.nonResultKind,
  };
}

// --- Recording one run's observations ---------------------------------------------------------

function receiptSide(attempt: number, evaluation: ControlEvaluation): ControlReceiptSide {
  const nonResult = (nonResultKind: NonResultKind): ControlReceiptSide => ({
    attempt,
    outcome: "non-result",
    blockingCheckIds: [],
    nonResultKind,
  });
  if ("threw" in evaluation || "unknownTask" in evaluation) return nonResult("verifier-throw");
  if ("hostNonResult" in evaluation) {
    return nonResult(isNonResultKind(evaluation.hostNonResult) ? evaluation.hostNonResult : "verifier");
  }
  if ("cleanupPending" in evaluation) return nonResult("sandbox");
  const blockingCheckIds = observedBlockingCheckIds(evaluation);
  return {
    attempt,
    outcome: blockingCheckIds.length > 0 ? "fail" : "pass",
    blockingCheckIds,
    nonResultKind: null,
  };
}

export function recordObservation(
  run: ReceiptSession,
  controlId: string,
  attempt: number,
  evaluation: ControlEvaluation,
): ControlReceiptSide {
  const side = receiptSide(attempt, evaluation);
  const observations = run.observationsByControlId.get(controlId) ?? [];
  observations.push(side);
  run.observationsByControlId.set(controlId, observations);
  return side;
}

function controlReceiptFor(
  run: ReceiptSession,
  control: DeclaredControl,
  kind: "accept" | "reject",
): ControlReceipt {
  const primary = run.observationsByControlId.get(control.id)?.[0] ?? NOT_CHECKED;
  return {
    schema: "control-receipt/v2",
    controlId: control.id,
    taskId: control.taskId,
    kind,
    expectedOutcome: kind === "accept" ? "pass" : "fail",
    expectedCheckId: kind === "reject" ? expectedCheckIdOf(control) : null,
    observedOutcome: primary.outcome,
    observedBlockingCheckIds: [...primary.blockingCheckIds],
    nonResultKind: primary.nonResultKind,
  };
}

/** One receipt per declared control in corpus order, plus the totals calculated from them. */
export function settleControlReceipts(run: ReceiptSession, corpus: ControlCorpus): ReceiptSettlement {
  const controlReceipts = [
    ...corpus.accept.map((control) => controlReceiptFor(run, control, "accept")),
    ...corpus.reject.map((control) => controlReceiptFor(run, control, "reject")),
  ];
  return { controlReceipts, findings: [], totals: receiptTotals(corpus, controlReceipts) };
}

// --- Reading receipts back --------------------------------------------------------------------

function isReceiptOutcome(value: unknown): value is ControlReceiptOutcome {
  return value === "pass" || value === "fail" || value === "non-result";
}

/** The two outcome-bound fields, or null when either contradicts the outcome. A fail names at
 *  least one blocking check and no other outcome names any; only a non-result carries a kind. */
function outcomeFields(
  outcome: ControlReceiptOutcome,
  blocking: unknown,
  nonResultKind: unknown,
): Pick<ControlReceipt, "observedBlockingCheckIds" | "nonResultKind"> | null {
  if (!Array.isArray(blocking) || !blocking.every(isString)) return null;
  if ((outcome === "fail") !== blocking.length > 0) return null;
  if (outcome !== "non-result") {
    return nonResultKind === null ? { observedBlockingCheckIds: [...blocking], nonResultKind: null } : null;
  }
  if (!isString(nonResultKind) || !isNonResultKind(nonResultKind)) return null;
  return { observedBlockingCheckIds: [...blocking], nonResultKind };
}

/** One saved row, or null when a field is absent, extra or inconsistent. Every caller treats null
 *  as one invalid-shape finding, so the reader never needs to say which field failed. */
function readReceipt(value: unknown): ControlReceipt | null {
  const row = asRecord(value);
  if (row === null || Object.keys(row).length !== RECEIPT_KEYS.length) return null;
  if (!RECEIPT_KEYS.every((key) => key in row)) return null;
  const { controlId, taskId, kind, expectedOutcome, expectedCheckId, observedOutcome } = row;
  if (row.schema !== "control-receipt/v2" || !isString(controlId) || !isString(taskId)) return null;
  if (kind !== "accept" && kind !== "reject") return null;
  if (expectedOutcome !== "pass" && expectedOutcome !== "fail") return null;
  if (expectedCheckId !== null && !isString(expectedCheckId)) return null;
  if (!isReceiptOutcome(observedOutcome)) return null;
  const outcome = outcomeFields(observedOutcome, row.observedBlockingCheckIds, row.nonResultKind);
  if (outcome === null) return null;
  return {
    schema: "control-receipt/v2",
    controlId,
    taskId,
    kind,
    expectedOutcome,
    expectedCheckId,
    observedOutcome,
    ...outcome,
  };
}

function receiptForControlFindings(
  controlId: string,
  declared: DeclaredReceiptControl,
  receipt: ControlReceipt,
  mode: "strict" | "live",
): DiscriminationClaimabilityFinding[] {
  const findings: DiscriminationClaimabilityFinding[] = [];
  const expectedCheckId = expectedCheckIdOf(declared.control);
  if (
    receipt.kind !== declared.kind ||
    receipt.taskId !== declared.control.taskId ||
    receipt.expectedOutcome !== (declared.kind === "accept" ? "pass" : "fail") ||
    receipt.expectedCheckId !== (declared.kind === "reject" ? expectedCheckId : null)
  ) {
    findings.push(
      controlReceiptInvalidFinding(
        `receipt for control "${controlId}" does not match its declared kind, task or expected check`,
        controlId,
      ),
    );
  }
  if (
    mode === "strict" &&
    receipt.observedOutcome !== "non-result" &&
    !sideMatchesExpected(primarySide(receipt), receipt.expectedOutcome, expectedCheckId)
  ) {
    findings.push(
      controlReceiptInvalidFinding(
        `receipt for control "${controlId}" records [${receipt.observedBlockingCheckIds.join(", ") || "no blocking check"}], which does not satisfy its expected ${receipt.expectedOutcome} on ${expectedCheckId ?? "no check"}`,
        controlId,
      ),
    );
  }
  return findings;
}

/** Index the rows by control, reporting an unreadable, duplicated or undeclared one. */
function receiptsById(
  declared: ReadonlyMap<string, DeclaredReceiptControl>,
  receipts: readonly unknown[],
  findings: DiscriminationClaimabilityFinding[],
): Map<string, ControlReceipt> {
  const byId = new Map<string, ControlReceipt>();
  for (const value of receipts) {
    const receipt = readReceipt(value);
    if (receipt === null) {
      findings.push(
        controlReceiptInvalidFinding(
          "a control receipt has an invalid shape; keep one typed receipt for every declared control",
        ),
      );
      continue;
    }
    if (byId.has(receipt.controlId)) {
      findings.push(
        controlReceiptInvalidFinding(
          `control "${receipt.controlId}" has more than one receipt, so it cannot be matched reliably`,
          receipt.controlId,
        ),
      );
      continue;
    }
    byId.set(receipt.controlId, receipt);
    if (!declared.has(receipt.controlId)) {
      findings.push(
        controlReceiptInvalidFinding(
          `receipt "${receipt.controlId}" does not name a declared control; remove the extra row`,
          receipt.controlId,
        ),
      );
    }
  }
  return byId;
}

/**
 * Check receipts against the declared controls. A live run may already have reported its outcome,
 * so `live` skips only that duplicate. Saved evidence uses the strict default and also rejects a
 * mismatch between the expected and observed result.
 */
export function validateControlReceipts(
  corpus: ControlCorpus,
  receipts: readonly unknown[],
  mode: "strict" | "live" = "strict",
): DiscriminationClaimabilityFinding[] {
  const findings: DiscriminationClaimabilityFinding[] = [];
  const declared = new Map<string, DeclaredReceiptControl>();
  for (const control of corpus.accept) declared.set(control.id, { kind: "accept", control });
  for (const control of corpus.reject) declared.set(control.id, { kind: "reject", control });
  const byId = receiptsById(declared, receipts, findings);
  for (const [controlId, control] of declared) {
    const receipt = byId.get(controlId);
    if (receipt === undefined) {
      findings.push(
        controlReceiptInvalidFinding(
          `declared ${control.kind} control "${controlId}" has no receipt; keep it in the control count`,
          controlId,
        ),
      );
      continue;
    }
    findings.push(...receiptForControlFindings(controlId, control, receipt, mode));
  }
  return findings;
}

// --- Totals -----------------------------------------------------------------------------------

function receiptTotals(corpus: ControlCorpus, receipts: readonly ControlReceipt[]): ReceiptTotals {
  const byId = new Map(receipts.map((receipt) => [receipt.controlId, receipt]));
  // checkIds are model-authored, so the tally is an object with no prototype.
  const attributedCheckIds: Record<string, number> = Object.create(null);
  let rejectsFailed = 0;
  let rejectsAttributed = 0;
  for (const control of corpus.reject) {
    const receipt = byId.get(control.id);
    if (receipt?.observedOutcome !== "fail") continue;
    rejectsFailed += 1;
    const { expectedCheckId } = control;
    if (!sideMatchesExpected(primarySide(receipt), "fail", expectedCheckId)) continue;
    rejectsAttributed += 1;
    attributedCheckIds[expectedCheckId] = (attributedCheckIds[expectedCheckId] ?? 0) + 1;
  }
  const acceptsPassed = corpus.accept.filter(
    (control) => byId.get(control.id)?.observedOutcome === "pass",
  ).length;
  return { acceptsPassed, rejectsFailed, rejectsAttributed, attributedCheckIds };
}

export function checkReceiptSet(corpus: ControlCorpus, receipts: unknown): ReceiptSetCheck {
  if (!Array.isArray(receipts)) {
    return {
      findings: [
        controlReceiptInvalidFinding(
          "saved control receipts are missing or are not a list; keep every declared control in the count",
        ),
      ],
      totals: null,
    };
  }
  const findings = validateControlReceipts(corpus, receipts);
  if (findings.length > 0) return { findings, totals: null };
  const rows = receipts.map(readReceipt).filter((receipt) => receipt !== null);
  return { findings, totals: receiptTotals(corpus, rows) };
}

/** A non-negative whole count, or null. */
function count(value: unknown): number | null {
  return isNumber(value) && Number.isInteger(value) && value >= 0 ? value : null;
}

/** The recorded discrimination summary read back as totals, or null when a field is missing or is
 *  not a non-negative whole count. */
function recordedTotals(stored: unknown): ReceiptTotals | null {
  const row = asRecord(stored);
  const attributed = asRecord(row?.attributedCheckIds);
  if (row === null || attributed === null) return null;
  const acceptsPassed = count(row.acceptsPassed);
  const rejectsFailed = count(row.rejectsFailed);
  const rejectsAttributed = count(row.rejectsAttributed);
  if (acceptsPassed === null || rejectsFailed === null || rejectsAttributed === null) return null;
  // checkIds are model-authored, so the tally is an object with no prototype.
  const attributedCheckIds: Record<string, number> = Object.create(null);
  for (const [checkId, value] of Object.entries(attributed)) {
    const times = count(value);
    if (times === null) return null;
    attributedCheckIds[checkId] = times;
  }
  return { acceptsPassed, rejectsFailed, rejectsAttributed, attributedCheckIds };
}

/** The comparable bytes of one totals value. The check-id tally is compared as sorted entries, not
 *  as an object: its keys are model-authored, so the tally has a null prototype, which `stableJson`
 *  refuses, and `__proto__` has to compare as the ordinary string it is. */
function comparableTotals(totals: ReceiptTotals): string {
  const attributed = Object.entries(totals.attributedCheckIds).sort(([left], [right]) =>
    compareCodeUnits(left, right),
  );
  return stableJson([totals.acceptsPassed, totals.rejectsFailed, totals.rejectsAttributed, attributed]);
}

/** Whether the saved summary fields agree with totals calculated from the receipts. */
export function totalsMatchRecorded(stored: unknown, derived: ReceiptTotals): boolean {
  const recorded = recordedTotals(stored);
  return recorded !== null && comparableTotals(recorded) === comparableTotals(derived);
}
