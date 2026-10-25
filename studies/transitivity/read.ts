/**
 * The transitivity study's reading of its comparisons (`studies/transitivity/README.md`): each
 * tallied task's score without the bill and as the tree scores it, for the frontier and the
 * retained set apart and together, with the one-sided paired sign-flip test on each, and the
 * tallied tasks counted by the epoch each was held out in.
 *
 *   bun studies/transitivity/read.ts --log <campaign folder>/log.jsonl --id <comparison> [--id ...]
 *
 * The study's predictions are read on the frontier alone and without the bill (README,
 * "Predictions"), and no reader gave that on 25 October: a report tests the frontier and the
 * retained set together with the bill, and the promotion tuner weighs a reading again but tests the
 * two sets together and leaves seeds out (`.claude/skills/promotion-tuner/scripts/tree.ts`), while
 * the study's comparisons run on seeds. Every fact here is a production owner's: the pairs
 * (`pairsReported`), each task's points by measure (`pointsOf`) and their rounding (`wholePoints`),
 * the test (`flipP`), the A/A's reading (`readsStepEitherWay`) and the epochs (`tasksByEpoch`).
 * Two comparisons drawn from one log read the same scored set where their `set` digests agree:
 * the digest of the tasks their starts fixed, sorted.
 * Without the bill a task's score is its validity and objective points, the tuner's
 * `--weights 60,30,0`.
 *
 * As a check on itself it scores each set again with the bill and says whether that matches the
 * differences the report stored, which it must at the weights that wrote them. Over the seven
 * comparisons of buffer-fresh-opus-v065-a on 25 October it matched all fourteen sets.
 *
 * It prints counts, digests and comparison ids, never a task's content, answer or measure: the log
 * is on the exam side (AGENTS.md, section 5).
 */
import { tasksByEpoch } from "#src/campaign/climb.ts";
import {
  flipP,
  type Paired,
  pointsOf,
  readsStepEitherWay,
  UNMEASURED,
  wholePoints,
} from "#src/kernel/compare.ts";
import { read } from "#src/kernel/log.ts";
import { lastReports, pairsReported } from "#src/kernel/reports.ts";
import { asRecord, isNumber, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { parseArgs } from "#src/meta/process.ts";
import { compareCodeUnits, hashJsonValue } from "#src/meta/stable-json.ts";

/** One tallied task: the epoch it was held out in, and its score without the bill and with it. */
interface Scored {
  readonly epoch: number;
  readonly bare: number;
  readonly billed: number;
}

/** A digest as the study's lines print it. */
const SHORT = 8;

/** Wins, losses and ties of `scores`, as W-L-T. */
function wlt(scores: readonly number[]): string {
  const count = (sign: number) => String(scores.filter((one) => Math.sign(one) === sign).length);
  return `${count(1)}-${count(-1)}-${count(0)}`;
}

/** W-L-T of `scores`, the untied count, and the test's p for the new harness. */
function tallyLine(scores: readonly number[]): string {
  const untied = scores.filter((one) => one !== 0).length;
  return `${wlt(scores)}, untied ${String(untied)}, p ${flipP(scores).toFixed(4)}`;
}

/** The tasks a report's set tallied, in the order of its differences, each scored again. */
function scoredIn(
  set: JsonValue | undefined,
  pairs: ReadonlyMap<string, Paired>,
  epochOf: ReadonlyMap<string, number>,
): Scored[] {
  const of = asRecord(set)?.of;
  if (!Array.isArray(of)) return [];
  return of.filter(isString).map((task) => {
    const pair = pairs.get(task);
    if (pair === undefined) {
      throw new Error(`task ${task} is tallied in the report and has no pair in the log`);
    }
    const { validity, objective, bill } = pointsOf(pair);
    return {
      epoch: epochOf.get(task) ?? 0,
      bare: wholePoints(validity + objective),
      billed: wholePoints(validity + objective + bill),
    };
  });
}

/** Whether the scores with the bill are the differences `set` stored. */
function asStored(set: JsonValue | undefined, scored: readonly Scored[]): boolean {
  const stored = asRecord(set)?.differences;
  const differences = Array.isArray(stored) ? stored.filter(isNumber) : [];
  return differences.length === scored.length && scored.every(({ billed }, at) => billed === differences[at]);
}

/** The lines of one comparison's reading. */
function readingOf(log: string, id: string): string[] {
  const events = read(log);
  const report = lastReports(events).find(({ session }) => session === id);
  if (report === undefined) throw new Error(`${log} holds no report of comparison ${id}`);
  const { data } = report;
  const pairs = new Map(pairsReported(events, report).map((pair) => [pair.task, pair]));
  const epochOf = new Map(
    tasksByEpoch(events).flatMap((tasks, at) => tasks.map((task) => [task, at + 1] as const)),
  );
  const frontier = scoredIn(data.frontier, pairs, epochOf);
  const retained = data.retained === UNMEASURED ? [] : scoredIn(data.retained, pairs, epochOf);
  const both = [...frontier, ...retained];
  const epochs = [...new Set(both.map(({ epoch }) => epoch))].toSorted((one, other) => one - other);
  const noise = asRecord(data.noise)?.differences;
  const level = isNumber(data.level) ? data.level : Number.NaN;
  const named = (value: JsonValue | undefined) => (isString(value) ? value : "?");
  const fixed = [data.frontier, data.retained].flatMap((set) => {
    const tasks = asRecord(set)?.tasks;
    return Array.isArray(tasks) ? tasks.filter(isString) : [];
  });
  const within = (set: readonly Scored[], epoch: number) =>
    set.filter((one) => one.epoch === epoch).map(({ bare }) => bare);
  return [
    `${id}: ${named(data.old).slice(0, SHORT)} (old) against ${named(data.fresh).slice(0, SHORT)} (new), level ${String(level)}, reading as recorded ${named(data.reading)}, set ${hashJsonValue(fixed.toSorted(compareCodeUnits)).slice(0, SHORT)} of ${String(fixed.length)} tasks`,
    `  frontier without the bill  ${tallyLine(frontier.map(({ bare }) => bare))}`,
    `  retained without the bill  ${tallyLine(retained.map(({ bare }) => bare))}`,
    `  together without the bill  ${tallyLine(both.map(({ bare }) => bare))}`,
    `  frontier with the bill     ${tallyLine(frontier.map(({ billed }) => billed))}`,
    `  together with the bill     ${tallyLine(both.map(({ billed }) => billed))}`,
    `  by epoch, without the bill (frontier | retained): ${epochs
      .map((epoch) => `e${String(epoch)} ${wlt(within(frontier, epoch))} | ${wlt(within(retained, epoch))}`)
      .join(", ")}`,
    `  A/A as stored, with the bill: ${Array.isArray(noise) && readsStepEitherWay(noise.filter(isNumber), level) ? "reads a step either way" : "reads no step either way"}`,
    `  with the bill, as the report stored it: frontier ${asStored(data.frontier, frontier) ? "yes" : "NO"}, retained ${data.retained === UNMEASURED || asStored(data.retained, retained) ? "yes" : "NO"}`,
  ];
}

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { log: { type: "string" }, id: { type: "string", multiple: true } },
});
if (values.log === undefined || values.id === undefined) {
  throw new Error("usage: bun studies/transitivity/read.ts --log <log.jsonl> --id <comparison> [--id ...]");
}
for (const id of values.id) console.log(readingOf(values.log, id).join("\n"));
