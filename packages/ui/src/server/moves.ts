/**
 * The campaign's moves and its comparisons as the page draws them: each step of `campaignOf` with
 * where it stands in the log, and each comparison as one bar of the main chart.
 *
 * A move is a step's handover passed through whole, with three fields the handover does not hold:
 * the place of its start in the log, which names it (a round runs a Builder session and the
 * comparison after it under one id), and the times of its start and its end; a comparison's rulings
 * by kind go only where none of them is withheld (`rulingsOf`, `withheld.ts`). A comparison's bar
 * takes its tally, its reading, its valid counts, its rulings and its cost from the same handover,
 * its terms from its start (`fixedIn`), its test and its A/A reading from its last report
 * (`reported`), its tasks by outcome from the pairs that report tallied (`pairsReported`,
 * `pairings`), so that a bar's counts sum to the handover's tally by construction, and the rest of
 * the tasks it fixed from the lists the report names them in (`aside`, `disputed`, `short`,
 * `withdrawn`), so that the parts sum to the tasks it fixed.
 */
import { nextBound } from "../../../../src/campaign/handover.ts";
import { fixedIn, type Report, reported } from "../../../../src/campaign/comparison.ts";
import type { Share } from "../../../../src/campaign/climb.ts";
import { differenceOf, type Paired } from "../../../../src/kernel/compare.ts";
import { pairsReported } from "../../../../src/kernel/reports.ts";
import { isNumber, isString } from "../../../../src/meta/json-shape.ts";
import type { ComparisonBar, LeftOut, Move, Outcome, Tally } from "../models.ts";
import { campaignIn, type Log, once, reportsIn } from "./folds.ts";
import { rulingsOf } from "./withheld.ts";

type Step = Move["step"];
type ComparisonMove = Extract<Move, { readonly step: "comparison" }>;

/** The events that start a step, and those that end one, by the step they belong to. A comparison
 *  stands where the log first holds it, at its start or its first report, as `campaignOf` reads it. */
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

/** Where each step first starts and first ends in the log, by its kind and its id. Derived: the
 *  places of the events `campaignOf` bounds a step by, read by kind and id alone. */
const placesIn = once(({ events }) => {
  const starts = new Map<string, number>();
  const ends = new Map<string, number>();
  for (const [index, { kind, data }] of events.entries()) {
    if (!isString(data.session)) continue;
    const started = STARTS.get(kind);
    const ended = ENDS.get(kind);
    const startKey = `${started ?? ""} ${data.session}`;
    if (started !== undefined && !starts.has(startKey)) starts.set(startKey, index);
    const endKey = `${ended ?? ""} ${data.session}`;
    if (ended !== undefined && !ends.has(endKey)) ends.set(endKey, index);
  }
  return { starts, ends };
});

/** The step a recorded move of the campaign's command runs, for the three that run one. */
const STEP_OF = new Map([
  ["examine", "examiner"],
  ["build", "builder"],
  ["compare", "comparison"],
]);

/** What the campaign's command recorded of each step as its move began, by the step and its id
 *  (a round runs a Builder session and its comparison under one id): the host's one-minute load,
 *  and the table's row the move was made by. Read from `campaign.move`, which no fold reads. */
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

/** Every step of `campaignOf`, in the order they started, with where and when. */
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

/** The place in the log a move's record ends at: its end, else the next step's start or the
 *  campaign's end where it was cut (`nextBound`), else the log's last event. */
export function endOf(log: Log, move: Move): number {
  const end = placesIn(log).ends.get(`${move.step} ${move.id}`);
  if (end !== undefined && move.endedAt !== null) return end;
  const bound = nextBound(log.events, move.index);
  return bound === -1 ? log.events.length - 1 : bound - 1;
}

/** The pairs each comparison's last report tallied, by its id (`pairsReported`). */
export const pairsIn = once(
  (log) => new Map(reportsIn(log).map((report) => [report.session, pairsReported(log.events, report)])),
);

/** The Starter Built Harness by digest, as the first comparison names it, or null before any. */
export const starterIn = once((log): string | null => {
  const first = movesIn(log).find((move) => move.step === "comparison");
  const named = first === undefined ? undefined : fixedIn(log.events, first.id)?.starter;
  const reportedAs = reportsIn(log)[0]?.data.starter;
  return named ?? (isString(reportedAs) ? reportedAs : null);
});

/** What one scored task came to. A tie is split by the reference harness (the old side) alone. */
export function outcomeOf(pair: Paired): Outcome {
  const difference = differenceOf(pair);
  if (difference !== 0) return difference > 0 ? "won" : "lost";
  const valid = pair.old.filter(Boolean).length;
  if (valid === pair.old.length) return "tiedEvery";
  return valid === 0 ? "tiedNone" : "tiedSome";
}

/** A side's valid answers over its solves on one task. */
export const shareOf = (side: readonly boolean[]): Share => ({
  valid: side.filter(Boolean).length,
  solves: side.length,
});

/** The handover's count of tasks by valid solves, read as valid answers over solves. */
function validShare(counts: readonly number[]): Share {
  let [valid, tasks] = [0, 0];
  for (const [solves, many] of counts.entries()) {
    valid += solves * many;
    tasks += many;
  }
  return { valid, solves: tasks * Math.max(0, counts.length - 1) };
}

/** The three counts of a tally that carries more. */
const tallyOf = ({ wins, losses, ties }: Tally): Tally => ({ wins, losses, ties });

/** A comparison's kind and, for a repeat, the comparison it repeats: a control sets the starter,
 *  or a harness, against the reference; a repeat sets the same two harnesses as an earlier
 *  comparison against each other again, and repeats the last of those. Derived from the handovers'
 *  harnesses in the chart's order. */
function kindOf(
  move: ComparisonMove,
  starter: string | null,
  earlier: ReadonlyMap<string, string>,
): Pick<ComparisonBar, "kind" | "repeats"> {
  if (move.fresh === starter || move.fresh === move.old) return { kind: "control", repeats: null };
  const repeats = earlier.get(`${move.old} ${move.fresh}`) ?? null;
  return { kind: repeats === null ? "candidate" : "repeat", repeats };
}

/** Every comparison as one bar, in the order they first reported; one with no report stands where
 *  it began, so that a comparison cut before its report keeps its place among the others and one
 *  still open is the last. */
export const barsIn = once((log): ComparisonBar[] => {
  const { events } = log;
  const moves = movesIn(log);
  const reports = new Map(reportsIn(log).map((report) => [report.session, report]));
  const pairs = pairsIn(log);
  const records = recordsIn(log);
  const starter = starterIn(log);
  const comparisons = moves
    .flatMap((move) => (move.step === "comparison" ? [move] : []))
    .toSorted(
      (one, other) =>
        (reports.get(one.id)?.index ?? one.index) - (reports.get(other.id)?.index ?? other.index) ||
        one.index - other.index,
    );
  const earlier = new Map<string, string>();
  return comparisons.map((move, at) => {
    const report = reported(events, move.id);
    const split = report === null ? null : splitOf(pairs.get(move.id) ?? [], report);
    const kind = kindOf(move, starter, earlier);
    earlier.set(`${move.old} ${move.fresh}`, move.id);
    const before = comparisons[at - 1]?.index ?? -1;
    const between = (step: "examiner" | "builder") =>
      moves.flatMap((each) =>
        each.step === step && each.index > before && each.index < move.index ? [each.id] : [],
      );
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
      p: report?.scored?.p ?? null,
      outcomes: split?.outcomes ?? null,
      leftOut: split?.leftOut ?? null,
      valid:
        move.valid === null ? null : { old: validShare(move.valid.old), fresh: validShare(move.valid.fresh) },
      noise:
        report?.noise == null
          ? null
          : {
              tally: tallyOf(report.noise),
              p: report.noise.p,
              differences: report.noise.differences,
            },
      rulings: move.rulings,
      sets:
        report?.frontier == null || report.retained === null
          ? null
          : {
              frontier: { tally: tallyOf(report.frontier), p: report.frontier.p },
              retained: report.retained === "unmeasured" ? report.retained : tallyOf(report.retained),
            },
      load: records.get(`comparison ${move.id}`)?.load ?? null,
      named: move.named,
      cut: move.cut,
      begun: move.begun,
      solved: move.solved,
      between: { examiner: between("examiner"), builder: between("builder") },
    };
  });
});

/** A comparison's tallied tasks by outcome, the tasks it set aside for a person's label, and the
 *  rest of the tasks it fixed by why its report left them out. Each task counts once, in that order:
 *  a task can be both set aside and short of its solves, and the report names it in both lists. */
function splitOf(
  pairs: readonly Paired[],
  report: Pick<Report, "aside" | "disputed" | "short" | "withdrawn">,
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
