/**
 * The analysis packet: one IterationAnalysis derived from recorded evidence alone — the executed
 * bundle snapshot, the case record's outcome counts, the claim file's verdict clauses, the
 * disclosed isolation and the run condition. Code owns derivation, shape and admission, and models
 * supply only diagnosis; the Main Judge's review is revalidated over this packet rather than folded
 * into it.
 *
 * Owner routing is deliberately not "every failure goes to an author session". Only findings about
 * Builder-authored files may reopen one, because reopening is what costs a round: an environment
 * non-result is rerun with the harness unchanged, genuine hardness belongs to the climb, and a
 * Judge disagreement is advice that never seeds an actionable finding.
 *
 * Admission then checks that citations exist. A finding whose cited evidence is not on disk is
 * refused whatever produced it, so nothing reaches the next round on the strength of a pointer
 * nobody can follow.
 */
import { selectedProductDir } from "../run/product-versions.ts";
import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { isAbsolute, join, relative } from "../meta/path.ts";
import type { CampaignFeedback, FeedbackOwner } from "../author/campaign-types.ts";
import { authorSessionOwner } from "./finding-owner.ts";
import { ENVIRONMENT_OWNED_NONRESULT_KINDS } from "../claim/record-events.ts";
import { checkerUnboundFinding } from "./checker-unbound.ts";
import {
  CASE_RECORD_FILE,
  type CaseVerdict,
  caseVerdict,
  classifyCaseOutcome,
  readCaseRecord,
  type TracePointer,
} from "../claim/case-record.ts";
import { hashJsonBytes, parseJsonAs } from "../meta/json-runtime.ts";
import { claimsDirFor, executedBundleSnapshotFact } from "../run/claim-write.ts";
import { type RunSummary, assertRunIdSafe, summarizeRun } from "../run/run-driver.ts";
import { controllerValidatedFindings } from "../truth/brief.ts";
import { type BundleSnapshotFact, batteryPath } from "../truth/battery-record.ts";
import { isNumber, isRecord, isString } from "../meta/json-shape.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import type { NoRouteReason } from "./finding-owner.ts";

export type CaseEvidence = CaseVerdict & {
  taskId: string;
  family: string;
  /** Digest-bound trace pointers copied verbatim from the case row. An earlier schema carried bare
   *  paths, which dropped the sha256 at this boundary and left the trace-reading review unable to
   *  verify what it had fed the model; the pointer now crosses whole. */
  traces: TracePointer[];
};

export type BatteryEvidence = {
  runId: string;
  /** The run condition the claim file restates from its battery. */
  condition: { variant: string; advisorsRemoved: string[] };
  claimCreated: boolean;
  /** Blocking clause names when no claim was created; empty when it was. */
  claimClauses: string[];
  /** Readiness clause names; null exactly when no claim was created. */
  readinessClauses: string[] | null;
  /** The censored denominator — non-results never fabricate capability. */
  summary: RunSummary;
  /** checkId → verified failed cases whose verdict blocks on that declared check, copied from the
   *  battery's recorded firing counts. Check ids are public authoring identities, so the counts may
   *  reach the rebuild author; no task id travels with them. */
  blockingByCheck: Record<string, number>;
};

export type IterationAnalysis = {
  schema: "iteration-analysis/v4";
  slug: string;
  /** The one battery this round measured; the analysis files carry the same id. */
  runId: string;
  /** Repo-relative root of the exact measured tree: current or a held candidate. */
  treeRoot: string;
  identities: {
    bundleSnapshot: BundleSnapshotFact;
    backendPin: string;
    buildInputsHash: string;
    isolationStrength: string;
  };
  battery: BatteryEvidence;
  cases: CaseEvidence[];
  /** The analysis steps whose producers do not exist — stated, never implied as run. */
  absent: string[];
};

interface ClaimFileSlice {
  condition: { variant: string; advisorsRemoved: string[] };
  claim: { ok: boolean; clauses?: Array<{ clause?: string }> };
  readiness: { clauses: Array<{ clause?: string }> } | null;
}

/**
 * Version of the severity and routing rules that wrote a feedback packet. A saved packet's
 * severities are only readable by a rule that would have assigned them the same way, so this is
 * bumped whenever a finding's severity or its route changes; `readAdmission` then reads a packet
 * under any other version as stating nothing, instead of seeding the next build with a verdict the
 * current rule would not have given. Evidence names the rule that produced it, and a reader never
 * relabels old bytes under a new one.
 *
 * The motivating case was run 3, whose packet marked the all-pass census blocking. That finding is
 * advisory now, and without this binding the stale row still outranked the climb at promotion,
 * which is exactly the misroute the severity change had been made to end.
 */
export const FEEDBACK_POLICY = "severity-route/9-complete-repair-agenda";

/** The closed finding vocabulary the router understands. Producers are the host and the Judge
 *  review; routing depends on the finding kind, not its producer. */
export type AnalysisFindingKind =
  | "environment-non-result"
  | "harness-defect"
  | "curriculum-defect"
  | "controller-defect"
  | "hardness"
  | "diagnosis-uncertain"
  /** Judge/verifier disagreement: advice by family, never routed and never blocking. */
  | "judge-disagreement";

export type AnalysisFinding = {
  kind: AnalysisFindingKind;
  claim: string;
  /** Evidence pointer relative to repoRoot; admission requires it to exist on disk. */
  evidence: string;
  /** Author session proposal — consulted only for harness-defect findings. */
  proposedOwner: FeedbackOwner | null;
  /** Feedback severity when routed to an author session. Absent means blocking, because a
   *  diagnosed defect demands reopening; advisory is for disclosures whose next move belongs to a
   *  more calibrated owner, and an advisory restatement is outranked at promotion. */
  severity?: "advisory";
  /** Per-case identity. A finding that carries one never reaches an author session, because the
   *  no-hints rule protects the failure location of an individual task; a finding without a subject
   *  routes per-finding as usual. */
  subject?: { taskId: string; family: string };
  /** Public authoring identities the epoch reviewer may attach: a declared check id, a dotted path
   *  under a declared artifactSchema root, a `$.`-prefixed public input path. These are the only
   *  finding detail that crosses into the public projection, and the claim never does. */
  checkId?: string;
  artifactSchemaPath?: string;
  publicInputPath?: string;
  /** No declared check observes the obligation at all, so no existing check should be repaired for
   *  it. Run 0dba8e's reviews named the nearest check for an unchecked sketch three times, and the
   *  Builder dutifully repaired that check each time. */
  unobserved?: true;
  /** What the reviewer's cited probes executed, composed only from public authoring identities: an
   *  accept control the Builder wrote, a dotted path under a declared artifactSchema root, and the
   *  declared checks that the one changed field moved. The probe row itself stays private — its
   *  replacement value is a generated counterexample and its blocking check ids are verifier detail
   *  — and these three identities are the same class the finding's own `checkId` and
   *  `artifactSchemaPath` already cross by.
   *
   *  Opus run 23a1bc is why this field exists: `target-compiles` was named in three consecutive
   *  reviews, two of them forced blocking, each ordering a full rebuild of a 25-of-25 harness, and
   *  the defect persisted while the public projection supplied only its check name. A probe is the
   *  review's strongest evidence, and it was stopping at the boundary. */
  probes?: Array<{ controlId: string; path: string; movedCheckIds: string[] }>;
};

export interface AdmittedEvidence {
  digest: string;
  admitted: AnalysisFinding[];
  /** Refused with the reason attached — a dropped finding is disclosed, never silent. */
  refused: Array<{ finding: AnalysisFinding; reason: string }>;
  /** Author-session routed findings as campaign feedback for iteration N+1. */
  feedback: CampaignFeedback[];
  /** One controller-owned route result for every admitted finding, including no-route reasons. */
  findingRoutes: AdmissionFindingRoute[];
}

type AdmissionFindingRoute =
  | { findingDigest: string; kind: AnalysisFindingKind; owner: FeedbackOwner }
  | { findingDigest: string; kind: AnalysisFindingKind; owner: null; reason: NoRouteReason };

function batteryEvidence(
  repoRoot: string,
  slug: string,
  runId: string,
  summary: RunSummary,
  blockingByCheck: Record<string, number>,
): BatteryEvidence {
  const claimPath = join(claimsDirFor(repoRoot, slug), `${runId}.json`);
  if (!existsSync(claimPath)) {
    throw new Error(`${claimPath}: no claim evidence — analysis requires a completed measurement`);
  }
  const parsed = parseJsonAs<ClaimFileSlice>(readFileSync(claimPath, "utf8"));
  if (!isRecord(parsed.condition)) throw new Error(`${claimPath}: the claim records no run condition`);
  const clauseNames = (clauses: Array<{ clause?: string }> | undefined): string[] =>
    (clauses ?? []).map((c) => c.clause ?? "unnamed-clause");
  return {
    runId,
    condition: parsed.condition,
    claimCreated: parsed.claim.ok,
    claimClauses: parsed.claim.ok ? [] : clauseNames(parsed.claim.clauses),
    readinessClauses: parsed.readiness === null ? null : clauseNames(parsed.readiness.clauses),
    summary,
    blockingByCheck,
  };
}

/** The battery's recorded condition identity. */
function batteryIdentity(slugDir: string, runId: string) {
  const path = batteryPath(slugDir, runId);
  const parsed = parseJsonAs<{
    buildInputsHash?: string;
    backendPin?: string;
    truthCheckFiring?: { blockingByCheck?: unknown };
  }>(readFileSync(path, "utf8"));
  if (!isString(parsed.buildInputsHash) || !isString(parsed.backendPin)) {
    throw new Error(`${path}: battery evidence is missing buildInputsHash/backendPin`);
  }
  const blockingByCheck = blockingCounts(parsed.truthCheckFiring?.blockingByCheck);
  if (blockingByCheck === null) {
    throw new Error(`${path}: battery evidence records no truthCheckFiring.blockingByCheck count map`);
  }
  return { buildInputsHash: parsed.buildInputsHash, backendPin: parsed.backendPin, blockingByCheck };
}

/** The recorded firing field as a count map, or null when it is not one. It is prototype-free like
 *  the verifier inventory, because on a plain object a check id spelled `__proto__` would reach the
 *  inherited setter instead of becoming a key, and the count would silently vanish. */
export function blockingCounts(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, number> = Object.create(null);
  for (const [checkId, count] of Object.entries(value)) {
    if (!isNumber(count) || !Number.isInteger(count) || count < 0) return null;
    out[checkId] = count;
  }
  return out;
}

/** The one isolation strength every case row disclosed. An empty set and a conflicting set both
 *  fail `size === 1`, but they are different facts and so get different messages: zero rows means
 *  no case ran, as on a battery skipped before spend, rather than that anything disagreed — run
 *  opus-331 aborted on the disagreement sentence over an empty set, printing "disagree on isolation
 *  strength ()". Callers stand the analyse phase down before reaching here on a zero-row battery,
 *  and the first throw keeps that precondition loud and accurate for any future caller. */
function disclosedIsolationStrength(
  slug: string,
  runId: string,
  mine: ReadonlyArray<{ isolation?: { strength?: string } | null }>,
): string {
  const strengths = new Set(mine.map((row) => row.isolation?.strength ?? "UNPROVEN"));
  if (strengths.size === 0) {
    throw new Error(
      `${slug}/${runId}: the battery recorded zero case rows — there is nothing to analyse, and the caller should have stood the analyse phase down`,
    );
  }
  if (strengths.size > 1) {
    throw new Error(
      `${slug}/${runId}: ${String(mine.length)} case rows disagree on isolation strength (${[...strengths].join(", ")}) — one battery must have one disclosed isolation level`,
    );
  }
  return /* SAFETY: both throws above leave exactly one distinct strength in the set. */ [
    ...strengths,
  ][0] as string;
}

/** Derive the packet from recorded evidence only, and refuse missing battery, record or claim data
 *  rather than deriving a partial packet from what is there. The next iteration must respond to the
 *  measured product's evidence, and an incomplete or mismatched record could direct its changes at
 *  the wrong version of the harness. */
export function deriveIterationAnalysis(
  repoRoot: string,
  slug: string,
  runId: string,
  measuredDir = selectedProductDir(repoRoot, slug),
): IterationAnalysis {
  assertRunIdSafe(runId);
  const treeRoot = relative(repoRoot, measuredDir);
  if (treeRoot === "" || treeRoot.startsWith("..") || isAbsolute(treeRoot)) {
    throw new Error(`${measuredDir}: measured tree must stay inside the repository`);
  }
  const bundleSnapshot = executedBundleSnapshotFact(measuredDir, runId);
  const battery = batteryIdentity(measuredDir, runId);
  const rows = readCaseRecord(join(campaignDir(repoRoot, slug), CASE_RECORD_FILE)).map((e) => e.row);
  const mine = rows.filter((row) => row.runId === runId);
  const isolationStrength = disclosedIsolationStrength(slug, runId, mine);
  const cases: CaseEvidence[] = mine.map((row) => ({
    taskId: row.taskId,
    family: row.family,
    ...caseVerdict(row),
    traces: row.traces,
  }));
  return {
    schema: "iteration-analysis/v4",
    slug,
    runId,
    treeRoot,
    identities: {
      bundleSnapshot,
      backendPin: battery.backendPin,
      buildInputsHash: battery.buildInputsHash,
      isolationStrength,
    },
    battery: batteryEvidence(repoRoot, slug, runId, summarizeRun(runId, rows), battery.blockingByCheck),
    cases,
    absent: [
      "main-judge census: revalidated by runJudgeReviews over this packet, never folded into it",
      "prediction-resolution (#9)",
    ],
  };
}

/** Findings the host can state without model diagnosis, from recorded counts alone. An
 *  all-verified-fail battery yields no deterministic finding here, because whether that is a
 *  harness defect or genuine hardness is the model's question and the rebuild advice packet carries
 *  the counts either way. An unaccepted case establishes only that no accepted submission exists,
 *  so it is recorded as `diagnosis-uncertain` and never proposes an owner. */
export function hostFindings(repoRoot: string, analysis: IterationAnalysis): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];
  const record = join("campaigns", analysis.slug, CASE_RECORD_FILE);
  const unaccepted = analysis.cases.filter((row) => classifyCaseOutcome(row) === "unaccepted");
  if (unaccepted.length > 0) {
    // Safe totals only: no task ids and no inferred cause. The claude-med run's 25 unaccepted cases
    // were read as verified failures, and an Opus rerun later exposed the unsupported cause that
    // reading had been admitted under.
    findings.push({
      kind: "diagnosis-uncertain",
      claim: `${unaccepted.length} of ${analysis.cases.length} attempt(s) produced no accepted submission and have no truth verdict; the counts alone do not establish why submission was absent`,
      evidence: record,
      proposedOwner: null,
      severity: "advisory",
    });
  }
  // Only a kind that can establish an environment failure earns "rerun unchanged": run 08c0f2 i02
  // told its Builder that six `verifier` non-results — external checks that ran no tool at all —
  // were one of those, and they were the harness's own.
  const nonResults = analysis.cases.filter(
    (row) =>
      row.runtimeNonResultKind !== null && ENVIRONMENT_OWNED_NONRESULT_KINDS.has(row.runtimeNonResultKind),
  ).length;
  // Settled beside the environment restatement, so a non-result the Builder's own check caused is
  // routed to that owner instead of being read as an environment fact (checker-unbound.ts).
  const checkerOutage = checkerUnboundFinding(repoRoot, analysis);
  if (nonResults > 0) {
    findings.push({
      kind: "environment-non-result",
      claim: `${nonResults} case(s) ended in environment-owned runtime non-results — censored from the denominator; ${
        checkerOutage === null
          ? "rerun without changing the harness"
          : "part of them are the check's own unbound results, routed to their owner beside this note; repair before rerunning"
      }`,
      evidence: record,
      proposedOwner: null,
    });
  }
  if (checkerOutage !== null) findings.push(checkerOutage);
  // An all-pass battery used to add an advisory harness-defect here with owner "tests". It said
  // what the measurement note already says, but with a distance, a streak and a scope, under a kind
  // naming a defect the harness does not have and an owner the evidence had not chosen: the truss
  // c1d2a7 packet carried "6 or more found no limit", "no battery of this product has found a
  // limit", "the last 3 batteries all found no limit", "no family held" and that row — five
  // statements of one fact, beside none of what to do instead. The climb readout owns the sentence
  // "this battery found no limit".
  return findings;
}

/** Which findings demand a reopen by default: a diagnosed defect is blocking unless its producer
 *  explicitly said advisory, while hardness and every disclosure, the Judge's included, stay
 *  advisory because their next move belongs to someone better calibrated than the finding. */
export function findingSeverity(finding: AnalysisFinding): CampaignFeedback["severity"] {
  const defect = finding.kind === "harness-defect" || finding.kind === "curriculum-defect";
  return defect ? (finding.severity ?? "blocking") : "advisory";
}

/** Controller admission: the shape is typed, the citations must exist on disk, and only findings
 *  that route to an author session become campaign feedback. Everything else stays disclosed in the
 *  recorded packet with its typed no-route reason rather than disappearing at the partition, and an
 *  aggregate no-route row may still enter rebuild advice from there. */
export function admitFindings(
  repoRoot: string,
  analysis: IterationAnalysis,
  findings: AnalysisFinding[],
): AdmittedEvidence {
  const admitted: AnalysisFinding[] = [];
  const refused: AdmittedEvidence["refused"] = [];
  for (const finding of findings) {
    if (existsSync(join(repoRoot, finding.evidence))) {
      admitted.push(finding);
    } else {
      refused.push({ finding, reason: `cited evidence ${finding.evidence} does not exist` });
    }
  }
  // Content identity of the packet — what iteration N+1 records as consumed.
  const digest = hashJsonBytes(analysis);
  const routed: Array<{ finding: AnalysisFinding; owner: FeedbackOwner }> = [];
  const findingRoutes: AdmissionFindingRoute[] = [];
  for (const finding of admitted) {
    const route = authorSessionOwner(finding);
    const findingDigest = hashJsonValue(finding);
    if (route.owner === null) {
      findingRoutes.push({ findingDigest, kind: finding.kind, owner: null, reason: route.reason });
    } else {
      findingRoutes.push({ findingDigest, kind: finding.kind, owner: route.owner });
      routed.push({ finding, owner: route.owner });
    }
  }
  const feedback: CampaignFeedback[] = routed.map(({ finding, owner }) => ({
    owner,
    severity: findingSeverity(finding),
    claim: finding.claim,
    evidence: `${finding.evidence} (analysis ${digest.slice(0, 12)})`,
    // This array is what the author input renders into the reopened prompt, so it is
    // controller-marked for the author isolation to admit it; an unmarked packet is refused there.
    findings: controllerValidatedFindings([
      { code: finding.kind, path: finding.evidence, detail: finding.claim },
    ]),
  }));
  return { digest, admitted, refused, feedback, findingRoutes };
}
