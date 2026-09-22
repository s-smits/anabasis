/**
 * Writes one claim record for one recorded battery, using `Claim.create` and `assessReadiness`.
 *
 * The claim input is rebuilt from the recorded battery alone, plus `bundles` from a fresh
 * fingerprint of the same tree and `grounding` from the validated brief joined with recorded
 * execution. Readiness is checked at write time: the solvability witness reruns over the bundle
 * snapshot and the run directory is verified again. Absent conformance evidence stays null and
 * yields `conformance-unprobed`.
 *
 * The claim goes under campaigns/<slug>/claims/, outside the run directory, since writing into
 * runs/<runId>/ would itself violate the recorded evidence.
 */
import { mkdirSync, readFileSync } from "../meta/filesystem.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { join } from "../meta/path.ts";
import { batteryClaimInput } from "../claim/battery-run-evidence.ts";
import { Claim } from "../claim/claim.ts";
import type { ClaimClause, ClaimStatement, ScoredCase } from "../claim/claim-evidence.ts";
import type { ConformanceEvidence } from "../claim/conformance-evidence.ts";
import {
  type ReadinessVerdict,
  type SolvabilityEvidence,
  type IsolationStrength,
  assessReadiness,
} from "../claim/readiness.ts";
import { recordedEvidence, verifyRunDir } from "../claim/evidence-log.ts";
import { type FingerprintEvidence, fingerprintSlug } from "../claim/fingerprint.ts";
import { validateBrief } from "../truth/brief-validator.ts";
import type { Brief, ContractFinding } from "../truth/brief.ts";
import type { GroundingDeclaration } from "../truth/grounding.ts";
import { controllerValidatedFinding } from "../truth/brief.ts";
import {
  type CaseRecord,
  type BundleSnapshotFact,
  batteryPath,
  CASE_JUDGE_FILE,
  readRecordedBatteryRecord,
} from "../truth/battery-record.ts";
import { applicableCheckIds } from "../truth/run-controls.ts";
import type { ControlCorpus } from "../truth/controls.ts";
import { isControlCorpus } from "../truth/controls.ts";
import { type SolvabilityProbeOptions, makeProbeSolvability } from "../truth/solvability.ts";
import type { BuildDeps } from "../truth/build-deps.ts";
import {
  VerifierExecutionNonResult,
  environmentOwnedToolNonResult,
  toolRetryDelay,
} from "../truth/verifier-nonresult.ts";
import { toolNonResultCode } from "../author/tool-non-result.ts";
import { toolRunFailureDetail } from "./census-gate.ts";
import { assertRunIdSafe, loadRecordedTasks } from "./run-driver.ts";
import { sourceStillFrozen } from "./source-identity.ts";
import { parseJsonAs, capturedJsonParse, capturedJsonStringify } from "../meta/json-runtime.ts";
import { isBoolean, isRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { BRIEF_FILE, CONTROLS_FILE, EVALUATOR_FILE } from "../meta/bundle-layout.ts";
import { readJsonFile } from "../meta/completed-json.ts";

interface WriteRunClaimOptions {
  slug: string;
  slugDir: string;
  /** Where this function writes claim evidence, one file per runId. */
  claimsDir: string;
  /** The recorded battery to write from. */
  runId: string;
  /** The disclosed isolation strength the battery was verified under. */
  isolation: IsolationStrength;
  /** Build-time conformance evidence when the caller has one; null is disclosed, not defaulted. */
  conformance?: ConformanceEvidence | null;
  /** Passed into the constructive solvability probe (verifier contract, engine profile, timeout). */
  probe?: SolvabilityProbeOptions;
  /** A probe the caller already holds; tests pass a double. */
  probeSolvability?: BuildDeps["probeSolvability"];
  /** Pause before the one retry an environment-owned tool non-result earns; tests pass 0. */
  toolRetryWaitMs?: number;
}

export interface WrittenRunClaim {
  runId: string;
  /** True when Claim.create created a claim; false carries the complete blocking-clause list. */
  created: boolean;
  /** Whether the run's recorded evidence verifies, independently of the claim decision. */
  batteryRecorded: boolean;
  statement: ClaimStatement | null;
  /** Verified and passed case counts, computed whether or not the claim was created. */
  batteryScore: BatteryScore;
  clauses: ClaimClause[];
  /** Null exactly when the claim was not created. */
  readiness: ReadinessVerdict | null;
  solvabilityFindings: ContractFinding[];
  evidencePath: string;
}

/** The recorded battery's truth-verified and passed counts. */
interface BatteryScore {
  verified: number;
  passed: number;
}

/** Claim evidence lives at `campaigns/<slug>/claims/<runId>.json`, outside the run directories. */
export function claimsDirFor(repoRoot: string, slug: string): string {
  return join(campaignDir(repoRoot, slug), "claims");
}

/** The adopted tree's brief revalidated at write time. */
function validatedBrief(slugDir: string): Brief {
  const raw: unknown = readJsonFile(join(slugDir, BRIEF_FILE));
  const validation = validateBrief(raw);
  if (!validation.ok) {
    const codes = validation.findings.map((finding) => finding.code).join(", ");
    throw new Error(`${slugDir}/correctness-model/brief.json: no longer validates at write time — ${codes}`);
  }
  return /* SAFETY: `validateBrief` reported ok directly above, which is the only proof of this shape. */ raw as Brief;
}

function recordedControlCorpus(slugDir: string): ControlCorpus {
  const path = join(slugDir, CONTROLS_FILE);
  const raw = parseJsonAs<JsonValue>(readFileSync(path, "utf8"));
  if (!isControlCorpus(raw)) {
    throw new Error(`${path}: recorded control corpus is not an accept/reject object`);
  }
  return raw;
}

/**
 * Runs the claim-time solvability witness, the same probe the census gate ran before adoption. A
 * verifier non-result becomes a finding beside the claim (readiness then refuses on
 * `no-solvability-witness`) instead of a throw, so the score stays recorded. An environment-owned
 * kind (`sandbox`, `verifierUnavailable`) is retried once; `timeout` and `crash` are recorded at once.
 */
async function probeOrNoVerdict(
  options: WriteRunClaimOptions,
  request: Parameters<BuildDeps["probeSolvability"]>[0],
): Promise<Awaited<ReturnType<BuildDeps["probeSolvability"]>>> {
  const probe = options.probeSolvability ?? makeProbeSolvability(options.probe ?? {}, "readiness");
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await probe(request);
    } catch (caught) {
      if (!(caught instanceof VerifierExecutionNonResult)) throw caught;
      if (attempt === 1 && environmentOwnedToolNonResult(caught.evidence.outcome)) {
        await toolRetryDelay(options.toolRetryWaitMs);
        continue;
      }
      return {
        evidence: null,
        findings: [
          controllerValidatedFinding({
            code: toolNonResultCode(caught.evidence),
            path: EVALUATOR_FILE,
            detail: `solvability witness at claim time: tool run ${caught.evidence.outcome} after ${attempt} attempt${attempt === 1 ? "" : "s"}. ${toolRunFailureDetail(caught.evidence)}`,
          }),
        ],
      };
    }
  }
}

/** Readiness from a fresh solvability witness and a fresh verification of the run directory. Runs
 *  only for a created statement. */
async function readinessAtWrite(
  options: WriteRunClaimOptions,
  fingerprint: FingerprintEvidence & { taskSetHash: string },
  statement: ClaimStatement,
): Promise<{
  readiness: ReadinessVerdict;
  solvability: SolvabilityEvidence | null;
  solvabilityFindings: ContractFinding[];
}> {
  // A fresh secret key per write, so commitments are not linkable across runs; only keyId is
  // recorded.
  const operandCommitment = {
    key: crypto.getRandomValues(new Uint8Array(32)),
    keyId: `${options.slug}-${options.runId}-operands`,
  };
  // The probe's children read source from disk, so a drifted source tree voids the witness.
  const sourceDriftFinding = (moment: string) =>
    controllerValidatedFinding({
      code: "SOLVABILITY_SOURCE_DRIFT",
      path: "src",
      detail: `solvability witness refused ${moment}: the executable source roots differ from the process's fixed identity`,
    });
  let probed: Awaited<ReturnType<ReturnType<typeof makeProbeSolvability>>>;
  if (sourceStillFrozen() === null) {
    probed = await probeOrNoVerdict(options, { slugDir: options.slugDir, fingerprint, operandCommitment });
    if (sourceStillFrozen() !== null) {
      probed = { evidence: null, findings: [...probed.findings, sourceDriftFinding("mid-probe")] };
    }
  } else {
    probed = { evidence: null, findings: [sourceDriftFinding("before probing")] };
  }
  const readiness = assessReadiness({
    statement,
    conformance: options.conformance ?? null,
    isolation: options.isolation,
    solvability: probed.evidence,
    taskSetHash: fingerprint.taskSetHash,
    evidenceStage: verifyRunDir(join(options.slugDir, "runs", options.runId)),
  });
  return { readiness, solvability: probed.evidence, solvabilityFindings: probed.findings };
}

/** The bundleSnapshot the score executed under, read only from the recorded battery. */
export function executedBundleSnapshotFact(slugDir: string, runId: string): BundleSnapshotFact {
  const path = batteryPath(slugDir, runId);
  const bundleSnapshot =
    /* SAFETY: the recorded battery record holds this fact as free JSON; every field the binding needs is checked below and a missing one throws. */ readRecordedBatteryRecord(
      join(slugDir, "runs", runId),
      runId,
    ).bundleSnapshot as Partial<BundleSnapshotFact> | undefined;
  if (
    !isString(bundleSnapshot?.id) ||
    !isString(bundleSnapshot.agentHash) ||
    !isString(bundleSnapshot.correctnessModelHash) ||
    !("taskSetHash" in bundleSnapshot)
  ) {
    throw new Error(
      `${path}: battery evidence carries no executed-bundleSnapshot fact — nothing to bind a claim to`,
    );
  }
  return /* SAFETY: the check above threw unless id, agentHash, correctnessModelHash and taskSetHash are all present with the right kind. */ bundleSnapshot as BundleSnapshotFact;
}

/** The executed bundleSnapshot, which the fresh fingerprint must match: a difference means the tree
 *  changed after verification, and the claim would name bytes the score never ran under. */
function bindExecutedBundleSnapshot(
  slug: string,
  runId: string,
  bundleSnapshot: BundleSnapshotFact,
  fingerprint: FingerprintEvidence,
): BundleSnapshotFact & { taskSetHash: string } {
  if (
    bundleSnapshot.agentHash !== fingerprint.agentHash ||
    bundleSnapshot.correctnessModelHash !== fingerprint.correctnessModelHash ||
    bundleSnapshot.taskSetHash !== fingerprint.taskSetHash
  ) {
    throw new Error(
      `${slug}/${runId}: the tree changed between verification and claim writing — executed bundleSnapshot (agent ${bundleSnapshot.agentHash}, correctnessModel ${bundleSnapshot.correctnessModelHash}, tasks ${bundleSnapshot.taskSetHash}) does not match the current fingerprint (agent ${fingerprint.agentHash}, correctnessModel ${fingerprint.correctnessModelHash}, tasks ${fingerprint.taskSetHash})`,
    );
  }
  const { taskSetHash } = bundleSnapshot;
  if (taskSetHash === null) {
    throw new Error(
      `${slug}: the executed bundleSnapshot has no taskSetHash — a claim cannot pin a task set that was never recorded`,
    );
  }
  return { ...bundleSnapshot, taskSetHash };
}

/** Computed for every write, so a refused claim still discloses what the battery measured. */
function batteryScoreOf(score: readonly ScoredCase[]): BatteryScore {
  return {
    verified: score.filter((row) => row.truthVerified).length,
    passed: score.filter((row) => row.passed).length,
  };
}

/** The case ids whose recorded Judge verdict contradicts the verifier's, read from the same run
 *  directory as the score. Disputes are disclosed on the claim and change no score, decision or
 *  promotion. Only two disagreeing booleans are a dispute; absent or non-boolean Judge evidence is
 *  not. */
function disputedCaseIds(runDir: string, cases: readonly CaseRecord[]): string[] {
  const violations = verifyRunDir(runDir);
  const disputed: string[] = [];
  for (const row of cases) {
    if (!isBoolean(row.truthOk)) continue;
    const recorded = recordedEvidence(runDir, join("cases", row.taskId, CASE_JUDGE_FILE), violations);
    if (!recorded.ok) continue;
    // The bytes are digest-checked output of the evidence log, which writes only JSON.
    const parsed: unknown = capturedJsonParse(recorded.bytes);
    if (!isRecord(parsed) || !isBoolean(parsed.verdict) || parsed.verdict === row.truthOk) continue;
    disputed.push(row.taskId);
  }
  return disputed;
}

/** The claim's evidence block: recorded battery evidence, executed bundle hashes and grounding. */
function recordedClaimEvidence(
  slugDir: string,
  battery: ReturnType<typeof readRecordedBatteryRecord>,
  bundleSnapshot: ReturnType<typeof bindExecutedBundleSnapshot>,
) {
  const brief = validatedBrief(slugDir);
  const checkIdsByTask = new Map(
    loadRecordedTasks(slugDir).map((task) => [task.taskId, applicableCheckIds(brief, task)]),
  );
  const recordedInput = batteryClaimInput(battery, checkIdsByTask, recordedControlCorpus(slugDir));
  const evidence = {
    ...recordedInput.evidence,
    bundles: {
      agentHash: bundleSnapshot.agentHash,
      correctnessModelHash: bundleSnapshot.correctnessModelHash,
      taskSetHash: bundleSnapshot.taskSetHash,
    },
    grounding: {
      declared: brief.truthChecks.flatMap((check): GroundingDeclaration[] =>
        check.execution.evidence.kind === "external"
          ? check.execution.evidence.requiredToolIds.map((adapterId) => ({
              checkId: check.id,
              grounding: { kind: "external-verifier", adapterId, assertion: check.assertion },
            }))
          : [
              {
                checkId: check.id,
                grounding: { kind: "authored", assertion: check.assertion },
                ...keyIfDefined("requiredToolIds", check.execution.requiredToolIds),
              },
            ],
      ),
      execution: recordedInput.execution,
    },
  };
  return { recordedInput, evidence };
}

export async function writeRunClaim(options: WriteRunClaimOptions): Promise<WrittenRunClaim> {
  const { runId, slugDir } = options;
  assertRunIdSafe(runId);
  const battery = readRecordedBatteryRecord(join(slugDir, "runs", runId), runId);
  if (!isRecord(battery.truthCheckFiring)) {
    throw new Error(`${options.slug}/${runId}: recorded battery carries no truthCheckFiring`);
  }
  if (battery.slug !== options.slug) {
    throw new Error(
      `${options.slug}/${runId}: recorded battery belongs to ${capturedJsonStringify(battery.slug)}`,
    );
  }
  const fingerprint = fingerprintSlug(slugDir, { slug: options.slug });
  if (!fingerprint.ok) {
    const codes = fingerprint.findings.map((finding) => finding.code).join(", ");
    throw new Error(`${options.slug}: the adopted tree no longer fingerprints at write time — ${codes}`);
  }
  const bundleSnapshot = bindExecutedBundleSnapshot(options.slug, runId, battery.bundleSnapshot, fingerprint);

  const { recordedInput, evidence } = recordedClaimEvidence(slugDir, battery, bundleSnapshot);
  // Read from the same recorded bytes as the score, before the readiness probe runs.
  const disputed = disputedCaseIds(join(slugDir, "runs", runId), battery.cases);
  const claim = Claim.create({
    slug: options.slug,
    runId,
    evidence,
    score: recordedInput.score,
  });

  const { readiness, solvability, solvabilityFindings } = claim.ok
    ? await readinessAtWrite(
        options,
        { ...fingerprint, taskSetHash: bundleSnapshot.taskSetHash },
        claim.statement,
      )
    : { readiness: null, solvability: null, solvabilityFindings: [] };

  mkdirSync(options.claimsDir, { recursive: true });
  const evidencePath = join(options.claimsDir, `${runId}.json`);
  await Bun.write(
    evidencePath,
    capturedJsonStringify(
      {
        schema: "run-claim/v1",
        slug: options.slug,
        runId,
        createdAt: new Date().toISOString(),
        // The battery's own run condition; the claim asserts none of its own.
        condition: battery.condition,
        claim: claim.ok
          ? { ok: true, statement: claim.statement }
          : { ok: false, repairable: claim.repairable, clauses: claim.clauses },
        disputedCaseIds: disputed,
        readiness,
        solvability,
        solvabilityFindings,
      },
      null,
      2,
    ),
  );

  return {
    runId,
    created: claim.ok,
    batteryRecorded: verifyRunDir(join(slugDir, "runs", runId)).length === 0,
    statement: claim.ok ? claim.statement : null,
    batteryScore: batteryScoreOf(recordedInput.score),
    clauses: claim.ok ? [] : claim.clauses,
    readiness,
    solvabilityFindings,
    evidencePath,
  };
}
