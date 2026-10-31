/**
 * Blind reach grades against what the reference did, grade by grade:
 *
 *   bun .claude/skills/examiner-complexity/scripts/grades.ts <grades.tsv> <log or campaign folder>...
 *
 * `grades.tsv` has a header and one row a task, `task<TAB>grade`, written by a grader who read the
 * task's public input and the public rules alone, on lane 34's scale (`GRADES`,
 * `src/examiner/ladder.ts`). For each grade it prints the tasks graded so, the solves that gave a
 * result under any harness, how many were valid, the tasks valid on every solve, and the median
 * turns of the valid ones. Non-results count nowhere (rule 7) and a flag is its side's fail. A grade
 * whose tasks are valid on every solve in a few turns measures nothing for this solver, which is how
 * the ladder was re-rated on 31 October: 1,438 of 1,465 solves valid at grades 2 to 5. Read-only;
 * the grades and the outcomes stay on the exam side and reach no seat.
 */
import { LOG_FILE, read } from "#src/kernel/log.ts";
import { solvesIn } from "#src/kernel/solves.ts";
import { existsSync, readFileSync, statSync } from "#src/meta/filesystem.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { runCommand } from "#skills/main/cli.ts";

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

if (import.meta.main) {
  const usage = "grades.ts <grades.tsv> <log or campaign folder>...";
  await runCommand(
    { name: "grades", usage, positionals: [2, 100] },
    ({ positionals: [table = "", ...paths] }) => {
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
      const logs = paths.map((path) =>
        read(existsSync(path) && statSync(path).isDirectory() ? join(path, LOG_FILE) : path),
      );
      for (const line of gradeLines(grades, outcomesOf(logs))) console.log(line);
    },
  );
}
