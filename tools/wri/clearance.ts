/**
 * How far a comparison's task scores stand from its level, by one rule for every reader: a step's
 * wins to spare, a reading without one's losses short of a step, and the tally on equal margins
 * that its losses would need.
 */
import { readsStep } from "#src/kernel/compare.ts";
import { smallestSteps } from "#src/kernel/size.ts";

/** A bound past which no equal-margin tally is looked for: far beyond any comparison on record. */
const MOST_TASKS = 4096;

function largestOf(scores: readonly number[], sign: 1 | -1): number[] {
  return scores
    .filter((one) => Math.sign(one) === sign)
    .toSorted((one, other) => Math.abs(other) - Math.abs(one));
}

/** How many of the largest wins of `scores` could each become a tie, largest first, and the
 *  scores still read a step at `level`; 0 where they read none. */
export function spareOf(scores: readonly number[], level: number): number {
  const wins = largestOf(scores, 1);
  const rest = scores.filter((one) => one <= 0);
  const lost = wins.findIndex((_, index) => !readsStep([...rest, ...wins.slice(index + 1)], level));
  return lost === -1 ? wins.length : lost;
}

/** The fewest losses of `scores` that, turned to wins of the same margin, largest first, make the
 *  scores read a step at `level`: 0 where they read one already, null where turning every loss does
 *  not reach it. */
export function shortOf(scores: readonly number[], level: number): number | null {
  const losses = largestOf(scores, -1);
  const rest = scores.filter((one) => one >= 0);
  for (let turned = 0; turned <= losses.length; turned += 1) {
    const flipped = losses.map((one, at) => (at < turned ? -one : one));
    if (readsStep([...rest, ...flipped], level)) return turned;
  }
  return null;
}

/** The wins a step at `level` needs beside `losses` losses on equal margins (`smallestSteps`). */
export function equalNeed(losses: number, level: number): number | null {
  for (let tasks = losses + 8; tasks <= MOST_TASKS; tasks *= 2) {
    const found = smallestSteps(tasks, level).find((result) => result.losses === losses);
    if (found !== undefined) return found.wins;
  }
  return null;
}

/** The equal-margin tally with the most losses that `untied` tasks can hold and still read a step
 *  at `level`, as 8-1 for 9 at 0.02; null where even all of them won reads none. */
export function equalMost(untied: number, level: number): { wins: number; losses: number } | null {
  return smallestSteps(untied, level).at(-1) ?? null;
}
