/** Decide readiness from the score claim, conformance, full-task solve and saved evidence. */
import type { ClaimStatement } from "./claim-evidence.ts";
import type { ConformanceEvidence } from "./conformance-evidence.ts";
import { inertToolFindings } from "../truth/grounding-coverage.ts";
import type { JsonValue } from "../meta/json-shape.ts";
import type { SolvabilityStageReceipt } from "../truth/solvability-stages.ts";
import type { CheckFailureDetail } from "../truth/predicate.ts";

export type IsolationStrength = "physical" | "contractual";

export interface SolvabilitySubmissionPathEvidence {
  schema: "solvability-submission-path/v1";
  stages: ["writer-tool-schema", "draft-store", "materialise", "submit", "accept"];
  writerCalls: Array<{ name: string; callId: string }>;
  draftSeq: number;
  materialization: {
    writerName: string;
    callId: string;
    sourceSeq: number;
    artifactDigest: string;
  };
  submission: {
    attempts: number;
    publicArtifactSchemaHash: string;
    artifactDigest: string;
  };
}

/** One full-task solve run by the controller. The isolated solver sees only the public task. Its
 * answer passes through the public writer, DraftStore and controller-owned submit before checking.
 * The reference answer stays private. */
export interface SolvabilityCaseEvidence {
  taskId: string;
  fullTaskDigest: string;
  publicTaskDigest: string;
  artifactDigest: string | null;
  /** Stable JSON reference answer, kept on the private checking side; null when absent. */
  artifact: JsonValue;
  status: "passed" | "failed" | "non-result";
  /** A host failure before the child is ready is a non-result. After solving starts, crashes,
   * timeouts and protocol errors are product failures and this stays `null`. */
  nonResultKind: "reference-solve-host" | "submission-path-host" | "sandbox" | null;
  /** Who owns an unsuccessful solve. Passed rows use `null`. */
  failureOwner: "environment" | "product" | null;
  /** Set when a valid reference answer cannot pass through the writer. */
  failureKind: "representation-defect" | null;
  /** Present only when writer → DraftStore → materialise → submit → accept completed. */
  submissionPath: SolvabilitySubmissionPathEvidence | null;
  /** The reference-solve stage key, and whether this census executed it or reused the outcome a
   *  census over `producedUnder` recorded under the same key. Null when the solve failed before its
   *  bytes could be keyed, or never started. The submission path and evaluation always run here. */
  referenceSolve: SolvabilityStageReceipt | null;
  failedCheckIds: string[];
  /** Private check failures recalculated by the controller. They remain under `.build/` or `runs/`
   * and never enter the agent bundle or public task. */
  predicateFailures: CheckFailureDetail[];
  error: string | null;
}

/** Full-task solve evidence created from the fixed accepted bundle. It identifies the exact
 * correctness model, task set, bundle and checking code. */
export interface SolvabilityEvidence {
  schema: "solvability/v8";
  policy: string;
  correctnessModelHash: string;
  taskSetHash: string;
  bundleSnapshotId: string;
  /** Host-derived identity of every installed tool this proof ran; null when none ran. It must
   * equal the measured claim's hash for the two to support readiness together. */
  verifierEnvironmentHash: string | null;
  /** Public id of the temporary HMAC key used to hash compared values; never the key itself. */
  operandCommitmentKeyId: string;
  /** How many tool runs this census made. A reused family-binding stage contributes none; its
   *  runs belong to the census that produced it. Per-run facts stay with the host. */
  toolRuns: number;
  /** The family transplant census stage; null when it did not run (readiness, or a missing witness). */
  familyBinding: SolvabilityStageReceipt | null;
  cases: SolvabilityCaseEvidence[];
}

export interface ReadinessInput {
  /** Statement from the checked score claim. */
  statement: ClaimStatement;
  /** Tool-conformance result, or `null` when it never ran. */
  conformance: ConformanceEvidence | null;
  isolation: IsolationStrength;
  /** Full-task solve result for the fixed accepted bundle. */
  solvability: SolvabilityEvidence | null;
  /** Independent hash of `tasks.json`, used to bind the evidence to its task set. */
  taskSetHash: string | null;
  /**
   * Integrity findings for the run directory containing the claim's battery. Files written or
   * changed outside the evaluation runner's write log cannot support readiness, a rule introduced
   * with steering delta P1 when generated code began running in-process and could reach the run
   * directory without going through the log.
   *
   * Null and [] are different answers, and conflating them is what the null is for: null means the
   * verification never ran, so nothing was looked at, and it prevents readiness exactly as a
   * finding would. Only a completed check returning [] establishes that the reader looked and
   * found no violations (handover 2026-07-11).
   */
  evidenceStage: Array<{ code: string; path: string; detail: string }> | null;
}

interface ReadinessClause {
  clause: string;
  detail: string;
}

export interface ReadinessVerdict {
  ready: boolean;
  isolation: IsolationStrength;
  clauses: ReadinessClause[];
}

export function assessReadiness(input: ReadinessInput): ReadinessVerdict {
  const clauses: ReadinessClause[] = [];

  if (input.statement.n > 0 && input.statement.passed === 0) {
    clauses.push({
      clause: "paid-agent-zero-pass",
      detail:
        "the scored built agent passed zero authored tasks — the constructive solver proves internal solvability, but a 0/N live battery still describes an unusable harness/backend pairing",
    });
  }

  // An external check with no tool runs on applicable verified cases has no tool evidence for
  // the score. Report the check ids so the missing execution can be investigated.
  for (const finding of inertToolFindings(
    input.statement.externalCheckCoverage,
    "the verified cases of this battery",
  )) {
    clauses.push({ clause: finding.code, detail: finding.detail });
  }

  if (input.solvability === null) {
    clauses.push({
      clause: "no-solvability-witness",
      detail:
        "no bundle-snapshot solve(task)→evaluate evidence exists for the authored task census — paid-agent passes are performance observations, not a constructive proof that the harness itself admits a valid answer",
    });
  } else {
    if (
      input.taskSetHash === null ||
      input.solvability.taskSetHash !== input.taskSetHash ||
      input.solvability.taskSetHash !== input.statement.taskSetHash ||
      input.solvability.correctnessModelHash !== input.statement.correctnessModelHash
    ) {
      clauses.push({
        clause: "solvability-evidence-mismatch",
        detail:
          "the solvability evidence does not bind the same correctnessModelHash/taskSetHash as the created claim and current fingerprint — a proof over different Correctness Model or task bytes is archaeology, not readiness evidence",
      });
    }
    if (input.solvability.verifierEnvironmentHash !== input.statement.verifierEnvironmentHash) {
      clauses.push({
        clause: "solvability-verifier-environment-mismatch",
        detail:
          "the constructive proof and scored claim were verified under different verifier environments — they cannot jointly support readiness",
      });
    }
    const failed = input.solvability.cases.filter((c) => c.status !== "passed");
    if (input.solvability.cases.length === 0 || failed.length > 0) {
      clauses.push({
        clause: "solvability-failed",
        detail: `${failed.length}/${input.solvability.cases.length} constructive witness case(s) failed; every authored task must serialize, conform to the artifact schema, and pass the fingerprinted correctnessModel`,
      });
    }
    const pathless = input.solvability.cases.filter(
      (c) => c.status === "passed" && c.submissionPath === null,
    );
    if (pathless.length > 0) {
      clauses.push({
        clause: "solvability-submission-path-missing",
        detail: `${pathless.length} passed witness case(s) carry no submission-path evidence — a pass without the writer → DraftStore → submit traversal proves direct construction, not the public submission path`,
      });
    }
  }

  if (!input.conformance) {
    clauses.push({
      clause: "conformance-unprobed",
      detail:
        "no conformance evidence — the generated tool contract was never probed against the validated tools spec (a provided-probe boolean or a hardcoded true is not a probe): the final-submission fact could be vacuous, submission could accept an empty draft, and the tool set could diverge from what was validated",
    });
  }

  if (input.evidenceStage === null) {
    clauses.push({
      clause: "evidence-stage-unverified",
      detail:
        "recorded-evidence verification never ran for this run directory — unverified is not clean; run verifyRunDir over the claim's run directory and state the outcome",
    });
  } else if (input.evidenceStage.length > 0) {
    const first =
      /* SAFETY: the branch is entered only when the evidence stage carries at least one clause. */ input
        .evidenceStage[0] as { code: string; path: string; detail: string };
    clauses.push({
      clause: "evidence-stage-violated",
      detail: `${input.evidenceStage.length} recorded-evidence violation(s), first [${first.code}] ${first.path} — run-directory evidence exists outside the eval runner's write log or differs from what it wrote; evidence that may have been touched by the Built Harness cannot back a ready verdict`,
    });
  }

  return { ready: clauses.length === 0, isolation: input.isolation, clauses };
}
