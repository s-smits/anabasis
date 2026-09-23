/**
 * The issue register a continuing author reads about its product, derived from the rows the round
 * already wrote.
 *
 * An issue is three recorded facts: `absentBatteries` counts batteries in which its family ran
 * without it, `returned` says the latest observation followed an absence, and `retired` says the
 * family left the task set. `issueStatusWord` derives the status word from them. Issue identity is
 * `kind + family + detail`, so one issue can be followed across a rebuild.
 *
 * Two fields come from the review readers: `diagnosis` (the diagnosis reader's causal claim) and
 * `dispute` (the epoch reviewer's argument that the issue belongs to the evaluation). They attach
 * through `attachIssueReadings` and change no count or decision.
 *
 * `renderRebuildAdvice` is the model-visible boundary, bounded by `RENDERED_ISSUES`,
 * `RENDERED_FINDINGS` and `FINDING_CLAIM_CHARS`. Diagnosis prose never crosses into authoring.
 */
import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { authorSessionOwner } from "../analyse/finding-owner.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { join } from "../meta/path.ts";
import { sha256 } from "../meta/digest.ts";
import { canonicalJson } from "../meta/stable-json.ts";
import { hashJsonBytes, parseJsonAs } from "../meta/json-runtime.ts";
import { familyTally } from "../claim/case-record.ts";
import { ENVIRONMENT_OWNED_NONRESULT_KINDS, isNonResultKind } from "../claim/record-events.ts";
import type { FeedbackOwner } from "./campaign-types.ts";
import { ownerTarget } from "./feedback-routing.ts";
import {
  findingSeverity,
  namedSubject,
  type AdmittedEvidence,
  type AnalysisFinding,
  type IterationAnalysis,
} from "../analyse/iteration-analysis.ts";
import type { JudgeReviewsResult } from "../analyse/judge-reviews.ts";
import { keyIfDefined } from "../meta/optional-key.ts";

export const REBUILD_ADVICE_SCHEMA = "rebuild-advice/v4";
const REBUILD_ADVICE_LATEST = "rebuild-advice-latest.json";

/** Batteries of recorded absence after which a fix reads as confirmed rather than tentative. */
const CONFIRMED_FIXED_AFTER = 2;

/** What a battery can say about a family without naming a task. */
type AdviceIssueKind =
  /** Truth-verified cases the verifier failed. */
  | "verified-fail"
  /** Attempts with no accepted submission; the count alone establishes no cause. */
  | "unaccepted"
  /** Typed runtime non-results, by host-created kind. */
  | "non-result"
  /** The Judge passed what the verifier failed: advice to inspect the evaluator. */
  | "judge-passed-verifier-failed"
  /** The Judge failed what the verifier passed: a disclosure about the verifier's accept. */
  | "judge-failed-verifier-passed";

/** A reader's causal claim about one issue, with the observation that would refute it. */
export type IssueDiagnosis = {
  /** What made this family fail. */
  cause: string;
  /** The observation that would show the cause is wrong. */
  falsifier: string;
  /** First observed failure boundary, compared with a passing trace only when one was supplied. */
  firstDivergence: string;
  /** The authoring area the reader believes owns the cause. Advisory: it never selects a route. */
  interventionClass: FeedbackOwner;
  /** What a passing case of the same family did differently; null when the family had none. */
  contrastSuccess: string | null;
  confidence: "low" | "medium" | "high";
  /** The battery whose traces the diagnosis was read from. */
  runId: string;
};

export type AdviceIssue = {
  /** sha256 over kind, family and detail — stable across epochs and harnesses. */
  id: string;
  kind: AdviceIssueKind;
  family: string;
  /** The non-result kind; null for every other issue kind. */
  detail: string | null;
  /** Cases showing the issue in the battery that last observed it, over that family's denominator. */
  count: number;
  denominator: number;
  firstSeenRunId: string;
  lastSeenRunId: string;
  /** Batteries since `lastSeenRunId` in which the family ran and the issue was absent; zero when
   *  the latest battery observed it. A family that did not run cannot age its issues. */
  absentBatteries: number;
  /** The latest observation followed an absence: the issue came back. */
  returned: boolean;
  /** The family left the task set, so this battery could not observe the issue. Retirement proves
   *  no fix. */
  retired: boolean;
  /** The diagnosis reader's causal claim; null when none was read. Carried forward while the issue
   *  lives. */
  diagnosis: IssueDiagnosis | null;
  /** The epoch reviewer's argument that this failure belongs to the evaluation. A disputed issue is
   *  still counted; the dispute only withholds agent advice. */
  dispute: string | null;
};

type AdviceFamilyRow = {
  family: string;
  verified: number;
  passed: number;
  unaccepted: number;
  nonResults: number;
};

type AdviceFinding = {
  kind: AnalysisFinding["kind"];
  claim: string;
  severity: "blocking" | "advisory";
  /** Public identities retained only to key repeated unowned diagnosis findings. `hostRule` is
   *  carried because `recurrence` reads the previous packet's own findings: dropped here, a host
   *  finding's run of consecutive packets restarts at one every round. */
  checkId?: string;
  artifactSchemaPath?: string;
  hostRule?: string;
  /** Set from the second consecutive packet carrying the same unowned diagnosis. */
  repeated?: { count: number; since: string };
};

export type RebuildAdvicePacket = {
  schema: typeof REBUILD_ADVICE_SCHEMA;
  slug: string;
  runId: string;
  analysisDigest: string;
  /** The battery, one row per family; totals are derived from these rows. */
  families: AdviceFamilyRow[];
  /** Verified failures per declared check, as the battery recorded them. */
  blockingByCheck: Record<string, number>;
  /** Verified cases each declared check applied to: the denominator the line above is read
   *  against, and the difference between a rule that let 25 artifacts through and one no task
   *  posed. */
  applicableByCheck: Record<string, number>;
  issues: AdviceIssue[];
  judge: { exit: JudgeReviewsResult["exit"]["kind"]; reason: string; contestedFamilies: string[] } | null;
  /** The admitted findings a rebuild may read: aggregate rows only, no per-case subject. */
  findings: AdviceFinding[];
};

type Observed = {
  kind: AdviceIssueKind;
  family: string;
  detail: string | null;
  count: number;
  denominator: number;
};

/** Render bounds that keep the packet at a few thousand characters; the register still records
 *  everything. Six matches the standing issues the diagnosis reader offers. */
const RENDERED_ISSUES = 6;
const RENDERED_FINDINGS = 4;
const FINDING_CLAIM_CHARS = 600;

/** An issue this battery observed, that nothing disputes and whose family is still in the task
 *  set. */
export function isStanding(issue: AdviceIssue): boolean {
  return !issue.retired && issue.dispute === null && issue.absentBatteries === 0;
}

/** The status word for one issue's recorded facts. */
export function issueStatusWord(issue: AdviceIssue): string {
  if (issue.retired) return "retired";
  if (issue.dispute !== null) return "disputed";
  if (issue.absentBatteries === 0) return issue.returned ? "regressed" : "active";
  return issue.absentBatteries >= CONFIRMED_FIXED_AFTER ? "confirmed-fixed" : "tentatively-fixed";
}

export function adviceIssueId(kind: AdviceIssueKind, family: string, detail: string | null): string {
  return sha256(canonicalJson({ kind, family, detail }));
}

/** The battery's totals over its family rows. */
export function adviceTotals(families: readonly AdviceFamilyRow[]) {
  const sum = (read: (row: AdviceFamilyRow) => number) =>
    families.reduce((total, row) => total + read(row), 0);
  return {
    verified: sum((row) => row.verified),
    passed: sum((row) => row.passed),
    unaccepted: sum((row) => row.unaccepted),
    nonResults: sum((row) => row.nonResults),
  };
}

function familyRows(analysis: IterationAnalysis): AdviceFamilyRow[] {
  return [...familyTally(analysis.cases)]
    .map(([family, { verified, passed, unaccepted, nonResults }]) => ({
      family,
      verified,
      passed,
      unaccepted,
      nonResults,
    }))
    .sort((a, b) => a.family.localeCompare(b.family));
}

/** Every issue the battery shows, family by family. A count of zero is not an issue. */
function observedIssues(
  analysis: IterationAnalysis,
  judges: JudgeReviewsResult,
  families: AdviceFamilyRow[],
): Observed[] {
  const out: Observed[] = [];
  for (const family of families) {
    const total = family.verified + family.unaccepted + family.nonResults;
    const failed = family.verified - family.passed;
    if (failed > 0) {
      out.push({
        kind: "verified-fail",
        family: family.family,
        detail: null,
        count: failed,
        denominator: family.verified,
      });
    }
    if (family.unaccepted > 0) {
      out.push({
        kind: "unaccepted",
        family: family.family,
        detail: null,
        count: family.unaccepted,
        denominator: total,
      });
    }
    const byKind = new Map<string, number>();
    for (const row of analysis.cases) {
      if (row.family !== family.family || row.runtimeNonResult === null) continue;
      const kind = row.runtimeNonResultKind ?? "unknown";
      byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    }
    for (const [detail, count] of [...byKind.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      out.push({ kind: "non-result", family: family.family, detail, count, denominator: total });
    }
  }
  // Every complete Judge disagreement is advice by family; the verifier still decides every pass.
  if (judges.census !== null) {
    const byFamily = new Map<string, { passedFailed: number; failedPassed: number }>();
    for (const row of judges.contested) {
      const entry = byFamily.get(row.family) ?? { passedFailed: 0, failedPassed: 0 };
      if (row.judge && !row.verifier) entry.passedFailed += 1;
      else entry.failedPassed += 1;
      byFamily.set(row.family, entry);
    }
    for (const [family, counts] of [...byFamily.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const verified = families.find((row) => row.family === family)?.verified ?? 0;
      if (counts.passedFailed > 0) {
        out.push({
          kind: "judge-passed-verifier-failed",
          family,
          detail: null,
          count: counts.passedFailed,
          denominator: verified,
        });
      }
      if (counts.failedPassed > 0) {
        out.push({
          kind: "judge-failed-verifier-passed",
          family,
          detail: null,
          count: counts.failedPassed,
          denominator: verified,
        });
      }
    }
  }
  return out;
}

/** Advances the register by one battery: an observed issue resets its absence and records whether
 *  it came back; an unobserved one ages only when its family ran. A Judge issue with no complete
 *  Judge review is carried unchanged. */
export function advanceIssues(
  previous: readonly AdviceIssue[],
  observed: readonly Observed[],
  runId: string,
  families: readonly AdviceFamilyRow[],
  judgeReview: "complete" | "incomplete",
): AdviceIssue[] {
  const verifiedByFamily = new Map(families.map((row) => [row.family, row.verified] as const));
  const byId = new Map(previous.map((issue) => [issue.id, issue] as const));
  const seen = new Set<string>();
  const next: AdviceIssue[] = [];
  for (const entry of observed) {
    const id = adviceIssueId(entry.kind, entry.family, entry.detail);
    seen.add(id);
    const prior = byId.get(id);
    next.push({
      id,
      kind: entry.kind,
      family: entry.family,
      detail: entry.detail,
      count: entry.count,
      denominator: entry.denominator,
      firstSeenRunId: prior?.firstSeenRunId ?? runId,
      lastSeenRunId: runId,
      absentBatteries: 0,
      returned: prior !== undefined && (prior.absentBatteries > 0 || prior.returned),
      retired: false,
      diagnosis: prior?.diagnosis ?? null,
      // Observing a disputed issue again does not settle whose defect it is.
      dispute: prior?.dispute ?? null,
    });
  }
  for (const issue of previous) {
    if (!seen.has(issue.id)) next.push(agedIssue(issue, verifiedByFamily.get(issue.family), judgeReview));
  }
  return next.sort(
    (a, b) =>
      a.family.localeCompare(b.family) ||
      a.kind.localeCompare(b.kind) ||
      (a.detail ?? "").localeCompare(b.detail ?? ""),
  );
}

/** `verified` is the family's truth-verified case count, or undefined when the family is absent.
 *  An absent family retires the issue; a family with no verified case observed nothing and leaves
 *  the issue unchanged. */
function agedIssue(
  issue: AdviceIssue,
  verified: number | undefined,
  judgeReview: "complete" | "incomplete",
): AdviceIssue {
  if (verified === undefined) return { ...issue, retired: true, dispute: null };
  if (verified === 0) return issue;
  if (issue.kind.startsWith("judge-") && judgeReview === "incomplete") return issue;
  // An issue the battery no longer shows carries no dispute.
  return { ...issue, absentBatteries: issue.absentBatteries + 1, retired: false, dispute: null };
}

/**
 * Attaches the review readers' diagnoses and disputes to the advanced register, before the packet is
 * written, so the bound digest covers them. Only a standing issue can be disputed; disputing a fixed
 * or retired one would resurrect it.
 */
export function attachIssueReadings(
  packet: RebuildAdvicePacket,
  readings: {
    diagnoses?: ReadonlyArray<IssueDiagnosis & { issueId: string }>;
    disputes?: ReadonlyArray<{ issueId: string; reason: string }>;
  },
): RebuildAdvicePacket {
  const diagnosed = new Map(
    (readings.diagnoses ?? []).map(({ issueId, ...diagnosis }) => [issueId, diagnosis] as const),
  );
  const disputed = new Map((readings.disputes ?? []).map((row) => [row.issueId, row.reason] as const));
  if (diagnosed.size === 0 && disputed.size === 0) return packet;
  return {
    ...packet,
    issues: packet.issues.map((issue) => {
      const reading = diagnosed.get(issue.id);
      const dispute = isStanding(issue) ? disputed.get(issue.id) : undefined;
      if (reading === undefined && dispute === undefined) return issue;
      return {
        ...issue,
        ...(dispute === undefined ? null : { dispute }),
        ...(reading === undefined ? null : { diagnosis: reading }),
      };
    }),
  };
}

/** The recurrence key of an unowned diagnosis, which is the subject it named and nothing else.
 *  Every other finding has no key. It used to fall through to the kind itself, the constant
 *  `diagnosis-uncertain` every finding reaching here shares, so any two in consecutive packets read
 *  as one diagnosis recurring. A diagnosis the reviewer could not attribute is exactly the case
 *  with no identity to derive, so it gets none. */
function unownedDiagnosisIdentity(
  finding: Pick<AnalysisFinding, "kind" | "checkId" | "artifactSchemaPath" | "hostRule">,
): string | null {
  return finding.kind === "diagnosis-uncertain" ? namedSubject(finding) : null;
}

/** How many consecutive packets have carried this unowned diagnosis, read off the previous
 *  packet's findings; a reappearance after a gap counts from one again. */
function recurrence(previous: RebuildAdvicePacket | null, identity: string): AdviceFinding["repeated"] {
  const prior = (previous?.findings ?? []).find((finding) => unownedDiagnosisIdentity(finding) === identity);
  if (previous === null || prior === undefined) return undefined;
  return { count: (prior.repeated?.count ?? 1) + 1, since: prior.repeated?.since ?? previous.runId };
}

export function deriveRebuildAdvice(
  analysis: IterationAnalysis,
  judges: JudgeReviewsResult,
  admission: AdmittedEvidence,
  previous: RebuildAdvicePacket | null,
): RebuildAdvicePacket {
  const families = familyRows(analysis);
  const observed = observedIssues(analysis, judges, families);
  const judgeReview = judges.provisional === null && judges.census !== null ? "complete" : "incomplete";
  return {
    schema: REBUILD_ADVICE_SCHEMA,
    slug: analysis.slug,
    runId: analysis.runId,
    analysisDigest: hashJsonBytes(analysis),
    families,
    blockingByCheck: analysis.battery.blockingByCheck,
    applicableByCheck: analysis.battery.applicableByCheck,
    issues: advanceIssues(previous?.issues ?? [], observed, analysis.runId, families, judgeReview),
    // Advice only: counts and families, never task ids.
    judge:
      judges.census === null
        ? null
        : {
            exit: judges.exit.kind,
            reason: judges.exit.reason,
            contestedFamilies: [...new Set(judges.contested.map((row) => row.family))].sort(),
          },
    // Aggregate rows only. A routed row already reaches the session as feedback, so only rows that
    // route nowhere are kept. A judge-disagreement row repeats `judge.reason` above, and a
    // controller defect is not the author's to repair.
    findings: admission.admitted
      .filter(
        (finding) =>
          finding.subject === undefined &&
          finding.kind !== "judge-disagreement" &&
          finding.kind !== "controller-defect" &&
          authorSessionOwner(finding).owner === null,
      )
      .map((finding) => {
        const identity = unownedDiagnosisIdentity(finding);
        return {
          kind: finding.kind,
          claim: finding.claim,
          severity: findingSeverity(finding),
          ...keyIfDefined("checkId", finding.checkId),
          ...keyIfDefined("artifactSchemaPath", finding.artifactSchemaPath),
          ...keyIfDefined("hostRule", finding.hostRule),
          ...keyIfDefined("repeated", identity === null ? undefined : recurrence(previous, identity)),
        };
      }),
  };
}

export function rebuildAdvicePath(repoRoot: string, slug: string, runId: string): string {
  return join(campaignDir(repoRoot, slug), "analysis", `${runId}-rebuild-advice.json`);
}

export function latestRebuildAdvicePath(repoRoot: string, slug: string): string {
  return join(campaignDir(repoRoot, slug), "analysis", REBUILD_ADVICE_LATEST);
}

/** The latest packet, or null when none exists or another schema wrote it (no register yet on this
 *  source). A corrupt file throws: a rebuild must not author against unreadable bytes. */
export function readLatestRebuildAdvice(repoRoot: string, slug: string): RebuildAdvicePacket | null {
  const path = latestRebuildAdvicePath(repoRoot, slug);
  if (!existsSync(path)) return null;
  const parsed = parseJsonAs<RebuildAdvicePacket>(readFileSync(path, "utf8"));
  return parsed.schema === REBUILD_ADVICE_SCHEMA ? parsed : null;
}

const ISSUE_WORDS = {
  "verified-fail": "verified cases failed",
  unaccepted: "attempts produced no accepted submission",
  "judge-passed-verifier-failed": "verified cases the Judge passed and the verifier failed",
  "judge-failed-verifier-passed": "verified cases the Judge failed and the verifier passed",
} as const;

/** An issue whose whole content is an environment failure (provider limit, credential, sandbox).
 *  A crash, protocol violation or `verifier` kind stays the harness's to explain. */
export function environmentOwned(issue: AdviceIssue): boolean {
  // Timeout is excluded: an aggregate issue cannot show solver origin, and a verifier tool timeout
  // can need author repair.
  return (
    issue.kind === "non-result" &&
    issue.detail !== "timeout" &&
    isNonResultKind(issue.detail) &&
    ENVIRONMENT_OWNED_NONRESULT_KINDS.has(issue.detail)
  );
}

function issueLine(issue: AdviceIssue): string {
  const kind = issue.detail ?? "unknown";
  const nonResult = environmentOwned(issue)
    ? `environment non-results of kind ${kind}`
    : `runtime non-results of kind ${kind}, a kind that does not establish an environment failure`;
  const words = issue.kind === "non-result" ? nonResult : ISSUE_WORDS[issue.kind];
  const diagnosis =
    issue.diagnosis === null
      ? ""
      : `\n  diagnosis (${issue.diagnosis.runId}, ${issue.diagnosis.confidence} confidence, points at ${ownerTarget(issue.diagnosis.interventionClass)})`;
  return `- [${issueStatusWord(issue)}] ${issue.family}: ${issue.count}/${issue.denominator} ${words} (first seen ${issue.firstSeenRunId}, last seen ${issue.lastSeenRunId})${diagnosis}`;
}

/** Standing issues, largest first, capped. Fixed issues belong to the climb readout's family line
 *  and retired ones name families the author cannot move; the register still records both. */
function standingLines(issues: readonly AdviceIssue[]): string[] {
  const standing = [...issues]
    .filter(isStanding)
    .sort((a, b) => b.count - a.count || a.family.localeCompare(b.family) || a.kind.localeCompare(b.kind));
  if (standing.length === 0) return [];
  const shown = standing.slice(0, RENDERED_ISSUES);
  const omitted = standing.length > shown.length ? ` (${shown.length} of ${standing.length} shown)` : "";
  return [
    `Standing issues, largest first${omitted}. Use the recorded owners as starting points for diagnosis. An environment non-result alone calls for an unchanged rerun, not a harness change.`,
    ...shown.map(issueLine),
  ];
}

/** Public finding text, capped in count and length. Blocking findings sort first so the cap cuts
 *  advisory ones; within one severity the admitted order stands. */
function findingLines(findings: readonly AdviceFinding[]): string[] {
  const ordered = [...findings].sort(
    (a, b) => Number(b.severity === "blocking") - Number(a.severity === "blocking"),
  );
  const lines = ordered.slice(0, RENDERED_FINDINGS).map((finding) => {
    const repeated =
      finding.repeated === undefined
        ? ""
        : ` (recurring: ${String(finding.repeated.count)} consecutive packets since ${finding.repeated.since})`;
    const cut = finding.claim.length - FINDING_CLAIM_CHARS;
    const claim =
      cut <= 0
        ? finding.claim
        : `${finding.claim.slice(0, FINDING_CLAIM_CHARS)} […${cut} further character${cut === 1 ? "" : "s"} omitted]`;
    return `- [${finding.severity}] ${finding.kind}: ${claim}${repeated}`;
  });
  const omitted = findings.length - lines.length;
  return omitted > 0
    ? [...lines, `- ${omitted} further admitted finding${omitted === 1 ? "" : "s"} omitted from this packet.`]
    : lines;
}

/** Which declared checks decided anything, on both sides. `truthCheckFiring` seeds the record
 *  with every declared check at zero, so the zeros are the roster of checks that let every
 *  shipping artifact through. The roster then splits on the applicable count, because "refused
 *  nothing over 25 verified cases" and "no verified case posed it" ask for opposite repairs --
 *  raise the rule, or give the battery a task that reaches it. Across the recorded corpus 74 of
 *  670 untripped rows were not the shape one sentence implied: 54 applied to some verified cases,
 *  20 to none. Zero verified cases prove no check untripped, so this stays silent until a battery
 *  graded something. */
function blockingLine(
  blockingByCheck: Record<string, number>,
  applicableByCheck: Record<string, number>,
  verified: number,
  passed: number,
): string | null {
  const entries = Object.entries(blockingByCheck);
  if (entries.length === 0 || verified === 0) return null;
  const blocked = entries
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const untripped = entries
    .filter(([, count]) => count === 0)
    .map(([checkId]) => checkId)
    .sort();
  const applied = untripped.filter((checkId) => (applicableByCheck[checkId] ?? 0) > 0);
  // A recorded zero, never an absent row: "no verified case posed it" is a measurement, and the
  // packet may state it only where the battery measured it.
  const unposed = untripped.filter((checkId) => applicableByCheck[checkId] === 0);
  // Only when one check carries every failure.
  const alone = blocked.length === 1 && blocked[0]?.[1] === verified - passed;
  return [
    blocked.length === 0
      ? null
      : `Verified failures by declared check (${verified - passed} failed; a case may block on several): ${blocked.map(([checkId, count]) => `${checkId} ${count}`).join(", ")}.${alone ? " One check carrying every failure asks whether its rule is stated in the public contract before the count reads as solver capability." : ""}`,
    applied.length === 0
      ? null
      : `Declared checks that blocked no shipping artifact, with the verified cases each applied to (of ${verified}): ${applied.map((checkId) => `${checkId} ${applicableByCheck[checkId]}`).join(", ")}.`,
    unposed.length === 0
      ? null
      : `Declared checks no verified case posed, so this battery measured nothing about them: ${unposed.join(", ")}.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

/** The model-visible projection of the issue register: kinds and counts. Band placement and totals
 *  belong to the climb readout, which renders above it. */
export function renderRebuildAdvice(packet: RebuildAdvicePacket): string {
  const totals = adviceTotals(packet.families);
  const disputed = packet.issues.filter((issue) => issue.dispute !== null && !issue.retired);
  return [
    ...standingLines(packet.issues),
    disputed.length === 0
      ? null
      : `Disputed issues — an epoch review argued these come from the evaluation rather than the harness, so do not rebuild the agent around them: ${disputed.map((issue) => `${issue.family} (${issue.kind})`).join("; ")}.`,
    blockingLine(packet.blockingByCheck, packet.applicableByCheck, totals.verified, totals.passed),
    packet.judge === null || packet.judge.exit === "none"
      ? null
      : `Judge review: ${packet.judge.reason}${packet.judge.contestedFamilies.length > 0 ? ` (families: ${packet.judge.contestedFamilies.join(", ")})` : ""}.`,
    ...findingLines(packet.findings),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
