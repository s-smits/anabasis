// Lanes 28 and 29 fire on a chain that loses to the starter on tasks written after its promotions,
// and on an objective-only step won inside its own A/A, and stay silent on the nearest case of each.
import { describe, expect, it } from "bun:test";
import type { LogEvent } from "../src/kernel/log.ts";
import type { TRIGGERS } from "../tools/wri/folds.ts";
import { overview } from "../tools/wri/read.ts";
import { chainLog, objectiveLog } from "./helpers/starter-chain.ts";

const triggered = (log: readonly LogEvent[], name: keyof typeof TRIGGERS) =>
  overview(log)
    .triggers.filter((trigger) => trigger.name === name)
    .map(({ detail }) => detail);

describe("lane 28: whether the chain adds up against the starter", () => {
  it("names each read's tally on tasks written after its promotion, the sums and what those tasks read alone", () => {
    expect(triggered(chainLog("lost"), "CHAIN AGAINST THE STARTER")).toEqual([
      "the reference's wins, losses and ties against the starter on tasks written after its promotion, oldest read first: g-2 0-3-0, g-4 0-3-0; summed 0-6-0, on tasks written before and not chosen on 0-0-0, on the tasks that chose the harness 14-0-0; on the tasks written after alone, 0 of 2 reads a step and 0 a step for the starter",
    ]);
  });

  it("stays silent where the reference wins as many written after as it loses, and on one read alone", () => {
    expect(triggered(chainLog("won"), "CHAIN AGAINST THE STARTER")).toEqual([]);
    const log = chainLog("lost");
    const second = log.findIndex(({ kind, data }) => kind === "comparison.started" && data.session === "g-4");
    expect(triggered(log.slice(0, second), "CHAIN AGAINST THE STARTER")).toEqual([]);
  });
});

describe("lane 29: what an objective-only step won by", () => {
  const SAID =
    "by no more than the wider of the two sides' own differences on the same task where validity tied";
  const same = [1, 1] as const;
  const everywhere = { t0: same, t1: same, t2: same, t3: same, t4: same, t5: same };

  it("names a step whose wins between valid answers are all within the A/A's difference on their own task", () => {
    expect(triggered(objectiveLog(0.05), "MARGINS INSIDE THE NOISE")).toEqual([`g-1 won 6 of 6 ${SAID}`]);
  });

  it("stays silent where the margins exceed the A/A, and where validity split a task", () => {
    expect(triggered(objectiveLog(0.5), "MARGINS INSIDE THE NOISE")).toEqual([]);
    expect(triggered(objectiveLog(0.05, "split"), "MARGINS INSIDE THE NOISE")).toEqual([]);
  });

  it("counts no win inside on a task whose A/A halves split on validity", () => {
    // The A/A's last task splits at 600 points, above any margin, so it is no ceiling for that task's win.
    expect(triggered(objectiveLog(0.05, "flip"), "MARGINS INSIDE THE NOISE")).toEqual([
      `g-1 won 5 of 6 ${SAID}`,
    ]);
    expect(triggered(objectiveLog(0.5, "flip"), "MARGINS INSIDE THE NOISE")).toEqual([]);
  });

  it("lets one outlier task of the A/A set no ceiling for the wins on other tasks", () => {
    // The A/A differs by 210 points on t0 and 3 on the rest, and the step wins those five by 14:
    // against the largest difference all five would read inside, against their own none does.
    const small = [1, 0.99] as const;
    const outlier = { t0: [1, 0.3] as const, t1: small, t2: small, t3: small, t4: small, t5: small };
    expect(triggered(objectiveLog(0.05, "tied", outlier), "MARGINS INSIDE THE NOISE")).toEqual([]);
  });

  it("counts a win on a task both sides repeated exactly outside, however many of them there are", () => {
    // Both sides give one measure in every solve of every task (a buffer step between two programs):
    // each win is the difference of two repeated answers, with a measured spread of zero.
    expect(triggered(objectiveLog(0.05, "tied", everywhere), "MARGINS INSIDE THE NOISE")).toEqual([]);
    // Four tasks keep the A/A's 21-point difference, which their 4-point wins sit inside; the two
    // repeated tasks add nothing to the line.
    expect(triggered(objectiveLog(0.05, "tied", { t0: same, t1: same }), "MARGINS INSIDE THE NOISE")).toEqual(
      [`g-1 won 4 of 6 ${SAID}`],
    );
  });

  it("reads a win against the new side's own difference where the reference repeated exactly", () => {
    // The reference repeats on every task and the new side measures 0.95 and 0.6: its own solves
    // differ by more than it won by, which the reference's A/A alone read as no spread at all.
    expect(triggered(objectiveLog([0.05, 0.4], "tied", everywhere), "MARGINS INSIDE THE NOISE")).toEqual([
      `g-1 won 6 of 6 ${SAID}`,
    ]);
    // The same reference, and a new side whose solves measure 0.7 and 0.67: it won by more than
    // either side differs from itself, so each win stands outside both spreads.
    expect(triggered(objectiveLog([0.3, 0.33], "tied", everywhere), "MARGINS INSIDE THE NOISE")).toEqual([]);
  });
});
