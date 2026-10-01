/**
 * The climb-evidence reader: which recorded batteries may decide the next round, the sample each
 * one is read over, and the exact public identities the gate compares them on.
 *
 * `climb-battery-admission.ts` opens each recorded run directory and answers with either an
 * admitted battery or a named exclusion, and this module never re-derives one of those decisions.
 * What it adds is one row per battery in claim-clock order. `climb-readout.ts` is the single
 * reading of those rows: the difficulty decision and every sentence a Builder gets to read about
 * them come from there, so a fact absent from a row here is a fact no Builder can act on.
 */
import { existsSync, readdirSync } from "../meta/filesystem.ts";
import { dirname, join } from "../meta/path.ts";
import type { MeasuredDifficulty } from "../claim/battery-difficulty.ts";
import { classifyCaseOutcome } from "../claim/case-record.ts";
import { wilsonInterval } from "../claim/estimation.ts";
import { POLICY } from "../critic/policy.ts";
import { band01, frozenManifestPath, policyRow } from "../critic/manifest.ts";
import { keyIfDefined, keyIfTruthy, keysIf } from "../meta/optional-key.ts";
import { median } from "../meta/tally.ts";
import { isBoolean, isNumber, isRecord, isString } from "../meta/json-shape.ts";
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
import { claimsDirFor } from "./claim-write.ts";
import { HarnessConfigError, harnessSettings } from "../correctness-bundle/harness-config.ts";
import { settledAgainstCheck } from "../review/epoch-review-findings.ts";
import { SOLVE_WALL_MESSAGE } from "../backends/backend-types.ts";

/** Named where the refusals are decided and re-exported here, because this module is the face
 *  every reader of climb evidence goes through. */
export type { ExcludedBattery };

/** The `climb` row of `thresholds.frozen.yaml`, read at run time. Each missing or invalid field
 *  takes its declared default (operator decision), so a malformed row degrades to policy rather
 *  than blocking a run that has already been paid for. */
export interface ClimbThresholds {
  band: [number, number];
}

export const climbThresholds: (manifestPath?: string) => ClimbThresholds = policyRow("climb", {
  band: { bound: band01, fallback: POLICY.climb.band },
});

/** The claims a read judges batteries by, and the frozen manifest it compares their thresholds
 *  against; with no manifest the read states nothing about thresholds and checks nothing. */
interface ClimbEvidencePaths {
  claimsDir: string;
  manifestPath?: string;
}

/** Where a climb read finds its evidence. A campaign is named by its repository and slug, and the
 *  read derives the campaign's claims directory and the repository's frozen manifest from them. A
 *  fixture tree that keeps its claims elsewhere names the paths outright. */
export type ClimbEvidenceAt = { repoRoot: string; slug: string } | ClimbEvidencePaths;

/** One battery's difficulty facts; chronological order is the caller's contract. */
export interface ClimbBattery {
  runId: string;
  /** sha256 of the recorded battery bytes these numbers came from: the binding between a decision
   *  and the evidence it was made on. */
  batterySha256: string;
  /** The difficulty denominator: scored rows, with runtime non-results already excluded upstream and
   *  `settledAgainst` cases left out here. */
  n: number;
  passed: number;
  /** Of `n`, the attempts that produced no accepted submission, which truth therefore never
   *  verified. They stay in `n` as fails once any case is verified, since a hard task may well
   *  fail through a refused submission; a battery refused whole carries no difficulty evidence at
   *  all. */
  unaccepted: number;
  measured: MeasuredDifficulty;
  /** The recorded bundle's task-set identity: what "one task set" means across runs. It is not
   *  `batterySha256`, which digests each run's own battery.json and so carries the run id, leaving
   *  two measurements of one task set no digest in common. Null when the record states none. */
  taskSetHash?: string | null;
  /** The verified cases that failed, by task id. Absent when any failing row recorded no id, which
   *  reads as "unknown" and never as "nothing failed". Controller-only: it feeds the repeated-core
   *  comparison and is never rendered to an author. */
  failedTaskIds?: readonly string[];
  /** Verified cases the battery's completed Epoch Review settled against the one check that decided
   *  them, left out of `n`, `passed`, `measured` and `failedTaskIds`. Absent when there are none. */
  settledAgainst?: number;
}

/** One family's difficulty counts, as the readout hands them to the author. `attempts` is the
 *  difficulty denominator `measuredExperiment` built, which censors runtime non-results and keeps
 *  admission-refused attempts as failures, so it is not the verified count — and calling it
 *  `verified` told the one reader who chooses the next battery that every refused submission had
 *  reached the verifier. `passes` and `attempts` are the pair `wilsonInterval` and `placeOnBand`
 *  speak, and this row speaks it throughout. */
export type ClimbFamilySummary = {
  family: string;
  attempts: number;
  passes: number;
};

/** The most any one of a battery's cases spent, over the cases that recorded a solver block:
 *  model turns, wall-clock minutes and tool calls, null for a measure none recorded. It is the
 *  solver's own behaviour, the measured form of the effort `harness_trial` returns for a
 *  rehearsal, stated as a fact beside the verdicts and never read as difficulty: within a battery,
 *  minutes and tool calls do not separate the cases that passed from those that failed. No verifier
 *  detail, task location or verdict enters. */
export type ClimbEffort = {
  cases: number;
  turns: number | null;
  minutes: number | null;
  toolCalls: number | null;
};

/** One family's solve effort over its cases that recorded a solver block: the median and the most
 *  minutes, read against the product's `solve_minutes`, and the median tool calls. A plain fact,
 *  like `ClimbEffort`, and no reading of difficulty. */
export type FamilyEffort = {
  family: string;
  cases: number;
  medianMinutes: number | null;
  maxMinutes: number | null;
  medianToolCalls: number | null;
};

type CaseRows = NonNullable<BatteryEvidence["cases"]>;

/** One battery's recorded authoring memory. Task bodies stay at
 *  `runs/<runId>/cases/<taskId>/public-task.json`; `publicTaskProjection` digest-reads them. */
interface ClimbAuthoringRow {
  taskSetHash: string | null;
  /** The scoring program's hash, `brief.json` and `evaluator.ts` with every module it imports; null
   *  when the record states none. */
  scoringHash: string | null;
  /** The earlier battery whose recorded solves this one graded again rather than solved, and how
   *  many; null when every case was solved fresh. */
  regrade: { of: string; reused: number } | null;
  /** Every recorded case's identifier, in evidence order, non-results included; null entries
   *  disclose rows without one. */
  caseIds: Array<string | null>;
  /** Public aggregate outcome by author-provided family, never task ids or verifier detail. */
  familySummary: ClimbFamilySummary[];
  /** Null when no case recorded any measure, which an older battery's rows will not have. */
  effort: ClimbEffort | null;
  /** Per family, over the cases that name one and recorded a solver block. */
  familyEffort: FamilyEffort[];
  /** The scored cases that passed, by task id: which solver traces the Builder may read as a
   *  passing solve. Rule 4 lets a measured battery publish each task's aggregate bit. */
  passedTaskIds: string[];
  /** The `solve_minutes` wall of the product that recorded this battery, which the effort of its
   *  cases is read against; null when that product's agent/config.yaml does not parse. */
  solveWallMinutes: number | null;
  /** The failed cases the solve wall cut: a fact to read beside a lowered `solve_minutes`, since a
   *  failure the wall caused measures the wall rather than the task. Zero when the wall is unknown. */
  wallBound: number;
  experimentAuthoring?: ExperimentAuthoring;
}

/** One battery and everything recorded with it, held as one object rather than as index-aligned
 *  arrays, so no reader can pair a battery with another battery's condition. */
export interface AdmittedClimbRow {
  createdAt: string;
  /** Recorded condition labels, not proof of a served model or cross-condition comparability. */
  condition: { backendPin: string | null; thresholdManifestDigest: string; variant: string };
  battery: ClimbBattery;
  harnessId: string | null;
  /** The claim's own refusal, or null when the claim stands. A refused battery stays in the
   *  history view and enters no rate, because what it measured is still the last thing that
   *  happened even though it supports no number. */
  excludedReason: string | null;
  authoring: ClimbAuthoringRow;
}

/** One population, read three ways. Every battery directory is in `admitted` or in `excluded`,
 *  never both and never neither; `history` is the chronological view of the ones a recorded claim
 *  clock can place, which includes a claim-refused battery carrying its own refusal. A rate reads
 *  `admitted`, and the public history view reads `history`. */
export interface ClimbBatteriesRead {
  history: AdmittedClimbRow[];
  admitted: AdmittedClimbRow[];
  /** Ordered by run id, so the list does not depend on which product directory held each run. */
  excluded: ExcludedBattery[];
}

/** How close to the wall a solve must end to count as cut by it. A solve's recorded span starts
 *  after the wall's own clock does, so a solve the wall stopped can read a little short of it. */
export const WALL_BOUND_SHARE = 0.95;

/** The sample a battery is read over: the host-identified changed subset when one was recorded,
 *  even at zero attempts, and otherwise the whole battery. Unchanged successes cannot be allowed
 *  to dilute a changed subset's result. It is one function so that the decision and the table
 *  read a battery the same way: a second reader computing its own interval over
 *  `passed/n` puts the same battery into one prompt twice, once as 20 of 25 and once as 0 of 5. */
export function decidingSample({ measured: { changedSubset }, passed, n }: ClimbBattery) {
  return changedSubset === undefined
    ? { population: "whole-battery" as const, passes: passed, n }
    : { population: "changed-subset" as const, passes: changedSubset.passes, n: changedSubset.attempts };
}

/** Counts one battery's refused rows through the one outcome owner, `classifyCaseOutcome`, rather
 *  than re-deciding here what "no accepted submission" means. */
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
  // The interval owns the question "is this a readable sample": a blank name, a zero denominator or
  // a malformed count has none, and a row without one carries no count worth showing.
  return measured.items
    .filter((item) => item.item.trim() !== "" && wilsonInterval(item.passes, item.attempts) !== null)
    .map((item) => ({ family: item.item, attempts: item.attempts, passes: item.passes }))
    .sort((a, b) => a.family.localeCompare(b.family));
}

/** What each case spent. A case that recorded no solver block is not a case that spent nothing, so
 *  it is left out. */
function caseSpend(cases: CaseRows) {
  return cases.flatMap((row) => {
    if (!isRecord(row.solver)) return [];
    const { turns, toolCalls, startedAt, endedAt } = row.solver;
    // An unparseable instant leaves NaN and a reversed pair a negative, and neither is at least
    // zero, so that span reads unknown rather than a maximum that swallows every real one.
    const ms =
      isString(startedAt) && isString(endedAt) ? Date.parse(endedAt) - Date.parse(startedAt) : Number.NaN;
    return [
      {
        family: isString(row.family) ? row.family : null,
        turns: isNumber(turns) ? turns : null,
        minutes: ms >= 0 ? Number((ms / 60_000).toFixed(1)) : null,
        toolCalls: isNumber(toolCalls) ? toolCalls : null,
      },
    ];
  });
}

const medianToTenth = (values: readonly number[]) => {
  const value = median(values);
  return value === null ? null : Number(value.toFixed(1));
};

function familyEffort(cases: CaseRows): FamilyEffort[] {
  const byFamily = Map.groupBy(
    caseSpend(cases).filter((row) => row.family !== null && row.family.trim() !== ""),
    (row) => row.family ?? "",
  );
  return [...byFamily]
    .map(([family, rows]) => {
      const minutes = rows.map((row) => row.minutes).filter(isNumber);
      return {
        family,
        cases: rows.length,
        medianMinutes: medianToTenth(minutes),
        maxMinutes: minutes.length === 0 ? null : Math.max(...minutes),
        medianToolCalls: medianToTenth(rows.map((row) => row.toolCalls).filter(isNumber)),
      };
    })
    .sort((a, b) => a.family.localeCompare(b.family));
}

/** A battery whose cases recorded no solver block reads null, as an older battery's rows do. */
function solveEffort(cases: CaseRows): ClimbEffort | null {
  const spent = caseSpend(cases);
  if (spent.length === 0) return null;
  const most = (measure: "turns" | "minutes" | "toolCalls"): number | null => {
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

/** The failed cases the wall cut: an unaccepted case whose recorded solve ran to within
 *  `WALL_BOUND_SHARE` of the wall, and a verified fail whose solver recorded the wall's own stop. The
 *  host grades a draft accepted at the wall, so its fail stays a fail, but the wall ended the solve;
 *  a fail submitted near the wall without that receipt was the solver's own answer. */
function wallBoundCount(scored: CaseRows, wallMinutes: number | null): number {
  if (wallMinutes === null) return 0;
  // One row counts once: an unaccepted solve the wall stopped carries both marks.
  return scored.filter((row) => {
    const errors = isRecord(row.solver) && Array.isArray(row.solver.errors) ? row.solver.errors : [];
    if (row.pass === false && errors.includes(SOLVE_WALL_MESSAGE)) return true;
    const minutes = countUnaccepted([row]) === 1 ? (caseSpend([row])[0]?.minutes ?? null) : null;
    return minutes !== null && minutes >= wallMinutes * WALL_BOUND_SHARE;
  }).length;
}

/** `measured` without the settled cases, by family and in the changed subset. A subset whose
 *  members the record does not name cannot lose one honestly, so it gives way to the whole battery. */
function unsettledMeasure(
  measured: MeasuredDifficulty,
  settled: CaseRows,
  changed: readonly string[] | null | undefined,
): MeasuredDifficulty {
  if (settled.length === 0) return measured;
  const less = (tally: { attempts: number; passes: number }, of: (row: CaseRows[number]) => boolean) => {
    const rows = settled.filter(of);
    return {
      attempts: tally.attempts - rows.length,
      passes: tally.passes - rows.filter((row) => row.pass === true).length,
    };
  };
  const { items, changedSubset } = measured;
  const inChanged = (row: CaseRows[number]) => isString(row.taskId) && changed?.includes(row.taskId) === true;
  return {
    items: items.map((item) => ({ item: item.item, ...less(item, (row) => row.family === item.item) })),
    ...keyIfDefined(
      "changedSubset",
      changedSubset && Array.isArray(changed) ? less(changedSubset, inChanged) : undefined,
    ),
  };
}

function admittedClimbRow(
  admitted: Extract<BatteryAdmission, { ok: true }>,
  wallMinutes: number | null,
  analysisDir: string,
): AdmittedClimbRow {
  const { evidence } = admitted;
  const settledIds = settledAgainstCheck(analysisDir, admitted.runId);
  // A veto settled against its check is dropped rather than turned into a fail: a flip is the one
  // direction that lowers passes, so it would let a model's reading manufacture a limit.
  const all = (evidence.cases ?? []).filter((row) => isBoolean(row.pass));
  const settled = all.filter((row) => isString(row.taskId) && settledIds.has(row.taskId));
  const scored = all.filter((row) => !settled.includes(row));
  const measured = unsettledMeasure(admitted.measured, settled, evidence.experimentAuthoring?.changedTaskIds);
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
      scoringHash: isString(evidence.bundleSnapshot?.scoringHash)
        ? evidence.bundleSnapshot.scoringHash
        : null,
      regrade:
        isString(evidence.regrade?.of) && isNumber(evidence.regrade.reused) && evidence.regrade.reused > 0
          ? { of: evidence.regrade.of, reused: evidence.regrade.reused }
          : null,
      caseIds: (evidence.cases ?? []).map((row) => (isString(row.taskId) ? row.taskId : null)),
      familySummary: familySummary(measured),
      effort: solveEffort(evidence.cases ?? []),
      familyEffort: familyEffort(evidence.cases ?? []),
      passedTaskIds: all.flatMap((row) => (row.pass === true && isString(row.taskId) ? [row.taskId] : [])),
      solveWallMinutes: wallMinutes,
      wallBound: wallBoundCount(scored, wallMinutes),
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
      ...keyIfTruthy("settledAgainst", settled.length),
      // Refused rows stay in `n` as fails; `ClimbBattery.unaccepted` says why.
      unaccepted: countUnaccepted(scored),
      measured,
    },
  };
}

/** The paths a read at `at` takes. A pinned read of a campaign compares thresholds against the
 *  repository's frozen manifest; the public history view (a null pin) reads batteries under every
 *  manifest, as it reads them under every pin. */
export function climbEvidencePaths(at: ClimbEvidenceAt, runPin: string | null): ClimbEvidencePaths {
  if ("claimsDir" in at) return at;
  return {
    claimsDir: claimsDirFor(at.repoRoot, at.slug),
    ...keysIf(runPin !== null, () => ({ manifestPath: frozenManifestPath(at.repoRoot) })),
  };
}

/**
 * Reads the adopted tree's measured history. `admitBattery` owns the recorded-byte, run, model,
 * threshold, variant and claim checks and names the run behind every exclusion, so the loop here
 * is the population law itself: a directory holding a battery is admitted or excluded, and an
 * admitted battery whose claim was refused is both — it keeps a history row carrying its own
 * refusal and enters no rate. Drop such a battery and a 0 of 25 made entirely of provider outages
 * disappears, leaving the next reader to take the experiment before it for the latest thing
 * measured, and the outage for a too-hard base.
 *
 * Chronology is the claims' recorded `createdAt`, with runId as the tiebreak, and never file
 * mtime. Scored rows — those with a boolean `pass` — are the denominator, and `pass: null` counts
 * neither way. A null runPin serves the public history view alone, which keeps batteries at other
 * model pins and threshold manifests readable with their labels.
 */
export function readClimbBatteries(
  domainDir: string,
  runPin: string | null,
  at: ClimbEvidenceAt,
): ClimbBatteriesRead {
  const { claimsDir, manifestPath } = climbEvidencePaths(at, runPin);
  const thresholdDigest = currentThresholdDigest(manifestPath);
  const excluded: ExcludedBattery[] = [];
  const history: AdmittedClimbRow[] = [];
  const analysisDir = join(dirname(claimsDir), "analysis");
  for (const dir of productHistoryDirs(domainDir)) {
    const root = join(dir, "runs");
    if (!existsSync(root)) continue;
    const wall = solveWallMinutes(dir);
    for (const name of readdirSync(root)) {
      const admission = admitBattery(join(root, name), name, runPin, thresholdDigest, claimsDir);
      if (admission === null) continue;
      if (admission.excluded !== null) excluded.push(admission.excluded);
      if (admission.ok) history.push(admittedClimbRow(admission, wall, analysisDir));
    }
  }
  history.sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.battery.runId.localeCompare(b.battery.runId),
  );
  excluded.sort((a, b) => a.runId.localeCompare(b.runId));
  return { history, admitted: history.filter((row) => row.excludedReason === null), excluded };
}

function solveWallMinutes(productDir: string): number | null {
  try {
    return harnessSettings(productDir).solveMs / 60_000;
  } catch (cause) {
    if (cause instanceof HarnessConfigError) return null;
    throw cause;
  }
}

/** The one retained directory holding `runId`, or null when none or several do. */
export function retainedRunDir(domainDir: string, runId: string): string | null {
  const matches = productHistoryDirs(domainDir)
    .map((dir) => join(dir, "runs", runId))
    .filter(existsSync);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/** A recorded battery's public tasks, read through the evidence log and refused whole whenever any
 *  one case cannot be vouched for, since a partial projection would be a different exam wearing
 *  the same run id. Its one reader is the context tool's history source, for each battery's task
 *  page. */
export function publicTaskProjection(
  domainDir: string,
  runId: string,
  caseIds: Array<string | null>,
): { tasks: unknown[] } | { refusal: string } {
  if (caseIds.length === 0) return { refusal: "no verified case identifiers" };
  const ids = caseIds.filter((id): id is string => id !== null);
  if (ids.length !== caseIds.length) return { refusal: "a verified case states no task identifier" };
  const runDir = retainedRunDir(domainDir, runId);
  if (runDir === null) {
    return { refusal: "the admitted battery has no unique retained run directory" };
  }
  const violations = verifyRunDir(runDir);
  const casesDir = join(runDir, "cases");
  const extra = existsSync(casesDir) ? readdirSync(casesDir).filter((name) => !caseIds.includes(name)) : [];
  if (extra.length > 0) {
    return { refusal: `${extra.length} case projection(s) beyond the verified case rows — refused as extra` };
  }
  return recordedPublicTasks(runDir, ids, violations);
}

/** The public tasks one run directory recorded for `ids`, each read through the evidence log and
 *  bound to its case identity, and refused whole when any one cannot be vouched for. */
export function recordedPublicTasks(
  runDir: string,
  ids: readonly string[],
  violations: ReturnType<typeof verifyRunDir>,
): { tasks: unknown[] } | { refusal: string } {
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
