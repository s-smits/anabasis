// How a campaign climbs, read two ways: the line its measured batteries draw, and whether the tasks
// behind each edge moved. The controller can only steer on a measured pass rate, so a battery the
// provider wrecked tells it nothing and it re-decides on the last battery that scored, and a run
// can record the same "significantly too easy" placement round after round, every one citing one
// battery. This reads the other channel too: whether the tasks moved, by how much, and in which of
// the two ways a battery can move. Lane 10 reads the line and lane 20 the edges.
//
//   bun wri.ts climb <target> [--json]
//
// The velocity is the line's (AGENTS.md "Goals and the climb"): how many claimed batteries landed
// between 1/n and n-1/n, the only ones that can locate a limit, how far the pass rate swings from
// one battery to the next, how many of the first 8 and 12 carried that signal, and whether the line
// has gone flat by the stall rule `runs pulse` names. A full pass at any size found no limit and
// counts as no signal, whatever zone a small one places in. Until 2026-09-30 the velocity was the
// slope from the first placed battery to the last, extrapolated to the band: it read 13 batteries of
// 7/7 and truss-sol-198d70's 6/7 and 10/11 alike, "the measured rate has not fallen", and gave
// custom-sol-f0fb83, whose 2/6, 9/11 and 10/11 were the most any run had drawn, "50 more at this rate
// to reach the band", because its first battery was 6/6 and its last 10/11.
//
// Each battery carries two placements. `placement` is computed here from the case rows through
// `placeOnBand`; `recorded` is what the controller wrote in its difficulty decision, read through
// the digest's schema-refusing reader, so the two can be compared and a decision under another
// schema is named rather than read.
//
// Per battery: the tier histogram and the median structural row from query-complexity.ts, plus
// the measured outcome when there is one. Per edge between consecutive batteries:
//
//   restated      the prose did not move and neither did the structure
//   replaced      fewer than half the task ids carried over, so the published numbers could not be compared
//   adjusted      the same structural counts at the same tier, with the published numbers moved
//   narrowed      fewer of a structural count at the same tier; checks, coupled inputs and scenarios decide first
//   widened       more of a structural count at the same tier; checks, coupled inputs and scenarios decide first
//   eased         the checks moved down the tier order
//   escalated     the checks moved up the tier order
//
// Every verdict but `adjusted` names its direction. `adjusted` does not: `numericDriftOf` measures
// distance and not direction, because a boundary states which way is tighter and most declare none.
// Moving a limit is a real climb when it moves inward, and this reader cannot tell you that it did.
// A battery that dropped checks or fell down the tier order once read as `adjusted`, which
// named a retreat with the one word that says nothing. So did growth in the other structural counts
// until 2026-09-29: truss-sol-2d7812 added load sites and a forbidden volume, two inputs more at the
// same checks, and its edge read `adjusted`. A new input, rule or limit is a structural move and is
// named as one; whether it is a new demand is read from the task rows beside it.
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
import { classifyCaseOutcome, outcomeTally, readCaseRecord } from "#src/claim/case-record.ts";
import {
  placeOnBand,
  type BandPlacement,
  type BandZone,
  type MeasuredDifficulty,
} from "#src/claim/battery-difficulty.ts";
import { POLICY } from "#src/critic/policy.ts";
import { join } from "#src/meta/path.ts";
import { decidingSample, type ClimbBattery } from "#src/run/climb-history.ts";
import { readRecordedBatteryRecord } from "#src/correctness-bundle/battery-record.ts";
import {
  type Bundle,
  MODEL_IDENTITY,
  STRUCTURE_KEYS,
  TIER_ORDER,
  appliesTo,
  loadBundle,
  readVersionDir,
  renderBattery,
} from "../classifier/query-complexity.ts";
import { isNumber } from "#src/meta/json-shape.ts";
import { compareCodeUnits, stableJson } from "#src/meta/stable-json.ts";
import { readDifficultyDecisions } from "./digest-ledgers.ts";
import { readJsonAs, readJsonAsOrNull } from "./run-overview.ts";
import type { CaseDisposition, EpochReviewEvidence } from "#src/review/epoch-review-findings.ts";
import { offAimStreak, STALL_BATTERIES } from "#tools/runs/pulse.ts";

/** v2 replaced the endpoint slope (`velocity`) with the line (`line`). */
export const VELOCITY_SCHEMA = "climb-velocity/v2";
/** AGENTS.md "Goals and the climb": a run's climb is read over 8 or 12 rounds. */
const HORIZONS = [8, 12] as const;
/** Cosine at or above this between a family's prose and its nearest predecessor reads as the same
 *  problem restated. bge-small puts genuinely reworded-but-equivalent prose well above this. */
export const RESTATED_COSINE = 0.98;

/** The two files the task-side rows already read, and so the two this digest row leaves alone. */
export const SCORED_BUNDLE_FILES: ReadonlySet<string> = new Set(["brief.json", "tasks.json"]);

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
 *  of model readings alone, which the controller's placement refuses too. The 2d7812 firmware battery read 4/6, over
 *  the aim, on two fails of one check holding the sketch to a status label no public rule stated,
 *  and nothing in this reader said the placement rested on them. */
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

export interface NumericDrift {
  median: number;
  moved: number;
  joined: number;
  tasks: number;
}

/** The later battery's tasks that carry the same id, public input and family checks as the one
 *  before it, of `tasks` in all, and whether that earlier battery passed every case it verified. */
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

/** The controller's recorded placement of one battery. */
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

/** The controller's own placement of one battery, so this reader and the decision it sets out to
 *  explain cannot disagree: `decidingSample` picks the changed subset when the host recorded one
 *  and the whole battery otherwise, and `placeOnBand` reads it. Once any case is verified, an
 *  unaccepted attempt stays in the denominator as a failure, which is the controller's difficulty
 *  denominator; reading passed over verified instead put a battery of 5 passes and 20 refused
 *  submits at a rate of 1 where the controller placed it at 0.2. A battery that verified nothing
 *  has no placement at all rather than a zero one. */
export function placementOf(
  counts: Pick<OutcomeCounts, "passed" | "verified" | "unaccepted">,
  measured: MeasuredDifficulty = { items: [] },
  band: readonly [number, number] = POLICY.climb.band,
): ClimbPlacement | null {
  if (counts.verified === 0) return null;
  // SAFETY: `decidingSample` destructures only `measured`, `passed` and `n`, which this object carries.
  const battery = { measured, passed: counts.passed, n: counts.verified + counts.unaccepted } as ClimbBattery;
  const sample = decidingSample(battery);
  const placement = placeOnBand(sample.passes, sample.n, band);
  return placement === null
    ? null
    : { ...placement, rate: placement.passes / placement.n, population: sample.population };
}

/** The recorded measured difficulty of the run a version directory holds, or the empty one when
 *  the version recorded no battery of its own. */
function measuredOf(battery: VersionBattery): MeasuredDifficulty {
  const runDir = join(battery.dir, "runs", battery.runId);
  return existsSync(join(runDir, "battery.json"))
    ? readRecordedBatteryRecord(runDir, battery.runId).measured
    : { items: [] };
}

/** Passed, verified, unaccepted and non-result counts per runId, from the campaign's own case rows
 *  through the controller's strict reader, classifier and tally. An unaccepted attempt is recorded
 *  with `pass: false`, so reading `pass` alone counts every case the solver never submitted as a
 *  verified failure and then places a battery that verified nothing. */
export function outcomesOf(campaign: string): Map<string, OutcomeCounts> {
  const outcomesByRun = new Map<string, ReturnType<typeof classifyCaseOutcome>[]>();
  for (const { row } of readCaseRecord(`${campaign}/case-record.jsonl`)) {
    const outcomes = outcomesByRun.get(row.runId) ?? [];
    outcomes.push(classifyCaseOutcome(row));
    outcomesByRun.set(row.runId, outcomes);
  }
  const byRun = new Map<string, OutcomeCounts>();
  for (const [runId, outcomes] of outcomesByRun) {
    const tally = outcomeTally(outcomes);
    byRun.set(runId, {
      passed: tally.passed,
      verified: tally.verified,
      unaccepted: tally.unaccepted,
      nonResult: tally.nonResults,
    });
  }
  return byRun;
}

/** Null when no completed review of this battery is recorded, which is unread, never "nothing settled". */
export function settlementOf(campaign: string, runId: string): Settlement | null {
  const review = readJsonAsOrNull<Pick<EpochReviewEvidence, "status"> & { dispositions?: CaseDisposition[] }>(
    join(campaign, "analysis", `${runId}-epoch-review.json`),
  );
  if (review?.status !== "completed") return null;
  const rows = review.dispositions ?? [];
  const count = (veto: boolean, disposition: CaseDisposition["disposition"]) =>
    rows.filter((row) => (row.kind === "veto") === veto && row.disposition === disposition).length;
  return {
    failsHeld: count(false, "check-stands"),
    failsAgainst: count(false, "against-check"),
    passesAgainst: count(true, "against-check"),
    checks: [...new Set(rows.map((row) => row.checkId))],
  };
}

/** Batteries in the order they were measured. A claim's `createdAt` owns chronology; a version with
 *  no claim keeps its directory's recorded time and is marked, because an unclaimed battery is
 *  exactly the case this reader exists for. */
export function batteriesOf(campaign: string): VersionBattery[] {
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
    (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.runId.localeCompare(b.runId),
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

/** How far the published numbers moved between two batteries, over the public inputs that the same
 *  task carries in both. Direction is deliberately absent: a boundary states which way is tighter
 *  and most do not declare one, so this answers "did the numbers move" and the check-tier histogram
 *  answers whether anything new has to be reasoned about. `joined` counts the later tasks whose id
 *  the earlier battery also held, of `tasks` in all: a Builder that renumbers its tasks leaves little
 *  to compare, and zero moved over one joined task of 25 is no evidence that the numbers stood still. */
export function numericDriftOf(
  before: Pick<BatteryReading, "rows">,
  after: Pick<BatteryReading, "rows">,
): NumericDrift {
  const earlier = new Map(before.rows.map((row) => [row.taskId, row]));
  const changes: number[] = [];
  let joined = 0;
  for (const row of after.rows) {
    const previous = earlier.get(row.taskId);
    if (previous === undefined) continue;
    joined += 1;
    for (const [path, value] of Object.entries(row.numerics)) {
      const was = previous.numerics[path];
      if (!isNumber(was) || was === 0 || value === was) continue;
      changes.push(Math.abs(value - was) / Math.abs(was));
    }
  }
  const tasks = after.rows.length;
  if (changes.length === 0) return { median: 0, moved: 0, joined, tasks };
  changes.sort((a, b) => a - b);
  return { median: changes[Math.floor(changes.length / 2)] ?? 0, moved: changes.length, joined, tasks };
}

/** The checks that apply to one family, as the bytes a solver of its task reads them in. */
function familyChecks(brief: Bundle["brief"], family: string): string {
  return stableJson((brief.truthChecks ?? []).filter((check) => appliesTo(check, family)));
}

/** How many of the later battery's tasks the solver meets exactly as before: the same id, public
 *  input and family checks. After a full pass such a task measures a known pass again. Bulk RNA-seq
 *  run 36e268 passed every case of eleven batteries while growing by about one task a round, and 53
 *  of the tasks after those full passes were carried this way; a verdict cannot show it, and neither
 *  can the numeric drift, which reads zero for a carried task and for a task whose one new input
 *  carries no number. The correctness-model source can still ask more of an unchanged task, and the
 *  digest row beside this one names the file when it moved. */
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
 *  most task ids carried over; before that the edge is `replaced` and read by hand. */
const LEADING_KEYS = ["checks", "coupled", "scenarios"] as const;

/** Which of the six ways the battery moved, named from the tier order first and the structural
 *  counts second. Exported so the directions can be read off literal readings. */
export function verdictOf(
  before: Pick<BatteryReading, "checkTiers">,
  after: Pick<BatteryReading, "checkTiers">,
  novelty: Novelty | null,
  delta: Readonly<Record<string, number>>,
  drift: NumericDrift,
): EdgeVerdict {
  const was = topTierOf(before.checkTiers);
  const now = topTierOf(after.checkTiers);
  if (was !== null && now !== null && now !== was) return now > was ? "escalated" : "eased";
  const directionOf = (keys: readonly string[]) =>
    keys.some((key) => (delta[key] ?? 0) > 0)
      ? "widened"
      : keys.some((key) => (delta[key] ?? 0) < 0)
        ? "narrowed"
        : null;
  const led = directionOf(LEADING_KEYS);
  if (led !== null) return led;
  if (drift.joined * 2 < drift.tasks) return "replaced";
  const other = directionOf(STRUCTURE_KEYS);
  if (other !== null) return other;
  const restatedProse = novelty === null || novelty.mean <= 1 - RESTATED_COSINE;
  const carried = drift.moved === 0 && drift.joined === drift.tasks;
  if (restatedProse && carried && STRUCTURE_KEYS.every((key) => delta[key] === 0)) {
    return "restated";
  }
  return "adjusted";
}

/** The controller's own placement of each battery, from the last difficulty decision that carried
 *  its readout row: the zone and the distance to the aim. */
function recordedPlacements(campaign: string): RecordedPlacements {
  const decisions = readDifficultyDecisions(campaign);
  const byRun = new Map<string, RecordedPlacement>();
  for (const decision of decisions.rows) {
    for (const row of decision.rows) {
      byRun.set(row.runId, { zone: row.zone, decidedBy: decision.runId });
    }
    if (decision.placement !== null) {
      const own: RecordedPlacement = byRun.get(decision.runId) ?? {
        zone: decision.zone,
        decidedBy: decision.runId,
      };
      byRun.set(decision.runId, { ...own, toAim: decision.placement.toAim });
    }
  }
  return { byRun, refused: decisions.refused };
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
 *  the line: custom-sol-f0fb83's i11 and i13 measured 11/11 each and left no version. */
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

export async function readCampaign(campaign: string, options: Parameters<typeof readVersionDir>[1] = {}) {
  const outcomes = outcomesOf(campaign);
  const recorded = recordedPlacements(campaign);
  const batteries = [];
  for (const battery of batteriesOf(campaign)) {
    const reading = await readVersionDir(battery.dir, options);
    const counts = outcomes.get(battery.runId) ?? { passed: 0, verified: 0, unaccepted: 0, nonResult: 0 };
    const settlement = settlementOf(campaign, battery.runId);
    batteries.push({
      ...battery,
      reading,
      counts,
      settlement,
      placement: placementOf(counts, measuredOf(battery)),
      earned: earnedOf(counts, settlement),
      recorded: recorded.byRun.get(battery.runId) ?? null,
    });
  }
  const edges = [];
  for (const [at, after] of batteries.entries()) {
    const before = batteries[at - 1];
    if (before === undefined) continue;
    const delta: Record<string, number> = {};
    for (const key of STRUCTURE_KEYS) {
      delta[key] = (after.reading.medians[key] ?? Number.NaN) - (before.reading.medians[key] ?? Number.NaN);
    }
    const novelty = noveltyOf(before.reading, after.reading);
    const drift = numericDriftOf(before.reading, after.reading);
    edges.push({
      from: before.runId,
      to: after.runId,
      verdict: verdictOf(before.reading, after.reading, novelty, delta, drift),
      novelty,
      drift,
      delta,
      source: sourceMovesOf(before.dir, after.dir),
      carried: {
        ...carriedOf(loadBundle(before.dir), loadBundle(after.dir)),
        // A full pass: every case it verified passed, and no attempt went unaccepted.
        afterFullPass:
          before.counts.verified > 0 &&
          before.counts.unaccepted === 0 &&
          before.counts.passed === before.counts.verified,
      },
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
    unadopted: unadoptedOf(campaign, outcomes, new Set(batteries.map((battery) => battery.runId))),
    edges,
    refusedDecisions: recorded.refused,
  };
}

/**
 * The line the claimed batteries draw, adopted or not, in claim order (AGENTS.md "Goals and the
 * climb"). A battery still measuring has not landed on it. Each point is read on the counts the
 * controller places, earned where a completed review settled a case against its check.
 *
 * Signal is a battery between 1/n and n-1/n, as in RL curriculum filtering: one at n/n or 0/n says
 * nothing about where the solver stops, whatever zone it places in, and 3/3 places over the aim.
 * The swing is the mean distance the pass rate moved per battery, so a line of full passes reads 0
 * however many tasks each held, and the launch film's 25, 6, 5, 24, 17, 21, 12, 19, 21, 9, 12 and 11
 * of 25 reads high. Neither rewards a line for falling: a repair that lifts a battery a defect sank
 * is as much a move as a raised requirement that drops one.
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
      : streak.flat >= STALL_BATTERIES
        ? `yes: ${streak.side} the aim ${streak.rounds} in a row, and the ${streak.flat} since ${streak.closest.passes}/${streak.closest.n} came no closer`
        : `no: ${streak.side} the aim ${streak.rounds} in a row, ${streak.flat} since the closest, ${streak.closest.passes}/${streak.closest.n}`;
  return [
    `  velocity: ${line.signal.length} of ${placed} claimed batteries between 1/n and n-1/n${named}; ${line.onAim} on the aim, ${line.fullPasses} full passes and ${line.empty} empty, which locate nothing; ${swing}`,
    `  horizon: between 1/n and n-1/n, ${horizon}`,
    `  flat: ${flat}`,
  ];
}

/** How many solves the run spent measuring again what a full pass had already answered. */
function carriedLine(report: ClimbReport): string {
  const after = report.edges.filter((edge) => edge.carried.afterFullPass);
  const tasks = after.reduce((sum, edge) => sum + edge.carried.unchanged, 0);
  if (after.length === 0) return "  carried: no edge follows a full pass";
  return `  carried: ${tasks} tasks measured again unchanged over the ${after.length} edge${after.length === 1 ? "" : "s"} after a full pass; a task that passed changes or leaves`;
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
      `      novelty ${edge.novelty === null ? "n/a" : edge.novelty.mean.toFixed(4)}   numbers moved ${edge.drift.moved} by ${(edge.drift.median * 100).toFixed(2)}% median over ${edge.drift.joined} of ${edge.drift.tasks} tasks joined by id`,
    );
    lines.push(
      `      delta ${STRUCTURE_KEYS.map((key) => {
        const change = edge.delta[key];
        return `${key} ${change !== undefined && change >= 0 ? "+" : ""}${String(change)}`;
      }).join("  ")}`,
    );
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
  lines.push(...lineLines(lineOf(report)), carriedLine(report), latestEdgeLine(report));
  return lines.join("\n");
}
