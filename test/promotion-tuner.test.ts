// Replay follows the selected tree's rule, including historical records.
import { expect, it } from "bun:test";
import { campaignLines, emptyTotals } from "#skills/promotion-tuner/scripts/replay.ts";
import { epochLines } from "#skills/promotion-tuner/scripts/time.ts";
import { campaignLogs } from "#skills/main/logs.ts";
import { loadTree, type Tree } from "#skills/promotion-tuner/scripts/tree.ts";
import { type Paired, scored } from "../src/kernel/compare.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
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

function replay(
  tree: Tree,
  pairs: readonly Paired[],
  frontier: JsonObject = { ...scored(pairs), of: pairs.map(({ task }) => task) },
) {
  const events: LogEvent[] = [
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
    {
      at: "2026-10-26T00:01:00.000Z",
      kind: "harness.promoted",
      data: { from: "reference", harness: "candidate" },
    },
  ];
  const totals = emptyTotals();
  campaignLines(
    { ...tree, read: () => events, pairsReported: () => [...pairs], pairsOf: () => [...pairs] },
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

it("credits a won task to the measure that carried it, the bill where a tree before 2 November scored one", async () => {
  const own = await loadTree(ROOT);
  // A tree before 2 November also scored the bill: half the bill gave its whole 100 points.
  const tree: Tree = {
    ...own,
    weights: { ...own.weights, bill: 0.1 },
    points: (pair) => ({ ...own.points(pair), bill: pair.task === "rescued" ? 100 : 0 }),
  };
  // Valid in four solves of four against three, four times the reference's measure by a lower-is-
  // better objective, and billed half.
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

it("keeps stored scores, which a tree that scores no bill reads as they stand", async () => {
  const tree = await loadTree(ROOT);
  const differences = Array.from({ length: 6 }, () => 600);
  for (const of of [undefined, CHEAP.map(({ task }) => task)]) {
    for (const unbilled of [undefined, differences]) {
      const frontier = { differences, ...keyIfDefined("of", of), ...keyIfDefined("unbilled", unbilled) };
      const totals = replay(tree, [], frontier);
      expect(totals.storedTasks).toBe(6);
      expect(totals.rightful + totals.doubted).toBe(1);
    }
  }
});

it("uses a candidate tree's own stepOf without requiring a readsStep export", async () => {
  const home = mkdtempSync(join(tmpdir(), "ana-tuner-tree-"));
  try {
    // Six tasks the new harness answers and the reference does not: the tree's own rule decides.
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
          "export const { WEIGHTS, flipP, pairsOf, pointsOf, readsStepEitherWay } = real;\n" +
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

it("finds the logs of a folder of worktrees, of an archive's host folder and of the archive, the largest copy of each", async () => {
  const home = mkdtempSync(join(tmpdir(), "ana-tuner-logs-"));
  try {
    const put = (dir: string, text: string, seed = false) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "log.jsonl"), text);
      if (seed) writeFileSync(join(dir, "seed.json"), "{}");
    };
    // Each line carries a time, as every event does: the fleet is the logs whose last one is recent.
    const EVENT = `{"at":"2026-11-01T00:00:00.000Z"}\n`;
    put(join(home, "anabasis-a", ".ana", "d2", "camp"), EVENT);
    put(join(home, "m1", "camp"), EVENT + EVENT);
    put(join(home, "m1", "other"), EVENT);
    put(join(home, "m1", "seeded"), EVENT, true);
    const found = await campaignLogs(home, [], "");
    expect(found.map(({ name }) => name)).toEqual(["camp", "other"]);
    expect(found[0]?.path).toBe(join(home, "m1", "camp", "log.jsonl"));
    expect((await campaignLogs(join(home, "m1"), ["other"], "")).map(({ name }) => name)).toEqual(["other"]);
    // A seed is left out of the fleet, and read where it is named: an investigation's snapshot holds
    // `seed.json`, and its derived replay asks for the campaign by name.
    expect((await campaignLogs(join(home, "m1"), ["seeded"], "")).map(({ name }) => name)).toEqual([
      "seeded",
    ]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

it("ends a draft cut short where the next draft starts, so the epoch's Examiner hours are the two drafts' own", async () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 26, 0, minutes)).toISOString();
  const events: LogEvent[] = [
    { at: at(0), kind: "draft.started", data: { session: "x-1" } },
    { at: at(30), kind: "draft.started", data: { session: "x-2" } },
    { at: at(60), kind: "draft.finished", data: { session: "x-2" } },
    { at: at(120), kind: "harness.promoted", data: { from: "reference", harness: "candidate" } },
  ];
  const { lines, promoted } = epochLines(await loadTree(ROOT), events, [3]);
  expect(promoted.map(({ hours }) => hours)).toEqual([2]);
  expect(lines.find((line) => line.includes("Examiner"))).toContain(
    "Examiner 2 sessions, 1.0 h (x-1 0.5, x-2 0.5)",
  );
});
