#!/usr/bin/env bun
/**
 * A whole comparison of harnesses on JobBench, on terms fixed before the first rollout: `score.ts`
 * solves and judges one arm (an arm is what it takes as `--arm`); this says which arms, on which
 * tasks, how often and in what order, and reads the result. Verbs: `plan` (`--out --id --jb --arm
 * --arm --salt --predict [--count | --tasks] [--burned] [--repeats]`), `run` (`--out --id --jb
 * --api-base [--judge-log] [--dry-run] --yes`), `read` (`--out --id [--unblind]`), `rejudge` (`--out
 * --jb --api-base --of --of --times [--tasks] [--split] [--cap] [--judge-log] --salt --yes`), `agree`
 * (`--out --of --of --times [--cap]`),
 * `derive` (`--from --guide --into`) and `levels` (`--dataset --of --of [--tasks] [--salt
 * [--unseal]]`). `read`, `agree`, `derive` and `levels` start nothing and call no model, and print
 * ids, weights and counts, never a rubric's text or a judge's reasons. `plan` draws whole
 * professions of two tasks or more (Harness² runs each as one stream, its held-out arm solving task
 * N under the harness of task N-1), at least 30% of the benchmark rounded up to a multiple of five,
 * from professions no burned task belongs to; `--tasks` names them instead. `--repeats 2` gives
 * every arm two sides solved alike, so `read` prints their A/A beside the comparison. `plan` fixes
 * the benchmark's own points as the primary measure, with its level and test, and `run` solves
 * block by block in the salt's order. `rejudge` judges existing deliverables again without a
 * rollout, for tens of dollars where rollouts cost thousands, and `agree` reads what moved; with
 * `--cap` it judges under a wider cut than judge.py's 200,000 characters a file, as a second
 * reading beside the official one. Sides carry neutral labels (`x<hash>r<n>`), held apart from
 * their arms in `key.json`, so a reader sees a result before knowing which arm led; a judge's
 * prompt never holds the label. `derive` makes a proposed arm (an exported tree under another
 * guide) as a copy beside the store and edits no kept harness; a solver under a changed guide still
 * takes the operator's word (`AGENTS.md`, section 3).
 */
import { sweepOf } from "#src/kernel/compare.ts";
import { sizeLines } from "#src/kernel/size.ts";
import { AGENT_DIR, GUIDE_FILE } from "#src/meta/bundle-layout.ts";
import { sha256 } from "#src/meta/digest.ts";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isNumber, isRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { HARNESS_DIR } from "../shared/bundle.ts";
import { armOf, bothWays, type Graded, levelLines, partOf } from "./levels.ts";
import { capOf, hasOneBefore, keyOf, PILOT_TASKS, score, tasksOf, type Values } from "./score.ts";

const OPTIONS = {
  out: { type: "string" },
  dataset: { type: "string" },
  id: { type: "string" },
  jb: { type: "string" },
  arm: { type: "string", multiple: true },
  of: { type: "string", multiple: true },
  salt: { type: "string" },
  predict: { type: "string" },
  count: { type: "string" },
  tasks: { type: "string" },
  burned: { type: "string" },
  repeats: { type: "string" },
  baseline: { type: "string" },
  "min-gain": { type: "string" },
  confirm: { type: "boolean" },
  "at-once": { type: "string" },
  times: { type: "string" },
  split: { type: "boolean" },
  cap: { type: "string" },
  unblind: { type: "boolean" },
  unseal: { type: "boolean" },
  from: { type: "string" },
  guide: { type: "string" },
  into: { type: "string" },
  "api-base": { type: "string" },
  "judge-log": { type: "string" },
  "dry-run": { type: "boolean" },
  yes: { type: "boolean" },
} as const;
const AT_ONCE = 3;
const MEASURE = "points";
const LEVEL = 0.02;
const SEALED_FILE = "sealed-professions.json";
const DEFAULT_BASELINE = "pi:base";
const PI_TREE = "pi:tree:";

export interface Terms {
  readonly id: string;
  readonly salt: string;
  readonly tasks: readonly string[];
  readonly sides: readonly string[];
  readonly burned: readonly string[];
  readonly primary: string;
  readonly level: number;
  readonly prediction: string;
  readonly baseline?: string;
  readonly minGain?: number;
  readonly confirm?: boolean;
  readonly sealedProfessions?: readonly string[];
}

interface Planned {
  readonly out: string;
  readonly id: string;
  readonly arms: readonly string[];
  readonly repeats: number;
  readonly salt: string;
  readonly prediction: string;
  readonly tasks: readonly string[];
  readonly burned: readonly string[];
  readonly baseline?: string;
  readonly minGain?: number;
  readonly confirm?: boolean;
}

type Options = Readonly<Record<string, string | boolean | string[] | undefined>>;

const inHashOrder = <T>(items: readonly T[], keyed: (item: T) => string): T[] =>
  items
    .map((item) => ({ item, order: sha256(keyed(item)) }))
    .toSorted((one, other) => one.order.localeCompare(other.order))
    .map(({ item }) => item);
const professionOf = (task: string): string => task.split("/")[0] ?? "";
const armTag = (side: string): string => side.replace(/r\d+$/u, "");
const folderOf = (out: string, id: string): string => join(out, "comparisons", id);
/** The held-out arm solves under the harness of the task before, so a stream's first task is not its. */
const owes = (arm: string | undefined, task: string): boolean => arm !== "heldout" || hasOneBefore(task);

export function benchmarkTasks(jb: string): string[] {
  const tasksRoot = join(jb, "dataset", "main");
  return readdirSync(tasksRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((profession) =>
      readdirSync(join(tasksRoot, profession.name))
        .filter((task) => existsSync(join(tasksRoot, profession.name, task, "RUBRICS.json")))
        .map((task) => `${profession.name}/${task}`),
    );
}

export const defaultCount = (tasks: number): number => Math.ceil((tasks * 3) / 50) * 5;

/** A profession that would leave one task to find is passed over, since one task cannot be a stream. */
export function drawTasks(
  all: readonly string[],
  burned: readonly string[],
  count: number,
  salt: string,
): string[] {
  const closed = new Set(burned.map(professionOf));
  const open = [...new Set(all.map(professionOf))].filter((profession) => !closed.has(profession));
  const drawn: string[] = [];
  for (const profession of inHashOrder(open, (name) => `${salt}\n${name}`)) {
    const stream = all.filter((task) => professionOf(task) === profession);
    const left = count - drawn.length - stream.length;
    if (stream.length >= 2 && left >= 0 && left !== 1) drawn.push(...stream);
  }
  if (drawn.length < count) {
    throw new Error(
      `${String(count)} tasks asked, and whole professions outside the burned ones reach ${String(drawn.length)}`,
    );
  }
  return drawn.toSorted();
}

export function sidesOf(arms: readonly string[], repeats: number, salt: string) {
  const key = new Map(arms.map((arm) => [`x${sha256(`${salt}\n${arm}`).slice(0, 6)}`, arm]));
  if (key.size !== arms.length) throw new Error("an arm is named twice; --repeats gives an arm two sides");
  const sides = [...key.keys()].flatMap((tag) =>
    Array.from({ length: repeats }, (_, index) => `${tag}r${String(index + 1)}`),
  );
  return { sides, key };
}

/** One task's sides together, so no arm runs on a day of its own. */
export function blocksOf(terms: Pick<Terms, "tasks" | "sides" | "salt">) {
  return inHashOrder(terms.tasks, (task) => `${terms.salt}\n${task}`).flatMap((task) =>
    inHashOrder(terms.sides, (side) => `${terms.salt}\n${task}\n${side}`).map((side) => ({ task, side })),
  );
}

function perRollout(out: string): { usd: number; records: number } | null {
  const root = join(out, "judged");
  const paid = (existsSync(root) ? readdirSync(root) : [])
    .flatMap((arm) => readdirSync(join(root, arm)).map((name) => join(root, arm, name)))
    .flatMap((file) => {
      const record = capturedJsonParse(readFileSync(file, "utf8"));
      return isRecord(record) && isNumber(record.solveUsd) && record.solveUsd > 0 && isNumber(record.judgeUsd)
        ? [record.solveUsd + record.judgeUsd]
        : [];
    });
  if (paid.length === 0) return null;
  return { usd: paid.reduce((sum, usd) => sum + usd, 0) / paid.length, records: paid.length };
}

function readSealed(out: string): string[] {
  const file = join(out, SEALED_FILE);
  if (!existsSync(file)) return [];
  const parsed = capturedJsonParse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed) || !parsed.every(isString)) {
    throw new Error(`${file} must hold a JSON array of sealed profession names`);
  }
  return parsed.toSorted();
}

function recordSealed(out: string, professions: readonly string[]): void {
  const merged = [...new Set([...readSealed(out), ...professions])].toSorted();
  mkdirSync(out, { recursive: true });
  const target = join(out, SEALED_FILE);
  const part = `${target}.part-${String(runtimeProcess.pid)}-${String(Date.now())}`;
  writeFileSync(part, `${capturedJsonStringify(merged, null, 2)}\n`);
  renameSync(part, target);
}

/** A second plan under one id is refused, since terms move before a result only. */
export function fixTerms(planned: Planned): string[] {
  const { out, id, arms, repeats, salt, prediction, tasks, burned, baseline, minGain, confirm } = planned;
  const folder = folderOf(out, id);
  if (existsSync(folder)) throw new Error(`${folder} is there already; terms are fixed once`);
  if (arms.length < 2 && repeats < 2) {
    throw new Error("two arms, or one arm with --repeats 2, make a comparison");
  }
  if (minGain !== undefined && (!Number.isFinite(minGain) || minGain < 0)) {
    throw new Error("--min-gain takes a number of points per task from 0");
  }
  const minTasks = sweepOf(LEVEL);
  let sealedProfessions: string[] | undefined;
  if (confirm === true) {
    if (arms.length < 2) throw new Error("confirmation compares at least two arms");
    if (repeats < 2) {
      throw new Error("confirmation needs --repeats 2 or more to read A/A spread beside the comparison");
    }
    if (minGain === undefined || minGain <= 0) {
      throw new Error("confirmation fixes --min-gain above 0 points per task before any rollout");
    }
    if (tasks.length < minTasks) {
      throw new Error(
        `confirmation at level ${String(LEVEL)} needs at least ${String(minTasks)} tasks to clear even with all wins; got ${String(tasks.length)} (repeats pool per task and cannot lower task-level p)`,
      );
    }
    const prior = new Set(readSealed(out));
    const drawn = [...new Set(tasks.map(professionOf))].toSorted();
    const reused = drawn.filter((profession) => prior.has(profession));
    if (reused.length > 0) {
      throw new Error(`already sealed in a prior confirmation: ${reused.join(", ")}`);
    }
    sealedProfessions = drawn;
  }
  const closed = new Set(burned.map(professionOf));
  const shut = tasks.filter((task) => closed.has(professionOf(task)));
  if (shut.length > 0) {
    throw new Error(`in a burned profession: ${shut.join(", ")}; --burned "" reads noise on them`);
  }
  const stored = arms.find((arm) => /^(?:sweep|again):/u.test(arm));
  if (stored !== undefined) {
    throw new Error(
      `${stored} is a stored rollout, never solved afresh here; score.ts table reads it beside`,
    );
  }
  const { sides, key } = sidesOf(arms, repeats, salt);
  const terms: Terms = {
    id,
    salt,
    tasks,
    sides,
    burned,
    primary: MEASURE,
    level: LEVEL,
    prediction,
    ...keyIfDefined("baseline", baseline),
    ...keyIfDefined("minGain", minGain),
    ...keyIfDefined("confirm", confirm === true ? true : undefined),
    ...keyIfDefined("sealedProfessions", sealedProfessions),
  };
  if (sealedProfessions !== undefined) recordSealed(out, sealedProfessions);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "terms.json"), `${capturedJsonStringify(terms, null, 2)}\n`);
  writeFileSync(join(folder, "key.json"), `${capturedJsonStringify(Object.fromEntries(key), null, 2)}\n`);
  const rollouts = sides.flatMap((side) => tasks.filter((task) => owes(key.get(armTag(side)), task))).length;
  const rate = perRollout(out);
  const powerLine = arms.length >= 2 ? (sizeLines(tasks.length, LEVEL)[0] ?? null) : null;
  return [
    `terms fixed in ${folder}: ${String(tasks.length)} tasks, ${String(sides.length)} sides, ${String(rollouts)} rollouts, primary ${MEASURE} at ${String(LEVEL)}${minGain === undefined ? "" : `, minGain ${String(minGain)} pts/task`}${confirm === true ? ", confirmation sealed" : ""}`,
    ...(powerLine === null ? [] : [`power: ${powerLine}`]),
    rate === null
      ? "price: this store has no record to price a rollout from"
      : `price: about ${(rate.usd * rollouts).toFixed(0)} dollars at ${rate.usd.toFixed(2)} a rollout, the mean of ${String(rate.records)} records here`,
    ...tasks.map((task) => `  ${task}`),
  ];
}

function termsIn(out: string, id: string): Terms {
  const file = join(folderOf(out, id), "terms.json");
  if (!existsSync(file)) throw new Error(`${file} is missing: run plan first`);
  const held = capturedJsonParse(readFileSync(file, "utf8"));
  if (!isRecord(held)) throw new Error(`${file} holds no terms`);
  const text = (key: string): string => {
    const value = held[key];
    if (!isString(value)) throw new Error(`${file} has no ${key}`);
    return value;
  };
  const list = (key: string): string[] => {
    const value = held[key];
    if (!Array.isArray(value)) throw new Error(`${file} has no ${key}`);
    return value.filter(isString);
  };
  const level = held.level;
  if (!isNumber(level)) throw new Error(`${file} has no level`);
  return {
    id: text("id"),
    salt: text("salt"),
    tasks: list("tasks"),
    sides: list("sides"),
    burned: list("burned"),
    primary: text("primary"),
    level,
    prediction: text("prediction"),
    ...keyIfDefined("baseline", isString(held.baseline) ? held.baseline : undefined),
    ...keyIfDefined("minGain", isNumber(held.minGain) ? held.minGain : undefined),
    ...keyIfDefined("confirm", held.confirm === true ? true : undefined),
    ...keyIfDefined(
      "sealedProfessions",
      Array.isArray(held.sealedProfessions) ? held.sealedProfessions.filter(isString) : undefined,
    ),
  };
}

function armsIn(out: string, id: string): Map<string, string> {
  const key = capturedJsonParse(readFileSync(join(folderOf(out, id), "key.json"), "utf8"));
  return new Map(
    Object.entries(isRecord(key) ? key : {}).flatMap(([tag, arm]) =>
      isString(arm) ? [[tag, arm] as const] : [],
    ),
  );
}

function pooled(sidesA: readonly Map<string, Graded>[], sidesB: readonly Map<string, Graded>[]) {
  const every = [...sidesA, ...sidesB];
  const mean = (sides: readonly Map<string, Graded>[], task: string): number =>
    sides.reduce((sum, side) => sum + (side.get(task)?.points ?? 0), 0) / sides.length;
  const tasks = [...(every[0]?.keys() ?? [])].filter((task) => every.every((side) => side.has(task)));
  return tasks.map((task) => mean(sidesA, task) - mean(sidesB, task));
}

function treePathOf(arm: string | undefined): string | undefined {
  if (arm === undefined) return undefined;
  if (arm.startsWith(PI_TREE)) return resolve(arm.slice(PI_TREE.length));
  if (arm.startsWith("tree:")) return resolve(arm.slice("tree:".length));
  return undefined;
}

function gainNote(
  diffs: readonly number[],
  label: { readonly a: string; readonly b: string },
  minGain: number | undefined,
  direction: "signed" | "magnitude",
): string {
  if (diffs.length === 0) return "";
  const meanDelta = diffs.reduce((sum, diff) => sum + diff, 0) / diffs.length;
  const check =
    minGain === undefined
      ? ""
      : direction === "signed"
        ? ` (${meanDelta >= minGain ? "meets" : "below"} minGain ${String(minGain)})`
        : ` (|mean delta| ${Math.abs(meanDelta) >= minGain ? ">=" : "<"} minGain ${String(minGain)}; direction needs --unblind)`;
  return `; mean delta (${label.a} - ${label.b}) ${meanDelta.toFixed(2)} pts/task${check}`;
}

export function readLines(out: string, id: string, { unblind }: { readonly unblind: boolean }): string[] {
  const terms = termsIn(out, id);
  const arms = armsIn(out, id);
  const named = (tag: string): string => (unblind ? (arms.get(tag) ?? tag) : tag);
  const dataset = join(out, "dataset");
  const graded = new Map(
    terms.sides.map((side) => [side, armOf(dataset, side, treePathOf(arms.get(armTag(side))))]),
  );
  const tags = [...new Set(terms.sides.map(armTag))].toSorted();
  const of = (tag: string) => terms.sides.filter((side) => armTag(side) === tag);
  const grades = (sides: readonly string[]) => sides.flatMap((side) => graded.get(side) ?? []);
  const missing = terms.sides.flatMap((side) =>
    terms.tasks
      .filter((task) => owes(arms.get(armTag(side)), task) && graded.get(side)?.has(task) !== true)
      .map((task) => `${side} ${task}`),
  );
  const lines = [
    `comparison ${id}: primary ${terms.primary} at ${String(terms.level)}, ${String(terms.tasks.length)} tasks${terms.minGain === undefined ? "" : `, minGain ${String(terms.minGain)} pts/task`}${terms.baseline === undefined ? "" : `, baseline ${terms.baseline}`}, prediction: ${terms.prediction}`,
    `not graded yet: ${missing.join(", ") || "none"}`,
  ];
  for (const [index, rawA] of tags.entries()) {
    for (const rawB of tags.slice(index + 1)) {
      const swap =
        unblind &&
        terms.baseline !== undefined &&
        arms.get(rawA) === terms.baseline &&
        arms.get(rawB) !== terms.baseline;
      const [tagA, tagB] = swap ? [rawB, rawA] : [rawA, rawB];
      const label = { a: named(tagA), b: named(tagB) };
      const diffs = pooled(grades(of(tagA)), grades(of(tagB)));
      const note = gainNote(
        diffs,
        label,
        terms.minGain,
        unblind && terms.baseline !== undefined && arms.get(tagB) === terms.baseline ? "signed" : "magnitude",
      );
      lines.push("", `primary, each task's mean over its sides: ${bothWays(MEASURE, label, diffs)}${note}`);
    }
  }
  for (const tag of tags) {
    const [first, second] = of(tag);
    if (first === undefined || second === undefined) continue;
    const differences = pooled(grades([first]), grades([second]));
    lines.push(
      "",
      `A/A ${named(tag)}, one arm's two sides, where no gain can be: ${bothWays(MEASURE, { a: first, b: second }, differences)}`,
      ...levelLines({
        label: { a: first, b: second },
        a: graded.get(first) ?? new Map(),
        b: graded.get(second) ?? new Map(),
        salt: null,
        unseal: false,
      }),
    );
  }
  for (const [index, tagA] of tags.entries()) {
    for (const tagB of tags.slice(index + 1)) {
      for (const [at, sideA] of of(tagA).entries()) {
        const sideB = of(tagB)[at];
        if (sideB === undefined) continue;
        lines.push(
          "",
          ...levelLines({
            label: { a: `${named(tagA)} ${sideA}`, b: `${named(tagB)} ${sideB}` },
            a: graded.get(sideA) ?? new Map(),
            b: graded.get(sideB) ?? new Map(),
            salt: null,
            unseal: false,
          }),
        );
      }
    }
  }
  return lines;
}

/** Rubrics the two labels scored differently, by task, with their indexes in the task's own file. */
export function splitRubrics(dataset: string, a: string, b: string): Map<string, number[]> {
  const [one, other] = [armOf(dataset, a), armOf(dataset, b)];
  const split = new Map<string, number[]>();
  for (const [task, graded] of one) {
    const rival = new Map((other.get(task)?.rubrics ?? []).map((rubric) => [rubric.index, rubric.score]));
    const differ = graded.rubrics
      .filter((rubric) => rival.has(rubric.index) && rival.get(rubric.index) !== rubric.score)
      .map((rubric) => rubric.index);
    if (differ.length > 0) split.set(task, differ);
  }
  return split;
}

const capName = (values: Options): string | undefined => {
  const cap = capOf(isString(values.cap) ? values.cap : undefined);
  return cap === undefined ? undefined : String(cap);
};
/** One under a wider cut names the cut, so it never stands for one under judge.py's. */
const againOf = (label: string, time: number, cap: string | undefined): string =>
  cap === undefined ? `${label}-j${String(time)}` : `${label}-c${cap}-j${String(time)}`;
const indexFile = (out: string, name: string, task: string): string =>
  join(out, "rejudged", name, `${keyOf(task)}.json`);

/**
 * A file in the benchmark's shape with `indexes` beside it, since a judge numbers what it is handed
 * from nothing, and `agree` reads the two together.
 */
export function prepareAgain(place: {
  out: string;
  jb: string;
  label: string;
  time: number;
  task: string;
  indexes: readonly number[] | null;
  cap?: string;
}): string {
  const { out, jb, label, time, task, indexes, cap } = place;
  const dataset = join(out, "dataset");
  const name = againOf(label, time, cap);
  const from = join(dataset, task, "model_output", `${label}__${keyOf(task)}`);
  const to = join(dataset, task, "model_output", `${name}__${keyOf(task)}`);
  if (!existsSync(from)) throw new Error(`${from} is missing: there is no deliverable to judge again`);
  if (!existsSync(to)) cpSync(from, to, { recursive: true });
  const source = capturedJsonParse(readFileSync(join(jb, "dataset", "main", task, "RUBRICS.json"), "utf8"));
  const rubrics = isRecord(source) && Array.isArray(source.rubrics) ? source.rubrics : [];
  const chosen = indexes ?? rubrics.map((_, index) => index);
  const file = indexFile(out, name, task);
  mkdirSync(join(out, "rejudged", name), { recursive: true });
  writeFileSync(
    file,
    `${capturedJsonStringify({ rubrics: chosen.map((index) => rubrics[index] ?? null), indexes: chosen })}\n`,
  );
  return file;
}

export function agreeLines(
  out: string,
  labels: readonly [string, string],
  times: number,
  cap?: string,
): string[] {
  const dataset = join(out, "dataset");
  const judged = (label: string, time: number): Map<string, Map<number, number>> => {
    const name = againOf(label, time, cap);
    const scores = new Map<string, Map<number, number>>();
    for (const [task, graded] of armOf(dataset, name)) {
      const mapped: JsonValue = capturedJsonParse(readFileSync(indexFile(out, name, task), "utf8"));
      const indexes = isRecord(mapped) && Array.isArray(mapped.indexes) ? mapped.indexes : [];
      const row = new Map<number, number>();
      for (const rubric of graded.rubrics) {
        const original = indexes[rubric.index];
        if (isNumber(original)) row.set(original, rubric.score);
      }
      scores.set(task, row);
    }
    return scores;
  };
  const [a, b] = labels;
  const firsts = [armOf(dataset, a), armOf(dataset, b)] as const;
  const rounds = Array.from(
    { length: times },
    (_, index) => [judged(a, index + 1), judged(b, index + 1)] as const,
  );
  const lines: string[] = [];
  const gaps = Array.from({ length: times + 1 }, () => 0);
  let [rows, moved, split] = [0, 0, 0];
  for (const [task, graded] of firsts[0]) {
    for (const rubric of graded.rubrics) {
      const other = firsts[1].get(task)?.rubrics.find((each) => each.index === rubric.index)?.score;
      const againA = rounds.map(([one]) => one.get(task)?.get(rubric.index));
      const againB = rounds.map(([, two]) => two.get(task)?.get(rubric.index));
      if (other === undefined || againA.includes(undefined) || againB.includes(undefined)) {
        continue;
      }
      const [readsA, readsB] = [
        [rubric.score, ...againA],
        [other, ...againB],
      ].map((reads) => reads.map((read) => read ?? 0));
      if (readsA === undefined || readsB === undefined) continue;
      rows += 1;
      if (new Set(readsA).size > 1 || new Set(readsB).size > 1) moved += 1;
      if (readsA.every((read, at) => read !== readsB[at])) split += 1;
      for (const [at, read] of readsA.entries()) gaps[at] = (gaps[at] ?? 0) + read - (readsB[at] ?? 0);
      lines.push(
        `  ${task} rubric ${String(rubric.index)} weight ${String(rubric.weight)}: ${a} ${readsA.join(", ")}; ${b} ${readsB.join(", ")}`,
      );
    }
  }
  return [
    `judged ${String(times + 1)} times: ${String(rows)} rubrics, ${String(moved)} moved on at least one side, ${String(split)} split in every judging`,
    `${a} minus ${b} on those rubrics, first judging then each again: ${gaps.join(", ")}`,
    ...lines,
  ];
}

export function deriveTree(from: string, guide: string, into: string): void {
  if (existsSync(into)) throw new Error(`${into} is there already; a derived tree is made once`);
  const piGuide = join(HARNESS_DIR, AGENT_DIR, GUIDE_FILE);
  const targetGuide = existsSync(join(from, piGuide))
    ? piGuide
    : existsSync(join(from, "CLAUDE.md"))
      ? "CLAUDE.md"
      : null;
  if (targetGuide === null) {
    throw new Error(`${from} holds no ${piGuide} or CLAUDE.md, so it is no tree`);
  }
  const text = readFileSync(guide);
  cpSync(from, into, { recursive: true });
  writeFileSync(join(into, targetGuide), text);
  const exportedMeta = join(into, "export.json");
  if (existsSync(exportedMeta)) {
    const parsed = capturedJsonParse(readFileSync(exportedMeta, "utf8"));
    if (isRecord(parsed)) {
      const { harness: derivedFrom, ...rest } = parsed;
      writeFileSync(
        exportedMeta,
        `${capturedJsonStringify(
          { ...rest, ...keyIfDefined("derivedFrom", isString(derivedFrom) ? derivedFrom : undefined) },
          null,
          2,
        )}\n`,
      );
    }
  }
  writeFileSync(
    join(into, "derived.json"),
    `${capturedJsonStringify({ from, guide: sha256(text) }, null, 2)}\n`,
  );
}

const named = (values: Options, key: string): string => {
  const value = values[key];
  if (!isString(value) || value === "") throw new Error(`name --${key}`);
  return value;
};
const whole = (value: string, key: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--${key} takes a whole number from 1`);
  return parsed;
};
const paidWith = (values: Options): Pick<Values, "out" | "jb" | "api-base" | "yes"> & Partial<Values> => {
  const judgeLog = values["judge-log"];
  return {
    out: resolve(named(values, "out")),
    jb: resolve(named(values, "jb")),
    "api-base": named(values, "api-base"),
    yes: true,
    ...keyIfDefined("judge-log", isString(judgeLog) ? judgeLog : undefined),
  };
};

/** Every side's preflight, then the rollouts in block order, then one judge at a time in the same order. */
async function runTerms(values: Options): Promise<void> {
  const out = resolve(named(values, "out"));
  const terms = termsIn(out, named(values, "id"));
  const arms = armsIn(out, terms.id);
  const armFor = (side: string): string => {
    const arm = arms.get(armTag(side));
    if (arm === undefined) throw new Error(`${side} has no arm in the key`);
    return arm;
  };
  const base = paidWith(values);
  // A dry run writes each side's tree where it has none, so no two workers export one tree at once.
  for (const side of terms.sides) {
    const tasks = terms.tasks.filter((task) => owes(armFor(side), task)).join(",");
    await score({ ...base, arm: armFor(side), name: side, tasks, "dry-run": true });
  }
  if (values["dry-run"] === true) return;
  if (values.yes !== true) {
    throw new Error("a comparison starts paid rollouts and judgements; --yes is the operator's word");
  }
  const workers = isString(values["at-once"]) ? whole(values["at-once"], "at-once") : AT_ONCE;
  const blocks = blocksOf(terms).filter(({ task, side }) => owes(armFor(side), task));
  const queue = [...blocks];
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      await score({ ...base, arm: armFor(next.side), name: next.side, tasks: next.task, "solve-only": true });
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
  for (const { task, side } of blocks) {
    await score({ ...base, arm: armFor(side), name: side, tasks: task });
  }
}

async function rejudge(values: Options): Promise<void> {
  const labels = values.of;
  if (!Array.isArray(labels) || labels.length === 0) throw new Error("name --of");
  const out = resolve(named(values, "out"));
  const times = whole(named(values, "times"), "times");
  const salt = named(values, "salt");
  const [first = "", second = ""] = labels;
  const split = values.split === true ? splitRubrics(join(out, "dataset"), first, second) : null;
  const tasks =
    split === null
      ? tasksOf(isString(values.tasks) ? values.tasks : undefined, PILOT_TASKS)
      : [...split.keys()];
  const jobs = labels.flatMap((label) =>
    tasks.flatMap((task) => Array.from({ length: times }, (_, index) => ({ label, task, time: index + 1 }))),
  );
  console.log(
    `${String(jobs.length)} judgements of ${String(tasks.length)} tasks${split === null ? "" : `, on ${String([...split.values()].flat().length)} split rubrics`}`,
  );
  if (values.yes !== true) throw new Error("judging again is paid; --yes is the operator's word");
  const base = paidWith(values);
  const cap = capName(values);
  for (const { label, task, time } of inHashOrder(
    jobs,
    (job) => `${salt}\n${job.label}\n${job.task}\n${String(job.time)}`,
  )) {
    const rubrics = prepareAgain({
      out,
      jb: resolve(named(values, "jb")),
      label,
      time,
      task,
      indexes: split?.get(task) ?? null,
      ...keyIfDefined("cap", cap),
    });
    await score({
      ...base,
      arm: `again:${label}`,
      name: againOf(label, time, cap),
      tasks: task,
      rubrics,
      ...keyIfDefined("cap", cap),
    });
  }
}

const canonicalArm = (arm: string): string =>
  arm.startsWith(PI_TREE)
    ? `${PI_TREE}${resolve(arm.slice(PI_TREE.length))}`
    : arm.startsWith("tree:")
      ? `tree:${resolve(arm.slice("tree:".length))}`
      : arm;

function planOf(values: Options): string[] {
  const givenArms = values.arm;
  if (!Array.isArray(givenArms) || givenArms.length === 0) throw new Error("name --arm");
  const normalized = givenArms.map(canonicalArm);
  const confirm = values.confirm === true;
  const baseline = isString(values.baseline)
    ? canonicalArm(values.baseline)
    : confirm
      ? DEFAULT_BASELINE
      : undefined;
  const arms =
    baseline !== undefined && !normalized.includes(baseline) ? [...normalized, baseline] : [...normalized];
  const out = resolve(named(values, "out"));
  const salt = named(values, "salt");
  const burnedGiven = tasksOf(isString(values.burned) ? values.burned : undefined, PILOT_TASKS);
  const sealed = confirm ? readSealed(out).map((profession) => `${profession}/task1`) : [];
  const burned = [...burnedGiven, ...sealed];
  const all = benchmarkTasks(resolve(named(values, "jb")));
  const count = isString(values.count) ? whole(values.count, "count") : defaultCount(all.length);
  const tasks = isString(values.tasks) ? tasksOf(values.tasks, []) : drawTasks(all, burned, count, salt);
  const minGain = isString(values["min-gain"]) ? Number(values["min-gain"]) : undefined;
  const share = Math.round((100 * tasks.length) / all.length);
  const professions = new Set(tasks.map(professionOf)).size;
  const told = fixTerms({
    out,
    id: named(values, "id"),
    arms,
    repeats: isString(values.repeats) ? whole(values.repeats, "repeats") : confirm ? 2 : 1,
    salt,
    prediction: named(values, "predict"),
    tasks,
    burned: burnedGiven,
    ...keyIfDefined("baseline", baseline),
    ...keyIfDefined("minGain", minGain),
    ...keyIfDefined("confirm", confirm ? true : undefined),
  });
  return [
    `${String(tasks.length)} of ${String(all.length)} tasks, ${String(share)}% of the benchmark, in ${String(professions)} professions`,
    ...told,
  ];
}

async function main(args: readonly string[]): Promise<void> {
  const [verb, ...rest] = args;
  const { values } = parseArgs({ args: [...rest], options: OPTIONS, strict: true });
  if (verb === "plan") {
    console.log(planOf(values).join("\n"));
  } else if (verb === "run") {
    await runTerms(values);
  } else if (verb === "read") {
    console.log(
      readLines(resolve(named(values, "out")), named(values, "id"), {
        unblind: values.unblind === true,
      }).join("\n"),
    );
  } else if (verb === "rejudge") {
    await rejudge(values);
  } else if (verb === "agree") {
    const [a = "", b = ""] = values.of ?? [];
    const cap = capName(values);
    console.log(
      agreeLines(resolve(named(values, "out")), [a, b], whole(named(values, "times"), "times"), cap).join(
        "\n",
      ),
    );
  } else if (verb === "derive") {
    deriveTree(
      resolve(named(values, "from")),
      resolve(named(values, "guide")),
      resolve(named(values, "into")),
    );
  } else if (verb === "levels") {
    const [a, b] = values.of ?? [];
    if (a === undefined || b === undefined) throw new Error("levels reads two arms, each named by --of");
    const dataset = resolve(named(values, "dataset"));
    const { salt = null, unseal = false } = values;
    if (salt === null && unseal) throw new Error("--unseal reads beside --salt");
    const graded = { a: armOf(dataset, a), b: armOf(dataset, b) };
    const part = isString(values.tasks) ? partOf(graded.a, graded.b, tasksOf(values.tasks, [])) : graded;
    console.log(levelLines({ label: { a, b }, ...part, salt, unseal }).join("\n"));
  } else {
    throw new Error(
      "usage: compare.ts plan | run | read | rejudge | agree | derive | levels; the head of this file has each one's options",
    );
  }
}

if (import.meta.main) await main(Bun.argv.slice(2));
