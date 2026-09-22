/**
 * Which tools the Harness Builder actually used to construct the Built Harness.
 *
 * Three evidence files describe a workshop-capable epoch. `builder-session.json`
 * names the session's tool list: isolated path capabilities and research tools, taken from
 * the declaration table rather than grouped by the caller. `builder-path-record.jsonl`
 * carries one append-only row per isolated access: capability, decision, reason, OS enforcement,
 * bytes. `verifier-workshop.jsonl` records each download or workshop action as completed,
 * failed, or non-result, with request, result, policy and subject digests. Together they
 * compare available tools with recorded use for the Builder, as tools/outcome already does
 * for the solve side.
 *
 * Coverage limits are stated in the output too. A research tool that does not access a path
 * (`context`, `web_search`) and `submit` leave no path row; `unobserved` keeps that silence from
 * reading as evidence that they were never called.
 *
 * `builder-execution.json` covers calls those three files cannot see. The path record missed native
 * Read/Edit/Bash calls, so the census could report a Builder that touched almost nothing while it
 * worked for 43 minutes. The execution evidence carries the turn tally the transport already
 * completed, making native calls visible here. `builder-failed-calls.ts` displays the same
 * records' failure rows and unfinished turn beside the counts.
 *
 * Read-only and intended for the operator. Like the metrics reader, it makes no run decision.
 */
import { existsSync, readdirSync, statSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { ITERATION_FILE } from "../../src/builder/campaign-iterations.ts";
import {
  type AuthoringAttemptEvidence,
  type AuthoringSessionQuality,
  readAuthoringAttemptEvidence,
} from "../../src/author/build-attempt-evidence.ts";
import {
  type BuilderExecutionEvidence,
  semanticFindingsIdentity,
} from "../../src/author/builder-execution.ts";
import { campaignEpochOrder } from "../../src/author/campaign-epoch.ts";
import { type PathRecordRow, readPathRecordRows } from "../../src/builder/candidate-isolation-runtime.ts";
import { BUILDER_TOOLS } from "../../src/builder/builder-tool-interface.ts";
import {
  BUILDER_SESSION_EVIDENCE_FILE,
  BUILDER_SESSION_EVIDENCE_SCHEMA,
  type BuilderSessionEvidence,
  type BuilderSessionIsolationEvidence,
} from "../../src/builder/session-evidence.ts";
import { plainRecord } from "../../src/meta/json-evidence.ts";
import { PATH_RECORD_FILE } from "../../src/builder/path-record.ts";
import { readExecutionEvidenceDetails } from "./builder-execution-facts.ts";
import { type BuilderFailureCensus, builderFailureCensus } from "./builder-failed-calls.ts";
import {
  foldWorkshopActions,
  WORKSHOP_ACTION_FILE,
  type WorkshopActionCensus,
} from "./builder-workshop-facts.ts";
import { isNumber, isString, type JsonValue } from "../../src/meta/json-shape.ts";
import { readJsonFile } from "../../src/meta/completed-json.ts";

export type { WorkshopActionCensus } from "./builder-workshop-facts.ts";
export type { BuilderFailureCensus, BuilderFailureSession } from "./builder-failed-calls.ts";
export { builderToolFindings } from "./usage-reader.ts";

const BUILDER_TOOLS_SCHEMA = "builder-tools/v7";

/** Tools that execute without touching a path, so the path record cannot see them. */
const UNOBSERVED_BY_PATH_RECORD = ["context", "web_search", "submit"] as const;

interface CapabilityUse {
  allowed: number;
  denied: number;
  /** Bytes over the rows that reported them; null when no row did. */
  bytes: number | null;
  /** Distinct refusal reasons, so a denial pattern is visible without opening the record. */
  reasons: string[];
}

export interface EpochToolCensus {
  epoch: string;
  /** Configured tool list, or null when no usable session evidence was read. */
  composed: {
    isolated: string[];
    research: string[];
    isolations: BuilderSessionIsolationEvidence[];
    /** Exact final roster when recorded; older mount evidence is deliberately partial. */
    contract: { backend: string; backendExposed: string[] } | null;
  } | null;
  record: {
    rows: number;
    allowed: number;
    denied: number;
    /** First successful primary workspace read, in record order; null is absence, not success. */
    firstAllowedRead: { seq: number; requested: string; resolved: string | null } | null;
    byCapability: Record<string, CapabilityUse>;
    /** Every policy the rows were guarded under. */
    policyDigests: string[];
    sessions: string[];
  } | null;
  workshop: WorkshopActionCensus | null;
  /** Composed path capabilities with no recorded use. Null when there is no path record. */
  neverUsed: string[] | null;
  /** Capabilities the record names that the evidence never composed. */
  undeclared: string[];
  unobserved: readonly string[];
  /** One execution row per authoring session, including native calls no path row sees. */
  execution: BuilderExecutionEvidence[];
  /** Original on-disk session numbers aligned with `execution`; absent in hand-built fixtures. */
  executionSessions?: number[];
  /** Recognised execution files that could not be safely normalized. */
  executionUnavailable?: string[];
  /** The same records read for their failed calls and in-flight turn, latest work first. */
  failures: BuilderFailureCensus;
  authoring: {
    iterations: Array<{
      ordinal: number;
      dir: string;
      outcome: string;
      focusOwner: string | null;
      repairOwner: string | null;
      findingsHash: string | null;
      /** Detail-free hash over recorded feedback; null when the iteration carries no findings. */
      semanticFindingsHash: string | null;
      workspaceCommit: string | null;
      sessions: AuthoringSessionQuality[];
      /** iteration.json's write time; absent on an in-memory fixture, never on a disk read. */
      mtimeMs?: number;
    }>;
    nonResults: AuthoringAttemptEvidence[];
  };
}

export interface BuilderToolsReport {
  schema: typeof BUILDER_TOOLS_SCHEMA;
  campaign: string;
  epochs: EpochToolCensus[];
  /** Campaign-wide custom calls; null means no execution record, not zero use. */
  customToolCalls: BuilderCustomToolCensus | null;
}

interface BuilderCustomToolUse {
  calls: number;
  failed: number;
  /** Sessions in which the Builder called this tool at least once. */
  sessionsCalled: number;
  /** Sessions where a final interface contract, partial mount, or the call itself proves exposure. */
  sessionsExposed: number;
  /** Sessions where legacy/partial composition cannot settle whether this name was exposed. */
  sessionsExposureUnknown: number;
}

interface BuilderCustomToolCensus {
  sessions: number;
  calls: number;
  failed: number;
  byName: Record<string, BuilderCustomToolUse>; // descending calls, then name
  neverCalled: string[];
  intent: {
    recorded: number;
    omitted: number;
    aggregateCallsWithoutReceipt: number; // normally legacy evidence
    byToolAction: Record<string, Record<string, number>>;
  };
}

interface NormalizedSessionEvidence {
  isolated: Record<string, readonly string[]>;
  research: string[];
  isolations: BuilderSessionIsolationEvidence[];
  contract: { backend: string; backendExposed: string[] } | null;
}

interface CustomCensusState {
  uses: Map<string, BuilderCustomToolUse>;
  actions: Map<string, Map<string, number>>;
  allCustom: ReadonlySet<string>;
  intentRecorded: number;
  intentOmitted: number;
}

interface ExecutionRoster {
  exact: ReadonlySet<string> | null;
  possible: ReadonlySet<string>;
  partial: ReadonlySet<string>;
}

function readSessionEvidence(epochDir: string): NormalizedSessionEvidence | null {
  const path = join(epochDir, BUILDER_SESSION_EVIDENCE_FILE);
  if (!existsSync(path)) return null;
  const parsed: unknown = readJsonFile(path);
  const record = plainRecord(parsed);
  if (record === null) return null;
  if (record.schema !== BUILDER_SESSION_EVIDENCE_SCHEMA) return null;
  const evidence =
    /* SAFETY: the schema check above accepted only the current builder-session-evidence record, which carries the four fields read here. */ parsed as BuilderSessionEvidence;
  return {
    isolated: evidence.isolated,
    research: evidence.research,
    isolations: evidence.isolations,
    // The roster is reconciled when the contract is there to say so, whatever the record is called.
    contract:
      evidence.contract === undefined
        ? null
        : { backend: evidence.contract.backend, backendExposed: [...evidence.contract.backendExposed] },
  };
}

function foldRecord(rows: readonly PathRecordRow[]): NonNullable<EpochToolCensus["record"]> {
  const byCapability: Record<string, CapabilityUse> = {};
  const policyDigests = new Set<string>();
  const sessions = new Set<string>();
  let allowed = 0;
  let denied = 0;
  for (const row of rows) {
    policyDigests.add(row.policyDigest);
    sessions.add(row.sessionId);
    let use = byCapability[row.capability];
    if (use === undefined) {
      use = { allowed: 0, denied: 0, bytes: null, reasons: [] };
      byCapability[row.capability] = use;
    }
    if (row.decision === "allow") {
      allowed += 1;
      use.allowed += 1;
    } else {
      denied += 1;
      use.denied += 1;
    }
    if (row.bytes !== null) use.bytes = (use.bytes ?? 0) + row.bytes;
    if (!use.reasons.includes(row.reason)) use.reasons.push(row.reason);
  }
  for (const use of Object.values(byCapability)) use.reasons.sort();
  // `mode` is the access kind (read/write/exec); `capability` holds the tool name
  // ("public_source", "verifier_workshop"), so keying on capability === "read" matched no row
  // ever and firstAllowedRead reported null for every run (run w12 legibility finding).
  const firstRead = [...rows]
    .sort((a, b) => a.seq - b.seq)
    .find(
      (row) =>
        row.sessionId === "builder-primary" &&
        row.mode === "read" &&
        row.decision === "allow" &&
        row.enforcement === "os-allowed",
    );
  return {
    rows: rows.length,
    allowed,
    denied,
    firstAllowedRead:
      firstRead === undefined
        ? null
        : { seq: firstRead.seq, requested: firstRead.requested, resolved: firstRead.resolved },
    byCapability,
    policyDigests: [...policyDigests].sort(),
    sessions: [...sessions].sort(),
  };
}

function numberRecord(value: JsonValue | undefined): Record<string, number> | null {
  const row = plainRecord(value);
  if (row === null) return null;
  const entries = Object.entries(row);
  if (!entries.every(([, count]) => isNumber(count))) return null;
  return /* SAFETY: the check above returned unless every entry value is a number. */ Object.fromEntries(
    entries,
  ) as Record<string, number>;
}

/** Derived, never recorded: the detail-free repeat hash over the iteration's recorded feedback rows,
 *  so the repeat census sees through a reworded — or merely re-executed — detail string.
 *  iteration.json already records the feedback bytes, so the reader derives this view instead of the
 *  writer recording a second hash, which also covers evidence recorded before the census existed.
 *
 *  The rule itself belongs to the controller (`semanticFindingsIdentity`), which now records its
 *  stall hash with it. Two owners deriving one identity separately is how a census can call a
 *  round a repeat while the loop calls it progress. Null when the row carries no feedback with
 *  findings (a fingerprinted iteration). */
function semanticFindingsHash(feedback: JsonValue | undefined, stage: string | null): string | null {
  if (!Array.isArray(feedback)) return null;
  const gates = feedback.flatMap((entry) => {
    const row = plainRecord(entry);
    if (row === null || !isString(row.owner) || !isString(row.claim)) return [];
    const findings = (Array.isArray(row.findings) ? row.findings : []).flatMap((finding) => {
      const parsed = plainRecord(finding);
      return parsed !== null && isString(parsed.code) && isString(parsed.path)
        ? [{ code: parsed.code, path: parsed.path }]
        : [];
    });
    return [{ owner: row.owner, claim: row.claim, findings }];
  });
  // Deliberately more conservative than the controller: a row that names no finding at all is
  // usually a routing or success row rather than a refusal, and the census should not report a
  // repeat it cannot point at. The controller still separates two claim-only refusals, because
  // there the claim is the whole answer.
  if (gates.every((gate) => gate.findings.length === 0)) return null;
  return semanticFindingsIdentity(gates, stage);
}

function iterationAuthoring(epochDir: string): EpochToolCensus["authoring"]["iterations"] {
  return readdirSync(epochDir)
    .filter((name) => /^\d{2}-/.test(name) && statSync(join(epochDir, name)).isDirectory())
    .sort()
    .flatMap((dir) => {
      const file = join(epochDir, dir, ITERATION_FILE);
      if (!existsSync(file)) return [];
      const row = plainRecord(readJsonFile(file));
      const attempts = numberRecord(row?.attempts);
      if (row === null || !Number.isInteger(row.ordinal) || !isString(row.outcome) || attempts === null) {
        throw new Error(`${file}: not a completed authoring iteration evidence`);
      }
      const change = plainRecord(row.workspaceChange);
      const sessions: AuthoringSessionQuality[] = Object.entries(attempts).map(([stage, count]) => ({
        stage:
          /* SAFETY: `attempts` is keyed by authoring stage where the evidence is written; a foreign key reads as an unknown stage in the census and changes no decision. */ stage as AuthoringSessionQuality["stage"],
        state: row.outcome === "build-failed" && row.stage === stage ? "rejected" : "accepted",
        attempts: count,
      }));
      return [
        {
          ordinal:
            /* SAFETY: the check above threw unless `Number.isInteger(row.ordinal)`. */ row.ordinal as number,
          dir,
          outcome: row.outcome,
          focusOwner: isString(row.focusOwner) ? row.focusOwner : null,
          repairOwner: isString(row.repairOwner) ? row.repairOwner : null,
          findingsHash: isString(row.findingsHash) ? row.findingsHash : null,
          semanticFindingsHash: semanticFindingsHash(row.feedback, isString(row.stage) ? row.stage : null),
          workspaceCommit: change !== null && isString(change.commit) ? change.commit : null,
          sessions,
          mtimeMs: statSync(file).mtimeMs,
        },
      ];
    });
}

function epochCensus(campaignDir: string, epoch: string): EpochToolCensus {
  const epochDir = join(campaignDir, epoch);
  const evidence = readSessionEvidence(epochDir);
  const recordPath = join(epochDir, PATH_RECORD_FILE);
  const record = existsSync(recordPath) ? foldRecord(readPathRecordRows(recordPath)) : null;
  const workshopPath = join(epochDir, WORKSHOP_ACTION_FILE);
  const workshop = existsSync(workshopPath) ? foldWorkshopActions(workshopPath) : null;
  const composedIsolated = evidence === null ? [] : Object.keys(evidence.isolated).sort();
  const used = record === null ? [] : Object.keys(record.byCapability);
  const executionRead = readExecutionEvidenceDetails(epochDir);
  return {
    epoch,
    composed:
      evidence === null
        ? null
        : {
            isolated: composedIsolated,
            research: [...evidence.research].sort(),
            isolations: evidence.isolations,
            contract: evidence.contract,
          },
    record,
    workshop,
    neverUsed: record === null ? null : composedIsolated.filter((name) => !used.includes(name)),
    undeclared: used.filter((name) => !composedIsolated.includes(name)).sort(),
    unobserved: [...new Set([...UNOBSERVED_BY_PATH_RECORD, ...(evidence?.research ?? [])])].sort(),
    execution: executionRead.records,
    executionSessions: executionRead.sessions,
    executionUnavailable: executionRead.unavailable,
    failures: builderFailureCensus(executionRead.records, executionRead.sessions),
    authoring: {
      iterations: iterationAuthoring(epochDir),
      nonResults: readAuthoringAttemptEvidence(epochDir),
    },
  };
}

export function bareBuilderToolName(name: string): string {
  return name.startsWith("mcp__harness__") ? name.slice("mcp__harness__".length) : name;
}

function customToolUse(uses: Map<string, BuilderCustomToolUse>, name: string): BuilderCustomToolUse {
  const use = uses.get(name) ?? {
    calls: 0,
    failed: 0,
    sessionsCalled: 0,
    sessionsExposed: 0,
    sessionsExposureUnknown: 0,
  };
  uses.set(name, use);
  return use;
}

function orderedActions(actions: Map<string, Map<string, number>>): Record<string, Record<string, number>> {
  return Object.fromEntries(
    [...actions]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([tool, rows]) => [
        tool,
        Object.fromEntries([...rows].sort(([left], [right]) => left.localeCompare(right))),
      ]),
  );
}

function executionRoster(
  epoch: EpochToolCensus,
  execution: BuilderExecutionEvidence,
  allCustom: ReadonlySet<string>,
): ExecutionRoster {
  const contract = epoch.composed?.contract ?? null;
  const exact =
    contract !== null && (execution.backend === null || execution.backend === contract.backend)
      ? new Set(contract.backendExposed)
      : null;
  return {
    exact,
    // The recorded final contract owns historical names. Using today's catalogue first made the
    // harness_preview → harness_inspect rename erase old calls from otherwise exact v4 records.
    possible: exact ?? allCustom,
    partial: new Set([...(epoch.composed?.isolated ?? []), ...(epoch.composed?.research ?? [])]),
  };
}

function foldCustomIntents(
  execution: BuilderExecutionEvidence,
  possible: ReadonlySet<string>,
  state: CustomCensusState,
): void {
  state.intentOmitted += execution.customCallsOmitted;
  for (const call of execution.customCalls) {
    if (!possible.has(call.tool)) continue;
    state.intentRecorded += 1;
    const byAction = state.actions.get(call.tool) ?? new Map<string, number>();
    byAction.set(call.action, (byAction.get(call.action) ?? 0) + 1);
    state.actions.set(call.tool, byAction);
  }
}

function foldAggregateCalls(
  execution: BuilderExecutionEvidence,
  possible: ReadonlySet<string>,
  uses: Map<string, BuilderCustomToolUse>,
): Set<string> {
  const called = new Set<string>();
  for (const [rawName, count] of Object.entries(execution.toolCalls.byName)) {
    const name = bareBuilderToolName(rawName);
    if (!possible.has(name)) continue;
    customToolUse(uses, name).calls += count;
    called.add(name);
  }
  return called;
}

function foldFailedCalls(
  execution: BuilderExecutionEvidence,
  possible: ReadonlySet<string>,
  uses: Map<string, BuilderCustomToolUse>,
): void {
  // Early v1 calls remain observable although their absent per-name failure split contributes nothing.
  for (const [rawName, count] of Object.entries(execution.failedByName)) {
    const name = bareBuilderToolName(rawName);
    if (possible.has(name)) customToolUse(uses, name).failed += count;
  }
}

function foldExposure(
  roster: ExecutionRoster,
  called: ReadonlySet<string>,
  uses: Map<string, BuilderCustomToolUse>,
): void {
  for (const name of roster.possible) {
    const use = customToolUse(uses, name);
    if (called.has(name)) use.sessionsCalled += 1;
    if (called.has(name) || roster.exact?.has(name) === true || roster.partial.has(name)) {
      use.sessionsExposed += 1;
    } else if (roster.exact === null) use.sessionsExposureUnknown += 1;
  }
}

function foldCustomExecution(
  epoch: EpochToolCensus,
  execution: BuilderExecutionEvidence,
  state: CustomCensusState,
): void {
  const roster = executionRoster(epoch, execution, state.allCustom);
  foldCustomIntents(execution, roster.possible, state);
  const called = foldAggregateCalls(execution, roster.possible, state.uses);
  foldFailedCalls(execution, roster.possible, state.uses);
  foldExposure(roster, called, state.uses);
}

export function builderCustomToolCensus(epochs: readonly EpochToolCensus[]): BuilderCustomToolCensus | null {
  const executions = epochs.flatMap((epoch) => epoch.execution);
  if (executions.length === 0) return null;
  const state: CustomCensusState = {
    uses: new Map(),
    actions: new Map(),
    allCustom: new Set(BUILDER_TOOLS),
    intentRecorded: 0,
    intentOmitted: 0,
  };
  for (const epoch of epochs) {
    for (const execution of epoch.execution) foldCustomExecution(epoch, execution, state);
  }
  const ordered = [...state.uses.entries()].sort(
    ([leftName, left], [rightName, right]) => right.calls - left.calls || leftName.localeCompare(rightName),
  );
  const calls = ordered.reduce((sum, [, use]) => sum + use.calls, 0);
  return {
    sessions: executions.length,
    calls,
    failed: ordered.reduce((sum, [, use]) => sum + use.failed, 0),
    byName: Object.fromEntries(ordered),
    neverCalled: ordered
      .filter(([, use]) => use.calls === 0 && use.sessionsExposed > 0)
      .map(([name]) => name)
      .sort(),
    intent: {
      recorded: state.intentRecorded,
      omitted: state.intentOmitted,
      aggregateCallsWithoutReceipt: Math.max(0, calls - state.intentRecorded - state.intentOmitted),
      byToolAction: orderedActions(state.actions),
    },
  };
}

/** Every epoch in controller order; an empty epoch remains a fact rather than disappearing. */
export function builderToolsReport(campaignDir: string): BuilderToolsReport {
  const unlisted = new Set(
    existsSync(campaignDir)
      ? readdirSync(campaignDir)
          .filter((name) => name.startsWith("epoch-") && statSync(join(campaignDir, name)).isDirectory())
          .sort()
      : [],
  );
  // Controller order first, then whatever the directory holds that the order did not name.
  const ordered: string[] = [];
  for (const name of campaignEpochOrder(campaignDir)) if (unlisted.delete(name)) ordered.push(name);
  const epochs = [...ordered, ...unlisted];
  const epochReports = epochs.map((epoch) => epochCensus(campaignDir, epoch));
  return {
    schema: BUILDER_TOOLS_SCHEMA,
    campaign: campaignDir,
    epochs: epochReports,
    customToolCalls: builderCustomToolCensus(epochReports),
  };
}
