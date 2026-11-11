// `trend.ts` sets the runs of the newest window against those of the windows before it, and
// `outside.ts` sets a benchmark's scores beside the promotions they belong to. Both describe the
// record and decide nothing; these tests hold the placing, the comparability rule, the verdicts
// and the join, each with its nearest hostile case.
import { afterAll, expect, it } from "bun:test";
import type { Promotion, Run } from "#skills/main/runs.ts";
import { outsideLines, type Score, scoresOf } from "#skills/promotion-tuner/scripts/outside.ts";
import {
  changeOf,
  comparable,
  guardOf,
  type Measure,
  MEASURES,
  windowsOf,
} from "#skills/promotion-tuner/scripts/trend.ts";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { execTextSync } from "./helpers/bun-spawn-sync.ts";

const ROOT = resolve(import.meta.dir, "..");
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const UNTIL = Date.parse("2026-11-10T00:00:00.000Z");
const home = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-trend-")));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const promotion = (nth: number, harness: string, confirmed: boolean | null): Promotion => ({
  nth,
  harness,
  confirmed,
  elapsed: nth,
  active: nth,
  epochElapsed: 1,
  epochActive: 1,
  epochUnloaded: 1,
  dollars: 10,
  comparisons: 1,
  tally: "6-0-0 p 0.0156",
});

function run(over: Partial<Run> & { readonly promoted?: number }): Run {
  const { promoted = 0, ...rest } = over;
  return {
    name: "run",
    host: "here",
    release: "after v0.10.0",
    pack: "pack",
    setting: "setting",
    cores: null,
    load: null,
    solveSeconds: null,
    launched: UNTIL - DAY_MS,
    last: UNTIL,
    elapsed: 10,
    active: 10,
    unloaded: 10,
    live: false,
    firstCompared: 1,
    firstReported: 2,
    compared: promoted,
    promotions: Array.from({ length: promoted }, (_, at) => promotion(at + 1, `digest-${String(at)}`, null)),
    dollars: 100,
    repriced: null,
    unpriced: null,
    scored: 10,
    room: 1,
    stepped: promoted,
    onValidity: 0,
    reads: 0,
    confirmed: 0,
    after: { wins: 0, losses: 0, ties: 0 },
    controls: 0,
    aaSteps: 0,
    ending: "budget",
    ...rest,
  };
}
const five = (over: Parameters<typeof run>[0]) => Array.from({ length: 5 }, () => run(over));

it("places a run by the day it opened, and one that opened as a window ends in none of it", () => {
  const runs = [
    run({ name: "newest", launched: UNTIL - 1 }),
    run({ name: "at the edge", launched: UNTIL }),
    run({ name: "a week before", launched: UNTIL - 7 * DAY_MS - 1 }),
    run({ name: "on the boundary", launched: UNTIL - 7 * DAY_MS }),
    run({ name: "too old", launched: UNTIL - 30 * DAY_MS }),
  ];
  const windows = windowsOf(runs, UNTIL, 7, 1);
  expect(windows.map((window) => window.runs.map(({ name }) => name))).toEqual([
    ["newest", "on the boundary"],
    ["a week before"],
  ]);
});

it("keeps an earlier run only under a setting the newest window holds, and counts the rest", () => {
  const windows = windowsOf(
    [
      run({ name: "now", setting: "two solves" }),
      run({ name: "same", setting: "two solves", launched: UNTIL - 8 * DAY_MS }),
      run({ name: "other", setting: "three solves", launched: UNTIL - 8 * DAY_MS }),
    ],
    UNTIL,
    7,
    1,
  );
  const kept = comparable(windows);
  expect(kept.left).toBe(1);
  expect(kept.windows[1]?.runs.map(({ name }) => name)).toEqual(["same"]);
});

const HOURS: Measure = {
  factor: "climb",
  name: "active hours a run",
  better: "lower",
  of: (runs) => (runs.length === 0 ? null : runs.reduce((sum, { active }) => sum + active, 0) / runs.length),
  counts: (runs) => String(runs.length),
};

it("reads a difference past the spread by the measure's own direction", () => {
  const [slow, fast] = [five({ active: 20 }), five({ active: 10 })];
  expect(changeOf(HOURS, slow, fast).verdict).toBe("moved, better");
  expect(changeOf(HOURS, fast, slow).verdict).toBe("moved, worse");
  expect(changeOf({ ...HOURS, better: "higher" }, slow, fast).verdict).toBe("moved, worse");
  expect(changeOf(HOURS, slow, fast).relative).toBeCloseTo(-0.5, 12);
});

it("reads no difference where the runs of one window differ as much among themselves", () => {
  const mixed = () => [10, 20, 10, 20, 15].map((active) => run({ active }));
  expect(changeOf(HOURS, mixed(), mixed()).verdict).toBe("inside the spread");
});

it("refuses a verdict where the windows are too small, however far apart they are", () => {
  const few = (active: number) => Array.from({ length: 3 }, () => run({ active }));
  expect(changeOf(HOURS, few(100), few(1)).verdict).toBe("too few runs");
  expect(changeOf(HOURS, [], few(1)).verdict).toBe("no value");
  // Three against four has thirty-five deals and no mirror, so the record alone can read a step.
  expect(changeOf(HOURS, few(100), [...few(1), run({ active: 1 })]).verdict).toBe("moved, better");
});

it("reads too few runs where only the runs holding a denominator can be dealt apart", () => {
  // Three of eight runs hold a starter read: seventy deals exist, but none falls below a third.
  const read = (confirmed: number) => run({ reads: 1, confirmed });
  const then = [read(1), run({}), run({}), run({})];
  const now = [read(0), read(0), run({}), run({})];
  expect(changeOf(MEASURES.confirmed, then, now).verdict).toBe("too few runs");
});

it("names a faster climb that holds less as apart, and one that holds more as together", () => {
  const held = { reads: 1, confirmed: 1, after: { wins: 4, losses: 1, ties: 0 } };
  const lost = { reads: 1, confirmed: 0, after: { wins: 1, losses: 4, ties: 0 } };
  const [slow, fast] = [{ promoted: 1 }, { promoted: 3 }];
  expect(guardOf(five({ ...slow, ...held }), five({ ...fast, ...lost })).pattern).toBe("apart");
  expect(guardOf(five({ ...slow, ...lost }), five({ ...fast, ...held })).pattern).toBe("together");
  // The two holding counts disagree: confirmed fell while the tasks written after were won more.
  const split = { reads: 1, confirmed: 0, after: { wins: 5, losses: 0, ties: 0 } };
  expect(guardOf(five({ ...slow, ...held }), five({ ...fast, ...split })).pattern).toBe(
    "no single direction",
  );
  // A window whose promotions no starter comparison read cannot be set against one that has.
  expect(guardOf(five({ ...slow, ...held }), five(fast)).pattern).toBe("not read");
});

const score = (arm: string, harness: string, task: string, points: number, of: string | null): Score => ({
  arm,
  harness,
  task,
  points,
  total: 50,
  of,
  cut: false,
});

it("joins an arm to its promotion by digest and reads it against the Starter's spread", () => {
  const starter = [10, 20].flatMap((points) =>
    ["t1", "t2"].map((task) => score("starter", "s", task, points, "starter")),
  );
  const arm = (name: string, harness: string, points: number, of: string | null) =>
    ["t1", "t2"].map((task) => score(name, harness, task, points, of));
  const climbed = run({
    name: "campaign",
    promotions: [promotion(1, "first", true), promotion(2, "second", false)],
  });
  const rows = outsideLines(
    [
      ...starter,
      ...arm("above", "first", 25, "campaign"),
      // The record names no campaign: the digest alone finds the promotion.
      ...arm("inside", "second", 15, null),
      ...arm("below", "first", 5, "campaign"),
      ...arm("elsewhere", "unknown", 30, "another builder"),
      // A task no Starter rollout holds is left out of the arm's sum.
      score("above", "first", "t3", 50, "campaign"),
    ],
    [climbed],
    "tsv",
  )
    .join("\n")
    .split("\n")
    .slice(1)
    .map((row) => row.split("\t"));
  const read = new Map(rows.map((row) => [row[0], row]));
  expect(read.get("above")?.slice(2, 9)).toEqual([
    "1 of 2",
    "6-0-0 p 0.0156",
    "confirmed",
    "2",
    "50/100",
    "20 to 40",
    "above",
  ]);
  expect(read.get("inside")?.[2]).toBe("2 of 2");
  expect(read.get("inside")?.[4]).toBe("not confirmed");
  expect(read.get("inside")?.[8]).toBe("inside");
  expect(read.get("below")?.[8]).toBe("below");
  expect(read.get("elsewhere")?.[1]).toBe("-");
  expect(read.get("elsewhere")?.[4]).toBe("-");
  // A Starter arm is the baseline and takes no row.
  expect(read.get("starter")).toBeUndefined();
});

it("reads a store's judged records, and none from a judgement that left no points", () => {
  const store = join(home, "store");
  const judged = (arm: string, file: string, record: JsonObject) => {
    mkdirSync(join(store, "judged", arm), { recursive: true });
    writeFileSync(join(store, "judged", arm, file), JSON.stringify(record));
  };
  judged("starter", "t1.json", {
    arm: "starter",
    harness: "s",
    task: "t1",
    points: 10,
    total: 50,
    build: { of: "starter", usd: 0 },
    cut: [],
  });
  judged("arm", "t1.json", { arm: "arm", harness: "d", task: "t1", points: 30, total: 50, cut: ["a file"] });
  judged("arm", "t2.json", { arm: "arm", harness: "d", task: "t2", error: "the judge failed" });
  writeFileSync(join(store, "judged", "a stray file"), "{}");
  expect(scoresOf(store)).toEqual([
    { arm: "arm", harness: "d", task: "t1", points: 30, total: 50, of: null, cut: true },
    { arm: "starter", harness: "s", task: "t1", points: 10, total: 50, of: "starter", cut: false },
  ]);
  expect(() => scoresOf(join(home, "no store"))).toThrow();
});

it("reads two campaigns under one folder into the windows they opened in", () => {
  const campaignAt = (name: string, opened: string) => {
    mkdirSync(join(home, "runs", name), { recursive: true });
    const events = [
      { at: opened, kind: "campaign.opened", data: { project: "p", budget: { dollars: 10, reserve: 1 } } },
      {
        at: new Date(Date.parse(opened) + 3_600_000).toISOString(),
        kind: "campaign.ended",
        data: { ending: "budget", why: "w" },
      },
    ];
    writeFileSync(
      join(home, "runs", name, "log.jsonl"),
      events.map((event) => `${JSON.stringify(event)}\n`).join(""),
    );
  };
  campaignAt("pack-fresh-this-week", "2026-11-08T00:00:00.000Z");
  campaignAt("pack-fresh-last-week", "2026-11-01T00:00:00.000Z");
  const out = execTextSync(
    "bun",
    [
      ".claude/skills/promotion-tuner/scripts/trend.ts",
      "--runs",
      join(home, "runs"),
      "--until",
      "2026-11-10T00:00:00.000Z",
      "--format",
      "tsv",
    ],
    { cwd: ROOT, env: { ...Bun.env, ANA_HOSTS: undefined } },
  );
  const [head, first] = out
    .trim()
    .split("\n")
    .map((row) => row.split("\t"));
  // The window two back holds no run and takes no column.
  expect(head?.slice(3)).toEqual(["now", "1 back", "now against 1 back"]);
  // Neither campaign reported a comparison, one run a window.
  expect(first?.slice(3, 5)).toEqual(["0.00 (0/1)", "0.00 (0/1)"]);
});

/** A campaign's log under `folder`: it opens at `opened`, and each later event is at its hours. */
function logAt(folder: string, opened: string, later: readonly (readonly [number, string, JsonObject])[]) {
  mkdirSync(folder, { recursive: true });
  const at = (hours: number) => new Date(Date.parse(opened) + hours * HOUR_MS).toISOString();
  const events = [
    { at: opened, kind: "campaign.opened", data: { project: "p", budget: { dollars: 10, reserve: 1 } } },
    ...later.map(([hours, kind, data]) => ({ at: at(hours), kind, data })),
  ];
  writeFileSync(join(folder, "log.jsonl"), events.map((event) => `${JSON.stringify(event)}\n`).join(""));
}
const trendOf = (folder: string, format: "md" | "tsv") =>
  execTextSync(
    "bun",
    [
      ".claude/skills/promotion-tuner/scripts/trend.ts",
      "--runs",
      folder,
      "--until",
      "2026-11-10T00:00:00.000Z",
      "--back",
      "1",
      "--format",
      format,
    ],
    { cwd: ROOT, env: { ...Bun.env, ANA_HOSTS: undefined } },
  );
const promotedAt = (hours: number, harness: string) => [hours, "harness.promoted", { harness }] as const;
const movedAt = (hours: number) => [hours, "campaign.move", { move: "build" }] as const;

it("reads every run at the hours the youngest newest run has lasted, so a young window gains nothing by youth", () => {
  const folder = join(home, "horizon");
  // The week before: five runs that promoted at 7 h and again at 20 h, and ran 48 h to their budget.
  for (const nth of [1, 2, 3, 4, 5]) {
    logAt(join(folder, `pack-then-${String(nth)}`), `2026-10-28T0${String(nth)}:00:00.000Z`, [
      promotedAt(7, "h1"),
      promotedAt(20, "h2"),
      [48, "campaign.ended", { ending: "budget", why: "w" }],
    ]);
  }
  // The newest week: four runs paused at 8 h, one of which promoted at 6 h, and one cut at 2 h.
  for (const nth of [1, 2, 3, 4]) {
    logAt(join(folder, `pack-now-${String(nth)}`), `2026-11-0${String(nth + 4)}T00:00:00.000Z`, [
      ...(nth === 1 ? [promotedAt(6, "h1")] : []),
      movedAt(8),
    ]);
  }
  logAt(join(folder, "pack-now-young"), "2026-11-09T00:00:00.000Z", [movedAt(2)]);
  const rows = new Map(
    trendOf(folder, "tsv")
      .trim()
      .split("\n")
      .map((row) => row.split("\t"))
      .map((row) => [row[2], row.slice(3)]),
  );
  // At 8 h each earlier run had promoted once in 8 hours, not ten times in 240.
  expect(rows.get("promotions a 100 active hours")?.slice(0, 2)).toEqual(["3.13 (1/32)", "12.5 (5/40)"]);
  expect(rows.get("runs promoted by the horizon")).toEqual([
    "0.25 (1/4)",
    "1.00 (5/5)",
    "-75%, p 0.048, moved, worse",
  ]);
  // No earlier run had reached its second promotion by 8 h.
  expect(rows.get("hours a rung")?.[1]).toBe("-");
  expect(trendOf(folder, "md")).toContain(
    "Read at 8.0 hours from each run's first event, the least a newest run cut short has lasted past 6 h; 1 run cut short sooner is left out.",
  );
});

it("repeats a reading with --until when the log has grown since", () => {
  const folder = join(home, "until");
  const log = join(folder, "pack-now", "log.jsonl");
  logAt(join(folder, "pack-now"), "2026-11-08T00:00:00.000Z", [promotedAt(5, "h1"), movedAt(10)]);
  const before = trendOf(folder, "md");
  appendFileSync(
    log,
    `${JSON.stringify({ at: "2026-11-11T00:00:00.000Z", kind: "harness.promoted", data: { harness: "h2" } })}\n`,
  );
  expect(trendOf(folder, "md")).toBe(before);
});
