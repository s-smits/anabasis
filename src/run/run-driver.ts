/**
 * Connect the evaluation runner to the campaign case record. One battery has one runId:
 * fingerprint the product, run its battery through `makeVerify` (which owns battery.json and the
 * per-case run records), then append one case row per task with evidence digests, and check
 * completeness against the task set — never against a count re-read from the file whose loss is
 * being checked.
 *
 * The driver restates nothing the runner owns: buildInputsHash and backendPin are read back from
 * the battery evidence, the tri-state verdict fields are copied verbatim from the runner's
 * CaseRecord vocabulary, and the isolation check result arrives from the caller, which owns the
 * isolation probe. `isolation: null` explicitly records that isolation has not been proved, rather
 * than leaving a reader to infer it from an absent field.
 *
 * One battery per iteration: `batteryCondition` states the main condition that the battery and
 * every case row restate, so the evidence names the offered tool contract it ran under.
 */
import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import {
  CASE_RECORD_SCHEMA,
  CaseRecord as CaseRecordStore,
  type CaseRecordRow,
  type CaseIsolationEvidence,
  type RunCondition,
  type StoredCaseRow,
  assertCompleteRun,
  classifyCaseOutcome,
  readCaseRecord,
  tracePointer,
  outcomeTally,
} from "../claim/case-record.ts";
import { fingerprintSlug } from "../claim/fingerprint.ts";
import { assertPathSegment } from "../meta/path-segment.ts";
import { hashJsonBytes, parseJsonAs } from "../meta/json-runtime.ts";
import { sameJsonValue } from "../meta/stable-json.ts";
import type { VerificationReport } from "../truth/build-deps.ts";
import { type BuiltPresetId, isBuiltPresetId, presetToolNames } from "../truth/built-presets.ts";
import { type CaseRecord, batteryPath, readRecordedBatteryRecord } from "../truth/battery-record.ts";
import { type VerificationRunnerOptions, makeVerify } from "../truth/verification-runner.ts";
import type { BuildTask } from "../truth/tasks.ts";
import { isRecord, isString } from "../meta/json-shape.ts";
import { TASKS_FILE, TOOLS_SPEC_FILE } from "../meta/bundle-layout.ts";
import { readJsonFile } from "../meta/completed-json.ts";

interface DriveBatteryOptions {
  slug: string;
  slugDir: string;
  runId: string;
  /** The measurement driver's identity paired with runId, separate from the solving agent. */
  builderId: string;
  /** The case-record JSONL to which this driver appends the run's rows. */
  recordPath: string;
  /** Runner options minus runId — the driver states the run identity exactly once. */
  verification: Omit<VerificationRunnerOptions, "runId">;
  /** The isolation evidence for every case; null explicitly records missing proof. */
  isolation: CaseIsolationEvidence | null;
  tasks: BuildTask[];
}

export type RunSummary = {
  runId: string;
  total: number;
  verified: number;
  unaccepted: number;
  nonResults: number;
  passed: number;
  /** passed / (verified + unaccepted). Non-results are censored from the denominator (the
   *  estimation evidence owns their disclosure); null when nothing was scored. */
  passRate: number | null;
  /** Label the observed score pattern after excluding runtime non-results.
   *  "no-signal" means nothing was scored, rather than a zero pass rate. "all-pass" means
   *  this battery found no failing case; it does not prove completeness or a defect.
   *  "all-fail" records the opposite extreme without diagnosing why cases failed.
   *  "informative" means both passing and failing cases occurred in this denominator. */
  discrimination: "no-signal" | "all-pass" | "all-fail" | "informative";
};

interface DriveBatteryResult {
  report: VerificationReport;
  summary: RunSummary;
}

/** The slice of battery.json the driver consumes — the runner owns the full BatteryRecord. */
interface BatteryCaseSlice {
  buildInputsHash: string;
  backendPin: string;
  condition: RunCondition;
  cases: CaseRecord[];
}

/** The stored condition name of the one battery a round measures. */
export const SHIPPING_VARIANT = "shipping";

function readBatterySlice(slugDir: string, runId: string): BatteryCaseSlice {
  const path = batteryPath(slugDir, runId);
  const record =
    /* SAFETY: the full recorded battery shape is larger; this reader checks every field in its narrower projection below. */ readRecordedBatteryRecord(
      join(slugDir, "runs", runId),
      runId,
    ) as Partial<BatteryCaseSlice>;
  if (
    !isString(record?.buildInputsHash) ||
    !isString(record.backendPin) ||
    !Array.isArray(record.cases) ||
    !isRecord(record.condition)
  ) {
    throw new Error(`${path}: battery record is missing buildInputsHash, backendPin, cases, or condition`);
  }
  return /* SAFETY: the check above threw unless buildInputsHash, backendPin, cases and condition are all present. */ record as BatteryCaseSlice;
}

export function summarizeRun(runId: string, rows: readonly CaseRecordRow[]): RunSummary {
  const mine = rows.filter((row) => row.runId === runId);
  const { verified, passed, unaccepted, nonResults } = outcomeTally(mine.map(classifyCaseOutcome));
  const scored = verified + unaccepted;
  return {
    runId,
    total: mine.length,
    verified,
    unaccepted,
    nonResults,
    passed,
    passRate: scored === 0 ? null : passed / scored,
    discrimination: discriminationOf(passed, scored),
  };
}

/** What a battery's pass count says about whether its tasks separated anything at all. */
function discriminationOf(passed: number, scored: number): RunSummary["discrimination"] {
  if (scored === 0) return "no-signal";
  if (passed === scored) return "all-pass";
  if (passed === 0) return "all-fail";
  return "informative";
}

export function assertRunIdSafe(runId: string): void {
  assertPathSegment("runId", runId);
}

/** Append the recorded battery's case rows to the campaign record — the driver is the record's
 *  one writer, and the rows come from the run records on disk, never from process memory. */
async function appendRecordedCaseRows(options: DriveBatteryOptions): Promise<void> {
  const battery = readBatterySlice(options.slugDir, options.runId);
  const record = CaseRecordStore.open(options.recordPath);
  try {
    for (const caseResult of battery.cases) {
      const traces = [tracePointer(options.slugDir, `runs/${options.runId}/battery.json`)];
      const caseTrace = `runs/${options.runId}/cases/${caseResult.taskId}/trace.json`;
      if (existsSync(join(options.slugDir, caseTrace))) {
        traces.push(tracePointer(options.slugDir, caseTrace));
      }
      // The runtime boundary evidence carries the exact solve condition (worker condition digest
      // plus the disclosed contract identities); the pointer makes it reachable from the record.
      const builtRuntime = `runs/${options.runId}/cases/${caseResult.taskId}/built-runtime.json`;
      if (existsSync(join(options.slugDir, builtRuntime))) {
        traces.push(tracePointer(options.slugDir, builtRuntime));
      }
      await record.append({
        schema: CASE_RECORD_SCHEMA,
        runId: options.runId,
        builderId: options.builderId,
        slug: options.slug,
        buildInputsHash: battery.buildInputsHash,
        backendPin: battery.backendPin,
        taskId: caseResult.taskId,
        family: caseResult.family,
        acceptedSubmit: caseResult.acceptedSubmit,
        truthOk: caseResult.truthOk,
        pass: caseResult.pass,
        runtimeNonResult: caseResult.runtimeNonResult,
        runtimeNonResultKind: caseResult.runtimeNonResultKind,
        solverStartedAt: caseResult.solver.startedAt,
        solverEndedAt: caseResult.solver.endedAt,
        isolation: options.isolation,
        condition: battery.condition,
        traces,
      });
    }
  } finally {
    await record.close();
  }
}

export async function driveBattery(options: DriveBatteryOptions): Promise<DriveBatteryResult> {
  assertRunIdSafe(options.runId);
  // The record is append-only and each row names the run directory's bytes by digest, so a second
  // battery under a recorded run id would rewrite those bytes and add rows nothing can remove.
  if (readCaseRecord(options.recordPath).some((entry) => entry.row.runId === options.runId)) {
    throw new Error(
      `${options.slug}/${options.runId}: the campaign record already holds rows for this run id; a new measurement needs a new run id`,
    );
  }
  const fingerprint = fingerprintSlug(options.slugDir);
  if (!fingerprint.ok) {
    const codes = fingerprint.findings.map((finding) => finding.code).join(", ");
    throw new Error(`${options.slug}: the harness failed the fingerprint checks: ${codes}`);
  }
  // The claim names fingerprint.taskSetHash, which covers recorded tasks and controls, while
  // execution uses the supplied task array. Require equal JSON values so a caller cannot run
  // easier tasks under the recorded set's identity. Compare whenever a task-set hash exists; a
  // tree with no tasks.json has no commitment (and the claim write refuses it separately).
  if (fingerprint.taskSetHash !== null) {
    const recorded: unknown = readJsonFile(join(options.slugDir, TASKS_FILE));
    if (!sameJsonValue(recorded, options.tasks)) {
      throw new Error(
        `${options.slug}/${options.runId}: the supplied tasks differ from correctness-model/tasks.json; run the saved tasks or create a new task-set hash`,
      );
    }
  }
  const evaluate = makeVerify({ ...options.verification, runId: options.runId });
  let report: VerificationReport;
  try {
    report = await evaluate({
      slug: options.slug,
      slugDir: options.slugDir,
      fingerprint,
      tasks: options.tasks,
    });
  } catch (error) {
    // The runner publishes battery.json before the Judge phase and before it throws a typed
    // environment non-result, so a throw after publication leaves complete verdicts on disk
    // that belong in the campaign record like any other battery's — a Judge turn exhausting the
    // provider budget after every verdict is published would otherwise cost the record every one of
    // those rows, and so would a typed environment non-result at the same point. The published record
    // decides, not the error type; a throw before publication has nothing to append, and the check
    // above proved the record holds no row for this run id yet.
    if (existsSync(batteryPath(options.slugDir, options.runId))) {
      try {
        await appendRecordedCaseRows(options);
      } catch (cause) {
        // Both failures reach the caller: the runner's and the record's.
        // oxlint-disable-next-line eslint/preserve-caught-error -- `cause` is carried in `errors`.
        throw new AggregateError(
          [error, cause],
          `${options.runId}: the unwind could not record the published battery`,
        );
      }
    }
    throw error;
  }
  await appendRecordedCaseRows(options);
  const stored = readCaseRecord(options.recordPath);
  // An unclaimable discrimination pass skips the paid loop before any case runs
  // (verification-runner.ts, recordUnclaimableBattery): zero rows is that battery's recorded shape and
  // the claim already refuses on the discrimination findings. The bijection rule is for a battery
  // that ran, and applying it here aborts a variant that never reached a case.
  const skipped = report.score.length === 0 && !report.evidence.discrimination.claimable;
  if (!skipped) {
    assertCompleteRun(
      stored,
      options.runId,
      options.tasks.map((task) => task.taskId),
    );
  }
  return {
    report,
    summary: summarizeRun(
      options.runId,
      stored.map((entry: StoredCaseRow) => entry.row),
    ),
  };
}

/** Read the nonempty task array from correctness-model/tasks.json. The battery was validated
 *  at build time; this read checks the fields needed for execution and throws on malformed rows
 *  before the run starts. It does not repeat the full build-time validation. */
export function loadRecordedTasks(slugDir: string): BuildTask[] {
  const file = join(slugDir, TASKS_FILE);
  const parsed: unknown = readJsonFile(file);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`${file}: expected a non-empty task array written by the build`);
  }
  for (const [index, row] of parsed.entries()) {
    const task =
      /* SAFETY: every field of the declared partial is optional, and the check below throws unless taskId, family, publicInput and hidden are all present with the right kind. */ row as Partial<BuildTask>;
    if (
      !isString(task?.taskId) ||
      !isString(task.family) ||
      !("publicInput" in task) ||
      !Array.isArray(task.hidden)
    ) {
      throw new Error(`${file}[${index}]: not a persisted BuildTask (taskId/family/publicInput/hidden)`);
    }
  }
  return /* SAFETY: the check above returned when `!Array.isArray(parsed) || parsed.length === 0`. */ parsed as BuildTask[];
}

/** The battery's run condition: the main condition, no adviser removed, and a digest over
 *  offered tool names (the tree's tools-spec names plus preset tools). Read from the
 *  spec the runtime registers from, so the hash and the offered roster share one source. A tree
 *  without a tools-spec, which submit refuses and only fixtures carry, has no roster to digest:
 *  toolInterfaceHash null states that, never a hash over guessed names. `advisorsRemoved` stays in
 *  the row shape because the case record's validator reads a campaign's whole history; every
 *  battery records it empty. */
export function batteryCondition(slugDir: string): RunCondition {
  const file = join(slugDir, TOOLS_SPEC_FILE);
  if (!existsSync(file)) return { variant: SHIPPING_VARIANT, advisorsRemoved: [], toolInterfaceHash: null };
  const parsed = parseJsonAs<{
    presets?: unknown;
    tools?: Array<{ name?: unknown }>;
  }>(readFileSync(file, "utf8"));
  const selected = Array.isArray(parsed.presets)
    ? parsed.presets.filter((preset): preset is BuiltPresetId => isString(preset) && isBuiltPresetId(preset))
    : [];
  const offered = [
    ...(Array.isArray(parsed.tools) ? parsed.tools : []).flatMap((tool) =>
      isString(tool.name) ? [tool.name] : [],
    ),
    ...presetToolNames(selected),
  ].sort();
  return { variant: SHIPPING_VARIANT, advisorsRemoved: [], toolInterfaceHash: hashJsonBytes(offered) };
}
