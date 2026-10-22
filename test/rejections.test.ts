// The reading of a checker's refused answers, on a log written by hand: which verdicts are a
// rejection of the checker's, what the Referee's last ruling of each counts as, and the order that
// keeps a person's labels blind.
import { describe, expect, it } from "bun:test";
import type { LogEvent } from "../src/kernel/log.ts";
import { RULINGS } from "../src/referee/agreement.ts";
import { drawn, labelled, rejections, repairReading } from "../src/referee/rejections.ts";

const at = "2026-10-08T00:00:00.000Z";
const refused = (solve: string, ...blocking: string[]): LogEvent => ({
  at,
  kind: "verdict",
  data: { solve, task: `task-${solve}`, answer: {}, kind: "fail", blocking },
});
const ruled = (solve: string, ruling: string, check: string | null = null): LogEvent => ({
  at,
  kind: "referee.finding",
  data: { solve, ruling, check },
});
const VERDICTS: LogEvent[] = [
  refused("a", "mass"),
  refused("b", "mass", "span"),
  refused("c", "span"),
  refused("d", "mass"),
  // An answer outside the contract's format reached no check, and a pass is no rejection.
  refused("format"),
  { at, kind: "verdict", data: { solve: "passed", task: "task-a", answer: {}, kind: "pass" } },
];

describe("a checker's refused answers", () => {
  it("counts the last ruling of each, the check defects by check, and what is still unruled", () => {
    const events = [
      ...VERDICTS,
      ruled("a", "unclear"),
      ruled("a", "check-defect", "mass"),
      ruled("b", "earned"),
      ruled("c", "check-defect", "span"),
    ];
    expect(rejections(events)).toEqual({
      fails: ["a", "b", "c", "d"],
      rulings: { earned: 1, "check-defect": 2, unclear: 0 },
      unruled: ["d"],
      defects: { mass: 1, span: 1 },
    });
  });

  it("draws the fails to label by a seed alone, and never once a ruling is in the log", () => {
    const sample = drawn(VERDICTS, 2, "seed");
    expect(sample).toHaveLength(2);
    expect(drawn(VERDICTS.toReversed(), 2, "seed")).toEqual(sample);
    expect(["a", "b", "c", "d"]).toEqual(expect.arrayContaining(sample));
    expect(() => drawn(VERDICTS, 5, "seed")).toThrow(
      "5 labels need as many refused answers; the log holds 4",
    );
    expect(() => drawn([...VERDICTS, ruled("a", "earned")], 2, "seed")).toThrow("would not be made blind");
  });

  it("holds a label open until it is one of the three rulings", () => {
    const { labels, open } = labelled({ a: "earned", b: "", c: "check-defect", d: "wrong answer" }, RULINGS);
    expect([...labels]).toEqual([
      ["a", "earned"],
      ["c", "check-defect"],
    ]);
    expect(open).toEqual(["b", "d"]);
  });

  it("holds a repair to what was read: only an answer ruled a check defect may be let through", () => {
    const row = (solve: string, was: string, now: string) => ({ solve, task: `task-${solve}`, was, now });
    const rows = [
      row("a", "fail mass", "pass"),
      row("b", "fail mass,span", "pass"),
      row("c", "fail span", "pass"),
      row("d", "fail mass", "pass"),
      row("e", "fail mass", "fail mass"),
      row("f", "pass", "fail span"),
      row("g", "pass", "pass"),
      row("h", "fail mass", "fail mass"),
    ];
    const events = [
      ruled("a", "check-defect", "mass"),
      ruled("b", "earned"),
      ruled("c", "unclear"),
      ruled("e", "check-defect", "mass"),
      // A person's label stands over the Referee's ruling of the same answer.
      ruled("h", "check-defect", "mass"),
    ];
    const reading = repairReading(rows, events, new Map([["h", "earned"]]));
    expect(reading).toEqual({
      withdrawn: { "check-defect": ["a"], earned: ["b"], unread: ["c", "d"] },
      tightened: ["f"],
      unrepaired: ["e"],
      against: [
        "1 answer ruled an earned fail would pass: b",
        "2 answers refused before and read by nobody would pass: c, d",
        "1 answer accepted before would be refused: f",
      ],
    });
    // A repair that moves only what was ruled the old checker's fault has nothing against it.
    expect(repairReading(rows.slice(0, 1), events, new Map()).against).toEqual([]);
  });
});
