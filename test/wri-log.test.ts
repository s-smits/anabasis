// The lane query tool: the shape of each event kind with no value, one kind's events with long text
// cut, one row a solve placed by the folds, and the slice.ts command for a trace.
import { describe, expect, it } from "bun:test";
import { conditionId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfNotNull } from "../src/meta/optional-key.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { eventRows, kindRows, solveRows, traceRows } from "../tools/wri/log.ts";
import { conditionOf } from "./helpers/logged-round.ts";

const passed = { ending: { outcome: "pass" }, turns: 10, prompts: 2, seconds: 500, billed: 0.25 };

const event = (kind: EventKind, data: JsonObject, at = 0): LogEvent => ({
  at: new Date(Date.UTC(2026, 10, 5) + at * 1000).toISOString(),
  kind,
  data,
});

/** A solve of `task` under `harness`, started for `comparison` (or none) and ended as `end` says. */
function solve(id: string, task: string, harness: string, comparison: string | null, end: JsonObject | null) {
  const condition = conditionOf(task, harness);
  const named = conditionId(condition);
  return [
    event("condition.recorded", { id: named, condition: requireJsonValue(condition) }),
    event("solve.started", {
      solve: id,
      task,
      condition: named,
      ...keyIfNotNull("comparison", comparison),
      limits: { wallSeconds: 1000, modelTurns: 10 },
    }),
    ...(end === null ? [] : [event("solve.finished", { solve: id, ...end })]),
  ];
}

describe("log.ts kinds", () => {
  it("gives each key's types and the lines it stood on, so a shape that changed shows, and no value", () => {
    const rows = kindRows([
      event("solve.finished", { solve: "s-1", seconds: 5 }),
      event("campaign.move", { move: "build" }),
      event("solve.finished", { solve: "s-2", seconds: null, tokens: { input: 3 }, held: "q7-hidden" }),
    ]);
    expect(rows).toContain("solve.finished 2, lines 1-3");
    expect(rows).toContain("  seconds null|number, lines 1-3");
    expect(rows).toContain("  tokens object, in 1 of 2, line 3");
    expect(rows.join("\n")).not.toContain("q7-hidden");
    // One kind asked for is the only one printed.
    const one = kindRows(
      [event("solve.finished", { solve: "s-1" }), event("campaign.move", {})],
      new Set(["campaign.move"]),
    );
    expect(one.slice(1)).toEqual(["campaign.move 1, line 2"]);
  });
});

describe("log.ts events", () => {
  const long = "x".repeat(200);
  const digest = "ab".repeat(32);
  const events = [
    event("verdict", { solve: "s-1", kind: "pass", blocking: [] }),
    event("verdict", { solve: "s-2", kind: "fail", note: long, harness: digest }),
    event("verdict", { solve: "s-3", kind: "fail", blocking: ["c-1"] }),
  ];
  const query: Parameters<typeof eventRows>[1] = {
    kind: "verdict",
    fields: [],
    where: [],
    countBy: undefined,
    full: false,
  };

  it("cuts a long string and a digest unless asked for whole, at the log's own line numbers", () => {
    const [, ...rows] = eventRows(events, { ...query, fields: ["solve", "note", "harness"] });
    expect(rows[1]?.split("\t")).toStrictEqual([
      "2",
      events[1]?.at ?? "",
      "s-2",
      `${"x".repeat(80)}[+120 chars]`,
      "abababab",
    ]);
    expect(rows[0]?.split("\t").slice(3)).toStrictEqual(["-", "-"]);
    const [, ...full] = eventRows(events, { ...query, fields: ["note"], full: true });
    expect(full[1]).toContain(long);
  });

  it("reads several kinds in the log's order with each one's kind, and no kind it does not name", () => {
    const timeline = [
      event("exam.started", { session: "x-1" }),
      event("exam.call", { session: "x-1" }),
      event("exam.turn", { session: "x-1" }),
      event("exam.finished", { session: "x-1" }),
    ];
    const [, ...rows] = eventRows(timeline, {
      ...query,
      kind: "exam.finished,exam.call",
      fields: ["session"],
    });
    expect(rows.map((row) => row.split("\t").filter((_, at) => at !== 1))).toStrictEqual([
      ["2", "exam.call", "x-1"],
      ["4", "exam.finished", "x-1"],
    ]);
  });

  it("bounds a number, dotted paths too, and counts apart a field absent or not a number instead of reading 0", () => {
    const calls = [
      event("solve.call", { solve: "s-1", ms: 500_000, usage: { input: 9 } }),
      event("solve.call", { solve: "s-2", ms: 10 }),
      event("solve.call", { solve: "s-3" }),
      event("solve.call", { solve: "s-4", ms: "600000" }),
      event("solve.call", { solve: "s-5", ms: 400_000 }),
    ];
    const at = { ...query, kind: "solve.call", fields: ["solve"] };
    const solvesOf = (where: string) =>
      eventRows(calls, { ...at, where: [where] })
        .slice(1)
        .map((row) => row.split("\t")[2]);
    expect(solvesOf("ms>400000")).toStrictEqual(["s-1"]);
    expect(eventRows(calls, { ...at, where: ["ms>400000"] })[0]).toContain(
      "(2 left out: a bounded field absent or not a number)",
    );
    expect(solvesOf("ms<=400000")).toStrictEqual(["s-2", "s-5"]);
    // An absent field is never 0: `ms<1` takes no row, where reading it as 0 would take s-3.
    expect(solvesOf("ms<1")).toStrictEqual([]);
    expect(solvesOf("usage.input>=9")).toStrictEqual(["s-1"]);
    expect(() => eventRows(calls, { ...at, where: ["ms>many"] })).toThrow("with a number");
  });

  it("filters on the uncut value and counts a field", () => {
    expect(eventRows(events, { ...query, where: ["kind=fail"], countBy: "blocking" }).slice(1)).toStrictEqual(
      ["1 -", '1 ["c-1"]'],
    );
    // Two fields count each pair of values, never the first field alone.
    expect(eventRows(events, { ...query, countBy: "kind,blocking" }).slice(1)).toStrictEqual([
      "1 pass []",
      "1 fail -",
      '1 fail ["c-1"]',
    ]);
    expect(eventRows(events, { ...query, where: ["note~xxx"], fields: ["solve"] })).toHaveLength(2);
    expect(eventRows(events, { ...query, where: ["kind!=fail"], fields: ["solve"] })).toHaveLength(2);
  });
});

describe("log.ts solves", () => {
  it("places a solve by the comparison its start names, not the last one to start", () => {
    const log = [
      event("comparison.started", { session: "g-1", old: "h1", fresh: "h2" }),
      event("comparison.started", { session: "g-2", old: "h3", fresh: "h3" }),
      ...solve("s-1", "t-1", "h1", "g-1", passed),
      ...solve("s-2", "t-1", "h3", "g-2", passed),
      ...solve("s-3", "t-1", "h2", "g-1", null),
    ];
    const rows = solveRows(log, {}).map((row) => row.split("\t"));
    const of = (id: string) => rows.find((row) => row[0] === id);
    expect(of("s-1")?.slice(1, 3)).toStrictEqual(["g-1", "old"]);
    expect(of("s-2")?.slice(1, 3)).toStrictEqual(["g-2", "both"]);
    expect(of("s-3")?.slice(1, 3)).toStrictEqual(["g-1", "new"]);
    // An open solve is open, never a fail, and holds no seconds.
    expect(of("s-3")?.[6]).toBe("open");
    expect(of("s-3")?.[12]).toBe("-");
    expect(of("s-1")?.slice(9, 17)).toStrictEqual(["10", "10", "2", "500", "50%", "n/r", "n/r", "0.25"]);
    expect(solveRows(log, { comparison: "g-1", role: "old" })).toHaveLength(4);
  });

  it("names an older log's missing fields, an Examiner's tries and practice", () => {
    const log = [
      event("exam.started", { session: "x-1" }),
      ...solve("s-1", "t-1", "h1", "x-1", { ending: { outcome: "pass" } }),
      event("task.proposed", { version: "t-2", taskId: "t-2" }),
      event("task.gate", { version: "t-2", gate: 1, outcome: "passed" }),
      event("task.state", { version: "t-2", state: "released" }),
      ...solve("s-2", "t-2", "h1", null, { ending: { outcome: "fail", kind: "rejected" } }),
    ];
    const rows = solveRows(log, {}).map((row) => row.split("\t"));
    expect(rows.find((row) => row[0] === "s-1")?.slice(2, 3)).toStrictEqual(["try"]);
    expect(rows.find((row) => row[0] === "s-1")?.slice(9, 12)).toStrictEqual(["n/r", "10", "n/r"]);
    expect(rows.find((row) => row[0] === "s-2")?.[2]).toBe("practice");
  });

  it("bounds a numeric column and counts apart a solve with no end instead of reading its share as 0", () => {
    const log = [
      event("task.proposed", { version: "t-1", taskId: "t-1", family: "parse" }),
      event("task.proposed", { version: "t-2", taskId: "t-2", family: "merge" }),
      ...solve("s-1", "t-1", "h1", null, { ...passed, seconds: 50 }),
      ...solve("s-2", "t-2", "h1", null, passed),
      ...solve("s-3", "t-2", "h2", null, { ...passed, seconds: 90 }),
      ...solve("s-4", "t-1", "h2", null, null),
    ];
    const quick = solveRows(log, { where: ["outcome=pass", "deadline<10"] });
    expect(quick[0]).toContain("(1 left out: a bounded field absent or not a number)");
    const rows = quick.slice(2, -1).map((row) => row.split("\t"));
    expect(rows.map((row) => [row[0], row[3], row[5], row[13]])).toStrictEqual([
      ["s-1", "h1", "parse", "5%"],
      ["s-3", "h2", "merge", "9%"],
    ]);
    // An open solve has no share, so `deadline<1` takes none where reading it as 0 would take s-4.
    expect(solveRows(log, { where: ["deadline<1"] }).slice(2, -1)).toStrictEqual([]);
    expect(solveRows(log, { where: ["seconds>=90", "turns=10"], countBy: "harness" }).slice(1)).toStrictEqual(
      ["1 h1", "1 h2"],
    );
    expect(() => solveRows(log, { countBy: "speed" })).toThrow("name a column");
  });
});

describe("log.ts trace", () => {
  const log = [
    event("build.turn", { session: "b-1", turn: 1, text: "", usage: {} }),
    event("solve.started", { solve: "run-mw1-1-1" }),
    event("solve.started", { solve: "run-mw1-2-1" }),
  ];

  it("names the slice.ts selector for one solve or session, and none for an id that names two", () => {
    expect(traceRows(log, "b-1", "/l/log.jsonl").at(-1)).toContain("'Builder:b-1{1-}'");
    expect(traceRows(log, "mw1-2-1", "/l/log.jsonl").at(-1)).toContain("'Solver:run-mw1-2-1{1-}'");
    const both = traceRows(log, "run-mw1", "/l/log.jsonl");
    expect(both.some((row) => row.includes("slice.ts"))).toBe(false);
    expect(both).toHaveLength(3);
  });
});
