// The triggers of lanes 7, 8, 20, 28, 32 and 33 read how a run was conducted: the moves against the table,
// the Builder's compactions, the drafted exam, the launches and the log's order. Each case sets a
// log that should fire beside the nearest one that should not.
import { describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { overview } from "../tools/wri/read.ts";
import type { Receipt } from "../tools/runs/receipt.ts";

const START = Date.parse("2026-10-27T08:00:00Z");
const event = (kind: EventKind, data: JsonObject, minute: number): LogEvent => ({
  at: new Date(START + minute * 60_000).toISOString(),
  kind,
  data,
});
const log = (...each: [EventKind, JsonObject][]): LogEvent[] =>
  each.map(([kind, data], index) => event(kind, data, index));
const fired = (events: readonly LogEvent[], name: string, launches: readonly Receipt[] = []) =>
  overview(events, launches).triggers.find((trigger) => trigger.name === name)?.detail;
const receipt = (commit: string, dirty = false): Receipt => ({
  at: new Date(START).toISOString(),
  pid: 1,
  flags: [],
  envFile: null,
  commit,
  dirty,
  load: 1,
  cores: 8,
  bun: "1.4.4",
});

describe("the moves against the table (lane 28)", () => {
  it("counts the moves the Builder asked for where the table named another, and only those", () => {
    const moves = log(
      ["campaign.move", { move: "compare", code: "asked", why: "" }],
      ["campaign.move", { move: "examine", code: "no-room", why: "" }],
      ["campaign.move", { move: "compare", code: "asked", why: "" }],
    );
    expect(fired(moves, "MOVES ASKED")).toBe(
      "2 of 3 moves the Builder asked for where the table named another: compare 2",
    );
    expect(fired(moves.slice(1, 2), "MOVES ASKED")).toBeUndefined();
  });

  it("names an ending the log goes on after, and leaves the last event's ending alone", () => {
    const ended = log(
      ["campaign.ended", { ending: "budget" }],
      ["campaign.move", { move: "build", code: "led" }],
    );
    expect(fired(ended, "ENDED AND WENT ON")).toBe("budget at event 0");
    expect(fired(ended.slice(0, 1), "ENDED AND WENT ON")).toBeUndefined();
  });
});

describe("the Builder's conversation (lane 20)", () => {
  it("gives a session's compactions beside its turns and its read_opening calls", () => {
    const compacted = log(
      ["build.started", { session: "b-1", parent: "starter" }],
      ["build.turn", { session: "b-1" }],
      ["build.turn", { session: "b-1" }],
      ["build.compacted", { session: "b-1", tokensBefore: 290_000, error: null }],
    );
    expect(fired(compacted, "BUILDER COMPACTED")).toMatch(/^b-1: 1 compaction in 2 turns, read_opening 0$/u);
    expect(fired(compacted.slice(0, 3), "BUILDER COMPACTED")).toBeUndefined();
  });
});

describe("the drafted exam (lane 8)", () => {
  it("gives the drafts and how each drafting session ended, and nothing for a stored pack", () => {
    const drafted = log(
      ["exam.drafted", { session: "d-1", draft: {} }],
      [
        "draft.finished",
        { session: "d-1", ended: "stands", tries: 2, measurement: { status: "interrupted" } },
      ],
    );
    expect(fired(drafted, "EXAM DRAFTED")).toBe(
      "1 draft recorded; d-1 stands after 2 attempts, measurement interrupted",
    );
    expect(fired(drafted.slice(1), "EXAM DRAFTED")).toBeUndefined();
  });
});

describe("the launches (lane 32)", () => {
  const opened = log(["campaign.opened", { project: "p" }]);

  it("fires on a second commit or a dirty tree, and stays quiet on one clean launch", () => {
    expect(fired(opened, "LAUNCHES", [receipt("aaaaaaaa11"), receipt("bbbbbbbb22")])).toBe(
      "2 launches at 2 commits (aaaaaaaa, bbbbbbbb), 0 from a dirty tree, under 1 login and 1 Bun version",
    );
    expect(fired(opened, "LAUNCHES", [receipt("aaaaaaaa11", true)])).toContain("1 from a dirty tree");
    expect(fired(opened, "LAUNCHES", [receipt("aaaaaaaa11")])).toBeUndefined();
  });
});

describe("the log's order (lane 33)", () => {
  it("names a clock that runs backwards, a finish with no start and a comparison started twice", () => {
    const disordered = [
      event("solve.finished", { solve: "s1" }, 5),
      event("comparison.started", { session: "g1" }, 4),
      event("comparison.started", { session: "g1" }, 6),
    ];
    expect(fired(disordered, "LOG OUT OF ORDER")).toBe(
      "1 event stamped before the one above it; 1 solve finished with no start; comparison started twice: g1",
    );
    const ordered = log(
      ["solve.started", { solve: "s1" }],
      ["solve.finished", { solve: "s1" }],
      ["comparison.started", { session: "g1" }],
    );
    expect(fired(ordered, "LOG OUT OF ORDER")).toBeUndefined();
  });
});

describe("the refused rulings (lane 7)", () => {
  it("counts the refusals by the ruling asked for", () => {
    const refused = log(
      ["referee.refused", { solve: "s1", asked: { ruling: "earned" } }],
      ["referee.refused", { solve: "s2", asked: { ruling: "check-defect" } }],
    );
    expect(fired(refused, "RULINGS REFUSED")).toBe("check-defect 1, earned 1");
    expect(fired([], "RULINGS REFUSED")).toBeUndefined();
  });
});
