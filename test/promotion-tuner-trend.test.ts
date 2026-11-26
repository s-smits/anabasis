// `trend.ts` sets the newest window's runs against earlier windows', and `outside.ts` sets a
// benchmark's scores beside their promotions; both describe the record and decide nothing.
import { afterAll, expect, it } from "bun:test";
import { loadRuns, type Promotion, type Run } from "#skills/main/runs.ts";
import { outsideLines, type Score, scoresOf } from "#skills/promotion-tuner/scripts/outside.ts";
import {
  changeOf,
  comparable,
  type Measure,
  MEASURES,
  windowsOf,
} from "#skills/promotion-tuner/scripts/trend.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfNotNull } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";

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
    aaLevels: [0.02],
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

it("prints each one-sided A/A false-step count beside its 95% exact bound and the honesty bar, pooled over the runs", () => {
  const pooled = [run({ controls: 107, aaSteps: 1 }), run({ controls: 100, aaSteps: 1 })];
  expect(MEASURES.aa.counts(pooled)).toBe("2/207 one-sided, 95% bound 3.0%, bar 4.0% at level 0.02: met");
  expect(MEASURES.aa.counts([run({ controls: 10 })])).toBe(
    "0/10 one-sided, 95% bound 25.9%, bar 4.0% at level 0.02: open",
  );
  const mixed = [...pooled, run({ controls: 30, aaLevels: [0.1] })];
  expect(MEASURES.aa.counts(mixed)).toBe(
    "2/237 one-sided, 95% bound 2.6%, bar 4.0% at level 0.02 (the least): met",
  );
  expect(MEASURES.aa.counts([run({ aaLevels: [] })])).toBe("0/0 one-sided, 95% bound 100.0%, no level");
});

it("reads a difference past the spread by the measure's own direction", () => {
  const [slow, fast] = [five({ active: 20 }), five({ active: 10 })];
  expect(changeOf(HOURS, slow, fast).verdict).toBe("moved, better");
  expect(changeOf(HOURS, fast, slow).verdict).toBe("moved, worse");
  expect(changeOf({ ...HOURS, better: "higher" }, slow, fast).verdict).toBe("moved, worse");
  expect(changeOf(HOURS, slow, fast).relative).toBeCloseTo(-0.5, 12);
});

it("reads no difference where the runs of one window differ as much among themselves", () => {
  const mixed = () => [10, 20, 10, 20, 15].map((active) => run({ active }));
  expect(changeOf(HOURS, mixed(), mixed()).verdict).toBe("within inter-run variance");
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

const score = (
  arm: string,
  task: string,
  points: number,
  of: string | null,
  over: Partial<Score> = {},
): Score => ({
  arm,
  harness: of === "starter" ? "s" : "d",
  task,
  runtime: "claude-code",
  tier: of === "starter" ? "baseStarter" : of === "base" ? "bareSolver" : "builtSolver",
  points,
  total: 50,
  criteriaPassed: null,
  criteriaTotal: null,
  solveUsd: 1,
  delivered: true,
  of: of === "starter" || of === "base" ? null : of,
  cut: false,
  ...over,
});

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
  // Two Starter rollouts trade places on two tasks: each sums to 50, where the per-task lower sums to
  // 20 and the higher to 80, a spread no rollout had.
  const starter = [
    score("starter-a", "t1", 10, "starter"),
    score("starter-a", "t2", 40, "starter"),
    score("starter-b", "t1", 40, "starter"),
    score("starter-b", "t2", 10, "starter"),
    // A Starter arm that holds one of the two tasks has no sum over both, so its nought bounds neither.
    score("starter-void", "t1", 0, "starter"),
    score("starter-other", "t3", 30, "starter"),
    score("starter-crash", "t3", 0, "starter", { delivered: false }),
  ];
  const arm = (name: string, tasks: readonly string[], points: number) =>
    tasks.map((task) => score(name, task, points, null));
  const read = outsideRows(
    [
      ...starter,
      ...arm("under", ["t1", "t2"], 15),
      ...arm("over", ["t1", "t2"], 35),
      ...arm("level", ["t1", "t2"], 25),
      ...arm("single", ["t1"], 5),
      ...arm("lone", ["t3"], 30),
      // No Starter arm holds these two tasks together, so nothing bounds their sum.
      ...arm("apart", ["t1", "t3"], 15),
    ],
    [],
  );
  expect(read.get("under")?.slice(7, 13)).toEqual([
    "30/100",
    "-",
    "2.00",
    "baseStarter",
    "50 to 50",
    "below",
  ]);
  expect(read.get("over")?.slice(11, 13)).toEqual(["50 to 50", "above"]);
  expect(read.get("level")?.[12]).toBe("inside");
  expect(read.get("single")?.slice(7, 13)).toEqual(["5/50", "-", "1.00", "baseStarter", "0 to 40", "inside"]);
  expect(read.get("lone")?.slice(10, 13)).toEqual([
    "baseStarter",
    "30 to 30",
    "inside, one baseStarter rollout",
  ]);
  expect(read.get("apart")?.slice(6, 13)).toEqual(["2", "30/100", "-", "2.00", "-", "-", "-"]);
});

it("stratifies baselines by runtime and solver tier, persists criteria and solve spend, and excludes undelivered crashes", () => {
  const store = join(home, "outside-base");
  const put = (arm: string, buildOf: string, points: number, extra: JsonObject = {}) => {
    mkdirSync(join(store, "judged", arm), { recursive: true });
    writeFileSync(
      join(store, "judged", arm, "t1.json"),
      `${JSON.stringify({
        arm,
        task: "t1",
        harness: "h",
        runtime: "pi-durable",
        points,
        total: 50,
        criteriaPassed: 8,
        criteriaTotal: 10,
        solveUsd: 1.25,
        delivered: true,
        build: { of: buildOf, usd: 0 },
        ...extra,
      })}\n`,
    );
  };
  put("pi-a1", "jobstat-run", 40);
  put("base-pi-a1", "base", 30);
  put("starter-pi-a1", "starter", 45);
  put("starter-cc-only", "starter", 10, { runtime: "claude-code" });
  put("starter-pi-crash", "starter", 0, { delivered: false });
  put("pi-lone", "jobstat-run", 20, { runtime: "other-rt" });
  const loaded = scoresOf(store);
  const rows = outsideRows(loaded, []);
  expect(rows.has("base-pi-a1")).toBe(false);
  expect(rows.has("starter-pi-a1")).toBe(false);
  expect(rows.has("starter-cc-only")).toBe(false);
  expect(rows.get("pi-a1")?.slice(1, 2)).toEqual(["pi-durable"]);
  expect(rows.get("pi-a1")?.slice(7, 13)).toEqual([
    "40/50",
    "8/10",
    "1.25",
    "bareSolver",
    "30 to 30",
    "above, one bareSolver rollout",
  ]);
  expect(rows.get("pi-lone")?.slice(10, 13)).toEqual(["-", "-", "-"]);
});

const REPO = resolve(import.meta.dir, "..");
const WIN_DIFFS = [-600, -600, -600, -600, -600, -600];
const LOSS_DIFFS = [600, 600, 600, 600, 600, 600];

function writeLog(dir: string, name: string, events: readonly LogEvent[]): void {
  const folder = join(dir, name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "log.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

function openingEvents(judged: boolean, reviewer: string | null = "openai/gpt-5.4"): LogEvent[] {
  return [
    {
      at: "2026-11-25T00:00:00.000Z",
      kind: "campaign.opened",
      data: {
        judged,
        solver: { model: "claude/claude-opus-5-5", effort: "medium" },
        seats: {
          builder: { model: "claude/claude-opus-5-5", effort: "medium" },
          examiner: { model: "claude/claude-opus-5-5", effort: "medium" },
          ...keyIfNotNull("reviewer", reviewer === null ? null : { model: reviewer, effort: "medium" }),
        },
      },
    },
    {
      at: "2026-11-25T00:01:00.000Z",
      kind: "campaign.setting",
      data: {
        solver: { model: "claude/claude-opus-5-5", effort: "medium" },
        minutes: 30,
        modelTurns: 20,
        target: 24,
        solves: 2,
      },
    },
  ];
}

function starterReport(at: string, session: string, reference: string, diffs: readonly number[]): LogEvent[] {
  return [
    {
      at,
      kind: "comparison.started",
      data: { session, old: reference, fresh: "starter", starter: "starter" },
    },
    {
      at,
      kind: "comparison.reported",
      data: {
        session,
        old: reference,
        fresh: "starter",
        starter: "starter",
        level: 0.02,
        reading: "no-step",
        scored: { differences: [...diffs], wins: 0, losses: diffs.length, ties: 0, p: 1 },
      },
    },
  ];
}

it("matches reverted epochs accurately and separates judged runs in setting comparability", async () => {
  const runsDir = join(home, "reverted-and-judged");
  writeLog(runsDir, "buf-reverted", [
    ...openingEvents(false),
    { at: "2026-11-25T00:10:00.000Z", kind: "harness.promoted", data: { from: "starter", harness: "h1" } },
    ...starterReport("2026-11-25T00:20:00.000Z", "g-s1", "h1", WIN_DIFFS),
    { at: "2026-11-25T00:30:00.000Z", kind: "harness.promoted", data: { from: "h1", harness: "h2" } },
    { at: "2026-11-25T00:35:00.000Z", kind: "build.finished", data: { session: "b-old", billed: 50 } },
    ...starterReport("2026-11-25T00:40:00.000Z", "g-s2", "h2", LOSS_DIFFS),
    { at: "2026-11-25T00:45:00.000Z", kind: "harness.reverted", data: { from: "h2", harness: "h1" } },
    { at: "2026-11-25T00:48:00.000Z", kind: "build.finished", data: { session: "b-new", billed: 7 } },
    {
      at: "2026-11-25T00:50:00.000Z",
      kind: "comparison.reported",
      data: { session: "g-2", reading: "no-step" },
    },
    {
      at: "2026-11-25T00:55:00.000Z",
      kind: "comparison.reported",
      data: { session: "g-3", reading: "step" },
    },
    { at: "2026-11-25T01:00:00.000Z", kind: "harness.promoted", data: { from: "h1", harness: "h3" } },
    ...starterReport("2026-11-25T01:10:00.000Z", "g-s3", "h3", WIN_DIFFS),
  ]);
  const [bareOpened] = openingEvents(true, null);
  if (bareOpened === undefined) throw new Error("expected opening event");
  writeLog(runsDir, "job-judged-a", openingEvents(true, "openai/gpt-5.4"));
  writeLog(runsDir, "job-judged-b", openingEvents(true, "claude/claude-sonnet-5"));
  writeLog(runsDir, "job-judged-bare", [bareOpened]);
  const { runs } = await loadRuns({ home: runsDir, since: "2026-11-01", repo: REPO }, "unpriced");
  const byName = (wanted: string) => runs.find(({ name }) => name === wanted);
  const reverted = byName("buf-reverted");
  const judgedA = byName("job-judged-a");
  const judgedB = byName("job-judged-b");
  const judgedBare = byName("job-judged-bare");
  expect([reverted?.reads, reverted?.confirmed]).toEqual([3, 2]);
  expect(reverted?.promotions.map(({ confirmed }) => confirmed)).toEqual([true, false, true]);
  expect(reverted?.promotions[2]?.comparisons).toBe(2);
  expect(reverted?.promotions[2]?.epochElapsed).toBeCloseTo(0.25, 6);
  expect(reverted?.promotions[2]?.dollars).toBe(7);
  expect(judgedA?.setting).toContain("judged(openai/gpt-5.4)");
  expect(judgedB?.setting).toContain("judged(claude-sonnet-5)");
  expect(judgedBare?.setting).toBe("no setting judged");
  expect(reverted?.setting).not.toContain("judged");
  const [first, second] = windowsOf(runs, Date.parse("2026-11-26T00:00:00.000Z"), 7, 1);
  if (first === undefined || second === undefined) throw new Error("expected two windows");
  expect(
    comparable([
      { ...first, runs: judgedA === undefined ? [] : [judgedA] },
      { ...second, runs: reverted === undefined ? [] : [reverted] },
    ]).left,
  ).toBe(1);
  expect(
    comparable([
      { ...first, runs: judgedA === undefined ? [] : [judgedA] },
      { ...second, runs: judgedB === undefined ? [] : [judgedB] },
    ]).left,
  ).toBe(1);
});
