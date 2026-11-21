/**
 * `bun run runs bench` with no run: scores each outside read once both of its arms are judged
 * (run-improvement-campaign, "The outside aim"). `runs bench <run>` rolls a reference as `<label>`
 * and a fresh Starter behind it as `starter-<label>`, and the judge writes one record a task into the
 * store's `judged/<arm>/`. A read is done once the Starter holds a record for every task the
 * reference does, since the sitting rolls the Starter last over the reference's own tasks. Its
 * `score.ts table` is then written once to the store's `scored/<label>.txt`, beside the records it
 * reads, and the verb prints one line for it, so the alerts job (operator, 21 November 2026: "ideally
 * should be automatic") hears each read once.
 *
 * It reads the records this machine holds (`recordsHere`): a benchmark's own store where it is rolled
 * here, otherwise the copy `runs fetch` keeps in `data/bench/<benchmark>`, which only adds, so a
 * table written there stays. `--store` names another folder, and `--host <name>` scores the records
 * that host holds, as `runs on <host> bench` would. Writing a table into the store it reads is the
 * verb's whole effect, so it takes no `--yes`. `bench.ts` owns the verb.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { capturedExecPath } from "#src/meta/process.ts";
import { runTextOrThrow } from "#src/meta/subprocess.ts";
import { benchesOf } from "./host-config.ts";
import { Misused } from "./registry.ts";
import { recordsHere } from "./snapshots.ts";

const SCORE = join(import.meta.dir, "..", "..", "studies", "harness2", "score.ts");

/** The arms judged in `store`, each with the tasks it holds a record for. */
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

/** The labels in `store` whose reference and Starter are both judged and that have no table yet. */
export function readsDone(store: string): string[] {
  const judged = judgedIn(store);
  return [...judged.keys()]
    .filter((arm) => arm.startsWith("starter-"))
    .map((arm) => arm.slice("starter-".length))
    .filter((label) => {
      const own = judged.get(label);
      const starter = judged.get(`starter-${label}`) ?? new Set<string>();
      const done = own !== undefined && own.size > 0 && [...own].every((task) => starter.has(task));
      return done && !existsSync(join(store, "scored", `${label}.txt`));
    })
    .toSorted();
}

/** Scores each finished read in the stores `values` name, or in every benchmark's records here. */
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
