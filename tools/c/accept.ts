/**
 * Phase C, without a model: what a campaign's check program has been seen to do, on record against
 * the version it was read at.
 *
 *   bun tools/c/accept.ts --name <campaign> [--admit a,b | --admit-authored] [--freeze]
 *
 * Every control of the drafted exam is put to the campaign's checks twice. It prints one row a check: its
 * instrument, the answers it let pass and refused, and how many of the reject controls that name it
 * it refused. Then the faults (`src/kernel/acceptance.ts`): a control that did not get the verdict
 * it is labelled with, or got two; a check never seen to refuse an answer, or to pass one; a tool a
 * check names that the verifier's tool path does not hold; a task on which the do-nothing answer,
 * the smallest the answer format allows, was not rejected; and a check its author's own computation
 * decides, which stands only once the operator admits it by name (`--admit a,b`), or every such
 * check at once (`--admit-authored`, which a campaign without `--hitl` gives). The reading goes into
 * the campaign's log as `checker.read`, under the contract's hash and the check program's digest.
 * Exits 1 on any fault. A format the smallest value its schema yields does not follow is printed as
 * a note rather than a fault, since the format refuses that answer before a check reads it.
 *
 * `--freeze` is the operator's word that this checker stands: with no fault in the reading, it
 * writes `contract.frozen` for the same two hashes. With a fault it writes nothing, unless the
 * operator says why the checker stands all the same: `--despite "<reason>"`, which the event keeps
 * beside the count of faults. A pack's controls can go stale while its checks are sound, and the
 * reading reports that without deciding it. It is to be given once the refused answers have
 * been read too, which this command cannot see. From then on a campaign of this name whose
 * contract or check program is another does not open (`tools/d2/campaign.ts`): a repaired checker
 * takes a campaign of its own.
 *
 * It needs the verifier's wall: Seatbelt on macOS, Bubblewrap on Linux.
 */
import {
  AUTHOR,
  authoredFaults,
  type Checker,
  doNothingFaults,
  frozenChecker,
  readChecker,
} from "#src/kernel/acceptance.ts";
import { append, read } from "#src/kernel/log.ts";
import { OBJECTIVE, readBrief } from "#src/kernel/verify.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { keyIfDefined, keysIf } from "#src/meta/optional-key.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { openCampaign, PACK_OPTIONS, packNamed } from "../d2/campaign.ts";
import { packControls, toolOnPath } from "../m0/stored-sweep.ts";

const OPTIONS = {
  ...PACK_OPTIONS,
  admit: { type: "string" },
  "admit-authored": { type: "boolean", default: false },
  jobs: { type: "string", default: "4" },
  freeze: { type: "boolean", default: false },
  despite: { type: "string" },
} as const;

/** A checker's reading, as `readChecker` makes it. */
export type Reading = Awaited<ReturnType<typeof readChecker>>;

/**
 * Keep a reading of `checker` in the campaign's log (`checker.read`), with the checks the operator
 * admitted, every check its author decides among them where `authored`, and its faults with those
 * not admitted. With `freeze`, the operator's word, the checker is frozen (`contract.frozen`) where
 * the reading holds no fault, or over its faults for the reason `despite` gives. This command and a
 * draft that stands (`tools/d1b/draft.ts`) keep their readings so, the one record of both.
 */
export function keepReading(
  log: string,
  checker: Checker,
  reading: Reading,
  word: {
    readonly admitted: ReadonlySet<string>;
    readonly authored: boolean;
    readonly freeze: boolean;
    readonly despite: string;
  },
): { readonly faults: readonly string[]; readonly frozen: boolean } {
  const { runs, checks, idle, unformed, rejected } = reading;
  // A campaign without `--hitl` gives the operator's word for every check its author decides
  // (the operator's choice), the objective among them, whatever the reading finds.
  const admitted = new Set([
    ...word.admitted,
    ...(word.authored ? checks.flatMap(({ id, instrument }) => (instrument === AUTHOR ? [id] : [])) : []),
  ]);
  const faults = [...reading.faults, ...authoredFaults(checks, admitted)];
  append(log, "checker.read", {
    ...checker,
    controls: runs.length,
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
  const frozen = word.freeze && (faults.length === 0 || word.despite !== "");
  // `openCampaign` has refused a checker the log froze otherwise, so one frozen here is this one.
  // Frozen over faults, the word carries its reason: a fault is reported and never decided on,
  // and a pack whose controls have gone stale is no reason to leave its checker unpinned.
  if (frozen && frozenChecker(read(log)) === null) {
    append(log, "contract.frozen", {
      ...checker,
      ...keysIf(faults.length > 0, () => ({ despite: word.despite, faults: faults.length })),
      ...keyIfDefined("admitted", admitted.size > 0 ? [...admitted] : undefined),
    });
  }
  return { faults, frozen };
}

/** `bun tools/c/accept.ts`: the reading, and with `--freeze` the operator's word. It returns the
 *  command's exit code: 1 where the reading holds a fault or a freeze was refused. */
export async function acceptCommand(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const campaign = await openCampaign(packNamed(values));
  const { tasks, log, checker, contract, bundle } = campaign;
  const brief = readBrief(campaign.checks);
  const admitted = new Set(
    (values.admit ?? "").split(",").flatMap((id) => (id.trim() === "" ? [] : [id.trim()])),
  );
  const unknown = [...admitted].filter(
    (id) =>
      !brief.truthChecks.some((check) => check.id === id) &&
      (id !== OBJECTIVE.id || brief.objective === undefined),
  );
  if (unknown.length > 0) {
    throw new Error(`--admit names ${unknown.join(", ")}, and the check program holds no such check`);
  }
  const reading = await readChecker({
    verify: campaign.verify,
    brief,
    contract,
    tasks,
    controls: packControls(bundle),
    found: toolOnPath(bundle),
    width: Number(values.jobs),
    probes: false,
  });
  const despite = values.despite?.trim() ?? "";
  const { faults, frozen } = keepReading(log, checker, reading, {
    admitted,
    authored: values["admit-authored"],
    freeze: values.freeze,
    despite,
  });
  const { runs, checks, idle, unformed, rejected } = reading;
  console.log(`${String(runs.length)} controls twice`);
  if (unformed === null) {
    console.log(
      `the do-nothing answer ${capturedJsonStringify(idle)}: rejected on ${String(rejected.length - doNothingFaults(rejected).length)} of ${plural(rejected.length, "task")}`,
    );
  }
  console.log("check\tinstrument\tpassed\trefused\tcontrols refused of those naming it");
  for (const row of checks) {
    console.log(
      `${row.id}\t${row.instrument}\t${String(row.passed)}\t${String(row.refused)}\t${String(row.caught)} of ${String(row.named)}`,
    );
  }
  for (const fault of faults) console.log(`fault: ${fault}`);
  for (const note of reading.notes) console.log(`note: ${note}`);
  console.log(faults.length === 0 ? "no fault" : `${String(faults.length)} faults`);
  if (values.freeze && !frozen) {
    console.log(
      "not frozen: the reading holds a fault. It is yours to freeze all the same: say why with --despite",
    );
    return 1;
  }
  if (frozen) {
    console.log(
      `frozen${faults.length > 0 ? ` despite ${plural(faults.length, "fault")}` : ""}: contract ${checker.contract}, check program ${checker.checks}`,
    );
    return 0;
  }
  return faults.length === 0 ? 0 : 1;
}

if (import.meta.main) runtimeProcess.exitCode = await acceptCommand(Bun.argv.slice(2));
