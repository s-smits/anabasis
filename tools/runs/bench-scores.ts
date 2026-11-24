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
import { existsSync, mkdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { capturedExecPath } from "#src/meta/process.ts";
import { runTextOrThrow } from "#src/meta/subprocess.ts";
import { judgedFilesByArm, STARTER_PREFIX } from "./bench-store.ts";
import { benchesOf } from "./host-config.ts";
import { Misused } from "./registry.ts";
import { recordsHere } from "./snapshots.ts";

const SCORE = join(import.meta.dir, "..", "..", "studies", "harness2", "score.ts");

/** Returns labels in `store` whose reference and Starter arms are both fully judged and not yet scored. */
export function completedBenchLabels(store: string): string[] {
  const byArm = judgedFilesByArm(store);
  return [...byArm.keys()]
    .filter((arm) => arm.startsWith(STARTER_PREFIX))
    .map((arm) => arm.slice(STARTER_PREFIX.length))
    .filter((label) => {
      const own = new Set(byArm.get(label));
      const starter = new Set(byArm.get(`${STARTER_PREFIX}${label}`));
      const done = own.size > 0 && own.size === starter.size && [...own].every((task) => starter.has(task));
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
    for (const label of completedBenchLabels(store)) {
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
