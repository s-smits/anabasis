// The sign draws of a starter read (comparison-reading's `selection.ts`), against every draw asked of
// the comparison's own test, and which tasks `starterReads` counts as no step's choice. Invented data.
import { describe, expect, it } from "bun:test";
import { stepCount } from "#skills/comparison-reading/scripts/selection.ts";
import { chosenForReference, starterReads } from "../src/campaign/climb.ts";
import { scoredSet } from "../src/campaign/round.ts";
import { flipP, isSignificant } from "../src/kernel/compare.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { roundSolves } from "./helpers/logged-round.ts";

const STARTER = "a".repeat(64);
const NEW = "b".repeat(64);
const AT = "2026-10-30T00:00:00.000Z";
const chose = Array.from({ length: 7 }, (_, nth) => `chose-${String(nth)}`);

/** Every sign draw of the untied `free`, each asked of `isSignificant` with `fixed` as scored. */
function brute(fixed: readonly number[], free: readonly number[], level: number): number {
  const untied = free.filter((one) => one !== 0).map(Math.abs);
  let confirm = 0;
  for (let draw = 0; draw < 2 ** untied.length; draw += 1) {
    const signs = untied.map((size, at) => (Math.floor(draw / 2 ** at) % 2 === 1 ? size : -size));
    if (isSignificant([...fixed, ...signs], level)) confirm += 1;
  }
  return confirm;
}

function margins(count: number, seed: number): number[] {
  let state = seed;
  return Array.from({ length: count }, () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    const size = [0, 40, 40, 120, 300, 600, 600, 75][state % 8] ?? 0;
    return state % 3 === 0 ? -size : size;
  });
}

describe("how many sign draws of the tasks written after read a step", () => {
  it("agrees with every draw asked of isSignificant, at each size brute force reaches", () => {
    for (let free = 0; free <= 14; free += 1) {
      for (const [seed, level] of [
        [free + 1, 0.02],
        [free + 101, 0.1],
      ] as const) {
        const fixed = margins(10, seed * 7);
        const after = margins(free, seed);
        const counted = stepCount(fixed, after, level);
        expect(Number(counted.confirm)).toBe(brute(fixed, after, level));
        expect(counted.draws).toBe(2n ** BigInt(after.filter((one) => one !== 0).length));
      }
    }
  });

  it("keeps a tied task written after a tie in every draw rather than giving it two signs", () => {
    const counted = stepCount([600, 600, 600, 600, 600], [600, 0, 0], 0.02);
    expect([counted.free, counted.draws, counted.confirm]).toEqual([1, 2n, 1n]);
  });

  it("takes the test's threshold over every untied size, not over the fixed tasks' alone", () => {
    // Six fixed wins of 100 read a step alone (1 in 64), but beside one large task lost they do not.
    const fixed = [100, 100, 100, 100, 100, 100];
    expect(isSignificant(fixed, 0.02)).toBe(true);
    expect(flipP([...fixed, -900])).toBeGreaterThan(0.02);
    expect(stepCount(fixed, [900], 0.02).confirm).toBe(1n);
  });

  it("counts one draw for a read with no untied task written after, as its other tasks read", () => {
    expect(stepCount([600, 600, 600, 600, 600, 600], [], 0.02)).toEqual({ free: 0, draws: 1n, confirm: 1n });
    expect(stepCount([600, -600], [0, 0], 0.02)).toEqual({ free: 0, draws: 1n, confirm: 0n });
  });
});

const gate = (version: string, session?: string): LogEvent[] => [
  {
    at: AT,
    kind: "task.proposed",
    data: {
      version,
      taskId: version,
      task: { taskId: version, family: "fixture", publicInput: {}, hidden: null },
      ...keyIfDefined("session", session),
    },
  },
  { at: AT, kind: "task.gate", data: { version, gate: 1, outcome: "passed" } },
];

function comparison(
  session: string,
  sides: readonly [string, string],
  outcomes: Readonly<Record<string, string>>,
  reading: string,
  more: JsonObject = { level: 0.02 },
): LogEvent[] {
  const { events, terms } = roundSolves(session, sides, outcomes);
  const [old, fresh] = sides;
  return [
    { at: AT, kind: "comparison.started", data: { session, old, fresh, starter: STARTER } },
    ...events,
    {
      at: AT,
      kind: "comparison.reported",
      data: { session, old, fresh, starter: STARTER, reading, noise: null, scored: {}, ...terms, ...more },
    },
  ];
}

const promotion: LogEvent[] = [
  ...chose.flatMap((task) => gate(task)),
  ...comparison("g-1", [STARTER, NEW], Object.fromEntries(chose.map((task) => [task, "FF PP"])), "step"),
  { at: AT, kind: "harness.promoted", data: { harness: NEW, from: STARTER, rests: [] } },
];

describe("a starter read on the tasks no step chose", () => {
  const THIRD = "c".repeat(64);
  const second = Array.from({ length: 6 }, (_, nth) => `second-${String(nth)}`);
  const after = ["after-0", "after-1"];
  const all = [...chose, ...second, ...after];
  const beforeRead: LogEvent[] = [
    ...promotion,
    ...second.flatMap((task) => gate(task, "x-2")),
    ...comparison("g-2", [NEW, THIRD], Object.fromEntries(second.map((task) => [task, "FF PP"])), "step"),
    { at: AT, kind: "harness.promoted", data: { harness: THIRD, from: NEW, rests: [] } },
    ...after.flatMap((task) => gate(task, "x-3")),
  ];
  const log: LogEvent[] = [
    ...beforeRead,
    ...comparison("g-3", [THIRD, STARTER], Object.fromEntries(all.map((task) => [task, "PP FF"])), "step"),
  ];

  it("is drawn on none of the tasks a step chose before the reference, retained ones included", () => {
    expect(chosenForReference(beforeRead, NEW).size).toBe(0);
    const leftOut = chosenForReference(beforeRead, STARTER);
    expect([...leftOut].toSorted()).toEqual([...chose, ...second].toSorted());
    expect(scoredSet(beforeRead, 12, "c", leftOut).tasks.toSorted()).toEqual(after);
  });

  it("leaves out an ancestor's chosen tasks, which the origins count as written before and not chosen on", () => {
    const [read] = starterReads(log);
    expect(read?.origins["read at the promotion"].whole.wins).toBe(second.length);
    expect(read?.origins["written before, not chosen on"].whole.wins).toBe(chose.length);
    expect(read?.unchosen).toEqual({ tally: { wins: 2, losses: 0, ties: 0 }, read: "too few" });
  });

  it("keeps the tasks of a step the starter won, which chose nothing the reference descends from", () => {
    const lost = ["lost-0", "lost-1"];
    const read = starterReads([
      ...promotion,
      ...lost.flatMap((task) => gate(task, "x-2")),
      ...comparison("g-1s", [NEW, STARTER], Object.fromEntries(lost.map((task) => [task, "FF PP"])), "step"),
      ...second.flatMap((task) => gate(task, "x-2")),
      ...comparison("g-2", [NEW, THIRD], Object.fromEntries(second.map((task) => [task, "FF PP"])), "step"),
      { at: AT, kind: "harness.promoted", data: { harness: THIRD, from: NEW, rests: [] } },
      ...after.flatMap((task) => gate(task, "x-3")),
      ...comparison(
        "g-3",
        [THIRD, STARTER],
        Object.fromEntries([...all, ...lost].map((task) => [task, "PP FF"])),
        "step",
      ),
    ]).at(-1);
    expect(read?.session).toBe("g-3");
    expect(read?.unchosen.tally.wins).toBe(after.length + lost.length);
  });
});
