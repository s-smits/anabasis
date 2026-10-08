// The arithmetic of `src/kernel/size.ts`, recomputed by counting. Nothing here uses its
// recurrences or `signP`'s: a sign test is the count of equally likely orders in whole numbers, a
// set's chance is the summed chance of every outcome its tasks can have, and a size is found by
// walking the tasks one at a time. Each stated model is spelled out as the outcomes it gives
// chances to, so a reading that implemented another model would differ here.
import { describe, expect, it } from "bun:test";
import {
  binomial,
  boughtBy,
  chanceOfStep,
  clearing,
  type Each,
  EFFECTS,
  repeatOf,
  roundSize,
  taskChances,
} from "../src/kernel/size.ts";

/** A level as a fraction, so that a tail is set against it in whole numbers. */
type Level = readonly [number, bigint, bigint];
const TENTH: Level = [0.1, 1n, 10n];
const TWENTIETH: Level = [0.05, 1n, 20n];
const [P, F] = [true, false];
const DIGITS = 12;
/** Chances of a win and of a loss a task, and pass rates under the old harness and the new, that the
 *  arithmetic is counted at: no difference, no tie, no loss, the settled ends and the plan's own. */
const CHANCES: readonly Each[] = [
  { win: 0.5, loss: 0.5 },
  { win: 0.12, loss: 0 },
  { win: 0.3, loss: 0.1 },
  { win: 0.7, loss: 0.3 },
  { win: 0.05, loss: 0.6 },
  { win: 1, loss: 0 },
  { win: 0, loss: 0 },
];
const RATES = [
  { old: 0.3, fresh: 0.55 },
  { old: 0.5, fresh: 0.5 },
  { old: 0.3, fresh: 0.42 },
  { old: 0.9, fresh: 0.2 },
  { old: 0, fresh: 1 },
  { old: 1, fresh: 1 },
] as const;

/** Pascal's triangle in whole numbers: row `n` holds the ways to choose each count of `n`. */
const rows: bigint[][] = [[1n]];
function ways(n: number): readonly bigint[] {
  for (let row = rows.length; row <= n; row += 1) {
    const above = rows[row - 1] ?? [];
    rows.push(Array.from({ length: row + 1 }, (_, k) => (above[k - 1] ?? 0n) + (above[k] ?? 0n)));
  }
  return rows[n] ?? [];
}

/** Whether `wins` beside `losses` clears: of the 2^n equally likely orders of the untied tasks, the
 *  ones with as many wins or more are no more than the level's share. No untied task clears nothing. */
function clears(wins: number, losses: number, [, over, under]: Level): boolean {
  const untied = wins + losses;
  const tail = ways(untied)
    .slice(wins)
    .reduce((sum, count) => sum + count, 0n);
  return tail * under <= over * 2n ** BigInt(untied);
}

/** Every outcome of `tasks` tasks, each a win (0), a loss (1) or a tie (2), as its counts. */
function outcomes(tasks: number): { wins: number; losses: number; ties: number }[] {
  return Array.from({ length: 3 ** tasks }, (_, code) => {
    const ends = Array.from({ length: tasks }, (_task, place) => Math.floor(code / 3 ** place) % 3);
    const count = (end: number) => ends.filter((each) => each === end).length;
    return { wins: count(0), losses: count(1), ties: count(2) };
  });
}

/** The chance that `tasks` tasks clear, as the summed chance of every outcome that does. */
function enumerated(tasks: number, each: Each, level: Level): number {
  const tie = 1 - each.win - each.loss;
  return outcomes(tasks).reduce(
    (sum, { wins, losses, ties }) =>
      clears(wins, losses, level) ? sum + each.win ** wins * each.loss ** losses * tie ** ties : sum,
    0,
  );
}

/** The same chance at every size from none to `most`, by walking the tasks one at a time over the
 *  wins and losses a set can hold: what a size too large to enumerate is checked against. */
function walked(most: number, each: Each, level: Level): number[] {
  const tie = 1 - each.win - each.loss;
  // The fewest wins that clear at each untied count, counted once from the top of its row: past
  // `untied` when none does.
  const fewest = Array.from({ length: most + 1 }, (_, untied) => {
    const [, over, under] = level;
    let tail = 0n;
    let wins = untied + 1;
    for (const count of ways(untied).toReversed()) {
      tail += count;
      if (tail * under > over * 2n ** BigInt(untied)) break;
      wins -= 1;
    }
    return wins;
  });
  // `held[wins][losses]` is the chance of that many of each among the tasks walked so far.
  let held = [Float64Array.of(1)];
  const chances = [0];
  for (let size = 1; size <= most; size += 1) {
    const next = Array.from({ length: size + 1 }, () => new Float64Array(size + 1));
    for (let wins = 0; wins < size; wins += 1) {
      const [row, won, same] = [held[wins], next[wins + 1], next[wins]];
      if (row === undefined || won === undefined || same === undefined) continue;
      for (let losses = 0; wins + losses < size; losses += 1) {
        const chance = row[losses] ?? 0;
        won[losses] = (won[losses] ?? 0) + chance * each.win;
        same[losses + 1] = (same[losses + 1] ?? 0) + chance * each.loss;
        same[losses] = (same[losses] ?? 0) + chance * tie;
      }
    }
    held = next;
    chances.push(
      next.reduce(
        (sum, row, wins) =>
          row.reduce(
            (inner, chance, losses) => (wins >= (fewest[wins + losses] ?? size + 1) ? inner + chance : inner),
            sum,
          ),
        0,
      ),
    );
  }
  return chances;
}

/** One task's chances at `solves` a side, as the summed chance of every order of passes and fails
 *  under each harness in which the new one passes more often, or less. */
function taskEnumerated(rates: { old: number; fresh: number }, solves: number): Each {
  const orders = Array.from({ length: 2 ** solves }, (_, code) => {
    const passes = Array.from({ length: solves }, (_solve, place) => Math.floor(code / 2 ** place) % 2);
    return passes.reduce((sum, pass) => sum + pass, 0);
  });
  const chance = (rate: number, passes: number) => rate ** passes * (1 - rate) ** (solves - passes);
  const summed = (ahead: (fresh: number, old: number) => boolean) =>
    orders.reduce(
      (sum, old) =>
        orders.reduce(
          (inner, fresh) =>
            ahead(fresh, old) ? inner + chance(rates.old, old) * chance(rates.fresh, fresh) : inner,
          sum,
        ),
      0,
    );
  return { win: summed((fresh, old) => fresh > old), loss: summed((fresh, old) => fresh < old) };
}

describe("the size arithmetic, recomputed by counting", () => {
  it("gives each count of successes the chance of the orders that hold it", () => {
    for (const trials of [0, 1, 5, 12]) {
      for (const chance of [0, 0.1, 0.5, 0.7, 1]) {
        const terms = binomial(trials, chance);
        expect(terms).toHaveLength(trials + 1);
        for (const [count, term] of terms.entries()) {
          const orders = Number(ways(trials)[count] ?? 0n);
          expect(term).toBeCloseTo(orders * chance ** count * (1 - chance) ** (trials - count), DIGITS);
        }
      }
    }
  });

  it("clears on the summed chance of every outcome that clears, win, loss and tie a task", () => {
    for (const level of [TENTH, TWENTIETH]) {
      for (const each of CHANCES) {
        for (let tasks = 0; tasks <= 7; tasks += 1) {
          expect(chanceOfStep(tasks, each, level[0])).toBeCloseTo(enumerated(tasks, each, level), DIGITS);
        }
      }
    }
    // The walk is the enumeration, so that a size past enumerating is checked against the same sum.
    const each = { win: 0.3, loss: 0.1 };
    for (const [tasks, chance] of walked(7, each, TENTH).entries()) {
      expect(chance).toBeCloseTo(enumerated(tasks, each, TENTH), DIGITS);
    }
    // The plan's 24 tasks at twelve in a hundred turned, and a set with no true difference, whose
    // chance is the test's own size and stays under its level at every size.
    expect(chanceOfStep(24, { win: 0.12, loss: 0 }, 0.1)).toBeCloseTo(
      walked(24, { win: 0.12, loss: 0 }, TENTH)[24] ?? 0,
      DIGITS,
    );
    for (const [tasks, chance] of walked(40, { win: 0.5, loss: 0.5 }, TENTH).entries()) {
      expect(chance).toBeLessThanOrEqual(0.1);
      expect(chanceOfStep(tasks, { win: 0.5, loss: 0.5 }, 0.1)).toBeCloseTo(chance, DIGITS);
    }
  });

  it("names the fewest wins that clear beside each count of losses", () => {
    for (const level of [TENTH, TWENTIETH]) {
      for (let tasks = 0; tasks <= 30; tasks += 1) {
        const fewest = Array.from({ length: tasks + 1 }, (_, losses) => {
          const wins = Array.from({ length: tasks - losses + 1 }, (_wins, count) => count).find((count) =>
            clears(count, losses, level),
          );
          return wins === undefined ? [] : [{ wins, losses }];
        }).flat();
        expect(clearing(tasks, level[0])).toEqual(fewest);
      }
    }
  });

  it("gives a task the chance of every order of solves in which the new harness passes more", () => {
    for (const rates of RATES) {
      for (const solves of [1, 2, 3, 4, 6]) {
        const { win, loss } = taskChances(rates, solves);
        const counted = taskEnumerated(rates, solves);
        expect(win).toBeCloseTo(counted.win, DIGITS);
        expect(loss).toBeCloseTo(counted.loss, DIGITS);
      }
    }
    // The figures the file's header gives for a task lifted from 0.30 to 0.55, and for one both
    // harnesses pass one time in two.
    const lifted = [1, 3, 6].map((solves) => taskEnumerated({ old: 0.3, fresh: 0.55 }, solves));
    expect(lifted.map(({ win }) => win.toFixed(3))).toEqual(["0.385", "0.597", "0.731"]);
    expect(lifted.map(({ loss }) => loss.toFixed(3))).toEqual(["0.135", "0.143", "0.115"]);
    const even = [1, 3].map((solves) => taskEnumerated({ old: 0.5, fresh: 0.5 }, solves));
    expect(even.map(({ win, loss }) => (1 - win - loss).toFixed(2))).toEqual(["0.50", "0.31"]);
  });

  it("states a round's chances for an effect as its share of tasks moved and the rest tied", () => {
    const asked = { target: 6, solves: 2, level: 0.1 };
    const size = roundSize({ stops: 4, unplaced: 5 }, asked);
    expect(size).toMatchObject({ sure: 4, most: 6 });
    for (const [index, effect] of EFFECTS.entries()) {
      // A task is one of the effect's share with that chance, and then wins or loses as its solves
      // fall; any other task ties.
      const moved = taskEnumerated(effect, asked.solves);
      const each = { win: effect.share * moved.win, loss: effect.share * moved.loss };
      expect(size.chances[index]?.sure).toBeCloseTo(enumerated(4, each, TENTH), DIGITS);
      expect(size.chances[index]?.most).toBeCloseTo(enumerated(6, each, TENTH), DIGITS);
    }
  });

  it("finds a repeat's size as the first at which the observed shares clear so often", () => {
    /** The first size at which the walk of a tally's shares reaches each stated chance. */
    const counted = (tally: { wins: number; losses: number; ties: number }, most: number) => {
      const tasks = tally.wins + tally.losses + tally.ties;
      const chances = walked(most, { win: tally.wins / tasks, loss: tally.losses / tasks }, TENTH);
      return {
        again: chances[tasks] ?? 0,
        needs: [0.5, 0.8].map((chance) => ({ chance, tasks: chances.findIndex((at) => at >= chance) })),
      };
    };
    for (const tally of [
      { wins: 2, losses: 0, ties: 2 },
      { wins: 3, losses: 1, ties: 2 },
      { wins: 2, losses: 1, ties: 6 },
      { wins: 5, losses: 2, ties: 17 },
      // With no tie the chance falls at some sizes (four tasks clear at 4-0, five only at 5-0),
      // so the first size to reach a chance is a search.
      { wins: 3, losses: 2, ties: 0 },
    ]) {
      const repeat = repeatOf(tally, 0.1);
      const { again, needs } = counted(tally, 140);
      expect(repeat?.again).toBeCloseTo(again, DIGITS);
      expect(repeat?.needs).toEqual(needs);
    }
    const untied = walked(5, { win: 0.6, loss: 0.4 }, TENTH);
    expect(untied[5]).toBeLessThan(untied[4] ?? 0);
    // The thin effect of the hand-computed case: an even chance takes 242 tasks, and 241 fall short.
    const thin = { wins: 3, losses: 2, ties: 19 };
    expect(counted(thin, 250).needs[0]).toEqual({ chance: 0.5, tasks: 242 });
    expect(repeatOf(thin, 0.1)?.needs[0]).toEqual({ chance: 0.5, tasks: 242 });
  });

  it("reads twice the scoring solves as tasks drawn from the scored ones, or as solves of the same", () => {
    // Three tasks at two solves a side: one the new harness lifts, one it lowers, one it leaves.
    const pairs = [
      { task: "t1", old: [P, F], fresh: [P, P] },
      { task: "t2", old: [P, P], fresh: [P, F] },
      { task: "t3", old: [F, F], fresh: [P, F] },
    ];
    const rates = [
      { old: 0.5, fresh: 1 },
      { old: 1, fresh: 0.5 },
      { old: 0, fresh: 0.5 },
    ];
    // A further task is one of these three, each as likely: its chances are their mean.
    const mean = (solves: number): Each => {
      const each = rates.map((rate) => taskEnumerated(rate, solves));
      return {
        win: each.reduce((sum, task) => sum + task.win, 0) / each.length,
        loss: each.reduce((sum, task) => sum + task.loss, 0) / each.length,
      };
    };
    const bought = boughtBy(pairs, 0.25);
    const quarter: Level = [0.25, 1n, 4n];
    expect(bought).toMatchObject({ tasks: 3, solves: 2 });
    expect(bought?.asIs).toBeCloseTo(enumerated(3, mean(2), quarter), DIGITS);
    expect(bought?.moreTasks).toBeCloseTo(enumerated(6, mean(2), quarter), DIGITS);
    expect(bought?.moreSolves).toBeCloseTo(enumerated(3, mean(4), quarter), DIGITS);
    // At a level two wins clear, each of the three is above nothing.
    expect(bought?.asIs).toBeGreaterThan(0);
  });
});
