import { routableOwner } from "../author/feedback-routing.ts";
import type { CampaignFeedback, FeedbackOwner } from "../author/campaign-types.ts";
import type { AnalysisFinding, AnalysisFindingKind } from "./iteration-analysis.ts";

/** Each finding kind's author-session route and whether it may block. Task-set findings route to
 *  the task author; a harness defect routes to the owner its producer proposed; an environment
 *  non-result, an uncertain diagnosis, a Judge disagreement and a controller defect route nowhere,
 *  because none of them is the Builder's to repair. Only a diagnosed defect may block, and hardness
 *  and every disclosure stay advisory because their next move belongs to someone better calibrated
 *  than the finding. */
const FINDING_ROUTES = {
  hardness: { route: "tests", canBlock: false },
  "curriculum-defect": { route: "tests", canBlock: true },
  "harness-defect": { route: "producer", canBlock: true },
  "environment-non-result": { route: null, canBlock: false },
  "diagnosis-uncertain": { route: null, canBlock: false },
  "judge-disagreement": { route: null, canBlock: false },
  "controller-defect": { route: null, canBlock: false },
} as const satisfies Record<AnalysisFindingKind, { route: "tests" | "producer" | null; canBlock: boolean }>;

/** The only author-session owner admitted for a finding, or null. Per-case detail never crosses to
 *  authoring at all. A proposed owner is checked against `routableOwner` rather than trusted: the
 *  finding's producer proposes an owner and the closed set decides. */
export function authorSessionOwner(finding: AnalysisFinding): FeedbackOwner | null {
  const { route } = FINDING_ROUTES[finding.kind];
  if (finding.subject !== undefined || route === null) return null;
  if (route === "tests") return "tests";
  return routableOwner(finding.proposedOwner) ? finding.proposedOwner : null;
}

/** A defect that may block does unless its producer explicitly said advisory. */
export function findingSeverity(finding: AnalysisFinding): CampaignFeedback["severity"] {
  return FINDING_ROUTES[finding.kind].canBlock ? (finding.severity ?? "blocking") : "advisory";
}
