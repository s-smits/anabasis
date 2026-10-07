// How a campaign climbs, read two ways: the line its measured batteries draw, and whether the tasks
// behind each edge moved. The controller can only steer on a measured pass rate, so a battery the
// provider wrecked tells it nothing and it re-decides on the last battery that scored, and a run
// can record the same "significantly too easy" placement round after round, every one citing one
// battery. This reads the other channel too: whether the tasks moved, by how much, and in which of
// the two ways a battery can move. Lane 10 reads the line and lane 20 the edges.
//
//   bun wri.ts climb <target> [--json]
//
// The line and its four numbers are AGENTS.md "Goals and the climb". `lineOf` reads signal, swing
// and flat from each claimed battery's placement counts, flat through `offAimStreak` so that it
// is the stall `runs pulse` names, and each edge's `carried` row counts the tasks measured again
// unchanged (`carriedOf`) and whether the battery before them was a full pass (`fullPass`).
// Each battery's `followUp` follows its earned fails into the next battery (`followUpOf`).
//
// Each battery carries two placements. `placement` is computed here from the case rows through
// `decideDifficulty`; `recorded` is what the controller wrote in its difficulty decision, read through
// the schema-refusing reader `runs` owns, so the two can be compared and a decision under another
// schema is named rather than read.
//
// Per battery: the tier histogram and the median structural row from query-complexity.ts, plus
// the measured outcome when there is one. Per edge between consecutive batteries:
//
//   restated      the prose did not move and neither did the structure
//   replaced      fewer than half the tasks carried over, by id or, renamed, by family and input
//                 structure; with none left the numbers are read per path
//   adjusted      the same structural counts at the same tier, with the published numbers moved
//   narrowed      fewer of a structural count at the same tier, per task or over the battery;
//                 checks, coupled inputs and scenarios decide first
//   widened       more of a structural count at the same tier, per task or over the battery;
//                 checks, coupled inputs and scenarios decide first
//   eased         the checks moved down the tier order
//   escalated     the checks moved up the tier order
//
// Every verdict but `adjusted` names its direction. `adjusted` does not: `numericDriftOf` measures
// distance and not direction, because a boundary states which way is tighter and most declare none.
// Moving a limit is a real climb when it moves inward, and this reader cannot tell you that it did.
// So `adjusted` is kept for moved numbers alone: dropped checks, a fall down the tier order and a
// change in any structural count are each named as their own move, and whether a new input, rule or
// limit is a new demand is read from the task rows beside it.
// `escalated` reads the highest tier a battery's checks reach, so adding two more checks at a tier
// it already occupies is `widened`. That top tier is the one reading immune to the count: a
// rank-weighted total rises whenever a battery simply holds more checks, and the mean that replaced
// it falls when a check is added below it and rises when one is removed, so a wider
// battery read `eased` and a shorter one `escalated`. The cost of reading the top alone is a battery
// that moved ten checks from easy to hard under an existing frontier check: that escalation is real
// and this reader calls it `widened`.
// An edge whose later battery verified no case is `unobservable` on the outcome side and still
// readable on both task-side rows, which is the point.
//
// Both task-side rows read `brief.json` and `tasks.json` alone, so a rule the Builder published in
// another correctness-model file moves neither. A third row names which of those files changed
// digest, without scoring them: a digest cannot tell a new requirement from a reformatted comment,
// and the verdict deliberately does not read it.
import { existsSync, readdirSync } from "#src/meta/filesystem.ts";
import { sha256OfFile } from "#src/meta/digest.ts";
import { classifyCaseOutcome, readCaseRecord } from "#src/claim/case-record.ts";
import { type BandPlacement, type BandZone, type MeasuredDifficulty } from "#src/claim/battery-difficulty.ts";
import { basename, join } from "#src/meta/path.ts";
import { BRIEF_FILE, TASKS_FILE } from "#src/meta/bundle-layout.ts";
import { climbThresholds, decidingSample, type ClimbBattery } from "#src/run/climb-history.ts";
import { decideDifficulty, fullPass } from "#src/run/climb-readout.ts";
import { BATTERY_FILE, readRecordedBatteryRecord } from "#src/correctness-bundle/battery-record.ts";
import type { BatteryRecord } from "#src/correctness-bundle/battery-record.ts";
import { SOLVE_WALL_MESSAGE } from "#src/backends/backend-types.ts";
import {
  type Bundle,
  type Structure,
  MODEL_IDENTITY,
  STRUCTURE_KEYS,
  TIER_ORDER,
  appliesTo,
  leafPaths,
  loadBundle,
  readVersionDir,
  renderBattery,
} from "../classifier/query-complexity.ts";
import { isNumber } from "#src/meta/json-shape.ts";
import { median } from "#src/meta/tally.ts";
import { compareCodeUnits, stableJson } from "#src/meta/stable-json.ts";
import { batteryTallies } from "./digest-ledgers.ts";
import { readJsonAs, readJsonAsOrNull } from "./run-overview.ts";
import type { CaseDisposition, EpochReviewEvidence } from "#src/review/epoch-review-findings.ts";
import { settledAgainstCheck } from "#src/review/epoch-review-findings.ts";
import { offAimStreak } from "#tools/runs/pulse.ts";
import { readDifficultyDecisions } from "#tools/runs/evidence.ts";

/** v2 replaced the endpoint slope (`velocity`) with the line (`line`). */
export const VELOCITY_SCHEMA = "climb-velocity/v2";
/** AGENTS.md "Goals and the climb": a run's climb is read over 8 or 12 rounds. */
export const HORIZONS = [8, 12] as const;
/** Cosine at or above this between a family's prose and its nearest predecessor reads as the same
 *  problem restated. bge-small puts genuinely reworded-but-equivalent prose well above this. */
export const RESTATED_COSINE = 0.98;

/** The two files the task-side rows already read, and so the two this digest row leaves alone. */
export const SCORED_BUNDLE_FILES: ReadonlySet<string> = new Set([basename(BRIEF_FILE), basename(TASKS_FILE)]);

/** Passed, verified, unaccepted and non-result counts of one battery. */
export interface OutcomeCounts {
  passed: number;
  verified: number;
  unaccepted: number;
  nonResult: number;
}

/** How a battery's completed epoch review settled its contested cases. A fail whose check stands is
 *  earned; a fail settled against its check measured the check, not the solver; a verifier pass
 *  settled against its check (a veto) was never earned. Both leave the earned sample, and a veto is
 *  not turned into a fail: a flip is the one move that lowers passes, so it could make a limit out
 *  of model readings alone, which the controller's placement refuses too. */
export interface Settlement {
  failsHeld: number;
  failsAgainst: number;
  passesAgainst: number;
  /** The checks the settlements name, each once, in record order. */
  checks: string[];
}

/** The computed placement of one battery, with its point rate and the sample it was drawn from. */
export type ClimbPlacement = BandPlacement & {
  rate: number;
  population: ReturnType<typeof decidingSample>["population"];
};

/** One adopted version directory, in measurement order. */
export interface VersionBattery {
  runId: string;
  dir: string;
  createdAt: string | null | undefined;
  claimed: boolean;
}

/** One battery's task rows, as the readers that compare two batteries receive them. */
type BatteryRows = Pick<BatteryReading, "rows">["rows"];

/** The part of a battery reading (`query-complexity.ts`) the edge readers compare. */
export interface BatteryReading {
  familyVectors: Readonly<Record<string, readonly (readonly number[])[]>>;
  medians: Readonly<Record<string, number>>;
  rows: readonly { taskId: string; numerics: Readonly<Record<string, number>> }[];
  checkTiers: Readonly<Record<string, number>>;
}

export interface SourceMoves {
  changed: string[];
  added: string[];
  removed: string[];
  unchanged: number;
  read: number;
}

export interface Novelty {
  mean: number;
  units: number;
}

/** What a numeric reading was measured over: the public inputs of the tasks the two batteries pair
 *  (`partnersOf`), or, when they pair none, every numeric path both batteries declare, each battery
 *  read at its own median over the tasks that carry the path. `none` is neither, and a zero there is
 *  nothing read rather than nothing moved. */
export type DriftBasis = "tasks" | "battery" | "none";

export interface NumericDrift {
  median: number;
  moved: number;
  /** The later tasks with a partner in the earlier battery (`partnersOf`), and how many of those
   *  were paired by family and input structure because their id was new. */
  joined: number;
  renamed: number;
  tasks: number;
  basis: DriftBasis;
  /** The numeric paths compared and the paths the later battery declares, on the two bases that
   *  read paths; null on the task basis, where no path aggregate was read. */
  paths: { compared: number; declared: number } | null;
}

/** How far each structural count moved between two batteries: the median over each battery's tasks,
 *  and the total over them. A battery that adds tasks shaped like the ones it held leaves every
 *  median where it was, so read on medians alone a battery grown from seven tasks to twenty-five read
 *  `replaced`, because fewer than half its tasks had a partner. The totals name it widened. */
interface StructureMoves {
  medians: Readonly<Record<string, number>>;
  totals: Readonly<Record<string, number>>;
}

/** The later battery's tasks that carry the same id, public input and family checks as the one
 *  before it, of `tasks` in all, and whether that earlier battery was a full pass (`fullPass`). */
interface Carried {
  unchanged: number;
  tasks: number;
  afterFullPass: boolean;
}

export type EdgeVerdict =
  | "escalated"
  | "eased"
  | "widened"
  | "narrowed"
  | "replaced"
  | "restated"
  | "adjusted";

/** The controller's recorded placement of one battery. `decidedBy` is the round whose decision
 *  carried it, which is never the battery's own run id. */
export interface RecordedPlacement {
  zone: string | null;
  decidedBy: string;
  toAim?: number | null;
}

/** Every battery's recorded placement by run, and the decisions the reader refused. */
interface RecordedPlacements {
  byRun: Map<string, RecordedPlacement>;
  refused: string[];
}

/** One claimed battery on the line, on the counts it is read on. */
interface LinePoint {
  runId: string;
  passes: number;
  n: number;
  zone: BandZone;
}

/** The climb as the line its claimed batteries draw, in measurement order. */
interface ClimbLine {
  points: LinePoint[];
  /** The points between 1/n and n-1/n: the batteries that can locate a limit. */
  signal: LinePoint[];
  onAim: number;
  fullPasses: number;
  empty: number;
  /** Mean absolute change in pass rate between consecutive points, in points of 100; null under two. */
  swing: number | null;
  /** The signal among the first `rounds` points, for each horizon the line has reached. */
  horizons: { rounds: number; signal: number }[];
  /** The stall rule `runs pulse` names, over the same points. */
  streak: ReturnType<typeof offAimStreak>;
}

export type ClimbReport = Awaited<ReturnType<typeof readCampaign>>;

type ClimbBatteryRow = ClimbReport["batteries"][number];

/** What the line reads of a battery, adopted or not. */
type LineBattery = Pick<
  ClimbBatteryRow,
  "runId" | "createdAt" | "claimed" | "settlement" | "placement" | "earned"
>;

const OUTCOME_WORDS: Readonly<Record<ReturnType<typeof classifyCaseOutcome>, string>> = {
  pass: "passed",
  fail: "failed",
  unaccepted: "went unaccepted",
  "non-result": "ended in a non-result",
};

/** The controller's own placement of one battery, made by `decideDifficulty` so that this reader
 *  and the decision it sets out to explain cannot disagree. The battery's difficulty denominator
 *  keeps an unaccepted attempt as a fail, and one that verified nothing is placed nowhere; reading
 *  passed over verified instead places 5 passes beside 20 refused submits at a rate of 1. */
export function placementOf(
  { passed, verified, unaccepted }: Pick<OutcomeCounts, "passed" | "verified" | "unaccepted">,
  measured: MeasuredDifficulty = { items: [] },
  band: [number, number] = climbThresholds().band,
): ClimbPlacement | null {
  // SAFETY: `decideDifficulty` reads runId and batterySha256 only into the evidence it returns.
  const battery = { measured, passed, unaccepted, n: verified + unaccepted } as ClimbBattery;
  const { placement } = decideDifficulty([battery], band);
  return placement === null
    ? null
    : { ...placement, rate: placement.passes / placement.n, population: decidingSample(battery).population };
}

/** The recorded measured difficulty of the run a version directory holds, or the empty one when
 *  the version recorded no battery of its own. */
function measuredOf(battery: VersionBattery): MeasuredDifficulty {
  const runDir = join(battery.dir, "runs", battery.runId);
  return existsSync(join(runDir, BATTERY_FILE))
    ? readRecordedBatteryRecord(runDir, battery.runId).measured
    : { items: [] };
}

/** Passed, verified, unaccepted and non-result counts per runId, from the campaign's own case rows
 *  through the controller's strict reader and the digest's per-battery tally (`batteryTallies`). An
 *  unaccepted attempt is recorded with `pass: false`, so reading `pass` alone counts every case the
 *  solver never submitted as a verified failure and then places a battery that verified nothing. */
export function outcomesOf(campaign: string): Map<string, OutcomeCounts> {
  const rows = readCaseRecord(`${campaign}/case-record.jsonl`).map(({ row }) => row);
  return new Map(
    batteryTallies(rows).map(({ runId, passed, verified, unaccepted, nonResults }) => [
      runId,
      { passed, verified, unaccepted, nonResult: nonResults },
    ]),
  );
}

/** The completed review of battery `runId`, or null when none is recorded. */
function reviewOf(campaign: string, runId: string): CaseDisposition[] | null {
  const review = readJsonAsOrNull<Pick<EpochReviewEvidence, "status"> & { dispositions?: CaseDisposition[] }>(
    join(campaign, "analysis", `${runId}-epoch-review.json`),
  );
  return review?.status === "completed" ? (review.dispositions ?? []) : null;
}

/** Null when no completed review of this battery is recorded, which is unread, never "nothing settled".
 *  Against the check means by the controller's rule (`settledAgainstCheck`): a case its climb drops. */
export function settlementOf(campaign: string, runId: string): Settlement | null {
  const rows = reviewOf(campaign, runId);
  if (rows === null) return null;
  const settled = settledAgainstCheck(join(campaign, "analysis"), runId);
  const count = (veto: boolean, counted: (row: CaseDisposition) => boolean) =>
    rows.filter((row) => (row.kind === "veto") === veto && counted(row)).length;
  return {
    failsHeld: count(false, (row) => row.disposition === "check-stands"),
    failsAgainst: count(false, (row) => settled.has(row.taskId)),
    passesAgainst: count(true, (row) => settled.has(row.taskId)),
    checks: [...new Set(rows.map((row) => row.checkId))],
  };
}

/** Batteries in the order they were measured. A claim's `createdAt` owns chronology; a version with
 *  no claim keeps its directory's recorded time and is marked, because an unclaimed battery is
 *  exactly the case this reader exists for. The version a forked campaign was seeded from (its
 *  `seed.json` `selectedProductId`) comes first whatever its time: every battery the fork measured
 *  derives from it, and an undated seed sorted last read each fork edge backwards (2026-10-01). */
export function batteriesOf(campaign: string): VersionBattery[] {
  const seedPath = `${campaign}/seed.json`;
  const seed = existsSync(seedPath)
    ? readJsonAs<{ selectedProductId?: string | null }>(seedPath).selectedProductId
    : null;
  const versions = readdirSync(`${campaign}/versions`, { withFileTypes: true });
  const rows: VersionBattery[] = [];
  for (const entry of versions) {
    if (!entry.isDirectory()) continue;
    const dir = `${campaign}/versions/${entry.name}`;
    if (!existsSync(`${dir}/correctness-model/tasks.json`)) continue;
    const claimPath = `${campaign}/claims/${entry.name}.json`;
    const claimed = existsSync(claimPath);
    const createdAt = claimed
      ? readJsonAs<{ createdAt?: string | null }>(claimPath).createdAt
      : existsSync(`${dir}/version.json`)
        ? readJsonAs<{ createdAt?: string | null }>(`${dir}/version.json`).createdAt
        : null;
    rows.push({ runId: entry.name, dir, createdAt, claimed });
  }
  rows.sort(
    (a, b) =>
      Number(b.runId === seed) - Number(a.runId === seed) ||
      String(a.createdAt).localeCompare(String(b.createdAt)) ||
      a.runId.localeCompare(b.runId),
  );
  return rows;
}

/** Every other correctness-model file, with its digest. `noveltyOf` scores the check assertions in
 *  `brief.json`; the structural deltas count what `tasks.json` declares. A requirement published
 *  anywhere else is invisible to both: a Builder that adds a clearance rule and its helper to
 *  `rules.ts` under an existing check, leaving `evaluator.ts` byte-identical, produces an edge
 *  reading `novelty 0.0000 ... rules +0`, which says the battery was renumbered. */
export function correctnessDigests(dir: string): Map<string, string> {
  const digests = new Map<string, string>();
  const walk = (at: string, prefix: string): void => {
    if (!existsSync(at)) return;
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const name = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(`${at}/${entry.name}`, name);
      else if (!SCORED_BUNDLE_FILES.has(name)) digests.set(name, sha256OfFile(`${at}/${entry.name}`));
    }
  };
  walk(`${dir}/correctness-model`, "");
  return digests;
}

/** Which of those files moved between two batteries. Names only; this row does not score what the
 *  change means, because a digest cannot separate a new requirement from a reformatted comment. */
export function sourceMovesOf(beforeDir: string, afterDir: string): SourceMoves | null {
  const earlier = correctnessDigests(beforeDir);
  const later = correctnessDigests(afterDir);
  if (earlier.size === 0 && later.size === 0) return null;
  const changed: string[] = [];
  const added: string[] = [];
  let unchanged = 0;
  for (const [name, digest] of [...later].sort(([a], [b]) => a.localeCompare(b))) {
    if (!earlier.has(name)) added.push(name);
    else if (earlier.get(name) === digest) {
      unchanged += 1;
    } else {
      changed.push(name);
    }
  }
  const removed = [...earlier.keys()].filter((name) => !later.has(name)).sort(compareCodeUnits);
  return { changed, added, removed, unchanged, read: later.size };
}

/** Each check assertion in the later battery against its nearest predecessor: 1 means nothing like
 *  it came before, 0 means the same sentence. Reported as the mean over the later battery's units,
 *  so one new check among ten unchanged ones does not read as a whole new battery. It reads
 *  `brief.json` alone; `sourceMovesOf` owns the rest of the correctness model. */
function noveltyOf(before: BatteryReading, after: BatteryReading): Novelty | null {
  const earlier = Object.values(before.familyVectors).flat();
  const later = Object.values(after.familyVectors).flat();
  if (earlier.length === 0 || later.length === 0) return null;
  let total = 0;
  for (const vector of later) {
    total += Math.max(
      0,
      1 -
        Math.max(
          ...earlier.map((other) =>
            vector.reduce((sum, value, index) => sum + value * (other[index] ?? Number.NaN), 0),
          ),
        ),
    );
  }
  return { mean: total / later.length, units: later.length };
}

/** Every number one battery publishes, keyed by task and path, which is the key two batteries share
 *  exactly where paired tasks carry the same public input path. `idOf` names each row's task in the
 *  earlier battery's ids, and a row it names nothing for is left out. */
function numbersByTask(rows: BatteryRows, idOf: (taskId: string) => string | undefined): Map<string, number> {
  const found = new Map<string, number>();
  for (const row of rows) {
    const id = idOf(row.taskId);
    if (id === undefined) continue;
    for (const [path, value] of Object.entries(row.numerics)) found.set(`${id}\u0000${path}`, value);
  }
  return found;
}

/**
 * Each later task's partner in the earlier battery: the task of the same id, or else an earlier task
 * no later id claimed, of the same family and with the same public-input leaf paths, taken in the
 * order each battery lists them. A Builder that renames its tasks keeps both, and on the id join alone
 * such a battery read `replaced` while every task was the one before it with its numbers moved.
 */
function partnersOf(before: Bundle, after: Bundle): Map<string, string> {
  const inputKeyOf = (task: Bundle["tasks"][number]) =>
    stableJson([task.family, leafPaths(task.publicInput ?? {}).toSorted(compareCodeUnits)]);
  const laterIds = new Set(after.tasks.map((task) => task.taskId));
  const earlierIds = new Set(before.tasks.map((task) => task.taskId));
  const open = Map.groupBy(
    before.tasks.filter((task) => !laterIds.has(task.taskId)),
    inputKeyOf,
  );
  const partners = new Map<string, string>();
  for (const task of after.tasks) {
    const partner = earlierIds.has(task.taskId) ? task.taskId : open.get(inputKeyOf(task))?.shift()?.taskId;
    if (partner !== undefined) partners.set(task.taskId, partner);
  }
  return partners;
}

/** Each numeric path the battery declares, at its median over whichever of its tasks carry it: the
 *  battery read as one artifact, for the edge whose tasks share no id with the one before it. The
 *  median the structural row beside it uses, and a median rather than a sum, so a replacement that
 *  doubled the tasks is not read as a doubled number. */
function numbersByPath(rows: BatteryRows): Map<string, number> {
  const values = new Map<string, number[]>();
  for (const row of rows) {
    for (const [path, value] of Object.entries(row.numerics)) {
      values.set(path, [...(values.get(path) ?? []), value]);
    }
  }
  return new Map([...values].map(([path, found]) => [path, median(found) ?? 0]));
}

/** How far each number moved, relative to what it was, over the keys both sides hold. A key only one
 *  side holds is not a move, and neither is a value that did not change or one that was zero. The
 *  median move is the upper middle of the moves, as this row has always reported it. */
function movesBetween(was: ReadonlyMap<string, number>, now: ReadonlyMap<string, number>) {
  const moves: number[] = [];
  let compared = 0;
  for (const [key, value] of now) {
    const previous = was.get(key);
    if (!isNumber(previous)) continue;
    compared += 1;
    if (previous === 0 || value === previous) continue;
    moves.push(Math.abs(value - previous) / Math.abs(previous));
  }
  moves.sort((a, b) => a - b);
  return { median: moves[Math.floor(moves.length / 2)] ?? 0, moved: moves.length, compared };
}

/** How far the published numbers moved between two batteries. Direction is deliberately absent: a
 *  boundary states which way is tighter and most do not declare one, so this answers "did the numbers
 *  move" and the check-tier histogram answers whether anything new has to be reasoned about.
 *
 *  `joined` counts the later tasks with a partner in the earlier battery, of `tasks` in all, and the
 *  reading is over those pairs' own public inputs while any task pairs. The partners are the shared
 *  ids unless `partners` (`partnersOf`) names more. A battery that replaced every task with new
 *  families or new inputs pairs nothing, and that is exactly what a Builder told its battery was too
 *  easy writes: read on the join alone it was a battery whose numbers stood still, which is the one
 *  thing it was not. So with nothing paired the two batteries are compared whole, path by path, and
 *  `basis` says which comparison the numbers came from. `none` is two batteries that share no numeric
 *  path at all, where nothing was read and the zero means only that. */
export function numericDriftOf(
  before: Pick<BatteryReading, "rows">,
  after: Pick<BatteryReading, "rows">,
  partners?: ReadonlyMap<string, string>,
): NumericDrift {
  const tasks = after.rows.length;
  const ids = new Set(before.rows.map((row) => row.taskId));
  const pairs =
    partners ?? new Map(after.rows.flatMap((row) => (ids.has(row.taskId) ? [[row.taskId, row.taskId]] : [])));
  const partnerOf = (taskId: string): string | undefined => pairs.get(taskId);
  const joined = after.rows.filter((row) => partnerOf(row.taskId) !== undefined).length;
  const renamed = after.rows.filter((row) => (partnerOf(row.taskId) ?? row.taskId) !== row.taskId).length;
  if (joined > 0) {
    const reading = movesBetween(
      numbersByTask(before.rows, (taskId) => taskId),
      numbersByTask(after.rows, partnerOf),
    );
    return {
      median: reading.median,
      moved: reading.moved,
      joined,
      renamed,
      tasks,
      basis: "tasks",
      paths: null,
    };
  }
  const declared = numbersByPath(after.rows);
  const whole = movesBetween(numbersByPath(before.rows), declared);
  return {
    median: whole.median,
    moved: whole.moved,
    joined,
    renamed,
    tasks,
    basis: whole.compared === 0 ? "none" : "battery",
    paths: { compared: whole.compared, declared: declared.size },
  };
}

/** The checks that apply to one family, as the bytes a solver of its task reads them in. */
function familyChecks(brief: Bundle["brief"], family: string): string {
  return stableJson((brief.truthChecks ?? []).filter((check) => appliesTo(check, family)));
}

/** How many of the later battery's tasks the solver meets exactly as before: the same id, public
 *  input and family checks. After a full pass such a task measures a known pass again (AGENTS.md
 *  "Goals and the climb", carried). A verdict cannot show it, and neither can the numeric drift,
 *  which reads zero for a carried task and for a task whose one new input carries no number. The
 *  correctness-model source can still ask more of an unchanged task, and the digest row beside this
 *  one names the file when it moved. */
function carriedOf(before: Bundle, after: Bundle): Omit<Carried, "afterFullPass"> {
  const earlier = new Map(before.tasks.map((task) => [task.taskId, task]));
  const unchanged = after.tasks.filter((task) => {
    const was = earlier.get(task.taskId);
    return (
      was !== undefined &&
      stableJson(was) === stableJson(task) &&
      familyChecks(before.brief, task.family) === familyChecks(after.brief, task.family)
    );
  }).length;
  return { unchanged, tasks: after.tasks.length };
}

/** Whether the later battery poses the earlier one's task `taskId` exactly as before (`carriedOf`). */
function taskMove(before: Bundle, after: Bundle, taskId: string): "carried" | "changed" | "dropped" {
  const tasks = after.tasks.filter((task) => task.taskId === taskId);
  if (tasks.length === 0) return "dropped";
  return carriedOf(before, { ...after, tasks }).unchanged === tasks.length ? "carried" : "changed";
}

/** The condition a battery's solves ran under: the Built pin, the run condition, the agent bytes and
 *  the tool tree the solver's shell runs first. */
const solverOf = ({ backendPin, condition, bundleSnapshot }: BatteryRecord) =>
  stableJson({
    backendPin,
    condition,
    agent: bundleSnapshot.agentHash,
    tools: bundleSnapshot.toolTreeDigest,
  });

/** What `next`, the battery measured after `battery`, did with each of `battery`'s earned fails, or
 *  null when `battery` recorded no battery of its own. An earned fail is a verified fail that the
 *  review did not settle against its check and the solve wall did not stop; a climb step needs that
 *  task passing after a harness change (AGENTS.md "Its shape, and how progress is read"). Null
 *  fields are unread: no next battery, or none recorded; `outcome` is also null when the next
 *  battery holds no case of the task, as when it dropped it. A regrade keeps the recorded solve's
 *  instants, so a case starting when the earlier one did is not new.
 *  `elsewhere` counts the task's other verified solves in any battery under the same solver
 *  (`solverOf`) that poses it exactly as this one did: a fail of a task that passed there is the
 *  solver's variance, not a limit. In trusses-26, 13 tasks were solved 59 times that way and both
 *  of its fails passed in the battery beside them (oracle review, 2026-10-02). */
export function followUpOf(
  campaign: string,
  battery: Pick<VersionBattery, "dir" | "runId">,
  next: Pick<VersionBattery, "dir" | "runId"> | undefined,
) {
  const recorded = ({ dir, runId }: Pick<VersionBattery, "dir" | "runId">) =>
    existsSync(join(dir, "runs", runId, BATTERY_FILE))
      ? readRecordedBatteryRecord(join(dir, "runs", runId), runId)
      : null;
  const record = recorded(battery);
  if (record === null) return null;
  // A settlement recorded before dispositions named their checks stays in the controller's sample,
  // since it cannot tell whether another check decided the case, and for that reason is no earned
  // fail either (esp32-30 i02 and esp32-31 b1: six such fails).
  const unscoped = (reviewOf(campaign, battery.runId) ?? []).filter(
    (row) => row.disposition === "against-check" && row.checkIds === undefined,
  );
  const settled = new Set([
    ...settledAgainstCheck(join(campaign, "analysis"), battery.runId),
    ...unscoped.map((row) => row.taskId),
  ]);
  const earned = record.cases.filter(
    (row) =>
      classifyCaseOutcome(row) === "fail" &&
      !settled.has(row.taskId) &&
      !row.solver.errors.includes(SOLVE_WALL_MESSAGE),
  );
  const later = next === undefined ? null : recorded(next);
  // Bundles are loaded only for a battery that holds an earned fail, which few do.
  const before = earned.length === 0 ? null : loadBundle(battery.dir);
  const bundles = next === undefined || before === null ? null : { before, after: loadBundle(next.dir) };
  const peers =
    before === null
      ? []
      : batteriesOf(campaign).flatMap((other) => {
          const solved = other.runId === battery.runId ? null : recorded(other);
          if (solved === null || solverOf(solved) !== solverOf(record)) return [];
          const bundle = loadBundle(other.dir);
          return [{ solved, poses: (taskId: string) => taskMove(before, bundle, taskId) === "carried" }];
        });
  return {
    next: next?.runId ?? null,
    agentChanged: later === null ? null : later.bundleSnapshot.agentHash !== record.bundleSnapshot.agentHash,
    fails: earned.map(({ taskId, solver }) => {
      const row = later?.cases.find((each) => each.taskId === taskId);
      // Keyed by the solve's instants, so a regrade counts its solve once.
      const others = new Map(
        peers
          .filter(({ poses }) => poses(taskId))
          .flatMap(({ solved }) => solved.cases)
          .filter((each) => each.taskId === taskId && each.solver.startedAt !== solver.startedAt)
          .map((each) => [each.solver.startedAt, classifyCaseOutcome(each)] as const),
      );
      const outcomes = [...others.values()];
      return {
        taskId,
        task: bundles === null ? null : taskMove(bundles.before, bundles.after, taskId),
        outcome: row === undefined ? null : classifyCaseOutcome(row),
        regraded: row?.solver.startedAt === solver.startedAt,
        elsewhere: {
          passed: outcomes.filter((each) => each === "pass").length,
          failed: outcomes.filter((each) => each === "fail").length,
        },
      };
    }),
  };
}

/** The rank of the highest tier a battery's checks reach. Adding or dropping checks at tiers it
 *  already occupies leaves it where it was, which is the whole point: the count is read by the
 *  structural deltas, and the tier order by this. Null when a battery declares no check. */
export function topTierOf(checkTiers: Readonly<Record<string, number>>): number | null {
  let top: number | null = null;
  TIER_ORDER.forEach((name, rank) => {
    if ((checkTiers[name] ?? 0) > 0) top = rank;
  });
  return top;
}

/** The counts that name a widening or narrowing even across replaced tasks. The other structural
 *  counts are medians over whichever tasks a battery holds, so they name a direction only once
 *  most tasks carried over; before that the edge is `replaced` and read by hand. */
const LEADING_KEYS = ["checks", "coupled", "scenarios"] as const;

/** Each structural count summed over a battery's tasks. */
function structureTotals(rows: readonly { structure: Structure }[]): Record<string, number> {
  return Object.fromEntries(
    STRUCTURE_KEYS.map((key) => [key, rows.reduce((sum, row) => sum + row.structure[key], 0)]),
  );
}

/** Which of the six ways the battery moved, named from the tier order first and the structural
 *  counts second: every median a battery's pairing lets name a direction, then the totals, the
 *  leading counts before the rest. Exported so the directions can be read off literal readings. */
export function verdictOf(
  before: Pick<BatteryReading, "checkTiers">,
  after: Pick<BatteryReading, "checkTiers">,
  novelty: Novelty | null,
  moves: StructureMoves,
  drift: NumericDrift,
): EdgeVerdict {
  const was = topTierOf(before.checkTiers);
  const now = topTierOf(after.checkTiers);
  if (was !== null && now !== null && now !== was) return now > was ? "escalated" : "eased";
  const directionOf = (keys: readonly string[], delta: Readonly<Record<string, number>>) =>
    keys.some((key) => (delta[key] ?? 0) > 0)
      ? "widened"
      : keys.some((key) => (delta[key] ?? 0) < 0)
        ? "narrowed"
        : null;
  const led = directionOf(LEADING_KEYS, moves.medians);
  if (led !== null) return led;
  const replaced = drift.joined * 2 < drift.tasks;
  const keys = replaced ? LEADING_KEYS : STRUCTURE_KEYS;
  const moved =
    directionOf(keys, moves.medians) ??
    directionOf(LEADING_KEYS, moves.totals) ??
    directionOf(keys, moves.totals);
  if (moved !== null) return moved;
  if (replaced) return "replaced";
  const restatedProse = novelty === null || novelty.mean <= 1 - RESTATED_COSINE;
  const carried = drift.moved === 0 && drift.joined === drift.tasks;
  const still = [moves.medians, moves.totals].every((delta) =>
    STRUCTURE_KEYS.every((key) => delta[key] === 0),
  );
  return restatedProse && carried && still ? "restated" : "adjusted";
}

/** The controller's own placement of each battery: the zone from the last difficulty decision that
 *  carried its readout row, and the distance to the aim from the decision that read it. A decision
 *  is named for the round it opened and places the battery its evidence ends on, so its placement
 *  goes to that battery and never to `decision.runId`. */
function recordedPlacements(campaign: string): RecordedPlacements {
  const decisions = readDifficultyDecisions({ campaignDir: campaign, runId: null });
  const byRun = new Map<string, RecordedPlacement>();
  for (const decision of decisions.rows) {
    for (const row of decision.rows) {
      byRun.set(row.runId, { ...byRun.get(row.runId), zone: row.zone, decidedBy: decision.runId });
    }
    const read = decision.evidenceRunIds.at(-1);
    if (decision.placement !== null && read !== undefined) {
      const { zone, toAim } = decision.placement;
      byRun.set(read, { zone, decidedBy: decision.runId, toAim });
    }
  }
  return { byRun, refused: decisions.refused.map(({ file, reason }) => `${file}: ${reason}`) };
}

/** Whether a completed review settled any case against its check, so the battery is read earned. */
function settledAgainst(settlement: Settlement | null): settlement is Settlement {
  return settlement !== null && settlement.failsAgainst + settlement.passesAgainst > 0;
}

/** The placement over the whole battery once the cases settled against their check leave it, or
 *  null when none was. A changed subset records no per-case membership to settle against. */
function earnedOf(counts: OutcomeCounts, settlement: Settlement | null): ClimbPlacement | null {
  return settledAgainst(settlement)
    ? placementOf({
        ...counts,
        passed: counts.passed - settlement.passesAgainst,
        verified: counts.verified - settlement.failsAgainst - settlement.passesAgainst,
      })
    : null;
}

/** Claimed batteries with no version directory of their own: a round that measured again without
 *  adopting anything. They have no task bytes to read an edge from, and they are still points on
 *  the line. */
function unadoptedOf(campaign: string, outcomes: Map<string, OutcomeCounts>, adopted: ReadonlySet<string>) {
  const rows = [...outcomes].flatMap(([runId, counts]) => {
    const claimPath = join(campaign, "claims", `${runId}.json`);
    if (adopted.has(runId) || !existsSync(claimPath)) return [];
    const settlement = settlementOf(campaign, runId);
    return [
      {
        runId,
        createdAt: readJsonAs<{ createdAt?: string | null }>(claimPath).createdAt,
        claimed: true,
        counts,
        settlement,
        placement: placementOf(counts),
        earned: earnedOf(counts, settlement),
      },
    ];
  });
  return rows.sort(
    (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.runId.localeCompare(b.runId),
  );
}

/** The outcome side of every battery: its counts, its settlement and both placements. It opens no
 *  task bytes and loads no model, so a reader of the line alone (the Super Loop's scoreboard) pays
 *  for a directory walk; `readCampaign` adds the task side to these rows. */
export function outcomeRowsOf(campaign: string) {
  const outcomes = outcomesOf(campaign);
  const recorded = recordedPlacements(campaign);
  const batteries = batteriesOf(campaign).map((battery) => {
    const counts = outcomes.get(battery.runId) ?? { passed: 0, verified: 0, unaccepted: 0, nonResult: 0 };
    const settlement = settlementOf(campaign, battery.runId);
    return {
      ...battery,
      counts,
      settlement,
      placement: placementOf(counts, measuredOf(battery)),
      earned: earnedOf(counts, settlement),
      recorded: recorded.byRun.get(battery.runId) ?? null,
    };
  });
  return {
    batteries,
    unadopted: unadoptedOf(campaign, outcomes, new Set(batteries.map((battery) => battery.runId))),
    refusedDecisions: recorded.refused,
  };
}

export async function readCampaign(campaign: string, options: Parameters<typeof readVersionDir>[1] = {}) {
  const rows = outcomeRowsOf(campaign);
  const batteries = [];
  for (const [at, { runId, dir, createdAt, claimed, ...outcome }] of rows.batteries.entries()) {
    const reading = await readVersionDir(dir, options);
    const followUp = followUpOf(campaign, { dir, runId }, rows.batteries[at + 1]);
    batteries.push({ runId, dir, createdAt, claimed, reading, ...outcome, followUp });
  }
  const edges = [];
  for (const [at, after] of batteries.entries()) {
    const before = batteries[at - 1];
    if (before === undefined) continue;
    const delta: Record<string, number> = {};
    const totals: Record<string, number> = {};
    const [wasTotals, nowTotals] = [
      structureTotals(before.reading.rows),
      structureTotals(after.reading.rows),
    ];
    for (const key of STRUCTURE_KEYS) {
      delta[key] = (after.reading.medians[key] ?? Number.NaN) - (before.reading.medians[key] ?? Number.NaN);
      totals[key] = (nowTotals[key] ?? Number.NaN) - (wasTotals[key] ?? Number.NaN);
    }
    const bundles = { before: loadBundle(before.dir), after: loadBundle(after.dir) };
    const novelty = noveltyOf(before.reading, after.reading);
    const drift = numericDriftOf(before.reading, after.reading, partnersOf(bundles.before, bundles.after));
    edges.push({
      from: before.runId,
      to: after.runId,
      verdict: verdictOf(before.reading, after.reading, novelty, { medians: delta, totals }, drift),
      novelty,
      drift,
      delta,
      totals,
      source: sourceMovesOf(before.dir, after.dir),
      carried: { ...carriedOf(bundles.before, bundles.after), afterFullPass: fullPass(before.counts) },
      outcome:
        after.counts.verified === 0
          ? ("unobservable" as const)
          : { passed: after.counts.passed, verified: after.counts.verified, placement: after.placement },
    });
  }
  return {
    schema: VELOCITY_SCHEMA,
    campaign,
    model: MODEL_IDENTITY,
    batteries,
    unadopted: rows.unadopted,
    edges,
    refusedDecisions: rows.refusedDecisions,
  };
}

/**
 * The line the claimed batteries draw, adopted or not, in claim order, read as AGENTS.md "Goals and
 * the climb" defines it. A battery still measuring has not landed on it. Each point is read on the
 * counts the controller places, earned where a completed review settled a case against its check.
 * Signal counts the points strictly between 0 and n passes whatever their zone, and swing is the
 * mean absolute move in pass rate between consecutive points, so neither rewards a line for falling.
 */
export function lineOf(report: {
  readonly batteries: readonly LineBattery[];
  readonly unadopted?: readonly LineBattery[];
}): ClimbLine {
  const points = [...report.batteries, ...(report.unadopted ?? [])]
    .filter((battery) => battery.claimed)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.runId.localeCompare(b.runId))
    .flatMap(({ runId, settlement, placement, earned }) => {
      const read = settledAgainst(settlement) ? earned : placement;
      return read === null ? [] : [{ runId, passes: read.passes, n: read.n, zone: read.zone }];
    });
  const signal = points.filter(({ passes, n }) => passes > 0 && passes < n);
  const rate = ({ passes, n }: LinePoint) => passes / n;
  const moves = points.slice(1).map((point, at) => Math.abs(rate(point) - rate(points[at] ?? point)));
  return {
    points,
    signal,
    onAim: points.filter(({ zone }) => zone === "on-aim").length,
    fullPasses: points.filter(({ passes, n }) => passes === n).length,
    empty: points.filter(({ passes }) => passes === 0).length,
    swing: moves.length === 0 ? null : (100 * moves.reduce((sum, move) => sum + move, 0)) / moves.length,
    horizons: HORIZONS.flatMap((rounds) =>
      points.length < rounds
        ? []
        : [{ rounds, signal: signal.filter((point) => points.indexOf(point) < rounds).length }],
    ),
    streak: offAimStreak(points.map(({ zone, passes, n }) => ({ zone, placedOn: { passes, n } }))),
  };
}

/** The newest edge as the sentence a reader opened this for. The rows above it are the evidence;
 *  this is the reading, and it is the one the line cannot give, because the line needs measured
 *  batteries and this needs none.
 *
 *  Both task-side rows come from the authored bytes under `versions/`, so the newest edge is
 *  readable the moment a candidate is adopted and before its first solve is paid for: a round
 *  that reads `widened` or `adjusted` here and then spends hours of solves to confirm a perfect
 *  battery had that verdict in the adopted bytes before the first solve started. The verdict reads
 *  the check tiers alone, so the sentence says what moved and forecasts no outcome: new tasks and
 *  scenarios can ask more at an unchanged tier, and a higher tier can ask nothing new. */
function latestEdgeLine(report: ClimbReport): string {
  const edge = report.edges.at(-1);
  if (edge === undefined) return "  latest edge: none, because an edge needs two batteries";
  const reading =
    edge.verdict === "escalated"
      ? "the checks reached a higher tier; the tier says what the checks read, not whether the tasks ask more"
      : edge.verdict === "eased"
        ? "the checks fell down the tier order; new tasks or scenarios may still ask more"
        : "the checks held their tier; new tasks or scenarios may still ask more, so read the task rows";
  return `  latest edge: ${edge.from} -> ${edge.to} ${edge.verdict} — ${reading}`;
}

/** The controller's recorded placement beside the computed one, or the fact that none was recorded. */
function recordedLine(battery: ClimbBatteryRow): string {
  const computed =
    battery.placement === null ? "no computed placement" : `computed ${battery.placement.zone}`;
  if (battery.recorded === null) return `${computed}; no recorded difficulty decision names this battery`;
  const toAim = battery.recorded.toAim === undefined ? "" : ` toAim ${battery.recorded.toAim}`;
  return `${computed}; recorded ${battery.recorded.zone ?? "?"}${toAim} (decision ${battery.recorded.decidedBy})`;
}

/** Whether the battery's fails were earned, so an over-aim or on-aim placement is read against the
 *  review that settled its contested cases rather than taken as the solver's limit. */
function settledLine({ counts, settlement, earned }: ClimbBatteryRow): string | null {
  const fails = counts.verified - counts.passed;
  if (fails === 0 && (settlement?.passesAgainst ?? 0) === 0) return null;
  if (settlement === null) return `fails ${fails}: no completed review settled any, so none is known earned`;
  const unread = fails - settlement.failsHeld - settlement.failsAgainst;
  const vetoes =
    settlement.passesAgainst === 0 ? "" : `, ${settlement.passesAgainst} passes settled against the check`;
  const checks = settlement.checks.length === 0 ? "" : `; checks ${settlement.checks.join(", ")}`;
  const line = `fails ${fails}: ${settlement.failsHeld} held by the review, ${settlement.failsAgainst} settled against the check, ${unread} unsettled${vetoes}${checks}`;
  return earned === null
    ? line
    : `${line}\n      earned ${earned.zone} at ${earned.passes}/${earned.n} over the whole battery, with the cases settled against their check counted neither way`;
}

/** A stalled streak in words, which the `flat` line and the CLIMB FLAT example both print. */
const stallWords = ({ side, rounds, flat, closest }: NonNullable<ClimbLine["streak"]>) =>
  `${side} the aim ${rounds} in a row, and the ${flat} since ${closest.passes}/${closest.n} came no closer`;

/** The line as three sentences: its signal and swing, its horizons, and whether it has gone flat. */
function lineLines(line: ClimbLine): string[] {
  const placed = line.points.length;
  if (placed === 0) return ["  velocity: no claimed battery verified a case, so there is no line yet"];
  const at = (point: LinePoint) => `${point.passes}/${point.n} #${line.points.indexOf(point) + 1}`;
  const named = line.signal.length === 0 ? "" : ` (${line.signal.map(at).join(", ")})`;
  const swing =
    line.swing === null ? "one battery, so no swing yet" : `swing ${line.swing.toFixed(1)} points a battery`;
  const horizon =
    line.horizons.length === 0
      ? `${line.signal.length} in ${placed} so far; the climb is read over ${HORIZONS.join(" or ")} rounds`
      : line.horizons.map(({ rounds, signal }) => `${signal} in the first ${rounds}`).join(", ");
  const { streak } = line;
  const flat =
    streak === null
      ? "no: the latest battery is on the aim"
      : streak.stalled
        ? `yes: ${stallWords(streak)}`
        : `no: ${streak.side} the aim ${streak.rounds} in a row, ${streak.flat} since the closest, ${streak.closest.passes}/${streak.closest.n}`;
  return [
    `  velocity: ${line.signal.length} of ${placed} claimed batteries between 1/n and n-1/n${named}; ${line.onAim} on the aim, ${line.fullPasses} full passes and ${line.empty} empty, which locate nothing; ${swing}`,
    `  horizon: between 1/n and n-1/n, ${horizon}`,
    `  flat: ${flat}`,
  ];
}

/** A line gone flat as the trigger the brief starts lanes 10 and 36 from (`LANE_FOR_TRIGGER`). */
export function flatTriggers({ streak }: ClimbLine): { name: string; rows: number; examples: string[] }[] {
  if (streak?.stalled !== true) return [];
  return [{ name: "CLIMB FLAT (lane 10)", rows: 1, examples: [stallWords(streak)] }];
}

/** How many solves the run spent measuring again what a full pass had already answered. */
function carriedLine(report: ClimbReport): string {
  const after = report.edges.filter((edge) => edge.carried.afterFullPass);
  const tasks = after.reduce((sum, edge) => sum + edge.carried.unchanged, 0);
  if (after.length === 0) return "  carried: no edge follows a full pass";
  return `  carried: ${tasks} tasks measured again unchanged over the ${after.length} edge${after.length === 1 ? "" : "s"} after a full pass; a task that passed changes or leaves`;
}

/** Each earned fail of one battery as a climb step's evidence: the task, what the next battery did
 *  with it, how it came out there and whether the agent changed between the two. */
function followUpLines({ runId, followUp }: ClimbBatteryRow): string[] {
  if (followUp === null) return [];
  const { next, agentChanged } = followUp;
  const agent = agentChanged === null ? "" : `; agent ${agentChanged ? "changed" : "unchanged"} between them`;
  return followUp.fails.map(({ taskId, task, outcome, regraded, elsewhere }) => {
    const solves = elsewhere.passed + elsewhere.failed;
    const flip = elsewhere.passed > 0 ? ": a flip, not a limit" : "";
    const head = `earned fail ${taskId} in ${runId}${solves === 0 ? "" : ` (passed ${elsewhere.passed} of ${solves} other solves under the same solver${flip})`}`;
    if (next === null || task === null) return `${head}: no battery measured after it`;
    if (task === "dropped") return `${head}: dropped from ${next}${agent}`;
    const solve = regraded ? "its earlier solve graded again" : "a new solve";
    const result = outcome === null ? "not yet measured" : `${OUTCOME_WORDS[outcome]} there on ${solve}`;
    return `${head}: ${task === "carried" ? "carried unchanged" : "changed"} into ${next}, ${result}${agent}`;
  });
}

/** The numbers row of one edge, on the basis the two batteries allowed. A whole-battery reading says
 *  so and names the paths it compared beside the id join it fell back from, so no reader takes it for
 *  a task-for-task comparison; `none` prints no number, because none was read. */
function driftLine(drift: NumericDrift): string {
  const renamed =
    drift.renamed === 0 ? "" : `, ${drift.renamed} of them renamed and joined by family and input structure`;
  const joined = `${drift.joined} of ${drift.tasks} tasks joined by id${renamed}`;
  const moved = `numbers moved ${drift.moved} by ${(drift.median * 100).toFixed(2)}% median`;
  const paths = drift.paths;
  if (paths === null) return `${moved} over ${joined}`;
  if (drift.basis === "none") {
    return `numbers unobservable: ${joined}, and none of the later battery's ${paths.declared} numeric paths is one the earlier battery declares`;
  }
  return `${moved} over ${paths.compared} of ${paths.declared} numeric paths both batteries declare, read whole because ${joined}`;
}

/** The earned fails `followUpOf` read, the flips among them (the task passed another solve under
 *  the same solver), those with no battery after them, those the next battery carried unchanged,
 *  those that passed there, and those that passed after the agent changed and are no flip: a climb
 *  step answered. A changed agent means a new solve, since a regrade needs the same agent bytes. */
export function followUpCounts(followUps: readonly ReturnType<typeof followUpOf>[]) {
  const fails = followUps.flatMap(
    (up) => up?.fails.map((fail) => ({ ...fail, agentChanged: up.agentChanged })) ?? [],
  );
  const carried = fails.filter(({ task }) => task === "carried");
  const passed = carried.filter(({ outcome }) => outcome === "pass");
  return {
    earned: fails.length,
    flips: fails.filter(({ elsewhere }) => elsewhere.passed > 0).length,
    last: fails.filter(({ task }) => task === null).length,
    carried: carried.length,
    passed: passed.length,
    answered: passed.filter(({ agentChanged, elsewhere }) => agentChanged === true && elsewhere.passed === 0)
      .length,
  };
}

function followUpLine(report: ClimbReport): string {
  const count = followUpCounts(report.batteries.map(({ followUp }) => followUp));
  if (count.earned === 0) return "  follow-up: no adopted battery recorded an earned fail";
  return `  follow-up: ${count.earned} earned fail${count.earned === 1 ? "" : "s"} (${count.flips} passed another solve under the same solver), ${count.last} with no battery after it; ${count.carried} carried unchanged into the next battery, ${count.passed} of them passed there and ${count.answered} of those after the agent changed`;
}

export function render(report: ClimbReport): string {
  const lines = [`${report.batteries.length} batteries in ${report.campaign}`];
  for (const refusal of report.refusedDecisions ?? []) {
    lines.push(`  difficulty decision refused: ${refusal}`);
  }
  for (const battery of report.batteries) {
    const outcome =
      battery.counts.verified === 0
        ? "no verified case"
        : `${battery.counts.passed}/${battery.counts.verified} passed`;
    lines.push(`  ${battery.createdAt ?? "undated"}  ${battery.runId}`);
    lines.push(
      `      ${outcome}, ${battery.counts.unaccepted} unaccepted, ${battery.counts.nonResult} non-result${battery.claimed ? "" : ", unclaimed"}`,
    );
    lines.push(`      ${recordedLine(battery)}`);
    const fails = settledLine(battery);
    if (fails !== null) lines.push(`      ${fails}`);
    lines.push(...followUpLines(battery).map((line) => `      ${line}`));
    // The whole battery reading, rendered by the module that produced it: this block carried its own
    // copy of the check and median lines and dropped the family histogram, which was the only thing
    // a second lane over the same campaign still added.
    lines.push(
      ...renderBattery(battery.reading)
        .split("\n")
        .map((line) => `      ${line}`),
    );
  }
  for (const edge of report.edges) {
    lines.push(`  ${edge.from} -> ${edge.to}: ${edge.verdict}`);
    lines.push(
      `      novelty ${edge.novelty === null ? "n/a" : edge.novelty.mean.toFixed(4)}   ${driftLine(edge.drift)}`,
    );
    for (const [label, delta] of [
      ["delta", edge.delta],
      ["total", edge.totals],
    ] as const) {
      lines.push(
        `      ${label} ${STRUCTURE_KEYS.map((key) => {
          const change = delta[key];
          return `${key} ${change !== undefined && change >= 0 ? "+" : ""}${String(change)}`;
        }).join("  ")}`,
      );
    }
    if (edge.source !== null) {
      const moved = [
        ...edge.source.changed,
        ...edge.source.added.map((name) => `${name} (new)`),
        ...edge.source.removed.map((name) => `${name} (gone)`),
      ];
      lines.push(
        `      correctness-model source, digests only, unread by the two rows above: ${moved.length === 0 ? "no file moved" : `${moved.join(", ")} moved`}, ${edge.source.unchanged} of ${edge.source.read} unchanged`,
      );
    }
    const { unchanged, tasks, afterFullPass } = edge.carried;
    lines.push(
      `      carried ${unchanged} of ${tasks} tasks unchanged in id, public input and family checks${afterFullPass && unchanged > 0 ? ", after a battery that passed every case, so each re-measures a known pass" : ""}`,
    );
    lines.push(
      `      outcome ${edge.outcome === "unobservable" ? "unobservable" : `${edge.outcome.passed}/${edge.outcome.verified}`}`,
    );
  }
  for (const battery of report.unadopted) {
    lines.push(
      `  ${battery.createdAt ?? "undated"}  ${battery.runId}: ${battery.counts.passed}/${battery.counts.verified} passed, ${battery.counts.unaccepted} unaccepted, ${battery.counts.nonResult} non-result; claimed with no version of its own, so on the line and on no edge`,
    );
  }
  lines.push(followUpLine(report));
  lines.push(...lineLines(lineOf(report)), carriedLine(report), latestEdgeLine(report));
  return lines.join("\n");
}
