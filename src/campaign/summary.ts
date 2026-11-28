import { type Measures, pointsOf, scoresIn, type Tally, testOf } from "../kernel/compare.ts";
import { proposalsOf } from "../kernel/history.ts";
import { type EventKind, eventsOf, type LogEvent } from "../kernel/log.ts";
import { INTERRUPTED, lastReports, latestBuilt, pairsReported, promoted } from "../kernel/reports.ts";
import { ownedBy, ownersOf, traceKind } from "../kernel/trace.ts";
import { billedAll, billedParts } from "../kernel/meter.ts";
import {
  ended,
  passed,
  practiceRan,
  type Ran,
  ranUnder,
  rejectionAside,
  rulingsOf,
  solvesIn,
  standsOf,
} from "../kernel/solves.ts";
import { admissionsOf, taskSets } from "../kernel/task.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { type Supply, supplyOf } from "./admission.ts";
import type { Ruling } from "../audit/auditor.ts";
import { fixedIn, overlapOf, reported, STARTED } from "./comparison.ts";

type PracticeStanding =
  | { readonly standing: "open"; readonly under: null }
  | { readonly standing: "passed-once" | "repaired" | "failing-again"; readonly under: string };

export type PracticeFail = {
  readonly solve: string;
  readonly task: string;
  readonly harness: string;
  readonly kind: string | null;
} & PracticeStanding;

interface SoFar {
  readonly ended: string | null;
  readonly cut: boolean;
  readonly turns: number;
  readonly last: string;
}

interface Examined extends SoFar {
  readonly step: "examiner";
  readonly id: string;
  readonly proposed: number;
  readonly held: number;
  readonly refused: number;
  readonly billed: number;
}

interface Built extends SoFar {
  readonly step: "builder";
  readonly id: string;
  readonly parent: string | null;
  readonly harness: string | null;
  readonly unfinished: string | null;
  readonly changed: boolean;
  readonly practiceSolves: number;
  readonly until: number;
  readonly fails: number;
  readonly billed: number;
}

interface SideMean {
  readonly billed: number;
  readonly turns: number;
}

interface Compared {
  readonly step: "comparison";
  readonly id: string;
  readonly old: string;
  readonly fresh: string;
  readonly tasks: number;
  readonly solves: number;
  readonly level: number;
  readonly cap: number | null;
  readonly modelTurns: number | null;
  readonly reading: string | null;
  readonly tally: Tally | null;
  readonly validity: number | null;
  readonly valid: { readonly old: readonly number[]; readonly fresh: readonly number[] } | null;
  readonly points: Measures | null;
  readonly means: { readonly old: SideMean; readonly fresh: SideMean } | null;
  readonly aside: number;
  readonly grain: { readonly largest: number; readonly of: number } | null;
  readonly repeat: { readonly with: string; readonly tasks: number } | null;
  readonly rulings: Readonly<Record<Ruling, number>>;
  readonly billed: number;
  readonly cut: boolean;
  readonly begun: number;
  readonly solved: number;
}

export type Handover = Examined | Built | Compared;

export interface Campaign {
  readonly supply: Supply;
  readonly reference: string | null;
  readonly latest: string | null;
  readonly steps: readonly Handover[];
  readonly fails: readonly PracticeFail[];
}

type Shared = ReturnType<typeof sharedOf>;

const REPAIRED_AFTER = 2;
const EXAM_STARTED: EventKind = "exam.started";
const BUILD_STARTED: EventKind = "build.started";
const BOUND_KINDS: readonly EventKind[] = [
  EXAM_STARTED,
  "exam.finished",
  BUILD_STARTED,
  "build.finished",
  "draft.started",
  "draft.finished",
  STARTED,
  "comparison.reported",
  "campaign.ended",
];
const STEP_KINDS: readonly EventKind[] = [EXAM_STARTED, BUILD_STARTED, STARTED, "comparison.reported"];

function sharedOf(events: readonly LogEvent[]) {
  const bySession = (kind: EventKind) =>
    Map.groupBy(eventsOf(events, kind), ({ event }) => event.data.session);
  const [practised, stands] = [practiceRan(events), standsOf(events)];
  const endedAt = eventsOf(events, "campaign.ended");
  return {
    owners: ownersOf(events),
    practised,
    fails: practiceFails(events, practised, stands),
    admissions: admissionsOf(events),
    reports: new Map(lastReports(events).map((report) => [report.session, report])),
    solves: Map.groupBy(solvesIn(events), ({ start }) => start.comparison),
    rulings: rulingsOf(events),
    settings: eventsOf(events, "campaign.setting").map(({ index: at, event: { data } }) => ({ at, data })),
    lastCut: Math.max(eventsOf(events, STARTED).at(-1)?.index ?? -1, endedAt.at(-1)?.index ?? -1),
    checkpoints: bySession("build.checkpoint"),
    finished: { exam: bySession("exam.finished"), build: bySession("build.finished") },
    turns: { exam: bySession(traceKind("exam", "turn")), build: bySession(traceKind("build", "turn")) },
    started: { exam: eventsOf(events, EXAM_STARTED), build: eventsOf(events, BUILD_STARTED) },
    ended: endedAt,
  };
}

const count = (value: unknown): number => (isNumber(value) ? value : 0);
const listed = (value: unknown): number => (Array.isArray(value) ? value.length : 0);
const text = (value: unknown): string | null => (isString(value) ? value : null);

function standing(
  fail: Ran & { finished: number },
  taskSolves: readonly (Ran & { finished: number })[],
): PracticeStanding {
  const since = taskSolves.filter((solve) => solve.finished > fail.finished);
  const last = since.findLast((solve) => solve.under.harness !== fail.under.harness)?.under.harness;
  if (last === undefined) return { standing: "open", under: null };
  const under = since.flatMap((solve) => (solve.under.harness === last ? [passed(solve)] : []));
  if (under.includes(false)) return { standing: "failing-again", under: last };
  return { standing: under.length >= REPAIRED_AFTER ? "repaired" : "passed-once", under: last };
}

export function nextBound(events: readonly LogEvent[], index: number): number {
  const next = Math.min(
    ...BOUND_KINDS.map((kind) => eventsOf(events, kind).find(({ index: i }) => i > index)?.index ?? Infinity),
  );
  return Number.isFinite(next) ? next : -1;
}

function soFar(events: readonly LogEvent[], index: number, seat: "exam" | "build", shared: Shared) {
  const id = text(events[index]?.data.session) ?? "";
  const closed = shared.finished[seat].get(id)?.find(({ index: at }) => at > index);
  const nextAfter = (list: readonly { readonly index: number }[]) =>
    list.find(({ index: at }) => at > index)?.index ?? events.length;
  const past = Math.min(nextAfter(shared.started[seat]), nextAfter(shared.ended));
  const until = closed?.index ?? past;
  const endAt = closed === undefined ? until : closed.index + 1;
  const turns = (shared.turns[seat].get(id) ?? []).filter(
    ({ index: at }) => at >= index && at < endAt,
  ).length;
  if (closed !== undefined) {
    const read: SoFar = { ended: text(closed.event.data.ended), cut: false, turns, last: closed.event.at };
    const window: readonly LogEvent[] = [];
    return { read, end: closed.event.data, until, endAt, window, billed: 0 };
  }
  const window = events.slice(index, until);
  const last =
    window.findLast(({ kind, data }) => kind.startsWith(`${seat}.`) && data.session === id)?.at ?? "";
  return {
    read: { ended: null, cut: past < events.length, turns, last } satisfies SoFar,
    end: undefined,
    until,
    endAt,
    window,
    billed: billedAll(window.filter(ownedBy(events, id, shared.owners))),
  };
}

function practiceFails(
  events: readonly LogEvent[],
  practised: readonly Ran[],
  stands: ReturnType<typeof standsOf>,
) {
  const released = new Set(taskSets(events).released);
  const practice = ended(practised.filter(({ under }) => released.has(under.task))).filter(
    (solve) => passed(solve) !== null && !rejectionAside(events, solve, stands),
  );
  const byTask = Map.groupBy(practice, ({ under }) => under.task);
  return practice
    .filter((solve) => passed(solve) === false)
    .map((solve) => ({
      solve: solve.id,
      task: solve.under.task,
      harness: solve.under.harness,
      kind: text(solve.ending?.kind),
      ...standing(solve, byTask.get(solve.under.task) ?? []),
      started: solve.started,
    }));
}

function reportFields(report: ReturnType<typeof reported>) {
  if (report === null) {
    return { reading: null, tally: null, valid: null, points: null, aside: 0, grain: null };
  }
  const { reading, points, aside, valid, families, scored: raw } = report;
  const scored = raw !== null && "unbilled" in raw ? testOf(scoresIn(raw)) : raw;
  const sizes = families && Object.values(families).map(({ frontier: f }) => f.wins + f.losses + f.ties);
  return {
    reading,
    tally: scored && { wins: scored.wins, losses: scored.losses, ties: scored.ties },
    valid: valid && { old: valid.old, fresh: valid.fresh },
    points,
    aside: aside.length,
    grain: sizes && { largest: Math.max(0, ...sizes), of: sizes.reduce((a, b) => a + b, 0) },
  };
}

function rulingCounts(
  solves: readonly { readonly id: string }[],
  rulings: ReadonlyMap<string, string | null>,
): Readonly<Record<Ruling, number>> {
  const counts: Record<Ruling, number> = { "solver-fail": 0, "check-defect": 0, unclear: 0 };
  for (const { id } of solves) {
    const ruling = rulings.get(id);
    if (ruling === "solver-fail" || ruling === "check-defect" || ruling === "unclear") counts[ruling] += 1;
  }
  return counts;
}

function sideMeanOf(solves: readonly Ran[], harness: string): SideMean | null {
  const rows = solves.flatMap((solve) =>
    solve.under.harness === harness &&
    passed(solve) !== null &&
    isNumber(solve.end?.billed) &&
    isNumber(solve.end?.turns)
      ? [{ billed: solve.end.billed, turns: solve.end.turns }]
      : [],
  );
  if (rows.length === 0) return null;
  return {
    billed: rows.reduce((sum, { billed }) => sum + billed, 0) / rows.length,
    turns: rows.reduce((sum, { turns }) => sum + turns, 0) / rows.length,
  };
}

function compared(events: readonly LogEvent[], id: string, shared: Shared, began: number): Compared {
  const report = reported(events, id);
  const last = shared.reports.get(id);
  const start = events[began]?.data ?? last?.data ?? {};
  const solves = shared.solves.get(id) ?? [];
  const setting = shared.settings.findLast(({ at }) => at < began)?.data;
  const told = setting === undefined ? asRecord(solves[0]?.start.limits)?.modelTurns : setting.modelTurns;
  const dollars = asRecord(start.cap)?.dollars;
  const pairs = last === undefined ? [] : pairsReported(events, last);
  const fixed = fixedIn(events, id);
  const repeat = fixed === null ? null : overlapOf(events, fixed);
  const old = text(start.old) ?? "";
  const fresh = text(start.fresh) ?? "";
  const ran = ranUnder(events, solves);
  const [oldMean, freshMean] = [sideMeanOf(ran, old), sideMeanOf(ran, fresh)];
  return {
    step: "comparison",
    id,
    old,
    fresh,
    tasks: Array.isArray(start.tasks) ? start.tasks.length : count(start.tasks),
    solves: count(start.solves),
    level: count(start.level),
    cap: isNumber(dollars) ? dollars : null,
    modelTurns: isNumber(told) ? told : null,
    ...reportFields(report),
    means: oldMean !== null && freshMean !== null ? { old: oldMean, fresh: freshMean } : null,
    validity: pairs.length === 0 ? null : pairs.filter((pair) => pointsOf(pair).validity !== 0).length,
    repeat: repeat === null ? null : { with: repeat.with, tasks: repeat.tasks.length },
    rulings: rulingCounts(solves, shared.rulings),
    billed: billedParts(events, id).comparison,
    cut: report === null && shared.lastCut > began,
    begun: solves.length,
    solved: ended(solves).length,
  };
}

function examStep(events: readonly LogEvent[], index: number, id: string, shared: Shared): Examined {
  const { read, end, window, billed } = soFar(events, index, "exam", shared);
  const proposed =
    end === undefined
      ? proposalsOf(window).flatMap(({ session, version }) => (session === id ? [version] : []))
      : [];
  const counts =
    end === undefined
      ? {
          proposed: proposed.length,
          held: proposed.filter((version) => shared.admissions.get(version) === true).length,
          refused: proposed.filter((version) => shared.admissions.get(version) === false).length,
          billed,
        }
      : {
          proposed: count(end.proposed),
          held: listed(end.held),
          refused: listed(end.refused),
          billed: count(end.billed) + billedParts(events, id).comparison,
        };
  return { step: "examiner", id, ...read, ...counts };
}

function buildStep(events: readonly LogEvent[], index: number, id: string, shared: Shared): Built {
  const { read, end, until, endAt, billed } = soFar(events, index, "build", shared);
  const within = ({ started }: { readonly started: number }) => started > index && started < until;
  const frozen = shared.checkpoints.get(id)?.findLast(({ index: at }) => at >= index && at < endAt)?.event;
  const interrupted = INTERRUPTED.has(end?.ended);
  const named = interrupted ? null : text(end?.harness);
  const [harness, parent] = [named ?? text(frozen?.data.harness), text(events[index]?.data.parent)];
  return {
    step: "builder",
    id,
    ...read,
    parent,
    harness,
    unfinished: interrupted && end?.changed === true ? text(end?.harness) : null,
    changed: named === null ? harness !== null && harness !== parent : end?.changed === true,
    practiceSolves: isNumber(end?.practiceSolves)
      ? end.practiceSolves
      : new Set(shared.practised.filter(within).map((solve) => solve.id.replace(/-\d+$/u, ""))).size,
    until,
    fails: shared.fails.filter(within).length,
    billed: end === undefined ? billed : billedParts(events, id).session,
  };
}

export function openSteps(steps: readonly Handover[]): string[] {
  return steps.flatMap((step) => {
    const open = (step.step === "comparison" ? step.reading === null : step.ended === null) && !step.cut;
    return open ? [step.id] : [];
  });
}

export function campaignOf(events: readonly LogEvent[]): Campaign {
  const shared = sharedOf(events);
  const comparisons = new Set<string>();
  const steps = eventsOf(events, STEP_KINDS).flatMap(({ index, event: { kind, data } }): Handover[] => {
    const id = data.session;
    if (!isString(id)) return [];
    if (kind === EXAM_STARTED) return [examStep(events, index, id, shared)];
    if (kind === BUILD_STARTED) return [buildStep(events, index, id, shared)];
    if (comparisons.has(id) || data.ladder === true) return [];
    comparisons.add(id);
    return [compared(events, id, shared, kind === STARTED ? index : -1)];
  });
  return {
    supply: supplyOf(events),
    reference: promoted(events),
    latest: latestBuilt(events),
    steps,
    fails: shared.fails.map(({ started: _started, ...fail }) => fail),
  };
}
