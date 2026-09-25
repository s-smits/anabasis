import { isBundleFile } from "../author/feedback-routing.ts";
import { TASKS_FILE } from "../meta/bundle-layout.ts";
import type { CampaignFeedback, FeedbackOwner } from "../author/campaign-types.ts";
import type { AnalysisFinding } from "./iteration-analysis.ts";

/** The only author-session owner admitted for a finding, or null. Per-case detail never crosses to
 *  authoring at all, and a finding about no bundle file is not the Builder's to repair. */
export function authorSessionOwner(finding: AnalysisFinding): FeedbackOwner | null {
  return finding.subject === undefined && isBundleFile(finding.owner) ? finding.owner : null;
}

/** A defect blocks unless its producer explicitly said advisory; an observation never does. */
export function findingSeverity(finding: AnalysisFinding): CampaignFeedback["severity"] {
  return finding.defect ? (finding.severity ?? "blocking") : "advisory";
}

/** A defect repaired where it sits: every defect but one in the task set, which asks for a fresh
 *  battery rather than a repair. Only this one settles vetoed rows against its check, carries a
 *  repair order, escalates when it recurs and owes the probes it rests on. */
export function contractDefect(finding: { defect: boolean | null; owner: string | null }): boolean {
  return finding.defect === true && finding.owner !== TASKS_FILE;
}
