// The permutation test every skill's then-and-now reading shares (`.claude/skills/main/stats.ts`):
// p is a share of deals, exact where they can be counted and repeatable where they are drawn, and
// beside it the smallest p any deal of the same runs could read.
import { expect, it } from "bun:test";
import { shiftOf } from "#skills/main/stats.ts";

const empty = { part: 0, whole: 0 };
const mean = (units: readonly number[]) =>
  units.length === 0 ? null : units.reduce((sum, unit) => sum + unit, 0) / units.length;
/** A ratio of sums, which has no value where every denominator is empty. */
const ratio = (units: readonly { part: number; whole: number }[]) => {
  const whole = units.reduce((sum, unit) => sum + unit.whole, 0);
  return whole === 0 ? null : units.reduce((sum, unit) => sum + unit.part, 0) / whole;
};

it("reads groups that do not differ as p 1, where no deal could read a difference either", () => {
  expect(shiftOf([1, 1, 1, 1, 1], [1, 1, 1, 1, 1], mean)).toEqual({ p: 1, least: 1 });
});

it("counts the record and its mirror alone where the groups do not overlap", () => {
  const { p, least } = shiftOf([1, 2, 3, 4, 5], [11, 12, 13, 14, 15], mean);
  expect(p).toBeCloseTo(2 / 252, 12);
  expect(least).toBeCloseTo(2 / 252, 12);
});

it("says that three against three can read nothing at 0.05, and three against four can", () => {
  // Twenty deals: the record and its mirror are the most extreme, so no p falls below 0.1.
  const even = shiftOf([1, 2, 3], [11, 12, 13], mean);
  expect(even.p).toBeCloseTo(0.1, 12);
  expect(even.least).toBeCloseTo(0.1, 12);
  // Thirty-five deals and no mirror, since the groups differ in size: the record alone is extreme.
  const uneven = shiftOf([1, 2, 3], [11, 12, 13, 14], mean);
  expect(uneven.least).toBeCloseTo(1 / 35, 12);
});

it("draws the same shuffles on every call where the deals are too many to count", () => {
  const then = Array.from({ length: 10 }, (_, at) => at);
  const now = Array.from({ length: 10 }, (_, at) => at + 3);
  const [first, second] = [shiftOf(then, now, mean), shiftOf(then, now, mean)];
  expect(first).toEqual(second);
  // A sampled p counts the record itself, so it is never zero.
  expect(first.p).toBeGreaterThan(0);
  expect(first.p).toBeLessThan(0.2);
});

it("gives no p where a group has no value as recorded", () => {
  expect(shiftOf<number>([], [1, 2], mean).p).toBeNull();
});

it("counts a deal that leaves a group without a value on neither side", () => {
  // Two of the six deals put both empty denominators in one group.
  const read = shiftOf([{ part: 1, whole: 1 }, empty], [{ part: 0, whole: 1 }, empty], ratio);
  expect(read).toEqual({ p: 1, least: 1 });
});

it("takes the smallest p from the deals read, where most leave a group without a value", () => {
  // Three of eight units hold a denominator. The five without one cannot move the ratio, so every
  // deal that splits the three alike reads alike: twenty of the sixty deals read are as extreme as
  // any, though seventy deals exist.
  const read = shiftOf(
    [{ part: 1, whole: 1 }, empty, empty, empty],
    [{ part: 0, whole: 1 }, { part: 0, whole: 1 }, empty, empty],
    ratio,
  );
  expect(read.least).toBeCloseTo(20 / 60, 12);
});
