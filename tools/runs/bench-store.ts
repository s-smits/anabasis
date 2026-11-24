/**
 * Single production owner for reading judged external-benchmark records (`<store>/judged/<arm>/*.json`),
 * normalizing campaign provenance, and pairing built arms against their paired `starter-<arm>` baselines.
 * Shared by `tools/runs/bench-scores.ts`, `tools/wri/{domains,regressions}.ts`, and
 * `.claude/skills/promotion-tuner/scripts/outside.ts`.
 */
import { existsSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isBoolean, isNumber, isString } from "#src/meta/json-shape.ts";
import { basename, join } from "#src/meta/path.ts";

export const STARTER_PREFIX = "starter-";

/** Three solver harness tiers (`AGENTS.md` §3): raw runtime (`bareSolver`), Starter (`baseStarter`), and Builder harness (`builtSolver`). */
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
  /** Normalized campaign name (or null for Starter/unlinked arms). */
  readonly campaign: string | null;
  /** Raw `build.of` field as stored on disk (`"starter"` for `baseStarter`, `"base"` for `bareSolver`). */
  readonly buildOf: string | null;
}

export interface PairedBenchArm {
  readonly arm: string;
  readonly starterArm: string;
  readonly builtTier: SolverTier;
  readonly baselineTier: SolverTier;
  readonly harness: string;
  readonly runtime: string;
  readonly starterRuntime: string;
  readonly sharedTasks: readonly string[];
  readonly built: readonly BenchRecord[];
  readonly starter: readonly BenchRecord[];
}

/** Classifies a judged record into `bareSolver`, `baseStarter`, or `builtSolver`. */
function solverTierOf(record: Pick<BenchRecord, "arm" | "buildOf">): SolverTier {
  const origin = record.buildOf?.trim() ?? "";
  if (origin === "base" || record.arm === "base" || record.arm.startsWith("bare-")) return "bareSolver";
  if (origin === "starter" || record.arm.startsWith(STARTER_PREFIX)) return "baseStarter";
  return "builtSolver";
}

/** Extracts a campaign folder name from raw `build.of` (bare name, archive path, or worktree path). */
function campaignNameOf(rawOf: string | null): string | null {
  if (rawOf === null) return null;
  const trimmed = rawOf.trim().replace(/\/+$/u, "");
  if (trimmed === "" || trimmed === "starter" || trimmed === "base" || trimmed.startsWith("sweep ")) {
    return null;
  }
  const leaf = basename(trimmed);
  return leaf === "" || leaf === "starter" ? null : leaf;
}

/** Whether `task` is on the fair subset (excludes tasks that reference an unrun prior task). */
export const hasOneBefore = (task: string): boolean => !task.endsWith("/task1");

/** Whether the judge's reader cut or skipped extracting any deliverable on `record`. */
export const isCut = (record: Pick<BenchRecord, "cutCount" | "cutUnknown">): boolean =>
  record.cutUnknown || record.cutCount > 0;

/** Parses one `judged/<arm>/<task>.json` file, returning null when unjudged or malformed. */
function parseBenchRecord(armDir: string, file: string): BenchRecord | null {
  const raw = asRecord(capturedJsonParse(readFileSync(file, "utf8")));
  if (raw === null || !isString(raw.task) || !isNumber(raw.points) || !isNumber(raw.total)) return null;
  const buildOfValue = asRecord(raw.build)?.of;
  const buildOf = isString(buildOfValue) ? buildOfValue : null;
  const cutUnknown = raw.cut === null;
  const cutCount = Array.isArray(raw.cut) ? raw.cut.length : 0;
  const peekedCount = Array.isArray(raw.peeked) ? raw.peeked.length : 0;
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
    cutCount,
    cutUnknown,
    peekedCount,
    delivered: isBoolean(raw.delivered) ? raw.delivered : true,
    campaign: campaignNameOf(buildOf),
    buildOf,
  };
}

/** Maps each arm directory under `<store>/judged/` to its sorted `.json` task filenames. */
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

/** Reads every judged task record under `<store>/judged/<arm>/*.json` in deterministic sorted order. */
export function readJudgedStore(store: string): BenchRecord[] {
  const root = join(store, "judged");
  return [...judgedFilesByArm(store)].flatMap(([arm, files]) =>
    files.flatMap((file) => {
      const record = parseBenchRecord(arm, join(root, arm, file));
      return record === null ? [] : [record];
    }),
  );
}

/** Pairs every non-starter arm `<arm>` with its matching `starter-<arm>` over their shared tasks. */
export function pairedArmsOf(records: readonly BenchRecord[]): PairedBenchArm[] {
  const byArm = Map.groupBy(records, ({ arm }) => arm);
  const pairs: PairedBenchArm[] = [];
  for (const [arm, own] of [...byArm.entries()].toSorted(([one], [other]) => one.localeCompare(other))) {
    if (arm.startsWith(STARTER_PREFIX)) continue;
    const starterArm = `${STARTER_PREFIX}${arm}`;
    const starterAll = byArm.get(starterArm);
    if (starterAll === undefined) continue;
    const starterByTask = new Map(starterAll.map((rec) => [rec.task, rec]));
    const sharedTasks = own
      .filter((rec) => starterByTask.has(rec.task))
      .map((rec) => rec.task)
      .toSorted();
    if (sharedTasks.length === 0) continue;
    const ownByTask = new Map(own.map((rec) => [rec.task, rec]));
    const built = sharedTasks.flatMap((task) => {
      const rec = ownByTask.get(task);
      return rec === undefined ? [] : [rec];
    });
    const starter = sharedTasks.flatMap((task) => {
      const rec = starterByTask.get(task);
      return rec === undefined ? [] : [rec];
    });
    const lead = built[0];
    const starterLead = starter[0];
    if (lead === undefined || starterLead === undefined) continue;
    pairs.push({
      arm,
      starterArm,
      builtTier: solverTierOf(lead),
      baselineTier: solverTierOf(starterLead),
      harness: lead.harness,
      runtime: lead.runtime,
      starterRuntime: starterLead.runtime,
      sharedTasks,
      built,
      starter,
    });
  }
  return pairs;
}
