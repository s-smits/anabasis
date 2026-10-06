import { isBundleFile } from "../author/feedback-routing.ts";
import { CORRECTNESS_MODEL_DIR, TASKS_FILE } from "../meta/bundle-layout.ts";
import type { CampaignFeedback, FeedbackOwner } from "../author/campaign-types.ts";
import type { AnalysisFinding } from "./iteration-analysis.ts";

/** The only author-session owner admitted for a finding, or null. Per-case detail never crosses to
 *  authoring at all, and a finding about no bundle file is not the Builder's to repair. A demand gap
 *  that names no file is weak task demand by its own definition, so it is the task set's. */
export function authorSessionOwner(finding: AnalysisFinding): FeedbackOwner | null {
  const owner = finding.owner ?? (finding.demandGap === undefined ? null : TASKS_FILE);
  return finding.subject === undefined && isBundleFile(owner) ? owner : null;
}

/** A defect blocks unless its producer explicitly said advisory; an observation never does. */
export function findingSeverity(finding: AnalysisFinding): CampaignFeedback["severity"] {
  return finding.defect ? (finding.severity ?? "blocking") : "advisory";
}

/** A defect in the evaluation contract: owned under `correctness-model/` by any file but the task
 *  set. Only this one settles a contested case against its check and owes the probes it rests on,
 *  because a probe runs the declared checks and so speaks to the evaluation and nothing else. */
export function contractDefect(finding: { defect: boolean | null; owner: string | null }): boolean {
  const { owner } = finding;
  return finding.defect === true && owner?.startsWith(CORRECTNESS_MODEL_DIR) === true && owner !== TASKS_FILE;
}
