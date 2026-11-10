// How far a comparison's scores stand from its level (`clearance.ts`), and the lines the comparison
// reader prints from it with the cap against the bill (`reading.ts`). Invented scores and logs only.
import { describe, expect, it } from "bun:test";
import { rowsOf } from "#skills/comparison-reading/scripts/reading.ts";
import { flipP } from "../src/kernel/compare.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { equalMost, equalNeed, shortOf, spareOf } from "../tools/wri/clearance.ts";

const LEVEL = 0.02;
const won = (count: number, margin = 600) => Array.from({ length: count }, () => margin);

describe("clearance", () => {
  it("counts the wins a step has to spare, largest first", () => {
    expect([spareOf(won(6), LEVEL), spareOf(won(8), LEVEL), spareOf(won(5), LEVEL)]).toEqual([0, 2, 0]);
  });

  it("turns the largest losses first, which a count of the smallest first would put at five", () => {
    const scores = [...won(6, 5), -1, -1, -1, -1, -20];
    expect(shortOf(scores, LEVEL)).toBe(1);
    expect(shortOf(won(6), LEVEL)).toBe(0);
  });

  it("finds no step for five won tasks, which on equal margins need a sixth", () => {
    expect(shortOf(won(5), LEVEL)).toBeNull();
    expect([equalNeed(0, LEVEL), equalNeed(1, LEVEL)]).toEqual([6, 8]);
  });

  it("gives the most losses a number of untied tasks can carry, past the tasks a comparison tallied", () => {
    expect(equalMost(9, LEVEL)).toEqual({ wins: 8, losses: 1 });
    expect(equalMost(5, LEVEL)).toBeNull();
    expect(equalNeed(3, LEVEL)).toBeGreaterThan(9);
  });
});

describe("a comparison's distance from its level and its cap", () => {
  const STARTER = "a".repeat(64);
  const NEW = "b".repeat(64);
  const event = (kind: EventKind, data: JsonObject): LogEvent => ({
    at: "2026-11-05T00:00:00.000Z",
    kind,
    data,
  });
  const solve = (id: string, billed: number) => [
    event("solve.started", { solve: id, condition: "c" }),
    event("solve.finished", { solve: id, ending: { outcome: "pass" }, billed }),
  ];
  const tested = (differences: readonly number[]) => ({
    wins: differences.filter((one) => one > 0).length,
    losses: differences.filter((one) => one < 0).length,
    ties: differences.filter((one) => one === 0).length,
    p: flipP(differences),
    differences: [...differences],
    unbilled: [...differences],
  });
  const scores = [...won(5), -600];
  const events = [
    ...solve("s-1", 0.5),
    ...solve("s-2", 1.5),
    event("comparison.started", {
      session: "g-1",
      old: STARTER,
      fresh: NEW,
      starter: STARTER,
      tasks: ["t1", "t2", "t3", "t4", "t5", "t6"],
      cap: { dollars: 10, reserve: 3 },
    }),
    // A solve that finished after the start prices nothing in admission's rate.
    ...solve("s-3", 9),
    event("comparison.reported", {
      session: "g-1",
      reading: "no-step",
      old: STARTER,
      fresh: NEW,
      starter: STARTER,
      level: LEVEL,
      solves: 2,
      scored: tested(scores),
      frontier: tested(scores),
      retained: "unmeasured",
      noise: null,
      versions: ["t1", "t2", "t3", "t4", "t5", "t6"],
    }),
  ];
  const [row] = rowsOf(events, null, null);

  it("reads the reverse p, the losses short of a step and the equal-margin tally needed", () => {
    expect(row?.reverse).toBeCloseTo(1 - 1 / 64, 6);
    expect(row?.margin).toEqual({ short: 1 });
    expect(row?.need).toEqual({ losses: 1, wins: 8, untied: 6, most: { wins: 6, losses: 0 } });
  });

  it("prices the test at the rate of the solves finished before its start, and reads no cut unrecorded", () => {
    expect(row?.cap).toEqual({ dollars: 10, reserve: 3, solves: 12, rate: 1, cost: 24, capped: null });
  });
});
