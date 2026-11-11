/**
 * What each comparison's reading rests on, a block a comparison, for lanes 8 and 17:
 *
 *   bun tools/wri/wri.ts reader scores --log <log>
 *
 * The block recounts the report's task scores with this tree's `differenceOf` over the pairs the
 * report made (`pairsReported`), matched to the recorded scores by task (`testedOf().of`), and says
 * how many differ. It then gives three tallies: as scored, on validity alone and on the objective
 * alone, each beside the same three of the reference's A/A halves. It counts the tasks on which every
 * new solve beat every reference solve: valid against invalid, or by the objective by at least the
 * gap floor (`gainOver`, `ROOM`).
 *
 * For a step it adds:
 * - p with each win removed;
 * - the wins to spare and the fewest whose removal loses the step (`spareOf`, `clearance.ts`);
 * - the tally by the Examiner session that wrote each task and by its family.
 *
 * A comparison cut short or left open has no recorded scores. Its block counts the solves it began
 * and says the report is absent. The task by task table is `pairs.ts`'s.
 *
 * Evidence: 9 of 12 lane-17 sessions between 3 and 10 November recomputed a step's p by hand without
 * one win and then without two. 4 of 7 lane-8 sessions split a tally by measure in their own
 * scripts, and two of those disagreed on one comparison: one counted the objective where both
 * answers were valid, the other everywhere.
 */
import type { LogEvent } from "#src/kernel/log.ts";
import {
  differenceOf,
  flipP,
  gainOver,
  type Paired,
  pointsOf,
  ROOM,
  readsStep,
  testOf,
  wholePoints,
} from "#src/kernel/compare.ts";
import { proposalsOf } from "#src/kernel/history.ts";
import { lastReports, pairsReported, type Reported } from "#src/kernel/reports.ts";
import { solvesIn } from "#src/kernel/solves.ts";
import { asRecord, isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { spareOf } from "./clearance.ts";
import { pSaid, testedOf, testSaid } from "./promotion.ts";

const LEVEL = 0.02;
const STARTED = "comparison.started";
const UNNAMED = "not recorded";

type Measure = (pair: Paired) => number;
const MEASURES: readonly (readonly [string, Measure])[] = [
  ["recounted", differenceOf],
  ["validity alone", (pair) => wholePoints(pointsOf(pair).validity)],
  ["objective alone", (pair) => wholePoints(pointsOf(pair).objective)],
];

/** `w-l-t p` of `scores`. */
function tallied(scores: readonly number[]): string {
  const { wins, losses, ties, p } = testOf(scores);
  return `${String(wins)}-${String(losses)}-${String(ties)} p ${pSaid(p)}`;
}

/** Whether every new solve of `pair` beat every reference solve: valid against invalid, or both
 *  valid and the new answer better by the objective by the gap floor at least. */
export function beatsAll(pair: Paired): boolean {
  const rule = pair.objective;
  return pair.fresh.every((freshValid, f) =>
    pair.old.every((oldValid, o) => {
      if (freshValid !== oldValid) return freshValid;
      return freshValid && rule !== undefined && gainOver(rule, rule.fresh[f], rule.old[o]) >= ROOM;
    }),
  );
}

/** The recount against the record: the pairs on the tested tasks, and how many scores differ. */
export function recountOf(
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

/** p with each win removed in turn, as its least and most, and how many removals lose the step. */
function withoutEach(scores: readonly number[], level: number): string {
  const wins = scores.flatMap((score, at) => (score > 0 ? [at] : []));
  if (wins.length === 0) return "no win to remove";
  const ps = wins.map((at) => flipP(scores.filter((_, other) => other !== at)));
  const losing = ps.filter((p) => p > level).length;
  return `p from ${pSaid(Math.min(...ps))} to ${pSaid(Math.max(...ps))}; ${String(losing)} of ${String(wins.length)} single removals lose the step`;
}

/** The tally of `tested` by a key of each task: its writing session or its family. */
function tallyBy(
  tested: readonly Paired[],
  scores: readonly number[],
  keyOf: (task: string) => string,
): string {
  const groups = Map.groupBy(
    scores.map((score, at) => ({ score, key: keyOf(tested[at]?.task ?? "") })),
    ({ key }) => key,
  );
  const sorted = [...groups].toSorted(([one], [other]) => one.localeCompare(other));
  const alone = sorted.filter(([, rows]) => rows.length === 1).flatMap(([, rows]) => rows);
  return [
    ...sorted
      .filter(([, rows]) => rows.length > 1)
      .map(([key, rows]) => `${key} ${tallied(rows.map(({ score }) => score))}`),
    ...(alone.length === 0
      ? []
      : [`${String(alone.length)} of one task each ${tallied(alone.map(({ score }) => score))}`]),
  ].join("; ");
}

/** A step's extra lines: removals, spare wins and the tally by writer and family. */
function stepLines(
  events: readonly LogEvent[],
  tested: readonly Paired[],
  scores: readonly number[],
  level: number,
): string[] {
  const proposals = new Map(proposalsOf(events).map((each) => [each.version, each]));
  const spare = spareOf(scores, level);
  const wins = scores.filter((score) => score > 0).length;
  return [
    `  without each win: ${withoutEach(scores, level)}`,
    `  wins to spare, largest first (spareOf): ${String(spare)}; the step is lost once the ${String(Math.min(spare + 1, wins))} largest are removed`,
    `  by writer: ${tallyBy(tested, scores, (task) => proposals.get(task)?.session ?? UNNAMED)}`,
    `  by family: ${tallyBy(tested, scores, (task) => {
      const family = proposals.get(task)?.family;
      return isString(family) ? family : UNNAMED;
    })}`,
  ];
}

/** The block of one reported comparison. */
function reportedLines(events: readonly LogEvent[], report: Reported): string[] {
  const { data, session } = report;
  const level = isNumber(data.level) ? data.level : LEVEL;
  const reading = isString(data.reading) ? data.reading : UNNAMED;
  const head = `${session}: ${reading}, level ${String(level)}${isNumber(data.level) ? "" : " (not recorded; the default)"}`;
  const { differences } = testedOf(data);
  if (data.scored === null || differences.length === 0) {
    return [head, `  recorded: ${testSaid(data.scored)}; no task scores recorded, so no recount`];
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
  const lines = [
    head,
    `  recorded: ${tallied(differences)} over ${String(differences.length)} tested tasks; the report's A/A ${testSaid(data.noise)}`,
    `  recount: ${String(differing)} of ${String(tested.length)} tasks matched by task (${String(unmatched)} unmatched) score otherwise in this tree than the report recorded; the recorded tally and the step lines read the record, the tallies by measure read the recount`,
    `  ${aaDiffering}`,
    ...MEASURES.map(
      ([name, measure]) => `  ${name}: ${tallied(tested.map(measure))}; A/A halves ${aa(measure)}`,
    ),
    `  every new solve beat every reference solve: ${String(tested.filter(beatsAll).length)} of ${String(tested.length)} tasks`,
  ];
  return readsStep(recorded, level) ? [...lines, ...stepLines(events, tested, recorded, level)] : lines;
}

/** The block of a comparison begun with no report: the solves it began, by harness, and how many ended. */
function absentLines(events: readonly LogEvent[], session: string): string[] {
  const begun = solvesIn(events).filter(({ start }) => start.comparison === session);
  const ended = begun.filter(({ finished }) => finished !== null).length;
  return [
    `${session}: report absent (cut short or still open); nothing is recounted`,
    `  solves begun ${String(begun.length)}, ended ${String(ended)}`,
  ];
}

/** Each comparison's block, in the order the log began them. */
export function scoreRows(events: readonly LogEvent[]): string[] {
  const reports = new Map(lastReports(events).map((report) => [report.session, report]));
  const sessions = [
    ...new Set([
      ...events.flatMap(({ kind, data }) =>
        kind === STARTED && isString(data.session) ? [data.session] : [],
      ),
      ...reports.keys(),
    ]),
  ];
  if (sessions.length === 0) return ["scores: no comparison on record"];
  return [
    "scores (lanes 8, 17): each comparison's task scores recounted by this tree's differenceOf and matched to the report's by task; tallies are wins-losses-ties and the one-sided sign-flip p.",
    ...sessions.flatMap((session) => {
      const report = reports.get(session);
      return report === undefined || asRecord(report.data) === null
        ? absentLines(events, session)
        : reportedLines(events, report);
    }),
  ];
}
