import { existsSync, mkdirSync, readFileSync, readdirSync } from "../meta/filesystem.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { join } from "../meta/path.ts";
import {
  type CampaignBuilderCondition,
  type CampaignEpochEvidence,
  campaignEpochOrder,
  selectCampaignEpoch,
  writeCompleted,
} from "../author/campaign-epoch.ts";
import type { ResolvedSlots } from "../backends/resolve.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { CONTROLLER_LOCK_FILE, type LockHolderState, lockHolderState, lockToken } from "./campaign-lock.ts";
import type { FullRunArgs } from "./launch-arguments.ts";
import type { ProjectIdentity } from "./launch-project.ts";
import { assertSupportedHostRuntime, hostRuntimeIdentity } from "./host-runtime-policy.ts";
import { SOURCE_IDENTITY } from "./source-identity.ts";
import { type CampaignBudget, loadBudget } from "./campaign-budget.ts";
import {
  CAMPAIGN_OPENING_SCHEMA,
  CAMPAIGN_TERMINAL_SCHEMA,
  joinControllerBudgetEvidence,
} from "./campaign-budget-evidence.ts";
import {
  type ControllerAbortClause,
  type SavedStopClause,
  savedStopClause,
} from "./controller-stop-evidence.ts";
import { controllerAbortClause } from "./controller-abort-clause.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { isBoolean, isObject, isRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import {
  controllerEvidenceDir as evidenceDir,
  type ContinuationEvidence,
  latestRecordedContinuation,
  OPENING_FILE,
  TERMINAL_FILE,
} from "./controller-lineage.ts";
import {
  type ProviderResourceBudget,
  type ProviderResourceBudgetSnapshot,
  joinProviderResourceBudgetEvidence,
} from "./provider-resource-budget.ts";
import { controllerDenominator, type Denominator } from "./controller-denominator.ts";
import {
  controllerIterationRunId,
  missingFinalRecordOwner,
  verifyAdmittedBatteryRecords,
} from "./controller-battery-record-policy.ts";
import type { VerifierCleanup, VerifierLifetime } from "../verify/verifier-lifetime.ts";

export type { Denominator } from "./controller-denominator.ts";

export {
  type ContinuationEvidence,
  latestRecordedContinuation,
  resolveLaunchRunId,
} from "./controller-lineage.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { readJsonFile } from "../meta/completed-json.ts";

export interface ControllerRunState {
  opening: { digest: string; epoch: CampaignEpochEvidence; runId: string } | null;
  iterations: ControllerIteration[];
  /** Steps the run did not complete, such as a refused comparison or skipped review. */
  absentSteps: string[];
  /** Run-scoped mutable owner; opening and terminal record immutable snapshots. */
  providerBudget?: ProviderResourceBudget | null;
  verifierLifetime?: VerifierLifetime;
  verifierSettled?: boolean;
  /** Open the run on its base kickoff when no round has opened it yet, so the close path has an
   *  opening to record a terminal against. The loop sets it once the epoch inputs are resolved;
   *  a failure before that point still belongs to the launch, which owns its own refusals. */
  openIfUnopened?: () => void;
}

type ControllerIteration = {
  runId: string;
  terminal: string | null;
  /** Build reasons from this round, such as a repair refused before the session started. */
  buildClauses: string[];
  /** Evidence paths for a `candidate-held` terminal: the recorded promotion row. Absent for every
   * other outcome. */
  terminalEvidence?: string[];
  batteryRunIds: string[];
  /** Chronological last admission; the list remains sorted for stable evidence identity. */
  lastBatteryRunId: string | null;
};

export interface PreparedControllerTerminal {
  path: string;
  source: typeof SOURCE_IDENTITY;
  epoch: string;
  openingDigest: string;
  iterations: ControllerIteration[];
  absentSteps: string[];
  lastIteration: string | null;
  outcome: "completed" | "aborted";
  /** Typed abort owner, recorded beside the prose reason so no reader re-parses the prefix. Null
   *  only on a completed run; `writeControllerTerminal` refuses a null on an abort. */
  abortClause: ControllerAbortClause | null;
  terminalReason: string;
  denominator: Denominator;
  /** Campaign budget row at record; the run's own charge is this minus the opening snapshot. */
  budget: CampaignBudget;
  providerResourceBudget: ProviderResourceBudgetSnapshot | null;
  verifierCleanup?: VerifierCleanup;
}

export type ControllerEvidence =
  | { state: "absent" }
  | {
      state: "unfinished";
      lockHeld: boolean;
      /** The dead-process witness. `absent` and `proved-dead` say no live controller can still
       *  record this opening, which is how run 25's invocation `a` — an opening with no terminal at
       *  all — closes: the reader states the witness instead of leaving the run open forever. */
      holder: LockHolderState;
      evidence: { opening: string };
    }
  | {
      state: "recorded";
      outcome: "completed" | "aborted";
      terminalReason: string;
      /** Null exactly on a completed run. */
      abortClause: SavedStopClause["clause"];
      verifierCleanup?: VerifierCleanup;
      /** An empty list proves the opening observed none. */
      abandonedRuns: string[];
      lastIteration: string | null;
      batteryRunIds: string[];
      denominator: Denominator;
      /** The opening and terminal snapshots this run bound to each other. */
      budget: CampaignBudget;
      providerResourceBudget: {
        opening: ProviderResourceBudgetSnapshot;
        terminal: ProviderResourceBudgetSnapshot;
      } | null;
      evidence: { opening: string; terminal: string };
    };

type RawControllerOpening = {
  schema?: JsonValue;
  runId?: JsonValue;
  source?: JsonValue;
  epoch?: { key?: JsonValue };
  continuation?: JsonValue;
  abandonedRuns?: JsonValue;
  budget?: JsonValue;
  providerResourceBudget?: JsonValue;
};

type RawControllerTerminal = {
  schema?: JsonValue;
  openingDigest?: JsonValue;
  epoch?: JsonValue;
  source?: JsonValue;
  lock?: { token?: JsonValue; ownedAtRecord?: JsonValue } | null;
  iterations?: JsonValue;
  lastIteration?: JsonValue;
  denominator?: JsonValue;
  outcome?: JsonValue;
  terminalReason?: JsonValue;
  abortClause?: JsonValue;
  budget?: JsonValue;
  providerResourceBudget?: JsonValue;
  verifierCleanup?: JsonValue;
};

type ControllerTerminalIdentity = { token: string };

/** The two records whose identity must agree, each with the path it was read from, so a refusal
 *  can name the file rather than the value. */
type ControllerRunRecords = {
  readonly openingPath: string;
  readonly terminalPath: string;
  readonly opening: RawControllerOpening;
  readonly terminal: RawControllerTerminal;
};

/** Sibling controller runs of this campaign that wrote an opening and never recorded a terminal.
 *  One bounded, throw-free walk: a damaged sibling must not crash the controller that is opening,
 *  so a directory this process cannot read answers with an empty list. Sorted for stable evidence
 *  identity. */
function abandonedSiblingRuns(campaign: string, exceptRunId: string): string[] {
  const abandoned: string[] = [];
  try {
    for (const runId of readdirSync(join(campaign, "controller"))) {
      if (runId === exceptRunId) continue;
      const dir = join(campaign, "controller", runId);
      if (existsSync(join(dir, OPENING_FILE)) && !existsSync(join(dir, TERMINAL_FILE))) abandoned.push(runId);
    }
  } catch {
    // No controller directory yet, or one this process may not walk: nothing to record.
  }
  return abandoned.sort();
}

function writeControllerOpening(input: {
  args: FullRunArgs;
  repoRoot: string;
  project: ProjectIdentity;
  runId: string;
  /** The kickoff used to identify the epoch. It differs from the text the author reads on a climb,
   *  which holds its harness bytes fixed and so stays in the epoch they were built in. The
   *  opening records the epoch, never the kickoff, so this value is used for nothing else. */
  epochKickoff: string;
  /** The reopening pass the build step binds on, when this round is one; see `epochPassOf`. */
  epochPass: string | undefined;
  builder: CampaignBuilderCondition;
  slots: ResolvedSlots;
  providerBudget?: ProviderResourceBudget;
}): NonNullable<ControllerRunState["opening"]> {
  assertSupportedHostRuntime();
  if (SOURCE_IDENTITY === null) throw new Error("controller opening requires an attributed source identity");
  const campaign = campaignDir(input.repoRoot, input.project.id);
  const dir = evidenceDir(campaign, input.runId);
  const path = join(dir, OPENING_FILE);
  if (existsSync(path)) {
    // The launch path resolves a free id first; this means a caller skipped it or raced the same id.
    throw new Error(
      `${path}: controller opening evidence already exists — run "${input.runId}" has already opened in this project`,
    );
  }
  const epoch = selectCampaignEpoch(campaign, {
    kickoff: input.epochKickoff,
    builder: input.builder,
    ...keyIfDefined("pass", input.epochPass),
  });
  const evidence = {
    schema: CAMPAIGN_OPENING_SCHEMA,
    writtenAt: new Date().toISOString(),
    runtime: hostRuntimeIdentity(),
    source: SOURCE_IDENTITY,
    project: input.project,
    runId: input.runId,
    // Derived under the held campaign lock, before this run's own evidence exists — a first
    // run records null, a continuation records the exact terminal bytes it stands on.
    continuation: latestRecordedContinuation(campaign),
    // Earlier controllers of this campaign that wrote an opening and never recorded a terminal —
    // they stopped without recording why (opus-331 had exactly one, invisible to every
    // reader that walks terminals; the fact lived in diagnostic safeguard 13 until 2026-09-01).
    // recorded here so every later reader sees the unaccounted siblings beside the continuation.
    abandonedRuns: abandonedSiblingRuns(campaign, input.runId),
    epoch: { key: epoch.key, supersedes: epoch.supersedes },
    modelSlots: input.slots,
    // budget.json spans runs and epochs, so a later run moves the counter; the snapshot at open
    // and at record is what lets one run's own charge be read (opus 2026-08-22 recorded 1 iteration
    // against 11 campaign turns and no reader could say which run spent them).
    budget: loadBudget(campaign),
    providerResourceBudget: input.providerBudget?.snapshot() ?? null,
    command: {
      name: "fullrun",
      digest: hashJsonValue({
        ...input.args,
        prompt: null,
        contextPaths: null,
        requestDigest: input.project.requestDigest,
      }),
    },
  };
  mkdirSync(dir, { recursive: true });
  writeCompleted(path, evidence);
  return { digest: hashJsonValue(evidence), epoch, runId: input.runId };
}

export function controllerOpeningHandler(
  state: ControllerRunState,
  input: Omit<Parameters<typeof writeControllerOpening>[0], "epochKickoff" | "epochPass">,
): (epochKickoff: string, epochPass: string | undefined) => void {
  return (epochKickoff, epochPass) => {
    state.opening = writeControllerOpening({ ...input, epochKickoff, epochPass });
  };
}

/** Snapshot the exact iteration and denominator set while this controller still owns the lock. */
export function prepareControllerTerminal(input: {
  repoRoot: string;
  projectId: string;
  opening: NonNullable<ControllerRunState["opening"]>;
  iterations: readonly ControllerIteration[];
  absentSteps: readonly string[];
  failure: unknown;
  providerBudget?: ProviderResourceBudget;
  verifierCleanup?: VerifierCleanup;
}): PreparedControllerTerminal {
  const campaign = campaignDir(input.repoRoot, input.projectId);
  const iterations = input.iterations.map((iteration) => ({
    ...iteration,
    batteryRunIds: [...iteration.batteryRunIds].sort(),
  }));
  const last = iterations.at(-1) ?? null;
  const path = join(evidenceDir(campaign, input.opening.runId), TERMINAL_FILE);
  if (existsSync(path)) throw new Error(`${path}: controller terminal evidence already exists`);
  const outcome = input.failure === null ? "completed" : "aborted";
  // A provider refusal during a Builder turn (429, session limit, timeout) belongs to the
  // environment. The pr179 run recorded only `aborted`, forcing the review to infer the owner
  // from the transcript. The typed clause records that owner. By operator decision on
  // 2026-08-11, `environment-blocked` belongs in the terminal while outcome remains
  // completed/aborted. The shared classifier in controller-abort-clause.ts supplies a clause for
  // every abort, including unclassified ones.
  //
  // The reason leads with that clause and nothing else. It used to lead with `aborted: `, which
  // repeated the `outcome` field beside it and cost every reader the code: `loopTerminalCode`
  // takes the head before the first colon, so 45 of the 60 terminals recorded up to 2026-09-18
  // resolved to null, including all 25 environment-blocked and both budget-limited endings, and
  // whole-run-investigation's digest printed `aborted` for each of them. Two clauses are
  // themselves terminal codes; leading with the clause is what makes them readable.
  const abortClause = outcome === "aborted" ? controllerAbortClause(input.failure) : null;
  const abortReason = errorMessage(input.failure);
  return {
    path,
    source: SOURCE_IDENTITY,
    epoch: input.opening.epoch.key,
    openingDigest: input.opening.digest,
    iterations,
    absentSteps: [...input.absentSteps],
    lastIteration: last?.runId ?? null,
    outcome,
    abortClause,
    terminalReason:
      outcome === "completed" ? (last?.terminal ?? "completed") : `${abortClause}: ${abortReason}`,
    denominator: controllerDenominator(
      campaign,
      iterations.flatMap(({ batteryRunIds }) => batteryRunIds),
    ),
    budget: loadBudget(campaign),
    providerResourceBudget: input.providerBudget?.terminalSnapshot() ?? null,
    ...keyIfDefined("verifierCleanup", input.verifierCleanup),
  };
}

/** Writes the terminal and returns its recorded `writtenAt`, so the caller can close dependent
 *  records under the exact invocation it just recorded instead of re-scanning controller state. */
export function writeControllerTerminal(
  prepared: PreparedControllerTerminal,
  lock: { token: string; ownedAtRecord: boolean },
): string {
  if (existsSync(prepared.path)) {
    throw new Error(`${prepared.path}: controller terminal evidence already exists`);
  }
  // Record a typed owner now; a later reader cannot reliably derive one from a prose reason.
  // The classifier always returns a clause, so a null means the caller bypassed it.
  if (prepared.outcome === "aborted" && prepared.abortClause === null) {
    throw new Error(`${prepared.path}: an aborted controller terminal must record a typed abort clause`);
  }
  const writtenAt = new Date().toISOString();
  writeCompleted(prepared.path, {
    schema: CAMPAIGN_TERMINAL_SCHEMA,
    writtenAt,
    source: prepared.source,
    epoch: prepared.epoch,
    openingDigest: prepared.openingDigest,
    iterations: prepared.iterations,
    absentSteps: prepared.absentSteps,
    lastIteration: prepared.lastIteration,
    outcome: prepared.outcome,
    abortClause: prepared.abortClause,
    terminalReason: prepared.terminalReason,
    lock,
    denominator: prepared.denominator,
    budget: prepared.budget,
    providerResourceBudget: prepared.providerResourceBudget,
    ...keyIfDefined("verifierCleanup", prepared.verifierCleanup),
  });
  return writtenAt;
}

function readVerifierCleanup(value: JsonValue | undefined): VerifierCleanup | undefined {
  if (value === undefined) return undefined;
  if (isRecord(value)) {
    if (value.state === "complete" && value.receiptIds === undefined) return { state: "complete" };
    if (
      value.state === "pending" &&
      Array.isArray(value.receiptIds) &&
      value.receiptIds.length > 0 &&
      value.receiptIds.every((id) => isString(id) && id.startsWith("/"))
    ) {
      return { state: "pending", receiptIds: value.receiptIds.filter(isString) };
    }
  }
  throw new Error("terminal verifierCleanup is malformed");
}

function sourceIdentityIsValid(value: JsonValue | undefined): boolean {
  if (!isRecord(value)) return false;
  const source = value;
  return (
    isString(source.commit) &&
    /^[0-9a-f]{40}$/.test(source.commit) &&
    isBoolean(source.dirty) &&
    isString(source.sourceDigest) &&
    /^[0-9a-f]{64}$/.test(source.sourceDigest)
  );
}

function epochIsMember(campaign: string, key: JsonValue): boolean {
  if (!isString(key) || !/^epoch-[0-9a-f]{12}$/.test(key)) return false;
  try {
    return campaignEpochOrder(campaign).includes(key);
  } catch {
    return false;
  }
}

function readAbandonedRuns(openingPath: string, selector: string, value: JsonValue | undefined): string[] {
  const runIds = Array.isArray(value) ? value.filter(isString) : [];
  if (
    !Array.isArray(value) ||
    runIds.length !== value.length ||
    runIds.some((runId) => runId === "" || runId === selector)
  ) {
    throw new Error(`${openingPath}: abandonedRuns must name other controller runs`);
  }
  // Strictly ascending proves sorted and unique in one pass; the empty id was refused above.
  if (runIds.some((runId, index) => index > 0 && (runIds[index - 1] ?? "") >= runId)) {
    throw new Error(`${openingPath}: abandonedRuns must be sorted and unique`);
  }
  return runIds;
}

/** The row's own fields, before the battery ids are checked against its run. The declared
 *  partial is read only where this predicate proves the kind. */
function iterationRowWellFormed(
  entry: JsonValue,
  row: Partial<ControllerIteration>,
  index: number,
  selector: string,
): row is Partial<ControllerIteration> &
  Pick<ControllerIteration, "runId" | "terminal" | "buildClauses" | "batteryRunIds" | "lastBatteryRunId"> {
  return !(
    !isObject(entry) ||
    !isString(row.runId) ||
    row.runId !== controllerIterationRunId(selector, index + 1) ||
    (row.terminal !== null && !isString(row.terminal)) ||
    !Array.isArray(row.buildClauses) ||
    row.buildClauses.some((clause) => !isString(clause)) ||
    !Array.isArray(row.batteryRunIds) ||
    row.batteryRunIds.some((runId) => !isString(runId) || runId === "") ||
    (row.lastBatteryRunId !== null && !isString(row.lastBatteryRunId))
  );
}

function readIterations(terminalPath: string, selector: string, value: JsonValue): ControllerIteration[] {
  if (!Array.isArray(value)) throw new Error(`${terminalPath}: iterations must be an array`);
  return value.map((entry: JsonValue, index: number) => {
    const row =
      /* SAFETY: every field is optional on the declared partial, and the check below refuses the entry unless each one it reads has the right kind. */ entry as Partial<ControllerIteration>;
    if (!iterationRowWellFormed(entry, row, index, selector)) {
      throw new Error(`${terminalPath}: iterations[${index}] is malformed`);
    }
    // An iteration measures one battery, under its own run id.
    const batteryRunIds = [...row.batteryRunIds];
    if (batteryRunIds.some((runId) => runId !== row.runId)) {
      throw new Error(`${terminalPath}: iterations[${index}] names a battery outside its exact run`);
    }
    if (batteryRunIds.length > 1) {
      throw new Error(`${terminalPath}: iterations[${index}] batteryRunIds must be sorted and unique`);
    }
    const lastBatteryRunId = row.lastBatteryRunId;
    if (lastBatteryRunId !== (batteryRunIds[0] ?? null)) {
      throw new Error(`${terminalPath}: iterations[${index}] last battery was not admitted`);
    }
    return {
      runId: row.runId,
      terminal: row.terminal,
      buildClauses: [...row.buildClauses],
      batteryRunIds,
      lastBatteryRunId,
    };
  });
}

/**
 * A first run records `continuation: null`. An edge must point at real terminal bytes: a
 * predecessor whose terminal was removed or rewritten after the opening is damaged evidence.
 */
function assertContinuationIntact(
  campaign: string,
  openingPath: string,
  selector: string,
  opening: { continuation?: unknown },
): void {
  if (opening.continuation === null) return;
  const edge =
    /* SAFETY: the check below refuses anything but a complete edge; null returned above. */ opening.continuation as Partial<ContinuationEvidence>;
  if (
    !isObject(edge) ||
    !isString(edge.predecessorRunId) ||
    edge.predecessorRunId === "" ||
    edge.predecessorRunId === selector ||
    !isString(edge.terminalDigest) ||
    edge.terminalDigest === ""
  ) {
    throw new Error(`${openingPath}: continuation must be null or {predecessorRunId, terminalDigest}`);
  }
  const terminalPath = join(evidenceDir(campaign, edge.predecessorRunId), TERMINAL_FILE);
  if (!existsSync(terminalPath)) {
    throw new Error(`${openingPath}: predecessor "${edge.predecessorRunId}" has no terminal evidence`);
  }
  if (hashJsonValue(readJsonFile(terminalPath)) !== edge.terminalDigest) {
    throw new Error(
      `${openingPath}: predecessor "${edge.predecessorRunId}" terminal evidence disagrees with the recorded digest`,
    );
  }
}

function openingIsForRun(campaign: string, opening: RawControllerOpening, selector: string): boolean {
  return !(
    opening?.schema !== CAMPAIGN_OPENING_SCHEMA ||
    opening.runId !== selector ||
    !sourceIdentityIsValid(opening.source) ||
    !epochIsMember(campaign, opening.epoch?.key ?? null)
  );
}

function terminalMatchesOpening(
  terminal: RawControllerTerminal,
  opening: RawControllerOpening,
): terminal is RawControllerTerminal & { lock: { token: string } } {
  return !(
    terminal?.schema !== CAMPAIGN_TERMINAL_SCHEMA ||
    terminal.openingDigest !== hashJsonValue(opening) ||
    terminal.epoch !== opening.epoch?.key ||
    hashJsonValue(terminal.source) !== hashJsonValue(opening.source) ||
    terminal.lock === undefined ||
    terminal.lock === null ||
    !isObject(terminal.lock) ||
    !isString(terminal.lock.token) ||
    terminal.lock.token === "" ||
    terminal.lock.ownedAtRecord !== true
  );
}

function assertControllerTerminalIdentity(
  campaign: string,
  selector: string,
  records: ControllerRunRecords,
): ControllerTerminalIdentity {
  const { openingPath, terminalPath, opening, terminal } = records;
  if (!openingIsForRun(campaign, opening, selector)) {
    throw new Error(`${openingPath}: not the ${CAMPAIGN_OPENING_SCHEMA} evidence for ${selector}`);
  }
  if (!terminalMatchesOpening(terminal, opening)) {
    throw new Error(`${terminalPath}: terminal identity disagrees with its opening evidence`);
  }
  return { token: terminal.lock.token };
}

/** The case rows are the authority and the terminal must agree with them. A recorded refusal
 *  (`invalid`) carries no count, so the rows answer for it. */
function terminalDenominatorAgrees(recorded: unknown, expected: Denominator): boolean {
  if (isRecord(recorded) && recorded.state === "invalid") return true;
  return hashJsonValue(recorded) === hashJsonValue(expected);
}

export function readControllerEvidence(campaign: string, selector: string): ControllerEvidence {
  const dir = evidenceDir(campaign, selector);
  const openingPath = join(dir, OPENING_FILE);
  const terminalPath = join(dir, TERMINAL_FILE);
  if (!existsSync(openingPath) && !existsSync(terminalPath)) return { state: "absent" };
  if (existsSync(openingPath) && !existsSync(terminalPath)) {
    // A killed or still-live run: opened, never recorded. The reader states the lock fact and the
    // holder witness, and draws no conclusion the witness does not carry.
    const holder = lockHolderState(join(campaign, CONTROLLER_LOCK_FILE));
    return {
      state: "unfinished",
      lockHeld: holder !== "absent",
      holder,
      evidence: { opening: join("controller", selector, OPENING_FILE) },
    };
  }
  if (!existsSync(openingPath)) {
    throw new Error(`${dir}: a terminal evidence without its opening evidence is damaged evidence`);
  }
  const opening = parseJsonAs<RawControllerOpening>(readFileSync(openingPath, "utf8"));
  const terminal = parseJsonAs<RawControllerTerminal>(readFileSync(terminalPath, "utf8"));
  const terminalIdentity = assertControllerTerminalIdentity(campaign, selector, {
    openingPath,
    terminalPath,
    opening,
    terminal,
  });
  assertContinuationIntact(campaign, openingPath, selector, opening);
  const abandonedRuns = readAbandonedRuns(openingPath, selector, opening.abandonedRuns);
  if (lockToken(join(campaign, CONTROLLER_LOCK_FILE), "<unreadable>") === terminalIdentity.token) {
    throw new Error(`${terminalPath}: controller lock from the recorded terminal remains held`);
  }
  const budget = joinControllerBudgetEvidence(openingPath, terminalPath, opening, terminal);
  const providerResourceBudget = joinProviderResourceBudgetEvidence({
    openingPath,
    terminalPath,
    opening: opening.providerResourceBudget,
    terminal: terminal.providerResourceBudget,
  });
  const iterations = readIterations(terminalPath, selector, terminal.iterations ?? null);
  const lastIteration = iterations.at(-1)?.runId ?? null;
  if (terminal.lastIteration !== lastIteration) {
    throw new Error(`${terminalPath}: lastIteration disagrees with the recorded iterations`);
  }
  // Authenticate the controller-owned abort before it can relax the battery-record join. One final
  // active battery may stay unrecorded; every earlier battery and every completed terminal is strict.
  const savedStop = savedStopClause(terminalPath, terminal, iterations.at(-1)?.terminal ?? "completed");
  const { clause: abortClause, reason: terminalReason } = savedStop;
  const batteryRunIds = iterations.flatMap((iteration) => iteration.batteryRunIds);
  if (new Set(batteryRunIds).size !== batteryRunIds.length) {
    throw new Error(`${terminalPath}: a battery run is bound to more than one iteration`);
  }
  // `denominator` answers from this run's own battery set, so a recorded pre-battery absence
  // survives a sibling run creating the campaign case record later.
  const expected = controllerDenominator(campaign, batteryRunIds);
  if (!terminalDenominatorAgrees(terminal.denominator, expected)) {
    throw new Error(`${terminalPath}: terminal denominator disagrees with the case record`);
  }
  // Both owners are joined above; wording alone cannot exempt a missing record.
  const providerCapExhausted =
    providerResourceBudget !== null &&
    providerResourceBudget.terminal.used === providerResourceBudget.terminal.cap &&
    providerResourceBudget.terminal.active === 0;
  const missingRecordOwner = missingFinalRecordOwner({
    outcome: terminal.outcome,
    abortClause,
    providerCapExhausted,
  });
  if (expected.state === "recorded") {
    verifyAdmittedBatteryRecords(campaign, terminalPath, iterations, missingRecordOwner);
  }
  return {
    state: "recorded",
    outcome: terminal.outcome === "completed" ? "completed" : "aborted",
    terminalReason,
    abortClause,
    ...keyIfDefined("verifierCleanup", readVerifierCleanup(terminal.verifierCleanup)),
    abandonedRuns,
    lastIteration,
    batteryRunIds,
    denominator: expected,
    budget,
    providerResourceBudget,
    evidence: {
      opening: join("controller", selector, OPENING_FILE),
      terminal: join("controller", selector, TERMINAL_FILE),
    },
  };
}
