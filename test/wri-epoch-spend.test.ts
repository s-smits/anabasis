// Each epoch's billed dollars by role (`tools/wri/epoch-spend.ts`) on an invented log: a Builder
// session open across a promotion is billed to each epoch for what it metered there, not at its
// whole sum in the epoch where it ends, and a comparison is billed to the epoch that reported it.
import { describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { epochSpendLines } from "../tools/wri/epoch-spend.ts";

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 1, 0, minutes)).toISOString();
const turn = (dollars: number): JsonObject => ({
  session: "b-1",
  turn: 1,
  usage: { cost: { total: dollars } },
});
const steps: [EventKind, JsonObject][] = [
  ["campaign.opened", { project: "p" }],
  ["build.started", { session: "b-1" }],
  ["build.turn", turn(4)],
  ["comparison.started", { session: "g-1" }],
  ["solve.started", { solve: "s-1", comparison: "g-1" }],
  ["solve.finished", { solve: "s-1", billed: 2 }],
  ["harness.promoted", { from: "starter", harness: "a".repeat(64) }],
  ["solve.started", { solve: "s-2", comparison: "g-1" }],
  ["solve.finished", { solve: "s-2", billed: 3 }],
  ["comparison.reported", { session: "g-1", reading: "no-step" }],
  ["build.turn", turn(6)],
  ["build.finished", { session: "b-1", ended: "finished", billed: 10 }],
];
const events: LogEvent[] = steps.map(([kind, data], index) => ({ at: at(index * 30), kind, data }));

describe("epoch-spend", () => {
  const lines = epochSpendLines(events).join("\n").split("\n");

  it("bills an open session to each epoch for what it metered there", () => {
    expect(lines[1]).toContain("billed 6.00: builder 4.00, solver 2.00");
    // The whole sum, 10, less the 4 metered before the promotion.
    expect(lines[4]).toContain("billed 9.00: builder 6.00, solver 3.00");
  });

  it("bills each comparison whole to the epoch that reported it", () => {
    expect(lines[2]).toContain("0 reported comparisons billed 0.00");
    expect(lines[5]).toContain("1 reported comparison billed 5.00");
  });

  it("names the promotion that closed an epoch and the epoch still open", () => {
    // The promotion, line 7, opens the next epoch (`epochsOf`).
    expect(lines[0]).toContain("reference starter  lines 1 to 6");
    expect(lines[0]).toContain(`promoted ${"a".repeat(8)}`);
    expect(lines[3]).toContain("open at the log's end");
  });
});
