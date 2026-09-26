#!/usr/bin/env bun

import { exitWith, parseCommandOrDie } from "#skills/main/cli.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import {
  type JsonObject,
  type JsonValue,
  asRecord,
  isBoolean,
  isNumber,
  isString,
} from "#src/meta/json-shape.ts";

const SCHEMA = "monitor-watch-contract/v1";
const ID = /^[a-z0-9][a-z0-9_-]*$/;
const CLOSURE_STATUSES: ReadonlySet<string> = new Set(["open", "closed", "held", "superseded"]);
const CLAIM_STATUSES: ReadonlySet<string> = new Set(["unverified", "verified", "rejected", "withdrawn"]);
const INTERVENTION_STATUSES: ReadonlySet<string> = new Set(["sent", "acknowledged", "verified", "rejected"]);
const INTERVENTION_KINDS: ReadonlySet<string> = new Set(["CHECK", "DIRECT"]);
const TERMINAL_TURN_STATES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "cancelled",
  "canceled",
  "interrupted",
  "aborted",
]);

type LedgerName = "closures" | "claims" | "interventions";
const LEDGERS: readonly (readonly [LedgerName, ReadonlySet<string>])[] = [
  ["closures", CLOSURE_STATUSES],
  ["claims", CLAIM_STATUSES],
  ["interventions", INTERVENTION_STATUSES],
];

/** The fields of a `thread-state.ts summary --json` output that the watch decision reads. */
type ThreadState = {
  threadId: string;
  hostId: JsonValue | undefined;
  threadStatus: JsonValue | undefined;
  turnStatus: JsonValue | undefined;
};
/** One validated closure, claim or intervention; `material` is false outside the claims ledger. */
type LedgerEntry = { id: LedgerId; status: string; material: boolean };
/** A ledger id. `RegExp.test` stringifies its argument, so a number or boolean spelling a valid id
 *  has always passed as one and been reported as written. */
type LedgerId = string | number | boolean;
type Ledgers = Record<LedgerName, LedgerEntry[]>;
/** A validated watch contract: its target as written, and its three ledgers. */
export type WatchContract = Ledgers & { target: JsonObject; threadId: string; hostId: string | null };
export type WatchTemplate = {
  schema: string;
  target: { threadId: string; hostId: JsonValue };
  objective: string;
  closures: { id: string; text: string; status: string; evidence: string[] }[];
  claims: never[];
  interventions: never[];
};
export type WatchDecision = { code: string; reason: string; ids: LedgerId[] };
export type WatchReport = {
  schema: string;
  target: JsonObject;
  state: { threadStatus: JsonValue | undefined; turnStatus: JsonValue };
  decision: WatchDecision;
  counts: { openClosures: number; materialUnverifiedClaims: number; pendingInterventions: number };
};

function usage(): never {
  console.error(
    [
      "Usage:",
      "  watch-contract.ts init <thread-state.json|->",
      "  watch-contract.ts check <thread-state.json|-> <watch-contract.json>",
      "",
      "Input is the JSON output of thread-state.ts summary --json.",
    ].join("\n") + "\n",
  );
  return runtimeProcess.exit(0);
}

/** A JSON file, or stdin for `-`: the thread-state summary is usually piped in. */
async function readJson(path: string): Promise<JsonValue> {
  return path === "-" ? capturedJsonParse(await Bun.stdin.text()) : readJsonFile(path);
}

function requireState(state: unknown): ThreadState {
  const record = asRecord(state);
  const thread = asRecord(record?.thread);
  const threadId = thread?.id;
  if (record === null || thread === null || !isString(threadId)) {
    throw new Error("Thread state must come from thread-state.ts summary --json");
  }
  return {
    threadId,
    hostId: thread.hostId,
    threadStatus: thread.status,
    turnStatus: asRecord(record.latestTurn)?.status,
  };
}

function buildTemplate(state: unknown): WatchTemplate {
  const thread = requireState(state);
  return {
    schema: SCHEMA,
    target: {
      threadId: thread.threadId,
      hostId: thread.hostId ?? null,
    },
    objective: "REPLACE_WITH_EXACT_USER_OBJECTIVE",
    closures: [
      {
        id: "objective_terminal",
        text: "REPLACE_WITH_ONE_REQUIRED_COMPLETION_CLAUSE",
        status: "open",
        evidence: [],
      },
    ],
    claims: [],
    interventions: [],
  };
}

function requireText(value: JsonValue | undefined, label: string): void {
  if (!isString(value) || value.trim() === "" || value.startsWith("REPLACE_")) {
    throw new Error(`${label} must be filled with exact task text`);
  }
}

/** A ledger id as an error message prints it. */
function shownId(value: JsonValue | undefined): string {
  if (value === undefined) return "undefined";
  return isString(value) ? value : JSON.stringify(value);
}

function validateEntry(
  ledger: LedgerName,
  statuses: ReadonlySet<string>,
  raw: JsonValue,
  seen: Set<LedgerId>,
): LedgerEntry {
  const entry = asRecord(raw);
  const id = entry?.id;
  if (
    entry === null ||
    !(isString(id) || isNumber(id) || isBoolean(id)) ||
    !ID.test(String(id)) ||
    seen.has(id)
  ) {
    throw new Error(`Every ledger id must be unique lowercase underscore text: ${shownId(id)}`);
  }
  seen.add(id);
  requireText(entry.text, `${ledger}.${id}.text`);
  const { status, evidence } = entry;
  if (!isString(status) || !statuses.has(status)) throw new Error(`Invalid ${ledger}.${id}.status`);
  if (!Array.isArray(evidence) || evidence.some((value) => !isString(value))) {
    throw new Error(`${ledger}.${id}.evidence must be an array of receipt strings`);
  }
  if (ledger === "claims" && !isBoolean(entry.material)) {
    throw new Error(`claims.${id}.material must be boolean`);
  }
  if (ledger === "interventions" && !(isString(entry.kind) && INTERVENTION_KINDS.has(entry.kind))) {
    throw new Error(`interventions.${id}.kind must be CHECK or DIRECT`);
  }
  const settled = !["open", "unverified", "sent"].includes(status);
  if (settled && evidence.length === 0) {
    throw new Error(`${ledger}.${id} cannot be ${status} without evidence`);
  }
  return { id, status, material: ledger === "claims" && entry.material === true };
}

function validateEntries(contract: JsonObject): Ledgers {
  const seen = new Set<LedgerId>();
  const ledgers: Ledgers = { closures: [], claims: [], interventions: [] };
  for (const [ledger, statuses] of LEDGERS) {
    const entries = contract[ledger];
    if (!Array.isArray(entries)) throw new Error(`${ledger} must be an array`);
    for (const entry of entries) ledgers[ledger].push(validateEntry(ledger, statuses, entry, seen));
  }
  return ledgers;
}

function validateContract(contract: unknown): WatchContract {
  const record = asRecord(contract);
  if (record?.schema !== SCHEMA) throw new Error(`schema must be ${SCHEMA}`);
  const target = asRecord(record.target);
  const threadId = target?.threadId;
  if (target === null || !isString(threadId)) throw new Error("target.threadId is required");
  const { hostId } = target;
  if (hostId !== null && !isString(hostId)) {
    throw new Error("target.hostId must be a string or null");
  }
  requireText(record.objective, "objective");
  const ledgers = validateEntries(record);
  if (ledgers.closures.length === 0) throw new Error("closures must name at least one terminal clause");
  return { ...ledgers, target, threadId, hostId: hostId ?? null };
}

function decision(code: string, reason: string, ids: LedgerId[] = []): WatchDecision {
  return { code, reason, ids };
}

function pendingInterventions(contract: WatchContract): LedgerEntry[] {
  return contract.interventions.filter((entry) => ["sent", "acknowledged"].includes(entry.status));
}

function materialUnverifiedClaims(contract: WatchContract): LedgerEntry[] {
  return contract.claims.filter((entry) => entry.material && entry.status === "unverified");
}

function openClosures(contract: WatchContract): LedgerEntry[] {
  return contract.closures.filter((entry) => entry.status === "open");
}

function decideOn(state: ThreadState, contract: WatchContract): WatchDecision {
  if (
    state.threadId !== contract.threadId ||
    (contract.hostId !== null && state.hostId !== contract.hostId)
  ) {
    return decision("DIRECT_IDENTITY_MISMATCH", "Thread state does not match the watch contract target.");
  }

  const pending = pendingInterventions(contract);
  if (pending.length > 0) {
    return decision(
      "VERIFY_INTERVENTION",
      "A sent or acknowledged intervention has no proved disposition.",
      pending.map((entry) => entry.id),
    );
  }

  const active = state.threadStatus === "active" || state.turnStatus === "inProgress";
  const open = openClosures(contract);
  if (!active && open.length > 0) {
    return decision(
      "DIRECT_COMMITMENT_LIVENESS",
      "The target stopped while required completion clauses remain open.",
      open.map((entry) => entry.id),
    );
  }

  const materialClaims = materialUnverifiedClaims(contract);
  if (materialClaims.length > 0) {
    return decision(
      "CHECK_MATERIAL_CLAIMS",
      "Material positive claims still lack deciding receipts.",
      materialClaims.map((entry) => entry.id),
    );
  }

  if (active) return decision("CONTINUE", "The target remains active and no intervention is due.");

  const { turnStatus } = state;
  if (!(isString(turnStatus) && TERMINAL_TURN_STATES.has(turnStatus))) {
    return decision("INSPECT_STATE", "The target is not active, but its latest turn is not terminal.");
  }
  return decision("STOP_ELIGIBLE", "All declared closures and interventions are settled.");
}

function decide(state: unknown, contract: unknown): WatchDecision {
  return decideOn(requireState(state), validateContract(contract));
}

function report(state: unknown, contract: unknown): WatchReport {
  const thread = requireState(state);
  const watched = validateContract(contract);
  const result = decideOn(thread, watched);
  return {
    schema: "monitor-watch-decision/v1",
    target: watched.target,
    state: {
      threadStatus: thread.threadStatus,
      turnStatus: thread.turnStatus ?? null,
    },
    decision: result,
    counts: {
      openClosures: openClosures(watched).length,
      materialUnverifiedClaims: materialUnverifiedClaims(watched).length,
      pendingInterventions: pendingInterventions(watched).length,
    },
  };
}

async function main(): Promise<void> {
  const { command, flags, positionals } = parseCommandOrDie(exitWith("watch-contract"), {
    init: { flags: ["help"], positionals: 1 },
    check: { flags: ["help"], positionals: 2 },
  });
  if (flags.has("help")) usage();
  const [statePath = "", contractPath = ""] = positionals;
  if (command === "init") {
    console.log(JSON.stringify(buildTemplate(await readJson(statePath)), null, 2));
    return;
  }
  const state = await readJson(statePath);
  const contract = await readJson(contractPath);
  console.log(JSON.stringify(report(state, contract), null, 2));
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`watch-contract: ${errorMessage(error)}`);
    runtimeProcess.exit(1);
  });
}

export { buildTemplate, decide, report, validateContract };
