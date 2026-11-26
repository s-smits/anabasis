/**
 * What each comparison's reading rests on, a block a comparison:
 *
 *   bun tools/wri/wri.ts reader scores --log <log>
 *
 * The block recounts the report's task scores with this tree's `differenceOf` over the reported pairs
 * and says how many differ, then tallies as scored, on validity alone and on the objective alone,
 * each beside the reference's A/A halves, and counts tasks where every new solve beat every reference
 * solve by at least the floor (`gainOver`, `GAP_FLOOR`). For a step it adds p with each win removed
 * and the wins to spare (`spareOf`). A comparison cut short has no recorded scores and says so.
 */
import { eventsOf, type LogEvent } from "#src/kernel/log.ts";
import {
  differenceOf,
  flipP,
  gainOver,
  gapAgainst,
  type Paired,
  pointsOf,
  GAP_FLOOR,
  isSignificant,
  testOf,
  wholePoints,
} from "#src/kernel/compare.ts";
import { familiesOf } from "#src/kernel/history.ts";
import { lastReports, pairsReported, type Reported, startedComparisons } from "#src/kernel/reports.ts";
import { solvesIn, type Judged, verdictsOf } from "#src/kernel/solves.ts";
import { taskSets } from "#src/kernel/task.ts";
import { asRecord, isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { spareOf } from "./clearance.ts";
import { formatPValue, formatTestSummary, testedOf } from "./promotion.ts";

const LEVEL = 0.02;
const STARTED = "comparison.started";
const UNNAMED = "not recorded";
const EXACTLY = 1e-6;

type Measure = (pair: Paired) => number;
interface ScoreContext {
  readonly family: ReadonlyMap<string, string | null>;
  readonly verdicts: ReadonlyMap<string, Judged>;
  readonly reports: readonly Reported[];
  readonly starts: ReturnType<typeof eventsOf>;
  readonly taskEvents: ReturnType<typeof eventsOf>;
}
const MEASURES: readonly (readonly [string, Measure])[] = [
  ["recounted", differenceOf],
  ["validity alone", (pair) => wholePoints(pointsOf(pair).validity)],
  ["objective alone", (pair) => wholePoints(pointsOf(pair).objective)],
];

function tallied(scores: readonly number[]): string {
  const { wins, losses, ties, p } = testOf(scores);
  return `${String(wins)}-${String(losses)}-${String(ties)} p ${formatPValue(p)}`;
}

function beatsAll(pair: Paired): boolean {
  const rule = pair.objective;
  return pair.fresh.every((freshValid, f) =>
    pair.old.every((oldValid, o) => {
      if (freshValid !== oldValid) return freshValid;
      return freshValid && rule !== undefined && gainOver(rule, rule.fresh[f], rule.old[o]) >= GAP_FLOOR;
    }),
  );
}

function recountOf(
  report: JsonObject,
  pairs: readonly Paired[],
): { tested: Paired[]; recorded: number[]; unmatched: number; differing: number } {
  const { differences, of } = testedOf(report);
  const byTask = new Map(pairs.map((pair) => [pair.task, pair]));
  const tested: Paired[] = [];
  const recorded: number[] = [];
  let unmatched = 0;
  for (const [at, difference] of differences.entries()) {
    const pair = of[at] === undefined ? undefined : byTask.get(of[at] ?? "");
    if (pair === undefined) unmatched += 1;
    else {
      tested.push(pair);
      recorded.push(difference);
    }
  }
  const differing = tested.filter((pair, at) => differenceOf(pair) !== recorded[at]).length;
  return { tested, recorded, unmatched, differing };
}

function withoutEach(scores: readonly number[], level: number): string {
  const wins = scores.flatMap((score, at) => (score > 0 ? [at] : []));
  if (wins.length === 0) return "no win to remove";
  const ps = wins.map((at) => flipP(scores.filter((_, other) => other !== at)));
  const losing = ps.filter((p) => p > level).length;
  return `p from ${formatPValue(Math.min(...ps))} to ${formatPValue(Math.max(...ps))}; ${String(losing)} of ${String(wins.length)} single removals lose the step`;
}

function stepLines(scores: readonly number[], level: number): string[] {
  const spare = spareOf(scores, level);
  const wins = scores.filter((score) => score > 0).length;
  return [
    `  without each win: ${withoutEach(scores, level)}`,
    `  wins to spare, largest first (spareOf): ${String(spare)}; the step is lost once the ${String(Math.min(spare + 1, wins))} largest are removed`,
  ];
}

/** The scores by whether a task of the same family was released for practice before the comparison began. */
function practisedLines(
  { family, reports, starts, taskEvents }: ScoreContext,
  { session, index }: Reported,
  tested: readonly Paired[],
  scores: readonly number[],
): string[] {
  const began =
    starts.findLast(({ index: at, event }) => at < index && event.data.session === session)?.index ?? -1;
  const cut = began === -1 ? index : began;
  const practised = new Set(
    taskSets(taskEvents.flatMap(({ index: at, event }) => (at < cut ? [event] : []))).released.map(
      (version) => family.get(version),
    ),
  );
  const split = (counted: (task: string) => boolean) => {
    const [kin, none] = [true, false].map((wanted) =>
      scores.filter((_, at) => {
        const task = tested[at]?.task ?? "";
        const named = family.get(task) ?? null;
        return counted(task) && (named !== null && practised.has(named)) === wanted;
      }),
    );
    return `a task of the family was practice before the start ${tallied(kin ?? [])}; none was ${tallied(none ?? [])}`;
  };
  const before = new Set(
    reports.filter((report) => report.index < index).flatMap(({ data }) => testedOf(data).of),
  );
  const first = (task: string) => !before.has(task);
  return [
    `  by practice: ${split(() => true)}`,
    `  first tested here, ${String(tested.filter(({ task }) => first(task)).length)} of ${String(tested.length)} tasks: ${split(first)}`,
  ];
}

/** A summary of byte-identical answers and repeated objective measures over `pairs`. */
function repeatLine(pairs: readonly Paired[], verdicts: ReadonlyMap<string, Judged>): string | null {
  const tally = () => ({ same: 0, of: 0, exact: 0, near: 0, measured: 0 });
  const [fresh, old] = [tally(), tally()];
  let [acrossSame, acrossOf] = [0, 0];
  const validDigests = (solves: readonly string[] | undefined, valid: readonly boolean[]) => {
    const held = (solves ?? []).flatMap((solve) => {
      const answer = verdicts.get(solve)?.answer;
      return answer === undefined ? [] : [hashJsonValue(answer)];
    });
    return held.length >= 2 && held.length === valid.length && valid.every(Boolean) ? held : null;
  };
  const tickSide = (into: ReturnType<typeof tally>, pair: Paired, side: "old" | "fresh") => {
    const digests = validDigests(pair.solves?.[side], pair[side]);
    if (digests !== null) {
      into.of += 1;
      if (new Set(digests).size === 1) into.same += 1;
    }
    const measures = pair.objective?.[side].filter(isNumber) ?? [];
    if (measures.length >= 2 && measures.length === pair[side].length) {
      into.measured += 1;
      if (Math.max(...measures) - Math.min(...measures) <= EXACTLY) into.exact += 1;
      if (!gapAgainst(pair, side, [])) into.near += 1;
    }
    return digests;
  };
  for (const pair of pairs) {
    const newer = tickSide(fresh, pair, "fresh");
    const older = tickSide(old, pair, "old");
    if (newer !== null && older !== null) {
      acrossOf += 1;
      if (new Set([...newer, ...older]).size === 1) acrossSame += 1;
    }
  }
  if (fresh.of === 0 && old.of === 0 && fresh.measured === 0 && old.measured === 0) return null;
  const obj =
    fresh.measured === 0 && old.measured === 0
      ? ""
      : `; objective exact/near new ${String(fresh.exact)}/${String(fresh.near)} of ${String(fresh.measured)}, ref ${String(old.exact)}/${String(old.near)} of ${String(old.measured)}`;
  return `repeat: identical answer new ${String(fresh.same)}/${String(fresh.of)}, ref ${String(old.same)}/${String(old.of)}, across ${String(acrossSame)}/${String(acrossOf)}${obj}`;
}

function reportedLines(events: readonly LogEvent[], report: Reported, ctx: ScoreContext): string[] {
  const { data, session } = report;
  const level = isNumber(data.level) ? data.level : LEVEL;
  const reading = isString(data.reading) ? data.reading : UNNAMED;
  const head = `${session}: ${reading}, level ${String(level)}${isNumber(data.level) ? "" : " (not recorded; the default)"}`;
  const { differences } = testedOf(data);
  if (data.scored === null || differences.length === 0) {
    return [head, `  recorded: ${formatTestSummary(data.scored)}; no task scores recorded, so no recount`];
  }
  const pairs = pairsReported(events, report);
  const { tested, recorded, unmatched, differing } = recountOf(data, pairs);
  const halves = pairsReported(events, report, "old");
  const aa = (measure: Measure) => (halves.length === 0 ? "not recorded" : tallied(halves.map(measure)));
  const noise = asRecord(data.noise)?.differences;
  const noted = Array.isArray(noise) ? noise.filter(isNumber) : [];
  const aaDiffering =
    noted.length === halves.length
      ? `${String(halves.filter((pair, at) => differenceOf(pair) !== noted[at]).length)} of ${String(halves.length)} A/A scores differ from the report's, by position (its A/A names no task; a report written before the mirrored split ran on from task to task split otherwise, pairsReported)`
      : `the report's A/A holds ${String(noted.length)} scores and this tree's halves ${String(halves.length)}`;
  const [validityMeasure, objectiveMeasure] = [MEASURES[1]?.[1], MEASURES[2]?.[1]];
  const valTally = validityMeasure === undefined ? "none" : tallied(tested.map(validityMeasure));
  const objTally = objectiveMeasure === undefined ? "none" : tallied(tested.map(objectiveMeasure));
  const step = isSignificant(recorded, level);
  const sparePart = step ? `; spare ${String(spareOf(recorded, level))} wins` : "";
  const repeat = repeatLine(pairs, ctx.verdicts);
  const lines = [
    `${head} · validity ${valTally} · objective ${objTally} · A/A ${formatTestSummary(data.noise)}${sparePart}`,
    `  recorded: ${tallied(differences)} over ${String(differences.length)} tested tasks; the report's A/A ${formatTestSummary(data.noise)}`,
    `  recount: ${String(differing)} of ${String(tested.length)} tasks matched by task (${String(unmatched)} unmatched) score otherwise in this tree than the report recorded; the recorded tally and the step lines read the record, the tallies by measure read the recount`,
    `  ${aaDiffering}`,
    ...MEASURES.map(
      ([name, measure]) => `  ${name}: ${tallied(tested.map(measure))}; A/A halves ${aa(measure)}`,
    ),
    ...(repeat === null ? [] : [`  ${repeat}`]),
    `  every new solve beat every reference solve: ${String(tested.filter(beatsAll).length)} of ${String(tested.length)} tasks`,
    ...practisedLines(ctx, report, tested, recorded),
  ];
  return step ? [...lines, ...stepLines(recorded, level)] : lines;
}

function absentLines(solves: ReturnType<typeof solvesIn>, session: string): string[] {
  const begun = solves.filter(({ start }) => start.comparison === session);
  const ended = begun.filter(({ finished }) => finished !== null).length;
  return [
    `${session}: report absent (cut short or still open); nothing is recounted`,
    `  solves begun ${String(begun.length)}, ended ${String(ended)}`,
  ];
}

export function scoreRows(events: readonly LogEvent[]): string[] {
  const allReports = lastReports(events);
  const reports = new Map(allReports.map((report) => [report.session, report]));
  const sessions = [...new Set([...startedComparisons(events), ...reports.keys()])];
  if (sessions.length === 0) return ["scores: no comparison on record"];
  const ctx: ScoreContext = {
    family: familiesOf(events),
    verdicts: verdictsOf(events),
    reports: allReports,
    starts: eventsOf(events, STARTED),
    taskEvents: eventsOf(events, ["task.proposed", "task.gate", "task.state"]),
  };
  let solves: ReturnType<typeof solvesIn> | undefined;
  return [
    "scores (lane 6): each comparison's task scores recounted by this tree's differenceOf, measure splits, A/A halves, answer/objective repetition, practised-family split, and step sensitivity.",
    ...sessions.flatMap((session) => {
      const report = reports.get(session);
      if (report === undefined || asRecord(report.data) === null) {
        solves ??= solvesIn(events);
        return absentLines(solves, session);
      }
      return reportedLines(events, report, ctx);
    }),
  ];
}
