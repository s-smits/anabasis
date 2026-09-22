import { routableOwner } from "../author/feedback-routing.ts";
import type { FeedbackOwner } from "../author/campaign-types.ts";
import type { AnalysisFinding } from "./iteration-analysis.ts";

export type NoRouteReason =
  | "per-case-detail"
  | "environment-non-result"
  | "judge-advisory-only"
  | "not-builder-owned-surface"
  | "diagnosis-uncertain";

type FindingOwnerResult = { owner: FeedbackOwner } | { owner: null; reason: NoRouteReason };

/** Derive the only author-session owner admitted for a finding. Task-set findings route to the
 * task author; a harness defect routes only to a declared Builder-owned surface. */
export function authorSessionOwner(finding: AnalysisFinding): FindingOwnerResult {
  if (finding.subject !== undefined) return { owner: null, reason: "per-case-detail" };
  switch (finding.kind) {
    case "hardness":
    case "curriculum-defect":
      return { owner: "tests" };
    case "environment-non-result":
      return { owner: null, reason: "environment-non-result" };
    case "diagnosis-uncertain":
      return { owner: null, reason: "diagnosis-uncertain" };
    case "judge-disagreement":
      return { owner: null, reason: "judge-advisory-only" };
    case "controller-defect":
      return { owner: null, reason: "not-builder-owned-surface" };
    case "harness-defect":
      return finding.proposedOwner !== null && routableOwner(finding.proposedOwner)
        ? { owner: finding.proposedOwner }
        : { owner: null, reason: "not-builder-owned-surface" };
  }
}
