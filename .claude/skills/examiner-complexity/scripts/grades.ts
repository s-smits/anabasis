/**
 * Blind reach grades against what the reference did, grade by grade, and the ladder's worked
 * examples re-rated blind: `grades.ts <grades.tsv> <log or campaign folder>...`, `grades.ts rungs
 * packet`, `grades.ts rungs compare <rungs.tsv>...`. `grades.tsv` holds `task<TAB>grade` rows from
 * a grader who read only the public input and rules, on lane 14's scale (`GRADES`,
 * `src/examiner/ladder.ts`); each grade prints its tasks, solves with a result, valid ones, tasks
 * valid on every solve and the valid ones' median turns. Non-results count nowhere (rule 7), and a
 * grade valid on every solve in a few turns measures nothing for this solver. `rungs packet` prints
 * the scale, `SOLVER` and each field's rungs without grades, one id a rung (`<field>.<rung>`), for
 * a grader to answer `id<TAB>grade<TAB>place` (`basin`, `model`, `bound` or `none`); `rungs
 * compare` flags a rung whose median blind grade (the lower middle) is below its stated grade or
 * not above the rung before it. Read-only; grades and outcomes stay on the exam side.
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

/** Solves with a result, valid ones, and the valid ones' turns. */
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
