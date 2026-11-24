/**
 * Evaluates a campaign's check program offline (Phase C) and records its observed behaviour against
 * the contract and check versions under inspection.
 *
 *   bun tools/c/accept.ts --name <campaign> [--admit a,b | --admit-authored] [--admit-judge] [--freeze]
 *
 * Every control of the drafted exam is run through the campaign's checks twice. The command prints
 * one row per check: its instrument, the counts of accepted and refused answers, and how many of
 * the reject controls naming it were refused. It then lists any faults (`src/kernel/acceptance.ts`):
 * controls whose verdict disagrees with their label or varies across runs; checks never observed to
 * refuse or to accept an answer; tools named by a check that are absent from the verifier's tool
 * path; tasks on which the minimal do-nothing answer allowed by the schema is not rejected; and
 * author-computed checks, which remain faults until admitted by the operator individually
 * (`--admit a,b`) or collectively (`--admit-authored`, implied when a campaign launches without
 * `--hitl`). Objective items a judging model scores remain faults unless the operator passes
 * `--admit-judge`, which unattended launches never imply. The reading is recorded in the campaign log as `checker.read` under the contract hash
 * and check program digest, and the command exits 1 if any fault remains. If the minimal value
 * produced by the schema is itself rejected by the format, that outcome is printed as a note rather
 * than a fault because the format rejects it before any check runs.
 */
import {
  AUTHOR,
  JUDGE,
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
  "admit-judge": { type: "boolean", default: false },
  jobs: { type: "string", default: "4" },
  freeze: { type: "boolean", default: false },
  despite: { type: "string" },
} as const;

/** Checker acceptance reading produced by `readChecker`. */
type Reading = Awaited<ReturnType<typeof readChecker>>;

/**
 * Records a checker acceptance reading (`checker.read`) in the campaign log, including operator-admitted
 * checks (plus all author-computed checks when `authored` is true) and any remaining faults. When
 * `freeze` is set and either no faults remain or `despite` explains why they are accepted, writes
 * `contract.frozen`. Both this command and accepted drafts (`tools/d1b/draft.ts`) share this helper
 * so all readings follow one schema.
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
  // Unattended campaigns (without `--hitl`) implicitly admit every author-computed check, including
  // the objective, regardless of what the reading finds.
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
  // `openCampaign` rejects any checker that conflicts with an existing freeze, so freezing here
  // always pins the current checker. When freezing over faults, `despite` preserves the rationale
  // so stale pack controls do not prevent pinning a sound checker.
  if (frozen && frozenChecker(read(log)) === null) {
    append(log, "contract.frozen", {
      ...checker,
      ...keysIf(faults.length > 0, () => ({ despite: word.despite, faults: faults.length })),
      ...keyIfDefined("admitted", admitted.size > 0 ? [...admitted] : undefined),
    });
  }
  return { faults, frozen };
}

/** Runs `bun tools/c/accept.ts` to evaluate and optionally freeze a checker. Returns exit code 1 if
 *  faults remain or a requested freeze is refused. */
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
