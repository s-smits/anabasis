import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { capturedExecPath } from "#src/meta/process.ts";
import { runTextOrThrow } from "#src/meta/subprocess.ts";
import { baselineCandidates, isBaselineArmName, judgedFilesByArm, runtimeOfFile } from "./bench-store.ts";
import { benchesOf } from "./host-config.ts";
import { Misused } from "./registry.ts";
import { recordsHere } from "./snapshots.ts";

const SCORE = join(import.meta.dir, "..", "..", "studies", "harness2", "score.ts");

function scoredCovers(file: string, tasks: number): boolean {
  if (!existsSync(file)) return false;
  const head = /^all (\d+)\b/u.exec(readFileSync(file, "utf8"));
  return head === null || Number(head[1]) >= tasks;
}

function sameRuntime(root: string, arm: string, files: readonly string[], expected: string): boolean {
  return files.every((file) => runtimeOfFile(join(root, arm, file)) === expected);
}

export function completedBenchPairs(store: string): { readonly label: string; readonly baseline: string }[] {
  const byArm = judgedFilesByArm(store);
  const root = join(store, "judged");
  return [...byArm.keys()]
    .filter((arm) => !isBaselineArmName(arm))
    .flatMap((label) => {
      const ownFiles = byArm.get(label) ?? [];
      if (ownFiles.length === 0 || scoredCovers(join(store, "scored", `${label}.txt`), ownFiles.length)) {
        return [];
      }
      const own = new Set(ownFiles);
      const runtime = runtimeOfFile(join(root, label, ownFiles[0] ?? ""));
      if (runtime === null || !sameRuntime(root, label, ownFiles, runtime)) return [];
      const baseline = baselineCandidates(byArm, label).find((candidate) => {
        const baseFiles = byArm.get(candidate) ?? [];
        const base = new Set(baseFiles);
        return (
          own.size === base.size &&
          [...own].every((task) => base.has(task)) &&
          sameRuntime(root, candidate, baseFiles, runtime)
        );
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
