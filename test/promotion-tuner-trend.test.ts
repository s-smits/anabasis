// `trend.ts` sets the runs of the newest window against those of the windows before it, and
// `outside.ts` sets a benchmark's scores beside the promotions they belong to. Both describe the
// record and decide nothing; these tests hold the placing, the comparability rule, the verdicts
// and the join, each with its nearest hostile case.
import { afterAll, expect, it } from "bun:test";
import type { Promotion, Run } from "#skills/main/runs.ts";
import { outsideLines, type Score } from "#skills/promotion-tuner/scripts/outside.ts";
import { changeOf, type Measure, MEASURES } from "#skills/promotion-tuner/scripts/trend.ts";
import { mkdtempSync, realpathSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const DAY_MS = 86_400_000;

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
    firstAdmissible: 0.5,
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
    aaValidityControls: 0,
    aaValiditySteps: 0,
    aaObjectiveControls: 0,
    aaObjectiveSteps: 0,
    ending: "budget",
    ...rest,
  };
}
const five = (over: Parameters<typeof run>[0]) => Array.from({ length: 5 }, () => run(over));

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

const score = (arm: string, harness: string, task: string, points: number, of: string | null): Score => ({
  arm,
  harness,
  task,
  points,
  total: 50,
  of,
  cut: false,
});

/** The outside block's rows by arm, each a list of its cells. */
const outsideRows = (scores: readonly Score[], runs: readonly Run[]) =>
  new Map(
    outsideLines(scores, runs, "tsv")
      .join("\n")
      .split("\n")
      .slice(1)
      .map((row) => row.split("\t"))
      .map((cells) => [cells[0], cells] as const),
  );

it("bounds an arm by the sums of whole Starter rollouts, never by the Starter's worst and best of each task", () => {
  // Two Starter rollouts trade places on two tasks: each sums to 50, where the lower of each task
  // sums to 20 and the higher to 80, a spread no rollout had and one that every added rollout widens.
  const starter = [
    score("starter-a", "s", "t1", 10, "starter"),
    score("starter-a", "s", "t2", 40, "starter"),
    score("starter-b", "s", "t1", 40, "starter"),
    score("starter-b", "s", "t2", 10, "starter"),
    // A Starter arm that holds one of the two tasks has no sum over both, so its nought bounds neither.
    score("starter-void", "s", "t1", 0, "starter"),
    score("starter-other", "s", "t3", 30, "starter"),
  ];
  const arm = (name: string, tasks: readonly string[], points: number) =>
    tasks.map((task) => score(name, "d", task, points, null));
  const read = outsideRows(
    [
      ...starter,
      ...arm("under", ["t1", "t2"], 15),
      ...arm("over", ["t1", "t2"], 35),
      ...arm("level", ["t1", "t2"], 25),
      // On one task the arm that holds it alone counts beside the two that hold both.
      ...arm("single", ["t1"], 5),
      ...arm("lone", ["t3"], 30),
      // No Starter arm holds these two tasks together, so nothing bounds their sum.
      ...arm("apart", ["t1", "t3"], 15),
    ],
    [],
  );
  expect(read.get("under")?.slice(6, 9)).toEqual(["30/100", "50 to 50", "below"]);
  expect(read.get("over")?.slice(7, 9)).toEqual(["50 to 50", "above"]);
  expect(read.get("level")?.[8]).toBe("inside");
  expect(read.get("single")?.slice(6, 9)).toEqual(["5/50", "0 to 40", "inside"]);
  expect(read.get("lone")?.slice(7, 9)).toEqual(["30 to 30", "inside, one Starter rollout"]);
  expect(read.get("apart")?.slice(5, 9)).toEqual(["2", "30/100", "-", "-"]);
});
