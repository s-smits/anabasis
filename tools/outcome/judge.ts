/**
 * Read and check the saved Judge review of one battery. Missing or invalid results stay
 * unavailable, not zero. This report cannot change correctness results or scores.
 */
import { existsSync, readFileSync } from "../../src/meta/filesystem.ts";
import { dirname, join, relative } from "../../src/meta/path.ts";
import { campaignTraceRoots } from "../../src/claim/trace-read.ts";
import {
  type BatteryCensus,
  type JudgeExit,
  JUDGE_REVIEWS_SCHEMA,
  type JudgeReviewsResult,
} from "../../src/analyse/judge-reviews.ts";
import { validateJudgeEvidence } from "../../src/claim/judge.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { errorMessage } from "../../src/meta/runtime-values.ts";

export const OUTCOME_JUDGE_SCHEMA = "outcome-judge/v2";

/** The checked census, or why it cannot be shown. */
type OutcomeJudgeCensus =
  | { runId: string; evidence: BatteryCensus["evidence"] }
  | { runId: string | null; refusal: string };

/** One complete disagreement between the review and correctness model. Incomplete rows go to
 * `contestedUnavailable` instead. This is read-only context and cannot change a score or promote a
 * candidate. */
interface OutcomeContestedCase {
  runId: string;
  taskId: string;
  family: string;
  judge: boolean;
  verifier: boolean;
  direction: "verifier-pass-judge-fail" | "verifier-fail-judge-pass";
  /** Saved review path for this case. */
  judgeEvidence: string;
  /** Saved answer path checked by the source reader. */
  artifact: string;
  /** Correctness-model identity from the measured condition. */
  correctnessModelId: string;
}

export type OutcomeJudgeReport =
  | {
      schema: typeof OUTCOME_JUDGE_SCHEMA;
      campaign: string;
      selector: string;
      available: false;
      reason: string;
    }
  | {
      schema: typeof OUTCOME_JUDGE_SCHEMA;
      campaign: string;
      selector: string;
      available: true;
      review: string;
      judgePin: string | null;
      promptPolicyDigests: JudgeReviewsResult["promptPolicyDigests"];
      census: OutcomeJudgeCensus | null;
      contested: OutcomeContestedCase[];
      /** Review disagreements that lack enough information to show as complete disputes. */
      contestedUnavailable: string[];
      coverage: JudgeReviewsResult["coverage"];
      provisional: string | null;
      exit: JudgeExit;
      absent: string[];
    };

function censusView(entry: BatteryCensus | null): OutcomeJudgeCensus | null {
  if (entry === null) return null;
  try {
    validateJudgeEvidence(entry.evidence);
  } catch (error) {
    return {
      runId: entry.runId,
      refusal: `evidence fails re-validation: ${errorMessage(error)}`,
    };
  }
  return { runId: entry.runId, evidence: entry.evidence };
}

/** A contested row records its path under the tree that measured it, `candidates/<run>/`, and
 *  promotion moves that tree to `domains/<slug>/` minutes later (run c66e0d: 112 s). When the
 *  recorded path no longer exists, probe the campaign's conventional trace roots for the same
 *  `runs/…` suffix; a path found nowhere is reported as recorded. */
function currentEvidencePath(campaignDir: string, recorded: string): string {
  const repoRoot = dirname(dirname(campaignDir));
  if (existsSync(join(repoRoot, recorded))) return recorded;
  const suffix = recorded.slice(recorded.indexOf("/runs/") + 1);
  if (!recorded.includes("/runs/")) return recorded;
  const found = campaignTraceRoots(campaignDir).find((root) => existsSync(join(root, suffix)));
  return found === undefined ? recorded : relative(repoRoot, join(found, suffix));
}

/** Return complete disputes and explain why weaker rows cannot be shown. */
function contestedRows(
  campaignDir: string,
  review: Pick<JudgeReviewsResult, "contested">,
  view: OutcomeJudgeCensus | null,
) {
  const contested: OutcomeContestedCase[] = [];
  const unavailable: string[] = [];
  for (const row of review.contested) {
    if (view === null || !("evidence" in view)) {
      unavailable.push(
        `${row.taskId}: the measured review was refused or absent, so this disagreement has no checked correctness-model identity`,
      );
      continue;
    }
    if (row.artifact === null) {
      unavailable.push(`${row.taskId}: no saved answer path, so the disputed answer cannot be inspected`);
      continue;
    }
    contested.push({
      runId: view.runId,
      taskId: row.taskId,
      family: row.family,
      judge: row.judge,
      verifier: row.verifier,
      direction: row.verifier ? "verifier-pass-judge-fail" : "verifier-fail-judge-pass",
      judgeEvidence: currentEvidencePath(campaignDir, row.evidence),
      artifact: currentEvidencePath(campaignDir, row.artifact),
      correctnessModelId: view.evidence.correctnessModelId,
    });
  }
  return { contested, unavailable };
}

/** The review of one battery, written under that battery's exact run id (`53-judges.json`). */
export function judgeReport(campaignDir: string, selector: string): OutcomeJudgeReport {
  const base = { schema: OUTCOME_JUDGE_SCHEMA, campaign: campaignDir, selector } as const;
  const path = join(campaignDir, "analysis", `${selector}-judges.json`);
  if (!existsSync(path)) {
    return { ...base, available: false, reason: `no judge review evidence at ${path}` };
  }
  let review: JudgeReviewsResult;
  try {
    review = parseJsonAs<typeof review>(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      ...base,
      available: false,
      reason: `${path}: unreadable (${errorMessage(error)})`,
    };
  }
  // Only the current version is read; an earlier one is refused rather than half-read.
  const schema: string = review.schema;
  if (schema !== JUDGE_REVIEWS_SCHEMA) {
    return {
      ...base,
      available: false,
      reason: `${path}: schema ${schema} is not ${JUDGE_REVIEWS_SCHEMA}`,
    };
  }
  const census = censusView(review.census);
  const disputes = contestedRows(campaignDir, review, census);
  return {
    ...base,
    available: true,
    review: path,
    judgePin: review.judgePin,
    promptPolicyDigests: review.promptPolicyDigests,
    census,
    contested: disputes.contested,
    contestedUnavailable: disputes.unavailable,
    coverage: review.coverage,
    provisional: review.provisional,
    exit: review.exit,
    absent: review.absent,
  };
}
