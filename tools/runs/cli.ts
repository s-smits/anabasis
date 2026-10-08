/**
 * `bun run runs <verb>`, over every run log in the repository's worktrees: `pulse` says what each
 * gained since the last look (`pulse.ts`), `zip` bundles them for handover (`zip.ts`), `launch`
 * starts a round once its log says it can report something and `stop` ends a run (`launch.ts`),
 * `compare` reads named rounds against one another (`compare.ts`). `seed` copies a campaign under
 * another name, cut where a question starts (`seed.ts`), and `rehearse` runs a round over a seed
 * with a script in each model seat (`rehearse.ts`).
 */
import { runtimeProcess } from "#src/meta/process.ts";
import { compareRuns } from "./compare.ts";
import { launch, stop } from "./launch.ts";
import { watch } from "./pulse.ts";
import { rehearse } from "./rehearse.ts";
import { seed } from "./seed.ts";
import { zipRuns } from "./zip.ts";

const VERBS = { pulse: watch, zip: zipRuns, launch, stop, compare: compareRuns, seed, rehearse };
const [verb, ...args] = Bun.argv.slice(2);
const run = Object.entries(VERBS).find(([name]) => name === verb)?.[1];
if (run === undefined) {
  throw new Error(
    `usage: bun run runs ${Object.keys(VERBS).join("|")} ..., each verb's options in its file's head`,
  );
}
await run(args);
// With the code a verb set: a refused launch is not a success.
runtimeProcess.exit();
