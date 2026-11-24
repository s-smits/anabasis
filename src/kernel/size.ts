import { plural } from "../meta/text.ts";
import { detectable, flipP, power, sweepOf } from "./compare.ts";

interface Result {
  readonly wins: number;
  readonly losses: number;
}

export const SIZE = { tasks: 24, solves: 2 } as const;

export const READINGS_IN_A_ROW = { easy: 2, unsolved: 2 } as const;

const RESULTS_SHOWN = 3;

export function howOftenValid(valid: readonly boolean[]): "every" | "some" | "none" {
  return valid.every(Boolean) ? "every" : valid.includes(true) ? "some" : "none";
}

function equalMargins(wins: number, losses: number): number[] {
  return [...Array.from({ length: wins }, () => 1), ...Array.from({ length: losses }, () => -1)];
}

export function smallestSteps(tasks: number, level: number): Result[] {
  const results: Result[] = [];
  let wins = 0;
  for (let losses = 0; wins + losses <= tasks; losses += 1) {
    while (wins + losses <= tasks && flipP(equalMargins(wins, losses)) > level) wins += 1;
    if (wins + losses <= tasks) results.push({ wins, losses });
  }
  return results;
}

export function sizeLines(tasks: number, level: number): string[] {
  const results = smallestSteps(tasks, level);
  const scored = `${tasks === 0 ? "no held-out task" : plural(tasks, "held-out task")} can be scored`;
  if (results.length === 0) {
    return [
      `${scored}, and at --level ${String(level)} a step takes ${String(sweepOf(level))}, all won: this comparison cannot read a step`,
    ];
  }
  const said = results
    .slice(0, RESULTS_SHOWN)
    .map(({ wins, losses }) => `${String(wins)}-${String(losses)}`)
    .join(", ");
  const share = detectable(equalMargins(tasks, 0), level) ?? 1;
  const rate = power(equalMargins(tasks, 0), 0.5, level);
  const rated = rate > 0 && rate < 0.0005 ? "under 0.1%" : `${String(Math.round(1000 * rate) / 10)}%`;
  return [
    `${scored}; at --level ${String(level)} the smallest results that read a step are ${said}, each task won or lost by as many pairs`,
    `were no task to tie, one reading at --level ${String(level)} would detect four times in five a harness that wins ${String(Math.round(100 * share))}% of the tasks, and fewer untied tasks need a larger share`,
    `one reading at these margins reads a step between equal harnesses ${rated} of the time where no task ties: the level is a per-comparison level`,
  ];
}
