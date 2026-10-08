/**
 * Phase C, without a model: what a pack's check program has been seen to do, on record against the
 * version it was read at, and the operator's word that it is the campaign's checker.
 *
 *   bun tools/c/accept.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss [--freeze]
 *
 * It is one command for a checker's first freeze and for every change of it after, since both are
 * the same word: this checker stands.
 *
 * **A campaign with no frozen checker, or the pack it is frozen on.** Every control of the pack's
 * `controls.json` is put to the campaign's checks twice, and the sweep's stored verdicts are added
 * to what each check has been seen to do. It prints one row a check: its instrument, the answers it
 * let pass and refused, and how many of the reject controls that name it it refused. Then the
 * faults (`src/kernel/acceptance.ts`): a control that did not get the verdict it is labelled with,
 * or got two; a check never seen to refuse an answer, or to pass one; a tool a check names that the
 * verifier's tool path does not hold. The reading goes into the campaign's log as `checker.read`,
 * under the contract's hash and the check program's digest. Exits 1 on any fault. `--freeze` writes
 * `contract.frozen` for the same two hashes when the reading holds no fault. With a fault it writes
 * nothing, unless the operator says why the checker stands all the same: `--despite "<reason>"`,
 * which the event keeps beside the count of faults. A pack's controls can go stale while its checks
 * are sound, as the truss pack's accept controls had by 8 October, and the reading reports that
 * without deciding it. The word is to be given once the refused answers have been read too
 * (`rejections.ts`), which this command cannot see.
 *
 * **A campaign frozen on another checker than the pack's.** `--bundle` is then a changed pack: a
 * repaired check program, or a new requirement with its rule, its check and its controls, laid out
 * as the pack the campaign was opened over. The command reads what adopting it would do
 * (`adoption.ts`) and writes nothing: the pack's controls under its own checks and under the
 * standing ones, every answer the log holds graded again with the verdicts that moved, what was
 * ruled of the refusals it withdraws, and each live task under the pack's checks with no solve.
 * `--labels labels.json` gives a person's rulings of refused answers, a solve to a ruling, as
 * `rejections.ts --draw` and `tools/d2/settle.ts` leave them; `--referee-decides` lets the
 * Referee's rulings in the log count too, once they have cleared the operator's bar
 * (`src/review/agreement.ts`). It exits 1 when anything counts against the pack.
 *
 * With `--freeze` the pack is adopted as the campaign's next checker epoch
 * (`src/kernel/epoch.ts`), in the same log: the pack's check program is staged beside the earlier
 * ones, the freeze is logged, every live task is carried into the epoch, and the solves on record
 * are graded again for the carried versions where the solver was asked the same thing. What counts
 * against the pack refuses the adoption unless `--despite` says why it stands. So does a session
 * the log shows started and never ended, where no process writes the log: the reason then says
 * that the session is over. A round or a session still running, a round that ended its session and
 * has not reported or been settled, a live task the pack's checks cannot be put to, and a check
 * program the log froze before refuse it whatever is said. From then on `--bundle` names the
 * adopted pack to every command of the campaign, and none of them takes a flag about the epoch.
 * An adoption a crash cut short is finished by running the same command again, with the labels
 * and the flags it was read with.
 *
 * The stored verdicts of the first reading are v1's, as `grades.tsv` holds them, and are not run
 * again: `regrade.ts` holds this verifier to them. The check program is the campaign's staged copy
 * of the bundle's, without its battery, and its tools are the bundle's.
 *
 * It needs the pack and its tool tree on disk, and the Mac's verifier wall.
 */
import {
  acceptance,
  type CheckReading,
  frozenChecker,
  runControls,
  toolFaults,
} from "#src/kernel/acceptance.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { epochsOf, unfinished } from "#src/kernel/epoch.ts";
import { append, appendAll, read } from "#src/kernel/log.ts";
import { openVerifier, readBrief } from "#src/kernel/verify.ts";
import { existsSync, readFileSync, rmSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { plural } from "#src/meta/text.ts";
import { labelled } from "#src/review/rejections.ts";
import { campaignFolder, epochChecks, openCampaign, stagedChecks } from "../d2/campaign.ts";
import {
  contractOf,
  packageOf,
  packBrief,
  packControls,
  packProgram,
  recordedAnswerFormat,
  type Row,
  sweepResources,
  sweepRows,
  sweepWitnesses,
  toolOnPath,
} from "../m0/stored-sweep.ts";
import { processes, writers } from "../runs/pulse.ts";
import { adoption, remaining, type Side } from "./adoption.ts";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    sweep: { type: "string" },
    bundle: { type: "string" },
    name: { type: "string" },
    jobs: { type: "string", default: "4" },
    freeze: { type: "boolean", default: false },
    despite: { type: "string" },
    labels: { type: "string" },
    "referee-decides": { type: "boolean", default: false },
  },
});

/** The pack and the campaign a run of this command names. */
interface Named {
  readonly root: string;
  readonly sweep: string;
  readonly bundle: string;
  readonly name: string;
  /** The sweep's graded solves, the first of which names the cycle the campaign is opened on. */
  readonly rows: readonly Row[];
  readonly first: Row;
}

const LOG = "log.jsonl";

/** One row a check, then each fault on a line of its own. */
function printed(checks: readonly CheckReading[], faults: readonly string[]): void {
  console.log("check\tinstrument\tpassed\trefused\tcontrols refused of those naming it");
  for (const row of checks) {
    console.log(
      `${row.id}\t${row.instrument}\t${String(row.passed)}\t${String(row.refused)}\t${String(row.caught)} of ${String(row.named)}`,
    );
  }
  for (const fault of faults) console.log(`fault: ${fault}`);
}

/**
 * A changed pack read against the campaign, and adopted on the operator's word. The pack's check
 * program is staged where an adopted one stands, so that what was read is byte for byte what the
 * campaign then runs under; a reading that adopts nothing takes its copy away again.
 */
async function adopt({ root, sweep, bundle, name, rows, first }: Named): Promise<number> {
  const dir = campaignFolder(name);
  const log = join(dir, LOG);
  const logged = read(log);
  // An adoption a crash cut short is read again from the log as it was before its freeze.
  const half = unfinished(logged);
  const cut = half === null ? logged.length : (epochsOf(logged).at(-1)?.index ?? logged.length);
  const events = logged.slice(0, cut);
  const staged = epochChecks(dir, packProgram(bundle));
  const fresh = !existsSync(staged);
  let adopted = half !== null;
  try {
    const campaign = await openCampaign({ root, sweep, cycle: first.cycle, bundle, name, candidate: staged });
    // A copy an earlier run left half made, or one edited since, is not what the pack holds.
    if (campaign.checker.checks !== packProgram(bundle)) {
      throw new Error(
        `${staged} is not the check program ${bundle} holds: remove it and run the command again`,
      );
    }
    if (
      half !== null &&
      (half.checks !== campaign.checker.checks || half.contract !== campaign.checker.contract)
    ) {
      throw new Error(
        `${log}: the adoption of check program ${half.checks.slice(0, 8)} was cut short, and this pack is another: finish that one first`,
      );
    }
    const lost = toolFaults(readBrief(campaign.checks), toolOnPath(bundle));
    if (lost.length > 0) {
      for (const fault of lost) console.log(`fault: ${fault}`);
      console.log("no control was run: a check whose tool is missing decides nothing");
      return 1;
    }
    const shown = (contract: string, brief: Parameters<typeof sweepResources>[0]) =>
      hashJsonValue({ contract, resources: sweepResources(brief).map(({ digest }) => digest) });
    // The checker the campaign stands on, from its staged program: the contract its brief gives
    // with the sweep's answer format is the frozen one, or the program is not the one to compare.
    const frozen = frozenChecker(events);
    const standing = stagedChecks(dir, events);
    const old = existsSync(standing) ? packBrief(standing) : null;
    const oldContract = old === null ? null : contractOf(old, recordedAnswerFormat(first));
    const current: Side | null =
      old === null || oldContract === null || frozen === null || contractHash(oldContract) !== frozen.contract
        ? null
        : {
            checker: frozen,
            contract: oldContract,
            checks: standing,
            verify: openVerifier({ checks: standing, tools: join(bundle, ".toolchain") }),
            pack: (task) => packageOf(standing, task),
            shown: shown(frozen.contract, old),
          };
    if (current === null) {
      console.log(
        `the check program the campaign stands on is not at ${standing} as the log froze it: every fault of the pack counts, and no standing carries`,
      );
    }
    const { labels } = labelled(
      values.labels === undefined ? {} : capturedJsonParse(readFileSync(values.labels, "utf8")),
    );
    const run = { name, tree: campaign.repo, path: log, end: "comparison.reported" } as const;
    const reading = await adoption({
      events,
      candidate: {
        checker: campaign.checker,
        contract: campaign.contract,
        checks: campaign.checks,
        verify: campaign.verify,
        pack: campaign.pack,
        shown: shown(campaign.checker.contract, campaign.brief),
        tasks: campaign.tasks,
        controls: packControls(bundle),
        found: toolOnPath(bundle),
      },
      current,
      witnesses: sweepWitnesses(rows),
      labels,
      refereeDecides: values["referee-decides"],
      running: half === null ? writers(run, processes()).map(({ pid }) => pid) : [],
      jobs: Number(values.jobs),
    });

    const moved = reading.rows.filter(({ was, now }) => was !== now);
    console.log(
      `the campaign stands on contract ${frozen?.contract.slice(0, 8) ?? "?"}, check program ${frozen?.checks.slice(0, 8) ?? "?"}; the pack is contract ${campaign.checker.contract.slice(0, 8)}, check program ${campaign.checker.checks.slice(0, 8)}, which would be epoch ${String(reading.epoch)}`,
    );
    console.log(
      `${String(reading.controls)} controls twice, ${String(reading.rows.length)} logged verdicts, ${String(moved.length)} moved`,
    );
    printed(reading.checks, reading.faults);
    for (const fault of reading.shared) {
      console.log(`standing fault, shared with the checker the log froze: ${fault}`);
    }
    if (moved.length > 0) console.log("solve\ttask\twas\tnow");
    for (const { solve, task, was, now } of moved) console.log(`${solve}\t${task}\t${was}\t${now}`);
    console.log(capturedJsonStringify(reading.repair, null, 2));
    console.log(
      reading.asked === "same"
        ? "a solver is asked the same thing: the contract and the public resources are unchanged, so a solve on record stands for a carried task that reads the same"
        : "a solver is asked another thing: the contract or a public resource changed, so no solve on record places a task and an accepted answer newly refused is expected",
    );
    const word = (wanted: string) => reading.tasks.filter((task) => task.word === wanted);
    console.log(
      `${plural(reading.tasks.length, "live task")}: ${String(word("feasible").length)} feasible under the pack's checks, ${String(word("reach").length)} to wait for a witness, ${String(word("waiting").length)} to wait for controls; ${plural(reading.stood, "solve")} on record would stand for them`,
    );
    for (const { taskId, word: how, why } of reading.tasks) {
      if (why !== null) console.log(`  ${taskId}\t${how}\t${why}`);
    }
    for (const line of reading.refused) console.log(`refused: ${line}`);
    for (const line of reading.against) console.log(`against: ${line}`);

    const despite = values.despite?.trim() ?? "";
    if (half !== null) {
      // The freeze is in the log already, with the word it was given on and the count of what
      // that word overruled. A reading that counts otherwise was made with other labels.
      const froze = logged[cut]?.data;
      const overruled = isNumber(froze?.faults) ? froze.faults : 0;
      if (overruled !== reading.against.length) {
        throw new Error(
          `${log}: the adoption that was cut short froze the pack over ${plural(overruled, "finding")} and this reading counts ${String(reading.against.length)}: give the labels and the flags it was read with`,
        );
      }
      const left = remaining(
        logged.slice(cut + 1),
        reading.entries(isString(froze?.despite) ? froze.despite : ""),
      );
      appendAll(log, left);
      console.log(
        `adopted: the adoption that was cut short is finished, ${plural(left.length, "event")} appended`,
      );
      return 0;
    }
    if (!values.freeze) {
      console.log(
        reading.refused.length + reading.against.length === 0
          ? "nothing counts against the pack: --freeze adopts it"
          : `${plural(reading.against.length, "finding")} against the pack, ${plural(reading.refused.length, "refusal")}`,
      );
      return reading.refused.length + reading.against.length === 0 ? 0 : 1;
    }
    if (reading.refused.length > 0) {
      console.log("not adopted: what is refused is not the operator's to overrule here");
      return 1;
    }
    if (reading.against.length > 0 && despite === "") {
      console.log(
        `not adopted: ${plural(reading.against.length, "finding")} against the pack. It is yours to adopt all the same: say why with --despite`,
      );
      return 1;
    }
    appendAll(log, reading.entries(despite));
    adopted = true;
    console.log(
      `adopted${reading.against.length > 0 ? ` despite ${plural(reading.against.length, "finding")}` : ""}: epoch ${String(reading.epoch)}, contract ${campaign.checker.contract}, check program ${campaign.checker.checks}; name this pack as --bundle from here on`,
    );
    return 0;
  } finally {
    if (fresh && !adopted) rmSync(staged, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const { root, sweep, bundle, name } = values;
  if (root === undefined || sweep === undefined || bundle === undefined || name === undefined) {
    throw new Error("name --root, --sweep, --bundle and --name");
  }
  const rows = sweepRows(root, sweep);
  const [first] = rows;
  if (first === undefined) throw new Error(`${sweep} graded no solve`);
  // A pack that is not the checker the log froze is a changed one, to be read as an adoption.
  const before = read(join(campaignFolder(name), LOG));
  const standing = frozenChecker(before);
  if (unfinished(before) !== null || (standing !== null && packProgram(bundle) !== standing.checks)) {
    return adopt({ root, sweep, bundle, name, rows, first });
  }
  const campaign = await openCampaign({ root, sweep, cycle: first.cycle, bundle, name });
  const { tasks, log, checker } = campaign;
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const stored = rows.flatMap(({ taskId, expected }) => {
    const task = byId.get(taskId);
    return task === undefined || expected === null ? [] : [{ task, verdict: expected }];
  });
  // A tool a check names and the path lacks is named before any control runs: the verifier cannot
  // decide such a check, and a run that stopped on it never reached the fault that says why.
  const lost = toolFaults(readBrief(campaign.checks), toolOnPath(bundle));
  if (lost.length > 0) {
    append(log, "checker.read", { ...checker, controls: 0, stored: 0, rows: [], faults: lost });
    for (const fault of lost) console.log(`fault: ${fault}`);
    console.log("no control was run: a check whose tool is missing decides nothing");
    return 1;
  }
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
  printed(checks, faults);
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
    if (standing === null) {
      append(log, "contract.frozen", {
        ...checker,
        ...(faults.length > 0 ? { despite, faults: faults.length } : {}),
      });
    }
    console.log(
      `frozen${faults.length > 0 ? ` despite ${plural(faults.length, "fault")}` : ""}: contract ${checker.contract}, check program ${checker.checks}`,
    );
    return 0;
  }
  return faults.length === 0 ? 0 : 1;
}

runtimeProcess.exitCode = await main();
