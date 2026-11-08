// The catalogue keeps its twenty-seven lanes numbered in order, each trigger starting the lane the
// reader names, and a session that holds the blind lane reads it first.
import { describe, expect, it } from "bun:test";
import { catalogueText, type Lane, lanesOf } from "../tools/wri/catalogue.ts";
import { sessionsOf, suggestedSessions, weightOf } from "../tools/wri/investigation.ts";
import { CATEGORIES } from "../tools/runtime/land.ts";
import { TRIGGERS } from "../tools/wri/folds.ts";

describe("the lane catalogue", () => {
  it("holds twenty-seven lanes, numbered in order", () => {
    expect(lanesOf(catalogueText()).map(({ number }) => number)).toEqual(
      Array.from({ length: 27 }, (_, index) => index + 1),
    );
  });

  it("gives every lane a label the landing accepts and an importance from 0 to 1", () => {
    const lanes = lanesOf(catalogueText());
    const held = new Set(lanes.map(({ label }) => label));
    expect(held).toEqual(
      new Set(["exam", "verdicts", "supply", "harness", "comparison", "climb", "solve", "economy", "runs"]),
    );
    for (const label of held) expect(CATEGORIES.has(label)).toBe(true);
    for (const { importance } of lanes) expect(importance >= 0 && importance <= 1).toBe(true);
    // A lane's own label holds wherever it stands: lane 19 sits among the comparison's lanes.
    expect(lanes.find(({ number }) => number === 19)?.label).toBe("climb");
    expect(lanes.find(({ number }) => number === 27)?.label).toBe("climb");
    for (const { body } of lanes) expect(body).not.toMatch(/Importance:|Label:/u);
  });

  it("names each trigger the reader can fire under the lane the reader opens with it", () => {
    const named = lanesOf(catalogueText()).flatMap(({ number, triggers }) =>
      triggers.map((name) => `${name} (lane ${String(number)})`),
    );
    expect(named.toSorted()).toEqual(
      Object.entries(TRIGGERS)
        .map(([name, number]) => `${name} (lane ${String(number)})`)
        .toSorted(),
    );
  });

  it("names a lane that carries no label of its own", () => {
    const lane = (label: string) =>
      `### A section\n\n**1. A lane.**\n\n${label}Importance: 0.5.\nMarks: none.\n\nStarts from \`A (lane 1)\`.\n`;
    expect(lanesOf(lane("Label: `exam`.\n"))[0]?.label).toBe("exam");
    expect(() => lanesOf(lane(""))).toThrow("lane 1 has no label");
  });

  // The sets each lane opened under while they were read from its `Starts from` prose, before the
  // `Marks:` line (8 November 2026); a change to one is a change to how investigations open.
  it("reads each lane's standing, isolation, blindness and side-by-side climb from its marks", () => {
    const lanes = lanesOf(catalogueText());
    const marked = (flag: (lane: Lane) => boolean) =>
      lanes.filter((lane) => flag(lane)).map(({ number }) => number);
    expect(marked(({ standing }) => standing)).toEqual([1, 2, 18, 26, 27]);
    expect(marked(({ isolated }) => isolated)).toEqual([4, 15]);
    expect(marked(({ blind }) => blind)).toEqual([27]);
    expect(marked(({ sideBySide }) => sideBySide)).toEqual([22]);
    for (const { body } of lanes) expect(body).not.toMatch(/^Marks:/mu);
  });

  it("reads marks and not prose, and names a lane with no marks line or an unknown mark", () => {
    const lane = (marks: string) =>
      `**1. A lane.**\n\nLabel: \`exam\`.\nImportance: 0.5.\n${marks}\nStarts from \`A (lane 1)\`, and is standing. It runs alone.\n`;
    const [quiet] = lanesOf(lane("Marks: none.\n"));
    expect([quiet?.standing, quiet?.isolated]).toEqual([false, false]);
    const [loud] = lanesOf(lane("Marks: `blind`, `side-by-side`.\n"));
    expect([loud?.standing, loud?.blind, loud?.sideBySide]).toEqual([false, true, true]);
    expect(() => lanesOf(lane(""))).toThrow("lane 1 has no marks line");
    expect(() => lanesOf(lane("Marks: `standng`.\n"))).toThrow("lane 1 carries unknown marks: standng");
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

  // On 7 November the blind grading lane, packed after three lanes that read outcomes, said its
  // grades were not blind.
  it("puts the blind lane first in its session, and the rest in number order", () => {
    const blind = lanes.filter((each) => each.blind);
    expect(blind.map(({ number }) => number)).toEqual([27]);
    expect(blind.every(({ standing }) => standing)).toBe(true);
    for (const count of [1, 2, 3, 4, 6, 8]) {
      const sessions = sessionsOf(lanes, count);
      const home = sessions.find((session) => session.some((each) => each.blind));
      expect(home?.[0]?.number).toBe(27);
      for (const session of sessions) {
        const rest = session.filter((each) => !each.blind).map(({ number }) => number);
        expect(rest).toEqual(rest.toSorted((one, other) => one - other));
      }
    }
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
