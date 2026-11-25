#!/usr/bin/env bun
/**
 * Reports sample-size, power and false-positive figures from the production comparison test:
 * `size.ts [--level <n>] [--untied <n>] [--scores <s,s,...> [--unbilled <s,s,...>]]`.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { comparisonFloor } from "#src/campaign/admission.ts";
import { detectable, power, readsStep, sweepOf, testOf } from "#src/kernel/compare.ts";
import { smallestSteps, SIZE, sizeLines } from "#src/kernel/size.ts";

const USAGE = `usage:
  bun .claude/skills/comparison-reading/scripts/size.ts [--level <n>] [--untied <n>]
    [--scores <s,s,...> [--unbilled <s,s,...>]]

--level     the step's level (0.02, the default level)
--untied    how many untied tasks the test reads, each won or lost by one margin (24)
--scores    one comparison's task scores, comma-separated, ties as 0: read them as its test does
--unbilled  the same tasks' scores without the bill, in the same order: whether they read a step`;
const OPTIONS = { level: "text", untied: "int", scores: "text", unbilled: "text" } as const;
const LEVEL = 0.02;

export function sizeOf(untied: number, level: number) {
  // Every untied task won or lost by one margin: the sign of each plays no part at one half.
  const equal = Array.from({ length: untied }, () => 1);
  return {
    sweep: sweepOf(level),
    floor: comparisonFloor(level),
    falseRate: power(equal, 0.5, level),
    detectable: detectable(equal, level),
  };
}

function scoresRead(scores: readonly number[], level: number, unbilled: readonly number[] | null) {
  if (unbilled !== null && unbilled.length !== scores.length) {
    throw new Error(
      `--unbilled holds ${String(unbilled.length)} scores and --scores ${String(scores.length)}`,
    );
  }
  return {
    ...testOf(scores),
    falseRate: power(scores, 0.5, level),
    detectable: detectable(scores, level),
    step: unbilled === null ? null : readsStep(unbilled, level),
  };
}

function percent(share: number): string {
  return `${String(Math.round(1000 * share) / 10)}%`;
}

/** The sweep and the floor, then the production's own launch lines (`sizeLines`): the three
 *  smallest tallies that read a step, the detectable share, the false rate, and every such tally
 *  that fits (`smallestSteps`). */
function sizeTold(untied: number, level: number): string[] {
  const { sweep, floor } = sizeOf(untied, level);
  return [
    `level ${String(level)}: the smallest scored set that can read a step is ${String(sweep)} tasks, all won (sweepOf)`,
    `comparison admission asks for ${String(floor)} frontier tasks (comparisonFloor: a sweep plus one set aside and one tie)`,
    ...sizeLines(untied, level),
    `every tally that clears with equal margins on ${String(untied)} untied tasks: ${
      smallestSteps(untied, level)
        .map(({ wins, losses }) => `${String(wins)}-${String(losses)}`)
        .join(", ") || "none"
    }`,
  ];
}

function scoresLines(scores: readonly number[], level: number, unbilled: readonly number[] | null): string[] {
  const read = scoresRead(scores, level, unbilled);
  const untied = read.wins + read.losses;
  return [
    `${String(read.wins)}-${String(read.losses)}-${String(read.ties)} on ${String(scores.length)} tasks, ${String(untied)} untied: p ${read.p.toFixed(4)}, ${read.p <= level ? "clears" : "does not clear"} ${String(level)} on the full score`,
    `false rate between equal harnesses at these margins: ${percent(read.falseRate)}`,
    `detected four times in five at these margins: ${read.detectable === null ? "none: even every task won reads no step" : `${percent(read.detectable)} of the untied tasks won`}`,
    ...(read.step === null
      ? []
      : [
          `with the unbilled scores: ${read.step ? "step" : "no-step"} (readsStep: a step is read on these alone)`,
        ]),
  ];
}

function numbersIn(text: string | null, name: string): number[] | null {
  if (text === null) return null;
  const numbers = text.split(",").map(Number);
  if (numbers.some((one) => !Number.isFinite(one))) {
    throw new Error(`--${name} must be numbers separated by commas`);
  }
  return numbers;
}

if (import.meta.main) {
  await runCommand({ name: "size", usage: USAGE, options: OPTIONS }, (args: CommandArgs) => {
    const level = Number(args.value("level") ?? LEVEL);
    if (!(level > 0 && level < 1)) args.die("--level must be a number between 0 and 1");
    const untied = args.int("untied") ?? SIZE.tasks;
    if (untied < 0) args.die("--untied must not be negative");
    const scores = numbersIn(args.value("scores"), "scores");
    const unbilled = numbersIn(args.value("unbilled"), "unbilled");
    if (scores === null && unbilled !== null) args.die("--unbilled reads beside --scores");
    const lines = scores === null ? sizeTold(untied, level) : scoresLines(scores, level, unbilled);
    console.log(lines.join("\n"));
  });
}
