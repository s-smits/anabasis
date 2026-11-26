// The comparison's arithmetic checked on every input up to a bound, each against a calculation
// written from the definition rather than from the code: the sign-flip p by counting every sign
// pattern, power by weighting those patterns, a task's score by counting its pairings. Within the
// bounds these are proofs by enumeration; beyond them they say nothing.
import { describe, expect, it } from "bun:test";
import {
  carriedBy,
  detectable,
  differenceOf,
  draw,
  flipP,
  GAP_FLOOR,
  gainOver,
  gapAgainst,
  informative,
  objectiveRuleIn,
  objectiveRuleOf,
  type Paired,
  pointsOf,
  power,
  rawFlipP,
  isSignificant,
  isSignificantTwoSided,
  scored,
  scoresIn,
  upperBound,
  sweepOf,
  testOf,
  WEIGHTS,
  wholePoints,
} from "../src/kernel/compare.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { PATIENCE, patienceOf, evalHeadroom } from "../src/kernel/reports.ts";
import { howOftenValid, SIZE, sizeLines, smallestSteps } from "../src/kernel/size.ts";

const LEVELS = [0.02, 0.05, 0.1, 0.25];

const CLOSE = 1e-12;

/** Every multiset of `length` values from `alphabet`, as a nondecreasing list. The test reads
 *  scores as a multiset (permutation invariance is checked apart), so this covers every vector. */
function multisets(alphabet: readonly number[], length: number): number[][] {
  if (length === 0) return [[]];
  const found: number[][] = [];
  const walk = (from: number, taken: readonly number[]): void => {
    if (taken.length === length) {
      found.push([...taken]);
      return;
    }
    for (let at = from; at < alphabet.length; at += 1) walk(at, [...taken, alphabet[at] ?? 0]);
  };
  walk(0, []);
  return found;
}

const upTo = (alphabet: readonly number[], most: number) =>
  Array.from({ length: most + 1 }, (_, length) => multisets(alphabet, length)).flat();

/** Independent doubled mid-rank definition over nonzero scores for exhaustive verification. */
function doubledRanks(scores: readonly number[]): number[] {
  const nonzero = scores.filter((one) => one !== 0);
  const abs = nonzero.map(Math.abs);
  return nonzero.map((one) => {
    const size = Math.abs(one);
    const smaller = abs.filter((other) => other < size).length;
    const equal = abs.filter((other) => other === size).length;
    return Math.sign(one) * (2 * smaller + equal + 1);
  });
}

/** Each sign pattern over the untied doubled mid-ranks of `scores`, with how many of them are positive. */
function patterns(scores: readonly number[]) {
  const margins = doubledRanks(scores).map(Math.abs);
  return Array.from({ length: 2 ** margins.length }, (_, bits) => {
    const flipped = margins.map((margin, at) => ((bits >> at) & 1 ? margin : -margin));
    return { flipped, wins: flipped.filter((one) => one > 0).length, untied: margins.length };
  });
}

const sum = (values: readonly number[]) => values.reduce((total, one) => total + one, 0);

/** The Wilcoxon signed-rank p from its definition: the share of sign patterns over untied mid-ranks
 *  whose sum is at least the observed rank sum. */
const countedP = (scores: readonly number[]) => {
  const observed = sum(doubledRanks(scores));
  const all = patterns(scores);
  return all.filter(({ flipped }) => sum(flipped) >= observed).length / all.length;
};

/** The same share without listing the patterns: every reachable sum of the signed doubled ranks,
 *  with its count of patterns in exact integers. */
function talliedP(scores: readonly number[]): number {
  const ranked = doubledRanks(scores);
  const margins = ranked.map(Math.abs);
  let sums = new Map<number, bigint>([[0, 1n]]);
  for (const margin of margins) {
    const reached = new Map<number, bigint>();
    for (const [total, ways] of sums) {
      for (const signed of [total + margin, total - margin]) {
        reached.set(signed, (reached.get(signed) ?? 0n) + ways);
      }
    }
    sums = reached;
  }
  const observed = sum(ranked);
  const atLeast = [...sums].reduce((total, [at, ways]) => (at >= observed ? total + ways : total), 0n);
  return Number(atLeast) / 2 ** margins.length;
}

describe("the sign-flip p", () => {
  it("equals the share of sign patterns at least as favourable, on every multiset of up to eight small scores", () => {
    for (const scores of upTo([-3, -2, -1, 0, 1, 2, 3], 8)) {
      expect(Math.abs(flipP(scores) - countedP(scores))).toBeLessThan(CLOSE);
    }
  });

  it("equals it on every multiset of up to five scores at the scale of real thousandths", () => {
    for (const scores of upTo([-900, -600, -300, -60, -3, 0, 3, 60, 300, 600, 900], 5)) {
      expect(Math.abs(flipP(scores) - countedP(scores))).toBeLessThan(CLOSE);
    }
  });

  // Production draws 20 to 100 tasks, past any listing of sign patterns, where p falls to 1e-30 and a
  // slip in its arithmetic would hide under an absolute tolerance; the sums are counted instead.
  it("equals an exact count of the sums at the 20 to 100 tasks production draws, to a relative 1e-9", () => {
    let seed = 7;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (const [tasks, alphabet] of [
      [20, [-900, -300, -60, -3, 0, 3, 60, 300, 900]],
      [31, [-3, -2, -1, 0, 1, 2, 3]],
      [32, [-900, -300, -60, -3, 0, 3, 60, 300, 900]],
      [40, [-3, -2, -1, 0, 1, 2, 3]],
      [53, [-3, -2, -1, 0, 1, 2, 3]],
      [60, [-3, -2, -1, 0, 1, 2, 3]],
      [100, [-3, -2, -1, 0, 1, 2, 3]],
    ] as const) {
      for (const drift of [0, 0.15, 0.3, 0.5]) {
        const scores = Array.from({ length: tasks }, () => {
          const at = Math.min(alphabet.length - 1, Math.floor((next() + drift) * alphabet.length));
          return alphabet[at] ?? 0;
        });
        const exact = talliedP(scores);
        expect(Math.abs(flipP(scores) - exact)).toBeLessThanOrEqual(1e-9 * exact);
      }
    }
  });

  it("does not depend on the order of the scores", () => {
    for (const scores of upTo([-3, -1, 0, 2, 3], 6)) {
      const reversed = scores.toReversed();
      const rotated = [...scores.slice(1), ...scores.slice(0, 1)];
      expect(flipP(reversed)).toBe(flipP(scores));
      expect(flipP(rotated)).toBe(flipP(scores));
    }
  });

  it("reads a step at a level exactly where p is at or under it, and an A/A step the same either way", () => {
    let mixed = 0;
    for (const scores of upTo([-2, -1, 0, 1, 2], 8)) {
      if (scores.some((one) => one < 0) && isSignificant(scores, 0.05)) mixed += 1;
      const negated = scores.map((one) => -one);
      for (const level of LEVELS) {
        expect(isSignificant(scores, level)).toBe(countedP(scores) <= level);
        expect(isSignificantTwoSided(scores, level)).toBe(isSignificantTwoSided(negated, level));
        expect(isSignificantTwoSided(scores, level)).toBe(
          countedP(scores) <= level || countedP(negated) <= level,
        );
      }
    }
    // A task the candidate lost need not keep it from a step, so the boundary is met, not avoided.
    expect(mixed).toBeGreaterThan(0);
    // Heavy-tailed single-task loss compresses under signed-rank while raw sign-flip lets it veto.
    const outlier = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, -300];
    expect(flipP(outlier)).toBeLessThanOrEqual(0.02);
    expect(rawFlipP(outlier)).toBeGreaterThan(0.5);
  });
});

describe("the exact upper bound", () => {
  const atMost = (hits: number, trials: number, chance: number) => {
    let [ways, below] = [1, 0];
    for (let at = 0; at <= hits; at += 1) {
      below += ways * chance ** at * (1 - chance) ** (trials - at);
      ways = (ways * (trials - at)) / (at + 1);
    }
    return below;
  };

  it("leaves exactly 5% below the observed count, and never falls under the observed rate, up to 40 trials", () => {
    for (let trials = 1; trials <= 40; trials += 1) {
      for (let hits = 0; hits < trials; hits += 1) {
        const bound = upperBound(hits, trials);
        expect(bound).toBeGreaterThan(hits / trials);
        expect(atMost(hits, trials, bound)).toBeCloseTo(0.05, 6);
      }
      expect(upperBound(trials, trials)).toBe(1);
      expect(upperBound(0, trials)).toBeCloseTo(1 - 0.05 ** (1 / trials), 9);
    }
  });
});

describe("the test's power", () => {
  /** Power from its definition: the chance, each untied task won with chance `share`, that the
   *  sign pattern drawn reads a step. */
  const weighed = (
    drawn: readonly { p: number; wins: number; untied: number }[],
    share: number,
    level: number,
  ) =>
    sum(
      drawn.map(({ p, wins, untied }) => (p <= level ? share ** wins * (1 - share) ** (untied - wins) : 0)),
    );

  it("equals the weighed share of stepping sign patterns, and never passes the level at a share of one half", () => {
    for (const scores of upTo([-3, -1, 0, 2, 4], 7)) {
      const all = patterns(scores);
      const sums = all.map(({ flipped }) => sum(flipped));
      const drawn = all.map(({ wins, untied }, at) => ({
        p: sums.filter((one) => one >= (sums[at] ?? 0)).length / all.length,
        wins,
        untied,
      }));
      for (const level of LEVELS) {
        expect(power(scores, 0.5, level)).toBeLessThanOrEqual(level + CLOSE);
        for (const share of [0.5, 0.7, 0.9]) {
          expect(Math.abs(power(scores, share, level) - weighed(drawn, share, level))).toBeLessThan(1e-9);
        }
      }
    }
  });

  it("names as the sweep the fewest tasks, every one won, that read a step", () => {
    for (const level of [...LEVELS, 0.01, 0.2, 0.5]) {
      const sweep = sweepOf(level);
      expect(
        isSignificant(
          Array.from({ length: sweep }, () => 1),
          level,
        ),
      ).toBe(true);
      expect(
        isSignificant(
          Array.from({ length: sweep - 1 }, () => 1),
          level,
        ),
      ).toBe(false);
    }
  });

  it("names as detectable the smallest hundredth of wins that reads a step four times in five", () => {
    for (const scores of upTo([-3, -1, 0, 2, 4], 6)) {
      for (const level of LEVELS) {
        const share = detectable(scores, level);
        if (share === null) {
          expect(power(scores, 1, level)).toBeLessThan(0.8);
          continue;
        }
        expect(power(scores, share, level)).toBeGreaterThanOrEqual(0.8);
        const below = (Math.round(share * 100) - 1) / 100;
        expect(share === 0.5 || power(scores, below, level) < 0.8).toBe(true);
      }
    }
  });
});

describe("a task's score", () => {
  const lists = (count: number): boolean[][] =>
    Array.from({ length: 2 ** count }, (_, bits) =>
      Array.from({ length: count }, (_v, at) => ((bits >> at) & 1) === 1),
    );
  /** Objective values each valid answer may take: two that tie under the floor, others that do not. */
  const MEASURES = [8, 10, 10.05, 12, null];
  const swap = (pair: Paired): Paired => ({
    task: pair.task,
    old: pair.fresh,
    fresh: pair.old,
    ...keyIfDefined(
      "objective",
      pair.objective && {
        direction: pair.objective.direction,
        old: pair.objective.fresh,
        fresh: pair.objective.old,
      },
    ),
  });
  /** Every pair at `solves` a side, without an objective and with each objective assignment of a
   *  measure to each valid answer. */
  function pairsAt(solves: number): Paired[] {
    const measuresOf = (valid: readonly boolean[]) =>
      valid.reduce<(number | null)[][]>(
        (sets, one) => sets.flatMap((set) => (one ? MEASURES : [null]).map((measure) => [...set, measure])),
        [[]],
      );
    const objectivesOf = (old: readonly boolean[], fresh: readonly boolean[]) =>
      (["lower", "higher"] as const).flatMap((direction) =>
        measuresOf(old).flatMap((oldMeasures) =>
          measuresOf(fresh).map((freshMeasures) => ({ direction, old: oldMeasures, fresh: freshMeasures })),
        ),
      );
    return lists(solves).flatMap((old) =>
      lists(solves).flatMap((fresh): Paired[] => [
        { task: "t", old, fresh },
        ...(solves > 2
          ? []
          : objectivesOf(old, fresh).map((objective) => ({ task: "t", old, fresh, objective }))),
      ]),
    );
  }
  const every = [1, 2, 3].flatMap(pairsAt);

  it("counts validity as the share of pairings that one side alone answered validly", () => {
    for (const pair of every) {
      const n = pair.old.length * pair.fresh.length;
      const freshOnly = pair.fresh.filter(Boolean).length * pair.old.filter((one) => !one).length;
      const oldOnly = pair.old.filter(Boolean).length * pair.fresh.filter((one) => !one).length;
      expect(
        Math.abs(pointsOf(pair).validity - (1000 * WEIGHTS.validity * (freshOnly - oldOnly)) / n),
      ).toBeLessThan(1e-9);
    }
  });

  it("negates exactly when the sides are exchanged, stays within the weights, and names a carrier only for an untied score", () => {
    const most = 1000 * (WEIGHTS.validity + WEIGHTS.objective);
    for (const pair of every) {
      const score = differenceOf(pair);
      expect(differenceOf(swap(pair))).toBe(score === 0 ? 0 : -score);
      expect(Object.is(differenceOf(pair), -0)).toBe(false);
      expect(Math.abs(score)).toBeLessThanOrEqual(most);
      expect(carriedBy(pointsOf(pair)) === null).toBe(score === 0);
      if (pair.objective === undefined) expect(pointsOf(pair).objective).toBe(0);
    }
  });

  it("gives no objective points to a pairing in which either answer is invalid or two answers tie under the floor", () => {
    for (const pair of every) {
      const { objective } = pair;
      if (objective === undefined) continue;
      const counts = pair.fresh.flatMap((freshValid, f) =>
        pair.old.map((oldValid, o) => {
          const [mine, theirs] = [objective.fresh[f], objective.old[o]];
          return (
            freshValid &&
            oldValid &&
            mine != null &&
            theirs != null &&
            Math.abs(mine - theirs) / Math.max(mine, theirs) >= 0.01
          );
        }),
      );
      if (!counts.includes(true)) expect(pointsOf(pair).objective).toBe(0);
    }
  });

  it("rounds every half away from zero and leaves no negative zero", () => {
    for (let tenths = -50; tenths <= 50; tenths += 1) {
      const points = tenths / 10;
      const rounded = wholePoints(points);
      expect(wholePoints(-points)).toBe(rounded === 0 ? 0 : -rounded);
      expect(Object.is(rounded, -0)).toBe(false);
      expect(Math.abs(rounded - points)).toBeLessThanOrEqual(0.5);
      if (Math.abs(points % 1) === 0.5) expect(Math.abs(rounded)).toBe(Math.abs(points) + 0.5);
    }
  });

  it("ranks a task one side alone answered validly above every task the objective alone decides", () => {
    const byObjective = every.filter((pair) => pointsOf(pair).validity === 0).map(differenceOf);
    const byValidity = every
      .filter((pair) => pair.fresh.every(Boolean) && !pair.old.some(Boolean))
      .map(differenceOf);
    expect(Math.min(...byValidity)).toBeGreaterThan(Math.max(...byObjective));
  });
});

// Reports on disk from before the bill was dropped from the score kept the scores without it apart.
describe("a recorded test's scores", () => {
  it("are the unbilled ones where a report kept them, else its differences, numbers only", () => {
    expect(scoresIn({ differences: [1, -2] })).toEqual([1, -2]);
    expect(scoresIn({ unbilled: [3], differences: [1, -2] })).toEqual([3]);
    expect(scoresIn({ differences: [1, "x", null] })).toEqual([1]);
    expect(scoresIn({})).toEqual([]);
    expect(scoresIn(null)).toEqual([]);
  });
});

/** Every side of `solves` solves, valid or not, with each answer's measure: none for a fail, and
 *  for a pass one of `measures`. */
function sidesOf(solves: number, measures: readonly (number | null)[]) {
  const valid = Array.from({ length: 2 ** solves }, (_, bits) =>
    Array.from({ length: solves }, (__, at) => ((bits >> at) & 1) === 1),
  );
  return valid.flatMap((side) =>
    side
      .reduce<(number | null)[][]>(
        (lists, ok) => lists.flatMap((list) => (ok ? measures : [null]).map((one) => [...list, one])),
        [[]],
      )
      .map((measured) => ({ valid: side, measured })),
  );
}

describe("how much better one measure is than another", () => {
  const values = [null, -8, -1, 0, 1, 3, 8, 100];
  it("is the difference in the rule's direction over the larger size, within one either way, and none where either is missing or both are zero", () => {
    for (const direction of ["higher", "lower"] as const) {
      for (const one of values) {
        for (const other of values) {
          const gain = gainOver({ direction }, one, other);
          if (one === null || other === null || (one === 0 && other === 0)) {
            expect(gain).toBe(0);
            continue;
          }
          const raw =
            (direction === "higher" ? one - other : other - one) / Math.max(Math.abs(one), Math.abs(other));
          expect(gain).toBeCloseTo(Math.max(-1, Math.min(1, raw)), 12);
          expect(gainOver({ direction }, other, one)).toBeCloseTo(-gain, 12);
        }
      }
      // Sub-1e-12 floating-point dust around zero reads as tied rather than a ±100% gain.
      for (const [one, other] of [
        [0, 1e-13],
        [1e-13, 0],
        [-5e-13, 5e-13],
      ] as const) {
        expect(gainOver({ direction }, one, other)).toBe(0);
      }
      expect(gainOver({ direction }, 0, 1e-9)).toBe(direction === "lower" ? 1 : -1);
    }
  });
});

describe("the room a task leaves a harness", () => {
  const RULE = { direction: "higher" } as const;
  const room = sidesOf(2, [10, 10.05, 12, 99]);
  const others = [null, 10, 12, 30, 100];
  it("is room on the objective where another answer known beats one of the side's own by the floor", () => {
    for (const { measured } of room) {
      for (const against of others) {
        const pair: Paired = {
          task: "t",
          old: [],
          fresh: [],
          objective: { ...RULE, old: measured, fresh: [] },
        };
        const own = measured.filter((one) => one !== null);
        const known = [...own, ...(against === null ? [] : [against])];
        const expected = own.some((mine) => known.some((other) => gainOver(RULE, other, mine) >= GAP_FLOOR));
        expect(gapAgainst(pair, "old", [against])).toBe(expected);
        expect(gapAgainst({ task: pair.task, old: [], fresh: [] }, "old", [against])).toBe(false);
      }
    }
  });

  it("is room where the reference's side was informative on a task or the count is missing, else none where some solve was valid, else too hard", () => {
    const triples = [0, 1].flatMap((a) => [0, 1].flatMap((b) => [0, 1].map((c) => [a, b, c])));
    const cases = (["old", "fresh"] as const).flatMap((side) =>
      [undefined, 0, 1].flatMap((count) =>
        triples.flatMap((old) => triples.map((fresh) => ({ side, count, old, fresh }))),
      ),
    );
    for (const { side, count, old, fresh } of cases) {
      const counts = { [side === "old" ? "fresh" : "old"]: 1, ...keyIfDefined(side, count) };
      // A count's first place holds the tasks valid in no solve.
      const someValid = [...old.slice(1), ...fresh.slice(1)].some((n) => n > 0);
      const expected = count === undefined || count > 0 ? "room" : someValid ? "none" : "too-hard";
      expect(evalHeadroom({ valid: { informative: counts, old, fresh } }, side)).toBe(expected);
    }
  });

  it("is informative where the side was valid in some solves only, valid nowhere on a task with a valid answer on record, or valid everywhere with room", () => {
    const cases = room.flatMap((mine) =>
      sidesOf(2, [12]).flatMap((theirs) =>
        [undefined, 30].flatMap((best) =>
          [false, true].map((onRecord) => ({ mine, theirs, best, onRecord })),
        ),
      ),
    );
    for (const { mine, theirs, best, onRecord } of cases) {
      const pair: Paired = {
        task: "t",
        old: mine.valid,
        fresh: theirs.valid,
        objective: { ...RULE, old: mine.measured, fresh: theirs.measured },
      };
      const count = mine.valid.filter(Boolean).length;
      const expected =
        count === 0
          ? onRecord
          : count < mine.valid.length || gapAgainst(pair, "old", [...theirs.measured, best ?? null]);
      const bests = new Map(best === undefined ? [] : [["t", best]]);
      expect(informative(pair, "old", new Set(onRecord ? ["t"] : []), bests)).toBe(expected);
    }
  });
});

describe("a comparison's tally", () => {
  it("counts each task by the sign of its score, tests the scores, and refuses a pair with unequal or no solves", () => {
    const sides = sidesOf(2, [1, 5]);
    const pairs = sides.flatMap((old) =>
      sides.map(
        (fresh): Paired => ({
          task: "t",
          old: old.valid,
          fresh: fresh.valid,
          objective: { direction: "higher", old: old.measured, fresh: fresh.measured },
        }),
      ),
    );
    const differences = pairs.map(differenceOf);
    const signs = (sign: number) => differences.filter((one) => Math.sign(one) === sign).length;
    expect(scored(pairs)).toEqual({
      wins: signs(1),
      losses: signs(-1),
      ties: signs(0),
      p: flipP(differences),
      differences,
    });
    expect(testOf([3, -1, 0, 0])).toEqual({ wins: 1, losses: 1, ties: 2, p: flipP([3, -1, 0, 0]) });
    expect(() => scored([{ task: "t", old: [true, true], fresh: [true] }])).toThrow("task t has 2 solve(s)");
    expect(() => scored([{ task: "t", old: [], fresh: [] }])).toThrow("task t has 0 solve(s)");
  });
});

describe("the draw of a scored set", () => {
  const pool = Array.from({ length: 12 }, (_, at) => `v${String(at)}`);
  it("ranks each version by the seed alone, so a smaller draw is the start of a larger and a new version moves no other", () => {
    for (const seed of ["a", "b", "c"]) {
      const whole = draw(pool, pool.length, seed);
      expect(whole.toSorted()).toEqual(pool.toSorted());
      for (let count = 0; count <= pool.length; count += 1) {
        expect(draw(pool, count, seed)).toEqual(whole.slice(0, count));
      }
      expect(draw([...pool, "v99"], pool.length + 1, seed).filter((one) => one !== "v99")).toEqual(whole);
      expect(draw([...pool, ...pool], 4, seed)).toEqual(whole.slice(0, 4));
    }
    expect(new Set(["a", "b", "c"].map((seed) => draw(pool, 4, seed).join(","))).size).toBe(3);
    expect(() => draw(pool, pool.length + 1, "a")).toThrow(
      "a draw of 13 needs as many task versions; 12 given",
    );
  });
});

describe("a comparison's size, said before it runs", () => {
  const tails = new Map<string, number>();
  /** The test's p for `wins` tasks won and `losses` lost by one margin, counted (`talliedP`). */
  const tailOf = (wins: number, losses: number) => {
    const key = `${String(wins)}-${String(losses)}`;
    const known = tails.get(key);
    if (known !== undefined) return known;
    const p = talliedP([
      ...Array.from({ length: wins }, () => 1),
      ...Array.from({ length: losses }, () => -1),
    ]);
    tails.set(key, p);
    return p;
  };
  /** The chance that `tasks` untied tasks, each won with chance `share`, read a step at `level`. */
  const powerAt = (tasks: number, share: number, level: number) => {
    let total = 0;
    let ways = 1;
    for (let wins = tasks; wins >= 0; wins -= 1) {
      if (tailOf(wins, tasks - wins) <= level) total += ways * share ** wins * (1 - share) ** (tasks - wins);
      ways = (ways * wins) / (tasks - wins + 1);
    }
    return total;
  };
  const SIZE_LEVELS = [0.0001, 0.02, 0.05, 0.1, 0.2];

  it("names, for each count of losses, the fewest wins that read a step within the tasks", () => {
    for (const level of SIZE_LEVELS) {
      for (let tasks = 0; tasks <= 30; tasks += 1) {
        const expected = Array.from({ length: tasks + 1 }, (_, losses) => losses).flatMap((losses) => {
          const wins = Array.from({ length: tasks - losses + 1 }, (_, at) => at).find(
            (at) => tailOf(at, losses) <= level,
          );
          return wins === undefined ? [] : [{ wins, losses }];
        });
        expect(smallestSteps(tasks, level)).toEqual(expected);
      }
    }
    expect(smallestSteps(24, 0.02).slice(0, 4)).toEqual([
      { wins: 6, losses: 0 },
      { wins: 8, losses: 1 },
      { wins: 10, losses: 2 },
      { wins: 12, losses: 3 },
    ]);
  });

  it("prints the smallest results, the share one reading detects four times in five and its rate between equal harnesses", () => {
    for (const level of SIZE_LEVELS) {
      for (let tasks = 0; tasks <= 30; tasks += 3) {
        const lines = sizeLines(tasks, level);
        const steps = smallestSteps(tasks, level);
        if (steps.length === 0) {
          expect(lines).toHaveLength(1);
          expect(lines[0]).toContain(
            `a step takes ${String(sweepOf(level))}, all won: this comparison cannot read a step`,
          );
          continue;
        }
        const [said, share, rate] = lines;
        const results = steps.slice(0, 3).map(({ wins, losses }) => `${String(wins)}-${String(losses)}`);
        expect(said).toContain(`${String(tasks)} held-out task${tasks === 1 ? "" : "s"} can be scored`);
        expect(said).toContain(`are ${results.join(", ")}, each task`);
        const detected =
          Array.from({ length: 51 }, (_, at) => (50 + at) / 100).find(
            (one) => powerAt(tasks, one, level) >= 0.8,
          ) ?? 1;
        expect(share).toContain(`wins ${String(Math.round(100 * detected))}% of the tasks`);
        const chance = powerAt(tasks, 0.5, level);
        expect(rate).toContain(
          chance > 0 && chance < 0.0005
            ? "under 0.1%"
            : `${String(Math.round(1000 * chance) / 10)}% of the time`,
        );
      }
    }
  });

  it("reads a side as valid in every, some or no solve", () => {
    for (const { valid } of sidesOf(3, [1])) {
      const count = valid.filter(Boolean).length;
      expect(howOftenValid(valid)).toBe(count === 3 ? "every" : count === 0 ? "none" : "some");
    }
  });
});

describe("the protocol's measured constants", () => {
  it("hold the values chosen from measurement, pinned once, since a check derived from them would only restate them", () => {
    expect({ WEIGHTS, GAP_FLOOR, SIZE, PATIENCE }).toEqual({
      WEIGHTS: { validity: 0.6, objective: 0.3 },
      GAP_FLOOR: 0.01,
      SIZE: { tasks: 24, solves: 2 },
      PATIENCE: 6,
    });
    // A campaign opened without `--patience` reads the default; one opened with it reads its own.
    expect(patienceOf([])).toBe(PATIENCE);
    expect(
      patienceOf([{ at: "2026-11-21T00:00:00.000Z", kind: "campaign.opened", data: { patience: 2 } }]),
    ).toBe(2);
  });

  it("scores unit-scale objectives by antisymmetric absolute difference on [0, 1] without a cliff at zero", () => {
    const grid = [0, 0.005, 0.01, 0.25, 0.5, 0.75, 0.99, 1];
    for (const direction of ["higher", "lower"] as const) {
      const rule = { direction, scale: "unit" as const };
      for (const a of grid) {
        for (const b of grid) {
          const got = gainOver(rule, a, b);
          const expected = Math.max(-1, Math.min(1, direction === "lower" ? b - a : a - b));
          expect(got).toBeCloseTo(expected, 12);
          expect(gainOver(rule, b, a)).toBeCloseTo(-got, 12);
        }
      }
    }
    expect(gainOver({ direction: "lower", scale: "unit" }, 0, 0.02)).toBeCloseTo(0.02, 12);
    expect(gainOver({ direction: "higher", scale: "unit" }, 0.85, 0)).toBeCloseTo(0.85, 12);
    expect(
      differenceOf({
        task: "u1",
        old: [true],
        fresh: [true],
        objective: { direction: "higher", scale: "unit", old: [0.85], fresh: [0.855] },
      }),
    ).toBe(0);
    expect(
      differenceOf({
        task: "u2",
        old: [true],
        fresh: [true],
        objective: { direction: "higher", scale: "unit", old: [0.7], fresh: [0.85] },
      }),
    ).toBe(45);
    expect(objectiveRuleOf({ direction: "higher", scale: "unit" })).toEqual({
      direction: "higher",
      scale: "unit",
    });
    expect(objectiveRuleIn({ objective: { direction: "higher", scale: "unit" } })).toEqual({
      direction: "higher",
      scale: "unit",
    });
    expect(objectiveRuleIn({ objective: { direction: "higher" } })).toEqual({ direction: "higher" });
    const roundTripped = objectiveRuleIn({
      objective: { direction: "higher", scale: "unit" },
    });
    expect(roundTripped).toEqual({ direction: "higher", scale: "unit" });
    expect(
      differenceOf({
        task: "u-zero",
        old: [true],
        fresh: [true],
        objective: { ...(roundTripped ?? { direction: "higher" }), old: [0], fresh: [0.02] },
      }),
    ).toBe(6);
    expect(
      differenceOf({
        task: "r-zero",
        old: [true],
        fresh: [true],
        objective: { direction: "higher", old: [0], fresh: [0.02] },
      }),
    ).toBe(300);
  });
});
