/**
 * Reads a campaign's check program offline (Phase C). Every control of the drafted exam runs
 * through the checks twice, printing one row per check and the faults `src/kernel/acceptance.ts`
 * finds; author-computed checks stay faults until admitted (`--admit`, `--admit-authored`) and
 * judged objective items until `--admit-judge`. The reading lands as `checker.read`, and the
 * command exits 1 while a fault remains.
 *
 *   bun tools/eval/accept.ts --name <campaign> [--admit a,b | --admit-authored] [--admit-judge] [--freeze [--despite <why>]]
 */
import { openingOf } from "#src/campaign/opening.ts";
import {
  AUTHOR,
  JUDGE,
  authoredFaults,
  type Checker,
  doNothingFaults,
  frozenChecker,
  readChecker,
} from "#src/kernel/acceptance.ts";
import { hasJudge } from "#src/kernel/contract.ts";
import { append, read } from "#src/kernel/log.ts";
import { priceKey } from "#src/kernel/meter.ts";
import { OBJECTIVE, readBrief } from "#src/kernel/verify.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { keyIfDefined, keysIf } from "#src/meta/optional-key.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { openCampaign, PACK_OPTIONS, packNamed } from "../campaign/campaign.ts";
import { assertCrossFamily } from "../campaign/round.ts";
import { packControls, toolOnPath } from "../m0/stored-sweep.ts";

const OPTIONS = {
  ...PACK_OPTIONS,
  admit: { type: "string" },
  "admit-authored": { type: "boolean", default: false },
  "admit-judge": { type: "boolean", default: false },
  jobs: { type: "string", default: "4" },
  freeze: { type: "boolean", default: false },
  despite: { type: "string" },
} as const;

type Reading = Awaited<ReturnType<typeof readChecker>>;

/**
 * Appends `checker.read` and, when `freeze` holds and no fault remains or `despite` says why,
 * `contract.frozen`. This command and accepted drafts (`tools/eval/draft.ts`) share it, so every
 * reading has one schema.
 */
export function keepReading(
  log: string,
  checker: Checker,
  reading: Reading,
  word: {
    readonly admitted: ReadonlySet<string>;
    readonly authored: boolean;
    readonly judge: boolean;
    readonly freeze: boolean;
    readonly despite: string;
  },
): { readonly faults: readonly string[]; readonly frozen: boolean } {
  const { runs, checks, idle, unformed, rejected } = reading;
  // The caller sets `authored` for unattended campaigns (without `--hitl`) and `judge` once judging is
  // admitted, so those checks are admitted whatever the reading finds.
  const admitted = new Set([
    ...word.admitted,
    ...checks.flatMap(({ id, instrument }) =>
      (word.authored && instrument === AUTHOR) || (word.judge && instrument === JUDGE) ? [id] : [],
    ),
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
    ...keyIfDefined("notes", reading.notes.length > 0 ? [...reading.notes] : undefined),
  });
  const frozen = word.freeze && (faults.length === 0 || word.despite !== "");
  // `openCampaign` refuses a checker that departs from an earlier freeze, so a freeze here pins the
  // current checker; `despite` keeps the reason when it freezes over faults.
  if (frozen && frozenChecker(read(log)) === null) {
    append(log, "contract.frozen", {
      ...checker,
      ...keysIf(faults.length > 0, () => ({ despite: word.despite, faults: faults.length })),
      ...keyIfDefined("admitted", admitted.size > 0 ? [...admitted] : undefined),
    });
  }
  return { faults, frozen };
}

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
  const reviewer = openingOf(read(log))?.seats.reviewer;
  if (values["admit-judge"] && hasJudge(contract.objective) && reviewer != null) {
    assertCrossFamily(reviewer.model, priceKey(campaign.test.model), "--admit-judge: ");
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
    judge: values["admit-judge"],
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
