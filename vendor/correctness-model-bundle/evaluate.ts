/** One deciding program per check, and the same one whether the host is verifying a submission or
 *  the author is running a labelled local test. Sharing it is what keeps a check's meaning single:
 *  a check is the Boolean function the evaluator exports, the host runs every applicable one and
 *  builds the aggregate verdict out of their results, and there is no second predicate anywhere
 *  that could disagree with them. */
import { capturedStructuredClone } from "../../src/meta/json-runtime.ts";
import { canonicalJson } from "../../src/meta/stable-json.ts";
import { sha256 } from "../../src/meta/digest.ts";
import { isBoolean, isRecord, isString } from "../../src/meta/json-shape.ts";
import type { Brief, BriefTruthCheck } from "../../src/truth/brief.ts";
import type { CheckRunner, EvaluationRequest } from "../../src/truth/correctness-model-contract.ts";
import type {
  CheckRun,
  CheckRunObserver,
  CorrectnessModelResult,
} from "../../src/verify/correctness-model-result.ts";
import type { VerifierRuntime } from "../../src/verify/verifier-port.ts";
import { applicableTruthChecks, checkPublicInputs, requiredToolsOf } from "./evaluation-public-task.ts";
import { toolInputLeaves, toolInputViolation } from "./tool-inputs.ts";
import { VerifierContractError } from "./contract-error.ts";

type Receipt = CorrectnessModelResult["checkReceipts"][number];

const LOOP_ERROR_KINDS = ["check-hidden-operand-missing", "check-result-not-boolean"];

export type CheckProgramEvaluation = (
  request: EvaluationRequest,
  runtime?: VerifierRuntime,
  onlyCheckId?: string,
  observe?: CheckRunObserver,
) => Promise<CorrectnessModelResult>;

/** Each fresh child receives only its declared inputs and its own check's hidden value, which is
 *  what makes the declared paths a contract rather than documentation: a check able to read a path
 *  it never declared, or another check's expectation, would be deciding on evidence no coverage row
 *  records it as using. A check that declares `hidden: "required"` and finds no expectation of its
 *  own throws here rather than running, because a check quietly deciding without its operand is
 *  indistinguishable from a check that was never applicable, and only one of those is a defect. */
export function checkEvaluationRequest(
  check: BriefTruthCheck,
  request: EvaluationRequest,
): EvaluationRequest {
  const hidden =
    check.execution.hidden === "none"
      ? []
      : Array.isArray(request.hidden)
        ? request.hidden.filter((row: unknown) => isRecord(row) && row.checkId === check.id)
        : [];
  if (
    check.execution.hidden === "required" &&
    (hidden.length !== 1 || !isRecord(hidden[0]) || !Object.hasOwn(hidden[0], "expectation"))
  ) {
    throw new Error("check-hidden-operand-missing: " + check.id);
  }
  return capturedStructuredClone({
    ...checkPublicInputs(check, request),
    hidden,
  });
}

/** A check's port admits only the tools its own declaration names, over the leaves its own input
 *  holds, and stamps every run with its id, so a tool row always names the check that launched it. */
function checkPort(
  check: BriefTruthCheck,
  input: EvaluationRequest,
  runtime: VerifierRuntime | undefined,
): VerifierRuntime | undefined {
  if (runtime === undefined) return undefined;
  const requiredTools = requiredToolsOf(check.execution);
  const leaves =
    requiredTools.length === 0 ? null : toolInputLeaves(input.artifact, input.publicTask, input.hidden);
  return {
    tools: {
      run: async (call) => {
        if (
          call.checkId !== check.id ||
          leaves === null ||
          (!requiredTools.includes(call.toolId) && !call.toolId.startsWith("cell:"))
        ) {
          throw new VerifierContractError("verifier-tool-binding", "check-tool-binding-invalid: " + check.id);
        }
        const violation = toolInputViolation(call, leaves, check.execution.evidence.kind);
        if (violation !== null) throw new VerifierContractError("verifier-tool-input", violation);
        return runtime.tools.run({ ...call, checkId: check.id });
      },
      abandon: () => runtime.tools.abandon(),
    },
  };
}

async function runOneCheck(
  check: BriefTruthCheck,
  request: EvaluationRequest,
  runtime: VerifierRuntime | undefined,
  runCheck: CheckRunner,
): Promise<Receipt> {
  const input = checkEvaluationRequest(check, request);
  const port = checkPort(check, input, runtime);
  const artifactInputDigest = sha256(canonicalJson(input.artifact));
  const publicTaskInputDigest = sha256(canonicalJson(input.publicTask));
  const passed = await runCheck(check.id, input, port);
  if (!isBoolean(passed)) throw new Error("check-result-not-boolean: " + check.id);
  return { checkId: check.id, passed, artifactInputDigest, publicTaskInputDigest };
}

/** The closed kind a check's throw carries: a contract code, an evaluator process kind, or one of
 *  the loop's own fixed prefixes. Never the message, which a generated check writes. */
export function checkErrorKind(error: unknown): string {
  if (error instanceof VerifierContractError) return error.code;
  if (error instanceof Error && "kind" in error && isString(error.kind)) return error.kind;
  const message = error instanceof Error ? error.message : "";
  return LOOP_ERROR_KINDS.find((kind) => message.startsWith(kind + ":")) ?? "unclassified";
}

/** Every applicable check runs, and the loop does not stop at the first false, so one artifact
 *  yields one receipt per check rather than a verdict plus whatever came before it. `onlyCheckId`
 *  narrows that to a single check, which is how a reject control proves it fails on the check it
 *  names and not merely somewhere. What each failure contributes is its check id and the fixed
 *  sentence "Declared check failed.", because the detail of why a check failed is the answer, and
 *  the host composes the aggregate result from these receipts alone. `observe` receives one row per
 *  check; a throw is recorded under the check that raised it, the rest as not-run, and then
 *  rethrown unchanged so every caller classifies it exactly as before. */
export function evaluateCheckProgram(brief: Brief, runCheck: CheckRunner): CheckProgramEvaluation {
  return async (request, runtime, onlyCheckId, observe) => {
    const checks = applicableTruthChecks(brief, request.publicTask).filter(
      (check) => onlyCheckId === undefined || check.id === onlyCheckId,
    );
    if (checks.length === 0) throw new Error("check-program-no-applicable-checks");
    const checkReceipts: Receipt[] = [];
    const issues: CorrectnessModelResult["issues"] = [];
    for (const [seq, check] of checks.entries()) {
      const startedAt = new Date().toISOString();
      const began = performance.now();
      const elapsed = () => Math.round(performance.now() - began);
      let receipt: Receipt;
      try {
        receipt = await runOneCheck(check, request, runtime, runCheck);
      } catch (error) {
        const errorKind = checkErrorKind(error);
        observe?.({ seq, checkId: check.id, outcome: "threw", errorKind, startedAt, durationMs: elapsed() });
        checks.slice(seq + 1).forEach((rest, index) => {
          const later: CheckRun = {
            seq: seq + 1 + index,
            checkId: rest.id,
            outcome: "not-run",
            errorKind: null,
            startedAt: null,
            durationMs: null,
          };
          observe?.(later);
        });
        throw error;
      }
      const outcome = receipt.passed ? "pass" : "fail";
      observe?.({ seq, checkId: check.id, outcome, errorKind: null, startedAt, durationMs: elapsed() });
      checkReceipts.push(receipt);
      if (!receipt.passed) issues.push({ checkId: check.id, message: "Declared check failed." });
    }
    return { ok: issues.length === 0, issues, checkReceipts };
  };
}
