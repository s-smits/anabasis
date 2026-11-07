// The two readers that need no model: whether a side repeats its answers, and how much of a solve's
// time went inside its calls. Each prints counts and shares, and no answer.
import { describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { isString, type JsonObject, type JsonValue } from "../src/meta/json-shape.ts";
import { keyIfNotNull } from "../src/meta/optional-key.ts";
import { answerRows } from "../tools/wri/answers.ts";
import { indexOf } from "../tools/wri/folds.ts";
import { routeRows } from "../tools/wri/routes.ts";
import { waitRows } from "../tools/wri/waits.ts";
import { roundSolves } from "./helpers/logged-round.ts";

const SECOND_MS = 1000;
const event = (kind: EventKind, data: JsonObject, at = 0): LogEvent => ({
  at: new Date(Date.UTC(2026, 10, 5) + at).toISOString(),
  kind,
  data,
});
const held = (...tasks: readonly string[]) =>
  tasks.flatMap((task) => [
    event("task.proposed", { version: task, taskId: task }),
    event("task.gate", { version: task, gate: 1, outcome: "passed" }),
  ]);
const startsIn = (events: readonly LogEvent[]) =>
  events.flatMap(({ kind, data }) => (kind === "solve.started" && isString(data.solve) ? [data.solve] : []));
const reported = (session: string, reading: string, terms: JsonObject) =>
  event("comparison.reported", {
    session,
    old: "h1",
    fresh: "h2",
    starter: "h1",
    reading,
    scored: { wins: 0, losses: 0, ties: 0 },
    ...terms,
  });

describe("answers", () => {
  /** A comparison of one task whose four solves handed in `answers`, in order, or none for null. */
  function oneTask(spelled: string, answers: readonly (JsonValue | null)[]) {
    const { events, terms } = roundSolves("g-1", ["h1", "h2"], { task: spelled });
    const verdicts = startsIn(events).flatMap((solve, at) => {
      const answer = answers[at] ?? null;
      return answer === null ? [] : [event("verdict", { solve, kind: "pass", answer })];
    });
    return [...held("task"), ...events, ...verdicts, reported("g-1", "step", terms)];
  }

  it("counts a side that repeats itself apart from one that does not", () => {
    expect(answerRows(oneTask("PP PP", ["a", "b", "c", "c"]))).toEqual([
      "g-1 step: one answer repeated on 1 of 1 tasks the new harness passed in every solve, 0 of 1 under the reference; both sides gave one answer on 0 of 1",
    ]);
  });

  it("reads two answers that differ only in the order of their keys as one", () => {
    const rows = answerRows(oneTask("PP PP", [{ x: 1, y: 2 }, { y: 2, x: 1 }, "c", "d"]));
    expect(rows[0]).toContain("0 of 1 tasks the new harness");
    expect(rows[0]).toContain("1 of 1 under the reference");
  });

  it("leaves out a side that missed a solve or a solve with no answer on record", () => {
    const missed = answerRows(oneTask("PF PP", ["a", "a", "c", "c"]));
    expect(missed[0]).toContain("1 of 1 tasks the new harness");
    expect(missed[0]).toContain("0 of 0 under the reference");
    expect(missed[0]).toContain("both sides gave one answer on 0 of 0");
    const unanswered = answerRows(oneTask("PP PP", ["a", null, "c", "c"]));
    expect(unanswered[0]).toContain("0 of 0 under the reference");
  });

  it("prints no answer", () => {
    const rows = answerRows(oneTask("PP PP", ["hidden-value-71839", "hidden-value-71839", "c", "c"]));
    expect(rows.join("\n")).not.toContain("71839");
  });

  it("says one line where no comparison tallied a task", () => {
    expect(answerRows([event("campaign.opened", {})])).toEqual([
      "answers: no comparison tallied a task two sides passed",
    ]);
  });
});

describe("waits", () => {
  const call = (solve: string, endSeconds: number, ms: number | null) =>
    event(
      "solve.call",
      { solve, turn: 1, tool: "bash", args: {}, isError: false, text: "", ...keyIfNotNull("ms", ms) },
      endSeconds * SECOND_MS,
    );
  const lasting = (events: readonly LogEvent[], seconds: number) =>
    events.map((each) =>
      each.kind === "solve.finished" ? { ...each, data: { ...each.data, seconds } } : each,
    );

  it("counts overlapping calls once and reads passes and misses by side", () => {
    const { events, terms } = roundSolves("g-1", ["h1", "h2"], { task: "PF PP" });
    const [refPass = "", refMiss = "", newOne = "", newTwo = ""] = startsIn(events);
    const log = [
      ...held("task"),
      ...lasting(events, 100),
      // Two calls under one stretch of 30 s: 0.30, where their sum would read 0.50.
      call(refPass, 30, 30_000),
      call(refPass, 20, 20_000),
      call(refMiss, 90, 90_000),
      call(newOne, 10, 10_000),
      call(newTwo, 10, 10_000),
      reported("g-1", "no-step", terms),
    ];
    expect(waitRows(indexOf(log))).toContain(
      "g-1 inside calls, median share of a solve: reference passes 0.30 of 1, misses 0.90 of 1; new passes 0.10 of 2, misses none",
    );
  });

  it("reads no share from a call whose time is not on record", () => {
    const { events, terms } = roundSolves("g-1", ["h1", "h2"], { task: "PP PP" });
    const [first = ""] = startsIn(events);
    const log = [
      ...held("task"),
      ...lasting(events, 100),
      call(first, 5, null),
      reported("g-1", "step", terms),
    ];
    expect(waitRows(indexOf(log))[0]).toContain("reference passes none");
  });

  it("reads a session from its first mark to its last", () => {
    const build = (at: number, ms: number) =>
      event(
        "build.call",
        { session: "b-1", turn: 1, tool: "bash", args: {}, isError: false, text: "", ms },
        at,
      );
    const rows = waitRows(indexOf([build(60_000, 60_000), build(600_000, 60_000)]));
    expect(rows).toEqual(["build b-1 inside calls: 0.22 of 9 minutes"]);
  });

  it("says one line where no call holds its time", () => {
    expect(waitRows(indexOf([event("campaign.opened", {})]))).toEqual([
      "waits: no call on record holds its time",
    ]);
  });
});

describe("routes", () => {
  const called = (solve: string, turn: number, tool: string) =>
    event("solve.call", { solve, turn, tool, args: {}, isError: false, text: "" });
  /** One comparison of one task, each solve calling the tools its letters spell, in order. */
  function routed(spelled: string, tools: readonly (readonly string[])[]) {
    const { events, terms } = roundSolves("g-1", ["h1", "h2"], { task: spelled });
    const calls = startsIn(events).flatMap((solve, at) =>
      (tools[at] ?? []).map((tool, turn) => called(solve, turn, tool)),
    );
    return indexOf([...held("task"), ...events, ...calls, reported("g-1", "step", terms)]);
  }

  it("reads a side that takes one route apart from one that takes two", () => {
    const rows = routeRows(
      routed("PP PP", [["read", "bash", "bash", "submit"], ["bash", "submit"], ["bash"], ["bash"]]),
    );
    expect(rows).toEqual([
      "g-1 step: new 1 calls, 1 routes in 2 passes; reference 3 calls, 2 routes in 2 passes",
    ]);
  });

  it("reads one set of tools in another order as another route", () => {
    const rows = routeRows(
      routed("PP PP", [
        ["a", "b"],
        ["b", "a"],
        ["a", "b"],
        ["a", "b"],
      ]),
    );
    expect(rows).toEqual([
      "g-1 step: new 2 calls, 1 routes in 2 passes; reference 2 calls, 2 routes in 2 passes",
    ]);
  });

  it("leaves a miss out, and says where a side passed nothing", () => {
    const rows = routeRows(routed("PF FF", [["a"], ["a", "b", "c"], ["d"], ["d"]]));
    expect(rows).toEqual(["g-1 step: new no pass; reference 1 calls, 1 routes in 1 passes"]);
  });

  it("says one line where no comparison holds a solve", () => {
    expect(routeRows(indexOf([event("campaign.opened", {})]))).toEqual([
      "routes: no comparison holds a solve",
    ]);
  });
});
