import { describe, expect, it } from "bun:test";
import {
  GAP_FLOOR,
  JUDGE_STEP,
  judgedGain,
  judgedPairs,
  type JudgeWeights,
  type Paired,
  pointsOf,
  type Vote,
} from "../src/kernel/compare.ts";

const MIRRORED = [-1, -0.5, 0, 0.5, 1];
const CODE = [-1, -0.2, -0.05, 0, 0.05, 0.2, 1];
const WEIGHTS: JudgeWeights[] = [
  { code: 0, judge: 1 },
  { code: 1, judge: 1 },
  { code: 3, judge: 1 },
  { code: 1, judge: 4 },
];
const vote = (judge: number, holistic: number): Vote => ({ fresh: 0, old: 0, judge, holistic });

describe("the judged composite gain", () => {
  it("is bounded, odd, and non-decreasing in code, judge and holistic over every mirrored vote and weight mix", () => {
    const cases = WEIGHTS.flatMap((weights) =>
      (weights.code === 0 ? [0] : CODE).flatMap((code) =>
        MIRRORED.flatMap((judge) => MIRRORED.map((holistic) => ({ weights, code, judge, holistic }))),
      ),
    );
    const up = (value: number) => Math.min(1, value + 0.5);
    for (const { weights, code, judge, holistic } of cases) {
      const gain = judgedGain(weights, code, vote(judge, holistic));
      expect(Math.abs(gain)).toBeLessThanOrEqual(1);
      expect(judgedGain(weights, -code, vote(-judge, -holistic))).toBeCloseTo(-gain, 12);
      expect(judgedGain(weights, code, vote(up(judge), holistic))).toBeGreaterThanOrEqual(gain);
      expect(judgedGain(weights, code, vote(judge, up(holistic)))).toBeGreaterThanOrEqual(gain);
      const coded = weights.code === 0 ? gain + 1 : judgedGain(weights, code + 0.01, vote(judge, holistic));
      expect(coded).toBeGreaterThan(gain);
    }
    expect(cases).toHaveLength(25 + 3 * 7 * 25);
  });

  it("keeps the smallest judged win above the gap floor: one item of four on a 1:1 mix and on a judged-only exam", () => {
    const single = 0.5 / 4;
    expect(judgedGain({ code: 1, judge: 1 }, 0, vote(single, 0))).toBeCloseTo((JUDGE_STEP * single) / 3, 12);
    expect(judgedGain({ code: 1, judge: 1 }, 0, vote(single, 0))).toBeGreaterThan(GAP_FLOOR);
    expect(judgedGain({ code: 0, judge: 1 }, 0, vote(single, 0))).toBe(0.0625);
    expect(judgedGain({ code: 1, judge: 1 }, 0.25, vote(0, 0))).toBeCloseTo(0.25 / 3, 12);
  });
});

describe("valid-only judged pairing", () => {
  const ids = (side: string, count: number) =>
    Array.from({ length: count }, (_, at) => `${side}${String(at)}`);
  it("pairs min(valid) disjoint valid solves, whatever order the solves finished in", () => {
    let cases = 0;
    for (let mask = 0; mask < 1 << 6; mask += 1) {
      const fresh = [0, 1, 2].map((bit) => (mask & (1 << bit)) !== 0);
      const old = [3, 4, 5].map((bit) => (mask & (1 << bit)) !== 0);
      const solves = { fresh: ids("f", 3), old: ids("o", 3) };
      const pairs = judgedPairs("c-1:t-1", solves, { fresh, old });
      expect(pairs).toHaveLength(Math.min(fresh.filter(Boolean).length, old.filter(Boolean).length));
      expect(new Set(pairs.map(([f]) => f)).size).toBe(pairs.length);
      expect(new Set(pairs.map(([, o]) => o)).size).toBe(pairs.length);
      expect(pairs.every(([f, o]) => fresh[f] === true && old[o] === true)).toBe(true);
      const named = (list: [number, number][], given: typeof solves) =>
        list.map(([f, o]) => `${given.fresh[f] ?? ""}/${given.old[o] ?? ""}`).toSorted();
      const flipped = { fresh: solves.fresh.toReversed(), old: solves.old.toReversed() };
      const again = judgedPairs("c-1:t-1", flipped, { fresh: fresh.toReversed(), old: old.toReversed() });
      expect(named(again, flipped)).toEqual(named(pairs, solves));
      cases += 1;
    }
    expect(cases).toBe(64);
  });
});

describe("judged points", () => {
  const pair: Paired = {
    task: "t-1",
    fresh: [true, true],
    old: [true, false],
    objective: { direction: "higher", scale: "unit", fresh: [0.6, 0.5], old: [0.4, null] },
  };
  it("reads a pair as before without votes, and scales its judged gains to the valid pairs it stands for", () => {
    const legacy = pointsOf(pair);
    expect(pointsOf({ ...pair, judged: { weights: { code: 1, judge: 1 }, votes: [] } })).toEqual(legacy);
    const votes = [{ fresh: 1, old: 0, judge: 1, holistic: 0.5 }];
    const judged = pointsOf({ ...pair, judged: { weights: { code: 1, judge: 1 }, votes } });
    expect(judged.validity).toBe(legacy.validity);
    const gain = judgedGain({ code: 1, judge: 1 }, 0.1, votes[0] ?? vote(0, 0));
    expect(judged.objective).toBeCloseTo(gain * 2 * 0.3 * (1000 / 4), 9);
  });
});
