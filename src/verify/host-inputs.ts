/** Authorise tool bytes from the same projection that the named check receives. */
import { checkEvaluationRequest } from "../../vendor/correctness-model-bundle/evaluate.ts";
import { toolInputLeaves } from "../../vendor/correctness-model-bundle/tool-inputs.ts";
import { canonicalJson } from "../meta/stable-json.ts";
import { isRecord, isString } from "../meta/json-shape.ts";
import { sha256 } from "../meta/digest.ts";
import type { VerifierSubject } from "./verifier-port.ts";
import { VerifierContractError } from "../../vendor/correctness-model-bundle/contract-error.ts";

export interface ToolInputGrant {
  leaves: Map<string, string[]>;
  inputKind: "authored" | "external";
  hiddenInputDigest: string | null;
  artifactInputDigest: string;
  publicTaskInputDigest: string | null;
}

export function checkToolInputs(subject: VerifierSubject, checkId: string): ToolInputGrant {
  let { artifact, publicTask } = subject;
  let inputKind: ToolInputGrant["inputKind"] = "external";
  let hidden: unknown;
  if (subject.checks !== null) {
    const check = subject.checks.find((candidate) => candidate.id === checkId);
    if (check === undefined) {
      throw new VerifierContractError(
        "verifier-tool-binding",
        `check ${checkId} is not applicable to this subject`,
      );
    }
    inputKind = check.execution.evidence.kind;
    if (!isRecord(publicTask) || !isString(publicTask.taskId) || !isString(publicTask.family)) {
      throw new Error("tool subject requires its committed public task");
    }
    ({ artifact, publicTask, hidden } = checkEvaluationRequest(check, {
      artifact,
      publicTask: {
        taskId: publicTask.taskId,
        family: publicTask.family,
        publicInput: publicTask.publicInput,
      },
      hidden: subject.hidden ?? [],
    }));
  }
  const leaves = toolInputLeaves(artifact, publicTask, hidden);
  return {
    leaves,
    inputKind,
    hiddenInputDigest: hidden === undefined ? null : sha256(canonicalJson(hidden)),
    artifactInputDigest: sha256(canonicalJson(artifact)),
    publicTaskInputDigest: publicTask === null ? null : sha256(canonicalJson(publicTask)),
  };
}
