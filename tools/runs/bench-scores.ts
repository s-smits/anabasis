import { existsSync, mkdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { capturedExecPath } from "#src/meta/process.ts";
import { runTextOrThrow } from "#src/meta/subprocess.ts";
import { baselineArmsFor, isBaselineArmName, judgedFilesByArm } from "./bench-store.ts";
import { benchesOf } from "./host-config.ts";
import { Misused } from "./registry.ts";
import { recordsHere } from "./snapshots.ts";

const SCORE = join(import.meta.dir, "..", "..", "studies", "harness2", "score.ts");

export function completedBenchPairs(store: string): { readonly label: string; readonly baseline: string }[] {
  const byArm = judgedFilesByArm(store);
  return [...byArm.keys()]
    .filter((arm) => !isBaselineArmName(arm))
    .flatMap((label) => {
      if (existsSync(join(store, "scored", `${label}.txt`))) return [];
      const own = new Set(byArm.get(label));
      if (own.size === 0) return [];
      const baseline = baselineArmsFor(byArm, label).find((candidate) => {
        const base = new Set(byArm.get(candidate));
        return own.size === base.size && [...own].every((task) => base.has(task));
      });
      return baseline === undefined ? [] : [{ label, baseline }];
    })
    .toSorted((one, other) => one.label.localeCompare(other.label));
}

export async function scoreDone(values: {
  readonly bench?: string | undefined;
  readonly store?: string | undefined;
}): Promise<void> {
  const named = benchesOf().filter((bench) => values.bench === undefined || bench.name === values.bench);
  if (values.bench !== undefined && named.length === 0) throw new Misused(`no benchmark ${values.bench}`);
  const stores = values.store === undefined ? named.map(recordsHere) : [values.store];
  for (const store of stores) {
    for (const { label, baseline } of completedBenchPairs(store)) {
      const table = await runTextOrThrow([
        capturedExecPath,
        SCORE,
        "table",
        "--out",
        store,
        "--name",
        `${label},${baseline}`,
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
