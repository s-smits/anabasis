/**
 * `bun run runs <verb>`, over every run log in the repository's worktrees: `pulse` says what each
 * gained since the last look (`pulse.ts`), `zip` bundles them for handover (`zip.ts`), `launch`
 * starts a round once its log says it can report something and `stop` ends a run (`launch.ts`).
 */
import { runtimeProcess } from "#src/meta/process.ts";
import { launch, stop } from "./launch.ts";
import { watch } from "./pulse.ts";
import { zipRuns } from "./zip.ts";

const VERBS = { pulse: watch, zip: zipRuns, launch, stop };
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
