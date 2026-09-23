/**
 * What one executed gate run makes of a submitted candidate: build-admissible, another authoring
 * pass with the blocking rows carried, or a terminal clause. Bundle, admission and conformance
 * refusals never write an iteration, but a gate run they executed still settles its terminal
 * clause through gateTerminalClause.
 */
import { semanticFindingsIdentity } from "../author/builder-execution.ts";
import type {
  AuthorRepairFinding,
  BuiltHarness,
  CampaignClause,
  CampaignFeedback,
  IterationEvidence,
} from "../author/campaign-types.ts";
import { feedbackOwner, routableOwner } from "../author/feedback-routing.ts";
import { POLICY } from "../critic/policy.ts";
import { findingsRepeatRun, repeatedFindingsFinding } from "./candidate-memory.ts";

type IterationStep =
  | { kind: "build-admissible"; evidence: IterationEvidence }
  | { kind: "terminal"; evidence: IterationEvidence; clause: CampaignClause }
  | {
      kind: "continue";
      evidence: IterationEvidence;
      carried: CampaignFeedback[];
      /** A repeated-diagnosis notice for the author; never part of findingsHash. */
      steering?: AuthorRepairFinding;
    };

interface GateSettlementInput {
  feedback: CampaignFeedback[];
  fingerprint: BuiltHarness["fingerprint"];
  attempts: Record<string, number>;
  ordinal: number;
  dir: string;
  priorBlockedFindingsHashes: readonly string[];
}

/** The terminal clause a gate run's blocking rows force whether or not an iteration records them:
 *  a blocking row no author can repair ends the session. */
export function gateTerminalClause(feedback: readonly CampaignFeedback[]): CampaignClause | null {
  const blocking = feedback.filter((row) => row.severity === "blocking");
  if (blocking.every((row) => routableOwner(row.owner))) return null;
  return blocking.some((row) => row.owner === "environment") ? "environment-blocked" : "repair-unroutable";
}

export function settleGateRun(input: GateSettlementInput): IterationStep {
  const { feedback, ordinal, dir, attempts } = input;
  const fingerprint = {
    agentHash: input.fingerprint.agentHash,
    correctnessModelHash: input.fingerprint.correctnessModelHash,
    taskSetHash: input.fingerprint.taskSetHash,
  };
  const blocking = feedback.filter((row) => row.severity === "blocking");
  if (blocking.length === 0) {
    return {
      kind: "build-admissible",
      evidence: {
        ordinal,
        dir,
        outcome: "fingerprinted",
        stage: null,
        focusOwner: null,
        attempts,
        findingsHash: null,
        fingerprint,
        feedback,
      },
    };
  }
  // The stall detector reads this hash to tell an exact repeat from a changed diagnosis. Owner,
  // claim, the finding codes and paths and the identifiers quoted inside an author-projected detail
  // belong in it; the detail text itself does not, because a per-execution record id sitting there
  // makes an identical diagnosis read as new work (w26, five rounds).
  const findingsHash = semanticFindingsIdentity(blocking, null);
  const evidence: IterationEvidence = {
    ordinal,
    dir,
    outcome: "gates-blocked",
    stage: null,
    focusOwner: feedbackOwner(blocking),
    attempts,
    findingsHash,
    fingerprint,
    feedback,
  };
  const clause = gateTerminalClause(blocking);
  if (clause !== null) return { kind: "terminal", evidence, clause };
  const repeats = findingsRepeatRun(input.priorBlockedFindingsHashes, findingsHash);
  if (repeats >= POLICY.loop.stalledFindingsRepeats) {
    return { kind: "terminal", evidence, clause: "authoring-stalled" };
  }
  if (repeats > 1) {
    return { kind: "continue", evidence, carried: blocking, steering: repeatedFindingsFinding(repeats) };
  }
  return { kind: "continue", evidence, carried: blocking };
}
