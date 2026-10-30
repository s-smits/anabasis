#!/usr/bin/env bun
/**
 * What a comparison can show at a level, read off the production test itself.
 *
 *   bun .claude/skills/comparison-reading/scripts/size.ts [--level <n>] [--untied <n>]
 *     [--scores <s,s,...> [--unbilled <s,s,...>]]
 *
 * The questions this skill is asked most about a comparison's size are arithmetic: how many tasks a
 * step needs at a level, which tallies clear it, how often a reading between equal harnesses reads
 * one, which share of wins it detects, and how many frontier tasks comparison admission asks for.
 * The answers live in the comparison's own exact test and its size lines, so this is a thin
 * wrapper and computes nothing of its own: `sizeLines` (`src/kernel/size.ts`, the lines a launch
 * prints), `sweepOf`, `power` at one half (the false rate), `detectable`, `testOf` and `readsStep`
 * (`src/kernel/compare.ts`), and `comparisonFloor` (`src/campaign/admission.ts`). A figure in a
 * prose account that disagrees with this output is the account's error.
 *
 * With no `--scores` it prints, at `--level` (0.02) and `--untied` tasks (24, `SIZE.tasks`), the
 * smallest scored set that can read a step and the admission floor, then `sizeLines`: the three
 * smallest clearing tallies with equal margins, the detectable share and the false rate. A tally
 * past the third (12 to 3 at 0.02) is read with `--scores`: one set of task scores read as a
 * comparison would (ties are 0), giving the tally, p, the false rate and the detectable share at
 * those margins, and, with `--unbilled` in the same order, whether both tests clear (`readsStep`).
 *
 * Written on 30 October, when `AGENTS.md` section 7 moved to this skill and its stated figures
 * (6 to 0 through 12 to 3 at 0.02, 1.1% and 7.6% on 24 untied tasks) needed one place to be checked.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { comparisonFloor } from "#src/campaign/admission.ts";
import { detectable, power, readsStep, sweepOf, testOf } from "#src/kernel/compare.ts";
import { SIZE, sizeLines } from "#src/kernel/size.ts";

const USAGE = `usage:
  bun .claude/skills/comparison-reading/scripts/size.ts [--level <n>] [--untied <n>]
    [--scores <s,s,...> [--unbilled <s,s,...>]]

--level     the step's level (0.02, the default level)
--untied    how many untied tasks the test reads, each won or lost by one margin (24)
--scores    one comparison's task scores, comma-separated, ties as 0: read them as its test does
--unbilled  the same tasks' scores without the bill, in the same order: whether both tests clear`;
const OPTIONS = { level: "text", untied: "int", scores: "text", unbilled: "text" } as const;
const LEVEL = 0.02;

/** What a comparison of `untied` tasks with equal margins can show at `level`. */
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

/** One set of task scores read as a comparison reads them at `level`; `unbilled`, where given, the
 *  same tasks without the bill. */
export function scoresRead(scores: readonly number[], level: number, unbilled: readonly number[] | null) {
  if (unbilled !== null && unbilled.length !== scores.length) {
    throw new Error(
      `--unbilled holds ${String(unbilled.length)} scores and --scores ${String(scores.length)}`,
    );
  }
  return {
    ...testOf(scores),
    falseRate: power(scores, 0.5, level),
    detectable: detectable(scores, level),
    step: unbilled === null ? null : readsStep(scores, unbilled, level),
  };
}

/** A share in percent to a tenth. */
function percent(share: number): string {
  return `${String(Math.round(1000 * share) / 10)}%`;
}

/** The lines `sizeOf` is told in: the sweep and the floor, then the production's own lines for a
 *  launch (`sizeLines`), which name the three smallest clearing tallies, the detectable share and
 *  the false rate. */
function sizeTold(untied: number, level: number): string[] {
  const { sweep, floor } = sizeOf(untied, level);
  return [
    `level ${String(level)}: the smallest scored set that can read a step is ${String(sweep)} tasks, all won (sweepOf)`,
    `comparison admission asks for ${String(floor)} frontier tasks (comparisonFloor: a sweep plus one set aside and one tie)`,
    ...sizeLines(untied, { level }),
  ];
}

/** The lines `scoresRead` is printed in. */
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
          `with the unbilled scores: ${read.step ? "step" : "no-step"} (readsStep: a step clears both tests)`,
        ]),
  ];
}

/** A comma-separated list of numbers, or null where none is given. */
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
