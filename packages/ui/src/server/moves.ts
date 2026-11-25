/**
 * Campaign moves (`campaignOf` steps with log places, times and withheld-aware rulings) and the
 * comparison chart's bars (`ComparisonBar`).
 */
import { nextBound } from "../../../../src/campaign/handover.ts";
import { fixedIn, type Report, reported } from "../../../../src/campaign/comparison.ts";
import {
  carriedBy,
  differenceOf,
  type Measures,
  type Paired,
  pointsOf,
  scoresIn,
  testOf,
} from "../../../../src/kernel/compare.ts";
import { pairsReported } from "../../../../src/kernel/reports.ts";
import { passed, type Ran } from "../../../../src/kernel/solves.ts";
import { isNumber, isString } from "../../../../src/meta/json-shape.ts";
import type { ComparisonBar, LeftOut, Move, Outcome, Share } from "../models.ts";
import { campaignIn, type Log, once, ranIn, reportsIn } from "./folds.ts";
import { rulingsOf } from "./withheld.ts";

type Step = Move["step"];
type ComparisonMove = Extract<Move, { readonly step: "comparison" }>;

/** The events that start and end each step. A comparison stands where the log first holds it, at
 *  its start or its first report, as `campaignOf` reads it. */
const STARTS = new Map<string, Step>([
  ["exam.started", "examiner"],
  ["build.started", "builder"],
  ["comparison.started", "comparison"],
  ["comparison.reported", "comparison"],
]);
const ENDS = new Map<string, Step>([
  ["exam.finished", "examiner"],
  ["build.finished", "builder"],
  ["comparison.reported", "comparison"],
]);

const placesIn = once(({ events }) => {
  const starts = new Map<string, number>();
  const ends = new Map<string, number>();
  for (const [index, { kind, data }] of events.entries()) {
    if (!isString(data.session)) continue;
    const started = STARTS.get(kind);
    if (started !== undefined) {
      const key = `${started} ${data.session}`;
      if (!starts.has(key)) starts.set(key, index);
    }
    const ended = ENDS.get(kind);
    if (ended !== undefined) {
      const key = `${ended} ${data.session}`;
      if (!ends.has(key)) ends.set(key, index);
    }
  }
  return { starts, ends };
});

const STEP_OF = new Map([
  ["examine", "examiner"],
  ["build", "builder"],
  ["compare", "comparison"],
]);

/** What the campaign's command recorded of each step as its move began (a round runs a session and
 *  its comparison under one id): the host's one-minute load, and the table's row. Read from
 *  `campaign.move`, which no fold reads. */
const recordsIn = once(
  ({ events }) =>
    new Map(
      events.flatMap(({ kind, data }) => {
        const step = kind === "campaign.move" && isString(data.move) ? STEP_OF.get(data.move) : undefined;
        if (step === undefined || !isString(data.session)) return [];
        const named = isString(data.code) && isString(data.why) ? { code: data.code, why: data.why } : null;
        return [
          [`${step} ${data.session}`, { load: isNumber(data.load) ? data.load : null, named }] as const,
        ];
      }),
    ),
);

export const movesIn = once((log): Move[] => {
  const { events } = log;
  const { starts, ends } = placesIn(log);
  return campaignIn(log).steps.map((step) => {
    const index = starts.get(`${step.step} ${step.id}`) ?? 0;
    const end = ends.get(`${step.step} ${step.id}`);
    const done = step.step === "comparison" ? step.reading !== null : step.ended !== null;
    const named = recordsIn(log).get(`${step.step} ${step.id}`)?.named ?? null;
    const when = { index, startedAt: events[index]?.at ?? "", named };
    const endedAt = done && end !== undefined ? (events[end]?.at ?? null) : null;
    return step.step === "comparison"
      ? { ...step, rulings: rulingsOf(log, step), ...when, endedAt }
      : { ...step, ...when, endedAt };
  });
});

/** The place a move's record ends at: its end, else the next step's start or the campaign's end
 *  where it was cut (`nextBound`), else the log's last event. */
export function endOf(log: Log, move: Move): number {
  const end = placesIn(log).ends.get(`${move.step} ${move.id}`);
  if (end !== undefined && move.endedAt !== null) return end;
  const bound = nextBound(log.events, move.index);
  return bound === -1 ? log.events.length - 1 : bound - 1;
}

export const pairsIn = once(
  (log) => new Map(reportsIn(log).map((report) => [report.session, pairsReported(log.events, report)])),
);

export const starterIn = once((log): string | null => {
  const first = movesIn(log).find((move) => move.step === "comparison");
  const named = first === undefined ? undefined : fixedIn(log.events, first.id)?.starter;
  const reportedAs = reportsIn(log)[0]?.data.starter;
  return named ?? (isString(reportedAs) ? reportedAs : null);
});

/** What one scored task came to on its score; a tie is split by the reference harness alone. */
export function outcomeOf(pair: Paired): Outcome {
  const difference = differenceOf(pair);
  if (difference !== 0) return difference > 0 ? "won" : "lost";
  const valid = pair.old.filter(Boolean).length;
  if (valid === pair.old.length) return "tiedEvery";
  return valid === 0 ? "tiedNone" : "tiedSome";
}

function carriedIn(pairs: readonly Paired[]): { won: Measures; lost: Measures } {
  const won = { validity: 0, objective: 0 };
  const lost = { ...won };
  for (const pair of pairs) {
    const by = carriedBy(pointsOf(pair));
    if (by === null) continue;
    if (differenceOf(pair) > 0) won[by] += 1;
    else lost[by] += 1;
  }
  return { won, lost };
}

export const shareOf = (side: readonly boolean[]): Share => ({
  valid: side.filter(Boolean).length,
  solves: side.length,
});

function validShare(counts: readonly number[]): Share {
  let [valid, tasks] = [0, 0];
  for (const [solves, many] of counts.entries()) {
    valid += solves * many;
    tasks += many;
  }
  return { valid, solves: tasks * Math.max(0, counts.length - 1) };
}

/** The tally and test of a set's scores as its step reads them: a report of one era also scored the
 *  bill, and drawn with it a comparison that read no step on 3 won, 0 lost, 13 tied would show 13
 *  won, 1 lost, 2 tied. */
export function steppedOf(tested: {
  readonly differences: readonly number[];
  readonly unbilled?: readonly number[];
}) {
  const { wins, losses, ties, p } = testOf(tested.unbilled ?? tested.differences);
  return { tally: { wins, losses, ties }, p };
}

/** A comparison's kind and, for a repeat, the comparison it repeats: a control sets the starter, or
 *  a harness, against the reference; a repeat sets an earlier comparison's two harnesses against
 *  each other again, and repeats the last of those. */
function kindOf(
  move: ComparisonMove,
  starter: string | null,
  earlier: ReadonlyMap<string, string>,
): Pick<ComparisonBar, "kind" | "repeats"> {
  if (move.fresh === starter || move.fresh === move.old) return { kind: "control", repeats: null };
  const repeats = earlier.get(`${move.old} ${move.fresh}`) ?? null;
  return { kind: repeats === null ? "candidate" : "repeat", repeats };
}

const ownSolvesByKey = once((log) => {
  const grouped = Map.groupBy(
    ranIn(log).filter(({ start }) => isString(start.comparison)),
    ({ start, under }) =>
      `${isString(start.comparison) ? start.comparison : ""}\0${under.task}\0${under.harness}`,
  );
  for (const list of grouped.values()) {
    list.sort((one, other) => one.started - other.started);
  }
  return grouped;
});

/** The comparison's own solves of `task` under `harness`, in start order (`solves` caps counted ones). */
export function ownSolves(log: Log, id: string, task: string, harness: string, solves?: number): Ran[] {
  const own = ownSolvesByKey(log).get(`${id}\0${task}\0${harness}`) ?? [];
  return solves === undefined ? own : own.filter((solve) => passed(solve) !== null).slice(0, solves);
}

function reportFieldsOf(move: ComparisonMove, report: Report | null, movePairs: readonly Paired[]) {
  const split = report === null ? null : splitOf(movePairs, report);
  return {
    p: report?.scored == null ? null : steppedOf(report.scored).p,
    outcomes: split?.outcomes ?? null,
    leftOut: split?.leftOut ?? null,
    valid:
      move.valid === null ? null : { old: validShare(move.valid.old), fresh: validShare(move.valid.fresh) },
    noise: report?.noise == null ? null : { ...steppedOf(report.noise), scores: scoresIn(report.noise) },
    carried: report === null ? null : carriedIn(movePairs),
    rulings: move.rulings,
    sets:
      report?.frontier == null || report.retained === null
        ? null
        : {
            frontier: steppedOf(report.frontier),
            retained: report.retained === "unmeasured" ? report.retained : steppedOf(report.retained).tally,
          },
  };
}

/** Every comparison as one bar, ordered by first report (or start when unreported). */
export const barsIn = once((log): ComparisonBar[] => {
  const { events } = log;
  const moves = movesIn(log);
  const reports = new Map(reportsIn(log).map((report) => [report.session, report]));
  const [pairs, records, starter] = [pairsIn(log), recordsIn(log), starterIn(log)];
  const examiners = moves.filter((move) => move.step === "examiner");
  const builders = moves.filter((move) => move.step === "builder");
  const comparisons = moves
    .flatMap((move) => (move.step === "comparison" ? [move] : []))
    .toSorted(
      (one, other) =>
        (reports.get(one.id)?.index ?? one.index) - (reports.get(other.id)?.index ?? other.index) ||
        one.index - other.index,
    );
  const earlier = new Map<string, string>();
  return comparisons.map((move, at) => {
    const kind = kindOf(move, starter, earlier);
    earlier.set(`${move.old} ${move.fresh}`, move.id);
    const before = comparisons[at - 1]?.index ?? -1;
    const between = (list: readonly Move[]) =>
      list.flatMap((each) => (each.index > before && each.index < move.index ? [each.id] : []));
    const setting = fixedIn(events, move.id)?.setting ?? reports.get(move.id)?.data.setting;
    return {
      id: move.id,
      move: move.index,
      old: move.old,
      fresh: move.fresh,
      ...kind,
      setting: isString(setting) ? setting : null,
      level: move.level,
      tasks: move.tasks,
      tally: move.tally,
      reading: move.reading,
      ...reportFieldsOf(move, reported(events, move.id), pairs.get(move.id) ?? []),
      load: records.get(`comparison ${move.id}`)?.load ?? null,
      named: move.named,
      cut: move.cut,
      begun: move.begun,
      solved: move.solved,
      between: { examiner: between(examiners), builder: between(builders) },
    };
  });
});

/** A comparison's tallied tasks by outcome, the tasks set aside for a label, and the rest it fixed
 *  by why its report left them out. Each task counts once, in that order, though the report may
 *  name one in two lists. */
function splitOf(
  pairs: readonly Paired[],
  report: Pick<Report, "scored" | "aside" | "disputed" | "short" | "withdrawn">,
) {
  const counted = new Set(pairs.map(({ task }) => task));
  const take = (tasks: readonly string[]) => {
    let taken = 0;
    for (const task of tasks) {
      if (counted.has(task)) continue;
      counted.add(task);
      taken += 1;
    }
    return taken;
  };
  const outcomes: Record<Outcome, number> = {
    won: 0,
    lost: 0,
    tiedEvery: 0,
    tiedSome: 0,
    tiedNone: 0,
    aside: take(report.aside),
  };
  for (const pair of pairs) outcomes[outcomeOf(pair)] += 1;
  const disputed = take(report.disputed);
  const short = take(report.short);
  const leftOut: LeftOut = { disputed, short, withdrawn: take(report.withdrawn) };
  return { outcomes, leftOut };
}
