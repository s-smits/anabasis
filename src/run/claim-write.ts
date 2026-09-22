/**
 * Write claim evidence from a recorded battery using `Claim.create` and `assessReadiness`.
 * This completed the build → evaluate → claim path that the operator audit on 2026-07-26
 * found missing [P1]. Each call writes one claim record for one recorded battery identity.
 *
 * The write takes only a run identity. It reconstructs the runner-owned claim input from the
 * recorded battery, then adds `bundles` from a fresh fingerprint of the same tree and `grounding` from
 * the validated brief's declarations joined with recorded execution evidence. Process memory is
 * not a second score or evidence owner.
 *
 * Check readiness when writing the claim, using the evidence available at that point:
 * the constructive solvability witness runs again over the immutable bundle snapshot (no
 * paid turns), and recorded evidence is verified again in the exact run directory containing
 * the battery. The caller supplies conformance evidence when available; otherwise it stays
 * null and produces `conformance-unprobed`. Missing evidence cannot establish that the
 * conformance check passed.
 *
 * The claim file goes under the caller's claims directory (campaigns/<slug>/claims/), outside the
 * recorded run dir, because writing post-record into runs/<runId>/ would itself be the
 * recorded-evidence violation that the readiness verdict checks for.
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
  /** The recorded battery to write from. No mutable evaluation report crosses this boundary. */
  runId: string;
  /** The disclosed isolation strength the battery was verified under. */
  isolation: IsolationStrength;
  /** Build-time conformance evidence when the caller has one; null is disclosed, not defaulted. */
  conformance?: ConformanceEvidence | null;
  /** Passed into the constructive solvability probe (verifier contract, engine profile, timeout). */
  probe?: SolvabilityProbeOptions;
  /** The probe itself, when a caller already holds one; tests hand in a double. Same interface as
   *  the F2 adoption gate's `probe`. */
  probeSolvability?: BuildDeps["probeSolvability"];
  /** The pause before the one fresh execution an environment-owned tool non-result earns at claim
   *  time; tests pass 0. Defaults to the shared `TOOL_RETRY_DELAY_MS`. */
  toolRetryWaitMs?: number;
}

export interface WrittenRunClaim {
  runId: string;
  /** True when Claim.create created a claim; false carries the complete blocking-clause list. */
  created: boolean;
  /** Whether this run's recorded evidence passes verification, independently of the claim
   *  decision (terminal denominators). Computed here unconditionally — readiness
   *  checks it only on created claims, and `measured` must not be derived from claim creation. */
  batteryRecorded: boolean;
  statement: ClaimStatement | null;
  /** The recorded battery's score fact, computed whether or not the claim was created: truth-verified and
   *  passed case counts. The candidate check's zero-verified clause reads this instead of a readiness
   *  clause — run23 (2026-08-30) paid a full 25-case comparison battery after a 0/25 measured variant because the refused
   *  claim carried `readiness: null`, so the readiness-clause predicate never saw the score. */
  batteryScore: BatteryScore;
  clauses: ClaimClause[];
  /** Null exactly when the claim was not created — readiness presupposes an honest measurement. */
  readiness: ReadinessVerdict | null;
  solvabilityFindings: ContractFinding[];
  evidencePath: string;
}

/** The recorded battery's truth-verified and passed counts — a measurement fact, not a claim decision. */
interface BatteryScore {
  verified: number;
  passed: number;
}

/** Claim evidence lives at `campaigns/<slug>/claims/<runId>.json`. These files stay
 *  outside the recorded run directories: a later write into runs/<runId>/ would be the
 *  recorded-evidence violation readiness checks for — so every consumer (write caller, analysis,
 *  curriculum reader) derives the location here instead of restating the join. */
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
 * The claim-time witness is the same probe the census gate ran before adoption, over the same
 * bundle snapshot. When its verifier produces no verdict the fact is recorded as a finding beside the
 * claim and readiness refuses on `no-solvability-witness`; the score stays recorded and the round
 * continues. Thrown, it ended a run: truss-run13-sol-0903 (2026-09-03) verified 25/25, then the
 * Builder's 30 s engine timed out once on a host at load 150 and the controller closed as
 * `controller-unclassified` with no claim written. The census gate settles the same event as a
 * repair owner (settleNonResult); a claim write is not a round boundary, so it only records it.
 *
 * An environment-owned kind (`sandbox`, `verifierUnavailable`) earns the one fresh execution the
 * census gate and the control runner already give it. run59-opus-0904 (2026-09-04) verified
 * 25/25 on its climb, then the witness's `/usr/bin/cc` re-attestation reported a changed signature
 * once; the claim lost readiness, the climb was held below current and the run ended with 774 of
 * 1320 turns unspent. An author-owned kind (timeout, crash) is recorded at once: it is the tool
 * the evaluator chose over inputs the artifact produced, and a second run says nothing new.
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

/** Check readiness using a constructive solvability witness over the immutable bundle snapshot
 *  and fresh verification of recorded evidence in the claim's run directory. Runs only for a created
 *  statement — readiness presupposes an honest measurement. */
async function readinessAtWrite(
  options: WriteRunClaimOptions,
  fingerprint: FingerprintEvidence & { taskSetHash: string },
  statement: ClaimStatement,
): Promise<{
  readiness: ReadinessVerdict;
  solvability: SolvabilityEvidence | null;
  solvabilityFindings: ContractFinding[];
}> {
  // The commitment key is run-scoped controller secret material; only its public keyId may
  // enter the evidence. Written fresh per write — reuse across runs would link commitments.
  const operandCommitment = {
    key: crypto.getRandomValues(new Uint8Array(32)),
    keyId: `${options.slug}-${options.runId}-operands`,
  };
  // The probe's children resolve source from disk; a drifted tree makes their witness
  // unattributable, so readiness fails closed on no-solvability-witness with the drift named.
  // Same binding as the F2 adoption gate; the comparison is owned by source-identity.
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

/** The bundleSnapshot the score actually executed under, from the recorded battery only: iteration
 *  analysis binds judge and guard work to this identity, so an unrecorded read here would let a
 *  tampered run dir name the bundleSnapshot for the whole analysis stage. */
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

/** Bundle identity comes from the recorded battery's executed bundleSnapshot; the fresh fingerprint must
 *  match it. A difference means the live tree changed between verification and claim writing:
 *  the claim would name bytes the score never ran under, so writing fails. */
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
  if (bundleSnapshot.taskSetHash === null) {
    throw new Error(
      `${slug}: the executed bundleSnapshot has no taskSetHash — a claim cannot pin a task set that was never recorded`,
    );
  }
  return /* SAFETY: the check above returned when `bundleSnapshot.taskSetHash === null`. */ bundleSnapshot as BundleSnapshotFact & {
    taskSetHash: string;
  };
}

/** Computed for every write, so a refused claim still discloses what the battery measured. */
function batteryScoreOf(score: readonly ScoredCase[]): BatteryScore {
  return {
    verified: score.filter((row) => row.truthVerified).length,
    passed: score.filter((row) => row.passed).length,
  };
}

/** The case ids whose recorded Judge verdict contradicts the verifier's on the same case, read from
 *  the same recorded run dir the score comes from. run51-sol-0902 created three claims reading
 *  `ok: true`, 18, 17 and 17 of 25, while every one of its 23 failures was a verifier-fail/
 *  Judge-pass row: a reader holding one claim saw nothing contested, and the join existed only in
 *  the analysis files written after the claim. The claim records the disputed case identifiers;
 *  disputes change no score, claim decision or promotion, and the directional
 *  counts stay where they already are, in the recorded battery's judge aggregate.
 *
 *  A case is a dispute only on two booleans that disagree. An absent, refused or non-boolean
 *  judge evidence — `judge: "off"`, an errored turn, a designed abstention — is not a dispute and
 *  the reader never guesses one from a directory layout. */
function disputedCaseIds(runDir: string, cases: readonly CaseRecord[]): string[] {
  const violations = verifyRunDir(runDir);
  const disputed: string[] = [];
  for (const row of cases) {
    if (!isBoolean(row.truthOk)) continue;
    const recorded = recordedEvidence(runDir, join("cases", row.taskId, CASE_JUDGE_FILE), violations);
    if (!recorded.ok) continue;
    // Unguarded parse is safe: recordedEvidence sha-checked the bytes, and EvidenceLog — the only
    // writer — serializes JsonValue, so non-JSON cannot arrive here.
    const parsed: unknown = capturedJsonParse(recorded.bytes);
    if (!isRecord(parsed) || !isBoolean(parsed.verdict) || parsed.verdict === row.truthOk) continue;
    disputed.push(row.taskId);
  }
  return disputed;
}

/**
 * The claim's evidence block, read from the recorded battery and the adopted tree: the battery's own
 * recorded evidence, the executed bundle hashes and the declared plus executed grounding.
 */
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
  // The claim reads the firing counts unconditionally; every battery the runner writes has them.
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
  // Read beside the score, from the same recorded bytes and before the readiness probe touches the
  // tree. Evidence beside the claim, never inside it: the promotion decision and the round's
  // terminal are settled after this write (the round measures, then promotes), so the claim names
  // only what is recorded when it is created.
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
        // The battery's run condition (U0.4), restated: the claim asserts no condition of its own.
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
