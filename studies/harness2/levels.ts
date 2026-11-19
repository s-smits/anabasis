/**
 * A rubric-graded benchmark's result for two arms, at each grain, with a sealed half of the tasks
 * withheld. It starts no solve and calls no model, and it prints ids, weights and counts, never a
 * rubric's text or a grader's reasons, so its output may go into a ledger or a pull request.
 *
 *   bun studies/harness2/compare.ts levels --dataset <dir> --of <arm> --of <arm> [--tasks <list>]
 *     [--salt <text> [--unseal]]
 *
 * It reads JobBench's layout: `<dataset>/<group>/<task>/eval_result/eval_<arm>__<group>__<task>/`,
 * one `*judge.json` in it, and the rollout's trajectory beside it under `model_traj/`.
 *
 * Why. On 5 November 2026 a review of the first promoted jobstat harness took ten throwaway scripts to
 * find that 7 criteria of 241 had become 32 points of 550, and nobody could say afterwards how many
 * cuts had been looked at. So one command prints every grain side by side, in the same order whichever
 * side leads, and lists every split rubric both ways, so that reading only the losses takes extra work.
 * On 16 November 2026 a second review counted by hand that 0 of 140 shell commands in a promoted
 * harness's eight rollouts ran one of its programs. Each block now prints for both arms the
 * commands that name the export's program folder and those of them that only look at it; on that
 * store 17 name it, so the hand count was near and not exact. The count reads a shell line
 * without a parser and proves no use: the guide reaches a rollout whatever its commands do. Since
 * the export put the programs on the solver's path (17 November 2026), a program started by its
 * name alone names no folder, so a command that starts one counts too, by the names the arm's tree
 * in the store (`<store>/trees/<arm>`) lists; a copy of the store without its trees says so.
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
import { asRecord, isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { exportedPrograms, TOOLCHAIN } from "../shared/claude-export.ts";
import { parseEvents } from "./h2/claude.ts";

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
/** A rollout's shell commands: those that name the exported harness's program folder or start one of
 *  its programs by name, and those of them that only look at it. The rest may have used a program,
 *  so looking is the count kept sure. `listed` is false where no tree listed the programs. */
interface Shell {
  readonly commands: number;
  readonly named: number;
  readonly looks: number;
  readonly listed: boolean;
}
/** Programs that read a path and run nothing found at it. `cd` is left out: what follows it may run. */
const LOOKS = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "find",
  "tree",
  "file",
  "wc",
  "grep",
  "rg",
  "sed",
  "stat",
  "du",
  "which",
  "echo",
  "test",
  "[",
]);
/** Where one command of a shell line ends and the next begins; a shell line has no parser here. */
const NEXT_COMMAND = /&&|\|\||[;|\n]/u;
export interface Graded {
  readonly points: number;
  readonly most: number;
  readonly rubrics: readonly Rubric[];
  /** `null` where the dataset holds no trajectory of the rollout: unknown, which is not none. */
  readonly shell: Shell | null;
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

/** The program one command of a line starts, past any `NAME=value`. */
const headOf = (part: string): string =>
  part
    .trim()
    .split(/\s+/u)
    .find((word) => !/^\w+=/u.test(word)) ?? "";

/** A trajectory's place in time: its name ends `_attempt<N>_<stamp>.jsonl`, and a task rolled again
 *  starts at attempt 1, so the name's own order would put an older second attempt last. */
const stampOf = (name: string): string => name.replace(/^.*_attempt\d+_/u, "");

/** The newest attempt's commands, since that attempt left the deliverable the grading read, and
 *  those that name the harness's folder or start one of its programs by name. */
function shellIn(folder: string, programs: ReadonlySet<string> | null): Shell | null {
  const newest = existsSync(folder)
    ? readdirSync(folder)
        .filter((name) => name.endsWith(".jsonl"))
        .toSorted((one, other) => stampOf(one).localeCompare(stampOf(other)))
        .at(-1)
    : undefined;
  if (newest === undefined) return null;
  const commands = parseEvents(join(folder, newest)).flatMap((event) => {
    const content = asRecord(event.message)?.content;
    if (event.type !== "assistant" || !Array.isArray(content)) return [];
    return content.flatMap((block) => {
      const command = asRecord(asRecord(block)?.input)?.command;
      return asRecord(block)?.type === "tool_use" && isString(command) ? [command] : [];
    });
  });
  const parts = commands.map((command) =>
    command
      .split(NEXT_COMMAND)
      .filter((part) => part.includes(TOOLCHAIN) || programs?.has(basename(headOf(part))) === true),
  );
  const named = parts.filter((reached) => reached.length > 0);
  return {
    commands: commands.length,
    named: named.length,
    looks: named.filter((reached) => reached.every((part) => LOOKS.has(headOf(part)))).length,
    listed: programs !== null,
  };
}

function gradedIn(file: string, trajectories: string, programs: ReadonlySet<string> | null): Graded {
  const record = asRecord(capturedJsonParse(readFileSync(file, "utf8"))) ?? {};
  const rubrics = record.rubrics;
  return {
    points: numberAt(record, "total_score"),
    most: numberAt(record, "max_score"),
    rubrics: Array.isArray(rubrics) ? rubrics.map(rubricOf) : [],
    shell: shellIn(trajectories, programs),
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
  const tree = join(dirname(dataset), "trees", arm);
  const programs = existsSync(tree) ? new Set(exportedPrograms(tree).map(({ name }) => name)) : null;
  for (const group of foldersIn(dataset)) {
    for (const task of foldersIn(join(dataset, group))) {
      const folder = join(dataset, group, task, "eval_result", `eval_${arm}__${group}__${task}`);
      if (!existsSync(folder)) continue;
      const records = readdirSync(folder).filter((name) => name.endsWith(SUFFIX));
      if (records.length > 1) throw new Error(`${group}/${task} holds ${String(records.length)} gradings`);
      const [record] = records;
      const trajectories = join(dataset, group, task, "model_traj", `${arm}__${group}__${task}`);
      if (record === undefined) continue;
      graded.set(`${group}/${task}`, gradedIn(join(folder, record), trajectories, programs));
    }
  }
  return graded;
}

/** One part of a read: the named tasks of both arms, since no part is summed with another. A task
 *  neither arm was graded on is refused: a mistyped name would otherwise read as a smaller part. */
export function partOf(a: Arm, b: Arm, only: readonly string[]): { a: Arm; b: Arm } {
  const absent = only.filter((task) => !a.has(task) && !b.has(task));
  if (absent.length > 0) throw new Error(`graded for neither arm: ${absent.join(", ")}`);
  const kept = (arm: Arm) => new Map([...arm].filter(([task]) => only.includes(task)));
  return { a: kept(a), b: kept(b) };
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

/** One arm's shell commands over a block; a rollout whose trajectory the dataset lacks is counted
 *  apart instead of read as none. */
function shellOf(sides: readonly Graded[]): string {
  const read = sides.flatMap(({ shell }) => (shell === null ? [] : [shell]));
  const sum = (pick: (shell: Shell) => number) => read.reduce((total, shell) => total + pick(shell), 0);
  const unread = sides.length - read.length;
  const notes = [
    ...(unread === 0 ? [] : [`${String(unread)} rollouts unread`]),
    ...(read.every(({ listed }) => listed) ? [] : ["no tree lists its programs"]),
  ];
  const rest = notes.length === 0 ? "" : ` (${notes.join("; ")})`;
  return `${String(sum(({ named }) => named))} name it, ${String(sum(({ looks }) => looks))} of them only to look, of ${String(sum(({ commands }) => commands))}${rest}`;
}

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
    `shell commands and the harness's programs, by folder or name: ${shellOf(pairs.map(({ one }) => one))} v ${shellOf(pairs.map(({ other }) => other))}`,
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
