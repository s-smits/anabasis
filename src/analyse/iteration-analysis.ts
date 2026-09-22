/**
 * The analysis packet: one IterationAnalysis derived from recorded evidence (the executed bundle
 * snapshot, case outcomes, claim clauses, disclosed isolation and run condition). Code owns
 * derivation, shape and admission; models supply diagnosis.
 *
 * Only findings about Builder-authored files may reopen an author session. Environment
 * non-results rerun without changing the harness, hardness goes to the climb, and a Judge
 * disagreement is advice only.
 *
 * Admission accepts only findings whose cited evidence exists on disk.
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
  /** Digest-bound trace pointers copied verbatim from the case row, so readers can verify them. */
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
  /** checkId → verified failed cases blocked by that check, from the battery's firing counts.
   *  Check ids are public, so these counts may reach the rebuild author. */
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
 * Version of the severity and routing rules that wrote a feedback packet. Bump it whenever a
 * finding's severity or route changes: a reader treats a packet under another version as stating
 * nothing, rather than relabelling old findings under the current rules.
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
  /** Severity when routed to an author session; absent means blocking. */
  severity?: "advisory";
  /** Per-case identity. A finding carrying one never reaches an author session, which protects
   *  per-task failure locations. */
  subject?: { taskId: string; family: string };
  /** Public authoring identities the epoch reviewer may attach: a declared check id, a dotted
   *  path under an artifactSchema root, a `$.` public input path. They are the only finding
   *  detail in the public projection; the claim never is. */
  checkId?: string;
  artifactSchemaPath?: string;
  publicInputPath?: string;
  /** The fixed host rule that produced this finding, for the findings a rule produced rather than
   *  a model observed. It names the subject the way `checkId` does, and it is what makes recurrence
   *  supportable for a host finding that names no check: the same rule fired again, which is an
   *  observation, where two free-text observations resembling one another is an inference. A
   *  model-produced finding never carries one. */
  hostRule?: string;
  /** No declared check observes the obligation, so no existing check should be repaired for it. */
  unobserved?: true;
  /** What the cited probes executed, in public authoring identities only: the accept control,
   *  the path, and the declared checks that moved. The replacement value and blocking checks
   *  stay private. */
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

/** The subject one finding named, in the public authoring identities it carries: its declared
 *  check, else the host rule that produced it, else a path naming a place *below* a declared root.
 *  Null when it names none of them, because two findings that name nothing cannot be told apart,
 *  and a key that cannot tell them apart is worse than none — it merges unrelated defects into one
 *  recurrence.
 *
 *  This is a naming, not a defect identity, and the difference is the whole of what it may be used
 *  for. Two reviews naming one check is evidence that they concern one defect; it is not proof,
 *  because two defects can name the same check. `recurringDefects` and the advice packet both draw
 *  that inference, and both own it — this function establishes only that the same subject was
 *  named twice, under the conditions its callers bind it to.
 *
 *  A bare root is not a naming. The reviewer's `schemaPath` rule requires only that the first
 *  segment be a declared `artifactSchema` root, so a domain whose schema has one root offers one
 *  bare word for any place in its artifact. Across the recorded epoch reviews 5,406 findings named
 *  a bare root against 3,196 naming a path below one, and in all nine campaigns where an
 *  unnamed-check harness defect fell back to a path the bare roots collapsed to a single constant.
 *  Run 17f9de put 2,448 findings on the one root `files`, so a floating-point rule, a header
 *  contract and a pin binding shared one identity: i03's new peripheral finding arrived carrying
 *  two recurrences it had nothing to do with and was demoted by them, and the same collapse at
 *  one recurrence is the 23a1bc failure of resetting a working harness.
 *
 *  The check is preferred over the path because one defect's artifact location may differ between
 *  reviews of it. Run bdd329 named check `change-budget` at path `members` and then at no path,
 *  and escalation read one check named twice as two defects. */
export function namedSubject(finding: {
  checkId?: string | null;
  artifactSchemaPath?: string | null;
  hostRule?: string | null;
}): string | null {
  const path = finding.artifactSchemaPath ?? null;
  return finding.checkId ?? finding.hostRule ?? (path?.includes(".") === true ? path : null);
}

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

/** The recorded firing field as a prototype-free count map, or null when it is not one. Without a
 *  prototype, a check id such as `__proto__` stays an ordinary key. */
export function blockingCounts(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, number> = Object.create(null);
  for (const [checkId, count] of Object.entries(value)) {
    if (!isNumber(count) || !Number.isInteger(count) || count < 0) return null;
    out[checkId] = count;
  }
  return out;
}

/** The one isolation strength every case row disclosed. No rows and disagreeing rows are
 *  different failures and throw with different messages. */
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

/** Derive the packet from recorded evidence only, refusing missing battery, record or claim data
 *  so the next iteration never acts on the wrong version. */
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

/** Findings the host can state from recorded counts alone. Why cases failed or went unaccepted is
 *  a question for diagnosis, so no finding here proposes an owner from outcomes. */
export function hostFindings(repoRoot: string, analysis: IterationAnalysis): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];
  const record = join("campaigns", analysis.slug, CASE_RECORD_FILE);
  const unaccepted = analysis.cases.filter((row) => classifyCaseOutcome(row) === "unaccepted");
  if (unaccepted.length > 0) {
    // Totals only: no task ids and no inferred cause.
    findings.push({
      kind: "diagnosis-uncertain",
      claim: `${unaccepted.length} of ${analysis.cases.length} attempt(s) produced no accepted submission and have no truth verdict; the counts alone do not establish why submission was absent`,
      evidence: record,
      proposedOwner: null,
      severity: "advisory",
      hostRule: "unaccepted-without-verdict",
    });
  }
  // Only environment-owned non-result kinds earn "rerun unchanged".
  const nonResults = analysis.cases.filter(
    (row) =>
      row.runtimeNonResultKind !== null && ENVIRONMENT_OWNED_NONRESULT_KINDS.has(row.runtimeNonResultKind),
  ).length;
  // Non-results the Builder's own check caused are routed to their owner, not read as environment.
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
  return findings;
}

/** A harness or curriculum defect is blocking unless its producer said advisory; every other kind
 *  is advisory. */
export function findingSeverity(finding: AnalysisFinding): CampaignFeedback["severity"] {
  const defect = finding.kind === "harness-defect" || finding.kind === "curriculum-defect";
  return defect ? (finding.severity ?? "blocking") : "advisory";
}

/** Admit findings whose cited evidence exists on disk, and turn those routed to an author session
 *  into campaign feedback. Every admitted finding gets a route row, with a reason when unrouted. */
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
    // Controller-marked, because the author boundary refuses unmarked findings.
    findings: controllerValidatedFindings([
      { code: finding.kind, path: finding.evidence, detail: finding.claim },
    ]),
  }));
  return { digest, admitted, refused, feedback, findingRoutes };
}
