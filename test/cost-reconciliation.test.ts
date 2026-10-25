// The backend's own query totals are checked against the host's bill on the same ending records
// only: an ending without a total and a session that never ended stay out of both sides.
import { describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { billedAll, costLine } from "../src/kernel/trace.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";

const event = (kind: EventKind, data: JsonObject): LogEvent => ({
  at: "2026-10-25T00:00:00Z",
  kind,
  data,
});
/** The numbers a line states, in order: the facts it carries, whatever its wording. */
const facts = (line: string) => line.match(/\d+(?:\.\d+)?/g);
const closed = [
  event("solve.started", { solve: "s-1", comparison: "g-1" }),
  event("solve.turn", { solve: "s-1", usage: { cost: { total: 90 } } }),
  event("solve.finished", { solve: "s-1", billed: 93.9648096, reportedCost: 136.81746535 }),
  event("comparison.reported", { session: "g-1", billed: 900, reportedCost: 999 }),
];

describe("the backend check over recorded endings", () => {
  it("sets the backend's totals beside the bill of the same endings, and nothing else", () => {
    expect(facts(costLine(closed))).toEqual(["136.82", "1", "1", "93.96", "45.6"]);
    const more = [
      ...closed,
      event("exam.finished", { session: "x-1", billed: 4 }),
      event("draft.finished", { session: "d-1", billed: 4, reportedCost: null }),
      event("build.started", { session: "b-1" }),
      event("build.turn", { session: "b-1", usage: { cost: { total: 2 } } }),
      event("referee.finding", { session: "r-1", billed: 1, reportedCost: 0.5 }),
    ];
    expect(facts(costLine(more))).toEqual(["137.32", "2", "4", "94.96", "44.6"]);
    expect(billedAll(more)).toBeCloseTo(93.9648096 + 4 + 4 + 2 + 1, 10);
  });

  it("reads no backend total as none, without a share", () => {
    expect(facts(costLine([event("exam.finished", { session: "x-1", billed: 4 })]))).toEqual([
      "0.00",
      "0",
      "1",
      "0.00",
    ]);
  });
});
