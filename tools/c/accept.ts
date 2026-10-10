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
 * check names that the verifier's tool path does not hold; a task on which the do-nothing answer,
 * the smallest the answer format allows, was not rejected; and a check its author's own computation
 * decides, which stands only once the operator admits it by name (`--admit a,b`). The reading goes
 * into the campaign's log as `checker.read`, under the contract's hash and the check program's
 * digest. Exits 1 on any fault.
 *
 * `--cycle` names the stored cycle the campaign opens over, as every other command of a campaign
 * names it; without it the cycle is the sweep's first graded row's.
 *
 * `--freeze` is the operator's word that this checker stands: with no fault in the reading, it
 * writes `contract.frozen` for the same two hashes. With a fault it writes nothing, unless the
 * operator says why the checker stands all the same: `--despite "<reason>"`, which the event keeps
 * beside the count of faults. A pack's controls can go stale while its checks are sound, as the
 * truss pack's accept controls had by 8 October, and the reading reports that without deciding it. It is to be given once the refused answers have
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
import {
  authoredFaults,
  doNothingFaults,
  frozenChecker,
  readChecker,
  toolFaults,
} from "#src/kernel/acceptance.ts";
import { append, read } from "#src/kernel/log.ts";
import { readBrief } from "#src/kernel/verify.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { keyIfDefined, keysIf } from "#src/meta/optional-key.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { openCampaign, packNamed } from "../d2/campaign.ts";
import { packControls, sweepRows, toolOnPath } from "../m0/stored-sweep.ts";

const OPTIONS = {
  root: { type: "string" },
  sweep: { type: "string" },
  bundle: { type: "string" },
  name: { type: "string" },
  cycle: { type: "string" },
  admit: { type: "string" },
  jobs: { type: "string", default: "4" },
  freeze: { type: "boolean", default: false },
  despite: { type: "string" },
} as const;

/** `bun tools/c/accept.ts`: the reading, and with `--freeze` the operator's word. It returns the
 *  command's exit code: 1 where the reading holds a fault or a freeze was refused. */
export async function acceptCommand(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const { root, sweep } = values;
  // A stored pack's verdicts are its sweep's, and its cycle the sweep's first graded row's where
  // none is named. An exam drafted from a prompt has neither: its controls are all it is read on.
  const rows = root === undefined || sweep === undefined ? [] : sweepRows(root, sweep);
  if (sweep !== undefined && rows.length === 0) throw new Error(`${sweep} graded no solve`);
  const campaign = await openCampaign(packNamed({ ...values, cycle: values.cycle ?? rows[0]?.cycle }));
  const { tasks, log, checker, contract, bundle } = campaign;
  const brief = readBrief(campaign.checks);
  const admitted = new Set(
    (values.admit ?? "").split(",").flatMap((id) => (id.trim() === "" ? [] : [id.trim()])),
  );
  const unknown = [...admitted].filter((id) => !brief.truthChecks.some((check) => check.id === id));
  if (unknown.length > 0) {
    throw new Error(`--admit names ${unknown.join(", ")}, and the check program holds no such check`);
  }
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const stored = rows.flatMap(({ taskId, expected }) => {
    const task = byId.get(taskId);
    return task === undefined || expected === null ? [] : [{ task, verdict: expected }];
  });
  // A tool a check names and the path lacks is named before any control runs: the verifier cannot
  // decide such a check, and a run that stopped on it never reached the fault that says why.
  const lost = toolFaults(brief, toolOnPath(bundle));
  if (lost.length > 0) {
    append(log, "checker.read", { ...checker, controls: 0, stored: 0, rows: [], faults: lost });
    for (const fault of lost) console.log(`fault: ${fault}`);
    console.log("no control was run: a check whose tool is missing decides nothing");
    return 1;
  }
  const { runs, seen, idle, unformed, rejected } = await readChecker({
    verify: campaign.verify,
    brief,
    contract,
    tasks,
    controls: packControls(bundle),
    stored,
    found: toolOnPath(bundle),
    width: Number(values.jobs),
  });
  const { checks } = seen;
  const faults = [...seen.faults, ...authoredFaults(checks, admitted), ...doNothingFaults(rejected)];
  append(log, "checker.read", {
    ...checker,
    controls: runs.length,
    stored: stored.length,
    rows: checks.map((row) => ({ ...row, missing: [...row.missing] })),
    doNothing:
      unformed === null
        ? {
            answer: idle,
            tasks: rejected.length,
            rejected: rejected.length - doNothingFaults(rejected).length,
          }
        : { unformed },
    admitted: [...admitted],
    faults: [...faults],
  });
  console.log(`${String(runs.length)} controls twice, ${String(stored.length)} stored verdicts`);
  console.log(
    unformed === null
      ? `the do-nothing answer ${capturedJsonStringify(idle)}: rejected on ${String(rejected.length - doNothingFaults(rejected).length)} of ${plural(rejected.length, "task")}`
      : `no do-nothing answer was put to the checks: the smallest value the format's schema yields does not follow it (${unformed})`,
  );
  console.log("check\tinstrument\tpassed\trefused\tcontrols refused of those naming it");
  for (const row of checks) {
    console.log(
      `${row.id}\t${row.instrument}\t${String(row.passed)}\t${String(row.refused)}\t${String(row.caught)} of ${String(row.named)}`,
    );
  }
  for (const fault of faults) console.log(`fault: ${fault}`);
  console.log(faults.length === 0 ? "no fault" : `${String(faults.length)} faults`);
  const despite = values.despite?.trim() ?? "";
  if (values.freeze && faults.length > 0 && despite === "") {
    console.log(
      "not frozen: the reading holds a fault. It is yours to freeze all the same: say why with --despite",
    );
    return 1;
  }
  if (values.freeze) {
    // `openCampaign` has refused a checker the log froze otherwise, so one frozen here is this one.
    // Frozen over faults, the word carries its reason: a fault is reported and never decided on,
    // and a pack whose controls have gone stale is no reason to leave its checker unpinned.
    if (frozenChecker(read(log)) === null) {
      append(log, "contract.frozen", {
        ...checker,
        ...keysIf(faults.length > 0, () => ({ despite, faults: faults.length })),
        ...keyIfDefined("admitted", admitted.size > 0 ? [...admitted] : undefined),
      });
    }
    console.log(
      `frozen${faults.length > 0 ? ` despite ${plural(faults.length, "fault")}` : ""}: contract ${checker.contract}, check program ${checker.checks}`,
    );
    return 0;
  }
  return faults.length === 0 ? 0 : 1;
}

if (import.meta.main) runtimeProcess.exitCode = await acceptCommand(Bun.argv.slice(2));
