/**
 * What one executed gate run makes of a submitted candidate: build-admissible, another authoring
 * pass with the blocking rows carried, or a terminal clause. Bundle, admission and conformance
 * refusals never write an iteration, but a gate run they executed still settles its terminal
 * clause through gateTerminalClause.
 */
import { semanticFindingsIdentity } from "../author/builder-execution.ts";
import type {
  BuiltHarness,
  CampaignClause,
  CampaignFeedback,
  IterationEvidence,
} from "../author/campaign-types.ts";
import { feedbackOwner } from "../author/feedback-routing.ts";

type IterationStep =
  | { kind: "build-admissible"; evidence: IterationEvidence }
  | { kind: "terminal"; evidence: IterationEvidence; clause: CampaignClause }
  | {
      kind: "continue";
      evidence: IterationEvidence;
      carried: CampaignFeedback[];
    };

interface GateSettlementInput {
  feedback: CampaignFeedback[];
  fingerprint: BuiltHarness["fingerprint"];
  attempts: Record<string, number>;
  ordinal: number;
  dir: string;
}

/** The terminal clause a gate run's blocking rows force whether or not an iteration records them:
 *  a blocking environment row ends the session, because no author can repair it. */
export function gateTerminalClause(feedback: readonly CampaignFeedback[]): CampaignClause | null {
  const envBlocked = feedback.some((row) => row.severity === "blocking" && row.owner === "environment");
  return envBlocked ? "environment-blocked" : null;
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
        focusOwner: null,
        attempts,
        findingsHash: null,
        fingerprint,
        feedback,
      },
    };
  }
  // This hash is the recorded identity of a diagnosis, telling an exact repeat from a changed one. Owner,
  // claim, the finding codes and paths and the identifiers quoted inside an author-projected detail
  // belong in it; the detail text itself does not, because a per-execution record id sitting there
  // makes an identical diagnosis read as new work round after round.
  const findingsHash = semanticFindingsIdentity(blocking);
  const evidence: IterationEvidence = {
    ordinal,
    dir,
    outcome: "gates-blocked",
    focusOwner: feedbackOwner(blocking),
    attempts,
    findingsHash,
    fingerprint,
    feedback,
  };
  const clause = gateTerminalClause(blocking);
  if (clause !== null) return { kind: "terminal", evidence, clause };
  return { kind: "continue", evidence, carried: blocking };
}
