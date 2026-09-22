/**
 * What the next-experiment author reads about the product it is continuing: one issue register,
 * derived from the rows the round already wrote, replacing a model-written repair hypothesis with
 * a history the controller owns.
 *
 * The controller's moves are `build | measure | rebuild | stop` and none of them is a climb, so
 * this is the packet an author reads whether it goes on to change the tasks alone or to reopen the
 * product. Its order is therefore the instruction. Campaign 846c029d-3 read a packet in which every
 * line named a defect and an owner and one line at the end asked for a harder exam: seventeen of
 * its nineteen accepted candidates classified as `build` and none as a task-only climb, its
 * twenty-five public tasks stayed byte-identical from i14 while the correctness model was rewritten
 * each round, and all 450 scored cases of the eighteen completed rounds recorded one distinct
 * tool-call count. Where the battery landed now belongs to the climb readout, which renders above
 * this packet; `renderRebuildAdvice` carries the issue register alone.
 *
 * An issue is three recorded facts and no state machine. `absentBatteries` counts the batteries in
 * which its family ran without it, `returned` says the latest observation followed an absence, and
 * `retired` says the family left the task set. `issueStatusWord` derives the word every reader used
 * to store; two representations of one lifecycle could disagree, and one of them was written by the
 * same function that read it. Issue identity is `kind + family + detail` and excludes the harness
 * identity, so one issue can be followed across a rebuild. These facts describe recorded
 * observations rather than proving a defect can never recur.
 *
 * Everything the rows already determine is derived rather than stored: the battery's totals and
 * how many consecutive packets carried an unowned diagnosis. Two
 * fields are written by the review readers instead — `diagnosis` carries the diagnosis reader's
 * falsifiable causal claim and `dispute` the epoch reviewer's argument that an issue belongs to the
 * evaluation. Both attach through `attachIssueReadings` after the packet is derived, and neither
 * changes a count or any decision: the issue register stays controller-owned and the readers
 * annotate it.
 *
 * `renderRebuildAdvice` is the model-visible boundary and is bounded by construction rather than by
 * a ceiling that cuts mid-sentence: `RENDERED_ISSUES` standing issues, `RENDERED_FINDINGS` findings
 * and `FINDING_CLAIM_CHARS` per claim. Private diagnoses stay recorded here and their prose never
 * crosses into authoring; a failure location need not spell an individual task id.
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
  type AdmittedEvidence,
  type AnalysisFinding,
  type IterationAnalysis,
} from "../analyse/iteration-analysis.ts";
import type { JudgeReviewsResult } from "../analyse/judge-reviews.ts";
import { keyIfDefined } from "../meta/optional-key.ts";

export const REBUILD_ADVICE_SCHEMA = "rebuild-advice/v3";
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

/** A reader's causal claim about one issue, with the observation that would refute it. Both halves
 *  are required: a cause that cannot be wrong tells the next authoring pass nothing it can check. */
export type IssueDiagnosis = {
  /** The causal hypothesis: what made this family fail. */
  cause: string;
  /** The observation that would show the cause is wrong. */
  falsifier: string;
  /** First observed failure boundary, compared with a passing trace only when one was supplied. */
  firstDivergence: string;
  /** The authoring area the reader believes owns the cause. Advice with no authority: the
   *  controller's own routing still decides where a repair goes, and this never selects one. */
  interventionClass: FeedbackOwner;
  /** What a passing case of the same family did differently; null when the family had none, so the
   *  reader had nothing to contrast against. A cause that explains the pass too is not a cause. */
  contrastSuccess: string | null;
  confidence: "low" | "medium" | "high";
  /** The battery whose traces it was read from, so an aging issue shows whether its diagnosis still
   *  describes the battery in front of the author. */
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
   *  no fix: run59-opus-0904 carried an `uno-sensor-light` failure as active through two batteries
   *  of a rebuilt task set that no longer had the family, and the advice kept asking the author to
   *  move something it could not observe. */
  retired: boolean;
  /** The diagnosis reader's falsifiable causal claim; null when none was read or the reading
   *  failed. Carried forward while the issue lives, so one reading serves later batteries. */
  diagnosis: IssueDiagnosis | null;
  /** The epoch reviewer's argument that this failure belongs to the evaluation. The register keeps
   *  counting a disputed issue — a dispute is a reason not to rebuild the agent around it, never a
   *  reason to stop observing it. */
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
  /** Public identities retained only to key repeated unowned diagnosis findings. */
  checkId?: string;
  artifactSchemaPath?: string;
  /** Set from the second consecutive packet carrying the same unowned diagnosis, so the author
   *  reads recurrence instead of a fresh open question each round. */
  repeated?: { count: number; since: string };
};

export type RebuildAdvicePacket = {
  schema: typeof REBUILD_ADVICE_SCHEMA;
  slug: string;
  runId: string;
  analysisDigest: string;
  /** The battery, one row per family. Its totals and the families that found no limit are read off
   *  these rows rather than stored beside them, where the two could disagree. */
  families: AdviceFamilyRow[];
  /** Verified failures per declared check, as the battery recorded them. Safeguard 24 logged this
   *  shape when one check carried every failure (truss 2026-09-04: 20 of 25 on one check). */
  blockingByCheck: Record<string, number>;
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

/** Standing issues the render shows, and the findings and claim length beside them. The boundary
 *  used to be bounded by nothing: Astra i18 rendered 18,196 characters, of which one unowned
 *  finding was 15,824 and six issue lines 1,142, and an author reading a defect list that long
 *  writes a defect fix. These three numbers bound it at a few thousand characters whatever the
 *  battery did, and the register still records every issue and finding derived. Six matches the
 *  standing issues the diagnosis reader offers, so the two readers mean one thing by "standing". */
const RENDERED_ISSUES = 6;
const RENDERED_FINDINGS = 4;
const FINDING_CLAIM_CHARS = 600;

/** An issue this battery observed, that nothing contests and whose family is still in the task
 *  set: the one the diagnosis reader, the epoch reviewer and the render all mean by "standing". */
export function isStanding(issue: AdviceIssue): boolean {
  return !issue.retired && issue.dispute === null && issue.absentBatteries === 0;
}

/** The word for one issue's recorded facts, for readers that show a status rather than act on one. */
export function issueStatusWord(issue: AdviceIssue): string {
  if (issue.retired) return "retired";
  if (issue.dispute !== null) return "disputed";
  if (issue.absentBatteries === 0) return issue.returned ? "regressed" : "active";
  return issue.absentBatteries >= CONFIRMED_FIXED_AFTER ? "confirmed-fixed" : "tentatively-fixed";
}

export function adviceIssueId(kind: AdviceIssueKind, family: string, detail: string | null): string {
  return sha256(canonicalJson({ kind, family, detail }));
}

/** The battery's totals, from the family rows that carry them. */
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

/** Advance the register by one battery: an observed issue resets its absence and remembers whether
 *  it came back, and an unobserved one ages only when its family ran. A Judge issue that no
 *  complete Judge review could observe is carried unchanged rather than aged towards a fix. */
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
      // A disputed issue observed again is still disputed: the dispute is about whose defect the
      // failure is, and seeing it a second time is not an answer to that question.
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

/** `verified` is the family's truth-verified case count in this battery, or undefined when the
 *  family is not in it at all. Absence of the family retires the issue; a family the provider
 *  never let run observed nothing and moves it neither way, which is the same carry the Judge
 *  branch below already makes. Campaign 3fd52f9e-28's battery 719f26-i02 recorded 24 provider
 *  non-results of 25 cases, and every family in it counted as having run. */
function agedIssue(
  issue: AdviceIssue,
  verified: number | undefined,
  judgeReview: "complete" | "incomplete",
): AdviceIssue {
  if (verified === undefined) return { ...issue, retired: true, dispute: null };
  if (verified === 0) return issue;
  if (issue.kind.startsWith("judge-") && judgeReview === "incomplete") return issue;
  // An issue the battery no longer shows carries no dispute: campaign -27 kept one across five
  // batteries of absence, a field promising a withholding the controller was not applying.
  return { ...issue, absentBatteries: issue.absentBatteries + 1, retired: false, dispute: null };
}

/**
 * Attach what the two review readers said to the register this battery just advanced. The readers run
 * after the packet is derived and before it is written, so the digest a rebuild binds covers the
 * complete evidence packet, including readings whose prose the author must not see.
 *
 * A dispute suspends an issue instead of closing it: the author is told not to rebuild around it,
 * and the next battery still counts it. Only a standing issue can be suspended — disputing a fixed
 * or retired issue would resurrect it.
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

/** The recurrence key of an unowned diagnosis: its public check id, else its artifact path, else
 *  the kind itself, which is all a host-produced unaccepted-count finding carries (Astra 0912, i11
 *  to i19). Every other finding has no key and is never annotated. */
function unownedDiagnosisIdentity(
  finding: Pick<AnalysisFinding, "kind" | "checkId" | "artifactSchemaPath">,
): string | null {
  return finding.kind === "diagnosis-uncertain"
    ? (finding.checkId ?? finding.artifactSchemaPath ?? finding.kind)
    : null;
}

/** How many consecutive packets have carried this unowned diagnosis, read off the previous
 *  packet's own findings. A separate history array said the same thing a second time, and an
 *  identity absent from a round left it, so a reappearance already counted from one again. */
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
    // Per-case findings never leave the controller (tenet 4); these aggregate rows are already
    // author-visible by construction of hostFindings and the Judge exit. A routed row reaches the
    // same session again through advisory(priorEvidence.feedback), so only rows that route nowhere
    // are new information here (tenet 14). The test is the routing predicate, not the rendered
    // claim: two findings may carry the same text, and dropping both because one routed would lose
    // the one that did not.
    // A judge-disagreement row is the one kind the routing predicate reads wrong. It routes
    // nowhere, so the predicate calls it new, but `judge.reason` above is the same string from the
    // same producer: c1d2a7's round three printed the whole Judge sentence twice, once as the
    // review line and once as an advisory finding, and the second copy also spent one of the four
    // rendered finding slots. The Judge exit has one owner here, the judge block; the admission
    // record keeps the row either way. A controller defect is not the author's to repair: run
    // 08c0f2's third round was asked to inspect the public contract for the controller's mismatch.
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

/** The latest packet, or null when this source recorded none. A corrupt file still throws through
 *  `parseJsonAs`: a rebuild must not author against bytes it could not read. A packet another
 *  schema wrote is a different fact — no register exists on this source yet — and every consumer
 *  already spells that as null: `advanceIssues` starts its register from `[]`, `recurrence` counts
 *  from one, the epoch reviewer is offered no standing issue and the advisory note carries no
 *  packet. Throwing instead killed the first analyse step of all 47 recorded campaigns when this
 *  file moved `families` out of `battery` and dropped `sentinels`, so an explicitly supported
 *  `--project <existing>` continuation could not start. */
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

/** An issue whose whole content is an environment failure. Rule 15 gives a provider limit, a
 *  missing credential, a sandbox refusal and their relatives to the environment owner. The kinds
 *  come from the existing set beside the vocabulary, so a crash, a protocol violation or a
 *  `verifier` kind stays the harness's to explain: a tool that ran and died may well be a harness
 *  defect. The diagnosis reader offers none of these issues, and the issue line names the split. */
export function environmentOwned(issue: AdviceIssue): boolean {
  // The shared set admits timeout only with solver-origin evidence at the battery boundary.
  // This aggregate issue has no such provenance; a verifier tool timeout can need author repair.
  return (
    issue.kind === "non-result" &&
    issue.detail !== "timeout" &&
    isNonResultKind(issue.detail) &&
    ENVIRONMENT_OWNED_NONRESULT_KINDS.has(issue.detail)
  );
}

function issueLine(issue: AdviceIssue): string {
  const kind = issue.detail ?? "unknown";
  // run 08c0f2 i02: six `verifier` cases sat under "an environment non-result alone calls for an
  // unchanged rerun" as though that sentence covered them.
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

/** What is failing now, largest first, capped. A fixed issue is absent: which families passed every
 *  verified case is the climb readout's family line, and naming them here as well asked opposite
 *  things of one family — Astra i16 listed asymmetric-live, damage-tolerance, obstacle-routing and
 *  wind-reversal as confirmed-fixed issues to preserve and then as sentinels to add a requirement
 *  to, four of its six issue lines. A retired issue names a family that left the task set, which the
 *  author can neither move nor keep. The issue register records both either way, so an issue
 *  returning is still a regression. */
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

/** Public finding text, capped in count and in length. A finding that routes to no owner is the one
 *  row the controller could not place, so it is the row most likely to grow: the cap belongs to the
 *  boundary rather than to any one producer of it.
 *
 *  Blocking first, because the cap cuts the tail. The standing issues above this block are ordered
 *  by how many cases they hold before they are cut to `RENDERED_ISSUES`; these were cut to four in
 *  the order they happened to be admitted, so a blocking finding sat behind any three advisory ones
 *  that arrived first and left the packet as "1 further admitted finding(s) omitted" — a line that
 *  does not say the omitted row was the blocking one. A blocking finding is an admitted, cited
 *  demonstration of a violated requirement, which is the strongest row this packet carries; an
 *  advisory is a lead. Within one severity the admitted order stands, so nothing else moves. */
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

/** Which of the harness's own declared checks decided anything, on both sides. `truthCheckFiring`
 *  seeds the record with every declared check at zero, so the zeros already in the packet are the
 *  roster of checks that let every shipping artifact through, and this line used to discard them.
 *  That is the fact a saturated battery is made of, and the family line cannot state it: a family
 *  reads as "raise its numbers" where a check reads as "this rule refused nothing". Runs a7f9ac and 719f26 scored 14/14 and 11/11 with all six checks untripped
 *  in shipping, and the packet carried neither line. Zero verified cases prove no check untripped,
 *  so the roster stays silent until a battery graded something. */
function blockingLine(
  blockingByCheck: Record<string, number>,
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
  // Only when it is so: 4c67fc's packet appended this beside one failed case and six checks.
  const alone = blocked.length === 1 && blocked[0]?.[1] === verified - passed;
  return [
    blocked.length === 0
      ? null
      : `Verified failures by declared check (${verified - passed} failed; a case may block on several): ${blocked.map(([checkId, count]) => `${checkId} ${count}`).join(", ")}.${alone ? " One check carrying every failure asks whether its rule is stated in the public contract before the count reads as solver capability." : ""}`,
    untripped.length === 0
      ? null
      : `Declared checks that blocked no shipping artifact over ${verified} verified case(s): ${untripped.join(", ")}.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

/** The one model-visible projection of the issue register: kinds and counts, ordered by what the
 *  next experiment decides. Where the battery landed and its totals are the climb readout's, which
 *  renders above this packet, so neither is repeated here. */
export function renderRebuildAdvice(packet: RebuildAdvicePacket): string {
  const totals = adviceTotals(packet.families);
  const disputed = packet.issues.filter((issue) => issue.dispute !== null && !issue.retired);
  return [
    ...standingLines(packet.issues),
    disputed.length === 0
      ? null
      : `Disputed issues — an epoch review argued these come from the evaluation rather than the harness, so do not rebuild the agent around them: ${disputed.map((issue) => `${issue.family} (${issue.kind})`).join("; ")}.`,
    blockingLine(packet.blockingByCheck, totals.verified, totals.passed),
    packet.judge === null || packet.judge.exit === "none"
      ? null
      : `Judge review: ${packet.judge.reason}${packet.judge.contestedFamilies.length > 0 ? ` (families: ${packet.judge.contestedFamilies.join(", ")})` : ""}.`,
    ...findingLines(packet.findings),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
