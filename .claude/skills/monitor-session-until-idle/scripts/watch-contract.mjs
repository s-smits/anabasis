#!/usr/bin/env bun

import { resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { isBoolean, isString } from "#src/meta/json-shape.ts";

const SCHEMA = "monitor-watch-contract/v1";
const ID = /^[a-z0-9][a-z0-9_-]*$/;
const CLOSURE_STATUSES = new Set(["open", "closed", "held", "superseded"]);
const CLAIM_STATUSES = new Set(["unverified", "verified", "rejected", "withdrawn"]);
const INTERVENTION_STATUSES = new Set(["sent", "acknowledged", "verified", "rejected"]);
const INTERVENTION_KINDS = new Set(["CHECK", "DIRECT"]);
const TERMINAL_TURN_STATES = new Set([
  "completed",
  "failed",
  "cancelled",
  "canceled",
  "interrupted",
  "aborted",
]);

function usage(message) {
  if (message) console.error(`${message}\n`);
  console.error(
    [
      "Usage:",
      "  watch-contract.mjs init <thread-state.json|->",
      "  watch-contract.mjs check <thread-state.json|-> <watch-contract.json>",
      "",
      "Input is the JSON output of thread-state.mjs summary --json.",
    ].join("\n") + "\n",
  );
  runtimeProcess.exit(message ? 2 : 0);
}

async function readJson(path) {
  const raw = path === "-" ? await Bun.stdin.text() : await Bun.file(path).text();
  let value = JSON.parse(raw);
  while (isString(value)) value = JSON.parse(value);
  return value;
}

function requireState(state) {
  if (!state || typeof state !== "object" || !isString(state.thread?.id)) {
    throw new Error("Thread state must come from thread-state.mjs summary --json");
  }
  return state;
}

function buildTemplate(state) {
  requireState(state);
  return {
    schema: SCHEMA,
    target: {
      threadId: state.thread.id,
      hostId: state.thread.hostId ?? null,
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

function requireText(value, label) {
  if (!isString(value) || value.trim() === "" || value.startsWith("REPLACE_")) {
    throw new Error(`${label} must be filled with exact task text`);
  }
}

function validateEntries(contract) {
  const seen = new Set();
  for (const [ledger, statuses] of [
    ["closures", CLOSURE_STATUSES],
    ["claims", CLAIM_STATUSES],
    ["interventions", INTERVENTION_STATUSES],
  ]) {
    if (!Array.isArray(contract[ledger])) throw new Error(`${ledger} must be an array`);
    for (const entry of contract[ledger]) {
      if (!ID.test(entry?.id ?? "") || seen.has(entry.id)) {
        throw new Error(`Every ledger id must be unique lowercase underscore text: ${entry?.id}`);
      }
      seen.add(entry.id);
      requireText(entry.text, `${ledger}.${entry.id}.text`);
      if (!statuses.has(entry.status)) throw new Error(`Invalid ${ledger}.${entry.id}.status`);
      if (!Array.isArray(entry.evidence) || entry.evidence.some((value) => !isString(value))) {
        throw new Error(`${ledger}.${entry.id}.evidence must be an array of receipt strings`);
      }
      if (ledger === "claims" && !isBoolean(entry.material)) {
        throw new Error(`claims.${entry.id}.material must be boolean`);
      }
      if (ledger === "interventions" && !INTERVENTION_KINDS.has(entry.kind)) {
        throw new Error(`interventions.${entry.id}.kind must be CHECK or DIRECT`);
      }
      const settled = !["open", "unverified", "sent"].includes(entry.status);
      if (settled && entry.evidence.length === 0) {
        throw new Error(`${ledger}.${entry.id} cannot be ${entry.status} without evidence`);
      }
    }
  }
}

function validateContract(contract) {
  if (contract?.schema !== SCHEMA) throw new Error(`schema must be ${SCHEMA}`);
  if (!isString(contract.target?.threadId)) throw new Error("target.threadId is required");
  if (contract.target.hostId !== null && !isString(contract.target.hostId)) {
    throw new Error("target.hostId must be a string or null");
  }
  requireText(contract.objective, "objective");
  validateEntries(contract);
  if (contract.closures.length === 0) throw new Error("closures must name at least one terminal clause");
  return contract;
}

function decision(code, reason, ids = []) {
  return { code, reason, ids };
}

function decide(state, contract) {
  requireState(state);
  validateContract(contract);
  if (
    state.thread.id !== contract.target.threadId ||
    (contract.target.hostId !== null && state.thread.hostId !== contract.target.hostId)
  ) {
    return decision("DIRECT_IDENTITY_MISMATCH", "Thread state does not match the watch contract target.");
  }

  const pendingInterventions = contract.interventions.filter((entry) =>
    ["sent", "acknowledged"].includes(entry.status),
  );
  if (pendingInterventions.length > 0) {
    return decision(
      "VERIFY_INTERVENTION",
      "A sent or acknowledged intervention has no proved disposition.",
      pendingInterventions.map((entry) => entry.id),
    );
  }

  const active = state.thread.status === "active" || state.latestTurn?.status === "inProgress";
  const openClosures = contract.closures.filter((entry) => entry.status === "open");
  if (!active && openClosures.length > 0) {
    return decision(
      "DIRECT_COMMITMENT_LIVENESS",
      "The target stopped while required completion clauses remain open.",
      openClosures.map((entry) => entry.id),
    );
  }

  const materialClaims = contract.claims.filter((entry) => entry.material && entry.status === "unverified");
  if (materialClaims.length > 0) {
    return decision(
      "CHECK_MATERIAL_CLAIMS",
      "Material positive claims still lack deciding receipts.",
      materialClaims.map((entry) => entry.id),
    );
  }

  if (active) return decision("CONTINUE", "The target remains active and no intervention is due.");

  const turnStatus = state.latestTurn?.status;
  if (!TERMINAL_TURN_STATES.has(turnStatus)) {
    return decision("INSPECT_STATE", "The target is not active, but its latest turn is not terminal.");
  }
  return decision("STOP_ELIGIBLE", "All declared closures and interventions are settled.");
}

function report(state, contract) {
  const result = decide(state, contract);
  return {
    schema: "monitor-watch-decision/v1",
    target: contract.target,
    state: {
      threadStatus: state.thread.status,
      turnStatus: state.latestTurn?.status ?? null,
    },
    decision: result,
    counts: {
      openClosures: contract.closures.filter((entry) => entry.status === "open").length,
      materialUnverifiedClaims: contract.claims.filter(
        (entry) => entry.material && entry.status === "unverified",
      ).length,
      pendingInterventions: contract.interventions.filter((entry) =>
        ["sent", "acknowledged"].includes(entry.status),
      ).length,
    },
  };
}

async function main() {
  const args = Bun.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) usage();
  const command = args[0];
  if (command === "init" && args.length === 2) {
    console.log(JSON.stringify(buildTemplate(await readJson(args[1])), null, 2));
    return;
  }
  if (command === "check" && args.length === 3) {
    const state = await readJson(args[1]);
    const contract = await readJson(args[2]);
    console.log(JSON.stringify(report(state, contract), null, 2));
    return;
  }
  usage("Invalid command or arguments");
}

const isMain = Bun.argv[1] && resolve(Bun.argv[1]) === Bun.fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`watch-contract: ${errorMessage(error)}`);
    runtimeProcess.exit(1);
  });
}

export { buildTemplate, decide, report, validateContract };
