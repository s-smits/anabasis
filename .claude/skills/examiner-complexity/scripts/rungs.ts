/**
 * The ladder's worked examples, re-rated blind so that each rung can be overhauled on a count:
 *
 *   bun .claude/skills/examiner-complexity/scripts/rungs.ts packet
 *   bun .claude/skills/examiner-complexity/scripts/rungs.ts compare <rungs.tsv>
 *
 * `packet` prints what a grader reads: the scale (`GRADES`), who the grades are for (`SOLVER`), and
 * each field's rungs in order with their grade numbers removed, one id a rung (`<field>.<rung>`).
 * The grader writes `id<TAB>grade<TAB>place`, the place being `basin`, `model`, `bound` or `none`.
 * `compare` sets those grades beside the ones the ladder states and flags a rung graded below its
 * stated grade, or not above the rung before it, since such a rung shows the Examiner a picture of a
 * grade it does not reach. On 31 October a blind re-rating of the first rungs against a solver with a
 * shell moved 15 of 18 down, by a median of two grades, which is why the rungs are graded this way.
 */
import { FIELDS, GRADES, SOLVER } from "#src/examiner/ladder.ts";
import { readFileSync } from "#src/meta/filesystem.ts";
import { runCommand } from "#skills/main/cli.ts";

const STATED = /^(\d): /u;

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
export function compareLines(blind: ReadonlyMap<string, { grade: number; place: string }>): string[] {
  const lines: string[] = [];
  const counts = { at: 0, below: 0, above: 0, flat: 0, ungraded: 0 };
  let total = 0;
  for (const [f, { field, rungs }] of FIELDS.entries()) {
    lines.push(`${field}:`);
    let before = -1;
    for (const [r, rung] of rungs.entries()) {
      const id = `${f + 1}.${r + 1}`;
      const stated = Number(STATED.exec(rung)?.[1]);
      const graded = blind.get(id);
      total++;
      if (graded === undefined) {
        counts.ungraded++;
        lines.push(`  ${id} stated ${stated}, not graded`);
        continue;
      }
      const flags = (
        [
          ["below", graded.grade < stated],
          ["above", graded.grade > stated],
          ["flat", graded.grade <= before],
        ] as const
      ).flatMap(([flag, holds]) => (holds ? [flag] : []));
      counts.at += graded.grade === stated ? 1 : 0;
      for (const flag of flags) counts[flag]++;
      lines.push(
        `  ${id} stated ${stated}, blind ${graded.grade} (${graded.place})${flags.length > 0 ? `  ${flags.join(", ")}` : ""}`,
      );
      before = graded.grade;
    }
  }
  lines.push(
    `${counts.at} of ${total} rungs at their stated grade, ${counts.below} below, ${counts.above} above, ${counts.flat} not above the rung before, ${counts.ungraded} not graded`,
  );
  return lines;
}

if (import.meta.main) {
  const usage = "rungs.ts packet | rungs.ts compare <rungs.tsv>";
  await runCommand({ name: "rungs", usage, positionals: [1, 2] }, ({ positionals: [verb, table], die }) => {
    if (verb === "packet") {
      console.log(packetOf());
      return;
    }
    if (verb !== "compare" || table === undefined) return die(usage);
    const blind = new Map(
      readFileSync(table, "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("\t"))
        .flatMap(([id, grade, place]) =>
          id === undefined || !/^\d$/u.test(grade ?? "")
            ? []
            : [[id, { grade: Number(grade), place: place ?? "none" }] as const],
        ),
    );
    for (const line of compareLines(blind)) console.log(line);
  });
}
