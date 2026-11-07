#!/usr/bin/env bun
/**
 * A rubric-graded benchmark's result for two arms, at each grain, with a sealed half of the tasks
 * withheld. It starts no solve and calls no model, and it prints ids, weights and counts, never a
 * rubric's text or a grader's reasons, so its output may go into a ledger or a pull request.
 *
 *   bun studies/harness2/levels.ts --dataset <dir> --a <arm> --b <arm> [--salt <text> [--unseal]]
 *
 * It reads JobBench's layout: `<dataset>/<group>/<task>/eval_result/eval_<arm>__<group>__<task>/`,
 * one `*judge.json` in it.
 *
 * Why. On 5 November 2026 a review of the first promoted jobstat harness took ten throwaway scripts to
 * find that 7 criteria of 241 had become 32 points of 550, and nobody could say afterwards how many
 * cuts had been looked at. So one command prints every grain side by side, in the same order whichever
 * side leads, and lists every split rubric both ways, so that reading only the losses takes extra work.
 *
 * The seal is what keeps a pattern from confirming itself. `--salt` orders the tasks by a hash of the
 * salt and the task, opens the first half and withholds the rest: no score of a sealed task is printed
 * or pooled until `--unseal`, and even then in a block of its own. The salt is the digest of the first
 * version of the review's ledger, fixed before any task is read (comparison-review, step 2). The tests
 * are the comparison's own (`testOf`), each read both ways.
 */
import { testOf } from "#src/kernel/compare.ts";
import { sha256 } from "#src/meta/digest.ts";
import { existsSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, type JsonObject } from "#src/meta/json-shape.ts";
import { join, resolve } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";

const OPTIONS = {
  dataset: { type: "string" },
  a: { type: "string" },
  b: { type: "string" },
  salt: { type: "string" },
  unseal: { type: "boolean" },
} as const;
const SUFFIX = "judge.json";
/** `flipP` reads whole units, so a task's difference goes in hundredths of a point. */
const UNITS = 100;

interface Rubric {
  readonly index: number;
  readonly weight: number;
  readonly score: number;
  readonly passed: number;
  readonly criteria: number;
}
export interface Graded {
  readonly points: number;
  readonly most: number;
  readonly rubrics: readonly Rubric[];
}
type Arm = ReadonlyMap<string, Graded>;
interface Asked {
  readonly label: { readonly a: string; readonly b: string };
  readonly a: Arm;
  readonly b: Arm;
  readonly salt: string | null;
  readonly unseal: boolean;
}

/** A grading with a field missing is refused: read as zero, it would pass for a score. */
function numberAt(record: JsonObject, key: string): number {
  const value = record[key];
  if (!isNumber(value)) throw new Error(`a grading has no number at ${key}`);
  return value;
}

function rubricOf(entry: unknown): Rubric {
  const rubric = asRecord(entry) ?? {};
  const result = asRecord(rubric.result) ?? {};
  return {
    index: numberAt(rubric, "index"),
    weight: numberAt(rubric, "weight"),
    score: numberAt(result, "score"),
    passed: numberAt(result, "criteria_passed"),
    criteria: numberAt(result, "criteria_count"),
  };
}

function gradedIn(file: string): Graded {
  const record = asRecord(capturedJsonParse(readFileSync(file, "utf8"))) ?? {};
  const rubrics = record.rubrics;
  return {
    points: numberAt(record, "total_score"),
    most: numberAt(record, "max_score"),
    rubrics: Array.isArray(rubrics) ? rubrics.map(rubricOf) : [],
  };
}

function foldersIn(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

/** Every task this arm was graded on, by `<group>/<task>`. A task graded twice is refused, since which
 *  of the two counts is a choice no reader should make silently. */
export function armOf(dataset: string, arm: string): Map<string, Graded> {
  const graded = new Map<string, Graded>();
  for (const group of foldersIn(dataset)) {
    for (const task of foldersIn(join(dataset, group))) {
      const folder = join(dataset, group, task, "eval_result", `eval_${arm}__${group}__${task}`);
      if (!existsSync(folder)) continue;
      const records = readdirSync(folder).filter((name) => name.endsWith(SUFFIX));
      if (records.length > 1) throw new Error(`${group}/${task} holds ${String(records.length)} gradings`);
      const [record] = records;
      if (record !== undefined) graded.set(`${group}/${task}`, gradedIn(join(folder, record)));
    }
  }
  return graded;
}

/** Each task's half by a hash of the salt and its own name, about half each way. A cut at half the
 *  tasks graded so far moved a sealed task into the open half as each grading arrived (landing
 *  review, 7 November 2026), so no task's half depends on the others. */
export function sealOf(tasks: readonly string[], salt: string) {
  const sealed = (task: string) => Number.parseInt(sha256(`${salt}\n${task}`).slice(0, 1), 16) >= 8;
  const sorted = tasks.toSorted();
  return { open: sorted.filter((task) => !sealed(task)), sealed: sorted.filter(sealed) };
}

export const passedAll = (graded: Graded) => graded.rubrics.reduce((sum, rubric) => sum + rubric.passed, 0);
const criteriaAll = (graded: Graded) => graded.rubrics.reduce((sum, rubric) => sum + rubric.criteria, 0);
/** Rubrics that scored nothing while one criterion short of all. */
const oneShort = (graded: Graded) =>
  graded.rubrics.filter((rubric) => rubric.score === 0 && rubric.criteria - rubric.passed === 1).length;
/** Rubrics scored neither at nothing nor at their weight: zero where a rubric is all or nothing. */
const partial = (graded: Graded) =>
  graded.rubrics.filter((rubric) => rubric.score !== 0 && rubric.score !== rubric.weight).length;

/** One measure's differences read both ways, by the comparison's own test. */
export function bothWays(
  name: string,
  label: { a: string; b: string },
  differences: readonly number[],
): string {
  const forA = testOf(differences.map((difference) => Math.round(difference * UNITS)));
  const forB = testOf(differences.map((difference) => Math.round(-difference * UNITS)));
  return `${name} by task: ${label.a} above on ${String(forA.wins)}, ${label.b} above on ${String(forA.losses)}, tied on ${String(forA.ties)}; p ${label.a} above ${forA.p.toFixed(4)}, p ${label.b} above ${forB.p.toFixed(4)}`;
}

/** Every rubric the two arms scored differently, whichever side it favoured. */
function splitLines(label: { a: string; b: string }, tasks: readonly string[], a: Arm, b: Arm): string[] {
  const won = { a: { count: 0, points: 0 }, b: { count: 0, points: 0 } };
  const lines: string[] = [];
  let rubrics = 0;
  for (const task of tasks) {
    const other = new Map((b.get(task)?.rubrics ?? []).map((rubric) => [rubric.index, rubric]));
    for (const rubric of a.get(task)?.rubrics ?? []) {
      rubrics += 1;
      const rival = other.get(rubric.index);
      if (rival === undefined || rival.score === rubric.score) continue;
      const side = rubric.score > rival.score ? won.a : won.b;
      side.count += 1;
      side.points += Math.abs(rubric.score - rival.score);
      lines.push(
        `  ${task} rubric ${String(rubric.index)} weight ${String(rubric.weight)}: ${label.a} ${String(rubric.score)} (${String(rubric.passed)}/${String(rubric.criteria)}), ${label.b} ${String(rival.score)} (${String(rival.passed)}/${String(rival.criteria)})`,
      );
    }
  }
  return [
    `rubrics split: ${String(lines.length)} of ${String(rubrics)}; ${label.a} won ${String(won.a.count)} for ${String(won.a.points)} points, ${label.b} won ${String(won.b.count)} for ${String(won.b.points)} points`,
    ...lines,
  ];
}

/** One block of tasks at every grain. Each block stands alone: nothing pools two of them. */
function blockLines(label: { a: string; b: string }, tasks: readonly string[], a: Arm, b: Arm): string[] {
  const pairs = tasks.flatMap((task) => {
    const [one, other] = [a.get(task), b.get(task)];
    return one === undefined || other === undefined ? [] : [{ task, one, other }];
  });
  const sum = (read: (pair: (typeof pairs)[number]) => number) =>
    pairs.reduce((total, pair) => total + read(pair), 0);
  const rows = pairs.map(
    ({ task, one, other }) =>
      `  ${task}: points ${String(one.points)} of ${String(one.most)} v ${String(other.points)} of ${String(other.most)}; criteria ${String(passedAll(one))}/${String(criteriaAll(one))} v ${String(passedAll(other))}/${String(criteriaAll(other))}; one short ${String(oneShort(one))} v ${String(oneShort(other))}`,
  );
  return [
    `${String(pairs.length)} tasks, ${label.a} v ${label.b}`,
    ...rows,
    `points: ${String(sum(({ one }) => one.points))} v ${String(sum(({ other }) => other.points))} of ${String(sum(({ one }) => one.most))}`,
    `criteria: ${String(sum(({ one }) => passedAll(one)))} v ${String(sum(({ other }) => passedAll(other)))} of ${String(sum(({ one }) => criteriaAll(one)))}`,
    `rubrics one criterion short of scoring: ${String(sum(({ one }) => oneShort(one)))} v ${String(sum(({ other }) => oneShort(other)))}`,
    `rubrics scored in part: ${String(sum(({ one }) => partial(one)))} v ${String(sum(({ other }) => partial(other)))}`,
    bothWays(
      "points",
      label,
      pairs.map(({ one, other }) => one.points - other.points),
    ),
    bothWays(
      "criteria",
      label,
      pairs.map(({ one, other }) => passedAll(one) - passedAll(other)),
    ),
    ...splitLines(label, tasks, a, b),
  ];
}

/** What one reading prints. A sealed task appears by name alone until it is unsealed. */
export function levelLines({ label, a, b, salt, unseal }: Asked): string[] {
  const both = [...a.keys()].filter((task) => b.has(task)).toSorted();
  const short = [...new Set([...a.keys(), ...b.keys()])].filter((task) => !both.includes(task)).toSorted();
  const head = [
    `graded on both: ${String(both.length)}; ${label.a} ${String(a.size)}, ${label.b} ${String(b.size)}; left out as short on one side: ${short.join(", ") || "none"}`,
  ];
  if (salt === null) return [...head, ...blockLines(label, both, a, b)];
  const { open, sealed } = sealOf(both, salt);
  return [
    ...head,
    `sealed by ${salt}: ${sealed.join(", ") || "none"}`,
    "",
    "open half",
    ...blockLines(label, open, a, b),
    ...(unseal ? ["", "sealed half, read once, not pooled", ...blockLines(label, sealed, a, b)] : []),
  ];
}

if (import.meta.main) {
  const { values } = parseArgs({ args: Bun.argv.slice(2), options: OPTIONS, strict: true });
  const { dataset, a, b, salt = null, unseal = false } = values;
  if (dataset === undefined || a === undefined || b === undefined) {
    throw new Error("usage: levels.ts --dataset <dir> --a <arm> --b <arm> [--salt <text> [--unseal]]");
  }
  if (salt === null && unseal) throw new Error("--unseal reads beside --salt");
  const lines = levelLines({
    label: { a, b },
    a: armOf(resolve(dataset), a),
    b: armOf(resolve(dataset), b),
    salt,
    unseal,
  });
  console.log(lines.join("\n"));
}
