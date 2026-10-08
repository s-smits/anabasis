/**
 * Phase C, without a model: what a stored pack's check program has been seen to do.
 *
 *   bun tools/c/accept.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace
 *
 * Every control of the pack's `controls.json` is put to the checks twice, and the sweep's stored
 * verdicts are added to what each check has been seen to do. It prints one row a check: its
 * instrument, the answers it let pass and refused, and how many of the reject controls that name it
 * it refused. Then the faults (`src/kernel/acceptance.ts`): a control that did not get the verdict
 * it is labelled with, or got two; a check never seen to refuse an answer, or to pass one; a tool a
 * check names that the verifier's tool path does not hold. Exits 1 on any fault.
 *
 * The stored verdicts are v1's, as `grades.tsv` holds them, and are not run again: `regrade.ts`
 * holds this verifier to them. The check program is the bundle's without its battery and its tools
 * are the bundle's, as `admit-sweep.ts` reads them.
 *
 * Not run here. It needs the pack and its tool tree on disk, and the Mac's verifier wall.
 */
import { acceptance, runControls } from "#src/kernel/acceptance.ts";
import { openVerifier, readBrief, type Task } from "#src/kernel/verify.ts";
import { mkdtempSync, rmSync } from "#src/meta/filesystem.ts";
import { tmpdir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { toolTreeSearchDirs } from "#src/verify/solve-command-isolation.ts";
import { checkProgram, packControls, readPack, sweepRows } from "../m0/stored-sweep.ts";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    sweep: { type: "string" },
    bundle: { type: "string" },
    jobs: { type: "string", default: "4" },
  },
});

async function main(): Promise<number> {
  const { root, sweep, bundle } = values;
  if (root === undefined || sweep === undefined || bundle === undefined) {
    throw new Error("name --root, --sweep and --bundle");
  }
  const { tasks } = readPack(bundle);
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const stored = sweepRows(root, sweep).flatMap(({ taskId, expected }) => {
    const task: Task | undefined = byId.get(taskId);
    return task === undefined || expected === null ? [] : [{ task, verdict: expected }];
  });
  const dir = mkdtempSync(join(tmpdir(), "ana-accept-"));
  try {
    const checks = checkProgram(bundle, join(dir, "checks"));
    const tools = join(bundle, ".toolchain");
    const path = toolTreeSearchDirs(tools).join(":");
    const runs = await runControls(
      openVerifier({ checks, tools }),
      tasks,
      packControls(bundle),
      Number(values.jobs),
    );
    const found = (toolId: string) => Bun.which(toolId, { PATH: path }) !== null;
    const { checks: rows, faults } = acceptance(readBrief(checks), tasks, runs, stored, found);
    console.log(`${String(runs.length)} controls twice, ${String(stored.length)} stored verdicts`);
    console.log("check\tinstrument\tpassed\trefused\tcontrols refused of those naming it");
    for (const row of rows) {
      console.log(
        `${row.id}\t${row.instrument}\t${String(row.passed)}\t${String(row.refused)}\t${String(row.caught)} of ${String(row.named)}`,
      );
    }
    for (const fault of faults) console.log(`fault: ${fault}`);
    console.log(faults.length === 0 ? "no fault" : `${String(faults.length)} faults`);
    return faults.length === 0 ? 0 : 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

runtimeProcess.exitCode = await main();
