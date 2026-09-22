/**
 * A campaign tree the Builder tool census reads, and the recorded session shapes it reads it as.
 *
 * `outcome-builder-tools.test.ts` and `outcome-builder-epochs.test.ts` both build campaign
 * directories of epoch folders holding a session-evidence file and a path record. This module
 * carries what both need; a fixture one of them uses stays in that file.
 *
 * The three session constants are recorded shapes rather than invented ones:
 * `contractlessSession` is a session that reconciled no contract, `reconciledSession` adds the
 * reconciled tool contract, and `session` is the composition the capability cases start from —
 * three isolated capabilities under one policy, two research tools, and no contract.
 */
import type { JsonValue } from "../../src/meta/json-shape.ts";
import { mkdirSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { dirname, join } from "../../src/meta/path.ts";
import { scratchDir } from "./scratch.ts";

// The composition the capability cases start from: three isolated capabilities under one policy,
// two research tools, and no reconciled contract.
export const session = JSON.stringify({
  schema: "builder-session-evidence/v4",
  pathRecordSessionId: "builder-primary",
  isolated: { read: ["read"], write: ["write"], bash: ["exec"] },
  research: ["oss", "context"],
  isolations: [{ policyDigest: "policy-a", network: "deny", capabilities: ["bash", "read", "write"] }],
  framingDigest: "framing",
  writtenAt: "2026-07-28T20:17:28.103Z",
});

// A session that reconciled no contract.
export const contractlessSession = JSON.stringify({
  schema: "builder-session-evidence/v4",
  pathRecordSessionId: "builder-primary",
  isolated: { read: ["read"], verifier_workshop: ["read", "write", "exec"] },
  research: ["context"],
  isolations: [
    { policyDigest: "policy-author", network: "deny", capabilities: ["read"] },
    { policyDigest: "policy-offline", network: "deny", capabilities: ["verifier_workshop"] },
  ],
  framingDigest: "framing",
  writtenAt: "2026-07-29T10:00:00.000Z",
});

export const reconciledSession = JSON.stringify({
  ...JSON.parse(contractlessSession),
  contract: {
    backend: "claude",
    catalogued: [
      "context",
      "harness_inspect",
      "harness_trial",
      "public_source",
      "submit",
      "verifier_workshop",
    ],
    registered: [
      "context",
      "harness_inspect",
      "harness_trial",
      "public_source",
      "submit",
      "verifier_workshop",
    ],
    backendExposed: [
      "context",
      "harness_inspect",
      "harness_trial",
      "public_source",
      "submit",
      "verifier_workshop",
    ],
    registeredSchemaDigest: "schema",
    backendExposedSchemaDigest: "schema",
    digest: "contract",
  },
});
/** A campaign directory registered for removal. A file pairs it with one `afterAll(cleanupScratch)`. */
export const campaignDir = (): string => scratchDir("ana-outcome-census-");

/** A campaign holding one authoring epoch, which is what most cases need. A case that composes
 *  several epochs names each one itself through `campaignDir` and `epoch`. */
export function oneEpochCampaign(files: Record<string, string>): string {
  const campaign = campaignDir();
  epoch(campaign, "epoch-1", files);
  return campaign;
}

export function epoch(campaign: string, name: string, files: Record<string, string>): void {
  const dir = join(campaign, name);
  for (const [file, body] of Object.entries(files)) {
    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
}

export function recordRow(over: Record<string, JsonValue>): string {
  return JSON.stringify({
    seq: 1,
    at: "2026-07-28T18:33:49.146Z",
    sessionId: "builder-primary",
    guardId: "candidate-isolation/guardPath@v1",
    capability: "read",
    mode: "read",
    policyDigest: "policy-a",
    profileDigest: null,
    requested: "STARTER.md",
    resolved: "/workspace/STARTER.md",
    decision: "allow",
    reason: "allow/under-root",
    enforcement: "os-allowed",
    bytes: 10,
    ...over,
  });
}
