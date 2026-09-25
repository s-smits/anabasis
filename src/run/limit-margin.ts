/**
 * Limit margin: how close the numeric limits a truth check compares sit to the value the
 * candidate's own reference solve produced for the same task.
 *
 * The worry it answers is a Builder that derives a hidden limit from its reference solve — a limit
 * set at the reference's value times 1.02, say — so that a battery measures agreement with the
 * author's own answer rather than the domain's validity relation, and a tighter reference caps how
 * hard the tasks can be. A share of limits within 5% of the reference is the reading; it says
 * nothing about why they sit there, since a genuinely tight domain limit reads the same way.
 *
 * The pairing is a heuristic, not a proven mapping. A check declares which artifact paths it reads
 * and carries one hidden operand per task, but nothing states which leaf of that operand is compared
 * with which artifact value. So each finite numeric leaf of the operand is paired with the nearest
 * finite number the reference artifact holds under any of the check's declared artifact paths, by
 * relative distance |h − r| / max(|r|, ε). A leaf with no number to pair against is counted as
 * unpaired rather than guessed at, and a task whose reference artifact is absent or is not an object
 * or array contributes no row at all.
 *
 * Every number here is computed from protected values — hidden expectations and reference
 * artifacts — so the file is host-only evidence under the campaign's analysis directory, read by
 * the operator's outcome report and by nothing that composes model-visible text. It is reporting
 * only: nothing reads it to refuse, route or score. The reference solve's elapsed time is not part
 * of it, because F2 records no per-task duration to read.
 */
import { dirname, join } from "../meta/path.ts";
import { isNumber, isRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { resolveJsonPath } from "../meta/json-evidence.ts";
import { writeJsonFile } from "../meta/completed-json.ts";
import { existsSync, mkdirSync, readFileSync } from "../meta/filesystem.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import type { SolvabilityCaseEvidence, SolvabilityEvidence } from "../claim/readiness.ts";
import { type Brief, applicableTruthChecks } from "../truth/brief.ts";
import type { BuildTask } from "../truth/tasks.ts";

export const LIMIT_MARGIN_SCHEMA = "limit-margin/v1";

/** Stated in the evidence itself, so no reader mistakes a heuristic reading for a proven one. */
export const LIMIT_MARGIN_PAIRING =
  "heuristic pairing: each finite numeric leaf of a check's hidden operand is paired with the nearest finite number the reference artifact holds under that check's declared artifact paths, by |h - r| / max(|r|, 1e-12); not a proven mapping";

/** Guards the relative distance against a reference value of zero. */
const EPSILON = 1e-12;

export interface LimitMarginFamily {
  family: string;
  /** Tasks whose reference artifact contributed at least one paired or unpaired leaf. */
  tasks: number;
  paired: number;
  within1pct: number;
  within5pct: number;
  /** Median relative distance over the paired leaves; null when none paired. */
  medianRelativeDistance: number | null;
  unpaired: number;
}

interface Leaves {
  distances: number[];
  unpaired: number;
}

interface LimitMarginEvidence {
  schema: typeof LIMIT_MARGIN_SCHEMA;
  runId: string;
  pairing: string;
  families: LimitMarginFamily[];
}

/** Where one battery's limit margin lives: beside the claim's campaign, under `analysis/`, which
 *  the Builder's file wall denies and no model-visible reader opens by this name. */
export function limitMarginFile(campaignDirectory: string, runId: string): string {
  return join(campaignDirectory, "analysis", `${runId}-limit-margin.json`);
}

function numericLeaves(value: unknown): number[] {
  if (isNumber(value)) return Number.isFinite(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(numericLeaves);
  if (isRecord(value)) return Object.values(value).flatMap(numericLeaves);
  return [];
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

/** One task's leaves: a distance for every paired leaf and a count of the unpaired ones. */
function taskLeaves(brief: Brief, task: BuildTask, artifact: JsonValue): Leaves {
  const tally: Leaves = { distances: [], unpaired: 0 };
  const hiddenByCheck = new Map(task.hidden.map((row) => [row.checkId, row.expectation]));
  for (const check of applicableTruthChecks(brief, task)) {
    const limits = numericLeaves(hiddenByCheck.get(check.id));
    if (limits.length === 0) continue;
    const reference = check.execution.artifactPaths.flatMap((path) => {
      const resolved = resolveJsonPath(artifact, path);
      return resolved.found ? numericLeaves(resolved.value) : [];
    });
    for (const limit of limits) {
      if (reference.length === 0) tally.unpaired += 1;
      else {
        const distances = reference.map(
          (value) => Math.abs(limit - value) / Math.max(Math.abs(value), EPSILON),
        );
        tally.distances.push(Math.min(...distances));
      }
    }
  }
  return tally;
}

/** Per-family margins over the reference artifacts the solvability witness recorded. A case whose
 *  task is not in the battery, or whose artifact is absent or not an object or array, is skipped
 *  rather than read as a row. */
export function limitMargin(
  brief: Brief,
  tasks: readonly BuildTask[],
  cases: readonly SolvabilityCaseEvidence[],
): LimitMarginFamily[] {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const families = new Map<string, Leaves & { tasks: number }>();
  for (const row of cases) {
    const task = byId.get(row.taskId);
    if (task === undefined || !(Array.isArray(row.artifact) || isRecord(row.artifact))) continue;
    const leaves = taskLeaves(brief, task, row.artifact);
    if (leaves.distances.length + leaves.unpaired === 0) continue;
    const tally = families.get(task.family) ?? { tasks: 0, distances: [], unpaired: 0 };
    tally.tasks += 1;
    tally.distances.push(...leaves.distances);
    tally.unpaired += leaves.unpaired;
    families.set(task.family, tally);
  }
  return [...families.entries()]
    .toSorted(([a], [b]) => compareCodeUnits(a, b))
    .map(([family, tally]) => ({
      family,
      tasks: tally.tasks,
      paired: tally.distances.length,
      within1pct: tally.distances.filter((distance) => distance <= 0.01).length,
      within5pct: tally.distances.filter((distance) => distance <= 0.05).length,
      medianRelativeDistance: median(tally.distances),
      unpaired: tally.unpaired,
    }));
}

/** Record the margin for one battery. A claim written without a solvability witness has no
 *  reference artifacts to read, so it records nothing rather than an empty reading. */
export function writeLimitMargin(
  path: string,
  runId: string,
  reading: { brief: Brief; tasks: readonly BuildTask[]; solvability: SolvabilityEvidence | null },
): void {
  if (reading.solvability === null) return;
  const evidence: LimitMarginEvidence = {
    schema: LIMIT_MARGIN_SCHEMA,
    runId,
    pairing: LIMIT_MARGIN_PAIRING,
    families: limitMargin(reading.brief, reading.tasks, reading.solvability.cases),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeJsonFile(path, evidence);
}

/** The recorded margin, or null when absent, damaged or of another schema. */
export function readLimitMargin(path: string): LimitMarginEvidence | null {
  if (!existsSync(path)) return null;
  let recorded: Partial<LimitMarginEvidence>;
  try {
    recorded = parseJsonAs<Partial<LimitMarginEvidence>>(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  const { schema, runId, pairing, families } = recorded ?? {};
  if (schema !== LIMIT_MARGIN_SCHEMA || !isString(runId) || !isString(pairing) || !Array.isArray(families)) {
    return null;
  }
  return { schema, runId, pairing, families };
}
