import { existsSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isBoolean, isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { basename, join } from "#src/meta/path.ts";

const BASE_PREFIX = "base-";
const STARTER_PREFIX = "starter-";
const BASELINE_PREFIXES = [BASE_PREFIX, STARTER_PREFIX] as const;
export const JUDGE_DETAILS_FILE = "claude-opus-5-5_judge.json";

export type SolverTier = "bareSolver" | "baseStarter" | "builtSolver";

export interface BenchRecord {
  readonly arm: string;
  readonly task: string;
  readonly label: string;
  readonly harness: string;
  readonly runtime: string;
  readonly tier: SolverTier;
  readonly points: number;
  readonly total: number;
  readonly criteriaPassed: number | null;
  readonly criteriaTotal: number | null;
  readonly rubricsPassed: number | null;
  readonly rubricsTotal: number | null;
  readonly solveUsd: number;
  readonly judgeUsd: number;
  readonly seconds: number;
  readonly cutCount: number;
  readonly cutUnknown: boolean;
  readonly peekedCount: number;
  readonly delivered: boolean;
  readonly campaign: string | null;
  readonly buildOf: string | null;
}

export interface PairedBenchArm {
  readonly arm: string;
  readonly baselineArm: string;
  readonly builtTier: SolverTier;
  readonly baselineTier: SolverTier;
  readonly harness: string;
  readonly runtime: string;
  readonly baselineRuntime: string;
  readonly sharedTasks: readonly string[];
  readonly droppedBaselineTasks: readonly string[];
  readonly built: readonly BenchRecord[];
  readonly baseline: readonly BenchRecord[];
}

export function solverTierOf(record: Pick<BenchRecord, "arm" | "buildOf">): SolverTier {
  const origin = record.buildOf?.trim() ?? "";
  if (
    origin === "base" ||
    record.arm === "base" ||
    record.arm.startsWith(BASE_PREFIX) ||
    record.arm.startsWith("bare-")
  ) {
    return "bareSolver";
  }
  if (origin === "starter" || record.arm.startsWith(STARTER_PREFIX)) return "baseStarter";
  return "builtSolver";
}

export function criteriaFromRubrics(rubrics: unknown): readonly [number | null, number | null] {
  if (!Array.isArray(rubrics)) return [null, null];
  let passed = 0;
  let total = 0;
  for (const entry of rubrics) {
    const result = asRecord(asRecord(entry)?.result);
    if (result === null || !isNumber(result.criteria_passed) || !isNumber(result.criteria_count)) {
      return [null, null];
    }
    passed += result.criteria_passed;
    total += result.criteria_count;
  }
  return [passed, total];
}

export function criteriaOfDetails(
  datasetDir: string,
  task: string,
  label: string,
): readonly [number | null, number | null] {
  if (label === "") return [null, null];
  const file = join(datasetDir, task, "eval_result", `eval_${label}`, JUDGE_DETAILS_FILE);
  if (!existsSync(file)) return [null, null];
  try {
    const content = readFileSync(file, "utf8");
    if (content.trim() === "") return [null, null];
    const raw = asRecord(capturedJsonParse(content));
    return criteriaFromRubrics(raw?.rubrics);
  } catch {
    return [null, null];
  }
}

function sumCriteria(
  records: readonly Pick<BenchRecord, "criteriaPassed" | "criteriaTotal">[],
): readonly [number | null, number | null] {
  let passed = 0;
  let total = 0;
  for (const rec of records) {
    if (rec.criteriaPassed === null || rec.criteriaTotal === null) return [null, null];
    passed += rec.criteriaPassed;
    total += rec.criteriaTotal;
  }
  return [passed, total];
}

export function formatCriteria(
  records: readonly Pick<BenchRecord, "criteriaPassed" | "criteriaTotal">[],
): string {
  const [passed, total] = sumCriteria(records);
  return passed === null || total === null ? "?/?" : `${String(passed)}/${String(total)}`;
}

export function isBaselineArmName(arm: string): boolean {
  return BASELINE_PREFIXES.some((prefix) => arm.startsWith(prefix));
}

export function baselineCandidates(byArm: ReadonlyMap<string, readonly unknown[]>, label: string): string[] {
  return BASELINE_PREFIXES.map((prefix) => `${prefix}${label}`).filter((candidate) => byArm.has(candidate));
}

export function runtimeOfFile(file: string): string | null {
  try {
    const raw = asRecord(capturedJsonParse(readFileSync(file, "utf8")));
    if (raw === null) return null;
    return isString(raw.runtime) ? raw.runtime : "claude-code";
  } catch {
    return null;
  }
}

export function uniformRuntime(records: readonly Pick<BenchRecord, "runtime">[]): string | null {
  if (records.length === 0) return null;
  const runtimes = new Set(records.map(({ runtime }) => runtime));
  return runtimes.size === 1 ? (records[0]?.runtime ?? null) : null;
}

function campaignNameOf(rawOf: string | null): string | null {
  if (rawOf === null) return null;
  const trimmed = rawOf.trim().replace(/\/+$/u, "");
  if (trimmed === "" || trimmed === "starter" || trimmed === "base" || trimmed.startsWith("sweep ")) {
    return null;
  }
  const leaf = basename(trimmed);
  return leaf === "" || leaf === "starter" || leaf === "base" ? null : leaf;
}

export const hasOneBefore = (task: string): boolean => !task.endsWith("/task1");

export const isCut = (record: Pick<BenchRecord, "cutCount" | "cutUnknown">): boolean =>
  record.cutUnknown || record.cutCount > 0;

function parseBenchRecord(store: string, armDir: string, file: string): BenchRecord | null {
  let raw: JsonObject | null;
  try {
    raw = asRecord(capturedJsonParse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
  if (raw === null || !isString(raw.task) || !isNumber(raw.points) || !isNumber(raw.total)) return null;
  const arm = isString(raw.arm) ? raw.arm : armDir;
  const label = isString(raw.label) ? raw.label : "";
  const buildOfValue = asRecord(raw.build)?.of;
  const buildOf = isString(buildOfValue) ? buildOfValue : null;
  const [criteriaPassed, criteriaTotal] =
    isNumber(raw.criteriaPassed) && isNumber(raw.criteriaTotal)
      ? [raw.criteriaPassed, raw.criteriaTotal]
      : criteriaOfDetails(join(store, "dataset"), raw.task, label);
  return {
    arm,
    task: raw.task,
    label,
    harness: isString(raw.harness) ? raw.harness : "",
    runtime: isString(raw.runtime) ? raw.runtime : "claude-code",
    tier: solverTierOf({ arm, buildOf }),
    points: raw.points,
    total: raw.total,
    criteriaPassed,
    criteriaTotal,
    rubricsPassed: isNumber(raw.passed) ? raw.passed : null,
    rubricsTotal: isNumber(raw.rubrics) ? raw.rubrics : null,
    solveUsd: isNumber(raw.solveUsd) ? raw.solveUsd : 0,
    judgeUsd: isNumber(raw.judgeUsd) ? raw.judgeUsd : 0,
    seconds: isNumber(raw.seconds) ? raw.seconds : 0,
    cutCount: Array.isArray(raw.cut) ? raw.cut.length : 0,
    cutUnknown: raw.cut === null,
    peekedCount: Array.isArray(raw.peeked) ? raw.peeked.length : 0,
    delivered: isBoolean(raw.delivered) ? raw.delivered : true,
    campaign: campaignNameOf(buildOf),
    buildOf,
  };
}

export function judgedFilesByArm(store: string): Map<string, readonly string[]> {
  const root = join(store, "judged");
  if (!existsSync(root)) return new Map();
  const arms = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  return new Map(
    arms.map((arm) => [
      arm,
      readdirSync(join(root, arm))
        .filter((file) => file.endsWith(".json"))
        .toSorted(),
    ]),
  );
}

export function readJudgedStore(store: string): BenchRecord[] {
  const root = join(store, "judged");
  return [...judgedFilesByArm(store)].flatMap(([arm, files]) =>
    files.flatMap((file) => {
      const record = parseBenchRecord(store, arm, join(root, arm, file));
      return record === null ? [] : [record];
    }),
  );
}

export function pairedArmsOf(records: readonly BenchRecord[]): PairedBenchArm[] {
  const byArm = Map.groupBy(records, ({ arm }) => arm);
  const pairs: PairedBenchArm[] = [];
  for (const [arm, own] of [...byArm.entries()].toSorted(([one], [other]) => one.localeCompare(other))) {
    if (isBaselineArmName(arm) || own.some((rec) => rec.tier !== "builtSolver")) continue;
    const ownRuntime = uniformRuntime(own);
    if (ownRuntime === null) continue;
    const ownByTask = new Map(own.map((rec) => [rec.task, rec]));
    const candidates: PairedBenchArm[] = [];
    for (const baselineArm of baselineCandidates(byArm, arm)) {
      const baselineAll = byArm.get(baselineArm);
      if (baselineAll === undefined) continue;
      const baseRuntime = uniformRuntime(baselineAll);
      if (baseRuntime === null) continue;
      const baselineByTask = new Map(baselineAll.map((rec) => [rec.task, rec]));
      const droppedBaselineTasks = own
        .filter((rec) => {
          const base = baselineByTask.get(rec.task);
          return base !== undefined && !base.delivered;
        })
        .map((rec) => rec.task)
        .toSorted();
      const sharedTasks = own
        .filter((rec) => baselineByTask.get(rec.task)?.delivered === true)
        .map((rec) => rec.task)
        .toSorted();
      if (sharedTasks.length === 0) continue;
      const built = sharedTasks.flatMap((task) => {
        const rec = ownByTask.get(task);
        return rec === undefined ? [] : [rec];
      });
      const baseline = sharedTasks.flatMap((task) => {
        const rec = baselineByTask.get(task);
        return rec === undefined ? [] : [rec];
      });
      const [lead] = built;
      const [baselineLead] = baseline;
      if (lead === undefined || baselineLead === undefined) continue;
      candidates.push({
        arm,
        baselineArm,
        builtTier: lead.tier,
        baselineTier: baselineLead.tier,
        harness: lead.harness,
        runtime: ownRuntime,
        baselineRuntime: baseRuntime,
        sharedTasks,
        droppedBaselineTasks,
        built,
        baseline,
      });
    }
    candidates.sort((one, other) => {
      const oneMatch = one.runtime === one.baselineRuntime ? 1 : 0;
      const otherMatch = other.runtime === other.baselineRuntime ? 1 : 0;
      if (otherMatch !== oneMatch) return otherMatch - oneMatch;
      if (other.sharedTasks.length !== one.sharedTasks.length) {
        return other.sharedTasks.length - one.sharedTasks.length;
      }
      return (other.baselineTier === "bareSolver" ? 1 : 0) - (one.baselineTier === "bareSolver" ? 1 : 0);
    });
    const [best] = candidates;
    if (best !== undefined) pairs.push(best);
  }
  return pairs;
}
