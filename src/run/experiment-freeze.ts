/**
 * Check which parts of the adopted product each experiment must keep unchanged. A task-only
 * climb keeps the agent and scoring program fixed while changing the battery, and with it the
 * reference solve and tests. An evaluation correction keeps the agent, public tasks and
 * submission schema fixed while changing evaluation.
 * A build may change all parts. candidate-promotion.ts checks this before installation, and
 * candidate-verification.ts refuses a proved violation before paying for a battery.
 */
import { Type, type Static } from "typebox";
import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { sha256 } from "../meta/digest.ts";
import { canonicalJson } from "../meta/stable-json.ts";
import { isRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import {
  readBoundConformance,
  recordedVerifierEnvironmentHash,
  toolsSpecHashOf,
  type ConformanceEvidence,
} from "../claim/conformance-evidence.ts";
import { fingerprintSlug, type FingerprintEvidence } from "../claim/fingerprint.ts";
import type { HarnessAuthoring, HarnessExperiment } from "../critic/types.ts";
import type { Brief } from "../truth/brief.ts";
import { briefPublicResources, judgePublicTaskOf } from "../truth/public-resources.ts";
import { validateBrief } from "../truth/brief-validator.ts";
import type { BuildTask } from "../truth/tasks.ts";
import {
  type ExperimentPlan,
  ExperimentSubmissionSchema,
  type ExperimentSubmission,
} from "../author/experiment-plan.ts";
import { BRIEF_FILE, CONTROLS_FILE, TASKS_FILE } from "../meta/bundle-layout.ts";

export type ExperimentFreeze = { state: "held" | "unproven" | "broken"; clauses: string[] };

const DimensionSchema = Type.Union([Type.Literal("harness"), Type.Literal("tasks"), Type.Literal("scoring")]);
/** Host-derived from accepted bytes; the author declares only the target. */
const ExperimentOperationSchema = Type.Object(
  {
    operation: Type.Union([
      Type.Literal("task-probe"),
      Type.Literal("harness-intervention"),
      Type.Literal("evaluation-correction"),
      Type.Literal("repeat"),
      Type.Literal("new-baseline"),
    ]),
    moved: Type.Array(DimensionSchema),
    correctnessModelChangedFiles: Type.Optional(Type.Array(Type.String())),
    unproven: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type ExperimentDimension = Static<typeof DimensionSchema>;
export type ExperimentOperation = Static<typeof ExperimentOperationSchema>;

const experimentAuthoringFields = {
  proposal: ExperimentSubmissionSchema,
  operation: ExperimentOperationSchema,
  baseline: Type.Object(
    { agentHash: Type.String(), correctnessModelHash: Type.String(), taskSetHash: Type.String() },
    { additionalProperties: false },
  ),
};
/** A changed product/evaluation condition carries no task-only difficulty attribution. */
export const ExperimentAuthoringSchema = Type.Union([
  Type.Object(
    {
      ...experimentAuthoringFields,
      actual: Type.Literal("climb"),
      changedTaskIds: Type.Array(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...experimentAuthoringFields,
      actual: Type.Union([Type.Literal("evaluation"), Type.Literal("build")]),
      changedTaskIds: Type.Null(),
    },
    { additionalProperties: false },
  ),
]);
export type ExperimentAuthoring = Static<typeof ExperimentAuthoringSchema>;

/** The captured battery: its task rows in whichever of the two shapes the file holds, and the
 *  document around them, which the exam hash keeps. The requirement is the caller's, because an
 *  empty battery means something different to the authoring reader and to the exam commitment. */

/** Repair direction is advisory. A broader candidate is a build, and can never inherit the
 * attribution or admission-pointer privileges of a proved evaluation-only correction. */
export type ExperimentScope = {
  actual: HarnessExperiment;
  freeze: ExperimentFreeze | null;
  /** What the accepted bytes moved, when the author bound an experiment proposal. */
  operation?: ExperimentOperation;
};

type FreezeFingerprint = {
  agentHash: string;
  correctnessModelHash: string;
  scoringHash: string;
  taskSetHash: string | null;
};

/** The task file's rows, bare or under `tasks`, or null when it holds no task array at all. */
function batteryRows(dir: string) {
  const document = parseJsonAs<JsonValue>(readFileSync(join(dir, TASKS_FILE), "utf8"));
  const rows = Array.isArray(document)
    ? document
    : isRecord(document) && Array.isArray(document.tasks)
      ? document.tasks
      : null;
  return { document, rows };
}

function capturedBattery(dir: string, requirement: string) {
  const { document, rows } = batteryRows(dir);
  if (rows === null || rows.length === 0) throw new Error(requirement);
  return { document, rows };
}

/** An authoring draft's task rows. The starter seeds the task file as an empty array, so a draft
 *  that has written no task yet holds none rather than a defective battery. */
export function draftTaskRows(dir: string): ReturnType<typeof publicTaskRows> {
  return batteryRows(dir).rows?.length === 0 ? [] : publicTaskRows(dir);
}

/** Each task's id, family and public input, with its private expectation rows for scoring
 * comparisons. The family selects the task's applicable checks, so it is part of its ruler. */
export function publicTaskRows(
  dir: string,
): Array<{ taskId: string; family: string | null; publicInput: JsonValue; hidden: JsonValue | null }> {
  const { rows } = capturedBattery(dir, "experiment authoring requires a nonempty captured task battery");
  return rows.map((row) => {
    if (!isRecord(row) || !isString(row.taskId) || row.publicInput === undefined) {
      throw new Error("experiment authoring requires each captured task id and public input");
    }
    return {
      taskId: row.taskId,
      family: isString(row.family) ? row.family : null,
      publicInput: row.publicInput,
      hidden: row.hidden ?? null,
    };
  });
}

/** Only new public inputs count as changed tasks; relabelling ids, families or levels cannot
 * manufacture a harder subset. Both inputs are controller-owned frozen bundles. */
export function candidateExperimentAuthoring(
  proposal: ExperimentSubmission,
  operation: ExperimentOperation,
  actual: HarnessExperiment,
  baseDir: string,
  candidateDir: string,
): ExperimentAuthoring {
  const base = fingerprintSlug(baseDir);
  const candidate = fingerprintSlug(candidateDir);
  if (!base.ok || !candidate.ok || base.taskSetHash === null || candidate.taskSetHash === null) {
    throw new Error(
      "experiment authoring requires positively fingerprinted baseline and candidate batteries",
    );
  }
  if (
    ((actual === "climb" || actual === "evaluation") && base.agentHash !== candidate.agentHash) ||
    (actual === "climb" && base.scoringHash !== candidate.scoringHash)
  ) {
    throw new Error("experiment authoring cannot bind a fixed-product attribution to drifted bytes");
  }
  const baseline = {
    agentHash: base.agentHash,
    correctnessModelHash: base.correctnessModelHash,
    taskSetHash: base.taskSetHash,
  };
  const declared = { proposal, operation };
  if (actual !== "climb") return { ...declared, actual, baseline, changedTaskIds: null };
  const previous = new Set(publicTaskRows(baseDir).map((task) => canonicalJson(task.publicInput)));
  const changedTaskIds = publicTaskRows(candidateDir)
    .filter((task) => !previous.has(canonicalJson(task.publicInput)))
    .map((task) => task.taskId);
  return { ...declared, actual, baseline, changedTaskIds };
}

export function candidateExperimentScope(
  requested: HarnessAuthoring,
  baseDir: string | undefined,
  candidateDir: string,
  conformance?: ConformanceEvidence | null,
  proposalScope?: ExperimentPlan["scope"],
): ExperimentScope {
  if (proposalScope === undefined) return { actual: requested, freeze: null };
  let freeze: ExperimentFreeze;
  try {
    freeze =
      baseDir === undefined
        ? { state: "unproven", clauses: ["evaluation-baseline-absent"] }
        : experimentFreeze({ kind: "evaluation", baseDir, candidateDir }, conformance);
    if (baseDir !== undefined && freeze.state !== "held") {
      const taskFreeze = experimentFreeze({ kind: "climb", baseDir, candidateDir }, conformance);
      if (taskFreeze.state === "held") return { actual: "climb", freeze: taskFreeze };
    }
  } catch {
    freeze = { state: "unproven", clauses: ["evaluation-baseline-unreadable"] };
  }
  return { actual: freeze.state === "held" ? "evaluation" : "build", freeze };
}

/** Hash every task and battery field except the private expectation rows. New fields must
 * remain unchanged by default. The full taskSetHash still records changed evaluation bytes. */
function evaluationExamHash(dir: string): string {
  const { document, rows } = capturedBattery(
    dir,
    "a nonempty task battery is required for the evaluation exam commitment",
  );
  const tasks = rows.map((task) => {
    if (
      !isRecord(task) ||
      !isString(task.taskId) ||
      !isString(task.family) ||
      !Object.hasOwn(task, "publicInput") ||
      !Array.isArray(task.hidden)
    ) {
      throw new Error("each committed task needs its id, family, public input and hidden rows");
    }
    return Object.fromEntries(Object.entries(task).filter(([key]) => key !== "hidden"));
  });
  return sha256(canonicalJson(isRecord(document) ? { ...document, tasks } : tasks));
}

/** Check unchanged fields before probing and at final validation. Conformance later proves the
 * compiled schema identity; a changed declared representation can already be refused here.
 * `base` and `candidate` are identities the caller read; null marks an unreadable one. */
export function evaluationInvariantClauses(
  baseDir: string,
  candidateDir: string,
  base: FreezeFingerprint | null,
  candidate: FreezeFingerprint | null,
): string[] {
  const clauses: string[] = [];
  try {
    if (evaluationExamHash(baseDir) !== evaluationExamHash(candidateDir)) {
      clauses.push(
        "evaluation-battery-drift: preserve every public task, order, difficulty and declaration; only hidden expectation rows may change",
      );
    }
    const publicContract = (dir: string) => {
      const brief = parseJsonAs<unknown>(readFileSync(join(dir, BRIEF_FILE), "utf8"));
      if (!validateBrief(brief).ok) throw new Error("brief is invalid");
      // SAFETY: the complete brief validator accepted this JSON above.
      const valid = brief as Brief;
      const battery = parseJsonAs<BuildTask[] | { tasks: BuildTask[] }>(
        readFileSync(join(dir, TASKS_FILE), "utf8"),
      );
      const tasks = Array.isArray(battery) ? battery : battery.tasks;
      return {
        schema: canonicalJson(valid.artifactSchema),
        resources: canonicalJson({
          resources: briefPublicResources(valid),
          applicableRules: tasks.map((task) => judgePublicTaskOf(valid, task)),
        }),
      };
    };
    const basePublic = publicContract(baseDir);
    const candidatePublic = publicContract(candidateDir);
    if (basePublic.schema !== candidatePublic.schema) {
      clauses.push("evaluation-representation-drift: preserve the declared artifact representation");
    }
    if (basePublic.resources !== candidatePublic.resources) {
      clauses.push(
        "evaluation-public-resources-drift: preserve the published rules, constants, allowed values and their task applicability",
      );
    }
  } catch {
    clauses.push(
      "evaluation-exam-unverifiable: the public exam and declared representation require readable positive evidence",
    );
  }
  if (base === null || candidate === null) {
    clauses.push("evaluation-harness-unverifiable: both bundle identities must be readable");
  } else if (base.agentHash !== candidate.agentHash) {
    clauses.push("evaluation-agent-drift: preserve the solving agent during an evaluation correction");
  }
  return clauses;
}

/** Hash one battery file. taskSetHash still covers the tasks and controls together; these
 *  checks read each separately when a clause needs to identify which file changed.
 *  A file absent from both trees has not changed, so both hashes are null. A file appearing
 *  or disappearing on one side produces different hashes. */
function batteryFileHash(dir: string, file: string): string | null {
  const path = join(dir, file);
  return existsSync(path) ? sha256(readFileSync(path)) : null;
}

/** The adopted tree's identity, or null when it cannot be read, which a caller reads as no proved
 *  baseline rather than as a failure. */
export function readableFingerprint(dir: string): FingerprintEvidence | null {
  try {
    const fingerprint = fingerprintSlug(dir);
    return fingerprint.ok ? fingerprint : null;
  } catch {
    return null;
  }
}

/** Authored evaluation bytes: the scoring program and the battery pair. Installed tools have a
 *  separate recorded identity, and a reference solve or test the evaluator never imports scores
 *  nothing, so neither counts. */
export function evaluationFilesUnmoved(
  baseDir: string,
  candidateDir: string,
  baseScoringHash: string,
  candidateScoringHash: string,
): boolean {
  return (
    baseScoringHash === candidateScoringHash &&
    batteryFileHash(baseDir, TASKS_FILE) === batteryFileHash(candidateDir, TASKS_FILE) &&
    batteryFileHash(baseDir, CONTROLS_FILE) === batteryFileHash(candidateDir, CONTROLS_FILE)
  );
}

function evaluationFreeze(
  input: { baseDir: string; candidateDir: string },
  base: FreezeFingerprint,
  candidate: FreezeFingerprint,
  conformance?: ConformanceEvidence | null,
): ExperimentFreeze {
  const clauses = evaluationInvariantClauses(input.baseDir, input.candidateDir, base, candidate);
  // Evaluation may change authored checks, their calibration corpus or installed verifier bytes.
  const schema = submissionSchemaFreeze(input, candidate, conformance);
  if (evaluationFilesUnmoved(input.baseDir, input.candidateDir, base.scoringHash, candidate.scoringHash)) {
    const verifier = verifierFreeze(input, conformance);
    if (verifier.state === "unproven" && clauses.length === 0) return verifier;
    if (verifier.state === "held") {
      clauses.push(
        "evaluation-unmoved: the scoring program, installed verifier, hidden expectations and controls stayed byte-identical, so this evaluation correction moved nothing",
      );
    }
  }
  return { state: clauses.length > 0 ? "broken" : schema.state, clauses: [...clauses, ...schema.clauses] };
}

function verifierFreeze(
  input: { baseDir: string; candidateDir: string },
  conformance?: ConformanceEvidence | null,
): ExperimentFreeze {
  const base = recordedVerifierEnvironmentHash(input.baseDir);
  const candidate =
    conformance === undefined
      ? recordedVerifierEnvironmentHash(input.candidateDir)
      : conformance?.verifierEnvironmentHash;
  if (base === undefined || candidate === undefined) {
    return {
      state: "unproven",
      clauses: [
        "verifier-condition-unverifiable: fixed attribution requires recorded installed verifier identities",
      ],
    };
  }
  return base === candidate
    ? { state: "held", clauses: [] }
    : {
        state: "broken",
        clauses: ["verifier-condition-drift: the installed verifier implementation changed"],
      };
}

/** Both fixed-condition experiments require the same positively bound submission interface. */
function submissionSchemaFreeze(
  input: { baseDir: string; candidateDir: string },
  candidate: FreezeFingerprint,
  conformance?: ConformanceEvidence | null,
): ExperimentFreeze {
  const unproven: ExperimentFreeze = {
    state: "unproven",
    clauses: [
      "submission-schema-unverifiable: the public submission schema freeze needs positively bound conformance evidence",
    ],
  };
  try {
    const baseConformance = readBoundConformance(input.baseDir);
    // Submit keeps this controller-produced proof beside the iteration, outside immutable bytes.
    // Promotion reads its installed copy; a supplied null must never fall back to candidate files.
    const candidateConformance =
      conformance === undefined ? readBoundConformance(input.candidateDir) : conformance;
    if (
      baseConformance === null ||
      candidateConformance === null ||
      candidateConformance.toolsSpecHash !== toolsSpecHashOf(input.candidateDir) ||
      candidateConformance.taskSetHash !== candidate.taskSetHash
    ) {
      return unproven;
    }
    return baseConformance.publicArtifactSchemaHash === candidateConformance.publicArtifactSchemaHash
      ? { state: "held", clauses: [] }
      : {
          state: "broken",
          clauses: ["submission-schema-drift: the candidate changed the compiled public submission schema"],
        };
  } catch {
    return unproven;
  }
}

export function experimentFreeze(
  input: {
    kind: HarnessExperiment | null;
    baseDir: string;
    candidateDir: string;
  },
  conformance?: ConformanceEvidence | null,
): ExperimentFreeze {
  if (input.kind !== "climb" && input.kind !== "evaluation") return { state: "held", clauses: [] };
  const base = fingerprintSlug(input.baseDir);
  const candidate = fingerprintSlug(input.candidateDir);
  if (!base.ok || !candidate.ok) {
    const findings = [...(base.ok ? [] : base.findings), ...(candidate.ok ? [] : candidate.findings)];
    const named = findings
      .slice(0, 3)
      .map((finding) => `${finding.file}: ${finding.detail}`)
      .join("; ");
    return {
      state: "unproven",
      clauses: [
        `${input.kind}-harness-unverifiable: ${named}${findings.length > 3 ? ` (+${findings.length - 3} more)` : ""} — the freeze needs positive identity evidence`,
      ],
    };
  }
  if (input.kind === "evaluation") return evaluationFreeze(input, base, candidate, conformance);
  if (base.agentHash === candidate.agentHash && base.scoringHash === candidate.scoringHash) {
    const schema = submissionSchemaFreeze(input, candidate, conformance);
    return schema.state === "held" ? verifierFreeze(input, conformance) : schema;
  }
  return {
    state: "broken",
    clauses: [
      "climb-harness-drifted: the candidate's agent or scoring program differs from current's — a task probe keeps the agent, brief and evaluator with everything it imports fixed while the battery, its controls, reference solves and tests change, so this generation is a re-authoring instead of a task probe",
    ],
  };
}

/** The clauses alone, for the promotion check that only applies them. */
export function validateExperiment(input: {
  kind: HarnessExperiment | null;
  baseDir: string;
  candidateDir: string;
}): string[] {
  return experimentFreeze(input).clauses;
}
