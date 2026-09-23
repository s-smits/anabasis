/**
 * The climb-evidence reader: one row per admitted battery in claim-clock order, the sample each is
 * read over, and the public identities the gate compares them on. climb-battery-admission.ts
 * decides admission; climb-readout.ts reads the rows.
 */
import { existsSync, readdirSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import type { MeasuredDifficulty } from "../claim/battery-difficulty.ts";
import { classifyCaseOutcome } from "../claim/case-record.ts";
import { wilsonInterval } from "../claim/estimation.ts";
import { POLICY } from "../critic/policy.ts";
import { band01, policyRow } from "../critic/manifest.ts";
import { sha256 } from "../meta/digest.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { type JsonValue, isBoolean, isNumber, isRecord, isString, jsonKind } from "../meta/json-shape.ts";
import { canonicalJson } from "../meta/stable-json.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { recordedEvidence, verifyRunDir } from "../claim/evidence-log.ts";
import {
  type BatteryAdmission,
  type BatteryEvidence,
  type ExcludedBattery,
  admitBattery,
  currentThresholdDigest,
} from "./climb-battery-admission.ts";
import type { ExperimentAuthoring } from "./experiment-freeze.ts";
import { productHistoryDirs } from "./product-versions.ts";

export type { ExcludedBattery };

/** The `climb` row of thresholds.frozen.yaml; a missing or invalid field takes its default. */
export interface ClimbThresholds {
  band: [number, number];
}

export const climbThresholds: (manifestPath?: string) => ClimbThresholds = policyRow("climb", {
  band: { bound: band01, fallback: POLICY.climb.band },
});

/** One battery's difficulty facts; chronological order is the caller's contract. */
export interface ClimbBattery {
  runId: string;
  /** sha256 of the recorded battery bytes these numbers came from. */
  batterySha256: string;
  /** Difficulty denominator: scored rows, runtime non-results excluded. */
  n: number;
  passed: number;
  /** Of `n`, the attempts with no accepted submission; they count as fails once any case is
   *  verified. A battery with no accepted submission carries no difficulty evidence. */
  unaccepted: number;
  measured: MeasuredDifficulty;
  /** The task-set identity shared across runs of one task set; null when unrecorded. */
  taskSetHash?: string | null;
  /** The verified cases that failed, by task id; absent (unknown) when any failing row has no id.
   *  Controller-only, never rendered. */
  failedTaskIds?: readonly string[];
}

/** One family's difficulty counts. `attempts` is the difficulty denominator, which counts refused
 *  attempts as failures, so it is not the verified count. */
export type ClimbFamilySummary = {
  family: string;
  attempts: number;
  passes: number;
  wilson: [number, number];
};

/** The most any one of a battery's cases spent, over the cases that recorded a solver block:
 *  model turns, wall-clock minutes and tool calls, null for a measure none recorded. Passes alone
 *  read a battery solved inside a tenth of its declared walls and one that used them alike — run
 *  1aa6e6 passed 6 of 6 with no case past 1 turn of its 24 or 15 minutes of its 120, run fa03b7
 *  passed 6 of 6 with a case at 68 of the same 120, and both reached their author as "6 of 6, too
 *  easy". `CaseRecord.solver` records it for investigation and scoring still does not read it: it
 *  is the solver's own behaviour, the measured form of the turns `harness_trial` returns for a
 *  rehearsal, and no verifier detail, task location or verdict enters. */
export type ClimbEffort = {
  cases: number;
  turns: number | null;
  minutes: number | null;
  toolCalls: number | null;
};

/** One battery's recorded authoring memory. Task bodies stay at
 *  `runs/<runId>/cases/<taskId>/public-task.json`; `publicTaskProjection` digest-reads them. */
interface ClimbAuthoringRow {
  taskSetHash: string | null;
  /** Every recorded case's identifier, in evidence order, non-results included; null entries
   *  disclose rows without one. */
  caseIds: Array<string | null>;
  /** Public aggregate outcome by author-provided family, never task ids or verifier detail. */
  familySummary: ClimbFamilySummary[];
  /** Null when no case recorded any measure, which an older battery's rows will not have. */
  effort: ClimbEffort | null;
  experimentAuthoring?: ExperimentAuthoring;
}

/** One battery and everything recorded with it. */
export interface AdmittedClimbRow {
  createdAt: string;
  /** Recorded condition labels, not proof of a served model or cross-condition comparability. */
  condition: { backendPin: string | null; thresholdManifestDigest: string; variant: string };
  battery: ClimbBattery;
  harnessId: string | null;
  /** The claim's refusal, or null. A refused battery stays in history and enters no rate. */
  excludedReason: string | null;
  authoring: ClimbAuthoringRow;
}

/** One population, read three ways. Every battery is in `admitted` or `excluded`; `history` is the
 *  chronological view of those a recorded claim clock can place, claim-refused ones included. Rates
 *  read `admitted`. */
export interface ClimbBatteriesRead {
  history: AdmittedClimbRow[];
  admitted: AdmittedClimbRow[];
  /** Ordered by run id. */
  excluded: ExcludedBattery[];
}

/** How many runs the exclusion summary names per shared reason before counting the rest. */
const NAMED_RUNS_PER_REASON = 4;

/** The sample a battery is read over: the recorded changed subset, even at zero attempts, otherwise
 *  the whole battery. Every reader of a battery's rate goes through this function. */
export function decidingSample({ measured: { changedSubset }, passed, n }: ClimbBattery) {
  return changedSubset === undefined
    ? { population: "whole-battery" as const, passes: passed, n }
    : { population: "changed-subset" as const, passes: changedSubset.passes, n: changedSubset.attempts };
}

/** Counts one battery's unaccepted rows through `classifyCaseOutcome`. */
export function countUnaccepted(
  rows: Array<{ pass?: unknown; acceptedSubmit?: unknown; runtimeNonResult?: unknown }>,
): number {
  return rows.filter(
    (row) =>
      classifyCaseOutcome({
        acceptedSubmit: row.acceptedSubmit === true,
        pass: isBoolean(row.pass) ? row.pass : null,
        runtimeNonResult: isString(row.runtimeNonResult) ? row.runtimeNonResult : null,
      }) === "unaccepted",
  ).length;
}

function familySummary(measured: MeasuredDifficulty): ClimbFamilySummary[] {
  return measured.items
    .flatMap((item) => {
      // A blank family name or a sample with no interval is left out.
      const interval = item.item.trim() === "" ? null : wilsonInterval(item.passes, item.attempts);
      return interval === null
        ? []
        : [
            {
              family: item.item,
              attempts: item.attempts,
              passes: item.passes,
              wilson: [Number(interval.lower.toFixed(3)), Number(interval.upper.toFixed(3))] satisfies [
                number,
                number,
              ],
            },
          ];
    })
    .sort((a, b) => a.family.localeCompare(b.family));
}

/** A case that recorded no solver block is not a case that spent nothing, so it is left out; a
 *  battery whose cases recorded none reads null, as an older battery's rows do. */
function solveEffort(cases: NonNullable<BatteryEvidence["cases"]>): ClimbEffort | null {
  const spent = cases.flatMap((row) => {
    if (!isRecord(row.solver)) return [];
    const { turns, toolCalls, startedAt, endedAt } = row.solver;
    // An unparseable instant leaves NaN and a reversed pair a negative, and neither is at least
    // zero, so that span reads unknown rather than a maximum that swallows every real one.
    const ms =
      isString(startedAt) && isString(endedAt) ? Date.parse(endedAt) - Date.parse(startedAt) : Number.NaN;
    return [
      {
        turns: isNumber(turns) ? turns : null,
        minutes: ms >= 0 ? Number((ms / 60_000).toFixed(1)) : null,
        toolCalls: isNumber(toolCalls) ? toolCalls : null,
      },
    ];
  });
  if (spent.length === 0) return null;
  const most = (measure: keyof (typeof spent)[number]): number | null => {
    const recorded = spent.map((row) => row[measure]).filter(isNumber);
    return recorded.length === 0 ? null : Math.max(...recorded);
  };
  return {
    cases: spent.length,
    turns: most("turns"),
    minutes: most("minutes"),
    toolCalls: most("toolCalls"),
  };
}

function admittedClimbRow(admitted: Extract<BatteryAdmission, { ok: true }>): AdmittedClimbRow {
  const { evidence, measured } = admitted;
  const scored = (evidence.cases ?? []).filter((row) => isBoolean(row.pass));
  // Which cases failed, not only how many; one id-less row makes the set unknown, not smaller.
  const failed = scored.filter((row) => row.pass !== true);
  const failedIds = failed.map((row) => (isString(row.taskId) ? row.taskId : null));
  const taskSetHash = isString(evidence.bundleSnapshot?.taskSetHash)
    ? evidence.bundleSnapshot.taskSetHash
    : null;
  return {
    createdAt: admitted.createdAt,
    condition: {
      backendPin: isString(evidence.backendPin) ? evidence.backendPin : null,
      ...admitted.condition,
    },
    harnessId: admitted.harnessId,
    excludedReason: admitted.excluded?.reason ?? null,
    authoring: {
      taskSetHash,
      caseIds: (evidence.cases ?? []).map((row) => (isString(row.taskId) ? row.taskId : null)),
      familySummary: familySummary(measured),
      effort: solveEffort(evidence.cases ?? []),
      ...keyIfDefined("experimentAuthoring", evidence.experimentAuthoring),
    },
    battery: {
      runId: admitted.runId,
      batterySha256: admitted.batterySha256,
      n: scored.length,
      passed: scored.length - failed.length,
      taskSetHash,
      ...keyIfDefined(
        "failedTaskIds",
        failedIds.every((id): id is string => id !== null) ? failedIds : undefined,
      ),
      // Refused rows stay in `n` as fails; `ClimbBattery.unaccepted` says why.
      unaccepted: countUnaccepted(scored),
      measured,
    },
  };
}

/**
 * Reads the adopted tree's measured history through `admitBattery`. A claim-refused battery keeps
 * a history row carrying its refusal and enters no rate.
 *
 * Chronology is the claims' recorded `createdAt` (tiebreak runId), never file mtime. Scored rows
 * (boolean `pass`) are the denominator. A null runPin serves only the public history view, which
 * reads across model pins.
 */
export function readClimbBatteries(
  domainDir: string,
  runPin: string | null,
  claimsDir: string,
  manifestPath?: string,
): ClimbBatteriesRead {
  const thresholdDigest = currentThresholdDigest(manifestPath);
  const excluded: ExcludedBattery[] = [];
  const history: AdmittedClimbRow[] = [];
  for (const dir of productHistoryDirs(domainDir)) {
    const root = join(dir, "runs");
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const admission = admitBattery(join(root, name), name, runPin, thresholdDigest, claimsDir);
      if (admission === null) continue;
      if (admission.excluded !== null) excluded.push(admission.excluded);
      if (admission.ok) history.push(admittedClimbRow(admission));
    }
  }
  history.sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.battery.runId.localeCompare(b.battery.runId),
  );
  excluded.sort((a, b) => a.runId.localeCompare(b.runId));
  return { history, admitted: history.filter((row) => row.excludedReason === null), excluded };
}

export function excludedSummary(excluded: readonly ExcludedBattery[], admitted: number): string | null {
  if (excluded.length === 0) return null;
  const byReason = new Map<string, string[]>();
  // `excluded` arrives sorted by run, so the grouping is deterministic.
  for (const row of excluded) byReason.set(row.reason, [...(byReason.get(row.reason) ?? []), row.runId]);
  const groups = [...byReason].map(([reason, runs]) => {
    const rest = runs.length - NAMED_RUNS_PER_REASON;
    return `${reason} — ${runs.slice(0, NAMED_RUNS_PER_REASON).join(", ")}${rest > 0 ? ` and ${String(rest)} more` : ""}`;
  });
  return `${excluded.length} of ${excluded.length + admitted} recorded batteries excluded from difficulty evidence: ${groups.join("; ")}`;
}

/** A recorded battery's public tasks, read through the evidence log and refused whole when any case
 *  cannot be vouched for. */
export function publicTaskProjection(
  domainDir: string,
  runId: string,
  caseIds: Array<string | null>,
): { tasks: unknown[] } | { refusal: string } {
  if (caseIds.length === 0) return { refusal: "no verified case identifiers" };
  const ids = caseIds.filter((id): id is string => id !== null);
  if (ids.length !== caseIds.length) return { refusal: "a verified case states no task identifier" };
  const matches = productHistoryDirs(domainDir)
    .map((dir) => join(dir, "runs", runId))
    .filter(existsSync);
  const runDir = matches[0];
  if (matches.length !== 1 || runDir === undefined) {
    return { refusal: "the admitted battery has no unique retained run directory" };
  }
  const violations = verifyRunDir(runDir);
  const casesDir = join(runDir, "cases");
  const extra = existsSync(casesDir) ? readdirSync(casesDir).filter((name) => !caseIds.includes(name)) : [];
  if (extra.length > 0) {
    return { refusal: `${extra.length} case projection(s) beyond the verified case rows — refused as extra` };
  }
  const tasks: unknown[] = [];
  for (const id of ids) {
    const recorded = recordedEvidence(runDir, `cases/${id}/public-task.json`, violations);
    if (!recorded.ok) return { refusal: `cases/${id}/public-task.json: ${recorded.refusal}` };
    try {
      const parsed = parseJsonAs<{ taskId?: unknown; publicTask?: unknown }>(recorded.bytes);
      if (parsed.taskId !== id || parsed.publicTask === undefined) {
        return { refusal: `cases/${id}/public-task.json: projection drifted from its case identity` };
      }
      tasks.push(parsed.publicTask);
    } catch {
      return { refusal: `cases/${id}/public-task.json: malformed JSON` };
    }
  }
  return { tasks };
}

/** One battery's public measurement identity: the sorted multiset of its tasks' publicInput bytes.
 *  Hidden rows are left out because recorded batteries keep only the public task on disk. */
export function publicBatteryFingerprint(tasks: ReadonlyArray<{ publicInput: unknown }>): string {
  return sha256(
    tasks
      .map((task) => canonicalJson(task.publicInput))
      .sort()
      .join("\n"),
  );
}

/** A value with its data dropped: field names, value types, and an array as the set of its
 *  elements' schemas, ignoring length and order. A new mix of the same task kinds therefore reads
 *  as the same question. */
function valueSchema(value: unknown): JsonValue {
  if (Array.isArray(value)) {
    return [...new Set(value.map((element) => canonicalJson(valueSchema(element))))].sort();
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, valueSchema(child)]));
  }
  return jsonKind(value) ?? "unknown";
}

/** A battery's set of public task schemas; null, matching nothing, when its public tasks cannot be
 *  vouched for. */
export function publicSchemaPrint(
  domainDir: string,
  row: Pick<AdmittedClimbRow, "battery" | "authoring">,
): string | null {
  const projection = publicTaskProjection(domainDir, row.battery.runId, row.authoring.caseIds);
  if (!("tasks" in projection)) return null;
  return canonicalJson(
    valueSchema(projection.tasks.map((task) => (isRecord(task) ? task.publicInput : null))),
  );
}

/** One product's reading of one exam, the identity the repeat refusal compares. The product is
 *  `harnessBundleIdentity`, so the same exam under another evaluator is a new condition. */
export function productConditionFingerprint(harnessId: string, publicFingerprint: string): string {
  return sha256(`product\n${harnessId}\n${publicFingerprint}`);
}

/** The product-condition prints of every admitted battery, the repeat refusal's comparison set. A
 *  row whose projection cannot be verified, or has a task without `publicInput`, yields no print. */
export function priorPublicFingerprints(
  domainDir: string,
  admitted: ReadonlyArray<Pick<AdmittedClimbRow, "battery" | "authoring" | "harnessId">>,
): string[] {
  const fingerprints = new Set<string>();
  for (const row of admitted) {
    if (row.harnessId === null) continue;
    const projection = publicTaskProjection(domainDir, row.battery.runId, row.authoring.caseIds);
    if (!("tasks" in projection)) continue;
    const tasks = projection.tasks.filter(
      (task): task is { publicInput: unknown } => task instanceof Object && "publicInput" in task,
    );
    if (tasks.length !== projection.tasks.length) continue;
    fingerprints.add(productConditionFingerprint(row.harnessId, publicBatteryFingerprint(tasks)));
  }
  return [...fingerprints];
}
