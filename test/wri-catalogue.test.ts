// The catalogue keeps its thirty-four lanes numbered in order.
import { describe, expect, it } from "bun:test";
import { catalogueText, type Lane, lanesOf } from "../tools/wri/catalogue.ts";
import { sessionsOf, suggestedSessions, weightOf } from "../tools/wri/investigation.ts";
import { CATEGORIES } from "../tools/runtime/land.ts";

describe("the lane catalogue", () => {
  it("holds thirty-four lanes, numbered in order", () => {
    expect(lanesOf(catalogueText()).map(({ number }) => number)).toEqual(
      Array.from({ length: 34 }, (_, index) => index + 1),
    );
  });

  it("gives every lane a label the landing accepts and an importance from 0 to 1", () => {
    const lanes = lanesOf(catalogueText());
    const held = new Set(lanes.map(({ label }) => label));
    expect(held).toEqual(
      new Set([
        "exam",
        "verdicts",
        "supply",
        "harness",
        "comparison",
        "climb",
        "solve",
        "economy",
        "runs",
        "log",
      ]),
    );
    for (const label of held) expect(CATEGORIES.has(label)).toBe(true);
    for (const { importance } of lanes) expect(importance >= 0 && importance <= 1).toBe(true);
    // A lane's own label holds wherever it stands: lane 24 sits among the comparison's lanes.
    expect(lanes.find(({ number }) => number === 24)?.label).toBe("climb");
    expect(lanes.find(({ number }) => number === 34)?.label).toBe("climb");
    for (const { body } of lanes) expect(body).not.toMatch(/Importance:|Label:/u);
  });

  it("names a lane that carries no label of its own", () => {
    const lane = (label: string) =>
      `### A section\n\n**1. A lane.**\n\n${label}Importance: 0.5.\n\nStarts from \`A (lane 1)\`.\n`;
    expect(lanesOf(lane("Label: `exam`.\n"))[0]?.label).toBe("exam");
    expect(() => lanesOf(lane(""))).toThrow("lane 1 has no label");
  });
});

describe("lanes packed into sessions", () => {
  const lanes = lanesOf(catalogueText());
  const labels = new Set(lanes.filter(({ isolated }) => !isolated).map(({ label }) => label));

  it("keeps each label whole, every lane once, and the sessions within one label's weight of each other", () => {
    for (const count of [1, 2, 3, 4, 6, 9, 12]) {
      const sessions = sessionsOf(lanes, count);
      const open = sessions.filter((each) => each.some(({ isolated }) => !isolated));
      expect(open).toHaveLength(Math.min(count, labels.size));
      expect(
        sessions
          .flat()
          .map(({ number }) => number)
          .toSorted((one, other) => one - other),
      ).toEqual(lanes.map(({ number }) => number));
      for (const label of labels) {
        expect(open.filter((each) => each.some((lane) => lane.label === label))).toHaveLength(1);
      }
      for (const each of sessions.filter((one) => one.some(({ isolated }) => isolated))) {
        expect(each).toHaveLength(1);
      }
      const weights = open.map(weightOf);
      const heaviest = Math.max(
        ...[...labels].map((label) =>
          weightOf(lanes.filter((lane) => !lane.isolated && lane.label === label)),
        ),
      );
      expect(Math.max(...weights) - Math.min(...weights)).toBeLessThanOrEqual(heaviest + 1e-9);
    }
  });

  it("puts light labels together and leaves a heavy one alone", () => {
    const [base] = lanes;
    if (base === undefined) throw new Error("the catalogue holds no lane");
    const made = (number: number, label: string, importance: number): Lane => ({
      ...base,
      number,
      label,
      importance,
      isolated: false,
    });
    const sessions = sessionsOf(
      [
        made(1, "heavy", 1),
        made(2, "heavy", 1),
        made(3, "heavy", 1),
        made(4, "a", 0.2),
        made(5, "b", 0.2),
        made(6, "c", 0.2),
      ],
      2,
    );
    expect(sessions.map((each) => each.map(({ number }) => number))).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("suggests the most sessions whose lightest weighs at least half the heaviest", () => {
    const suggested = suggestedSessions(lanes);
    const weights = (count: number) =>
      sessionsOf(lanes, count)
        .filter((each) => each.some(({ isolated }) => !isolated))
        .map(weightOf);
    expect(Math.min(...weights(suggested))).toBeGreaterThanOrEqual(Math.max(...weights(suggested)) / 2);
    if (suggested < labels.size) {
      expect(Math.min(...weights(suggested + 1))).toBeLessThan(Math.max(...weights(suggested + 1)) / 2);
    }
  });
});
