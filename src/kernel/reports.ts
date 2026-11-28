import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import {
  carriedBy,
  draw,
  gainOver,
  type Measures,
  judgeIn,
  objectiveRuleIn,
  type Paired,
  pairsOf,
  pointsOf,
  differenceOf,
} from "./compare.ts";
import { failWrongPasses, proposalsOf, wrongPasses, wrongPassesIn } from "./history.ts";
import { type EventKind, eventsOf, isReferenceChange, type LogEvent } from "./log.ts";
import { providerFailed, windowEnded } from "./solve.ts";
import { passed, ranUnder, rejected, standsOf } from "./solves.ts";
import { howOftenValid } from "./size.ts";
import { taskSets } from "./task.ts";
import { validScores } from "./verify.ts";

export interface Reported {
  readonly session: string;
  readonly index: number;
  readonly data: JsonObject;
}

export type Outcome =
  | "reference-every"
  | "reference-some"
  | "reference-none"
  | "earlier-reference"
  | "disputed";

export interface Standing {
  readonly won: "reference" | "other" | null;
  readonly by: keyof Measures | null;
}

interface TaskReading {
  readonly index: number;
  readonly order: number;
  readonly validity: "every" | "some" | "none" | null;
  readonly referenceCut: boolean;
  readonly won: "reference" | "other" | null;
  readonly by: keyof Measures | null;
}

interface TaskRecord {
  readonly version: string;
  readonly held: boolean;
  heldAt: number;
  validAnswer: "independent" | "known" | "none";
  best: number | null;
  bestScores: Readonly<Record<string, number>> | null;
  readonly tallied: TaskReading[];
  excludedAt: number;
  doubtedAt: number;
}

export interface Cap {
  readonly dollars: number;
  readonly reserve: number;
}

export const PATIENCE = 6;
export const AT_A_LIMIT: ReadonlySet<unknown> = new Set(["wall-ended", "turns-ended", "context-ended"]);
export const INTERRUPTED: ReadonlySet<unknown> = new Set(["killed", "crashed"]);
const REPORTED = "comparison.reported";
const STARTED = "comparison.started";
const BUILD_FINISHED = "build.finished";
const REVERTED = "harness.reverted";
const REFERENCE_KINDS: readonly EventKind[] = ["harness.promoted", REVERTED];
const RECORD_KINDS: readonly EventKind[] = [
  "solve.turn",
  ...REFERENCE_KINDS,
  "task.state",
  "task.gate",
  "task.feasible",
];
const BUILT_KINDS: readonly EventKind[] = ["build.checkpoint", BUILD_FINISHED, REVERTED];
export function capHolds({ dollars, reserve }: Cap): boolean {
  return [dollars, reserve].every((amount) => Number.isFinite(amount) && amount > 0);
}

export function lastReports(events: readonly LogEvent[], read: "all" | "current" = "current"): Reported[] {
  const found = new Map<string, Reported>();
  for (const { index, event } of eventsOf(events, REPORTED)) {
    const { data } = event;
    if (!isString(data.session) || (data.ladder === true && read !== "all")) continue;
    found.set(data.session, { session: data.session, index: found.get(data.session)?.index ?? index, data });
  }
  return [...found.values()];
}

export function startedComparisons(events: readonly LogEvent[]): string[] {
  const seen = new Set<string>();
  for (const { event } of eventsOf(events, STARTED)) {
    if (event.data.ladder !== true && isString(event.data.session)) seen.add(event.data.session);
  }
  return [...seen];
}

export function latestBuilt(events: readonly LogEvent[]): string | null {
  const undone = new Set(
    eventsOf(events, BUILD_FINISHED).flatMap(({ event: { data } }) =>
      data.changed === false && !INTERRUPTED.has(data.ended) ? [data.session] : [],
    ),
  );
  const made = new Set(eventsOf(events, REFERENCE_KINDS).map(({ event }) => event.data.harness));
  const left = eventsOf(events, BUILT_KINDS).findLast(
    ({ event: { kind, data } }) =>
      ((kind === "build.checkpoint" && (!undone.has(data.session) || made.has(data.harness))) ||
        (kind === BUILD_FINISHED && data.changed === true && !INTERRUPTED.has(data.ended)) ||
        kind === REVERTED) &&
      isString(data.harness),
  )?.event.data.harness;
  return isString(left) ? left : null;
}

export function promoted(events: readonly LogEvent[]): string | null {
  const harness = eventsOf(events, REFERENCE_KINDS).at(-1)?.event.data.harness;
  return isString(harness) ? harness : null;
}

export function endedOf(events: readonly LogEvent[]) {
  const last = events.at(-1);
  if (last?.kind !== "campaign.ended" || !isString(last.data.ending)) return null;
  return { ending: last.data.ending, why: isString(last.data.why) ? last.data.why : "" };
}

export const endingOf = (events: readonly LogEvent[]): string | null => endedOf(events)?.ending ?? null;

export function endedData(
  events: readonly LogEvent[],
  {
    ending,
    why,
    answers,
  }: { readonly ending: string; readonly why: string; readonly answers?: readonly number[] },
): JsonObject {
  return {
    ending,
    why,
    reference: promoted(events) ?? "starter",
    latest: latestBuilt(events),
    ...keyIfDefined("answers", answers === undefined ? undefined : [...answers]),
  };
}

export function referenceOf(events: readonly LogEvent[]): string | null {
  const current = promoted(events);
  if (current !== null) return current;
  const reports = lastReports(events);
  const harness = reports.map(({ data }) => data.starter).find(isString) ?? reports[0]?.data.old;
  return isString(harness) ? harness : null;
}

export function comparedAs(events: readonly LogEvent[], harness: string) {
  return lastReports(events).flatMap(({ session, data }) =>
    data.fresh === harness && isString(data.old) && isString(data.reading)
      ? [{ comparison: session, against: data.old, reading: data.reading }]
      : [],
  );
}

export interface SupplySaturation {
  readonly validEvery: number;
  readonly scored: number;
  readonly meanRoom: number;
}

const SATURATION_MIN_TASKS = 12;
const SATURATION_VALID_RATE = 0.95;
const SATURATION_ROOM_FLOOR = 0.04;
const UNSOLVED_IN_A_ROW = 2;

export function evalHeadroom(
  report: JsonObject,
  side: "old" | "fresh" = "old",
): "none" | "too-hard" | "room" {
  const valid = asRecord(report.valid);
  const informativeCount = asRecord(valid?.informative)?.[side];
  if (!isNumber(informativeCount) || informativeCount > 0) return "room";
  const anyValid = (counts: unknown) =>
    Array.isArray(counts) && counts.some((n, at) => at > 0 && isNumber(n) && n > 0);
  return anyValid(valid?.old) || anyValid(valid?.fresh) ? "none" : "too-hard";
}

export function objectiveCeiling(
  rule: { readonly direction: "lower" | "higher"; readonly scale?: "unit" },
  best: number | undefined,
): number | null {
  if (rule.scale === "unit") return rule.direction === "higher" ? 1 : 0;
  return best ?? null;
}

export function supplySaturation(
  events: readonly LogEvent[],
  report: Reported,
  side: "old" | "fresh",
  pool?: ReturnType<typeof poolOf>,
): SupplySaturation | null {
  if (report.data.reading !== "no-step") return null;
  const pairs = pairsReported(events, report, "both");
  if (pairs.length < SATURATION_MIN_TASKS) return null;
  const validEvery = pairs.filter((pair) => pair[side].length > 0 && pair[side].every(Boolean)).length;
  if (validEvery / pairs.length < SATURATION_VALID_RATE) return null;
  const bests = (pool ?? poolOf(events)).bests;
  const rooms: number[] = [];
  for (const pair of pairs) {
    const obj = pair.objective;
    if (obj === undefined) continue;
    const vals = obj[side].filter(isNumber);
    if (vals.length === 0) continue;
    const mean = vals.reduce((sum, val) => sum + val, 0) / vals.length;
    const ceiling = objectiveCeiling(obj, bests.get(pair.task));
    if (ceiling === null) continue;
    rooms.push(Math.max(0, gainOver(obj, ceiling, mean)));
  }
  if (rooms.length < SATURATION_MIN_TASKS) return null;
  const meanRoom = rooms.reduce((sum, room) => sum + room, 0) / rooms.length;
  if (meanRoom >= SATURATION_ROOM_FLOOR) return null;
  return { validEvery, scored: pairs.length, meanRoom };
}

export function patienceOf(events: readonly LogEvent[]): number {
  const named = eventsOf(events, "campaign.opened").at(-1)?.event.data.patience;
  return isNumber(named) ? named : PATIENCE;
}

export function pairsReported(
  events: readonly LogEvent[],
  report: Reported,
  sides: "both" | "old" | "fresh" = "both",
): Paired[] {
  const { session, index, data } = report;
  const { old, fresh, setting, solves } = data;
  if (data.scored === null || !isString(old) || !isString(fresh) || !isString(setting) || !isNumber(solves)) {
    return [];
  }
  const started = eventsOf(events, STARTED).find(({ event }) => event.data.session === session)?.event.data;
  const noise = started?.noise === true;
  const halved = sides !== "both" && !noise;
  if ((sides === "fresh" && noise) || (halved && solves % 2 !== 0)) return [];
  const versions = Array.isArray(data.versions) ? data.versions.filter(isString) : [];
  const wrong = wrongPasses(asRecord(asRecord(data.settled)?.passes) ?? {});
  const source = failWrongPasses(events, wrong);
  return pairsOf(
    source,
    versions,
    {
      old: sides === "fresh" ? fresh : old,
      fresh: sides === "old" ? old : fresh,
      setting,
      comparison: session,
      objective: objectiveRuleIn(data),
      judge: started === undefined ? undefined : judgeIn(started),
      halves: noise || halved ? "mirrored" : undefined,
      upTo: index,
    },
    halved ? solves / 2 : solves,
  ).pairs;
}

function orderedBy(
  records: readonly TaskRecord[],
  place: (record: TaskRecord) => number | undefined,
): string[] {
  return records
    .flatMap((record) => {
      const at = place(record);
      return at === undefined ? [] : [[record.version, at] as const];
    })
    .toSorted((one, other) => one[1] - other[1])
    .map(([version]) => version);
}

const runStart = (readings: readonly TaskReading[]) =>
  readings.length >= UNSOLVED_IN_A_ROW ? readings[0]?.order : undefined;
const solveKey = (comparison: string, task: string, harness: string) => `${comparison} ${task} ${harness}`;

function taskRecords(events: readonly LogEvent[]) {
  const { held: heldOut, released } = taskSets(events);
  const held = new Set(heldOut);
  const records = new Map<string, TaskRecord>();
  const recordOf = (version: string): TaskRecord => {
    const found = records.get(version);
    if (found !== undefined) return found;
    const made: TaskRecord = {
      version,
      held: held.has(version),
      heldAt: -1,
      validAnswer: "none",
      best: null,
      bestScores: null,
      tallied: [],
      excludedAt: -1,
      doubtedAt: -1,
    };
    records.set(version, made);
    return made;
  };
  const lastTurn = new Map<string, JsonObject>();
  const references = new Set<unknown>([referenceOf(events)]);
  for (const { index, event } of eventsOf(events, RECORD_KINDS)) {
    const { kind, data } = event;
    if (kind === "solve.turn") {
      if (isString(data.solve)) lastTurn.set(data.solve, data);
      continue;
    }
    if (isReferenceChange(kind)) {
      references.add(data.harness);
      references.add(data.from);
      continue;
    }
    if (!isString(data.version)) continue;
    if (kind === "task.state" && data.state === "held") recordOf(data.version).heldAt = index;
    const referenceValidAtGate = kind === "task.gate" ? asRecord(data.reference)?.valid : undefined;
    if (kind === "task.feasible" || (isNumber(referenceValidAtGate) && referenceValidAtGate > 0)) {
      recordOf(data.version).validAnswer = "independent";
    }
    if (kind !== "task.feasible") continue;
    const obj = asRecord(data.objective);
    const { measure, direction } = obj ?? {};
    if (!isNumber(measure)) continue;
    const record = recordOf(data.version);
    const better =
      record.best === null || (direction === "lower" ? measure < record.best : measure > record.best);
    if (better) {
      record.best = measure;
      record.bestScores = validScores(obj?.scores);
    } else if (record.best === measure && record.bestScores === null) {
      record.bestScores = validScores(obj?.scores);
    }
  }
  const cut = new Set<string>();
  const wrong = wrongPassesIn(events);
  const rejectedIn = new Map<string, string[]>();
  for (const solve of ranUnder(events)) {
    const { task, limits, harness } = solve.under;
    const { comparison } = solve.start;
    const kind = solve.ending?.kind;
    if (passed(solve) === true && !wrong.has(solve.id)) {
      const record = recordOf(task);
      record.validAnswer =
        references.has(harness) || record.validAnswer === "independent" ? "independent" : "known";
    }
    if (!isString(comparison)) continue;
    const turn = lastTurn.get(solve.id);
    const last = {
      stopReason: isString(turn?.stopReason) ? turn.stopReason : null,
      errorMessage: isString(turn?.error) ? turn.error : null,
    };
    const ranOutOfTurns =
      kind === "turns-ended" && isNumber(limits.modelTurns) && !(windowEnded(last) || providerFailed(last));
    const key = solveKey(comparison, task, harness);
    if (AT_A_LIMIT.has(kind) && !ranOutOfTurns) cut.add(key);
    if (rejected(solve.ending)) rejectedIn.set(key, [...(rejectedIn.get(key) ?? []), solve.id]);
  }
  addReportReadings(events, recordOf, { cut, rejectedIn });
  return { records: [...records.values()], held: heldOut, released };
}

function addReportReadings(
  events: readonly LogEvent[],
  recordOf: (version: string) => TaskRecord,
  { cut, rejectedIn }: { cut: ReadonlySet<string>; rejectedIn: ReadonlyMap<string, readonly string[]> },
): void {
  const reference = referenceOf(events);
  const stands = standsOf(events);
  let order = 0;
  for (const report of lastReports(events, "all")) {
    const { index, session, data } = report;
    const side = data.fresh === reference ? "fresh" : data.old === reference ? "old" : null;
    const refHarness = side === null ? undefined : data[side];
    for (const pair of pairsReported(events, report)) {
      const { task } = pair;
      const score = differenceOf(pair);
      order += 1;
      recordOf(task).tallied.push({
        index,
        order,
        validity: side === null ? null : howOftenValid(pair[side]),
        referenceCut: isString(refHarness) && cut.has(solveKey(session, task, refHarness)),
        won: side === null || score === 0 ? null : score > 0 === (side === "fresh") ? "reference" : "other",
        by: carriedBy(pointsOf(pair)),
      });
    }
    for (const task of Array.isArray(data.aside) ? data.aside.filter(isString) : []) {
      const record = recordOf(task);
      record.excludedAt = index;
      const own = isString(refHarness) ? (rejectedIn.get(solveKey(session, task, refHarness)) ?? []) : [];
      if (own.some((solve) => stands.get(solve) !== "solver-fail")) record.doubtedAt = index;
    }
  }
}

export function poolOf(events: readonly LogEvent[]) {
  const { records, held } = taskRecords(events);
  const heldRecords = records.filter((record) => record.held);
  const awaiting = orderedBy(heldRecords, ({ validAnswer, heldAt, tallied }) =>
    validAnswer === "independent"
      ? undefined
      : runStart(
          tallied.filter(
            ({ validity, index, referenceCut }) => validity !== null && index >= heldAt && !referenceCut,
          ),
        ),
  );
  const doubted = orderedBy(heldRecords, ({ doubtedAt, heldAt, tallied }) =>
    doubtedAt > heldAt && doubtedAt > (tallied.at(-1)?.index ?? -1) ? doubtedAt : undefined,
  );
  const leftOut = new Set([...awaiting, ...doubted]);
  const prior = new Set(beforePromotion(events).held);
  const scorable = held.filter((task) => !leftOut.has(task));
  const retained = scorable.filter((task) => prior.has(task));
  const current = held.filter((task) => !prior.has(task));
  const doubtedSet = new Set(doubted);
  return {
    scorable,
    frontier: scorable.filter((task) => !prior.has(task)),
    practicePool: current.filter((task) => !doubtedSet.has(task)),
    awaiting,
    doubted,
    retained,
    feasible: new Set(
      records.flatMap(({ version, validAnswer }) => (validAnswer === "none" ? [] : [version])),
    ),
    bests: new Map(records.flatMap(({ version, best }) => (best === null ? [] : [[version, best] as const]))),
    bestScores: new Map(
      records.flatMap(({ version, bestScores }) =>
        bestScores === null ? [] : [[version, bestScores] as const],
      ),
    ),
    outcomes: new Map(records.flatMap(outcomeOf)),
    standings: new Map(records.flatMap(standingOf)),
  };
}

function outcomeOf(record: TaskRecord): [string, Outcome][] {
  const last = lastReading(record);
  if (last === null) return [];
  if (last === "aside") return [[record.version, "disputed"]];
  return [[record.version, last.validity === null ? "earlier-reference" : `reference-${last.validity}`]];
}

function standingOf(record: TaskRecord): [string, Standing][] {
  const last = lastReading(record);
  if (last === null || last === "aside" || last.validity === null) return [];
  return [[record.version, { won: last.won, by: last.by }]];
}

export function activePromotionAt(events: readonly LogEvent[]): number {
  const installed = new Map<string, number>();
  let current = -1;
  for (const {
    index,
    event: { kind, data },
  } of eventsOf(events, REFERENCE_KINDS)) {
    if (!isString(data.harness)) continue;
    if (kind === REVERTED) {
      current = installed.get(data.harness) ?? -1;
    } else {
      installed.set(data.harness, index);
      current = index;
    }
  }
  return current;
}

const beforePromotion = (events: readonly LogEvent[]) => taskSets(events, activePromotionAt(events));

export function releaseOrder(
  events: readonly LogEvent[],
  pool: readonly string[],
  count: number,
  seed: string,
): [string, string][] {
  const { records, released } = taskRecords(events);
  const releasedSet = new Set(released);
  const prior = beforePromotion(events);
  const priorEpoch = new Set([...prior.held, ...prior.released]);
  const eligible = records.filter(
    ({ held, version }) => !priorEpoch.has(version) && (held || releasedSet.has(version)),
  );
  const unanswered = orderedBy(eligible, ({ tallied }) => {
    const own = tallied.filter(({ validity }) => validity !== null);
    return own.some(({ validity }) => validity !== "none") ? undefined : runStart(own);
  });
  const unansweredSet = new Set(unanswered);
  const failed = orderedBy(eligible, (record) => {
    const last = lastReading(record);
    if (last === null || last === "aside" || last.validity === null) return undefined;
    return last.validity === "every" ? undefined : last.order;
  }).filter((version) => !unansweredSet.has(version));
  const poolSet = new Set(pool);
  const releasedFirst = [...unanswered, ...failed.slice(0, Math.floor(failed.length / 2))].filter((version) =>
    poolSet.has(version),
  );
  const failedSet = new Set(failed);
  const takenSet = new Set(releasedFirst);
  const rest = pool.filter((version) => !takenSet.has(version) && !failedSet.has(version));
  const familyByVersion = new Map(
    proposalsOf(events).flatMap(({ version, family }) =>
      family !== null && family !== "" ? [[version, family] as const] : [],
    ),
  );
  const familyOf = (version: string) => familyByVersion.get(version) ?? version;
  const membersByFamily = new Map<string, string[]>();
  for (const version of pool) {
    const family = familyOf(version);
    membersByFamily.set(family, [...(membersByFamily.get(family) ?? []), version]);
  }
  const failedLimit = Math.floor(failed.length / 2);
  const chosen: string[] = [];
  if (membersByFamily.size <= 1) {
    chosen.push(
      ...releasedFirst.slice(0, count),
      ...draw(rest, Math.min(rest.length, Math.max(0, count - releasedFirst.length)), seed),
    );
  } else {
    let failedReleased = 0;
    const seenFamilies = new Set<string>();
    for (const version of [...releasedFirst, ...draw(rest, rest.length, seed)]) {
      if (chosen.length >= count) break;
      const family = familyOf(version);
      if (seenFamilies.has(family)) continue;
      seenFamilies.add(family);
      const members = membersByFamily.get(family) ?? [];
      const famFailed = members.filter((member) => failedSet.has(member)).length;
      if (
        members.length === 0 ||
        chosen.length + members.length > count ||
        failedReleased + famFailed > failedLimit
      ) {
        continue;
      }
      chosen.push(...members);
      failedReleased += famFailed;
    }
  }
  return chosen.map((version) => [
    version,
    unansweredSet.has(version)
      ? ": the reference harness answered it in no solve of two comparisons, and it is"
      : failedSet.has(version)
        ? ": the reference harness failed it in the last comparison, and it is"
        : ":",
  ]);
}

function lastReading({ tallied, excludedAt }: TaskRecord): TaskReading | "aside" | null {
  const last = tallied.at(-1);
  if (last === undefined) return excludedAt === -1 ? null : "aside";
  return excludedAt > last.index ? "aside" : last;
}
