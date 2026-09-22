/**
 * A physical isolation claim needs two checks: a mechanism probe showing that the OS refused a read
 * which otherwise succeeds, and evidence that the measured session activated the matching
 * permission profile. A probe alone shows the mechanism works on this host, not that this battery's
 * worker uses it. The probe itself lives in isolation-evidence.ts; Built sessions report through
 * the Pi worker's ready handshake.
 */
import type { IsolationStrength } from "../claim/readiness.ts";
import { HOST_SOLVE_ISOLATION_PROFILE_ID } from "../verify/solve-sandbox.ts";
import type { ModelSelectionEvidence } from "./model-selection.ts";
import {
  type IsolationFixture,
  type IsolationProbeEvidence,
  disclosedIsolation,
} from "./isolation-evidence.ts";
import { isNumber, isString } from "../meta/json-shape.ts";

/**
 * Which session profile each mechanism family certifies and what it can prove about the session.
 * Exhaustive over `IsolationFixture`, so a new fixture cannot reach composition unproven. A family
 * whose handshake only echoes a profile id states `false` for the bindings it cannot prove.
 */
const ISOLATION_FAMILIES = {
  "host-seatbelt-read-deny/v1": {
    sessionProfile: HOST_SOLVE_ISOLATION_PROFILE_ID,
    bindsPolicyBytes: true,
    bindsProcessBoundary: true,
  },
  "host-bwrap-read-deny/v1": {
    sessionProfile: HOST_SOLVE_ISOLATION_PROFILE_ID,
    bindsPolicyBytes: true,
    bindsProcessBoundary: true,
  },
} satisfies Readonly<
  Record<
    IsolationFixture,
    { sessionProfile: string; bindsPolicyBytes: boolean; bindsProcessBoundary: boolean }
  >
>;

/** The verified transport's own session-profile handshake, structural so the isolation vocabulary
 *  stays transport-independent. */
export type SessionProfileEvidence = {
  role: string;
  model: string;
  reasoningEffort: string;
  providerVersion: string | null;
  activePermissionProfile: string;
  /** The digest of the rules this session's isolation applied; absent when a handshake exposes
   *  only a profile id. */
  policyHash?: string;
  /** The confined process and the controller, from an executed witness. Equal or absent values
   *  mean no separate confined process was observed. */
  confinedPid?: number;
  controllerPid?: number;
  /** Exact model and effort accepted by the transport's own local catalogue. */
  modelSelection?: ModelSelectionEvidence;
};

/** Physical only when probe and session evidence match: role, profile, policy bytes and an observed
 *  process boundary. Anything else is contractual, whatever the probe said. */
export function composedIsolation(
  probe: IsolationProbeEvidence | undefined,
  session: SessionProfileEvidence | undefined,
): IsolationStrength {
  if (disclosedIsolation(probe) !== "physical" || probe === undefined || session === undefined) {
    return "contractual";
  }
  const family = ISOLATION_FAMILIES[probe.fixture];
  if (session.role !== "built") return "contractual";
  if (session.activePermissionProfile !== family.sessionProfile) return "contractual";
  if (
    family.bindsPolicyBytes &&
    (!isString(probe.profileDigest) || session.policyHash !== probe.profileDigest)
  ) {
    return "contractual";
  }
  if (family.bindsProcessBoundary && !observedProcessBoundary(session)) return "contractual";
  return "physical";
}

/** A confined process distinct from the controller, both recorded by the same executed witness. */
function observedProcessBoundary(session: SessionProfileEvidence): boolean {
  return (
    isNumber(session.confinedPid) &&
    isNumber(session.controllerPid) &&
    session.confinedPid !== session.controllerPid
  );
}
