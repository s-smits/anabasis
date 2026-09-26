/**
 * `bun run replay -- <campaign>/<runId> [--out /private/tmp/.../replay.json]`
 *
 * Re-grade one recorded battery's accepted artifacts through THIS tree's verifier and diff the
 * verdicts against the recorded ones. The candidate bytes are fixed: the recorded bundle snapshot
 * (brief, evaluator, tasks, tool tree) and each case's recorded final submission. The source tree
 * is the checkout this command runs in — its `src/truth` and `src/verify` decide tool attestation,
 * walls and tool resolution — so comparing two trees is two invocations and a diff of their
 * reports. No model is called: each case runs `gradeCase`, the same entry the measured battery
 * used. The report is one JSON document on stdout, and also in the `--out` file when one is named;
 * it names the commit of the tree that graded it, and each replayed row carries the check rows its
 * grading reached. Process cleanup receipts stay in the campaign.
 */
import { campaignRoot } from "../../src/meta/campaign-root.ts";
import {
  BUNDLE_SNAPSHOT_DIRECTORY,
  EARLIER_BUNDLE_SNAPSHOT_DIRECTORY,
  bundleSnapshotToolTree,
} from "../../src/claim/bundle-snapshot.ts";
import { tracePointerPath } from "../../src/claim/case-record.ts";
import { recordedEvidence, verifyRunDir } from "../../src/claim/evidence-log.ts";
import { campaignTraceRoots } from "../../src/claim/trace-read.ts";
import { existsSync, readFileSync } from "../../src/meta/filesystem.ts";
import { parseJsonAs, capturedJsonParse } from "../../src/meta/json-runtime.ts";
import { isString } from "../../src/meta/json-shape.ts";
import { dirname, join, resolve } from "../../src/meta/path.ts";
import { BRIEF_FILE, TASKS_FILE } from "../../src/meta/bundle-layout.ts";
import { assertPathSegment } from "../../src/meta/path-segment.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import type { FinalSubmission } from "../../src/solve/final-submission.ts";
import {
  type BundleSnapshotFact,
  type CaseRecord,
  readRecordedBatteryRecord,
} from "../../src/truth/battery-record.ts";
import { type Brief, externalChecksOf } from "../../src/truth/brief.ts";
import { validateBrief } from "../../src/truth/brief-validator.ts";
import { loadCorrectnessModel } from "../../src/truth/contracts.ts";
import { type GradeCaseDeps, gradeCase } from "../../src/truth/solve-case.ts";
import { evaluateCheckProgram } from "../../src/truth/predicate.ts";
import { campaignVerifierLifetime } from "../../src/run/verifier-lifetime.ts";
import { applicableCheckIds } from "../../src/truth/run-controls.ts";
import { commitPublicTask } from "../../src/truth/task-split.ts";
import { type BuildTask, type TaskBattery, validateTasks } from "../../src/truth/tasks.ts";
import { blockingFailedCheckIds, publicTaskVerdict } from "../../src/truth/verdict-binding.ts";
import { resolveVerifier } from "../../src/truth/verification-registry.ts";
import type { CheckRun, CorrectnessModelResult } from "../../src/verify/correctness-model-result.ts";
import { SOURCE_IDENTITY } from "../../src/run/source-identity.ts";
import { writeJsonFile } from "../../src/meta/completed-json.ts";
import { VerifierOperationalStop, type VerifierCleanup } from "../../src/verify/verifier-lifetime.ts";

export const USAGE = [
  "usage: replay <campaignDir>/<runId> [--out <report.json>]",
  "",
  "<campaignDir> is a path, or a name under ./campaigns. The recorded battery is searched under",
  "the campaign, its domains/ sibling and its candidates/, contest/ and promotions/ children.",
].join("\n");

// --- Recorded side -----------------------------------------------------------------------------

export interface VerdictSide {
  truthOk: boolean | null;
  pass: boolean | null;
  nonResultKind: string | null;
  /** The recorded or replayed non-result message; compared by kind only. */
  nonResult: string | null;
  failedCheckIds: string[];
}

/** One replayed verdict row. `nonResultKind` names a host or verifier non-result, or one of the
 *  replay-owned refusals `task-missing`, `public-task-drift` and `not-replayed`. */
type ReplayVerdict = VerdictSide & { taskId: string; checkRuns?: CheckRun[] };

interface RecordedCandidate {
  campaignDir: string;
  slugDir: string;
  runId: string;
  runDir: string;
  candidateDir: string;
  bundleSnapshot: BundleSnapshotFact;
  cases: CaseRecord[];
}

interface ReplayCase {
  taskId: string;
  /** Digest of the committed public task the battery recorded; the snapshot task is recommitted
   *  and grading refuses when the digests differ. */
  publicTaskDigest: string;
  /** The recorded `final-submission.json` fact, carrying the accepted artifact bytes. */
  finalSubmission: FinalSubmission;
}

/** The accepted cases with their recorded verdict side and the artifact each replays. */
interface RecordedCases {
  sides: Map<string, VerdictSide>;
  cases: ReplayCase[];
  skippedUnaccepted: string[];
}

// --- Replayed side -------------------------------------------------------------------------------

interface CandidateContract {
  brief: Brief;
  tasks: BuildTask[];
}

interface Replayed {
  rows: ReplayVerdict[];
  /** Declared external tools this tree could not resolve under the candidate tool tree or PATH. */
  missingTools: string[];
  /** Digest and source of every tool that ran, keyed by tool id. */
  tools: Record<string, { digest: string; source: string }>;
  cleanup: VerifierCleanup;
}

// --- Diff ----------------------------------------------------------------------------------------

export interface ReplayRow {
  taskId: string;
  recorded: VerdictSide;
  replayed: VerdictSide;
  same: boolean;
  /** The check rows the replayed grading reached, in order; empty when it graded nothing. */
  checkRuns: CheckRun[];
}

interface ReplaySummary {
  cases: number;
  same: number;
  changed: number;
  /** Replayed rows that reached no verdict, whatever the recorded side said. */
  nonResults: number;
  skippedUnaccepted: number;
}

interface ReplayDiff {
  rows: ReplayRow[];
  summary: ReplaySummary;
}

/** Locate the recorded battery and the immutable bundle snapshot the battery names. */
export function resolveRecordedCandidate(candidate: string, cwd: string): RecordedCandidate {
  const slash = candidate.lastIndexOf("/");
  if (slash <= 0 || slash === candidate.length - 1) {
    throw new Error(`expected <campaignDir>/<runId>, received ${JSON.stringify(candidate)}\n\n${USAGE}`);
  }
  const campaignPart = candidate.slice(0, slash);
  const runId = candidate.slice(slash + 1);
  assertPathSegment("runId", runId);
  const direct = resolve(cwd, campaignPart);
  const campaignDir = existsSync(direct) ? direct : join(campaignRoot(cwd), campaignPart);
  const roots = campaignTraceRoots(campaignDir);
  // Sol33 retained the old domain battery after promotion moved its snapshot to the archive.
  // Resolve a complete pair at one contained root; damaged evidence still refuses immediately.
  for (const slugDir of roots) {
    if (tracePointerPath(slugDir, `runs/${runId}/battery.json`) === null) continue;
    const runDir = join(slugDir, "runs", runId);
    const battery = readRecordedBatteryRecord(runDir, runId);
    const fact =
      /* SAFETY: records before 2026-08-31 name the snapshot `sealedBundle`; both spellings are checked for an id below. */
      (battery.bundleSnapshot ?? (battery as { sealedBundle?: BundleSnapshotFact }).sealedBundle) as
        | Partial<BundleSnapshotFact>
        | undefined;
    if (!isString(fact?.id)) throw new Error(`${runDir}/battery.json names no bundle snapshot`);
    assertPathSegment("bundle snapshot", fact.id);
    const brief = [BUNDLE_SNAPSHOT_DIRECTORY, EARLIER_BUNDLE_SNAPSHOT_DIRECTORY]
      .map((directory) => tracePointerPath(slugDir, `${directory}/${fact.id}/correctness-model/brief.json`))
      .find((path) => path !== null);
    if (brief === undefined) continue;
    return {
      campaignDir,
      slugDir,
      runId,
      runDir,
      candidateDir: dirname(dirname(brief)),
      bundleSnapshot:
        /* SAFETY: the id was checked above; the hash fields are carried as the record wrote them and only echoed into the verifier snapshot. */ fact as BundleSnapshotFact,
      cases: battery.cases,
    };
  }
  throw new Error(
    `no complete recorded battery and bundle snapshot for runs/${runId}/battery.json under ${roots.join(", ")}`,
  );
}

function recordedJson<T>(runDir: string, rel: string, violations: ReturnType<typeof verifyRunDir>): T | null {
  const read = recordedEvidence(runDir, rel, violations);
  return read.ok ? parseJsonAs<T>(read.bytes) : null;
}

function recordedSide(row: CaseRecord, verdict: CorrectnessModelResult | null): VerdictSide {
  return {
    truthOk: row.truthOk,
    pass: row.pass,
    nonResultKind: row.runtimeNonResultKind,
    nonResult: row.runtimeNonResult,
    failedCheckIds: verdict === null ? [] : [...blockingFailedCheckIds(verdict)].sort(),
  };
}

export function recordedCases(recorded: RecordedCandidate): RecordedCases {
  const violations = verifyRunDir(recorded.runDir);
  const sides = new Map<string, VerdictSide>();
  const cases: ReplayCase[] = [];
  const skippedUnaccepted: string[] = [];
  for (const row of recorded.cases) {
    const prefix = `cases/${row.taskId}`;
    const finalSubmission = recordedJson<FinalSubmission>(
      recorded.runDir,
      `${prefix}/final-submission.json`,
      violations,
    );
    const publicTask = recordedJson<{ publicTaskDigest: string }>(
      recorded.runDir,
      `${prefix}/public-task.json`,
      violations,
    );
    if (!row.acceptedSubmit || finalSubmission?.accepted !== true || publicTask === null) {
      skippedUnaccepted.push(row.taskId);
      continue;
    }
    sides.set(
      row.taskId,
      recordedSide(
        row,
        recordedJson<CorrectnessModelResult>(recorded.runDir, `${prefix}/verifier.json`, violations),
      ),
    );
    cases.push({ taskId: row.taskId, publicTaskDigest: publicTask.publicTaskDigest, finalSubmission });
  }
  return { sides, cases, skippedUnaccepted };
}

function loadContract(candidateDir: string): CandidateContract {
  const briefUnknown = capturedJsonParse(readFileSync(join(candidateDir, BRIEF_FILE), "utf8"));
  const briefValidation = validateBrief(briefUnknown);
  if (!briefValidation.ok) {
    throw new Error(`brief.json: ${briefValidation.findings.map((finding) => finding.detail).join("; ")}`);
  }
  const brief =
    /* SAFETY: validateBrief returned ok directly above, the only proof of this shape. */ briefUnknown as Brief;
  // Held at `unknown` on purpose: validateTasks below is the only proof these bytes are a battery.
  const tasksUnknown: unknown = capturedJsonParse(readFileSync(join(candidateDir, TASKS_FILE), "utf8"));
  const battery = { tasks: tasksUnknown };
  const tasksValidation = validateTasks(brief, battery, {});
  if (!tasksValidation.ok) {
    throw new Error(`tasks.json: ${tasksValidation.findings.map((finding) => finding.detail).join("; ")}`);
  }
  return {
    brief,
    tasks:
      /* SAFETY: validateTasks returned ok directly above, the only proof of this shape. */ battery.tasks as TaskBattery["tasks"],
  };
}

function refused(taskId: string, nonResultKind: string): ReplayVerdict {
  return { taskId, truthOk: null, pass: null, nonResultKind, nonResult: nonResultKind, failedCheckIds: [] };
}

async function replayOne(
  deps: Omit<GradeCaseDeps, "applicableIds">,
  task: BuildTask,
  recorded: ReplayCase,
): Promise<ReplayVerdict> {
  const committed = commitPublicTask(task);
  if (committed.publicTaskDigest !== recorded.publicTaskDigest) {
    return refused(task.taskId, "public-task-drift");
  }
  const instant = new Date().toISOString();
  const graded = await gradeCase(
    { ...deps, applicableIds: applicableCheckIds(deps.brief, task) },
    {
      task,
      committed,
      // The solve side already happened and is not replayed: an empty outcome names no blocker,
      // so gradeCase reads the recorded final submission exactly as the battery did.
      solved: { turns: 0, completedTurns: 0, errors: [] },
      final: recorded.finalSubmission,
      finalDefect: null,
      acceptedSubmit: recorded.finalSubmission.accepted,
      instants: { startedAt: instant, endedAt: instant },
    },
  );
  return {
    ...publicTaskVerdict(task.taskId, graded.record, graded.verdict),
    nonResult: graded.record.runtimeNonResult,
    checkRuns: graded.checkRuns,
  };
}

async function replayCases(recorded: RecordedCandidate, cases: readonly ReplayCase[]): Promise<Replayed> {
  const { brief, tasks } = loadContract(recorded.candidateDir);
  const verifierLifetime = campaignVerifierLifetime(recorded.campaignDir);
  let result: Omit<Replayed, "cleanup">;
  let cleanup: VerifierCleanup;
  try {
    const evaluate = evaluateCheckProgram(
      brief,
      await loadCorrectnessModel(recorded.candidateDir, verifierLifetime),
    );
    const externalChecks = externalChecksOf(brief);
    const { verifier, missingTools } = resolveVerifier({
      toolTree: bundleSnapshotToolTree(recorded.candidateDir),
      bundleDir: recorded.candidateDir,
      toolIds: externalChecks.map((check) => check.adapterId),
      verifierLifetime,
    });
    const deps = { brief, evaluate, verifier, runId: recorded.runId, externalChecks, verifierLifetime };
    const byId = new Map(tasks.map((task) => [task.taskId, task]));
    const rows: ReplayVerdict[] = [];
    for (const one of cases) {
      const task = byId.get(one.taskId);
      rows.push(task === undefined ? refused(one.taskId, "task-missing") : await replayOne(deps, task, one));
      try {
        verifierLifetime.assertUsable();
      } catch (cause) {
        if (!(cause instanceof VerifierOperationalStop)) throw cause;
        break;
      }
    }
    const tools: Replayed["tools"] = {};
    for (const [id, entry] of Object.entries(verifier.tools())) {
      tools[id] = { digest: entry.digest, source: entry.source };
    }
    result = { rows, missingTools, tools };
  } finally {
    const receiptIds = await verifierLifetime.close();
    cleanup = receiptIds.length === 0 ? { state: "complete" } : { state: "pending", receiptIds };
  }
  return { ...result, cleanup };
}

function sameSide(a: VerdictSide, b: VerdictSide): boolean {
  return (
    a.truthOk === b.truthOk &&
    a.pass === b.pass &&
    a.nonResultKind === b.nonResultKind &&
    a.failedCheckIds.length === b.failedCheckIds.length &&
    a.failedCheckIds.every((id, index) => id === b.failedCheckIds[index])
  );
}

/** The compared side of a replayed row: its verdict fields, without the check rows beside them. */
function replayedSideOf(verdict: ReplayVerdict): VerdictSide & { taskId: string } {
  const { taskId, truthOk, pass, nonResultKind, nonResult } = verdict;
  return {
    taskId,
    truthOk,
    pass,
    nonResultKind,
    nonResult,
    failedCheckIds: [...verdict.failedCheckIds].sort(),
  };
}

export function diffVerdicts(
  recorded: ReadonlyMap<string, VerdictSide>,
  replayed: readonly ReplayVerdict[],
  skippedUnaccepted = 0,
): ReplayDiff {
  const rows: ReplayRow[] = [];
  for (const [taskId, side] of recorded) {
    const verdict = replayed.find((row) => row.taskId === taskId);
    const replayedSide: VerdictSide =
      verdict === undefined
        ? {
            truthOk: null,
            pass: null,
            nonResultKind: "not-replayed",
            nonResult: "no replayed row for this task",
            failedCheckIds: [],
          }
        : replayedSideOf(verdict);
    const same = sameSide(side, replayedSide);
    rows.push({ taskId, recorded: side, replayed: replayedSide, same, checkRuns: verdict?.checkRuns ?? [] });
  }
  const same = rows.filter((row) => row.same).length;
  return {
    rows,
    summary: {
      cases: rows.length,
      same,
      changed: rows.length - same,
      nonResults: rows.filter((row) => row.replayed.nonResultKind !== null).length,
      skippedUnaccepted,
    },
  };
}

// --- Entry ---------------------------------------------------------------------------------------

export async function main(argv: readonly string[], cwd: string): Promise<string> {
  const [candidate, flag, out, ...rest] = argv;
  if (
    candidate === undefined ||
    rest.length > 0 ||
    (flag !== undefined && (flag !== "--out" || out === undefined))
  ) {
    throw new Error(USAGE);
  }
  const recorded = resolveRecordedCandidate(candidate, cwd);
  const { sides, cases, skippedUnaccepted } = recordedCases(recorded);
  const replayed = await replayCases(recorded, cases);
  const report = {
    runId: recorded.runId,
    slugDir: recorded.slugDir,
    candidateDir: recorded.candidateDir,
    bundleSnapshot: recorded.bundleSnapshot,
    // The tree that graded, by commit rather than by path: a checkout path names whatever is
    // checked out there later.
    gradedUnder: SOURCE_IDENTITY,
    missingTools: replayed.missingTools,
    tools: replayed.tools,
    cleanup: replayed.cleanup,
    ...diffVerdicts(sides, replayed.rows, skippedUnaccepted.length),
  };
  if (out !== undefined) writeJsonFile(resolve(cwd, out), report);
  return JSON.stringify(report, null, 2);
}

if (Bun.argv[1] !== undefined && import.meta.url === Bun.pathToFileURL(Bun.argv[1]).href) {
  console.log(await main(Bun.argv.slice(2), runtimeProcess.cwd()));
  // Evaluator children and verifier cells may keep handles open; the report is complete.
  runtimeProcess.exit(0);
}
