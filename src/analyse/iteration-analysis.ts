/**
 * The analysis packet: one IterationAnalysis derived from recorded evidence —
 * the executed bundleSnapshot, the case record's outcome counts, the claim file's verdict
 * clauses, the disclosed isolation and run condition. Code owns derivation, shape and admission;
 * the model provides diagnosis (the Main Judge's review is revalidated over this packet).
 *
 * Owner routing is not "every failure goes to an author session" (audit 2026-07-26, P2): only
 * findings about Builder-authored files may reopen author sessions; environment non-results stop and rerun
 * without changing the harness; genuine hardness enters the climb proposal path; a Judge
 * disagreement is advice only and never seeds an actionable finding.
 *
 * Admission checks that citations exist: the controller admits only findings whose cited evidence
 * exists on disk. A finding that cites nothing is refused, whatever produced it.
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
  /** Digest-bound evidence pointers copied verbatim from the case row. v2 carried bare paths,
   *  which dropped the sha256 at this boundary and left the trace-reading review unable to
   *  verify what it fed the model; v3 carries the pointer whole. */
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
   *  recorded battery's firing counts. Check ids are public authoring identities, so the count may
   *  reach the rebuild author; no task id does. */
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
 * Version of the severity and routing rules used to write feedback. A saved packet's
 * severities are only readable by a rule that would assign them the same way, so this is bumped
 * whenever a finding's severity or its route changes; readAdmission then reads a mismatched
 * packet as stating nothing instead of seeding the next build with a verdict the current rule
 * would not give. Same discipline as the isolation check result's fixture version: evidence names the rule
 * that produced it, and a reader never re-labels old bytes under a new rule.
 *
 * The motivating case was run 3: its packet marked the all-pass census blocking. That finding is now
 * advisory, and without this binding the stale row still outranked the difficulty selector's climb at
 * promotion — the exact misroute the severity change was made to end.
 *
 * Bumps 3 to 7 (2026-07-28 to 2026-08-17) tracked the paired-variant diagnosis rules: version
 * without advisers diagnoses became advisory, per-case claims were censored, the Repair Engineer
 * owned semantic clustering, hardness routed to the tests author.
 *
 * Bump 8 (2026-09-04): one battery per round and the Judge exit. A rule-7 packet carries Repair
 * Engineer hypotheses and Progress Guard / Epoch Reviewer rows whose producers no longer exist,
 * and lacks the `judge-verifier-dispute` route this rule adds; a rule-8 reader treats it as
 * stating nothing.
 *
 * 2026-09-14 removed the `judge-verifier-dispute` route without a bump, and 2026-09-18 the all-pass
 * advisory the same way: one fewer row each, and no row that stays changes severity or owner.
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
  /** Feedback severity when routed to an author session. Absent means blocking (a diagnosed
   *  defect demands reopening). Advisory is for disclosures whose next move belongs to a more
   *  calibrated owner — the difficulty selector outranks an advisory restatement during promotion. */
  severity?: "advisory";
  /** Per-case identity. A finding that carries one never reaches an author session: the no-hints rule
   *  protects failure locations for individual tasks. A finding without a subject routes
   *  per-finding as before. */
  subject?: { taskId: string; family: string };
  /** Public authoring identities the epoch reviewer may attach (rule 4): a declared check id, a
   *  dotted path under a declared artifactSchema root, a `$.`-prefixed public input path. They are
   *  the only finding detail that crosses into the public projection; the claim never does. */
  checkId?: string;
  artifactSchemaPath?: string;
  publicInputPath?: string;
  /** No declared check observes the obligation. ESP32 run 0dba8e's reviews named the nearest check
   *  for an unchecked sketch three times, and the Builder repaired that check each time. */
  unobserved?: true;
  /** What the reviewer's cited probes executed, composed only from public authoring identities
   *  (rule 7): an accept control the Builder wrote, a dotted path under a declared artifactSchema
   *  root, and the declared checks the one changed field moved. The probe row itself stays private
   *  — its replacement value is a generated counterexample and its `blockingCheckIds` is verifier
   *  detail — and these three identities are the same class the finding's own `checkId` and
   *  `artifactSchemaPath` already cross by.
   *
   *  Run esp32-opus-20260908T214013792Z-23a1bc is why this exists: `target-compiles` was named in
   *  three consecutive reviews, two of them forced blocking, each ordering a full rebuild of a
   *  25/25 harness, and "the defect persisted while the public projection supplied only its check
   *  name". A probe is the review's strongest evidence and it stopped at the boundary. */
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

/** The recorded firing field as a count map, or null when it is not one.
 *  Prototype-free like the verifier inventory: a check id spelled `__proto__` is a key, and on a
 *  plain object its assignment would reach the inherited setter and drop the count. */
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
 *  fail size===1, but they are different facts: zero rows means no case ran (a pre-spend-skipped
 *  battery), not that anything disagreed — esp32-opus-331 aborted on the disagreement sentence
 *  over an empty set ("disagree on isolation strength ()"). Callers stand the analyse phase down
 *  before reaching here on a zero-row battery; the first throw keeps that precondition loud and
 *  accurate for any future caller. */
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

/** Derive the packet from recorded evidence only. Refuse missing battery, record or claim data:
 *  the next iteration must respond to the measured product's evidence, and an incomplete or
 *  mismatched record could direct changes at the wrong version. */
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
      // The Judge review reads this packet: runJudgeReviews derives
      // its findings from these recorded bytes, so the packet itself stays evidence-only.
      "main-judge census: revalidated by runJudgeReviews over this packet, never folded into it",
      "prediction-resolution (#9)",
    ],
  };
}

/** Findings the host can state without model diagnosis, based on recorded counts.
 *  An all-verified-fail battery yields no deterministic finding (harness
 *  defect vs genuine hardness is the model's question; the rebuild advice packet carries the
 *  counts). An unaccepted case establishes only that no accepted submission exists; the reason
 *  stays the model's question, hence diagnosis-uncertain, never a proposed owner. */
export function hostFindings(repoRoot: string, analysis: IterationAnalysis): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];
  const record = join("campaigns", analysis.slug, CASE_RECORD_FILE);
  const unaccepted = analysis.cases.filter((row) => classifyCaseOutcome(row) === "unaccepted");
  if (unaccepted.length > 0) {
    // Safe totals only: no task ids or inferred cause. The claude-med run's 25 unaccepted cases
    // were confused with verified failures; Opus alt1 later exposed the unsupported admission cause.
    findings.push({
      kind: "diagnosis-uncertain",
      claim: `${unaccepted.length} of ${analysis.cases.length} attempt(s) produced no accepted submission and have no truth verdict; the counts alone do not establish why submission was absent`,
      evidence: record,
      proposedOwner: null,
      severity: "advisory",
    });
  }
  // Only a kind that may establish an environment failure earns "rerun unchanged": esp32 08c0f2 i02
  // told its Builder that six `verifier` non-results, external checks that ran no tool, were one.
  const nonResults = analysis.cases.filter(
    (row) =>
      row.runtimeNonResultKind !== null && ENVIRONMENT_OWNED_NONRESULT_KINDS.has(row.runtimeNonResultKind),
  ).length;
  // Settled beside the environment restatement so an escape by the Builder's own check is routed
  // to its owner instead of read as an environment fact (checker-unbound.ts).
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
  // An all-pass battery used to add an advisory harness-defect here, owner "tests". It said what
  // the measurement note says with a distance, a streak and a scope, under a kind naming a defect
  // the harness does not have and an owner the evidence had not chosen: the truss c1d2a7 packet
  // carried "6 or more found no limit", "no battery of this product has found a limit", "the last
  // 3 batteries all found no limit", "no family held" and this row, five statements of one fact
  // beside none of what to do instead. The climb readout owns "this battery found no limit".
  void repoRoot;
  return findings;
}

/** Which findings demand a reopen by default: a diagnosed defect is blocking unless the producer
 *  said advisory; hardness and disclosures, the Judge's included, stay advisory. */
export function findingSeverity(finding: AnalysisFinding): CampaignFeedback["severity"] {
  const defect = finding.kind === "harness-defect" || finding.kind === "curriculum-defect";
  return defect ? (finding.severity ?? "blocking") : "advisory";
}

/** Controller admission: shape is typed, citations must exist on disk, and only
 *  author-session findings become campaign feedback. Other findings stay disclosed in the
 *  recorded packet; aggregate no-route rows may also enter rebuild advice. */
export function admitFindings(
  repoRoot: string,
  analysis: IterationAnalysis,
  findings: AnalysisFinding[],
): AdmittedEvidence {
  const admitted: AnalysisFinding[] = [];
  const refused: AdmittedEvidence["refused"] = [];
  for (const finding of findings) {
    if (existsSync(join(repoRoot, finding.evidence))) {
      // `proposedOwner` stays exactly as the producer wrote it: it is that producer's proposal, and
      // the route it actually took is the owner on the feedback rows below.
      admitted.push(finding);
    } else {
      refused.push({ finding, reason: `cited evidence ${finding.evidence} does not exist` });
    }
  }
  // Content identity of the packet — what iteration N+1 records as consumed.
  const digest = hashJsonBytes(analysis);
  // Determine the route once per finding. A finding with no author session stays in the packet with
  // its typed reason instead of disappearing at the feedback partition.
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
    // The findings array is what the author input renders into the reopened prompt;
    // controller-marked so the author isolation admits it (an unmarked packet is refused there).
    findings: controllerValidatedFindings([
      { code: finding.kind, path: finding.evidence, detail: finding.claim },
    ]),
  }));
  return { digest, admitted, refused, feedback, findingRoutes };
}
