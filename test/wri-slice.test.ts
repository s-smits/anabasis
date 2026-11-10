// A seat's calls kept by tool, and a phrase counted in each result (`oracle-handover/scripts/slice.ts`),
// as lane 2 reads served text. Invented data only.
import { describe, expect, it } from "bun:test";
import { parseSelector, slice } from "#skills/oracle-handover/scripts/slice.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";

const shown = { whole: false, maxChars: 6000 };
const event = (kind: EventKind, data: JsonObject): LogEvent => ({
  at: "2026-11-05T00:00:00.000Z",
  kind,
  data,
});
const turn = (session: string, number: number) =>
  event("build.turn", { session, turn: number, stopReason: "toolUse", error: null, text: "", usage: null });
const call = (session: string, number: number, tool: string, text: string) =>
  event("build.call", { session, turn: number, tool, args: {}, isError: false, text });
const events = [
  turn("b-1", 1),
  call("b-1", 1, "bash", "cost of cost of"),
  call("b-1", 1, "read_opening", "cost of one, cost of two"),
  turn("b-1", 2),
  call("b-1", 2, "wait", "nothing"),
  turn("b-1", 3),
  call("b-1", 3, "read_opening", "no such phrase"),
  turn("b-2", 1),
  call("b-2", 1, "read_opening", "cost of three"),
  event("comparison.reported", { session: "g-1", note: "cost of" }),
];

describe("slice by tool and by count", () => {
  it("keeps only the named tools' calls and the turns that made them", () => {
    const text = slice(events, "Builder:b-1[read_opening]{1-}", shown);
    expect(text).toContain("one, cost of two");
    expect(text).toContain("no such phrase");
    expect(text).not.toContain("nothing");
    expect(text).not.toContain("cost of cost of");
  });

  it("refuses a tool the chosen calls never used, naming those they did, instead of printing nothing", () => {
    expect(() => slice(events, "Builder:b-1[compare]", shown)).toThrow(
      "they called bash, read_opening, wait",
    );
    expect(() => parseSelector("comparison.reported[wait]")).toThrow("follows a seat");
    expect(() => parseSelector("Builder[read_opening,]")).toThrow("names each tool");
  });

  it("counts a phrase in each chosen call's result, a result without it as 0", () => {
    const text = slice(events, "Builder:b-1[read_opening]", { ...shown, count: "cost of" });
    expect(text).toContain("1 of 2 calls hold it, 2 times in all");
    expect(text).toContain("- b-1 turn 1 read_opening: 2");
    expect(text).toContain("- b-1 turn 3 read_opening: 0");
    const across = slice(events, "Builder[read_opening]{~1}", { ...shown, count: "cost of" });
    expect(across).toContain("- b-2 turn 1 read_opening: 1");
    expect(across).not.toContain("b-1 turn");
  });

  it("counts a phrase in each chosen event's data", () => {
    expect(slice(events, "comparison.reported", { ...shown, count: "cost of" })).toContain(
      "- comparison.reported 1 of 1: 1",
    );
  });
});
