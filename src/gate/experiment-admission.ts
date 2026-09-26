/**
 * What a captured candidate moved against the adopted product, and the admission findings on it.
 * These read bytes and recorded evidence only; they run no tool, so the pipeline reports them
 * beside the executed stages instead of before them.
 */
import type { CandidateSnapshot } from "../author/candidate-check.ts";
import { readBoundConformance } from "../claim/conformance-evidence.ts";
import { readFileSync } from "../meta/filesystem.ts";
import { canonicalJson } from "../meta/stable-json.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import type { JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { join } from "../meta/path.ts";
import { publicBatteryFingerprint } from "../run/climb-history.ts";
import {
  type ExperimentDimension,
  type ExperimentOperation,
  publicTaskRows,
  readableFingerprint,
} from "../run/experiment-freeze.ts";
import { compilePublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import type { ContractFinding } from "../truth/brief.ts";
import { isControlCorpus } from "../truth/controls.ts";
import { CONTROLS_FILE } from "../meta/bundle-layout.ts";

export interface AdmissionInput {
  /** The adopted tree a continuation moves away from; absent on an initial build. */
  adoptedDir?: string;
}

/** Whether the candidate keeps the adopted installed verifier and compiled submission schema.
 *  Unproven is neither preserved nor moved, and the three answers stay apart because a missing
 *  baseline proof certifies neither reading: treating it as preserved would let an unmeasurable
 *  change through as a controlled operation, and treating it as moved would deny a candidate that
 *  changed nothing. */
function submissionCondition(
  adoptedDir: string,
  candidate: CandidateSnapshot,
): "preserved" | "moved" | "unproven" {
  try {
    const baseline = readBoundConformance(adoptedDir);
    const { brief, corpus } = candidate.bundle;
    // An empty accept corpus compiles no submission schema, so nothing certifies preservation.
    if (baseline === null || corpus.accept.length === 0) return "unproven";
    const compiled = compilePublicArtifactSchema(
      brief.artifactSchema,
      corpus.accept.map((accept) => accept.artifact),
    );
    return baseline.verifierEnvironmentHash === candidate.verifierEnvironmentHash &&
      baseline.publicArtifactSchemaHash === compiled.sha256
      ? "preserved"
      : "moved";
  } catch {
    return "unproven";
  }
}

/** Public rows and per-input scoring of one tree, keyed by public input rather than task id, so
 *  renaming a retained task cannot hide its scoring change. Null when the tree is unreadable. */
function scoringOf(dir: string) {
  try {
    const corpus = parseJsonAs<JsonValue>(readFileSync(join(dir, CONTROLS_FILE), "utf8"));
    if (!isControlCorpus(corpus)) return null;
    const controls: Array<{ taskId: string }> = [...corpus.accept, ...corpus.reject];
    const rows = publicTaskRows(dir);
    const scoring = new Map<string, string[]>();
    for (const task of rows) {
      const bound = controls
        .flatMap(({ taskId, ...row }) => (taskId === task.taskId ? [canonicalJson(row)] : []))
        .sort();
      const key = canonicalJson(task.publicInput);
      scoring.set(
        key,
        [...(scoring.get(key) ?? []), canonicalJson([task.family, task.hidden, bound])].sort(),
      );
    }
    return { rows, scoring: new Map([...scoring].map(([key, values]) => [key, values.join("\n")])) };
  } catch {
    return null;
  }
}

const SINGLE_OPERATION = {
  harness: "harness-intervention",
  tasks: "task-probe",
  scoring: "evaluation-correction",
} as const;

/** What the accepted bytes moved against the adopted baseline, derived by the host: one moved
 *  dimension is a controlled operation, none a repeat, and several, or no readable baseline proof,
 *  a new baseline that carries no attributable-improvement claim. Expectations, controls and family
 *  of a retained task count as scoring, since the family selects the checks that apply to it. So
 *  does the scoring program, and only that: a reference solve or test rewritten for a new battery
 *  moves what the gate rehearses, not what the verifier decides, which is why `scoringHash` is the
 *  evaluator's own import closure rather than the correctness-model directory. Counting any byte
 *  under correctness-model/ instead calls a candidate a new baseline for a rewritten reference solve
 *  or test, when what it did was one harness intervention or one task probe. */
export function experimentOperation(
  candidate: CandidateSnapshot,
  adoptedDir: string | undefined,
): ExperimentOperation {
  const adopted = adoptedDir === undefined ? null : readableFingerprint(adoptedDir);
  if (adoptedDir === undefined || adopted === null) {
    return { operation: "new-baseline", moved: [], unproven: "no adopted baseline" };
  }
  const submission = submissionCondition(adoptedDir, candidate);
  const [base, next] = [scoringOf(adoptedDir), scoringOf(candidate.snapshotDir)];
  if (submission === "unproven" || base === null || next === null) {
    return {
      operation: "new-baseline",
      moved: [],
      unproven: "baseline verifier, submission schema or battery unreadable",
    };
  }
  const moved: ExperimentDimension[] = [];
  if (adopted.agentHash !== candidate.fingerprint.agentHash) moved.push("harness");
  if (publicBatteryFingerprint(base.rows) !== publicBatteryFingerprint(next.rows)) moved.push("tasks");
  if (
    adopted.scoringHash !== candidate.fingerprint.scoringHash ||
    submission === "moved" ||
    [...next.scoring].some(([key, value]) => (base.scoring.get(key) ?? value) !== value)
  ) {
    moved.push("scoring");
  }
  const before = new Map(adopted.correctnessModelFiles.map((file) => [file.path, file.sha256]));
  const after = new Map(candidate.fingerprint.correctnessModelFiles.map((file) => [file.path, file.sha256]));
  const changedFiles = [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
  const [only] = moved;
  return {
    operation: only === undefined ? "repeat" : moved.length === 1 ? SINGLE_OPERATION[only] : "new-baseline",
    moved,
    ...keyIfDefined("correctnessModelChangedFiles", changedFiles.length > 0 ? changedFiles : undefined),
  };
}

/** Every admission finding on this candidate: an EXPERIMENT.json that could not be captured. It is
 *  reported beside the executed stages, never in place of them. */
export function admissionFindings(candidate: CandidateSnapshot): ContractFinding[] {
  return candidate.proposalFindings ?? [];
}
