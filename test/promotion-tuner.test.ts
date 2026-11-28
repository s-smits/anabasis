import { expect, it } from "bun:test";
import { treeMechanism } from "#skills/promotion-tuner/scripts/panel.ts";
import { paired, selfTerms, type Task } from "#skills/promotion-tuner/scripts/record.ts";
import { campaignLines, emptyTotals } from "#skills/promotion-tuner/scripts/replay.ts";
import { epochLines } from "#skills/promotion-tuner/scripts/time.ts";
import { loadTree, type Tree } from "#skills/promotion-tuner/scripts/tree.ts";
import { type Paired, scored } from "../src/kernel/compare.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { execTextSync } from "./helpers/bun-spawn-sync.ts";

const ROOT = resolve(import.meta.dir, "..");
const CHEAP: Paired[] = Array.from({ length: 6 }, (_, at) => ({
  task: `v${String(at)}`,
  old: [true, true],
  fresh: [true, true],
  used: { old: [{ billed: 2 }, { billed: 2 }], fresh: [{ billed: 1 }, { billed: 1 }] },
}));

interface Record {
  readonly before?: readonly LogEvent[];
  readonly promoted?: boolean;
  readonly aa?: readonly Paired[];
}

function replay(
  tree: Tree,
  pairs: readonly Paired[],
  { before = [], promoted = true, aa = pairs }: Record = {},
) {
  const frontier: JsonObject = { ...scored(pairs), of: pairs.map(({ task }) => task) };
  const events: LogEvent[] = [
    ...before,
    {
      at: "2026-10-26T00:00:00.000Z",
      kind: "comparison.reported",
      data: {
        session: "g-1",
        old: "reference",
        fresh: "candidate",
        setting: "s",
        solves: 4,
        versions: pairs.map(({ task }) => task),
        frontier,
        retained: "unmeasured",
        scored: scored(pairs),
        level: 0.02,
        reading: "step",
        points: { validity: 0, objective: 0, bill: 600 },
      },
    },
    ...(promoted
      ? [
          {
            at: "2026-10-26T00:01:00.000Z",
            kind: "harness.promoted" as const,
            data: { from: "reference", harness: "candidate" },
          },
        ]
      : []),
  ];
  const totals = emptyTotals();
  campaignLines(
    { ...tree, read: () => events, pairsReported: () => [...pairs], pairsOf: () => [...aa] },
    { name: "recorded", path: "unused" },
    totals,
  );
  return totals;
}

it("promotes and diagnoses A/A steps by the tree's own rule", async () => {
  const tree = await loadTree(ROOT);
  for (const [pairs, steps] of [
    [CHEAP, 0],
    [CHEAP.map((pair) => ({ ...pair, old: [false, false] })), 1],
  ] as const) {
    const totals = replay(tree, pairs);
    expect([totals.rightful + totals.doubted, totals.dropped, totals.aaSteps]).toEqual([
      steps,
      1 - steps,
      steps,
    ]);
  }
});

it("counts an A/A false step one-sided, as a promotion reads, over the A/As that could read one", async () => {
  const tree = await loadTree(ROOT);
  const lean = (fresh: boolean) =>
    CHEAP.map((pair) => ({ ...pair, old: [!fresh, !fresh], fresh: [fresh, fresh] }));
  const read = (aa: readonly Paired[]) => {
    const { controls, powered, aaSteps } = replay(tree, CHEAP, { aa });
    return [controls, powered, aaSteps];
  };
  expect([read(lean(true)), read(lean(false)), read(CHEAP.slice(0, 2))]).toEqual([
    [1, 1, 1],
    [1, 1, 0],
    [1, 0, 0],
  ]);
});

it("reads a starter read's step as no promotion, though the new side won every task", async () => {
  const tree = await loadTree(ROOT);
  const won = CHEAP.map((pair) => ({ ...pair, old: [false, false] }));
  const started = (starter: string): LogEvent => ({
    at: "2026-10-25T23:59:00.000Z",
    kind: "comparison.started",
    data: { session: "g-1", old: "reference", fresh: "candidate", starter },
  });
  const added = (starter: string) => replay(tree, won, { before: [started(starter)], promoted: false }).added;
  expect([added("candidate"), added("elsewhere")]).toEqual([0, 1]);
});

it("credits a won task to the measure that carried it, the bill where a tree before 2 November scored one", async () => {
  const own = await loadTree(ROOT);
  // An older tree also scored the bill: half the bill gave its whole 100 points.
  const tree: Tree = {
    ...own,
    weights: { ...own.weights, bill: 0.1 },
    points: (pair) => ({ ...own.points(pair), bill: pair.task === "rescued" ? 350 : 0 }),
  };
  // Valid in four solves of four against three, four times the reference's measure on a lower-is-better
  // objective, and billed half.
  const rescued: Paired = {
    task: "rescued",
    old: [false, true, true, true],
    fresh: [true, true, true, true],
    objective: { direction: "lower", old: [null, 1000, 1000, 1000], fresh: [4000, 4000, 4000, 4000] },
    used: {
      old: Array.from({ length: 4 }, () => ({ billed: 2 })),
      fresh: Array.from({ length: 4 }, () => ({ billed: 1 })),
    },
  };
  const { validity, objective, bill } = tree.points(rescued);
  expect([validity + objective + bill, validity + objective, validity].map(Math.sign)).toEqual([1, -1, 1]);
  expect(own.points(rescued).bill).toBe(0);
  const won: Paired[] = CHEAP.map(({ task }) => ({
    task,
    old: [false, false, false, false],
    fresh: [true, true, true, true],
  }));
  const totals = replay(tree, [...won, rescued]);
  expect(totals.rightful + totals.doubted).toBe(1);
  expect(totals.wonBy).toEqual({ validity: 6, objective: 0, bill: 1 });
});

it("uses a candidate tree's own stepOf without requiring a isSignificant export", async () => {
  const home = mkdtempSync(join(tmpdir(), "ana-tuner-tree-"));
  try {
    const won = CHEAP.map((pair) => ({ ...pair, old: [false, false] }));
    for (const [rule, steps] of [
      ['() => "no-step"', 0],
      ['(report, level) => real.flipP(report.frontier.differences) <= level ? "step" : "no-step"', 1],
    ] as const) {
      const tree = mkdtempSync(join(home, "tree-"));
      mkdirSync(join(tree, "src", "kernel"), { recursive: true });
      for (const file of ["log.ts", "reports.ts", "meter.ts", "trace.ts"]) {
        writeFileSync(
          join(tree, "src", "kernel", file),
          `export * from "${join(ROOT, "src", "kernel", file)}";\n`,
        );
      }
      writeFileSync(
        join(tree, "src", "kernel", "compare.ts"),
        `import * as real from "${join(ROOT, "src", "kernel", "compare.ts")}";\n` +
          "export const { flipP, pairsOf, pointsOf } = real;\n" +
          `export const stepOf = ${rule};\n`,
      );
      execTextSync("git", ["-C", tree, "init", "-q"]);
      execTextSync("git", [
        "-C",
        tree,
        "-c",
        "user.email=t@t",
        "-c",
        "user.name=t",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "t",
      ]);
      const totals = replay(await loadTree(tree), won);
      expect(totals.rightful + totals.doubted).toBe(steps);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

it("loads a pre-rename worktree exporting readsStep without isSignificant", async () => {
  const home = mkdtempSync(join(tmpdir(), "ana-tuner-legacy-"));
  try {
    const won = CHEAP.map((pair) => ({ ...pair, old: [false, false] }));
    const tree = mkdtempSync(join(home, "tree-"));
    mkdirSync(join(tree, "src", "kernel"), { recursive: true });
    for (const file of ["log.ts", "reports.ts", "meter.ts", "trace.ts"]) {
      writeFileSync(
        join(tree, "src", "kernel", file),
        `export * from "${join(ROOT, "src", "kernel", file)}";\n`,
      );
    }
    writeFileSync(
      join(tree, "src", "kernel", "compare.ts"),
      `import * as real from "${join(ROOT, "src", "kernel", "compare.ts")}";\n` +
        "export const { flipP, pairsOf, pointsOf } = real;\n" +
        "export const readsStep = real.isSignificant;\n",
    );
    execTextSync("git", ["-C", tree, "init", "-q"]);
    execTextSync("git", [
      "-C",
      tree,
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "t",
    ]);
    const loaded = await loadTree(tree);
    const totals = replay(loaded, won);
    expect(totals.rightful + totals.doubted).toBe(1);
    expect(replay(loaded, CHEAP).dropped).toBe(1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

it("attributes judged pair, draft-audit, and unfinished referee turns without charging builder", async () => {
  const tree = await loadTree(ROOT);
  const turn = (at: string, reader: string, total: number): LogEvent => ({
    at,
    kind: "referee.turn",
    data: { reader, turn: 1, usage: { input: 0, output: 0, cost: { total } } },
  });
  const events: LogEvent[] = [
    { at: "2026-11-26T00:00:00.000Z", kind: "draft.started", data: { session: "d-1" } },
    turn("2026-11-26T00:02:00.000Z", "r-d", 3),
    {
      at: "2026-11-26T00:05:00.000Z",
      kind: "referee.draft",
      data: { session: "d-1", reader: "r-d", billed: 3 },
    },
    turn("2026-11-26T00:05:30.000Z", "draft-d-1-2", 4),
    { at: "2026-11-26T00:06:00.000Z", kind: "draft.finished", data: { session: "d-1", billed: 2 } },
    { at: "2026-11-26T00:10:00.000Z", kind: "comparison.started", data: { session: "g-1" } },
    turn("2026-11-26T00:15:00.000Z", "j-1:report:ab", 12),
    {
      at: "2026-11-26T00:20:00.000Z",
      kind: "referee.pair",
      data: { comparison: "g-1", reader: "j-1", readers: ["j-1:report:ab"], billed: 12 },
    },
    turn("2026-11-26T00:22:00.000Z", "judge-open:holistic:ab", 6),
    turn("2026-11-26T00:23:00.000Z", "reader-open", 1.5),
    { at: "2026-11-26T00:25:00.000Z", kind: "comparison.reported", data: { session: "g-1" } },
    { at: "2026-11-26T00:26:00.000Z", kind: "harness.promoted", data: { from: "a", harness: "b" } },
  ];
  const { lines } = epochLines(tree, events, [events.length - 1]);
  expect(lines.find((line) => line.includes("Examiner"))).toContain("$9.00");
  expect(lines.find((line) => line.includes("comparisons"))).toContain("$18.00");
  expect(lines.find((line) => line.includes("Builder alone"))).toContain("$0.00");
  expect(lines.find((line) => line.includes("Builder alone"))).toContain("unattributed referee $1.50");
});

it("excludes dedicated noise A/A comparisons from candidate promotions while keeping their A/A controls", async () => {
  const tree = await loadTree(ROOT);
  const won = CHEAP.map((pair) => ({ ...pair, old: [false, false] }));
  const events: LogEvent[] = [
    {
      at: "2026-11-26T00:00:00.000Z",
      kind: "comparison.started",
      data: { session: "g-noise", old: "ref", fresh: "ref", starter: "starter", noise: true },
    },
    {
      at: "2026-11-26T00:05:00.000Z",
      kind: "comparison.reported",
      data: {
        session: "g-noise",
        old: "ref",
        fresh: "ref",
        starter: "starter",
        setting: "s",
        solves: 2,
        versions: won.map(({ task }) => task),
        frontier: { ...scored(won), of: won.map(({ task }) => task) },
        retained: "unmeasured",
        scored: scored(won),
        level: 0.02,
        reading: "no-step",
        points: { validity: 0, objective: 0 },
      },
    },
  ];
  const totals = emptyTotals();
  campaignLines(
    { ...tree, read: () => events, pairsReported: () => [...won], pairsOf: () => [...won] },
    { name: "noise-only", path: "unused" },
    totals,
  );
  expect([totals.added, totals.toStep, totals.controls, totals.powered, totals.aaSteps]).toEqual([
    0, 0, 1, 1, 1,
  ]);
});

it("keeps per-half solves on starter-noise comparisons in selfTerms", () => {
  const events: LogEvent[] = [
    {
      at: "2026-11-26T00:00:00.000Z",
      kind: "comparison.started",
      data: { session: "g-n", old: "ref", fresh: "ref", noise: true },
    },
  ];
  const terms = selfTerms(events, {
    session: "g-n",
    index: 1,
    data: { session: "g-n", old: "ref", fresh: "ref", setting: "s", solves: 3 },
  });
  expect(terms?.solves).toBe(3);
  expect(
    selfTerms([], {
      session: "g-c",
      index: 1,
      data: { session: "g-c", old: "ref", fresh: "cand", setting: "s", solves: 3 },
    }),
  ).toBeNull();
});

it("scores judged unit-scale tasks through treeMechanism and reconciles via replay --try", async () => {
  const tree = await loadTree(ROOT);
  const mechanism = treeMechanism(tree, "tree");
  const judgedTask: Task = {
    task: "t-j",
    family: "fam",
    direction: "higher",
    scale: "unit",
    judged: {
      weights: { code: 1, judge: 1 },
      votes: [
        { fresh: 0, old: 0, judge: 1, holistic: 1 },
        { fresh: 1, old: 1, judge: 1, holistic: 0.5 },
      ],
    },
    retained: false,
    old: [
      { valid: true, measure: 0.5, billed: 1, turns: 5, seconds: 10 },
      { valid: true, measure: 0.5, billed: 1, turns: 5, seconds: 10 },
    ],
    fresh: [
      { valid: true, measure: 0.5, billed: 1, turns: 5, seconds: 10 },
      { valid: true, measure: 0.5, billed: 1, turns: 5, seconds: 10 },
    ],
  };
  const points = tree.points(paired(judgedTask));
  expect(mechanism.score(judgedTask)).toBe(Math.round(points.validity + points.objective + points.bill));
  expect(mechanism.score(judgedTask)).toBeGreaterThan(0);
  const logsDir = mkdtempSync(join(tmpdir(), "ana-tuner-panel-"));
  try {
    mkdirSync(join(logsDir, "empty-run"), { recursive: true });
    writeFileSync(
      join(logsDir, "empty-run", "log.jsonl"),
      `${JSON.stringify({ at: "2026-11-25T00:00:00.000Z", kind: "campaign.opened", data: { judged: true } })}\n`,
    );
    const out = execTextSync(process.execPath, [
      join(ROOT, ".claude/skills/promotion-tuner/scripts/replay.ts"),
      "--logs",
      logsDir,
      "--from",
      "2026-11-01",
      "--try",
      "test=flip",
    ]);
    expect(out).toContain("0 tasks, 0 differ");
    expect(out).toContain("test=flip");
  } finally {
    rmSync(logsDir, { recursive: true, force: true });
  }
});
