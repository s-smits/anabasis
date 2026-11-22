/**
 * Scoring sub-mode for `bun run runs bench` when invoked without a campaign name: scores every
 * external benchmark evaluation once both of its arms have been judged (`run-improvement-campaign`,
 * "The outside aim"). `runs bench <run>` evaluates a reference harness as `<label>` and a fresh
 * Starter baseline as `starter-<label>`, and the judge writes one JSON record per task under
 * `judged/<arm>/`. An evaluation is complete once the Starter arm holds a record for every task in
 * the reference arm, because the sitting runs the Starter last over the reference arm's task set.
 * Its `score.ts table` output is then written once to `scored/<label>.txt` alongside the records,
 * and one summary line is printed so the alerts job reports each completed evaluation once.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { capturedExecPath } from "#src/meta/process.ts";
import { runTextOrThrow } from "#src/meta/subprocess.ts";
import { benchesOf } from "./host-config.ts";
import { Misused } from "./registry.ts";
import { recordsHere } from "./snapshots.ts";

const SCORE = join(import.meta.dir, "..", "..", "studies", "harness2", "score.ts");

/** Maps each judged arm directory in `store` to the set of task JSON filenames it contains. */
function judgedIn(store: string): Map<string, Set<string>> {
  const judged = join(store, "judged");
  const arms = existsSync(judged) ? readdirSync(judged, { withFileTypes: true }) : [];
  return new Map(
    arms
      .filter((arm) => arm.isDirectory())
      .map((arm) => [
        arm.name,
        new Set(readdirSync(join(judged, arm.name)).filter((file) => file.endsWith(".json"))),
      ]),
  );
}

/** Returns labels in `store` whose reference and Starter arms are both fully judged and not yet scored. */
export function readsDone(store: string): string[] {
  const judged = judgedIn(store);
  return [...judged.keys()]
    .filter((arm) => arm.startsWith("starter-"))
    .map((arm) => arm.slice("starter-".length))
    .filter((label) => {
      const own = judged.get(label);
      const starter = judged.get(`starter-${label}`) ?? new Set<string>();
      const done =
        own !== undefined &&
        own.size > 0 &&
        own.size === starter.size &&
        [...own].every((task) => starter.has(task));
      return done && !existsSync(join(store, "scored", `${label}.txt`));
    })
    .toSorted();
}

/** Scores every completed benchmark evaluation in the selected stores, or across all local benchmark records. */
export async function scoreDone(values: {
  readonly bench?: string | undefined;
  readonly store?: string | undefined;
}): Promise<void> {
  const named = benchesOf().filter((bench) => values.bench === undefined || bench.name === values.bench);
  if (values.bench !== undefined && named.length === 0) throw new Misused(`no benchmark ${values.bench}`);
  const stores = values.store === undefined ? named.map(recordsHere) : [values.store];
  for (const store of stores) {
    for (const label of readsDone(store)) {
      const table = await runTextOrThrow([
        capturedExecPath,
        SCORE,
        "table",
        "--out",
        store,
        "--name",
        `${label},starter-${label}`,
      ]);
      mkdirSync(join(store, "scored"), { recursive: true });
      const file = join(store, "scored", `${label}.txt`);
      writeFileSync(file, table.endsWith("\n") ? table : `${table}\n`);
      const arms = table
        .split("\n")
        .filter((line) => / score \d+\/\d+/u.test(line))
        .map((line) => line.trim());
      console.log(`outside read ${label} scored, both arms judged: ${arms.join("; ")}; table in ${file}`);
    }
  }
}
