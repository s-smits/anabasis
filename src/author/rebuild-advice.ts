/**
 * What the next-experiment author reads about the product it is continuing: one issue register,
 * derived from the rows the round already wrote, in place of a model-written repair hypothesis.
 *
 * The controller's moves are `build | measure | rebuild | stop` and none of them is a climb, so
 * this is the packet an author reads whether it goes on to change the tasks alone or to reopen the
 * whole product. Its order is therefore the instruction, and a packet that reads as a defect list
 * gets a defect fix rather than a harder exam. Where the battery landed belongs to the climb
 * readout, which renders above this packet, so `renderRebuildAdvice` carries the issue register
 * alone.
 *
 * An issue is recorded facts and no lifecycle. `firstSeenRunId` and `lastSeenRunId` say where it
 * was observed, `absentBatteries` counts the later batteries that verified its whole family on a
 * comparable condition without observing it, `unmeasured` names what moved when the latest such
 * battery was not comparable, `returned` says it was observed again after an absence, and `retired`
 * says the family left the task set. Nothing turns them into "fixed" or "regressed": identity is
 * `kind + family + detail`, which names where a failure showed and not what caused it, so an
 * absence is a failure not seen again and never a repair. `issueFacts` states them as one phrase.
 * Comparable means the family's tasks, hidden expectations included, the scoring program, the tools
 * its checks ran and the Built condition all match the battery that last observed the issue
 * (`issue-condition.ts`).
 * Identity deliberately excludes the harness, which is what lets one issue be followed across a
 * rebuild.
 *
 * Everything the rows already determine is derived rather than stored — the battery's totals, and
 * how many consecutive packets have carried an unplaced finding. Only `diagnosis` and `dispute`
 * are written from outside, through `attachIssueReadings` after the packet is derived, and neither
 * changes a count or any decision, so the register stays controller-owned.
 *
 * `renderRebuildAdvice` is the model-visible boundary, bounded by construction rather than by a
 * ceiling that cuts mid-sentence: `RENDERED_ISSUES` standing issues, `RENDERED_FINDINGS` findings
 * and `FINDING_CLAIM_BYTES` per claim. A diagnosis crosses as its owner, boundary and falsifier,
 * which the diagnosis reader drew from solver traces and public context alone; its causal argument
 * stays recorded here.
 */
import { boundText } from "../meta/bounded-text.ts";
import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { join } from "../meta/path.ts";
import { sha256 } from "../meta/digest.ts";
import { canonicalJson } from "../meta/stable-json.ts";
import { hashJsonBytes, parseJsonAs } from "../meta/json-runtime.ts";
import { familyTally } from "../claim/case-record.ts";
import { ENVIRONMENT_OWNED_NONRESULT_KINDS, isNonResultKind } from "../claim/record-events.ts";
import {
  namedSubject,
  type AdmittedEvidence,
  type AnalysisFinding,
  type IterationAnalysis,
} from "../analyse/iteration-analysis.ts";
import type { JudgeReviewsResult } from "../analyse/judge-reviews.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { BRIEF_FILE, GENERATED_TOOLS_FILE, TOOLS_SPEC_FILE } from "../meta/bundle-layout.ts";
import { BUILT_AGENTS_FILE } from "../solve/built-starter.ts";
import { HARNESS_CONFIG_FILE } from "../correctness-bundle/harness-config.ts";
import { type BundleFile, isBundleFile } from "./feedback-routing.ts";
import {
  type BatteryCondition,
  type ConditionGap,
  type IssueCondition,
  conditionGaps,
} from "./issue-condition.ts";

export const REBUILD_ADVICE_SCHEMA = "rebuild-advice/v11";
const REBUILD_ADVICE_LATEST = "rebuild-advice-latest.json";

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

/** Where the diagnosis reader locates a failure: a bundle file the solver reads, which is the file
 *  a repair would change, or `solver` when the harness gave the solver what it needed and the solve
 *  still went wrong, which is a finding in its own right rather than an abstention. The reader reads
 *  solves, not the evaluation, so no file under `correctness-model/` other than the brief it
 *  publishes is offered. */
export const DIAGNOSIS_OWNERS = [
  BRIEF_FILE,
  BUILT_AGENTS_FILE,
  TOOLS_SPEC_FILE,
  GENERATED_TOOLS_FILE,
  HARNESS_CONFIG_FILE,
  "solver",
] as const satisfies readonly (BundleFile | "solver")[];
export type DiagnosisOwner = (typeof DIAGNOSIS_OWNERS)[number];

/** A structured reading of why one or more issues' solves failed, located at a step of a recorded
 *  trace, with the observation that would refute it. It is advice: it selects no owner and changes
 *  no count, and the controller's own routing still decides where any repair goes. */
export type IssueDiagnosis = {
  /** The battery whose traces it was read from, which is the battery that last observed its issue:
   *  a later observation drops it, and that battery's traces are read afresh. */
  runId: string;
  owner: DiagnosisOwner;
  /** The first observed failure boundary: the tool called at that step, or null when the boundary is
   *  the solve's end (a wall, a missing submission), and what the trace shows there. */
  boundary: { tool: string | null; reading: string };
  /** The causal argument. Recorded for review and never rendered to the author. */
  cause: string;
  /** One observation a later battery could record that would show the reading is wrong. */
  falsifier: string;
  /** Sampled failing cases the reader said the reading holds for, of those it was shown, of all the
   *  cases carrying the issues, and the passing contrasts it cited. They are rendered as counts and
   *  graded into nothing, because no measurement calibrates a grade drawn from them. */
  support: { cases: number; shown: number; matching: number; contrasts: number };
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
  /** Complete rechecks since `lastSeenRunId`: later batteries on a comparable condition in which
   *  every case of the family was truth-verified and the issue was absent. A partial recheck counts
   *  nothing, since the case left without a verdict may be the one that failed. */
  absentBatteries: number;
  /** Some observation after the first followed a complete recheck that did not observe it. */
  returned: boolean;
  /** The family left the task set, so this battery could not observe the issue. That is a separate
   *  fact from absence: counted as a recheck, it would say the failure was not seen again on tasks
   *  no battery posed. */
  retired: boolean;
  /** The condition of the battery that last observed the issue, which every later absence is
   *  compared against. */
  observedUnder: IssueCondition;
  /** What moved when the latest battery that ran the family without the issue was not comparable;
   *  empty otherwise. Non-empty, the absence is unmeasured rather than a recheck: identical
   *  inputs under a weaker evaluator, or other inputs altogether, make an issue vanish unrepaired. */
  unmeasured: ConditionGap[];
  /** The diagnosis reader's reading of the battery that last observed the issue; null when none was
   *  read or the reading failed. It stays with that observation, so a partial recheck carries it and
   *  the next observation drops it: a reading of earlier traces would otherwise stand for a battery
   *  whose reader abstained, failed or never ran. */
  diagnosis: IssueDiagnosis | null;
  /** The epoch reviewer's argument that this failure belongs to the evaluation. The register keeps
   *  counting a disputed issue: a dispute is a reason not to rebuild the agent around it, never a
   *  reason to stop observing it. It survives a re-observation only under `observedUnder`. */
  dispute: string | null;
  /** A Judge issue every one of whose counted cases this battery's epoch review settled in the
   *  check's favour, each on an artifact it read, with a probe in which the Judge's reading moved the
   *  check. It stops the issue standing for this battery alone: the next battery that observes the
   *  disagreement records it afresh, without the flag. */
  judgeSettled?: true;
};

type AdviceFamilyRow = {
  family: string;
  verified: number;
  passed: number;
  unaccepted: number;
  nonResults: number;
  /** The digest of the family's whole tasks in this battery, hidden expectations included, or
   *  null when they could not be vouched for. */
  taskInputs: string | null;
};

/** A finding no bundle file holds, which is therefore an observation and always advice: the
 *  environment's, or one the controller could not place. */
type AdviceFinding = {
  owner: "environment" | null;
  claim: string;
  /** Public identities retained only to key repeated unplaced findings. `hostRule` is
   *  carried because `recurrence` reads the previous packet's own findings: dropped here, a host
   *  finding's run of consecutive packets restarts at one every round. */
  checkId?: string;
  artifactSchemaPath?: string;
  hostRule?: string;
  /** Set from the second consecutive packet carrying the same unplaced finding, so the author
   *  reads a recurrence rather than what looks like a fresh open question each round. */
  repeated?: { count: number; since: string };
};

export type RebuildAdvicePacket = {
  schema: typeof REBUILD_ADVICE_SCHEMA;
  slug: string;
  runId: string;
  analysisDigest: string;
  /** The Built model pin the battery was measured under, which is the pin its climb readout is read
   *  under when a later reader has only this packet. */
  backendPin: string;
  /** The scoring program, the tools its checks ran and the measured condition the battery ran
   *  under; with each family's `taskInputs`, the condition its issues were observed under. */
  scoringHash: string;
  checkTools: string | null;
  measuredCondition: string;
  /** The battery, one row per family. The totals are read off these rows rather than stored beside
   *  them, where the two could come to disagree. */
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

/** The battery an advance reads: the families it ran, with the scoring program, the check tools and
 *  the Built condition every one of them ran under. */
type MeasuredBattery = { families: readonly AdviceFamilyRow[] } & Pick<
  IssueCondition,
  "scoringHash" | "checkTools" | "measuredCondition"
>;

/** Standing issues the render shows, and the findings and claim length beside them. Unbounded, one
 *  unowned finding alone can run to fifteen thousand characters, and an author reading a defect
 *  list that long writes a defect fix. These three hold the packet at a few thousand characters
 *  whatever the battery did, while the register goes on recording every issue it derived. */
const RENDERED_ISSUES = 6;
const RENDERED_FINDINGS = 4;
const FINDING_CLAIM_BYTES = 600;

/** How the unmeasured line names each part of the condition that moved. */
const GAP_WORDS: Record<ConditionGap, string> = {
  "task-inputs": "task inputs",
  scoring: "scoring program",
  "check-tools": "check tools",
  "built-condition": "Built model or resources",
};

/** No complete recheck since its last observation, comparable or not, and a family still in the task
 *  set: an issue this battery observed, or one it carried because it could not recheck it. */
const unrechecked = (issue: AdviceIssue) =>
  !issue.retired && issue.absentBatteries === 0 && issue.unmeasured.length === 0;

/** Unrechecked, undisputed and not settled by an epoch review's probe. */
export const isStanding = (issue: AdviceIssue): boolean =>
  unrechecked(issue) && issue.dispute === null && issue.judgeSettled !== true;

const gapWords = (issue: AdviceIssue) => issue.unmeasured.map((gap) => GAP_WORDS[gap]).join(", ");

/** The register's facts about one issue as one phrase, for the readers that show them. */
export function issueFacts(issue: AdviceIssue): string {
  const rechecks = issue.absentBatteries;
  return [
    `first seen ${issue.firstSeenRunId}`,
    rechecks === 0
      ? `last seen ${issue.lastSeenRunId}`
      : `not observed in ${rechecks} complete recheck${rechecks === 1 ? "" : "s"} since ${issue.lastSeenRunId}`,
    issue.returned ? "seen again after an absence" : null,
    issue.unmeasured.length === 0 ? null : `latest recheck not comparable (${gapWords(issue)} changed)`,
    issue.retired ? "family left the task set" : null,
    issue.dispute === null ? null : "disputed",
    issue.judgeSettled === true ? "settled by an epoch review" : null,
  ]
    .filter((fact) => fact !== null)
    .join(", ");
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

function familyRows(analysis: IterationAnalysis, condition: BatteryCondition): AdviceFamilyRow[] {
  return [...familyTally(analysis.cases)]
    .map(([family, { verified, passed, unaccepted, nonResults }]) => ({
      family,
      verified,
      passed,
      unaccepted,
      nonResults,
      taskInputs: condition.familyInputs.get(family) ?? null,
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
  // A Judge disagreement a second sample repeated is advice by family; one the resample did not
  // repeat is the Judge's noise, not the battery's. The verifier still decides every pass.
  if (judges.census !== null) {
    const byFamily = new Map<string, { passedFailed: number; failedPassed: number }>();
    for (const row of judges.contested) {
      if (!row.confirmed) continue;
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

/** Advance the register by one battery: an observed issue resets its rechecks and remembers whether
 *  it came back, and an unobserved one counts a recheck only when every case of its family was
 *  verified on a comparable condition. A Judge issue that no complete Judge review could observe is
 *  carried unchanged, because an absent review is not evidence of absence. */
export function advanceIssues(
  previous: readonly AdviceIssue[],
  observed: readonly Observed[],
  runId: string,
  battery: MeasuredBattery,
  judgeReview: "complete" | "incomplete",
): AdviceIssue[] {
  const byFamily = new Map(battery.families.map((row) => [row.family, row] as const));
  const conditionOf = (family: string): IssueCondition => ({
    taskInputs: byFamily.get(family)?.taskInputs ?? null,
    scoringHash: battery.scoringHash,
    checkTools: battery.checkTools,
    measuredCondition: battery.measuredCondition,
  });
  const byId = new Map(previous.map((issue) => [issue.id, issue] as const));
  const seen = new Set<string>();
  const next: AdviceIssue[] = [];
  for (const entry of observed) {
    const id = adviceIssueId(entry.kind, entry.family, entry.detail);
    seen.add(id);
    const prior = byId.get(id);
    const now = conditionOf(entry.family);
    // Identity names no cause: a dispute an evaluator defect earned would otherwise suspend the
    // solver failure its repair now exposes.
    const same = prior !== undefined && conditionGaps(prior.observedUnder, now).length === 0;
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
      observedUnder: now,
      unmeasured: [],
      diagnosis: null,
      // Seen again on the same bytes, a disputed issue is still disputed: the dispute is about whose
      // defect the failure is, and seeing it a second time is not an answer to that question.
      dispute: same ? prior.dispute : null,
    });
  }
  for (const issue of previous) {
    if (seen.has(issue.id)) continue;
    next.push(agedIssue(issue, byFamily.get(issue.family), conditionOf(issue.family), judgeReview));
  }
  return next.sort(
    (a, b) =>
      a.family.localeCompare(b.family) ||
      a.kind.localeCompare(b.kind) ||
      (a.detail ?? "").localeCompare(b.detail ?? ""),
  );
}

/** `family` is the issue's family row in this battery, undefined when the family is not in it, and
 *  `now` the condition it ran under. Absence of the family retires the issue. Absence of the issue
 *  counts only when the family's recheck is complete, every case of it truth-verified with no
 *  non-result and no unaccepted attempt, because the case that exposed the issue may be the one left
 *  without a verdict. Otherwise the issue is carried unchanged, as the Judge branch below carries it
 *  for the same reason. A family that ran on another condition than the one that observed the issue
 *  leaves it unmeasured, with its recheck count where it was. */
function agedIssue(
  issue: AdviceIssue,
  family: AdviceFamilyRow | undefined,
  now: IssueCondition,
  judgeReview: "complete" | "incomplete",
): AdviceIssue {
  if (family === undefined) return { ...issue, retired: true, dispute: null };
  if (family.verified === 0 || family.unaccepted + family.nonResults > 0) return issue;
  if (issue.kind.startsWith("judge-") && judgeReview === "incomplete") return issue;
  // An issue the battery no longer shows carries no dispute: a dispute kept across batteries of
  // absence promises a withholding the controller is no longer applying.
  const unmeasured = conditionGaps(issue.observedUnder, now);
  const absentBatteries = issue.absentBatteries + (unmeasured.length === 0 ? 1 : 0);
  return { ...issue, absentBatteries, unmeasured, retired: false, dispute: null };
}

/** Attach what the two review readers said to the register this battery just advanced. They run
 *  after the packet is derived and before it is written, so the digest a rebuild binds covers the
 *  complete evidence packet, including readings whose prose the author must not see.
 *
 *  A dispute suspends an issue instead of closing it: the author is told not to rebuild around it,
 *  and the next battery still counts it. Only a standing issue can be suspended, because disputing
 *  one a complete recheck did not observe, or one retired, would resurrect it. */
export function attachIssueReadings(
  packet: RebuildAdvicePacket,
  readings: {
    diagnoses?: ReadonlyArray<{ issueIds: readonly string[]; diagnosis: IssueDiagnosis }>;
    disputes?: ReadonlyArray<{ issueId: string; reason: string }>;
    /** Judge issue ids the epoch review settled in the check's favour, one per settled case. */
    settled?: readonly string[];
  },
): RebuildAdvicePacket {
  // One reading may cover several issues, which is how the reader says two kinds in two families
  // are one harness flaw; each issue it names carries the same reading.
  const diagnosed = new Map(
    (readings.diagnoses ?? []).flatMap(({ issueIds, diagnosis }) =>
      issueIds.map((issueId) => [issueId, diagnosis] as const),
    ),
  );
  const disputed = new Map((readings.disputes ?? []).map((row) => [row.issueId, row.reason] as const));
  const settled = readings.settled ?? [];
  if (diagnosed.size === 0 && disputed.size === 0 && settled.length === 0) return packet;
  return {
    ...packet,
    issues: packet.issues.map((issue) => {
      const reading = diagnosed.get(issue.id);
      const standing = isStanding(issue);
      const dispute = standing ? disputed.get(issue.id) : undefined;
      // Settled once every case the issue counts is, so one settled case leaves its siblings standing.
      const settles =
        standing && dispute === undefined && settled.filter((id) => id === issue.id).length >= issue.count;
      if (reading === undefined && dispute === undefined && !settles) return issue;
      return {
        ...issue,
        ...(dispute === undefined ? null : { dispute }),
        ...(settles ? { judgeSettled: true as const } : null),
        ...(reading === undefined ? null : { diagnosis: reading }),
      };
    }),
  };
}

/** The recurrence key of an unplaced finding, which is the subject it named and nothing else. An
 *  environment finding has no key, and neither has an unplaced one naming no subject: two of those
 *  in consecutive packets are not the same observation recurring merely because both could not be
 *  placed. */
function unplacedIdentity(
  finding: Pick<AnalysisFinding, "owner" | "checkId" | "artifactSchemaPath" | "hostRule">,
): string | null {
  return finding.owner === null ? namedSubject(finding) : null;
}

/** How many consecutive packets have carried this unplaced finding, read off the previous packet's
 *  own findings. A separate history array said the same thing a second time, and an identity absent
 *  from one round already left the chain, so a reappearance after a gap counts from one again
 *  without anything having to remember the gap. */
function recurrence(previous: RebuildAdvicePacket | null, identity: string): AdviceFinding["repeated"] {
  const prior = (previous?.findings ?? []).find((finding) => unplacedIdentity(finding) === identity);
  if (previous === null || prior === undefined) return undefined;
  return { count: (prior.repeated?.count ?? 1) + 1, since: prior.repeated?.since ?? previous.runId };
}

export function deriveRebuildAdvice(
  analysis: IterationAnalysis,
  judges: JudgeReviewsResult,
  admission: AdmittedEvidence,
  previous: RebuildAdvicePacket | null,
  condition: BatteryCondition,
): RebuildAdvicePacket {
  const families = familyRows(analysis, condition);
  const observed = observedIssues(analysis, judges, families);
  const judgeReview = judges.provisional === null && judges.census !== null ? "complete" : "incomplete";
  return {
    schema: REBUILD_ADVICE_SCHEMA,
    slug: analysis.slug,
    runId: analysis.runId,
    analysisDigest: hashJsonBytes(analysis),
    backendPin: analysis.identities.backendPin,
    scoringHash: condition.scoringHash,
    checkTools: condition.checkTools,
    measuredCondition: condition.measuredCondition,
    families,
    blockingByCheck: analysis.battery.blockingByCheck,
    applicableByCheck: analysis.battery.applicableByCheck,
    issues: advanceIssues(
      previous?.issues ?? [],
      observed,
      analysis.runId,
      {
        families,
        scoringHash: condition.scoringHash,
        checkTools: condition.checkTools,
        measuredCondition: condition.measuredCondition,
      },
      judgeReview,
    ),
    // Advice only: counts and families, never task ids.
    judge:
      judges.census === null
        ? null
        : {
            exit: judges.exit.kind,
            reason: judges.exit.reason,
            contestedFamilies: [...new Set(judges.contested.map((row) => row.family))].sort(),
          },
    // Per-case findings never leave the controller, and these aggregate rows are already
    // author-visible by construction. A finding a bundle file holds reaches the same session again
    // as feedback to that file, so only the rows no file holds are new information here; the test
    // is the owner and not the rendered claim, because two findings may carry the same text and
    // dropping both because one routed would lose the one that did not.
    findings: admission.admitted.flatMap((finding) => {
      if (finding.subject !== undefined || isBundleFile(finding.owner)) return [];
      const identity = unplacedIdentity(finding);
      return [
        {
          owner: finding.owner,
          claim: finding.claim,
          ...keyIfDefined("checkId", finding.checkId),
          ...keyIfDefined("artifactSchemaPath", finding.artifactSchemaPath),
          ...keyIfDefined("hostRule", finding.hostRule),
          ...keyIfDefined("repeated", identity === null ? undefined : recurrence(previous, identity)),
        },
      ];
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
 *  `parseJsonAs`, because a rebuild must not author against bytes it could not read. A packet
 *  another schema wrote is a different fact — no register exists on this source yet — and every
 *  consumer already spells that as null: `advanceIssues` starts its register from `[]`,
 *  `recurrence` counts from one, the epoch reviewer is offered no standing issue and the advisory
 *  note carries no packet. Throwing on it instead would kill the first analyse step of every
 *  existing campaign the next time this schema changes, so `--project <existing>` could not
 *  continue. */
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
 *  missing credential, a sandbox refusal and their relatives to the environment owner, and the
 *  kinds are taken from the existing set beside that vocabulary rather than restated here. A crash,
 *  a protocol violation or a `verifier` kind stays the harness's to explain, because a tool that
 *  ran and died may well be a harness defect. The diagnosis reader offers none of these issues, and
 *  the issue line below names the split so the author is not told to rerun a failure it owns. */
export function environmentOwned(issue: AdviceIssue): boolean {
  // The shared set admits timeout only with solver-origin evidence at the battery boundary. This
  // aggregate issue carries no such provenance, and a verifier tool timeout can need author repair,
  // so timeout is excluded here rather than read as the environment's.
  return (
    issue.kind === "non-result" &&
    issue.detail !== "timeout" &&
    isNonResultKind(issue.detail) &&
    ENVIRONMENT_OWNED_NONRESULT_KINDS.has(issue.detail)
  );
}

function issueLine(issue: AdviceIssue): string {
  const kind = issue.detail ?? "unknown";
  // The line says which side of the split a non-result fell on, because rule 15 gives an
  // environment failure to the environment owner, and a `verifier` kind is not one.
  const nonResult = environmentOwned(issue)
    ? `environment non-results of kind ${kind}, owned by the environment`
    : `runtime non-results of kind ${kind}, a kind that does not establish an environment failure`;
  const words = issue.kind === "non-result" ? nonResult : ISSUE_WORDS[issue.kind];
  const diagnosis = issue.diagnosis === null ? "" : `\n  ${diagnosisLine(issue.diagnosis)}`;
  return `- ${issue.family}: ${issue.count}/${issue.denominator} ${words} (${issueFacts(issue)})${diagnosis}`;
}

/** The diagnosis as the author reads it: which file the failure points to, where the solve failed,
 *  and what would prove it wrong. The cause stays in review evidence, because the boundary and
 *  the falsifier are the parts a next pass can check against its own traces, and a causal paragraph
 *  is the part an author adopts without checking. The support counts say how far one reading was
 *  sampled, so a reading drawn from one case does not read like a pattern. */
export function diagnosisLine(diagnosis: IssueDiagnosis): string {
  const { support, boundary } = diagnosis;
  const contrasts =
    support.contrasts === 0
      ? ", no passing contrast"
      : `, ${support.contrasts} passing contrast${support.contrasts === 1 ? "" : "s"}`;
  const where = boundary.tool === null ? "at the solve's end" : `at a call to ${boundary.tool}`;
  const reading = /[.!?]$/.test(boundary.reading) ? boundary.reading : `${boundary.reading}.`;
  return `diagnosis (${diagnosis.runId}: holds for ${support.cases} of ${support.shown} sampled of ${support.matching} failing cases${contrasts}): ${diagnosis.owner}. First failure boundary ${where}: ${reading} Falsifier: ${diagnosis.falsifier}`;
}

/** What is failing now, largest first, capped. An issue a complete recheck did not observe is
 *  deliberately absent: which families passed every verified case is the climb readout's family
 *  line, and naming them here as well asks opposite things of one family — keep it, and harden it as
 *  a sentinel. A retired issue names a family that left the task set, which the author can neither
 *  move nor keep. The register records both either way, so an issue observed again says it returned. */
function standingLines(issues: readonly AdviceIssue[]): string[] {
  const standing = [...issues]
    .filter(isStanding)
    .sort((a, b) => b.count - a.count || a.family.localeCompare(b.family) || a.kind.localeCompare(b.kind));
  if (standing.length === 0) return [];
  const shown = standing.slice(0, RENDERED_ISSUES);
  const omitted = standing.length > shown.length ? ` (${shown.length} of ${standing.length} shown)` : "";
  return [`Standing issues, largest first${omitted}:`, ...shown.map(issueLine)];
}

/** Issues the latest battery could not measure, named as such. Left out, an issue that vanished
 *  when its family's tasks, its evaluator or its Built condition changed reads exactly like one a
 *  complete recheck did not observe, because that one is also absent from the standing lines. */
function unmeasuredLine(issues: readonly AdviceIssue[]): string | null {
  const unmeasured = issues.filter((issue) => !issue.retired && issue.unmeasured.length > 0);
  if (unmeasured.length === 0) return null;
  const shown = unmeasured
    .slice(0, RENDERED_ISSUES)
    .map((issue) => `${issue.family} (${issue.kind}: ${gapWords(issue)} changed)`);
  const more = unmeasured.length - shown.length;
  return `Unmeasured issues — absent from this battery, but their family did not rerun under the condition that observed them, so the absence is not a fix: ${shown.join("; ")}${more > 0 ? `; ${String(more)} more` : ""}.`;
}

/** Public finding text, capped in count and in length, in admitted order. A finding no bundle file
 *  holds is the row the controller could not route, so it is the row most likely to grow, and the
 *  cap therefore belongs to the boundary rather than to any one producer feeding it. */
function findingLines(findings: readonly AdviceFinding[]): string[] {
  const lines = findings.slice(0, RENDERED_FINDINGS).map((finding) => {
    const repeated =
      finding.repeated === undefined
        ? ""
        : ` (recurring: ${String(finding.repeated.count)} consecutive packets since ${finding.repeated.since})`;
    const claim = boundText(finding.claim, FINDING_CLAIM_BYTES).shown;
    return `- ${finding.owner ?? "unplaced"}: ${claim}${repeated}`;
  });
  const omitted = findings.length - lines.length;
  return omitted > 0
    ? [...lines, `- ${omitted} further admitted finding${omitted === 1 ? "" : "s"} omitted from this packet.`]
    : lines;
}

/** Which of the harness's own declared checks decided anything, on both sides. `truthCheckFiring`
 *  seeds its counter with every declared check at zero, so the zeros in the packet are the roster
 *  of checks that let every shipping artifact through. That roster is what a saturated battery is
 *  made of, and the family line cannot state it: a family reads as "raise its numbers" where a
 *  check reads as "this rule refused nothing". The roster then splits on the applicable count,
 *  because "refused nothing over 25 verified cases" and "no verified case posed it" ask for
 *  opposite repairs -- raise the rule, or give the battery a task that reaches it. Zero verified
 *  cases prove nothing about any check, so the roster stays silent until a battery has graded
 *  something. */
export function blockingLine(
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
  // The sentence is appended only when one check really does carry every failure; beside a single
  // failed case and six checks it would say nothing.
  const alone = blocked.length === 1 && blocked[0]?.[1] === verified - passed;
  const lines = [
    blocked.length === 0
      ? null
      : `Verified failures by declared check (${verified - passed} failed; a case may block on several): ${blocked.map(([checkId, count]) => `${checkId} ${count}`).join(", ")}.${alone ? " One check carrying every failure asks whether its rule is stated in the public contract before the count reads as solver capability." : ""}`,
    applied.length === 0
      ? null
      : `Declared checks that blocked no shipping artifact, with the verified cases each applied to (of ${verified}): ${applied.map((checkId) => `${checkId} ${applicableByCheck[checkId]}`).join(", ")}.`,
    unposed.length === 0
      ? null
      : `Declared checks no verified case posed, so this battery measured nothing about them: ${unposed.join(", ")}.`,
  ].filter((line): line is string => line !== null);
  // A check with no applicable count recorded lands in none of the three lists, so a roster of such
  // checks alone has nothing to say and must not leave an empty line behind.
  return lines.length === 0 ? null : lines.join("\n");
}

/** The one model-visible projection of the issue register: kinds and counts, ordered by what the
 *  next experiment decides. Each battery's measured counts belong to the climb readout, which
 *  renders above this packet, so they are not repeated here. */
export function renderRebuildAdvice(packet: RebuildAdvicePacket): string {
  const totals = adviceTotals(packet.families);
  const disputed = packet.issues.filter((issue) => issue.dispute !== null && !issue.retired);
  const settled = packet.issues.filter((issue) => unrechecked(issue) && issue.judgeSettled === true);
  return [
    ...standingLines(packet.issues),
    unmeasuredLine(packet.issues),
    disputed.length === 0
      ? null
      : `Disputed issues — an epoch review argued these come from the evaluation rather than the harness: ${disputed.map((issue) => `${issue.family} (${issue.kind})`).join("; ")}.`,
    settled.length === 0
      ? null
      : `Settled Judge disagreements — an epoch review showed by execution that the check stands: ${settled.map((issue) => `${issue.family} (${issue.kind})`).join("; ")}.`,
    blockingLine(packet.blockingByCheck, packet.applicableByCheck, totals.verified, totals.passed),
    packet.judge === null || packet.judge.exit === "none"
      ? null
      : `Judge review: ${packet.judge.reason}${packet.judge.contestedFamilies.length > 0 ? ` (families: ${packet.judge.contestedFamilies.join(", ")})` : ""}.`,
    ...findingLines(packet.findings),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
