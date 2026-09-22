import assert from "../src/meta/assert.ts";
import { test } from "bun:test";

import {
  buildTemplate,
  decide,
  report,
  validateContract,
} from "../.claude/skills/monitor-session-until-idle/scripts/watch-contract.mjs";

function state(threadStatus = "active", turnStatus = "inProgress") {
  return {
    thread: { id: "thread-1", hostId: "local", status: threadStatus },
    latestTurn: { id: "turn-1", status: turnStatus },
  };
}

function contract() {
  return {
    schema: "monitor-watch-contract/v1",
    target: { threadId: "thread-1", hostId: "local" },
    objective: "Trace the existing campaign to a typed terminal.",
    closures: [
      {
        id: "campaign_terminal",
        text: "The campaign has a typed terminal or explicit operator hold.",
        status: "open",
        evidence: [],
      },
    ],
    claims: [],
    interventions: [],
  };
}

test("init binds the exact task and leaves explicit placeholders", () => {
  const template = buildTemplate(state());
  assert.equal(template.target.threadId, "thread-1");
  assert.equal(template.target.hostId, "local");
  assert.throws(() => validateContract(template), /objective must be filled/);
});

test("active healthy work continues", () => {
  assert.equal(decide(state(), contract()).code, "CONTINUE");
});

test("idle target with an open closure requires direct continuation", () => {
  assert.deepEqual(decide(state("idle", "completed"), contract()), {
    code: "DIRECT_COMMITMENT_LIVENESS",
    reason: "The target stopped while required completion clauses remain open.",
    ids: ["campaign_terminal"],
  });
});

test("settled closure makes a terminal task stop-eligible", () => {
  const value = contract();
  value.closures[0].status = "closed";
  value.closures[0].evidence = ["terminal receipt sha256:abc"];
  assert.equal(decide(state("idle", "completed"), value).code, "STOP_ELIGIBLE");
});

test("material unverified claim triggers a checkpoint check", () => {
  const value = contract();
  value.claims.push({
    id: "promotion_claim",
    text: "The candidate was promoted.",
    material: true,
    status: "unverified",
    evidence: [],
  });
  assert.equal(decide(state(), value).code, "CHECK_MATERIAL_CLAIMS");
});

test("sent or acknowledged intervention must be verified", () => {
  const value = contract();
  value.interventions.push({
    id: "scope_warning",
    text: "Preserve the rebuild attribution and inspect the next receipt.",
    kind: "DIRECT",
    status: "acknowledged",
    evidence: ["target acknowledgement item-88"],
  });
  assert.equal(decide(state(), value).code, "VERIFY_INTERVENTION");
});

test("target mismatch fails before every other decision", () => {
  const value = contract();
  value.target.threadId = "different-thread";
  assert.equal(decide(state(), value).code, "DIRECT_IDENTITY_MISMATCH");
});

test("report exposes all three open-ledger counts", () => {
  const value = contract();
  value.claims.push({
    id: "result_claim",
    text: "The result is recorded.",
    material: true,
    status: "unverified",
    evidence: [],
  });
  value.interventions.push({
    id: "receipt_check",
    text: "Verify the recorded result.",
    kind: "CHECK",
    status: "sent",
    evidence: [],
  });
  assert.deepEqual(report(state(), value).counts, {
    openClosures: 1,
    materialUnverifiedClaims: 1,
    pendingInterventions: 1,
  });
});
