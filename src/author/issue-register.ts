/**
 * The issue register: what each battery recorded about every failure it showed, and what each later
 * battery did to the record. It is derived from the rows the round already wrote, in place of a
 * model-written repair hypothesis, and `rebuild-advice.ts` carries it to the next-experiment author.
 *
 * An issue is recorded facts and no lifecycle. `firstSeenRunId` and `lastSeenRunId` say where it
 * was observed, `absentBatteries` counts the later batteries that verified its whole family on a
 * comparable condition without observing it, `unmeasured` names what moved when the latest such
 * battery was not comparable, `rulesChangedRechecks` counts the rechecks that ran under changed public
 * rules, `returned` says it was observed again after an absence, and `retired` says the family
 * left the task set. Nothing turns them into "fixed" or "regressed": identity is
 * `kind + family + detail`, which names where a failure showed and not what caused it, so an
 * absence is a failure not seen again and never a repair, and a failure under one id on other task
 * inputs is a first sighting there: `firstSeenRunId` and `returned` hold only across the same tasks.
 * `issueFacts` states them as one phrase.
 * Comparable means the family's tasks, hidden expectations included, the checks (the verdict
 * closure, not the brief's prose), the tools they ran and the Built condition all match the battery
 * that last observed the issue (`issue-condition.ts`). A recheck whose public rules changed, in words or
 * in numbers, is credited and named as such, because it answers whether the repair held and not
 * whether the issue persists.
 * Identity deliberately excludes the harness, which is what lets one issue be followed across a
 * rebuild.
 *
 * The family is a label the author gave the failing tasks, and the author relabels, so a family name
 * missing from a battery does not say the issue went away. It says so only when the tasks went too.
 * While any task the issue was observed under still runs under another name, nothing has asked those
 * tasks about the issue again: it is held as unmeasured, with the label among what moved, and
 * `continuedUnder` names where the tasks went. Once none of them runs anywhere the issue is retired,
 * and it stays retired until its own family name comes back.
 *
 * Only `diagnosis` and `dispute` are written from outside, through `attachIssueReadings` after the
 * packet is derived, and neither changes a count or any decision, so the register stays
 * controller-owned.
 */
import { sha256 } from "../meta/digest.ts";
import { canonicalJson } from "../meta/stable-json.ts";
import { BRIEF_FILE, GENERATED_TOOLS_FILE, TOOLS_SPEC_FILE } from "../meta/bundle-layout.ts";
import { BUILT_AGENTS_FILE } from "../solve/built-starter.ts";
import { HARNESS_CONFIG_FILE } from "../correctness-bundle/harness-config.ts";
import type { BundleFile } from "./feedback-routing.ts";
import {
  type ConditionGap,
  type FamilyTasks,
  type IssueCondition,
  type SharedCondition,
  conditionGaps,
  publicRulesMoved,
} from "./issue-condition.ts";

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
  /** The first battery to observe it on the task inputs it was last observed under. */
  firstSeenRunId: string;
  lastSeenRunId: string;
  /** Complete rechecks since `lastSeenRunId`: later batteries on a comparable condition in which
   *  every case of the family was truth-verified and the issue was absent. A partial recheck counts
   *  nothing, since the case left without a verdict may be the one that failed. */
  absentBatteries: number;
  /** Of `absentBatteries`, the rechecks that ran under public rules other than the observing
   *  battery's. The checks were the same, so the absence says whether the repair held under the new
   *  rules and not whether the issue persists under the old. */
  rulesChangedRechecks: number;
  /** Some observation after the first, on the same task inputs, followed a complete recheck that
   *  did not observe it. */
  returned: boolean;
  /** The family left the task set, so this battery could not observe the issue: its name is gone and
   *  none of its tasks runs under another. That is a separate fact from absence: counted as a
   *  recheck, it would say the failure was not seen again on tasks no battery posed. */
  retired: boolean;
  /** The condition of the battery that last observed the issue, which every later absence is
   *  compared against. Its `taskIds` are what a renamed family is found by. */
  observedUnder: IssueCondition;
  /** What moved when the latest battery that ran the family, or its tasks under another name,
   *  without the issue was not comparable; empty otherwise. Non-empty, the absence is unmeasured
   *  rather than a recheck: identical inputs under a weaker evaluator, or other inputs altogether,
   *  make an issue vanish unrepaired. Changed public rules over unchanged checks are not a gap (see
   *  `rulesChangedRechecks`). */
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

/** One family of one battery: its tally, and the tasks it ran. */
export type AdviceFamilyRow = {
  family: string;
  verified: number;
  passed: number;
  unaccepted: number;
  nonResults: number;
} & FamilyTasks;

export type Observed = Pick<AdviceIssue, "kind" | "family" | "detail" | "count" | "denominator">;

/** The battery an advance reads: the families it ran, with the scoring program, the check tools and
 *  the Built condition every one of them ran under. */
type MeasuredBattery = { families: readonly AdviceFamilyRow[] } & SharedCondition;

/** How the unmeasured line names each part of the condition that moved. */
const GAP_WORDS: Record<ConditionGap, string> = {
  "task-inputs": "task inputs",
  scoring: "scoring program",
  "check-tools": "check tools",
  "built-condition": "Built model or resources",
};

/** What a recheck that ran under the observing battery's checks and other public rules is called. */
export const RULES_CHANGED_WORDS = "rechecked under unchanged checks, public rules changed";

/** No complete recheck since its last observation, comparable or not, and a family still in the task
 *  set: an issue this battery observed, or one it carried because it could not recheck it. */
export const unrechecked = (issue: AdviceIssue) =>
  !issue.retired && issue.absentBatteries === 0 && issue.unmeasured.length === 0;

/** Unrechecked, undisputed and not settled by an epoch review's probe. */
export const isStanding = (issue: AdviceIssue): boolean =>
  unrechecked(issue) && issue.dispute === null && issue.judgeSettled !== true;

export const gapWords = (issue: AdviceIssue) => issue.unmeasured.map((gap) => GAP_WORDS[gap]).join(", ");

/** The register's facts about one issue as one phrase, for the readers that show them. */
export function issueFacts(issue: AdviceIssue): string {
  const rechecks = issue.absentBatteries;
  const changed = issue.rulesChangedRechecks;
  return [
    `first seen ${issue.firstSeenRunId}`,
    rechecks === 0
      ? `last seen ${issue.lastSeenRunId}`
      : `not observed in ${rechecks} complete recheck${rechecks === 1 ? "" : "s"} since ${issue.lastSeenRunId}`,
    changed > 0 ? `${changed === rechecks ? "" : `${changed} of them `}${RULES_CHANGED_WORDS}` : null,
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

/** Where a family's tasks went when its name is not in `families`: the families that now run any task
 *  the issue was observed under, in name order. Empty when the name is there, because that family was
 *  measured whatever its tasks did, and empty when none of the tasks runs at all. */
export function continuedUnder(issue: AdviceIssue, families: readonly AdviceFamilyRow[]): string[] {
  if (families.some((row) => row.family === issue.family)) return [];
  const observed = new Set(issue.observedUnder.taskIds);
  return families.flatMap((row) => (row.taskIds.some((id) => observed.has(id)) ? [row.family] : [])).sort();
}

/** Advance the register by one battery: an observed issue resets its rechecks and remembers whether
 *  it came back on the same tasks, and an unobserved one counts a recheck only when every case of its family was
 *  verified on a comparable condition. A Judge issue that no complete Judge review could observe is
 *  carried unchanged, because an absent review is not evidence of absence. */
export function advanceIssues(
  previous: readonly AdviceIssue[],
  observed: readonly Observed[],
  runId: string,
  battery: MeasuredBattery,
  judgeReview: "complete" | "incomplete",
): AdviceIssue[] {
  const { families, ...shared } = battery;
  const byFamily = new Map(families.map((row) => [row.family, row] as const));
  const conditionOf = (family: string): IssueCondition => ({
    ...shared,
    taskIds: byFamily.get(family)?.taskIds ?? [],
    taskInputs: byFamily.get(family)?.taskInputs ?? null,
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
    const same =
      prior !== undefined &&
      conditionGaps(prior.observedUnder, now).length === 0 &&
      !publicRulesMoved(prior.observedUnder, now);
    // The id also names a failure on other task records, which is a first sighting and no return: no
    // recheck of the earlier tasks missed it. Tasks that could not be vouched for compare with nothing.
    const sameTasks =
      prior !== undefined &&
      prior.observedUnder.taskInputs !== null &&
      prior.observedUnder.taskInputs === now.taskInputs;
    next.push({
      id,
      ...entry,
      firstSeenRunId: sameTasks ? prior.firstSeenRunId : runId,
      lastSeenRunId: runId,
      absentBatteries: 0,
      rulesChangedRechecks: 0,
      returned: sameTasks && (prior.absentBatteries > 0 || prior.returned),
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
    const family = byFamily.get(issue.family);
    const now = conditionOf(issue.family);
    next.push(
      family === undefined
        ? leftTheBattery(issue, now, families)
        : agedIssue(issue, family, now, judgeReview),
    );
  }
  return next.sort(
    (a, b) =>
      a.family.localeCompare(b.family) ||
      a.kind.localeCompare(b.kind) ||
      (a.detail ?? "").localeCompare(b.detail ?? ""),
  );
}

/** An issue whose family name is not in this battery, `now` being the condition that name ran under,
 *  which is none. Retired when its tasks left with it. When they run on under another name nothing has
 *  asked them about the issue, so it is held unmeasured, its recheck count where it was, and `now`
 *  names the label among what moved. A retired issue stays retired: only its own name back in a
 *  battery brings it out, so tasks that later reach another family do not resurrect it. */
function leftTheBattery(
  issue: AdviceIssue,
  now: IssueCondition,
  families: readonly AdviceFamilyRow[],
): AdviceIssue {
  if (issue.retired) return issue;
  const held = continuedUnder(issue, families).length > 0;
  return {
    ...issue,
    retired: !held,
    unmeasured: held ? conditionGaps(issue.observedUnder, now) : [],
    dispute: null,
  };
}

/** `family` is the issue's family row in this battery, and `now` the condition it ran under. Absence
 *  of the issue counts only when the family's recheck is complete, every case of it truth-verified
 *  with no non-result and no unaccepted attempt, because the case that exposed the issue may be the
 *  one left without a verdict. Otherwise the issue is carried unchanged, as the Judge branch below
 *  carries it for the same reason. A family that ran on another condition than the one that observed
 *  the issue leaves it unmeasured, with its recheck count where it was. */
function agedIssue(
  issue: AdviceIssue,
  family: AdviceFamilyRow,
  now: IssueCondition,
  judgeReview: "complete" | "incomplete",
): AdviceIssue {
  if (family.verified === 0 || family.unaccepted + family.nonResults > 0) return issue;
  if (issue.kind.startsWith("judge-") && judgeReview === "incomplete") return issue;
  // An issue the battery no longer shows carries no dispute: a dispute kept across batteries of
  // absence promises a withholding the controller is no longer applying.
  const unmeasured = conditionGaps(issue.observedUnder, now);
  const comparable = unmeasured.length === 0;
  return {
    ...issue,
    absentBatteries: issue.absentBatteries + (comparable ? 1 : 0),
    rulesChangedRechecks:
      issue.rulesChangedRechecks + (comparable && publicRulesMoved(issue.observedUnder, now) ? 1 : 0),
    unmeasured,
    retired: false,
    dispute: null,
  };
}

/** Attach what the two review readers said to the register this battery just advanced. They run
 *  after the packet is derived and before it is written, so the digest a rebuild binds covers the
 *  complete evidence packet, including readings whose prose the author must not see.
 *
 *  A dispute suspends an issue instead of closing it: the author is told not to rebuild around it,
 *  and the next battery still counts it. Only a standing issue can be suspended, because disputing
 *  one a complete recheck did not observe, or one retired, would resurrect it. */
export function attachIssueReadings<Packet extends { issues: AdviceIssue[] }>(
  packet: Packet,
  readings: {
    diagnoses?: ReadonlyArray<{ issueIds: readonly string[]; diagnosis: IssueDiagnosis }>;
    disputes?: ReadonlyArray<{ issueId: string; reason: string }>;
    /** Judge issue ids the epoch review settled in the check's favour, one per settled case. */
    settled?: readonly string[];
  },
): Packet {
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
