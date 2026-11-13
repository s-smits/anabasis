// A mechanism tried on the record reads as production does at today's values, and each form of a
// resource does what its reading claims, on the cases that would make the claim false.
import { describe, expect, it } from "bun:test";
import {
  knobbed,
  knobsOf,
  type Mechanism,
  ratioOf,
  TODAY,
} from "#skills/promotion-tuner/scripts/mechanisms.ts";
import {
  type Comparison,
  comparisonsIn,
  once,
  paired,
  type Solve,
  type Task,
} from "#skills/promotion-tuner/scripts/record.ts";
import { differenceOf, flipP } from "../src/kernel/compare.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { chainLog } from "./helpers/starter-chain.ts";

const LEVEL = 0.02;
const die = (why: string): never => {
  throw new Error(why);
};
const mechanism = (spec: string): Mechanism => knobbed(knobsOf(spec, die), spec);
const solve = (billed: number, measure: number | null = null, valid = true): Solve => ({
  valid,
  measure,
  billed,
  turns: billed,
  seconds: billed,
});
const task = (old: readonly Solve[], fresh: readonly Solve[], direction: Task["direction"] = null): Task => ({
  task: "t",
  family: null,
  direction,
  retained: false,
  old,
  fresh,
});
/** Both sides valid and equal by every answer's measure, the new one spending `fresh` to `old`. */
const tied = (fresh: number, old = 2) => task([solve(old), solve(old)], [solve(fresh), solve(fresh)]);
const validOnlyNew = (billed: number) =>
  task([solve(1, null, false), solve(1, null, false)], [solve(billed), solve(billed)]);
const steps = (one: Mechanism, tasks: readonly Task[]) =>
  (one.test?.(tasks.map(one.score), LEVEL, tasks) ?? false) && (one.guard?.(tasks) ?? true);

describe("knobs at today's values", () => {
  it("score every shape of task as production does", () => {
    const today = knobbed(TODAY, "today");
    const values = [null, -10, -1, 0, 1, 9.95, 10, 10.05, 100];
    const flags = [
      [true, true],
      [true, false],
      [false, false],
    ];
    const side = (valid: readonly boolean[], measure: number | null) =>
      valid.map((is) => solve(1, measure, is));
    const measures = values.flatMap((one) => values.map((other) => [one, other] as const));
    const validities = flags.flatMap((old) => flags.map((fresh) => [old, fresh] as const));
    const grid = (["lower", "higher", null] as const).flatMap((direction) =>
      measures.flatMap(([one, other]) =>
        validities.map(([old, fresh]) => task(side(old, one), side(fresh, other), direction)),
      ),
    );
    for (const each of grid) expect(today.score(each)).toBe(differenceOf(paired(each)));
    expect(grid.length).toBe(3 * 9 * 9 * 3 * 3);
  });

  it("read a step where the sign-flip test does, and nowhere else", () => {
    const today = knobbed(TODAY, "today");
    const won = Array.from({ length: 6 }, () => validOnlyNew(1));
    expect(steps(today, won)).toBe(flipP(won.map(today.score)) <= LEVEL);
    expect(steps(today, won)).toBe(true);
    expect(steps(today, won.slice(1))).toBe(false);
  });
});

describe("a resource as a gain", () => {
  it("turns a tie into a win where the new side spends less, and a loss where it spends more", () => {
    expect(knobbed(TODAY, "today").score(tied(1))).toBe(0);
    expect(mechanism("bill=0.1").score(tied(1))).toBe(100);
    expect(mechanism("bill=0.1").score(tied(4))).toBe(-100);
  });

  it("counts nothing under its floor, and at most one either way", () => {
    expect(mechanism("bill=0.1").score(tied(1.8))).toBe(0);
    expect(mechanism("bill=0.1").score(tied(0.001))).toBe(100);
  });

  it("carries a step on cost alone, which is why `lead` exists", () => {
    const cheaper = Array.from({ length: 6 }, () => tied(1));
    expect(steps(mechanism("bill=0.1"), cheaper)).toBe(true);
    expect(steps(mechanism("bill=0.1,lead=answers"), cheaper)).toBe(false);
  });

  it("tips a comparison whose answers lead", () => {
    // Two wins on answers alone cannot clear the level; six with the savings can.
    const tasks = [validOnlyNew(1), validOnlyNew(1), ...Array.from({ length: 4 }, () => tied(1))];
    expect(steps(knobbed(TODAY, "today"), tasks)).toBe(false);
    expect(steps(mechanism("bill=0.1,lead=answers"), tasks)).toBe(true);
  });

  it("leans between identical sides when it counts one way only, so a one-sided form reads a false gain", () => {
    // Two solves of one harness differ by noise: a form that counts both ways nets to nothing.
    const noise = task([solve(1), solve(4)], [solve(4), solve(1)]);
    expect(mechanism("bill=0.1").score(noise)).toBe(0);
    expect(mechanism("bill=0.1,side=cheaper").score(noise)).toBeGreaterThan(0);
    expect(mechanism("bill=0.1,side=dearer").score(noise)).toBeLessThan(0);
  });
});

describe("a resource as a guard", () => {
  it("refuses a dearer harness that wins every task, and adds no step", () => {
    const dearerWins = Array.from({ length: 6 }, () =>
      task([solve(1, 100), solve(1, 100)], [solve(3, 50), solve(3, 50)], "lower"),
    );
    expect(steps(knobbed(TODAY, "today"), dearerWins)).toBe(true);
    expect(steps(mechanism("mostBill=1.5"), dearerWins)).toBe(false);
    expect(steps(mechanism("mostBill=3"), dearerWins)).toBe(true);
    const noStep = dearerWins.slice(1);
    expect(steps(mechanism("mostBill=1.5"), noStep)).toBe(false);
  });

  it("reads only tasks every solve of which is valid, and passes where there are none", () => {
    expect(ratioOf([validOnlyNew(100)], "bill")).toBeNull();
    expect(mechanism("mostBill=1.1").guard?.([validOnlyNew(100)])).toBe(true);
    expect(ratioOf([tied(3), tied(1)], "bill")).toBe(1);
    expect(ratioOf([tied(3), validOnlyNew(100)], "bill")).toBe(1.5);
  });
});

describe("the unit a test counts", () => {
  const scored = (old: number, fresh: number) =>
    task([solve(1, old), solve(1, old)], [solve(1, fresh), solve(1, fresh)], "lower");
  const of = (family: string | null, one: Task): Task => ({ ...one, family });

  it("reads six wins of one family as one unit, and six families or six tasks of none as six", () => {
    const siblings = Array.from({ length: 6 }, () => of("one", scored(100, 50)));
    const apart = siblings.map((one, nth) => of(`f${String(nth)}`, one));
    expect(steps(knobbed(TODAY, "today"), siblings)).toBe(true);
    for (const unit of ["unit=family", "unit=first"]) {
      expect(steps(mechanism(unit), siblings)).toBe(false);
      expect(steps(mechanism(unit), apart)).toBe(true);
      expect(
        steps(
          mechanism(unit),
          siblings.map((one) => of(null, one)),
        ),
      ).toBe(true);
    }
  });

  it("takes a family's mean over its tasks, where its first task alone reads the other way", () => {
    // Each family's first task is won by 150 points and its second lost by 225.
    const mixed = Array.from({ length: 6 }, (_, nth) => `f${String(nth)}`).flatMap((family) => [
      of(family, scored(100, 50)),
      of(family, scored(25, 100)),
    ]);
    expect(steps(mechanism("unit=first"), mixed)).toBe(true);
    expect(steps(mechanism("unit=family"), mixed)).toBe(false);
    expect(steps(mechanism("unit=family"), mixed.toReversed())).toBe(false);
  });
});

describe("a spec", () => {
  it("refuses a knob or a value it does not know", () => {
    expect(() => knobsOf("bil=0.1", die)).toThrow("no knob bil");
    expect(() => knobsOf("bill=lots", die)).toThrow("bill takes a number");
    expect(() => knobsOf("bill=-1", die)).toThrow("bill takes a number");
    expect(() => knobsOf("when=sometimes", die)).toThrow("when takes");
  });
});

describe("the record", () => {
  it("counts a fork's copy of a comparison once, in the campaign that opened first", () => {
    const of = (campaign: string, opened: number, fresh = "b"): Comparison => ({
      campaign,
      pack: "p",
      opened,
      session: "g-1",
      kind: "candidate",
      old: "a",
      fresh,
      level: LEVEL,
      reading: "no-step",
      tasks: [tied(1)],
      aa: [],
      after: { promoted: [], readings: 0 },
      confirmed: null,
    });
    expect(
      once([of("fork", 2), of("parent", 1), of("other", 3, "c")]).map(({ campaign }) => campaign),
    ).toEqual(["parent", "other"]);
  });

  it("gives each task its family, and a step the confirmation of the promotion it made", () => {
    const read = (events: readonly LogEvent[]) =>
      Object.fromEntries(comparisonsIn("c", events).map(({ session, confirmed }) => [session, confirmed]));
    // The first promotion's starter read is 7 to 3, no step; the second's is 10 to 0 or 7 to 3. A
    // starter read made no promotion, so it holds none.
    expect(read(chainLog("won"))).toEqual({ "g-1": false, "g-2": null, "g-3": true, "g-4": null });
    expect(read(chainLog("lost"))["g-3"]).toBe(false);
    // Before its starter read reports, a promotion is unread, which is not unconfirmed.
    const log = chainLog("won");
    const unread = log.slice(
      0,
      log.findIndex(({ kind, data }) => kind === "comparison.started" && data.session === "g-4"),
    );
    expect(read(unread)["g-3"]).toBeNull();
    expect(comparisonsIn("c", log).flatMap(({ tasks }) => tasks.map(({ family }) => family))).toEqual(
      Array.from({ length: 34 }, () => "fixture"),
    );
  });

  it("reads no comparison from a log with none that scored a task", () => {
    const report: LogEvent = {
      at: "2026-11-01T00:00:01.000Z",
      kind: "comparison.reported",
      data: {
        session: "g-1",
        old: "a",
        fresh: "b",
        setting: "s",
        solves: 2,
        versions: [],
        reading: "not-scored",
      },
    };
    expect(comparisonsIn("c", [report])).toEqual([]);
  });
});
