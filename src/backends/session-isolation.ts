/**
 * A physical isolation claim needs two checks: a mechanism probe showing that the OS refused a
 * read which otherwise succeeds, and evidence that the measured session activated the matching
 * permission profile. A generic probe alone shows that the mechanism works on this host; it says
 * nothing about whether this battery's worker used it, and a claim resting on the probe alone would
 * be a claim about the machine rather than about the run.
 *
 * This module combines the two. The mechanism probe and the probe-only `disclosedIsolation` result
 * stay in isolation-evidence.ts, which owns what a probe alone may claim. Built sessions supply the
 * second half through the Pi worker's ready handshake.
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
 * Which session profile each mechanism family certifies, and what that family can actually prove
 * about the verified session. One table, so the two checks can never be crossed with each other.
 * `Record<IsolationFixture, ...>` keeps it exhaustive, so a new fixture added to the union cannot
 * reach composition unproven. The host families apply this process's own policy, so both records
 * carry the policy digest along with an executed check that the confined process was not the
 * controller; a family whose handshake only echoes a profile id states `false` here instead of
 * claiming a binding it cannot show.
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

/** The verified transport's own session-profile handshake. Structural, like
 *  `IsolationProbeEvidence`, so the isolation vocabulary stays transport-independent and a new
 *  transport supplies the same fields without this file learning about it. */
export type SessionProfileEvidence = {
  role: string;
  model: string;
  reasoningEffort: string;
  providerVersion: string | null;
  activePermissionProfile: string;
  /** The digest of the rules this session's isolation actually applied. Required by the families
   *  that can produce it, and absent for a vendor handshake that exposes only a profile id -- which
   *  is why the family table, not this type, decides whether its absence is acceptable. */
  policyHash?: string;
  /** The confined process and this one, from an executed witness. Required by the families whose
   *  isolation rests on a process boundary: equal values, or an absent pair, mean no separate
   *  confined process was observed, which is exactly what an in-process agent loop would
   *  produce. */
  confinedPid?: number;
  controllerPid?: number;
  /** Exact model and effort accepted by the transport's own local catalogue. */
  modelSelection?: ModelSelectionEvidence;
};

/** Physical isolation requires matching probe and session evidence. A session check naming another
 *  role, another family's profile or other policy bytes, or showing no observed process boundary --
 *  or missing entirely -- keeps the isolation contractual, whatever the probe said, because the
 *  probe can only ever speak for the host. */
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
