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
 * A limit the task publishes needs no guess, and reading hidden operands alone misses it: a battery
 * whose every cap is public carries no hidden limit, so its report comes out empty. A complete
 * `numericBoundaries` declaration names both the public limit and the artifact path it bounds, so
 * each published limit is read against the reference through `readMargins`, the same comparison the
 * Built solver's writer reports, and tallied in its own `published` row. A published limit whose
 * limit or reported value is unreadable counts as unpaired.
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
import { publishedMargins } from "../truth/numeric-boundary.ts";
import type { BuildTask } from "../truth/tasks.ts";
import { type PublishedMargin, readMargins } from "../solve/published-margin.ts";

export const LIMIT_MARGIN_SCHEMA = "limit-margin/v2";

/** Stated in the evidence itself, so no reader mistakes a heuristic reading for a proven one. */
export const LIMIT_MARGIN_PAIRING =
  "heuristic pairing for hidden limits: each finite numeric leaf of a check's hidden operand is paired with the nearest finite number the reference artifact holds under that check's declared artifact paths, by |h - r| / max(|r|, 1e-12); not a proven mapping. Published limits are paired by their declared numericBoundaries entry and measured at the same distance";

/** Guards the relative distance against a reference value of zero. */
const EPSILON = 1e-12;

/** Where a row's limits come from: hidden operands paired by heuristic, or published limits paired
 *  by their declared numeric boundary. */
type LimitSource = "hidden" | "published";

export interface LimitMarginFamily {
  family: string;
  limits: LimitSource;
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

const relativeDistance = (limit: number, value: number): number =>
  Math.abs(limit - value) / Math.max(Math.abs(value), EPSILON);

/** One task's hidden leaves: a distance for every paired leaf and a count of the unpaired ones. */
function hiddenLeaves(brief: Brief, task: BuildTask, artifact: JsonValue): Leaves {
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
        tally.distances.push(Math.min(...reference.map((value) => relativeDistance(limit, value))));
      }
    }
  }
  return tally;
}

/** One task's published limits, each read against the reference at its declared artifact path. */
function publishedLeaves(margins: readonly PublishedMargin[], task: BuildTask, artifact: JsonValue): Leaves {
  const tally: Leaves = { distances: [], unpaired: 0 };
  for (const { limit, reported } of readMargins(margins, task.family, task.publicInput, artifact)) {
    if (limit === null || reported === null) tally.unpaired += 1;
    else tally.distances.push(relativeDistance(limit, reported));
  }
  return tally;
}

/** Per-family margins over the reference artifacts the solvability witness recorded. A case whose
 *  task is not in the battery, or whose artifact is absent or not an object or array, is skipped
 *  rather than read as a row. */
export function limitMargin(
  brief: Brief,
  tasks: readonly BuildTask[],
  cases: readonly Pick<SolvabilityCaseEvidence, "taskId" | "artifact">[],
): LimitMarginFamily[] {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const margins = publishedMargins(brief);
  const families = new Map<string, Leaves & { family: string; limits: LimitSource; tasks: number }>();
  const add = (family: string, limits: LimitSource, leaves: Leaves): void => {
    if (leaves.distances.length + leaves.unpaired === 0) return;
    const key = `${family}\u0000${limits}`;
    const tally = families.get(key) ?? { family, limits, tasks: 0, distances: [], unpaired: 0 };
    tally.tasks += 1;
    tally.distances.push(...leaves.distances);
    tally.unpaired += leaves.unpaired;
    families.set(key, tally);
  };
  for (const row of cases) {
    const task = byId.get(row.taskId);
    if (task === undefined || !(Array.isArray(row.artifact) || isRecord(row.artifact))) continue;
    add(task.family, "hidden", hiddenLeaves(brief, task, row.artifact));
    add(task.family, "published", publishedLeaves(margins, task, row.artifact));
  }
  return [...families.entries()]
    .toSorted(([a], [b]) => compareCodeUnits(a, b))
    .map(([, { family, limits, ...tally }]) => ({
      family,
      limits,
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
