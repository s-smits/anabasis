// Lane 24's budget reader and lane 25's compactions: each comparison's sides by how their solves
// spent their bound, and each compaction with what it was billed.
import { describe, expect, it } from "bun:test";
import { conditionId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { budgetRows } from "../tools/wri/budget.ts";
import { compactionRows } from "../tools/wri/compactions.ts";
import { indexOf } from "../tools/wri/folds.ts";
import { costTriggers } from "../tools/wri/time.ts";
import { conditionOf } from "./helpers/logged-round.ts";

const event = (kind: EventKind, data: JsonObject, at = 0): LogEvent => ({
  at: new Date(Date.UTC(2026, 10, 5) + at * 1000).toISOString(),
  kind,
  data,
});

function solve(
  id: string,
  harness: string,
  comparison: string,
  end: JsonObject,
  callMs: readonly number[] = [],
) {
  const condition = conditionOf("t-1", harness);
  const named = conditionId(condition);
  return [
    event("condition.recorded", { id: named, condition: requireJsonValue(condition) }),
    event("solve.started", {
      solve: id,
      task: "t-1",
      condition: named,
      comparison,
      load: [8, 6, 4],
      cores: 4,
      limits: { wallSeconds: 1000, modelTurns: 10 },
    }),
    ...callMs.map((ms) =>
      event("solve.call", { solve: id, tool: "bash", args: {}, ms, isError: false, text: "" }),
    ),
    event("solve.finished", { solve: id, seconds: 100, turns: 3, ...end }),
  ];
}

describe("budget", () => {
  it("counts each side's solves at the bound and at the deadline, and leaves a non-result unmeasured", () => {
    const log = [
      event("comparison.started", { session: "g-1", old: "h1", fresh: "h2" }),
      event("comparison.started", { session: "g-2", old: "h2", fresh: "h3" }),
      ...solve(
        "s-1",
        "h1",
        "g-1",
        { ending: { outcome: "pass" }, turns: 10, seconds: 950 },
        [299_000, 10_000],
      ),
      ...solve("s-2", "h1", "g-1", { ending: { outcome: "fail", kind: "wall-ended" }, seconds: 1000 }),
      // A provider error at the last turn is no result, and counts at no limit.
      ...solve("s-3", "h1", "g-1", { ending: { outcome: "provider" }, turns: 10, seconds: 900 }),
      ...solve("s-4", "h2", "g-1", { ending: { outcome: "pass" } }),
      event("campaign.waited", {
        comparison: "g-1",
        harness: "h1",
        task: "t-1",
        ms: 1_800_000,
        load: 9,
        cores: 4,
      }),
    ];
    const rows = budgetRows(indexOf(log));
    const old = rows.findIndex((row) => row.startsWith("g-1 old h1"));
    expect(rows[old]).toContain("3 solves, 2 measured");
    const detail = rows[old + 1] ?? "";
    expect(detail).toContain("1 at the last turn");
    expect(detail).toContain("most 100%, 1 ended at a limit");
    expect(detail).toContain("calls at the shell's limit 1");
    expect(detail).toContain("queued 0.5 h");
    expect(detail).toContain("load per core median 2.00");
    expect(rows.some((row) => row.startsWith("g-1 new h2"))).toBe(true);
    // h2 is g-2's old side too, but no solve of g-2 is on record.
    expect(rows.some((row) => row.startsWith("g-2"))).toBe(false);
  });
});

describe("long silences", () => {
  it("names the log's lines either side of each gap", () => {
    const log = [
      event("campaign.move", { move: "build" }, 0),
      event("campaign.move", { move: "build" }, 10),
      event("campaign.move", { move: "build" }, 10 + 3 * 3600),
    ];
    const silences = costTriggers(indexOf(log)).find(({ name }) => name === "LONG SILENCES");
    expect(silences?.detail).toContain("(lines 2-3)");
  });
});

describe("compactions", () => {
  it("prices each compaction from its usages and sets a session's sum beside its end, or says it has none", () => {
    const usage = { model: "p/m", input: 1000, output: 0, cost: { total: 0.5 } };
    const rows = compactionRows([
      event("exam.started", { session: "x-1" }),
      event("exam.compacted", {
        session: "x-1",
        tokensBefore: 200_000,
        seconds: 40,
        error: null,
        usages: [usage],
      }),
      event("exam.compacted", {
        session: "x-1",
        tokensBefore: 210_000,
        seconds: 41,
        error: null,
        usages: [],
      }),
      event("exam.finished", { session: "x-1", billed: 3 }),
      event("build.compacted", {
        session: "b-1",
        tokensBefore: 100,
        seconds: 1,
        error: "too long",
        usages: [],
      }),
    ]);
    expect(rows.some((row) => row.startsWith("3 exam x-1:") && row.includes(" 0 usages billed 0.00"))).toBe(
      true,
    );
    expect(rows).toContain("exam x-1: 2 compactions billed 0.50; its end billed 3.00");
    expect(rows).toContain("build b-1: 1 compactions billed 0.00; no end on record");
    expect(rows.find((row) => row.startsWith("5 build"))).toContain("error too long");
  });
});
