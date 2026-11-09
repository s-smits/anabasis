/**
 * The implicit-state eval scores detector hits against a labelled corpus. These tests hold its
 * counting to a small corpus and hand-made hits: a hit on a positive is true, a hit on a negative of
 * the rule's own class is false, any other hit is unlabelled and listed once however many trees
 * hold it, and a sweep's recommendation is the best recall at the precision floor.
 */
import { describe, expect, it } from "bun:test";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { readFileSync } from "#src/meta/filesystem.ts";
import {
  CORPORA,
  parseCorpus,
  precisionOf,
  recallOf,
  recommended,
  rulesOn,
  scoreRules,
  sweep,
  type Item,
  type TreeHits,
} from "../tools/oxlint/eval/corpus.ts";
import type { Hit } from "../tools/oxlint/eval/detect.ts";
import { foreignRepos } from "../tools/oxlint/eval/trees.ts";
import type { JsonValue } from "#src/meta/json-shape.ts";

const COMMIT = "a".repeat(40);
const LOCK = "implicit-state/no-age-based-lock";
const PHASE = "implicit-state/no-marker-file-state";
const LATER = "b".repeat(40);

/** One corpus line: a positive `LOCK` item at lines 10 to 12, with `fields` laid over it. */
const row = (id: string, fields: Readonly<Partial<Record<string, JsonValue>>>): string =>
  capturedJsonStringify({
    id,
    repo: "demo",
    commit: COMMIT,
    file: "src/a.ts",
    lines: [10, 12],
    class: LOCK,
    label: "positive",
    verdict: "A file's age decides whether its holder lives.",
    source: "synthetic",
    ...fields,
  });

const hit = (rule: string, line: number, strength: number | null = null, file = "src/a.ts"): Hit => ({
  rule,
  tier: "generic",
  file,
  line,
  places: [{ file, line }],
  message: `${rule} at ${file}`,
  strength,
});

const tree = (hits: Hit[], commit = COMMIT): TreeHits => ({ key: { repo: "demo", commit }, hits });

const corpus: Item[] = parseCorpus(
  [
    row("lock", {}),
    row("age-filter", { lines: [40, 40], label: "negative" }),
    row("phase-files", { lines: [70, 70], class: PHASE, label: "negative" }),
  ].join("\n"),
);

describe("parseCorpus", () => {
  it("names each malformed, duplicated or unpaired line", () => {
    const text = [
      row("one", {}),
      row("one", {}),
      row("two", { class: "nonsense" }),
      row("three", { pair: "missing" }),
      row("four", { lines: [9, 3] }),
    ].join("\n");
    expect(() => parseCorpus(text)).toThrow(/4 bad lines/);
  });

  it("reads a well-formed line with its other ranges", () => {
    const [item] = parseCorpus(row("x", { also: [{ file: "src/b.ts", lines: [1, 2] }] }));
    expect(item?.also).toEqual([{ file: "src/b.ts", lines: [1, 2] }]);
  });
});

describe("scoreRules", () => {
  it("counts a hit on a positive as true and one on an own-class negative as false", () => {
    const score = scoreRules(corpus, [tree([hit(LOCK, 11), hit(LOCK, 41)])]).get(LOCK);
    expect(
      score && [
        score.caught,
        score.positives,
        score.truePositiveHits,
        score.falsePositiveHits,
        score.negativesHit,
      ],
    ).toEqual([1, 1, 1, 1, 1]);
    expect(score && precisionOf(score)).toBe(0.5);
    expect(score && recallOf(score)).toBe(1);
  });

  it("leaves a hit on another class's negative unlabelled rather than false", () => {
    const score = scoreRules(corpus, [tree([hit(LOCK, 70)])]).get(LOCK);
    expect(score && [score.falsePositiveHits, score.unlabelled.length]).toEqual([0, 1]);
  });

  it("lists an unlabelled site once although two trees hold it", () => {
    const later = tree([hit(LOCK, 200)], LATER);
    const score = scoreRules(corpus, [tree([hit(LOCK, 200)]), later]).get(LOCK);
    expect(score?.unlabelled).toHaveLength(1);
  });

  it("matches a hit within two lines of an item and not three", () => {
    const near = scoreRules(corpus, [tree([hit(LOCK, 14)])]).get(LOCK);
    const far = scoreRules(corpus, [tree([hit(LOCK, 15)])]).get(LOCK);
    expect([near?.caught, far?.caught]).toEqual([1, 0]);
  });

  it("credits another rule's catch as other-class, not as recall", () => {
    const score = scoreRules(corpus, [tree([hit(PHASE, 11)])]).get(PHASE);
    expect(score && [score.caught, score.caughtOther, score.truePositiveHits]).toEqual([0, 1, 1]);
  });
});

describe("sweep and recommended", () => {
  const hits = [hit(LOCK, 11, 5), hit(LOCK, 41, 2)];

  it("drops the weaker false hit as the threshold rises", () => {
    const rows = sweep(LOCK, corpus, [tree(hits)]);
    expect(rows.map(({ at, score }) => [at, precisionOf(score)])).toEqual([
      [2, 0.5],
      [5, 1],
    ]);
  });

  it("takes the best recall that reaches the floor, or null", () => {
    const rows = sweep(LOCK, corpus, [tree(hits)]);
    expect(recommended(rows, 0.8)?.at).toBe(5);
    expect(recommended(rows, 0.4)?.at).toBe(5);
    expect(recommended(sweep(LOCK, corpus, [tree([hit(LOCK, 41, 2)])]), 0.8)).toBeNull();
  });
});

describe("the shipped corpus", () => {
  it("parses as one and names only this repository or a foreign one recorded with its head", () => {
    const items = parseCorpus(CORPORA.map((file) => readFileSync(file, "utf8")).join("\n"));
    const foreign = new Map(foreignRepos().map((one) => [one.name, one.head]));
    expect(
      [...new Set(items.map((item) => item.repo))].filter(
        (repo) => repo !== "anabasis" && !foreign.has(repo),
      ),
    ).toEqual([]);
    expect([...foreign.values()].filter((head) => !/^[0-9a-f]{40}$/u.test(head))).toEqual([]);
  });
});

describe("rulesOn", () => {
  it("names each rule that lands on an item once", () => {
    const [lock] = corpus;
    const hits = [
      hit(LOCK, 10),
      hit(LOCK, 12),
      hit(PHASE, 11),
      hit("implicit-state-opinionated/max-boolean-fields", 90),
    ];
    expect(lock && rulesOn(lock, tree(hits)).toSorted()).toEqual([LOCK, PHASE]);
  });
});
