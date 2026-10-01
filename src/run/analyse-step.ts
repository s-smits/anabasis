/**
 * Analyse a measured tree: derive its evidence packet, revalidate the Main
 * Judge's recorded census over it, let the two review readers read it, admit the typed findings
 * through the existing evidence record, then advance the issue register.
 *
 * Three model callers share the review slot here, and each answers a question the others cannot.
 * The census, which already ran inside the battery, checks the Judge against the verifier. The
 * epoch reviewer reads the measured tree and asks whether the result reflects the requested
 * capability; a weak evaluation can produce passes without exposing its omissions in failures.
 * The diagnosis reader reads the solver's traces and locates where the harness failed it on the
 * standing issues that are left. None of them changes a pass, an acceptance, a claim or a
 * promotion: the reviewer's findings enter the same admission gate as every host finding, and the
 * diagnosis reader only annotates issues the controller derived.
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
import { readJsonFileOrNull, writeCompleted } from "../meta/completed-json.ts";
import { isRecord } from "../meta/json-shape.ts";
import type { CampaignFeedback } from "../author/campaign-types.ts";
import {
  type AdmittedEvidence,
  type AnalysisFinding,
  FEEDBACK_POLICY,
  admitFindings,
  deriveIterationAnalysis,
  hostFindings,
} from "../analyse/iteration-analysis.ts";
import { type JudgeReviewsResult, runJudgeReviews } from "../analyse/judge-reviews.ts";
import { reviewerContested } from "../analyse/judge-contested.ts";
import {
  type AdviceIssue,
  type RebuildAdvicePacket,
  attachIssueReadings,
  deriveRebuildAdvice,
  isStanding,
  latestRebuildAdvicePath,
  readLatestRebuildAdvice,
  rebuildAdvicePath,
} from "../author/rebuild-advice.ts";
import { batteryCondition } from "../author/issue-condition.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { loadRepoEnv } from "../backends/env.ts";
import { type ResolvedSlots, resolveSlots } from "../backends/resolve.ts";
import type { RunObserver } from "../observe/run-observer.ts";
import { type DiagnosisReaderEvidence, readDiagnoses } from "../review/diagnosis-reader.ts";
import { runEpochReview } from "../review/epoch-reviewer.ts";
import { type EpochReviewEvidence, epochReviewOutcome } from "../review/epoch-review-findings.ts";
import { publicEpochReview } from "../review/epoch-review-public.ts";
import { readValidatedBrief } from "../correctness-bundle/public-resources.ts";
import { reviewSlotPin } from "../review/review-session.ts";
import { type ReviewOutcome, absentLines } from "../review/review-reader.ts";
import type { ProviderResourceBudget } from "./provider-resource-budget.ts";
import type { SafeguardContext } from "../meta/safeguard.ts";
import { type ReviewResetWait, retryAfterNamedReset } from "../correctness-bundle/provider-reset.ts";

export interface AnalyseStepResult {
  judges: JudgeReviewsResult;
  /** Iteration N's admitted packet, persisted for the next build. */
  admission: AdmittedEvidence;
  /** The issue register a rebuild reads as advice, advanced by this battery, carrying whatever the
   *  two readers attached to it. Their own records stay on disk beside the analysis: nothing in the
   *  round reads them back, so returning them here would be a field with no consumer. */
  advice: RebuildAdvicePacket;
  /** The Judge census and the two readings whose outcome was absent, one line each, and the
   *  contested cases the epoch review left unsettled, for the controller terminal's absent steps.
   *  A skip (slot off, no standing issue, an earlier review standing in) is not absent work. Without
   *  these lines a round that lost its readers to the transport, or read half a census, reads as one
   *  where the review had nothing to say. */
  absent: string[];
}

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
  /** Test interface for the clock and timer of a wait for a provider-named reset. */
  resetWait?: Omit<ReviewResetWait, "providerBudget">;
}

/** Why a reading was absent, which `retryAfterNamedReset` reads for a reset the provider named. */
const absentWhy = (outcome: ReviewOutcome): string | null => (outcome.kind === "absent" ? outcome.why : null);
const epochReviewWhy = (review: EpochReviewEvidence) => absentWhy(epochReviewOutcome(review));
const readingWhy = (reading: DiagnosisReaderEvidence) => absentWhy(reading.outcome);

/** The feedback the battery before this one admitted, which a recurring finding counts back through.
 *  Absent or unreadable reads as none, so the count restarts at one: it says less, never more. */
function admittedBefore(dir: string, runId: string | undefined) {
  if (runId === undefined) return null;
  const recorded = readJsonFileOrNull(join(dir, `${runId}-admission.json`));
  // SAFETY: this file is written only by `publish` below, from `admitFindings`, whose `feedback` is
  // `CampaignFeedback[]`; a row it cannot match on owner and subject counts nothing.
  return isRecord(recorded) && Array.isArray(recorded.feedback)
    ? { runId, feedback: recorded.feedback as CampaignFeedback[] }
    : null;
}

/** The advanced register's standing issues, each shown with the last reading recorded for it: a
 *  re-seen issue carries no diagnosis until this battery's reader runs. */
function disputableIn(advanced: RebuildAdvicePacket, prior: RebuildAdvicePacket | null): AdviceIssue[] {
  const lastReading = new Map((prior?.issues ?? []).map((issue) => [issue.id, issue.diagnosis] as const));
  return advanced.issues
    .filter(isStanding)
    .map((issue) => ({ ...issue, diagnosis: issue.diagnosis ?? lastReading.get(issue.id) ?? null }));
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
  // The register as it stood before this battery, which every publish below advances again.
  const standing = readLatestRebuildAdvice(repoRoot, slug);
  const condition = batteryCondition(analysis, measuredDir);
  // Per-run admission records the analysis. The latest admission for the next build is
  // published by the run driver after product selection: a held candidate's
  // packet stays recorded here and never seeds the next build against the tree it failed to
  // displace. The issue register advances on every measured battery, held candidates included: a
  // rebuild reads prior evidence as advice, and an issue that survived a held candidate is still an
  // issue. Published from host and Judge evidence before the epoch review turn, republished with
  // its findings and disputes, and once more with the diagnoses. Publishing it only after the
  // readers had run would lose a whole battery's register to a provider interruption inside an
  // advisory model call.
  const publish = (
    reviewFindings: AnalysisFinding[],
    disputes: ReadonlyArray<{ issueId: string; reason: string }>,
    settled: readonly string[] = [],
  ) => {
    const findings = [...hostFindings(repoRoot, analysis), ...reviewFindings];
    const admission = admitFindings(repoRoot, analysis, findings, admittedBefore(dir, standing?.runId));
    writeCompleted(join(dir, `${runId}-admission.json`), { runId, policy: FEEDBACK_POLICY, ...admission });
    const derived = attachIssueReadings(
      deriveRebuildAdvice(analysis, judges, admission, standing, condition),
      { disputes, settled },
    );
    writeCompleted(rebuildAdvicePath(repoRoot, slug, runId), derived);
    writeCompleted(latestRebuildAdvicePath(repoRoot, slug), derived);
    return { admission, derived };
  };
  // The reviewer disputes against the register this battery advanced, so an issue the battery raised
  // for the first time is disputable now, not a battery later after a build rebuilt around it.
  const disputable = disputableIn(publish([], []).derived, standing);
  const contested = reviewerContested(judges.contested);
  // A measured battery is reviewed once, so a reader a session limit refused runs again after the
  // reset the provider named, here, before the next Builder round reads what the step publishes.
  const reset = { ...options.resetWait, ...keyIfDefined("providerBudget", providerBudget) };
  const reviewEpoch = () =>
    (options.epochReview ?? runEpochReview)({
      repoRoot,
      slug,
      runId,
      treeRoot: analysis.treeRoot,
      analysis,
      priorAdvice: standing ?? null,
      disputable,
      ...contested,
      review,
      publicRequest: options.publicRequest ?? null,
      ...keyIfDefined("safeguardContext", options.safeguardContext),
      ...keyIfDefined("observer", observer),
      ...keyIfDefined("providerBudget", providerBudget),
    });
  const epochReview = await retryAfterNamedReset("epoch-reviewer", reviewEpoch, epochReviewWhy, reset);
  const brief = epochReview.status === "completed" ? readValidatedBrief(measuredDir) : null;
  const publicReview = publicEpochReview(epochReview, { brief });
  providerBudget?.throwIfDenied();
  const { admission, derived } = publish(
    publicReview.findings,
    publicReview.disputes,
    publicReview.settledJudge,
  );
  const diagnose = () =>
    readDiagnoses({
      repoRoot,
      analysis,
      measuredDir,
      advice: derived,
      review,
      ...keyIfDefined("observer", observer),
      ...keyIfDefined("providerBudget", providerBudget),
    });
  const reading = await retryAfterNamedReset("diagnosis-reader", diagnose, readingWhy, reset);
  writeCompleted(join(dir, `${runId}-diagnoses.json`), reading);
  const advice = attachIssueReadings(derived, { diagnoses: reading.diagnoses });
  if (advice !== derived) {
    writeCompleted(rebuildAdvicePath(repoRoot, slug, runId), advice);
    writeCompleted(latestRebuildAdvicePath(repoRoot, slug), advice);
  }
  const absent = [
    ...absentLines({
      "main-judge census": judges.outcome,
      "epoch review": epochReviewOutcome(epochReview),
      "diagnosis reader": reading.outcome,
    }),
    ...(epochReview.unsettled.length === 0
      ? []
      : [`epoch review: ${String(epochReview.unsettled.length)} contested case(s) left unsettled`]),
  ];
  return { judges, admission, advice, absent };
}
