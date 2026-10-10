// A person's reading of answers that passed: the draw by the comparison's id, the labels as a
// file holds them, and what the records come to (src/review/passes.ts).
import { describe, expect, it } from "bun:test";
import type { LogEvent } from "../src/kernel/log.ts";
import { passesLabelled, passesOf, passesRead, passLabels, toRead } from "../src/review/passes.ts";

const at = "2026-10-10T00:00:00.000Z";
const solve = (id: string, comparison: string, outcome: "pass" | "fail"): LogEvent[] => [
  { at, kind: "solve.started", data: { solve: id, comparison, task: "t-1" } },
  {
    at,
    kind: "solve.finished",
    data: { solve: id, ending: { outcome, kind: outcome === "pass" ? "" : "rejected" } },
  },
];
const EVENTS: LogEvent[] = [
  ...solve("s-1", "g-1", "pass"),
  ...solve("s-2", "g-1", "fail"),
  ...solve("s-3", "g-1", "pass"),
  ...solve("s-4", "g-1", "pass"),
  ...solve("s-5", "g-2", "pass"),
  { at, kind: "solve.started", data: { solve: "s-6", comparison: "g-1", task: "t-1" } },
];

describe("a person's reading of answers that passed", () => {
  it("draws from a comparison's own passes, the same draw whenever it is asked for", () => {
    expect(passesOf(EVENTS, "g-1")).toEqual(["s-1", "s-3", "s-4"]);
    const drawn = toRead(EVENTS, "g-1", 2);
    expect(drawn).toHaveLength(2);
    expect(drawn.every((id) => ["s-1", "s-3", "s-4"].includes(id))).toBe(true);
    expect(toRead(EVENTS, "g-1", 2)).toEqual(drawn);
    // Asked for more than there are, it draws them all; another comparison's are its own.
    expect(toRead(EVENTS, "g-1", 9).toSorted()).toEqual(["s-1", "s-3", "s-4"]);
    expect(toRead(EVENTS, "g-2", 3)).toEqual(["s-5"]);
    expect(toRead(EVENTS, "g-3", 3)).toEqual([]);
  });

  it("reads a labels file as the three words, the empty entries and the mistyped ones", () => {
    const { labels, empty, mistyped } = passLabels({
      "s-1": "sound",
      "s-3": "",
      "s-4": "wrng",
      "s-5": "unclear",
    });
    expect([...labels]).toEqual([
      ["s-1", "sound"],
      ["s-5", "unclear"],
    ]);
    expect(empty).toEqual(["s-3"]);
    expect(mistyped).toEqual(["s-4"]);
  });

  it("sums the records, one a comparison, and finds a comparison's own", () => {
    const labelled: LogEvent[] = [
      {
        at,
        kind: "pass.labelled",
        data: { session: "g-1", of: 3, labels: { "s-1": "sound", "s-3": "wrong" } },
      },
      { at, kind: "pass.labelled", data: { session: "g-2", of: 1, labels: { "s-5": "sound" } } },
    ];
    expect(passesRead([...EVENTS, ...labelled])).toEqual({
      comparisons: 2,
      read: 3,
      of: 4,
      labels: { sound: 2, wrong: 1, unclear: 0 },
    });
    expect(passesRead(EVENTS)).toEqual({
      comparisons: 0,
      read: 0,
      of: 0,
      labels: { sound: 0, wrong: 0, unclear: 0 },
    });
    expect(passesLabelled([...EVENTS, ...labelled], "g-2")?.data.of).toBe(1);
    expect(passesLabelled(EVENTS, "g-2")).toBeNull();
  });
});
