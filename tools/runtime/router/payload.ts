/**
 * Every file of the check runner's folder, by name, as this tree makes it: what `install.ts` writes,
 * and what `bun run runs sync` compares a machine's installed runner with, without installing one.
 */
import { readFileSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";

/** The script a machine runs by its path. */
export const RUN_SCRIPT = "run.sh";
/** What an install records in the folder. */
export const RECEIPT = "INSTALLED";
/** The scripts copied as they are. */
const SCRIPTS = ["lib.sh", RUN_SCRIPT, "host.sh"];
const BUNDLED = "hosts.js";
export const RUNNER_FILES: readonly string[] = [...SCRIPTS, BUNDLED];

/** `entry` as one script for a Bun, importing nothing from where it was built. */
export async function bundled(entry: string): Promise<string> {
  const built = await Bun.build({ entrypoints: [entry], target: "bun" });
  const [bundle] = built.outputs;
  if (!built.success || bundle === undefined) {
    throw new Error(`${entry} did not bundle: ${built.logs.map(String).join("\n")}`);
  }
  return await bundle.text();
}

export async function payload(): Promise<Map<string, string>> {
  return new Map<string, string>([
    ...SCRIPTS.map((name): [string, string] => [name, readFileSync(join(import.meta.dir, name), "utf8")]),
    [BUNDLED, await bundled(join(import.meta.dir, "hosts.ts"))],
  ]);
}
