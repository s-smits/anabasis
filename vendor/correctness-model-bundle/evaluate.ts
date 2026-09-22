/** One deciding program per check, shared by host verification and labelled local tests. */
import { capturedStructuredClone } from "../../src/meta/json-runtime.ts";
import { canonicalJson } from "../../src/meta/stable-json.ts";
import { sha256 } from "../../src/meta/digest.ts";
import { isBoolean, isRecord } from "../../src/meta/json-shape.ts";
import type { Brief, BriefTruthCheck } from "../../src/truth/brief.ts";
import type { CheckRunner, EvaluationRequest } from "../../src/truth/correctness-model-contract.ts";
import type { CorrectnessModelResult } from "../../src/verify/correctness-model-result.ts";
import type { VerifierRuntime } from "../../src/verify/verifier-port.ts";
import { applicableTruthChecks, checkPublicInputs, requiredToolsOf } from "./evaluation-public-task.ts";
import { toolInputLeaves, toolInputViolation } from "./tool-inputs.ts";
import { VerifierContractError } from "./contract-error.ts";

export type CheckProgramEvaluation = (
  request: EvaluationRequest,
  runtime?: VerifierRuntime,
  onlyCheckId?: string,
) => Promise<CorrectnessModelResult>;

/** Each fresh child receives only its declared inputs and its own check's hidden value. */
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

/** Every applicable check runs, even after false, unless a reject control names the one it must
 *  fail. The host alone constructs aggregate issues. */
export function evaluateCheckProgram(brief: Brief, runCheck: CheckRunner): CheckProgramEvaluation {
  return async (request, runtime, onlyCheckId) => {
    const checks = applicableTruthChecks(brief, request.publicTask).filter(
      (check) => onlyCheckId === undefined || check.id === onlyCheckId,
    );
    if (checks.length === 0) throw new Error("check-program-no-applicable-checks");
    const checkReceipts: NonNullable<CorrectnessModelResult["checkReceipts"]> = [];
    const issues: CorrectnessModelResult["issues"] = [];
    for (const check of checks) {
      const requiredTools = requiredToolsOf(check.execution);
      const input = checkEvaluationRequest(check, request);
      const leaves =
        runtime === undefined || requiredTools.length === 0
          ? null
          : toolInputLeaves(input.artifact, input.publicTask, input.hidden);
      const port: VerifierRuntime | undefined =
        runtime === undefined
          ? undefined
          : {
              tools: {
                run: async (call) => {
                  if (
                    call.checkId !== check.id ||
                    leaves === null ||
                    (!requiredTools.includes(call.toolId) && !call.toolId.startsWith("cell:"))
                  ) {
                    throw new VerifierContractError(
                      "verifier-tool-binding",
                      "check-tool-binding-invalid: " + check.id,
                    );
                  }
                  const violation = toolInputViolation(call, leaves, check.execution.evidence.kind);
                  if (violation !== null) throw new VerifierContractError("verifier-tool-input", violation);
                  return runtime.tools.run({ ...call, checkId: check.id });
                },
                abandon: () => runtime.tools.abandon(),
              },
            };
      const artifactInputDigest = sha256(canonicalJson(input.artifact));
      const publicTaskInputDigest = sha256(canonicalJson(input.publicTask));
      const passed = await runCheck(check.id, input, port);
      if (!isBoolean(passed)) throw new Error("check-result-not-boolean: " + check.id);
      checkReceipts.push({ checkId: check.id, passed, artifactInputDigest, publicTaskInputDigest });
      if (!passed) {
        issues.push({ checkId: check.id, message: "Declared check failed." });
      }
    }
    return { ok: issues.length === 0, issues, checkReceipts };
  };
}
