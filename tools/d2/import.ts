/**
 * Import a harness built elsewhere into a campaign's states, under its digest, on the operator's
 * word, so a session may start from it (`--parent`), a comparison may name it, and `promote.ts
 * --despite "<why>"` may promote it.
 *
 *   bun tools/d2/import.ts --name r-1 --harness ~/handover/t-4/harness [--note "<why>"]
 */
import { append } from "#src/kernel/log.ts";
import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "#src/meta/filesystem.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { parentToolTree, stagedState } from "#src/builder/store.ts";
import { openHarness } from "#src/harness/open.ts";
import { harnessNamed } from "./campaign.ts";

const OPTIONS = {
  name: { type: "string" },
  harness: { type: "string" },
  note: { type: "string" },
} as const;

export async function importCommand(args: readonly string[]): Promise<{ digest: string; dir: string }> {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const { log, harness } = harnessNamed(values);
  if (!existsSync(dirname(log))) {
    throw new Error(`${dirname(log)}: the campaign has no folder yet; open it before a harness is imported`);
  }
  const source = resolve(harness);
  const { digest } = await openHarness(source);
  const states = join(dirname(log), "states");
  const dir = join(states, digest);
  if (existsSync(dir)) {
    if ((await openHarness(dir)).digest !== digest) {
      throw new Error(`${dir} no longer opens as the harness it is kept as`);
    }
    console.log(`harness ${digest} is one the campaign keeps already; nothing is recorded`);
    return { digest, dir };
  }
  // The programs are kept as a session keeps them, in a tree beside the state named by a link (a link
  // under the source is followed to the tree). The states folder is made first: a campaign opened and
  // not yet run has none.
  const own = parentToolTree(source);
  mkdirSync(states, { recursive: true });
  const tree = own === null ? null : mkdtempSync(join(states, "tree-"));
  let scratch: string | null = null;
  try {
    if (own !== null && tree !== null) cpSync(own, tree, { recursive: true, verbatimSymlinks: true });
    scratch = stagedState(source, states, tree, "importing-");
    const kept = await openHarness(scratch);
    if (kept.digest !== digest) {
      throw new Error(
        `${source} opens as harness ${digest} and its copy as ${kept.digest}: the copy is not the harness, and is not kept as it`,
      );
    }
    renameSync(scratch, dir);
  } catch (error) {
    if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
    if (tree !== null) rmSync(tree, { recursive: true, force: true });
    throw error;
  }
  // The origin by its last two path segments, which the closing report prints and which leaves the
  // host.
  const from = join(basename(dirname(source)), basename(source));
  append(log, "harness.imported", { harness: digest, from, ...keyIfDefined("note", values.note) });
  console.log(
    `harness ${digest} is kept at ${dir}: a session may start from it (--parent ${digest}), a comparison may name it, and promote.ts may make it the reference`,
  );
  return { digest, dir };
}

if (import.meta.main) {
  await importCommand(Bun.argv.slice(2));
  runtimeProcess.exitCode = 0;
}
