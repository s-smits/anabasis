/**
 * Writes one claim record for one recorded battery, using `Claim.create` and `assessReadiness`: the
 * step that turns measured case rows into a statement saying what was proved and under which bytes.
 *
 * A write takes a run identity and nothing else. It rebuilds the claim input from the recorded
 * battery, then adds `bundles` from a fresh fingerprint of the same tree and `grounding` from the
 * validated brief joined with recorded execution. Process memory never crosses this boundary: a
 * score still held in a caller's variables would be a second evidence owner, and the bytes on disk
 * are what the claim is about.
 *
 * Readiness is checked here rather than inherited from the round. The solvability witness reruns
 * over the immutable bundle snapshot, which drives the generated reference solve and so costs no
 * model call, and the recorded evidence in the run directory is verified again. Conformance evidence
 * arrives from the caller or stays null, and null yields `conformance-unprobed`, because absent
 * evidence cannot establish that the generated tool contract was ever probed.
 *
 * The claim file goes under `campaigns/<slug>/claims/`, outside the run directory, since a write
 * into `runs/<runId>/` after the battery closed is itself the recorded-evidence violation that the
 * readiness verdict checks for.
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
  /** A probe the caller already holds; tests pass a double. It takes the same interface the F2
   *  adoption gate's probe takes, so the claim-time witness and the pre-adoption one cannot drift
   *  into asking different questions of one bundle. */
  probeSolvability?: BuildDeps["probeSolvability"];
  /** Pause before the one fresh execution an environment-owned tool non-result earns; tests pass 0
   *  so they do not sleep. Absent, `toolRetryDelay` supplies the shared `TOOL_RETRY_DELAY_MS`. */
  toolRetryWaitMs?: number;
}

export interface WrittenRunClaim {
  runId: string;
  /** True when Claim.create created a claim; false carries the complete blocking-clause list. */
  created: boolean;
  /** Whether the run's recorded evidence verifies, independently of the claim decision. Computed on
   *  every write because the round's terminal denominators and `shippingBundleFor` both read it, and
   *  readiness checks the same directory only on a created claim: deriving this from claim creation
   *  would leave a refused claim looking unmeasured. */
  batteryRecorded: boolean;
  statement: ClaimStatement | null;
  /**
   * Verified and passed case counts, computed whether or not the claim was created. Promotion's
   * `candidate-zero-verified` clause reads this rather than a readiness clause: a refused claim
   * carries `readiness: null`, so a predicate looking for the zero-verified clause would see no
   * score at all and let a zero-verified candidate through to a paid comparison battery.
   */
  batteryScore: BatteryScore;
  clauses: ClaimClause[];
  /** Null exactly when the claim was not created, since readiness presupposes a measurement
   *  honest enough to make a statement about. */
  readiness: ReadinessVerdict | null;
  solvabilityFindings: ContractFinding[];
  evidencePath: string;
}

/** The recorded battery's truth-verified and passed counts: a measurement fact, not a decision
 *  about it. */
interface BatteryScore {
  verified: number;
  passed: number;
}

/** Claim evidence lives at `campaigns/<slug>/claims/<runId>.json`, outside the recorded run
 *  directories, since a later write into `runs/<runId>/` is the recorded-evidence violation
 *  readiness checks for. Every consumer — the measure step that writes, the build step, iteration
 *  analysis and the next move's climb reader — derives the location here, so the rule has one owner. */
export function claimsDirFor(repoRoot: string, slug: string): string {
  return join(campaignDir(repoRoot, slug), "claims");
}

/** The adopted tree's brief, revalidated at write time rather than trusted because it validated at
 *  adoption. The grounding block below is composed from `truthChecks`, so a brief that no longer
 *  validates would have the claim declaring checks whose shape nobody has confirmed. */
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
 * Runs the claim-time solvability witness: the same probe the census gate ran before adoption,
 * over the same bundle snapshot.
 *
 * When its verifier produces no verdict the fact is recorded as a finding beside the claim and
 * readiness refuses on `no-solvability-witness`, so the score stays recorded and the round
 * continues. Throwing instead would end the run with no claim written at all, discarding a battery
 * that had already been measured because the Builder's engine timed out once on a loaded host. The
 * census gate settles the same event as a repair owner in `settleNonResult`, because a gate is a
 * round boundary and can route it; a claim write is not, so it only records what happened.
 *
 * An environment-owned kind — `sandbox` or `verifierUnavailable`, the two in
 * `ENVIRONMENT_OWNED_TOOL_NON_RESULT_KINDS` — earns the one fresh execution the census gate and the
 * control runner already give it, because a single changed tool signature on a re-attestation would
 * otherwise cost a fully verified battery its readiness. An author-owned kind, `timeout` or `crash`,
 * is recorded on the first attempt: it is the evaluator's own tool over inputs the artifact
 * produced, and a second run says nothing new.
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

/** Readiness from a fresh solvability witness over the immutable bundle snapshot and a fresh
 *  verification of the recorded evidence in the claim's own run directory. It runs only for a
 *  created statement, because readiness asks whether a measurement can be relied on and a claim
 *  that was refused has no measurement to ask about. */
async function readinessAtWrite(
  options: WriteRunClaimOptions,
  fingerprint: FingerprintEvidence & { taskSetHash: string },
  statement: ClaimStatement,
): Promise<{
  readiness: ReadinessVerdict;
  solvability: SolvabilityEvidence | null;
  solvabilityFindings: ContractFinding[];
}> {
  // The commitment key is controller secret material scoped to this write. Only its public `keyId`
  // reaches the evidence — `makeProbeSolvability` records `operandCommitmentKeyId` and nothing else
  // — and the key is drawn fresh rather than reused, because one key across writes would make
  // commitments from different runs linkable to each other.
  const operandCommitment = {
    key: crypto.getRandomValues(new Uint8Array(32)),
    keyId: `${options.slug}-${options.runId}-operands`,
  };
  // The probe's children resolve source from disk rather than from this process, so a tree that
  // moved under them leaves a witness nobody can attribute to particular bytes; readiness then fails
  // closed on `no-solvability-witness` with the drift named beside it. `sourceStillFrozen` owns the
  // comparison and measures both moments against the identity captured at process start rather than
  // against each other, so the check before probing and the check after it ask the same question.
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

/** The bundleSnapshot the score actually executed under, read from the recorded battery and nowhere
 *  else. The iteration-analysis packet stamps its `identities.bundleSnapshot` from here and every
 *  case and Judge review it carries hangs off that identity, so a reader taking the live tree's word
 *  would let a tree edited after the battery name the bundleSnapshot for the whole analysis stage. */
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

/** Bundle identity comes from the recorded battery's executed bundleSnapshot, and the fresh
 *  fingerprint has to match it. A difference means the live tree changed between verification and
 *  claim writing, which would leave the claim naming bytes the score never ran under, so the write
 *  fails. */
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

/**
 * The case ids whose recorded Judge verdict contradicts the verifier's on the same case, read from
 * the same recorded run directory the score comes from.
 *
 * Without this, the join between the two verdicts exists only in the analysis files written after
 * the claim, so a claim can read `ok: true` while every one of its failures is a verifier-fail
 * against a Judge-pass and the reader sees nothing contested. It records the identifiers alone:
 * disputes change no score, no claim decision and no promotion, and the directional counts stay
 * where they already live, in the recorded battery's Judge aggregate.
 *
 * A case is a dispute only when two booleans disagree. Absent, refused or non-boolean Judge evidence
 * — `judge: "off"`, an errored turn, a designed abstention — is not a disagreement, and this reader
 * never infers one from a directory layout.
 */
function disputedCaseIds(runDir: string, cases: readonly CaseRecord[]): string[] {
  const violations = verifyRunDir(runDir);
  const disputed: string[] = [];
  for (const row of cases) {
    if (!isBoolean(row.truthOk)) continue;
    const recorded = recordedEvidence(runDir, join("cases", row.taskId, CASE_JUDGE_FILE), violations);
    if (!recorded.ok) continue;
    // An unguarded parse is safe here: `recordedEvidence` sha-checked these bytes, and the evidence
    // log is their only writer and serialises JsonValue, so non-JSON cannot arrive.
    const parsed: unknown = capturedJsonParse(recorded.bytes);
    if (!isRecord(parsed) || !isBoolean(parsed.verdict) || parsed.verdict === row.truthOk) continue;
    disputed.push(row.taskId);
  }
  return disputed;
}

/** The claim's evidence block, read from the recorded battery and the adopted tree: the battery's
 *  own recorded evidence, the executed bundle hashes, and grounding as both declared in the brief
 *  and executed during the run. Declared and executed are carried separately because a check naming
 *  an external tool and a check whose tool actually ran are different facts, and the claim's
 *  grounding clauses are where that difference has to be visible. */
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
  // Read beside the score, from the same recorded bytes and before the readiness probe touches
  // the tree. It is evidence beside the claim rather than inside it, because the promotion
  // decision and the round's terminal are settled after this write — the round measures, then
  // promotes — so the claim can only name what is already recorded when it is created.
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
        // The battery's own run condition, restated here: the claim asserts no condition of its
        // own, so a reader comparing two claims is comparing what the batteries were measured
        // under rather than what the claim writer thought they were.
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
