/** Check-input commitments. No second deciding computation. */
import { resolveJsonPath as resolvePredicatePath } from "../meta/json-evidence.ts";
import { canonicalJson } from "../meta/stable-json.ts";
import type { Brief } from "./brief.ts";
import type { EvaluationRequest } from "./correctness-model-contract.ts";
import type { CorrectnessModelResult } from "../verify/correctness-model-result.ts";
import { checkEvaluationRequest } from "../../vendor/correctness-model-bundle/evaluate.ts";
export {
  evaluateCheckProgram,
  type CheckProgramEvaluation,
} from "../../vendor/correctness-model-bundle/evaluate.ts";
export { resolvePredicatePath };

export interface OperandCommitmentContext {
  key: Uint8Array;
  keyId: string;
}
/** One failed check and a run-keyed digest of each input it read: the artifact, the public task and
 *  the hidden operand, whole. */
export interface CheckFailureDetail {
  checkId: string;
  operands: Array<{ role: "artifact" | "public-task" | "hidden"; digest: string }>;
}

/** Bind failure diagnostics to the inputs of an already completed check. Never rerun its program. */
export function checkProgramFailureDetails(
  brief: Brief,
  request: EvaluationRequest,
  commitment: OperandCommitmentContext,
  receipts: NonNullable<CorrectnessModelResult["checkReceipts"]>,
): CheckFailureDetail[] {
  return receipts
    .filter((row) => !row.passed)
    .map((row) => {
      const check = brief.truthChecks.find((declared) => declared.id === row.checkId);
      if (check === undefined) throw new Error("check receipt names no declared program");
      const input = checkEvaluationRequest(check, request);
      const values = [
        ["artifact", input.artifact],
        ["public-task", input.publicTask],
        ["hidden", input.hidden],
      ] as const;
      return {
        checkId: row.checkId,
        operands: values.map(([role, value]) => ({
          role,
          digest: new Bun.CryptoHasher("sha256", commitment.key).update(canonicalJson(value)).digest("hex"),
        })),
      };
    });
}
