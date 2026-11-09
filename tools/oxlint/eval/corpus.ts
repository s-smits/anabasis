/**
 * The labelled corpus of implicit state machines and how detector hits are scored against it.
 *
 * An item names one site in one tree (a repository at a commit, or a mutant of one) and says
 * whether a detector should report there. A hit matches an item when one of the places it names
 * falls inside one of the item's line ranges, give or take `SLACK` lines. Recall is read per item
 * (was a positive caught), precision per hit (of the hits that landed on a labelled item, how many
 * landed on a positive). A negative says only that its site is not of its own class, so a hit counts
 * as false only on a negative of a class its rule is meant to find; a hit that lands on no such item
 * is unlabelled: it is printed for adjudication
 * and counted neither way, so a corpus that has not yet looked somewhere does not punish a rule
 * for looking there. An unlabelled site that several trees hold unchanged is listed once.
 */
import { isNumber, isRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { join } from "#src/meta/path.ts";
import type { Hit } from "./detect.ts";

const CLASSES = [
  "literal-spread",
  "boolean-phase",
  "files-as-phase",
  "mtime-lock",
  "name-encoded-state",
  "repeated-external-read",
  "second-store",
  "multi-step-no-progress",
  "second-reader",
  "partial-mapping",
  "non-atomic-claim",
  "overwritten-state-file",
  "co-assigned-flags",
] as const;
export type Class = (typeof CLASSES)[number];
const SOURCES = [
  "census",
  "lead",
  "fix-lane",
  "history",
  "foreign-history",
  "synthetic",
  "hard-negative",
  "adjudicated",
] as const;
type Source = (typeof SOURCES)[number];
type Label = "positive" | "negative";

/** The class each rule is meant to find; recall is read against these. */
export const RULE_CLASSES = new Map<string, readonly Class[]>([
  ["flag-count", ["boolean-phase"]],
  ["flags-as-state", ["boolean-phase"]],
  ["files-as-phase", ["files-as-phase"]],
  ["mtime-as-lock", ["mtime-lock"]],
  ["name-encoded-state", ["name-encoded-state"]],
  ["state-literal-spread", ["literal-spread"]],
  ["unowned-state-literal", ["literal-spread"]],
  // Groupings the scan reads as enumerations of kinds: its hits on a positive are state it set aside.
  ["enumeration-literal-spread", []],
  // Both literal-spread outputs together, as the scan read them before it set enumerations apart.
  ["literal-spread-any", ["literal-spread"]],
  ["repeated-external-read", ["repeated-external-read"]],
  ["co-assigned-flags", ["co-assigned-flags"]],
  ["second-reader", ["second-reader"]],
  ["partial-mapping", ["partial-mapping"]],
]);
const SLACK = 2;

/** The corpus files beside this one, read as one: the first corpus, then the foreign projects added after it. */
export const CORPORA = ["implicit-state-corpus.jsonl", "implicit-state-corpus-foreign.jsonl"].map((name) =>
  join(import.meta.dir, name),
);

export interface Range {
  file: string;
  lines: readonly [number, number];
}

export interface Item extends Range {
  id: string;
  repo: string;
  commit: string;
  /** A mutant of the commit's tree that `mutate.ts` names; its ranges are the edits it makes. */
  mutant?: string;
  also: readonly Range[];
  class: Class;
  label: Label;
  verdict: string;
  source: Source;
  /** The item that holds the same site in its other form: a fix's parent, or a mutant's original. */
  pair?: string;
}

/** A tree the scorer reads: a repository at a commit, with at most one mutant applied. */
export interface TreeKey {
  repo: string;
  commit: string;
  mutant?: string;
}

/** The hits of one tree, with the ranges each mutant item's edits made there. */
export interface TreeHits {
  key: TreeKey;
  hits: readonly Hit[];
  edited?: readonly Range[];
}

/** One rule's tally over a set of trees. */
export interface RuleScore {
  rule: string;
  positives: number;
  caught: number;
  caughtOther: number;
  negativesHit: number;
  truePositiveHits: number;
  falsePositiveHits: number;
  unlabelled: Hit[];
}

/** One threshold of a sweep and what the rule scores at it. */
interface SweepRow {
  at: number;
  score: RuleScore;
}

export const treeName = (key: TreeKey): string =>
  `${key.repo}@${key.commit.slice(0, 9)}${key.mutant === undefined ? "" : `#${key.mutant}`}`;

function rangeOf(value: JsonValue | undefined): Range | null {
  if (!isRecord(value) || !isString(value.file) || !Array.isArray(value.lines)) return null;
  const [start, end] = value.lines;
  return isNumber(start) && isNumber(end) && start <= end ? { file: value.file, lines: [start, end] } : null;
}

const member = <T extends string>(list: readonly T[], value: JsonValue | undefined): T | null =>
  list.find((one) => one === value) ?? null;

/** One corpus line as an item, or an error naming what is wrong with it. */
function itemOf(row: JsonValue, at: number): Item | string {
  if (!isRecord(row)) return `line ${String(at)}: not an object`;
  const { id, repo, commit, verdict, mutant, pair } = row;
  const range = rangeOf(row);
  const klass = member(CLASSES, row.class);
  const source = member(SOURCES, row.source);
  const label = row.label === "positive" || row.label === "negative" ? row.label : null;
  if (!isString(id) || !isString(repo) || !isString(commit) || !isString(verdict) || range === null) {
    return `line ${String(at)}: needs id, repo, commit, file, lines [start, end] and verdict`;
  }
  if (klass === null || source === null || label === null) {
    return `${id}: class, source or label is not one of the known values`;
  }
  const also = Array.isArray(row.also) ? row.also.map(rangeOf) : [];
  if (also.includes(null)) return `${id}: an "also" range is malformed`;
  return {
    ...range,
    id,
    repo,
    commit,
    also: also.filter((one) => one !== null),
    class: klass,
    label,
    verdict,
    source,
    ...keyIfDefined("mutant", isString(mutant) ? mutant : undefined),
    ...keyIfDefined("pair", isString(pair) ? pair : undefined),
  };
}

/** The corpus, every line checked; throws listing each malformed or duplicated line. */
export function parseCorpus(text: string): Item[] {
  const rows = text
    .split("\n")
    .flatMap((line, index) => (line.trim() === "" ? [] : [itemOf(capturedJsonParse(line), index + 1)]));
  const items = rows.filter((row): row is Item => !isString(row));
  const seen = new Set<string>();
  const errors = rows.filter(isString);
  for (const item of items) {
    if (seen.has(item.id)) errors.push(`${item.id}: duplicated`);
    seen.add(item.id);
  }
  for (const { id, pair } of items) {
    if (pair !== undefined && !seen.has(pair)) errors.push(`${id}: pairs with no item ${pair}`);
  }
  if (errors.length > 0) {
    throw new Error(`corpus has ${String(errors.length)} bad lines:\n${errors.join("\n")}`);
  }
  return items;
}

/** The trees the corpus names, once each. */
export function treesOf(items: readonly Item[]): TreeKey[] {
  const keys = new Map(
    items.map((item) => [
      treeName(item),
      { repo: item.repo, commit: item.commit, ...keyIfDefined("mutant", item.mutant) },
    ]),
  );
  return [...keys.values()];
}

/** The ranges an item covers in its tree: a mutant's edits, else its own range and any others. */
function rangesOf(item: Item, tree: TreeHits): readonly Range[] {
  return item.mutant === undefined ? [item, ...item.also] : (tree.edited ?? []);
}

/** Whether a hit names a place inside one of an item's ranges, give or take `SLACK` lines. */
const lands = (hit: Hit, ranges: readonly Range[]): boolean =>
  hit.places.some(({ file, line }) =>
    ranges.some(
      (range) => file === range.file && line >= range.lines[0] - SLACK && line <= range.lines[1] + SLACK,
    ),
  );

const targets = (rule: string, item: Item): boolean => (RULE_CLASSES.get(rule) ?? []).includes(item.class);

/** Adds one tree's hits of one rule to its score. */
function tally(score: RuleScore, own: readonly Item[], ruled: readonly Hit[], tree: TreeHits): void {
  for (const item of own) {
    const hitHere = ruled.some((hit) => lands(hit, rangesOf(item, tree)));
    const target = targets(score.rule, item);
    if (item.label === "positive" && target) score.positives += 1;
    if (item.label === "positive" && hitHere) score[target ? "caught" : "caughtOther"] += 1;
    if (item.label === "negative" && target && hitHere) score.negativesHit += 1;
  }
  for (const hit of ruled) {
    const landed = own.filter((item) => lands(hit, rangesOf(item, tree)));
    if (landed.some((item) => item.label === "positive")) {
      score.truePositiveHits += 1;
    } else if (landed.some((item) => targets(score.rule, item))) {
      score.falsePositiveHits += 1;
    } else if (!score.unlabelled.some((one) => one.file === hit.file && one.message === hit.message)) {
      // Once each: a site that several trees hold unchanged is one hit to adjudicate.
      score.unlabelled.push(hit);
    }
  }
}

/** The rules whose hits land on an item in its tree, once each. */
export const rulesOn = (item: Item, tree: TreeHits): string[] => [
  ...new Set(tree.hits.filter((hit) => lands(hit, rangesOf(item, tree))).map((hit) => hit.rule)),
];

/** Per rule, the tally of the given hits over the given items; each tree's items are its own. */
export function scoreRules(
  items: readonly Item[],
  trees: readonly TreeHits[],
  keep: (hit: Hit) => boolean = () => true,
): Map<string, RuleScore> {
  const scores = new Map<string, RuleScore>();
  const scoreOf = (rule: string): RuleScore => {
    const had = scores.get(rule);
    if (had !== undefined) return had;
    const fresh = {
      rule,
      positives: 0,
      caught: 0,
      caughtOther: 0,
      negativesHit: 0,
      truePositiveHits: 0,
      falsePositiveHits: 0,
      unlabelled: [],
    };
    scores.set(rule, fresh);
    return fresh;
  };
  for (const rule of RULE_CLASSES.keys()) scoreOf(rule);
  for (const tree of trees) {
    const own = items.filter((item) => treeName(item) === treeName(tree.key));
    const hits = tree.hits.filter(keep);
    for (const rule of new Set([...RULE_CLASSES.keys(), ...hits.map((hit) => hit.rule)])) {
      tally(
        scoreOf(rule),
        own,
        hits.filter((hit) => hit.rule === rule),
        tree,
      );
    }
  }
  return scores;
}

/** Per class, how many positives any rule caught, and which positives none did. */
export function scoreClasses(
  items: readonly Item[],
  trees: readonly TreeHits[],
): Map<Class, { positives: number; caught: number; missed: Item[] }> {
  const out = new Map<Class, { positives: number; caught: number; missed: Item[] }>();
  for (const klass of CLASSES) out.set(klass, { positives: 0, caught: 0, missed: [] });
  for (const tree of trees) {
    for (const item of items.filter(
      (one) => one.label === "positive" && treeName(one) === treeName(tree.key),
    )) {
      const row = out.get(item.class);
      if (row === undefined) continue;
      row.positives += 1;
      if (tree.hits.some((hit) => lands(hit, rangesOf(item, tree)))) row.caught += 1;
      else row.missed.push(item);
    }
  }
  return out;
}

/** Precision over labelled hits, or null where no hit landed on a labelled item. */
export function precisionOf(score: RuleScore): number | null {
  const labelled = score.truePositiveHits + score.falsePositiveHits;
  return labelled === 0 ? null : score.truePositiveHits / labelled;
}

/** Recall over the rule's own classes, or null where the corpus holds no positive of them. */
export function recallOf(score: RuleScore): number | null {
  return score.positives === 0 ? null : score.caught / score.positives;
}

/**
 * A rule's scores at each threshold its hits' strengths take: at `t`, a hit counts only where its
 * strength is at least `t`. Every threshold comes from one permissive run.
 */
export function sweep(rule: string, items: readonly Item[], trees: readonly TreeHits[]): SweepRow[] {
  const strengths = trees.flatMap((tree) =>
    tree.hits
      .filter((hit) => hit.rule === rule)
      .map((hit) => hit.strength)
      .filter(isNumber),
  );
  return [...new Set(strengths)]
    .toSorted((a, b) => a - b)
    .map((at) => {
      const keep = (hit: Hit): boolean => hit.rule !== rule || !isNumber(hit.strength) || hit.strength >= at;
      const score = scoreRules(items, trees, keep).get(rule) ?? scoreRules([], [], keep).get(rule);
      if (score === undefined) throw new Error(`no score for ${rule}`);
      return { at, score };
    });
}

/**
 * The threshold with the best recall at or above a precision floor, the higher threshold winning a
 * tie because it leaves fewer hits to read; null where no threshold reaches the floor.
 */
export function recommended(rows: readonly SweepRow[], floor: number): SweepRow | null {
  const passing = rows.filter((row) => (precisionOf(row.score) ?? 0) >= floor);
  return (
    passing.toSorted((a, b) => (recallOf(b.score) ?? 0) - (recallOf(a.score) ?? 0) || b.at - a.at)[0] ?? null
  );
}
