import { existsSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isBoolean, isNumber, isString } from "#src/meta/json-shape.ts";
import { basename, join } from "#src/meta/path.ts";

const BASE_PREFIX = "base-";
const STARTER_PREFIX = "starter-";
const BASELINE_PREFIXES = [BASE_PREFIX, STARTER_PREFIX] as const;

export type SolverTier = "bareSolver" | "baseStarter" | "builtSolver";

export interface BenchRecord {
  readonly arm: string;
  readonly task: string;
  readonly harness: string;
  readonly runtime: string;
  readonly points: number;
  readonly total: number;
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
  readonly built: readonly BenchRecord[];
  readonly baseline: readonly BenchRecord[];
}

function solverTierOf(record: Pick<BenchRecord, "arm" | "buildOf">): SolverTier {
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

export function isBaselineArmName(arm: string): boolean {
  return BASELINE_PREFIXES.some((prefix) => arm.startsWith(prefix));
}

export function baselineArmFor(byArm: ReadonlyMap<string, readonly unknown[]>, label: string): string | null {
  for (const prefix of BASELINE_PREFIXES) {
    const candidate = `${prefix}${label}`;
    if (byArm.has(candidate)) return candidate;
  }
  return null;
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

function parseBenchRecord(armDir: string, file: string): BenchRecord | null {
  const raw = asRecord(capturedJsonParse(readFileSync(file, "utf8")));
  if (raw === null || !isString(raw.task) || !isNumber(raw.points) || !isNumber(raw.total)) return null;
  const buildOfValue = asRecord(raw.build)?.of;
  const buildOf = isString(buildOfValue) ? buildOfValue : null;
  return {
    arm: isString(raw.arm) ? raw.arm : armDir,
    task: raw.task,
    harness: isString(raw.harness) ? raw.harness : "",
    runtime: isString(raw.runtime) ? raw.runtime : "claude-code",
    points: raw.points,
    total: raw.total,
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
      const record = parseBenchRecord(arm, join(root, arm, file));
      return record === null ? [] : [record];
    }),
  );
}

export function pairedArmsOf(records: readonly BenchRecord[]): PairedBenchArm[] {
  const byArm = Map.groupBy(records, ({ arm }) => arm);
  const pairs: PairedBenchArm[] = [];
  for (const [arm, own] of [...byArm.entries()].toSorted(([one], [other]) => one.localeCompare(other))) {
    if (isBaselineArmName(arm)) continue;
    const baselineArm = baselineArmFor(byArm, arm);
    if (baselineArm === null) continue;
    const baselineAll = byArm.get(baselineArm);
    if (baselineAll === undefined) continue;
    const baselineByTask = new Map(baselineAll.map((rec) => [rec.task, rec]));
    const sharedTasks = own
      .filter((rec) => baselineByTask.has(rec.task))
      .map((rec) => rec.task)
      .toSorted();
    if (sharedTasks.length === 0) continue;
    const ownByTask = new Map(own.map((rec) => [rec.task, rec]));
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
    pairs.push({
      arm,
      baselineArm,
      builtTier: solverTierOf(lead),
      baselineTier: solverTierOf(baselineLead),
      harness: lead.harness,
      runtime: lead.runtime,
      baselineRuntime: baselineLead.runtime,
      sharedTasks,
      built,
      baseline,
    });
  }
  return pairs;
}
