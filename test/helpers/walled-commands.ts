/**
 * Runs each command as a seat's commands run (`runWalled`, in a claimed root) and prints what each
 * said, as JSON. A test starts this as a child to set the home the wall reads as a process starts.
 *
 *   bun test/helpers/walled-commands.ts <repository root> <command>...
 */
import { capturedJsonStringify } from "../../src/meta/json-runtime.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import { makeSeatDirs, runWalled, solveDirs } from "../../src/tools/command.ts";
import { solveIsolationPolicy } from "../../src/wall/base.ts";
import { claimRoot } from "../../src/wall/seat-root.ts";

const [repoRoot = "", ...commands] = runtimeProcess.argv.slice(2);
const dirs = solveDirs(`walled-commands-${String(runtimeProcess.pid)}`);
const release = claimRoot(dirs.root);
makeSeatDirs(dirs);
const base = solveIsolationPolicy({ repoRoot });
if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
const wall = { base, dirs, toolTree: null, limits: { shellDefaultSeconds: 30, shellMaxSeconds: 30 } };
/** What `command` printed, once it has ended. */
async function said(command: string): Promise<string> {
  let output = "";
  await runWalled(wall, command, {
    onData: (data) => {
      output += data.toString("utf8");
    },
  });
  return output.trim();
}
const answers = await commands.reduce<Promise<string[]>>(
  async (done, command) => [...(await done), await said(command)],
  Promise.resolve([]),
);
await release();
console.log(capturedJsonStringify(answers));
