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
  it("names a step whose wins between valid answers are all within its A/A's largest difference", () => {
    expect(triggered(objectiveLog(0.05), "MARGINS INSIDE THE NOISE")).toEqual([
      "g-1 won 6 of 6 by no more than its A/A's largest difference where validity tied, 21 points",
    ]);
  });

  it("stays silent where the margins exceed the A/A, and where validity split a task", () => {
    expect(triggered(objectiveLog(0.5), "MARGINS INSIDE THE NOISE")).toEqual([]);
    expect(triggered(objectiveLog(0.05, "split"), "MARGINS INSIDE THE NOISE")).toEqual([]);
  });

  it("reads the A/A's ceiling only on tasks whose halves tied on validity", () => {
    // One A/A task split on validity scores 600, above any margin; the others set the ceiling at 21.
    expect(triggered(objectiveLog(0.05, "flip"), "MARGINS INSIDE THE NOISE")).toEqual([
      "g-1 won 6 of 6 by no more than its A/A's largest difference where validity tied, 21 points",
    ]);
    expect(triggered(objectiveLog(0.5, "flip"), "MARGINS INSIDE THE NOISE")).toEqual([]);
  });
});
