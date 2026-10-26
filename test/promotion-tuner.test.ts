// The tuner's replay uses the kernel's dual step rule under its requested weights, for both
// promotions and mirrored A/A controls. Pairs enter through the tree's real interface, without a log file.
import { expect, it } from "bun:test";
import { campaignLines, emptyTotals } from "#skills/promotion-tuner/scripts/replay.ts";
import { loadTree } from "#skills/promotion-tuner/scripts/tree.ts";
import { type Paired, scored } from "../src/kernel/compare.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { resolve } from "../src/meta/path.ts";

it("replays no promotion or A/A step where only the scored test clears, and a step where both clear", async () => {
  const kernel = await loadTree(resolve(import.meta.dir, ".."));
  const cheap: Paired[] = Array.from({ length: 6 }, (_, at) => ({
    task: `v${String(at)}`,
    old: [true, true],
    fresh: [true, true],
    used: { old: [{ billed: 2 }, { billed: 2 }], fresh: [{ billed: 1 }, { billed: 1 }] },
  }));
  const validity = cheap.map((pair) => ({ ...pair, old: [false, false] }));
  for (const pairs of [cheap, validity]) {
    const scores = scored(pairs);
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
          frontier: { ...scores, of: pairs.map(({ task }) => task) },
          retained: "unmeasured",
          scored: scores,
          noise: scores,
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
    const tree = {
      ...kernel,
      read: () => events,
      pairsReported: () => pairs,
      pairsOf: () => pairs,
    };
    const totals = emptyTotals();
    campaignLines(
      { tree, scale: { validity: 1, objective: 1, bill: 1 }, own: true, level: null },
      { name: "recorded", path: "unused" },
      totals,
    );
    expect(kernel.flipP(scores.differences)).toBe(1 / 64);
    const steps = pairs === cheap ? 0 : 1;
    expect({
      promoted: totals.rightful + totals.doubted,
      rejected: totals.dropped,
      aa: totals.aaSteps,
    }).toEqual({ promoted: steps, rejected: 1 - steps, aa: steps });
    // The replay scales the same points for a weight sweep, then reads both tests again.
    const scaled = emptyTotals();
    campaignLines(
      { tree, scale: { validity: 0, objective: 1, bill: 1 }, own: false, level: null },
      { name: "recorded", path: "unused" },
      scaled,
    );
    expect([scaled.rightful + scaled.doubted, scaled.aaSteps]).toEqual([0, 0]);
  }
});

it("keeps old stored scores readable but requires unbilled evidence before replaying a step", async () => {
  const kernel = await loadTree(resolve(import.meta.dir, ".."));
  const differences = [600, 600, 600, 600, 600, 600];
  for (const of of [undefined, differences.map((_, at) => `v${String(at)}`)]) {
    for (const unbilled of [undefined, differences]) {
      const events: LogEvent[] = [
        {
          at: "2026-10-26T00:00:00.000Z",
          kind: "comparison.reported",
          data: {
            session: "old",
            old: "reference",
            fresh: "candidate",
            solves: 2,
            frontier: { differences, ...keyIfDefined("unbilled", unbilled), ...keyIfDefined("of", of) },
            retained: "unmeasured",
            level: 0.02,
            reading: "step",
          },
        },
      ];
      const tree = { ...kernel, read: () => events, pairsReported: () => [] };
      const totals = emptyTotals();
      campaignLines(
        { tree, scale: { validity: 1, objective: 1, bill: 1 }, own: true, level: null },
        { name: "old", path: "unused" },
        totals,
      );
      expect(totals.storedTasks).toBe(6);
      expect(totals.added).toBe(unbilled === undefined ? 0 : 1);
    }
  }
});
