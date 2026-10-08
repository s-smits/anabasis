/**
 * `bun run runs <verb>`, over every run log in the repository's worktrees: `pulse` says what each
 * gained since the last look (`pulse.ts`), `zip` bundles them for handover (`zip.ts`).
 */
import { runtimeProcess } from "#src/meta/process.ts";
import { watch } from "./pulse.ts";
import { zipRuns } from "./zip.ts";

const [verb, ...args] = Bun.argv.slice(2);
if (verb === "pulse") {
  await watch(args);
} else if (verb === "zip") {
  zipRuns(args);
} else {
  throw new Error("usage: bun run runs pulse|zip [<name> ...], each verb's options in its file's head");
}
runtimeProcess.exit(0);
