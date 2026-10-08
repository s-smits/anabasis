/**
 * Phase C, without a model: what a campaign's check program has been seen to do, on record against
 * the version it was read at.
 *
 *   bun tools/c/accept.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss
 *
 * Every control of the pack's `controls.json` is put to the campaign's checks twice, and the sweep's
 * stored verdicts are added to what each check has been seen to do. It prints one row a check: its
 * instrument, the answers it let pass and refused, and how many of the reject controls that name it
 * it refused. Then the faults (`src/kernel/acceptance.ts`): a control that did not get the verdict
 * it is labelled with, or got two; a check never seen to refuse an answer, or to pass one; a tool a
 * check names that the verifier's tool path does not hold. The reading goes into the campaign's log
 * as `checker.read`, under the contract's hash and the check program's digest. Exits 1 on any fault.
 *
 * `--freeze` is the operator's word that this checker stands: with no fault in the reading, it
 * writes `contract.frozen` for the same two hashes. It is to be given once the refused answers have
 * been read too (`rejections.ts`), which this command cannot see. From then on a campaign of this
 * name whose contract or check program is another does not open (`tools/d2/campaign.ts`): a
 * repaired checker takes a campaign of its own.
 *
 * The stored verdicts are v1's, as `grades.tsv` holds them, and are not run again: `regrade.ts`
 * holds this verifier to them. The check program is the campaign's staged copy of the bundle's,
 * without its battery, and its tools are the bundle's.
 *
 * It needs the pack and its tool tree on disk, and the Mac's verifier wall.
 */
import { acceptance, frozenChecker, runControls } from "#src/kernel/acceptance.ts";
import { append, read } from "#src/kernel/log.ts";
import { readBrief } from "#src/kernel/verify.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { openCampaign } from "../d2/campaign.ts";
import { packControls, sweepRows, toolOnPath } from "../m0/stored-sweep.ts";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    sweep: { type: "string" },
    bundle: { type: "string" },
    name: { type: "string" },
    jobs: { type: "string", default: "4" },
    freeze: { type: "boolean", default: false },
  },
});

async function main(): Promise<number> {
  const { root, sweep, bundle, name } = values;
  if (root === undefined || sweep === undefined || bundle === undefined || name === undefined) {
    throw new Error("name --root, --sweep, --bundle and --name");
  }
  const rows = sweepRows(root, sweep);
  const [first] = rows;
  if (first === undefined) throw new Error(`${sweep} graded no solve`);
  const campaign = await openCampaign({ root, sweep, cycle: first.cycle, bundle, name });
  const { tasks, log, checker } = campaign;
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const stored = rows.flatMap(({ taskId, expected }) => {
    const task = byId.get(taskId);
    return task === undefined || expected === null ? [] : [{ task, verdict: expected }];
  });
  const runs = await runControls(campaign.verify, tasks, packControls(bundle), Number(values.jobs));
  const { checks, faults } = acceptance(readBrief(campaign.checks), tasks, runs, stored, toolOnPath(bundle));
  append(log, "checker.read", {
    ...checker,
    controls: runs.length,
    stored: stored.length,
    rows: checks.map((row) => ({ ...row, missing: [...row.missing] })),
    faults: [...faults],
  });
  console.log(`${String(runs.length)} controls twice, ${String(stored.length)} stored verdicts`);
  console.log("check\tinstrument\tpassed\trefused\tcontrols refused of those naming it");
  for (const row of checks) {
    console.log(
      `${row.id}\t${row.instrument}\t${String(row.passed)}\t${String(row.refused)}\t${String(row.caught)} of ${String(row.named)}`,
    );
  }
  for (const fault of faults) console.log(`fault: ${fault}`);
  console.log(faults.length === 0 ? "no fault" : `${String(faults.length)} faults`);
  if (values.freeze && faults.length > 0) {
    console.log("not frozen: a checker with a fault in its reading does not stand");
  } else if (values.freeze) {
    // `openCampaign` has refused a checker the log froze otherwise, so one frozen here is this one.
    if (frozenChecker(read(log)) === null) append(log, "contract.frozen", { ...checker });
    console.log(`frozen: contract ${checker.contract}, check program ${checker.checks}`);
  }
  return faults.length === 0 ? 0 : 1;
}

runtimeProcess.exitCode = await main();
