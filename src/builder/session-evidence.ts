/** Builder composition evidence: isolation partition plus the production entry-gate contract equality. */
import { join } from "../meta/path.ts";
import { sha256 } from "../meta/digest.ts";
import {
  type BuilderSessionInterfaceEvidence,
  type BuilderToolInterfaceInput,
  reconcileBuilderInterface,
} from "./builder-tool-interface.ts";
import type { PathRecord } from "./candidate-isolation-runtime.ts";
import type { CandidateAccessPolicy, IsolationMode } from "./candidate-isolation.ts";
import { BUILDER_CAPABILITY_MODES } from "./capability-modes.ts";
import type { BuilderShellWall } from "../run/builder-backend.ts";
import { writeJsonFile } from "../meta/completed-json.ts";
import type { BackendKind } from "../backends/backend-kinds.ts";
import { keyIfDefined } from "../meta/optional-key.ts";

export const BUILDER_SESSION_EVIDENCE_FILE = "builder-session.json";
export const BUILDER_SESSION_EVIDENCE_SCHEMA = "builder-session-evidence/v4";

export interface BuilderSessionIsolationEvidence {
  policyDigest: string;
  network: CandidateAccessPolicy["network"];
  capabilities: string[];
}

export interface BuilderSessionEvidence {
  /** The `contract` field below, not this string, says whether the production opener reconciled
   *  the complete roster: a contractless probe was once spelled `v2` and a reconciled session `v4`,
   *  so the version number answered a question it does not own. */
  schema: typeof BUILDER_SESSION_EVIDENCE_SCHEMA;
  /** The path-record stream every session on this composition writes; many sessions, one id.
   *  A session that opens and touches no path leaves an empty record, and this evidence is then
   *  the only record there is — which is why these fields restate what record rows also carry. */
  pathRecordSessionId: string;
  /** Composed path capabilities with the isolation modes each declares. */
  isolated: Record<string, readonly IsolationMode[]>;
  /** Composed tools with no path capability: context and web_search when enabled. */
  research: string[];
  /** Every candidate-isolation policy this fixed roster may use. */
  isolations: BuilderSessionIsolationEvidence[];
  /** Model-visible Builder framing delivered by this composition. */
  framingDigest: string;
  shellWall?: BuilderShellWall; // absent for a composition probe that built no backend

  /** Present only after the production opener reconciled the complete roster, including submit. */
  contract?: BuilderSessionInterfaceEvidence;
  writtenAt: string;
}

export function writeBuilderSessionEvidence(input: {
  epochDir: string;
  tools: readonly BuilderToolInterfaceInput[];
  policy: CandidateAccessPolicy;
  /** A capability with a distinct policy names every one it may use. */
  capabilityPolicies?: Readonly<Record<string, readonly CandidateAccessPolicy[]>>;
  record: PathRecord;
  framing: string;
  contract?: { backend: BackendKind; backendExposed: readonly BuilderToolInterfaceInput[] };
  shellWall?: BuilderShellWall;
}): BuilderSessionEvidence {
  const isolated: Record<string, readonly IsolationMode[]> = {};
  const research: string[] = [];
  const isolations = new Map<string, { policy: CandidateAccessPolicy; capabilities: Set<string> }>();
  for (const tool of input.tools) {
    const modes = BUILDER_CAPABILITY_MODES.get(tool.name);
    if (modes === undefined) research.push(tool.name);
    else {
      isolated[tool.name] = modes;
      for (const policy of input.capabilityPolicies?.[tool.name] ?? [input.policy]) {
        const isolation = isolations.get(policy.digest) ?? { policy, capabilities: new Set<string>() };
        isolation.capabilities.add(tool.name);
        isolations.set(policy.digest, isolation);
      }
    }
  }
  const requested = input.contract;
  const contract =
    requested === undefined
      ? undefined
      : reconcileBuilderInterface({
          backend: requested.backend,
          registered: input.tools,
          backendExposed: requested.backendExposed,
        });
  const evidence: BuilderSessionEvidence = {
    schema: BUILDER_SESSION_EVIDENCE_SCHEMA,
    pathRecordSessionId: input.record.sessionId,
    isolated,
    research,
    isolations: [...isolations.values()]
      .map(({ policy, capabilities }) => ({
        policyDigest: policy.digest,
        network: policy.network,
        capabilities: [...capabilities].sort(),
      }))
      .sort((a, b) => a.policyDigest.localeCompare(b.policyDigest)),
    framingDigest: sha256(input.framing),
    ...keyIfDefined("shellWall", input.shellWall),
    ...keyIfDefined("contract", contract),
    writtenAt: new Date().toISOString(),
  };
  writeJsonFile(join(input.epochDir, BUILDER_SESSION_EVIDENCE_FILE), evidence);
  return evidence;
}
