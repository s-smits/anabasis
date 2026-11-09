// The catalogue keeps its thirty-one lanes numbered in order, each trigger starting the lane the
// reader names, and a session that holds the blind lane reads it first.
import { describe, expect, it } from "bun:test";
import { catalogueText, type Lane, lanesOf } from "../tools/wri/catalogue.ts";
import { sessionsOf, weightOf } from "../tools/wri/investigation.ts";
import { CATEGORIES } from "../tools/runtime/land.ts";
import { TRIGGERS } from "../tools/wri/folds.ts";

describe("the lane catalogue", () => {
  it("holds thirty-one lanes, numbered in order", () => {
    expect(lanesOf(catalogueText()).map(({ number }) => number)).toEqual(
      Array.from({ length: 31 }, (_, index) => index + 1),
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
    // The nearest hostile case for a lane added standing, with no trigger to name it: a label and
    // marks but no importance line is named, and so is an importance outside 0 to 1.
    const weighed = (importance: string) =>
      `**30. A lane.**\n\nLabel: \`climb\`.\n${importance}Marks: \`standing\`.\n\nStarts from every read, and is standing.\n`;
    expect(lanesOf(weighed("Importance: 0.8.\n"))[0]?.importance).toBe(0.8);
    expect(() => lanesOf(weighed(""))).toThrow("lane 30 has no label or no importance line");
    expect(() => lanesOf(weighed("Importance: 1.5.\n"))).toThrow(
      "lane 30 has no label or no importance line",
    );
  });

  // The sets each lane opened under while they were read from its `Starts from` prose, before the
  // `Marks:` line (8 November 2026); a change to one is a change to how investigations open.
  it("reads each lane's standing, isolation, blindness and side-by-side climb from its marks", () => {
    const lanes = lanesOf(catalogueText());
    const marked = (flag: (lane: Lane) => boolean) =>
      lanes.filter((lane) => flag(lane)).map(({ number }) => number);
    expect(marked(({ standing }) => standing)).toEqual([1, 2, 18, 26, 27, 30, 31]);
    expect(marked(({ isolated }) => isolated)).toEqual([4, 15]);
    expect(marked(({ blind }) => blind)).toEqual([27]);
    expect(marked(({ sideBySide }) => sideBySide)).toEqual([22, 31]);
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
  const openLanes = lanes.filter(({ isolated }) => !isolated);
  const numbers = (sessions: readonly Lane[][]) =>
    sessions
      .flat()
      .map(({ number }) => number)
      .toSorted((one, other) => one - other);

  it("puts every lane in exactly one session, as many sessions as asked where the lanes allow", () => {
    for (const count of [1, 2, 3, 4, 6, 9, 12, 40]) {
      const sessions = sessionsOf(lanes, count);
      expect(numbers(sessions)).toEqual(lanes.map(({ number }) => number));
      expect(sessions.filter((each) => each.some(({ isolated }) => !isolated))).toHaveLength(
        Math.min(count, openLanes.length),
      );
      for (const each of sessions.filter((one) => one.some(({ isolated }) => isolated))) {
        expect(each).toHaveLength(1);
      }
    }
  });

  // Whole labels left the lightest of four sessions at 0.39 of the heaviest over the last 22 open
  // lanes, where the climb label weighs 5.85 of 17.35, and at 0.746 over the first 22.
  it("packs 22 lanes, or all the open ones, into four sessions, the lightest at least three quarters of the heaviest", () => {
    for (const selection of [openLanes.slice(-22), openLanes.slice(0, 22), openLanes]) {
      const sessions = sessionsOf(selection, 4);
      expect(sessions).toHaveLength(4);
      expect(numbers(sessions)).toEqual(selection.map(({ number }) => number));
      const weights = sessions.map(weightOf);
      expect(Math.min(...weights)).toBeGreaterThanOrEqual(0.75 * Math.max(...weights));
    }
  });

  it("halves a heavy label only where whole labels leave the sessions uneven", () => {
    const [base] = lanes;
    if (base === undefined) throw new Error("the catalogue holds no lane");
    const made = (number: number, label: string, importance: number): Lane => ({
      ...base,
      number,
      label,
      importance,
      isolated: false,
    });
    const packed = (given: readonly Lane[]) =>
      sessionsOf(given, 2).map((each) => each.map(({ number }) => number));
    const light = [made(4, "a", 0.2), made(5, "b", 0.2), made(6, "c", 0.2)];
    // Whole, the heavy label weighs 3 against 0.6; halved, 2 against 1.6.
    expect(packed([made(1, "heavy", 1), made(2, "heavy", 1), made(3, "heavy", 1), ...light])).toEqual([
      [1, 3],
      [2, 4, 5, 6],
    ]);
    // Whole, 1 against 0.9 is even enough, so no label is split.
    expect(
      packed([made(1, "heavy", 0.5), made(2, "heavy", 0.5), made(4, "a", 0.5), made(5, "a", 0.4)]),
    ).toEqual([
      [1, 2],
      [4, 5],
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
});
