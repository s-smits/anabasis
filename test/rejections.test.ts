// The reading of a checker's refused answers, on a log written by hand: which verdicts are a
// rejection of the checker's, what the Referee's last ruling of each counts as, and the order that
// keeps a person's labels blind.
import { describe, expect, it } from "bun:test";
import type { LogEvent } from "../src/kernel/log.ts";
import { drawn, rejections } from "../src/referee/rejections.ts";

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
});
