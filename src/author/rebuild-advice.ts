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
 * The register itself, what it records about an issue and how a battery ages it, is
 * `issue-register.ts`, and the condition its comparisons read is `issue-condition.ts`. This module
 * derives one battery's packet from the rows, carries the register in it, reads and writes it, and
 * renders it. Everything the rows already determine is derived rather than stored — the battery's
 * totals, and how many consecutive packets have carried an unplaced finding.
 *
 * `renderRebuildAdvice` is the model-visible boundary, bounded by construction rather than by a
 * ceiling that cuts mid-sentence: `RENDERED_ISSUES` standing issues, `RENDERED_FINDINGS` findings
 * and `FINDING_CLAIM_BYTES` per claim. A diagnosis crosses as its owner, boundary and falsifier,
 * which the diagnosis reader drew from solver traces and public context alone; its causal argument
 * stays recorded here. The packet records the ids of the tasks each family ran, so that a renamed
 * family can be found; the render never prints one, and names the families the tasks went to.
 */
import { boundText } from "../meta/bounded-text.ts";
import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { join } from "../meta/path.ts";
import { hashJsonBytes, parseJsonAs } from "../meta/json-runtime.ts";
import { familyTally } from "../claim/case-record.ts";
import { isEnvironmentOwnedNonResult } from "../claim/record-events.ts";
import {
  namedSubject,
  type AdmittedEvidence,
  type AnalysisFinding,
  type IterationAnalysis,
} from "../analyse/iteration-analysis.ts";
import type { JudgeReviewsResult } from "../analyse/judge-reviews.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { isBundleFile } from "./feedback-routing.ts";
import type { BatteryCondition, FamilyTasks, SharedCondition } from "./issue-condition.ts";
import {
  type AdviceFamilyRow,
  type AdviceIssue,
  type IssueDiagnosis,
  type Observed,
  RULES_CHANGED_WORDS,
  advanceIssues,
  continuedUnder,
  gapWords,
  isStanding,
  issueFacts,
  unrechecked,
} from "./issue-register.ts";

export const REBUILD_ADVICE_SCHEMA = "rebuild-advice/v13";
const REBUILD_ADVICE_LATEST = "rebuild-advice-latest.json";

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
  /** The scoring program, the executable identity of its checks and the public rules beside it, the
   *  tools those checks ran and the measured condition the battery ran under; with each family's
   *  tasks, the condition its issues were observed under. */
  condition: SharedCondition;
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

/** Standing issues the render shows, and the findings and claim length beside them. Unbounded, one
 *  unowned finding alone can run to fifteen thousand characters, and an author reading a defect
 *  list that long writes a defect fix. These three hold the packet at a few thousand characters
 *  whatever the battery did, while the register goes on recording every issue it derived. */
const RENDERED_ISSUES = 6;
const RENDERED_FINDINGS = 4;
const FINDING_CLAIM_BYTES = 600;

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

function familyRows(
  analysis: IterationAnalysis,
  familyTasks: ReadonlyMap<string, FamilyTasks>,
): AdviceFamilyRow[] {
  return [...familyTally(analysis.cases)]
    .map(([family, { verified, passed, unaccepted, nonResults }]) => ({
      family,
      verified,
      passed,
      unaccepted,
      nonResults,
      ...(familyTasks.get(family) ?? { taskIds: [], taskInputs: null }),
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
  // A Judge fail of a verifier pass a second sample repeated is advice by family, and one the
  // resample did not repeat is the Judge's noise, not the battery's. A Judge pass of a verifier fail
  // is advice on its one sample, which is all it draws. The verifier still decides every pass.
  if (judges.census !== null) {
    const byFamily = new Map<string, { passedFailed: number; failedPassed: number }>();
    for (const row of judges.contested) {
      const side =
        row.kind === "disputed-pass" ? "passedFailed" : row.kind === "veto" ? "failedPassed" : null;
      if (side === null) continue;
      const entry = byFamily.get(row.family) ?? { passedFailed: 0, failedPassed: 0 };
      entry[side] += 1;
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
  const { familyTasks, ...shared } = condition;
  const families = familyRows(analysis, familyTasks);
  const observed = observedIssues(analysis, judges, families);
  const judgeReview = judges.outcome.kind === "read" ? "complete" : "incomplete";
  return {
    schema: REBUILD_ADVICE_SCHEMA,
    slug: analysis.slug,
    runId: analysis.runId,
    analysisDigest: hashJsonBytes(analysis),
    backendPin: analysis.identities.backendPin,
    condition: shared,
    families,
    blockingByCheck: analysis.battery.blockingByCheck,
    applicableByCheck: analysis.battery.applicableByCheck,
    issues: advanceIssues(
      previous?.issues ?? [],
      observed,
      analysis.runId,
      { families, ...shared },
      judgeReview,
    ),
    // Advice only: counts and families. The task ids sit in the family rows and each issue's
    // condition, which nothing renders.
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
    issue.kind === "non-result" && issue.detail !== "timeout" && isEnvironmentOwnedNonResult(issue.detail)
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
 *  complete recheck did not observe, because that one is also absent from the standing lines. A
 *  family whose name left the battery says where its tasks went, so the author reads a relabelled
 *  family as one and not as a failure that disappeared. */
function unmeasuredLine(issues: readonly AdviceIssue[], families: readonly AdviceFamilyRow[]): string | null {
  const unmeasured = issues.filter((issue) => !issue.retired && issue.unmeasured.length > 0);
  if (unmeasured.length === 0) return null;
  const shown = unmeasured.slice(0, RENDERED_ISSUES).map((issue) => {
    const moved = continuedUnder(issue, families);
    const where = moved.length === 0 ? "" : `; its tasks now run under ${moved.join(", ")}`;
    return `${issue.family} (${issue.kind}: ${gapWords(issue)} changed${where})`;
  });
  const more = unmeasured.length - shown.length;
  return `Unmeasured issues — absent from this battery, but their family did not rerun under the condition that observed them, so the absence is not a fix: ${shown.join("; ")}${more > 0 ? `; ${String(more)} more` : ""}.`;
}

/** Issues every one of whose complete rechecks followed a change of the public rules, with the latest
 *  battery on unchanged checks. They stay out of the standing lines like any rechecked issue, and the
 *  change is named here because it changes what the absence answers: whether the repair held under the
 *  new rules, not whether the issue persists under the old. */
function rulesChangedLine(issues: readonly AdviceIssue[]): string | null {
  const changed = issues.filter(
    (issue) =>
      !issue.retired &&
      issue.unmeasured.length === 0 &&
      issue.rulesChangedRechecks > 0 &&
      issue.rulesChangedRechecks === issue.absentBatteries,
  );
  if (changed.length === 0) return null;
  const shown = changed.slice(0, RENDERED_ISSUES).map((issue) => `${issue.family} (${issue.kind})`);
  const more = changed.length - shown.length;
  return `Issues ${RULES_CHANGED_WORDS} — absent from every recheck, but the public rules, in words or numbers, differed from the battery that observed them, so the absence says whether the repair held under the new rules, not whether the issue persists: ${shown.join("; ")}${more > 0 ? `; ${String(more)} more` : ""}.`;
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
    unmeasuredLine(packet.issues, packet.families),
    rulesChangedLine(packet.issues),
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
