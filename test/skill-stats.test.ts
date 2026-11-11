// The permutation test every skill's then-and-now reading shares (`.claude/skills/main/stats.ts`):
// p is a share of deals, exact where they can be counted and repeatable where they are drawn.
import { expect, it } from "bun:test";
import { shiftOf } from "#skills/main/stats.ts";

const mean = (units: readonly number[]) =>
  units.length === 0 ? null : units.reduce((sum, unit) => sum + unit, 0) / units.length;

it("reads groups that do not differ as p 1, over every deal", () => {
  expect(shiftOf([1, 1, 1, 1, 1], [1, 1, 1, 1, 1], mean)).toEqual({ p: 1, deals: 252 });
});

it("counts the record and its mirror alone where the groups do not overlap", () => {
  const { p, deals } = shiftOf([1, 2, 3, 4, 5], [11, 12, 13, 14, 15], mean);
  expect(deals).toBe(252);
  expect(p).toBeCloseTo(2 / 252, 12);
});

it("says how few deals three against three has, which no level of 0.05 can read", () => {
  const { p, deals } = shiftOf([1, 2, 3], [11, 12, 13], mean);
  expect(deals).toBe(20);
  // The smallest p twenty deals can give is the record and its mirror, above 0.05.
  expect(p).toBeCloseTo(0.1, 12);
});

it("draws the same shuffles on every call where the deals are too many to count", () => {
  const then = Array.from({ length: 10 }, (_, at) => at);
  const now = Array.from({ length: 10 }, (_, at) => at + 3);
  const [first, second] = [shiftOf(then, now, mean), shiftOf(then, now, mean)];
  expect(first.deals).toBe(Infinity);
  expect(first).toEqual(second);
  // A sampled p counts the record itself, so it is never zero.
  expect(first.p).toBeGreaterThan(0);
  expect(first.p).toBeLessThan(0.2);
});

it("gives no p where a group has no value as recorded", () => {
  expect(shiftOf<number>([], [1, 2], mean).p).toBeNull();
});

it("counts a deal that leaves a group without a value on neither side", () => {
  // A ratio of sums: two of the six deals put both empty denominators in one group.
  const ratio = (units: readonly { part: number; whole: number }[]) => {
    const whole = units.reduce((sum, unit) => sum + unit.whole, 0);
    return whole === 0 ? null : units.reduce((sum, unit) => sum + unit.part, 0) / whole;
  };
  const empty = { part: 0, whole: 0 };
  const read = shiftOf([{ part: 1, whole: 1 }, empty], [{ part: 0, whole: 1 }, empty], ratio);
  expect(read).toEqual({ p: 1, deals: 6 });
});
