/**
 * Analyse a measured tree: derive its evidence packet, revalidate the Main
 * Judge's recorded census over it, let the two review readers read it, admit the typed findings
 * through the existing evidence record, then advance the issue register.
 *
 * Three model callers share the review slot here, and each answers a question the others cannot.
 * The census, which already ran inside the battery, checks the Judge against the verifier. The
 * epoch reviewer reads the measured tree and asks whether the result reflects the requested
 * capability; a weak evaluation can produce passes without exposing its omissions in failures.
 * The diagnosis reader proposes causes for the unresolved issues that are
 * left. None of them changes a pass, an acceptance, a claim or a promotion: the reviewer's findings
 * enter the same admission gate as every host finding, and the diagnosis reader only annotates
 * issues the controller derived.
 *
 * Publication order preserves completed evidence. Admission and the issue register are written
 * from host and Judge evidence before either advisory model turn, then updated with reader results. The
 * register is controller-owned evidence that advances on every measured battery, and a reader that
 * fails must leave that evidence available. The epoch review is written before its own
 * republication because its findings cite that file, and admission requires cited evidence to
 * exist on disk. Its disputes attach before the diagnosis reader opens, so a disputed issue is
 * not also diagnosed. The final publication carries both readings, so the digest a rebuild binds
 * identifies the evidence used to prepare authoring feedback.
 */
import { mkdirSync } from "../meta/filesystem.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { join } from "../meta/path.ts";
import {
  type AdmittedEvidence,
  type AnalysisFinding,
  FEEDBACK_POLICY,
  admitFindings,
  deriveIterationAnalysis,
  hostFindings,
} from "../analyse/iteration-analysis.ts";
import { type JudgeReviewsResult, runJudgeReviews } from "../analyse/judge-reviews.ts";
import { isDisputedFail, isVetoed } from "../analyse/judge-contested.ts";
import { writeCompleted } from "../author/campaign-epoch.ts";
import {
  type RebuildAdvicePacket,
  attachIssueReadings,
  deriveRebuildAdvice,
  latestRebuildAdvicePath,
  readLatestRebuildAdvice,
  rebuildAdvicePath,
} from "../author/rebuild-advice.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { loadRepoEnv } from "../backends/env.ts";
import { type ResolvedSlots, resolveSlots } from "../backends/resolve.ts";
import type { RunObserver } from "../observe/run-observer.ts";
import { readDiagnoses } from "../review/diagnosis-reader.ts";
import { runEpochReview } from "../review/epoch-reviewer.ts";
import { publicEpochReview } from "../review/epoch-review-public.ts";
import { readValidatedBrief } from "../truth/public-resources.ts";
import { reviewSlotPin } from "../review/review-session.ts";
import type { ProviderResourceBudget } from "./provider-resource-budget.ts";
import type { SafeguardContext } from "../meta/safeguard.ts";

export interface AnalyseStepResult {
  judges: JudgeReviewsResult;
  /** Iteration N's admitted packet, persisted for the next build. */
  admission: AdmittedEvidence;
  /** The issue register a rebuild reads as advice, advanced by this battery, carrying whatever the
   *  two readers attached to it. Their own records stay on disk beside the analysis: nothing in the
   *  round reads them back, so returning them here would be a field with no consumer. */
  advice: RebuildAdvicePacket;
  /** Reader turns that did not complete, one line each, for the controller terminal's absent
   *  steps. A skipped or locally refused reading (slot off, no standing issue, already reviewed)
   *  is not absent work; a provider or protocol failure inside the turn is. campaign -29 lost both
   *  readers to the transport and the terminal listed nothing. */
  absent: string[];
}

/** Reader results decided locally, before or without a model turn. */
const LOCAL_READER_REASONS = new Set(["no-standing-issue", "review-slot-off", "no-offered-issue"]);

interface AnalyseStepOptions {
  safeguardContext?: SafeguardContext;
  resolvedSlots?: ResolvedSlots;
  providerBudget?: ProviderResourceBudget;
  observer?: RunObserver;
  /** The operator's exact request, shown to the epoch reviewer so it can judge whether the
   *  harness answers the ask rather than only the tasks derived from it. */
  publicRequest?: string;
  /** Test interface for the reviewer turn: a reader that dies mid-turn. */
  epochReview?: typeof runEpochReview;
}

export async function analyseStep(
  repoRoot: string,
  slug: string,
  runId: string,
  measuredDir: string,
  options: AnalyseStepOptions = {},
): Promise<AnalyseStepResult> {
  const { providerBudget, observer } = options;
  const { review } = options.resolvedSlots ?? resolveSlots(repoRoot, slug, loadRepoEnv(repoRoot, Bun.env));
  const analysis = deriveIterationAnalysis(repoRoot, slug, runId, measuredDir);
  const judges = runJudgeReviews(analysis, {
    repoRoot,
    judgePin: reviewSlotPin(review),
    ...keyIfDefined("safeguardContext", options.safeguardContext),
  });
  const dir = join(campaignDir(repoRoot, slug), "analysis");
  mkdirSync(dir, { recursive: true });
  writeCompleted(join(dir, `${runId}-analysis.json`), analysis);
  // Record before admission: the Judge exit cites this file, and admission requires cited
  // evidence to exist on disk.
  writeCompleted(join(dir, `${runId}-judges.json`), judges);
  providerBudget?.throwIfDenied();
  // The register as it stands before this battery: the epoch reviewer is offered the issues that
  // are still standing so it can dispute one, and the derived packet below re-reads the same file.
  const standing = readLatestRebuildAdvice(repoRoot, slug);
  // Per-run admission records the analysis. The latest admission for the next build is
  // published by the run driver after product selection: a held candidate's
  // packet stays recorded here and never seeds the next build against the tree it failed to
  // displace. The issue register advances on every measured battery, held candidates included: a
  // rebuild reads prior evidence as advice, and an issue that survived a held candidate is still an
  // issue. Published from host and Judge evidence before the epoch review turn, republished with
  // its findings and disputes, and once more with the diagnoses. Publishing it only after a reader
  // lost a whole battery's register to a provider interruption inside that advisory model call.
  const publish = (
    reviewFindings: AnalysisFinding[],
    disputes: ReadonlyArray<{ issueId: string; reason: string }>,
  ) => {
    const admission = admitFindings(repoRoot, analysis, [
      ...hostFindings(repoRoot, analysis),
      ...judges.findings,
      ...reviewFindings,
    ]);
    writeCompleted(join(dir, `${runId}-admission.json`), { runId, policy: FEEDBACK_POLICY, ...admission });
    const derived = attachIssueReadings(deriveRebuildAdvice(analysis, judges, admission, standing), {
      disputes,
    });
    writeCompleted(rebuildAdvicePath(repoRoot, slug, runId), derived);
    writeCompleted(latestRebuildAdvicePath(repoRoot, slug), derived);
    return { admission, derived };
  };
  publish([], []);
  const contested = {
    vetoed: judges.contested.filter(isVetoed),
    disputed: judges.contested.filter(isDisputedFail),
  };
  const epochReview = await (options.epochReview ?? runEpochReview)({
    repoRoot,
    slug,
    runId,
    treeRoot: analysis.treeRoot,
    analysis,
    priorAdvice: standing ?? null,
    ...contested,
    review,
    publicRequest: options.publicRequest ?? null,
    ...keyIfDefined("safeguardContext", options.safeguardContext),
    ...keyIfDefined("observer", observer),
    ...keyIfDefined("providerBudget", providerBudget),
  });
  writeCompleted(join(dir, `${runId}-epoch-review.json`), epochReview);
  const brief = epochReview.status === "completed" ? readValidatedBrief(measuredDir) : null;
  const publicReview = publicEpochReview(epochReview, { brief, ...contested });
  providerBudget?.throwIfDenied();
  const { admission, derived } = publish(publicReview.findings, publicReview.disputes);
  const reading = await readDiagnoses({
    repoRoot,
    analysis,
    advice: derived,
    review,
    ...keyIfDefined("safeguardContext", options.safeguardContext),
    ...keyIfDefined("observer", observer),
    ...keyIfDefined("providerBudget", providerBudget),
  });
  writeCompleted(join(dir, `${runId}-diagnoses.json`), reading);
  const advice = attachIssueReadings(derived, { diagnoses: reading.diagnoses });
  if (advice !== derived) {
    writeCompleted(rebuildAdvicePath(repoRoot, slug, runId), advice);
    writeCompleted(latestRebuildAdvicePath(repoRoot, slug), advice);
  }
  const absent = [
    ...(epochReview.status === "failed" || epochReview.status === "incomplete"
      ? [`epoch review: ${epochReview.status} — ${epochReview.reason}`]
      : []),
    ...(reading.error !== null && !LOCAL_READER_REASONS.has(reading.error)
      ? [`diagnosis reader: failed — ${reading.error}`]
      : []),
  ];
  return { judges, admission, advice, absent };
}
