// What each Examiner writing session could read and wrote, and how each side measured on its tasks
// against the author's best on record (`tools/wri/aim.ts`). Every id, digest and number is invented.
import { describe, expect, it } from "bun:test";
import { conditionId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { asRecord, isString, type JsonObject } from "../src/meta/json-shape.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { aimRows, examSessionsOf } from "../tools/wri/aim.ts";
import { conditionOf, roundSolves } from "./helpers/logged-round.ts";

const event = (kind: EventKind, data: JsonObject): LogEvent => ({
  at: "2026-11-05T00:00:00.000Z",
  kind,
  data,
});
const proposed = (version: string, session: string) => [
  event("task.proposed", {
    version,
    taskId: version,
    family: "f",
    session,
  }),
  event("task.gate", { version, gate: 1, outcome: "passed" }),
];
const feasible = (version: string, session: string, measure: number, direction = "lower") =>
  event("task.feasible", { version, session, answer: "a", objective: { quantity: "q", direction, measure } });
const started = (session: string, more: JsonObject = {}) =>
  event("exam.started", { session, examples: [], referenceHome: true, ...more });
const finished = (session: string) => event("exam.finished", { session, ended: "supplied" });

/** Comparison `session` of `old` against `fresh` on each task, as `spelled` passes it ("PF PP"), each
 *  passing solve measuring its place in `measures` (the old side's two first). */
function compared(
  session: string,
  [old, fresh]: readonly [string, string],
  tasks: Readonly<Record<string, { readonly spelled: string; readonly measures: readonly number[] }>>,
  direction = "lower",
): LogEvent[] {
  const outcomes = Object.fromEntries(Object.entries(tasks).map(([task, { spelled }]) => [task, spelled]));
  const { events, terms } = roundSolves(session, [old, fresh], outcomes);
  const measures = Object.values(tasks).flatMap(({ measures: each }) => each);
  const starts = events.flatMap(({ kind, data }) =>
    kind === "solve.started" && isString(data.solve) ? [data.solve] : [],
  );
  const passed = new Set(
    events.flatMap(({ kind, data }) =>
      kind === "solve.finished" && requireJsonValue(data.ending) !== null && isString(data.solve)
        ? asPass(data)
        : [],
    ),
  );
  const verdicts = starts.flatMap((solve, at) => {
    const measure = measures[at];
    return passed.has(solve) && measure !== undefined
      ? [event("verdict", { solve, kind: "pass", answer: "a", objective: measure })]
      : [];
  });
  return [
    event("comparison.started", { session, starter: "h1" }),
    ...events,
    ...verdicts,
    event("comparison.reported", {
      session,
      old,
      fresh,
      starter: "h1",
      reading: "no-step",
      scored: { wins: 0, losses: 0, ties: 0 },
      objective: { measure: "q", direction },
      ...terms,
    }),
  ];
}

function asPass(data: JsonObject): string[] {
  const outcome = asRecord(data.ending)?.outcome ?? null;
  return outcome === "pass" && isString(data.solve) ? [data.solve] : [];
}

const rowOf = (rows: readonly string[], start: string) => rows.find((row) => row.startsWith(start));

describe("aim", () => {
  it("takes a task's writer from its proposal, not from a later session's answer on record", () => {
    const rows = aimRows([
      started("x-1"),
      ...proposed("t1", "x-1"),
      finished("x-1"),
      started("x-2", { conversation: "x-1" }),
      feasible("t1", "x-2", 10),
      finished("x-2"),
      ...compared("g-1", ["h1", "h2"], { t1: { spelled: "PP PP", measures: [10, 12, 10, 10] } }),
    ]);
    expect(rowOf(rows, "x-1, h1 starter")).toContain("at best 1 of 2");
    expect(rowOf(rows, "x-1, h2")).toContain("at best 2 of 2");
    expect(rows.some((row) => row.startsWith("x-2,"))).toBe(false);
  });

  it("names a task proposed outside any writing session the opening exam's", () => {
    const rows = aimRows([
      event("task.proposed", { version: "t1", taskId: "t1", family: "f" }),
      event("task.gate", { version: "t1", gate: 1, outcome: "passed" }),
      started("x-1"),
      feasible("t1", "x-1", 10),
      finished("x-1"),
      ...compared("g-1", ["h1", "h2"], { t1: { spelled: "PP PP", measures: [10, 12, 10, 10] } }),
    ]);
    expect(rowOf(rows, "the opening exam, h1 starter")).toContain("at best 1 of 2");
  });

  it("measures no valid answer against a best where the author's answer is not on record", () => {
    const rows = aimRows([
      started("x-1"),
      ...proposed("t1", "x-1"),
      finished("x-1"),
      ...compared("g-1", ["h1", "h2"], { t1: { spelled: "PP PP", measures: [10, 10, 10, 10] } }),
    ]);
    expect(rowOf(rows, "x-1, h1 starter")).toContain("2 valid (0), at best 0 of 0, median over best none");
  });

  it("takes the best of two answers on record by the objective's direction", () => {
    const log = (direction: string) => [
      started("x-1"),
      ...proposed("t1", "x-1"),
      feasible("t1", "x-1", 10, direction),
      feasible("t1", "x-1", 8, direction),
      finished("x-1"),
      ...compared("g-1", ["h1", "h2"], { t1: { spelled: "PP PP", measures: [10, 10, 8, 8] } }, direction),
    ];
    const lower = aimRows(log("lower"));
    expect(rowOf(lower, "x-1, h1 starter")).toContain("at best 0 of 2, median over best 1.25");
    expect(rowOf(lower, "x-1, h2")).toContain("at best 2 of 2");
    const higher = aimRows(log("higher"));
    expect(rowOf(higher, "x-1, h1 starter")).toContain("at best 2 of 2, median over best 1.00");
    expect(rowOf(higher, "x-1, h2")).toContain("at best 0 of 2");
  });

  it("counts an invalid solve apart and measures only the valid ones", () => {
    const rows = aimRows([
      started("x-1"),
      ...proposed("t1", "x-1"),
      feasible("t1", "x-1", 10),
      finished("x-1"),
      ...compared("g-1", ["h1", "h2"], { t1: { spelled: "PF PP", measures: [10, 10, 10, 10] } }),
    ]);
    expect(rowOf(rows, "x-1, h1 starter")).toContain("1 valid (1), at best 1 of 1");
  });

  it("gives a continued session's reference at its start and its end where a promotion falls inside it", () => {
    const [, second] = examSessionsOf([
      started("x-1"),
      finished("x-1"),
      started("x-2", { conversation: "x-1" }),
      event("harness.promoted", { harness: "h2", from: "h1" }),
      finished("x-2"),
    ]);
    expect(second?.conversation).toBe("x-1");
    expect(second?.reference).toEqual({ start: "starter", finish: "h2" });
    expect(second?.promotedWithin).toEqual(["h2"]);
  });

  it("reads a log without the home field or any Examiner call as not recorded, not as none", () => {
    const rows = aimRows([event("exam.started", { session: "x-1" }), finished("x-1")]);
    expect(rows).toContain("not recorded: a field or call this log's code did not write");
    expect(rowOf(rows, "  reference copy")).toContain(
      "reference copy in its home: not recorded; try_reference calls: not recorded; tries solved: none; shell calls naming reference-harness/: not recorded",
    );
  });

  it("counts a session's own try_reference calls, the harness each try ran under and the shell calls naming the copy", () => {
    const condition = conditionOf("try-1", "h2");
    const id = conditionId(condition);
    const call = (session: string, tool: string, command: string) =>
      event("exam.call", { session, tool, args: { command }, text: "", isError: false, ms: 1, turn: 1 });
    const [first, second] = examSessionsOf([
      started("x-1"),
      call("x-1", "try_reference", ""),
      call("x-1", "bash", "ls reference-harness/agent"),
      call("x-1", "bash", "ls"),
      event("condition.recorded", { id, condition: requireJsonValue(condition) }),
      event("solve.started", { solve: "s-a", condition: id, comparison: "x-1" }),
      finished("x-1"),
      started("x-2"),
      finished("x-2"),
    ]);
    expect(first?.tryCalls).toBe(1);
    expect([...(first?.tries ?? [])]).toEqual([["h2", 1]]);
    expect(first?.referenceShell).toEqual({ naming: 1, of: 2 });
    expect(second?.tryCalls).toBe(0);
    expect(second?.referenceShell).toEqual({ naming: 0, of: 0 });
  });

  it("names a starter read apart among the comparisons that later tallied a session's tasks", () => {
    const [first] = examSessionsOf([
      started("x-1"),
      ...proposed("t1", "x-1"),
      ...proposed("t2", "x-1"),
      finished("x-1"),
      ...compared("g-1", ["h1", "h2"], { t1: { spelled: "PP PP", measures: [1, 1, 1, 1] } }),
      event("harness.promoted", { harness: "h2", from: "h1" }),
      ...compared("g-2", ["h2", "h1"], {
        t1: { spelled: "PP PP", measures: [1, 1, 1, 1] },
        t2: { spelled: "PP PP", measures: [1, 1, 1, 1] },
      }),
    ]);
    expect(first?.admitted).toEqual(["t1", "t2"]);
    expect(first?.scoredIn).toEqual([
      { comparison: "g-1", tasks: 1, starterRead: false },
      { comparison: "g-2", tasks: 2, starterRead: true },
    ]);
  });
});
