/**
 * The transitivity study's reading of its comparisons (`studies/transitivity/README.md`): each
 * tallied task's score without the bill and as the tree scores it, for the frontier and retained
 * sets apart and together, with the one-sided paired sign-flip test on each, and tasks counted by
 * the epoch each was held out in. Run `bun studies/transitivity/read.ts --log <campaign
 * folder>/log.jsonl --id <comparison> [--id ...]`. The study's predictions are read on the frontier
 * alone and without the bill, which no other reader gives. Every fact is a production owner's:
 * `pairsReported`, `differenceOf`, `flipP`, `readsStepEitherWay` and `tasksByEpoch`. The scores
 * with the bill are the differences the report stored, since the tree no longer scores the bill. It
 * prints counts, digests and comparison ids, never a task's content, answer or measure: the log is
 * on the exam side (AGENTS.md, section 5).
 */
import { tasksByEpoch } from "#src/campaign/climb.ts";
import { fixedIn } from "#src/campaign/comparison.ts";
import { differenceOf, flipP, type Paired, readsStepEitherWay, UNMEASURED } from "#src/kernel/compare.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { lastReports, pairsReported } from "#src/kernel/reports.ts";
import { asRecord, isNumber, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { parseArgs } from "#src/meta/process.ts";
import { compareCodeUnits, hashJsonValue } from "#src/meta/stable-json.ts";

interface Scored {
  readonly epoch: number;
  readonly bare: number;
  readonly billed: number;
}

const SHORT = 8;

function wlt(scores: readonly number[]): string {
  const count = (sign: number) => String(scores.filter((one) => Math.sign(one) === sign).length);
  return `${count(1)}-${count(-1)}-${count(0)}`;
}

function tallyLine(scores: readonly number[]): string {
  const untied = scores.filter((one) => one !== 0).length;
  return `${wlt(scores)}, untied ${String(untied)}, p ${flipP(scores).toFixed(4)}`;
}

/** A set's tasks in the order of its differences, each scored again without the bill and with the
 *  bill as stored. */
function scoredIn(
  set: JsonValue | undefined,
  pairs: ReadonlyMap<string, Paired>,
  epochOf: ReadonlyMap<string, number>,
): Scored[] {
  const of = asRecord(set)?.of;
  if (!Array.isArray(of)) return [];
  const stored = asRecord(set)?.differences;
  const billed = Array.isArray(stored) ? stored : [];
  return of.filter(isString).map((task, at) => {
    const pair = pairs.get(task);
    if (pair === undefined) {
      throw new Error(`task ${task} is tallied in the report and has no pair in the log`);
    }
    return {
      epoch: epochOf.get(task) ?? 0,
      bare: differenceOf(pair),
      billed: isNumber(billed[at]) ? billed[at] : Number.NaN,
    };
  });
}

function readingOf(events: readonly LogEvent[], log: string, id: string): string[] {
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
  // A report keeps no retained task it excluded.
  const fixed = fixedIn(events, id)?.tasks ?? [];
  const aaStep = Array.isArray(noise) && readsStepEitherWay(noise.filter(isNumber), level);
  const control = Array.isArray(noise) ? `reads ${aaStep ? "a step" : "no step"} either way` : "none stored";
  const within = (set: readonly Scored[], epoch: number) =>
    set.filter((one) => one.epoch === epoch).map(({ bare }) => bare);
  return [
    `${id}: ${named(data.old).slice(0, SHORT)} (old) against ${named(data.fresh).slice(0, SHORT)} (new), level ${String(level)}, reading as recorded ${named(data.reading)}, set ${hashJsonValue(fixed.toSorted(compareCodeUnits)).slice(0, SHORT)} of ${String(fixed.length)} tasks`,
    `  frontier without the bill  ${tallyLine(frontier.map(({ bare }) => bare))}`,
    `  retained without the bill  ${data.retained === UNMEASURED ? UNMEASURED : tallyLine(retained.map(({ bare }) => bare))}`,
    `  together without the bill  ${tallyLine(both.map(({ bare }) => bare))}`,
    `  frontier with the bill     ${tallyLine(frontier.map(({ billed }) => billed))}`,
    `  together with the bill     ${tallyLine(both.map(({ billed }) => billed))}`,
    `  by epoch, without the bill (frontier | retained): ${epochs
      .map((epoch) => `e${String(epoch)} ${wlt(within(frontier, epoch))} | ${wlt(within(retained, epoch))}`)
      .join(", ")}`,
    `  A/A as stored, with the bill: ${control}`,
  ];
}

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { log: { type: "string" }, id: { type: "string", multiple: true } },
});
if (values.log === undefined || values.id === undefined) {
  throw new Error("usage: bun studies/transitivity/read.ts --log <log.jsonl> --id <comparison> [--id ...]");
}
const events = read(values.log);
for (const id of values.id) console.log(readingOf(events, values.log, id).join("\n"));
