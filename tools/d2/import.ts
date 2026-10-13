/**
 * Import a harness into a campaign's states, under its digest: the operator's word that a harness
 * built elsewhere is one this campaign keeps, so that a session may start from it (`--parent`), a
 * comparison may name it, and the operator may promote it (`promote.ts --despite "epoch 0"`).
 *
 *   bun tools/d2/import.ts --name r-1 --harness ~/handover/t-4/harness [--note "<why>"]
 *
 * Row C7 of the climb plan (`docs/plan.md`, 10 October): its lever L4 opens a campaign's first epoch
 * from a harness that already installs the field's engine, so that the first epoch stops measuring
 * a solver's set-up time, and until now that harness had to be built by a Builder session of the
 * same campaign. What another campaign handed over (`close.ts`, `harness/`), or a harness written
 * by hand, is imported here instead.
 *
 * It is kept as a session keeps one (`snapshot`, `src/builder/tools.ts`): the files under their
 * digest, the programs copied into a tree beside the state and named by the link `.toolchain`,
 * links copied as they are. It is opened there before anything is recorded and refused where it
 * does not open as the harness it was read as, so that no solve is paid for under a name that is
 * not the harness. The record is `harness.imported`, with where it came from; a harness the
 * campaign keeps already is said so and recorded again by nothing. The campaign is otherwise
 * untouched: the import is no session, so `latest` still names the harness the last session left,
 * and the reference moves only by `promote.ts`.
 *
 * It starts no solve and calls no model.
 */
import { append } from "#src/kernel/log.ts";
import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "#src/meta/filesystem.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { parentToolTree, stagedState } from "#src/builder/tools.ts";
import { openHarness } from "#src/solve/harness.ts";
import { campaignLog } from "./campaign.ts";

const OPTIONS = {
  name: { type: "string" },
  harness: { type: "string" },
  note: { type: "string" },
} as const;

/** `bun tools/d2/import.ts`. Returns the imported harness by its digest and where it is kept. */
export async function importCommand(args: readonly string[]): Promise<{ digest: string; dir: string }> {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const { name, harness } = values;
  if (name === undefined || harness === undefined) throw new Error("name --name and --harness");
  const log = campaignLog(name);
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
  // The programs as a session keeps them: in a tree beside the state, named by a link. A link
  // under the source is followed to the tree itself. The states are made first: a campaign opened
  // and not yet run has none, and until 11 October its import of a harness with programs failed.
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
  // The origin by its last two path segments: the closing report prints it, and leaves the host.
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
