/**
 * Blind reach grades against what the reference did, grade by grade, and the ladder's worked
 * examples re-rated blind so that each rung can be overhauled on a count:
 *
 *   bun .claude/skills/examiner-complexity/scripts/grades.ts <grades.tsv> <log or campaign folder>...
 *   bun .claude/skills/examiner-complexity/scripts/grades.ts rungs packet
 *   bun .claude/skills/examiner-complexity/scripts/grades.ts rungs compare <rungs.tsv>...
 *
 * `grades.tsv` has a header and one row a task, `task<TAB>grade`, written by a grader who read the
 * task's public input and the public rules alone, on lane 27's scale (`GRADES`,
 * `src/examiner/ladder.ts`). For each grade it prints the tasks graded so, the solves that gave a
 * result under any harness, how many were valid, the tasks valid on every solve, and the median
 * turns of the valid ones. Non-results count nowhere (rule 7) and a flag is its side's fail. A grade
 * whose tasks are valid on every solve in a few turns measures nothing for this solver, which is how
 * the ladder was re-rated on 31 October: 1,438 of 1,465 solves valid at grades 2 to 5. Read-only;
 * the grades and the outcomes stay on the exam side and reach no seat.
 *
 * `rungs packet` prints what a grader reads: the scale (`GRADES`), who the grades are for (`SOLVER`),
 * and each field's rungs in order with their grade numbers removed, one id a rung (`<field>.<rung>`).
 * The grader writes `id<TAB>grade<TAB>place`, the place being `basin`, `model`, `bound` or `none`.
 * `rungs compare` reads one table a grader, sets each rung's grades beside the one the ladder states,
 * and flags a rung whose median (the lower of two middle grades) is below its stated grade, or not
 * above the rung before it, since such a rung shows the Examiner a picture of a grade it does not
 * reach. Two graders agreed exactly on 13 of 18 rungs and within one on the rest, so one table is a
 * lead. On 31 October a blind re-rating of the first rungs against a solver with a shell moved 15 of
 * 18 down, by a median of two grades, which is why the rungs are graded this way.
 */
import { FIELDS, GRADES, SOLVER } from "#src/examiner/ladder.ts";
import { read } from "#src/kernel/log.ts";
import { solvesIn } from "#src/kernel/solves.ts";
import { readFileSync } from "#src/meta/filesystem.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

const STATED = /^(\d): /u;

interface Tally {
  tasks: number;
  solves: number;
  valid: number;
  everyValid: number;
  turns: number[];
}

/** Each task's results by its id: solves with a result, valid ones, and the valid ones' turns. */
export function outcomesOf(logs: readonly (readonly Parameters<typeof solvesIn>[0][number][])[]) {
  const tasks = new Map<string, { solves: number; valid: number; turns: number[] }>();
  for (const solve of logs.flatMap((events) => solvesIn(events))) {
    const task = solve.start.task;
    const outcome = solve.ending?.outcome;
    if (!isString(task) || !isString(outcome) || outcome === "non-result") continue;
    const row = tasks.get(task) ?? { solves: 0, valid: 0, turns: [] };
    row.solves++;
    if (outcome === "pass") {
      row.valid++;
      if (isNumber(solve.end?.turns)) row.turns.push(solve.end.turns);
    }
    tasks.set(task, row);
  }
  return tasks;
}

/** The grade table's lines, one a grade in order. */
export function gradeLines(
  grades: ReadonlyMap<string, string>,
  outcomes: ReturnType<typeof outcomesOf>,
): string[] {
  const byGrade = new Map<string, Tally>();
  for (const [task, grade] of grades) {
    const row = outcomes.get(task);
    if (row === undefined || row.solves === 0) continue;
    const tally = byGrade.get(grade) ?? { tasks: 0, solves: 0, valid: 0, everyValid: 0, turns: [] };
    tally.tasks++;
    tally.solves += row.solves;
    tally.valid += row.valid;
    if (row.valid === row.solves) tally.everyValid++;
    tally.turns.push(...row.turns);
    byGrade.set(grade, tally);
  }
  return [...byGrade]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([grade, { tasks, solves, valid, everyValid, turns }]) => {
      const sorted = turns.toSorted((a, b) => a - b);
      const median = sorted.length === 0 ? "none" : String(sorted[Math.floor((sorted.length - 1) / 2)]);
      return `grade ${grade}: ${String(tasks)} tasks, ${String(valid)} of ${String(solves)} solves valid, ${String(everyValid)} tasks valid on every solve, median turns ${median}`;
    });
}

/** What a blind grader reads: the scale, the solver, and the rungs with no grade. */
export function packetOf(): string {
  return [
    `Reach is how hard a task is for a strong current model working in the field:\n${GRADES.map((grade) => `- ${grade}`).join("\n")}`,
    SOLVER,
    "Grade each task below for that solver. Write one line a task, `id<TAB>grade<TAB>place`, where place is the one of the three where its ability stops that the task sits in (`basin`, `model` or `bound`), or `none`.",
    ...FIELDS.map(
      ({ field, rungs }, f) =>
        `${field}:\n${rungs.map((rung, r) => `- ${f + 1}.${r + 1}: ${rung.replace(STATED, "")}`).join("\n")}`,
    ),
  ].join("\n\n");
}

/** Each rung's stated grade beside the blind one, and a closing count. */
export function compareLines(
  blind: ReadonlyMap<string, readonly { grade: number; place: string }[]>,
): string[] {
  const lines: string[] = [];
  const counts = { at: 0, below: 0, above: 0, flat: 0, ungraded: 0 };
  let total = 0;
  for (const [f, { field, rungs }] of FIELDS.entries()) {
    lines.push(`${field}:`);
    let before = -1;
    for (const [r, rung] of rungs.entries()) {
      const id = `${f + 1}.${r + 1}`;
      const stated = Number(STATED.exec(rung)?.[1]);
      const tables = blind.get(id) ?? [];
      total++;
      const grades = tables.map(({ grade }) => grade).toSorted((x, y) => x - y);
      const median = grades[Math.floor((grades.length - 1) / 2)];
      if (median === undefined) {
        counts.ungraded++;
        lines.push(`  ${id} stated ${stated}, not graded`);
        continue;
      }
      const flags = (
        [
          ["below", median < stated],
          ["above", median > stated],
          ["flat", median <= before],
        ] as const
      ).flatMap(([flag, holds]) => (holds ? [flag] : []));
      counts.at += median === stated ? 1 : 0;
      for (const flag of flags) counts[flag]++;
      lines.push(
        `  ${id} stated ${stated}, blind ${tables.map(({ grade, place }) => `${grade} ${place}`).join(", ")}${flags.length > 0 ? `  ${flags.join(", ")}` : ""}`,
      );
      before = median;
    }
  }
  lines.push(
    `${counts.at} of ${total} rungs at their stated grade, ${counts.below} below, ${counts.above} above, ${counts.flat} not above the rung before, ${counts.ungraded} not graded`,
  );
  return lines;
}

/** `rungs packet`, or `rungs compare` over one grader's table each. */
function rungsCommand([verb, ...tables]: readonly string[], die: CommandArgs["die"], usage: string): void {
  if (verb === "packet") {
    console.log(packetOf());
    return;
  }
  if (verb !== "compare" || tables.length === 0) die(usage);
  const blind = new Map<string, { grade: number; place: string }[]>();
  for (const table of tables) {
    const rows = readFileSync(table, "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split("\t"));
    for (const [id, grade, place] of rows) {
      if (id !== undefined && /^\d$/u.test(grade ?? "")) {
        blind.set(id, [...(blind.get(id) ?? []), { grade: Number(grade), place: place ?? "none" }]);
      }
    }
  }
  for (const line of compareLines(blind)) console.log(line);
}

if (import.meta.main) {
  const usage =
    "grades.ts <grades.tsv> <log or campaign folder>... | grades.ts rungs packet | grades.ts rungs compare <rungs.tsv>...";
  await runCommand(
    { name: "grades", usage, positionals: [2, 100] },
    async ({ positionals: [table = "", ...paths], die }) => {
      if (table === "rungs") return rungsCommand(paths, die, usage);
      const grades = new Map(
        readFileSync(table, "utf8")
          .trim()
          .split("\n")
          .slice(1)
          .map((line) => line.split("\t"))
          .flatMap(([task, grade]) =>
            task === undefined || grade === undefined ? [] : [[task, grade] as const],
          ),
      );
      const logs = await Promise.all(paths.map(async (named) => read(await logAcross(named))));
      for (const line of gradeLines(grades, outcomesOf(logs))) console.log(line);
    },
  );
}
