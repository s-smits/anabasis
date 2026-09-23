/** Build-time tool probe evidence, checked against the recorded tool contract and task set. */
import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { sha256OfFile } from "../meta/digest.ts";
import { sameJsonValue } from "../meta/stable-json.ts";
import { assertTaskSetMatchesFingerprint } from "./bundle-snapshot.ts";
import { isString, type JsonValue } from "../meta/json-shape.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { TOOLS_SPEC_FILE } from "../meta/bundle-layout.ts";

/** The iteration-relative probe evidence this module reads and the gate writes. */
export const CONFORMANCE_FILE = "conformance.json";

export const CONFORMANCE_PROBE_POLICY =
  "falsifier-conformance/v24:worker-protocol-v2+artifact-writer-registration+draft-tool-constructor+contract-parity+preset-contract+controller-readers+public-schema-derived-writer+public-schema-submit+empty-green-submit+explicit-empty+direct-public-paths+safe-public-materialization+all-task-interpreters+all-task-worker-binding+schema-valid-args+executed-writers+request-error-checkpoint+task-set-binding+tool-schema-binding+tool-description-parity" as const;

export type ConformanceEvidence = {
  schema: "tool-conformance/v4";
  toolsSpecHash: string;
  /** Exact correctness-model/tasks.json bytes the probe ran over; the ids are a projection of these bytes. */
  taskSetHash: string;
  probePolicy: typeof CONFORMANCE_PROBE_POLICY;
  publicArtifactSchemaHash: string;
  /** Submit's required installed tools; null proves no tools. */
  verifierEnvironmentHash: string | null;
  worker: {
    schema: "generated-tool-worker/v3";
    generatedSourceDigest: string;
    workerPolicyIdentity: string;
    registrationDigest: string;
    /** The label, description, input schema and execution mode offered for each domain tool. The
     *  probe requires the same digest on every task, and `workerBindingRefusal` checks it again
     *  before each measured case, so a changed tool description or input schema cannot be served
     *  to the solver under evidence gathered for the original contract. */
    toolSchemaDigest: string;
    artifactWriterNames: string[];
  };
};

function isConformanceEvidence(value: JsonValue): value is ConformanceEvidence {
  const row =
    /* SAFETY: this predicate reads recorded evidence at its file boundary; every field is optional here and each one is checked below. */ value as Partial<ConformanceEvidence>;
  return (
    row?.schema === "tool-conformance/v4" &&
    isString(row.toolsSpecHash) &&
    isString(row.taskSetHash) &&
    row.probePolicy === CONFORMANCE_PROBE_POLICY &&
    isString(row.publicArtifactSchemaHash) &&
    (row.verifierEnvironmentHash === null ||
      (isString(row.verifierEnvironmentHash) && /^[0-9a-f]{64}$/.test(row.verifierEnvironmentHash))) &&
    row.worker?.schema === "generated-tool-worker/v3" &&
    isString(row.worker.generatedSourceDigest) &&
    isString(row.worker.workerPolicyIdentity) &&
    isString(row.worker.registrationDigest) &&
    isString(row.worker.toolSchemaDigest) &&
    Array.isArray(row.worker.artifactWriterNames) &&
    row.worker.artifactWriterNames.every((name) => isString(name) && name !== "") &&
    new Set(row.worker.artifactWriterNames).size === row.worker.artifactWriterNames.length &&
    sameJsonValue(row.worker.artifactWriterNames, [...row.worker.artifactWriterNames].sort())
  );
}

export function toolsSpecHashOf(slugDir: string): string {
  const file = join(slugDir, TOOLS_SPEC_FILE);
  if (!existsSync(file)) throw new Error(`${file}: cannot bind an absent tool contract`);
  return sha256OfFile(file);
}

/** Return null when evidence is absent; otherwise require this exact tool contract and task set. */
export function readBoundConformance(slugDir: string): ConformanceEvidence | null {
  const file = join(slugDir, CONFORMANCE_FILE);
  if (!existsSync(file)) return null;
  const parsed = parseJsonAs<JsonValue>(readFileSync(file, "utf8"));
  if (!isConformanceEvidence(parsed)) {
    throw new Error(`${file}: not a ConformanceEvidence — a malformed evidence cannot back readiness`);
  }
  const specFile = join(slugDir, TOOLS_SPEC_FILE);
  if (!existsSync(specFile)) {
    throw new Error(
      `${file}: conformance evidence present but agent/tools-spec.json is missing — the evidence cannot bind to an absent contract`,
    );
  }
  const specHash = toolsSpecHashOf(slugDir);
  if (specHash !== parsed.toolsSpecHash) {
    throw new Error(
      `${file}: toolsSpecHash ${parsed.toolsSpecHash} does not re-derive from agent/tools-spec.json (${specHash}) — the evidence was written over a different tool contract`,
    );
  }
  assertTaskSetMatchesFingerprint(slugDir, parsed.taskSetHash, "conformance evidence");
  return parsed;
}

/** Read the recorded condition; today's mutable tool tree cannot reconstruct an adopted identity. */
export function recordedVerifierEnvironmentHash(slugDir: string): string | null | undefined {
  try {
    return readBoundConformance(slugDir)?.verifierEnvironmentHash;
  } catch {
    return undefined;
  }
}
