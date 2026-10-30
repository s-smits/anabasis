// Replay follows the selected tree's rule, including historical records and weight sweeps.
import { expect, it } from "bun:test";
import { campaignLines, emptyTotals } from "#skills/promotion-tuner/scripts/replay.ts";
import { campaignLogs, loadTree, type Tree } from "#skills/promotion-tuner/scripts/tree.ts";
import { type Paired, scored, scoresOf } from "../src/kernel/compare.ts";
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
  scale = { validity: 1, objective: 1, bill: 1 },
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
    {
      tree: { ...tree, read: () => events, pairsReported: () => [...pairs], pairsOf: () => [...pairs] },
      scale,
      own: false,
      level: null,
    },
    { name: "recorded", path: "unused" },
    totals,
  );
  return totals;
}

it("promotes and diagnoses A/A steps only when both tests pass under the requested weights", async () => {
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
    const scaled = replay(tree, pairs, undefined, { validity: 0, objective: 1, bill: 1 });
    expect([scaled.rightful + scaled.doubted, scaled.aaSteps]).toEqual([0, 0]);
  }
});

it("credits a won task to the measure that carried it, the bill where the score without it loses", async () => {
  const tree = await loadTree(ROOT);
  // Valid in four solves of four against three, worse by 9% on the objective and billed half.
  const rescued: Paired = {
    task: "rescued",
    old: [false, true, true, true],
    fresh: [true, true, true, true],
    objective: { direction: "lower", old: [null, 1000, 1000, 1000], fresh: [1090, 1090, 1090, 1090] },
    used: {
      old: Array.from({ length: 4 }, () => ({ billed: 2 })),
      fresh: Array.from({ length: 4 }, () => ({ billed: 1 })),
    },
  };
  const one = scoresOf(tree.points(rescued));
  expect([one.scored, one.unbilled, one.validity].map(Math.sign)).toEqual([1, -1, 1]);
  const won: Paired[] = CHEAP.map(({ task }) => ({
    task,
    old: [false, false, false, false],
    fresh: [true, true, true, true],
  }));
  const totals = replay(tree, [...won, rescued]);
  expect(totals.rightful + totals.doubted).toBe(1);
  expect(totals.wonBy).toEqual({ validity: 6, objective: 0, bill: 1 });
});

it("keeps stored scores but requires complete evidence without cost to replay a step", async () => {
  const tree = await loadTree(ROOT);
  const differences = Array<number>(6).fill(600);
  for (const of of [undefined, CHEAP.map(({ task }) => task)]) {
    for (const unbilled of [undefined, differences]) {
      const frontier = { differences, ...keyIfDefined("of", of), ...keyIfDefined("unbilled", unbilled) };
      const totals = replay(tree, [], frontier);
      expect(totals.storedTasks).toBe(6);
      expect(totals.rightful + totals.doubted).toBe(unbilled === undefined ? 0 : 1);
    }
  }
});

it("uses a candidate tree's own stepOf without requiring a readsStep export", async () => {
  const home = mkdtempSync(join(tmpdir(), "ana-tuner-tree-"));
  try {
    for (const [rule, steps] of [
      ["real.stepOf", 0],
      ['(report, level) => real.flipP(report.frontier.differences) <= level ? "step" : "no-step"', 1],
    ] as const) {
      const tree = mkdtempSync(join(home, "tree-"));
      mkdirSync(join(tree, "src", "kernel"), { recursive: true });
      for (const file of ["log.ts", "reports.ts", "trace.ts"]) {
        writeFileSync(
          join(tree, "src", "kernel", file),
          `export * from "${join(ROOT, "src", "kernel", file)}";\n`,
        );
      }
      writeFileSync(
        join(tree, "src", "kernel", "compare.ts"),
        `import * as real from "${join(ROOT, "src", "kernel", "compare.ts")}";\n` +
          "export const { WEIGHTS, flipP, measuresIn, pairsOf, pointsOf, readsStepEitherWay } = real;\n" +
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
      const totals = replay(await loadTree(tree), CHEAP);
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
    put(join(home, "anabasis-a", ".ana", "d2", "camp"), "{}\n");
    put(join(home, "m1", "camp"), "{}\n{}\n");
    put(join(home, "m1", "other"), "{}\n");
    put(join(home, "m1", "seeded"), "{}\n", true);
    const found = await campaignLogs(home, [], "");
    expect(found.map(({ name }) => name)).toEqual(["camp", "other"]);
    expect(found[0]?.path).toBe(join(home, "m1", "camp", "log.jsonl"));
    expect((await campaignLogs(join(home, "m1"), ["other"], "")).map(({ name }) => name)).toEqual(["other"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
