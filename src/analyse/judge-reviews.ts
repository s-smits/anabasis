/**
 * The Main Judge's recorded battery review, revalidated here without another model call. It writes
 * no measurement evidence; the caller persists the projection. Two outputs matter: the contested
 * rows (every verified case where the Judge and the verifier disagreed, named without a threshold)
 * and the Judge exit, which is advice only. The Judge never blocks and never routes an owner
 * (operator decision 2026-09-14); its disagreements reach the rebuild advice packet by family.
 */
import { existsSync } from "../meta/filesystem.ts";
import { dirname, join } from "../meta/path.ts";
import { BATTERY_FILE, batteryPath, CASE_ARTIFACT_FILE, CASE_JUDGE_FILE } from "../truth/battery-record.ts";
import { type JudgeEvidence, validateJudgeEvidence } from "../claim/judge.ts";
import { type EvidenceLogViolation, recordedEvidence, verifyRunDir } from "../claim/evidence-log.ts";
import { ACTIVE_JUDGE_PROMPT_DIGESTS } from "../truth/judge-prompt-policy.ts";
import type { JudgeSubjectEvidence } from "../truth/judge.ts";
import type { AnalysisFinding, IterationAnalysis } from "./iteration-analysis.ts";
import { type ContestedCase, type ContestedSubject, contestedCases, isVetoed } from "./judge-contested.ts";
import { readValidatedBrief } from "../truth/public-resources.ts";
import { parseJsonAs, capturedJsonParse, hashJsonBytes } from "../meta/json-runtime.ts";
import { isRecord, isString } from "../meta/json-shape.ts";
import type { SafeguardContext } from "../meta/safeguard.ts";
import { safeguardJudgeReview } from "./judge-safeguards.ts";
import { errorMessage } from "../meta/runtime-values.ts";

interface JudgeReviewDeps {
  repoRoot: string;
  /** The current review slot's pin; null when disabled. The census pin is its own recorded fact: the two
   *  legitimately differ after a reconfiguration. */
  judgePin: string | null;
  /** Where the Judge safeguards log; absent in tests and bare scripts. */
  safeguardContext?: SafeguardContext;
}

export type BatteryCensus = {
  runId: string;
  evidence: Exclude<JudgeEvidence, { judge: "off" }>;
};

/**
 * The Judge exit. `advisory` names at least one complete disagreement between the Judge and the
 * verifier; `none` means they agreed on every reviewed case.
 */
export type JudgeExit = {
  kind: "none" | "advisory";
  /** Verified cases the verifier failed and the Judge passed. */
  verifierFailJudgePass: number;
  /** Verified cases the verifier passed and the Judge failed. */
  verifierPassJudgeFail: number;
  /** Verified cases in the battery. */
  verified: number;
  reason: string;
};

export const JUDGE_REVIEWS_SCHEMA = "judge-reviews/v10";

export type JudgeReviewsResult = {
  schema: typeof JUDGE_REVIEWS_SCHEMA;
  slug: string;
  runId: string;
  /** Who the Judge was, for the reader; the census pin is recorded in the battery. */
  judgePin: string | null;
  /** The active prompt digests, so a reader can bind a census to the exact judge prompt. */
  promptPolicyDigests: typeof ACTIVE_JUDGE_PROMPT_DIGESTS;
  analysisDigest: string;
  /** The revalidated census; null when the battery recorded none or the record refused. */
  census: BatteryCensus | null;
  /** Every verified case where the Judge's verdict disagreed with the verifier's, no threshold. */
  contested: ContestedCase[];
  coverage: { reviewable: number; reviewed: number };
  /** Why the review is incomplete; null when every offered battery verdict returned. */
  provisional: string | null;
  exit: JudgeExit;
  findings: AnalysisFinding[];
  absent: string[];
};

type CensusAttempt = { census: BatteryCensus | null; reason: string | null };

/** One `verifyRunDir` for the whole review: every case shares the battery's run directory. */
function runDirVerifier(): (runDir: string) => EvidenceLogViolation[] {
  const cache = new Map<string, EvidenceLogViolation[]>();
  return (runDir) => {
    const cached = cache.get(runDir);
    if (cached !== undefined) return cached;
    const violations = verifyRunDir(runDir);
    cache.set(runDir, violations);
    return violations;
  };
}

/** The run's own judge record when it states its cited rules, which every Judge attempt records;
 *  a record without them (written before 2026-09-15) reads as no judge evidence for its case. */
function asCurrentJudgeEvidence(value: unknown): JudgeSubjectEvidence | null {
  if (!isRecord(value) || !Array.isArray(value.rules)) return null;
  return /* SAFETY: the recorded reader returned the run's own judge evidence, and it states the rules field older records lack. */ value as JudgeSubjectEvidence;
}

function recordedCaseJson(
  repoRoot: string,
  treeRoot: string,
  runId: string,
  rel: string,
  violations: EvidenceLogViolation[],
): { path: string; value: unknown } | null {
  const result = recordedEvidence(join(repoRoot, treeRoot, "runs", runId), rel, violations);
  if (!result.ok) return null;
  return { path: join(treeRoot, "runs", runId, rel), value: capturedJsonParse(result.bytes) };
}

/** Evidence reachable from the packet's rows: the per-case judge verdict and artifact pointer the
 *  eval runner recorded under domains/<slug>/runs/<runId>/cases/<taskId>/. */
function caseSubjects(analysis: IterationAnalysis, repoRoot: string): ContestedSubject[] {
  const verifiedOnce = runDirVerifier();
  const runDir = join(repoRoot, analysis.treeRoot, "runs", analysis.runId);
  const violations = verifiedOnce(runDir);
  return analysis.cases.map((row) => {
    const recorded = (rel: string) =>
      recordedCaseJson(
        repoRoot,
        analysis.treeRoot,
        analysis.runId,
        join("cases", row.taskId, rel),
        violations,
      );
    // Only a truth-verified case has a Judge verdict to compare; the others are never read.
    const judge = row.truthOk === null ? null : recorded(CASE_JUDGE_FILE);
    const artifact = row.truthOk === null ? null : recorded(CASE_ARTIFACT_FILE);
    const verifier = row.truthOk === false ? recorded("verifier.json") : null;
    // The row's `truthOk` carries the verifier's verdict; its receipts are opened only for a fail,
    // to name the checks that failed.
    const receipts =
      isRecord(verifier?.value) && Array.isArray(verifier.value.checkReceipts)
        ? verifier.value.checkReceipts
        : [];
    return {
      taskId: row.taskId,
      family: row.family,
      truthOk: row.truthOk,
      judgePath: judge?.path ?? null,
      judgeEvidence: judge === null ? null : asCurrentJudgeEvidence(judge.value),
      artifactPath: artifact?.path ?? null,
      failedCheckIds: receipts.flatMap((receipt) =>
        isRecord(receipt) && receipt.passed === false && isString(receipt.checkId) ? [receipt.checkId] : [],
      ),
    };
  });
}

/** The census projection's source: the battery's recorded JudgeEvidence, re-derived before it is
 *  used. Evidence failing its own integrity check is refused with the violation as the reason
 *  (a contradictory aggregate is a defect, not evidence), never projected into findings. */
function batteryCensus(analysis: IterationAnalysis, repoRoot: string): CensusAttempt {
  const { runId } = analysis;
  const rel = batteryPath(analysis.treeRoot, runId);
  if (!existsSync(join(repoRoot, rel))) return { census: null, reason: `${rel} is not on disk` };
  const recorded = recordedEvidence(dirname(join(repoRoot, rel)), BATTERY_FILE);
  if (!recorded.ok) return { census: null, reason: `${rel}: ${recorded.refusal}` };
  const judgeEvidence = parseJsonAs<{ judge?: JudgeEvidence }>(recorded.bytes).judge;
  if (judgeEvidence === undefined) return { census: null, reason: `${rel} carries no judge evidence` };
  try {
    validateJudgeEvidence(judgeEvidence);
  } catch (error) {
    return { census: null, reason: `${rel}: ${errorMessage(error)}` };
  }
  if (judgeEvidence.judge === "off") {
    return { census: null, reason: 'the evidence says judge:"off", so this battery had no judge' };
  }
  return { census: { runId, evidence: judgeEvidence }, reason: null };
}

/** Why the review does not cover every offered case; null when it does. Disclosure only: complete
 *  disagreements are advice either way. */
function censusHold(attempt: CensusAttempt, subjects: readonly ContestedSubject[]): string | null {
  if (subjects.length === 0) return null;
  if (attempt.census === null) return `the battery has no census: ${attempt.reason}`;
  const { verdicts, censusSize, decision } = attempt.census.evidence;
  if (verdicts.battery === censusSize.battery) return null;
  return `the judge review is incomplete (${decision}): ${verdicts.battery}/${censusSize.battery} battery verdicts returned`;
}

function judgeExit(contested: readonly ContestedCase[], verified: number): JudgeExit {
  const verifierFailJudgePass = contested.filter(
    (row) => row.verifier === false && row.judge === true,
  ).length;
  const verifierPassJudgeFail = contested.length - verifierFailJudgePass;
  const vetoed = contested.filter(isVetoed).length;
  const base = { verifierFailJudgePass, verifierPassJudgeFail, verified };
  if (contested.length === 0) {
    return {
      ...base,
      kind: "none",
      reason: "the Judge and the verifier agreed on every reviewed verified case",
    };
  }
  return {
    ...base,
    kind: "advisory",
    // What `vetoed` counts is a cited fail a second sample repeated, and the clause used to read
    // "N citing shown rules". c1d2a7's round two reported "0 citing shown rules" for a fail that
    // cited one — the catalogue-mass rule, with a 0.00061 kg disagreement against a 0.0005 kg
    // tolerance — and was not repeated on the re-sample. The author reads this sentence to decide
    // whether the disagreement is worth its attention, so it names both halves.
    reason: `the Judge disagreed with the verifier on ${contested.length} of ${verified} verified cases (${verifierFailJudgePass} verifier-fail/Judge-pass, ${verifierPassJudgeFail} verifier-pass/Judge-fail); ${vetoed} were vetoes, a cited fail of a verifier pass that a second sample repeated, which is what the epoch reviewer settles; the verifier decides every pass`,
  };
}

/** One advisory row naming the contested families. A family is an authoring identity; the no-hints
 *  rule withholds task ids, which are failure locations. */
function exitFindings(
  analysis: IterationAnalysis,
  exit: JudgeExit,
  contested: readonly ContestedCase[],
): AnalysisFinding[] {
  if (exit.kind === "none") return [];
  const families = [...new Set(contested.map((row) => row.family))].sort();
  return [
    {
      kind: "judge-disagreement",
      claim: `${exit.reason}; the contested cases lie in families: ${families.join(", ")}`,
      evidence: join("campaigns", analysis.slug, "analysis", `${analysis.runId}-judges.json`),
      proposedOwner: null,
      severity: "advisory",
    },
  ];
}

/** Revalidate the battery's recorded main-Judge review, name every contradiction, and state the
 *  advisory Judge exit. No model call happens on this path. */
export function runJudgeReviews(analysis: IterationAnalysis, deps: JudgeReviewDeps): JudgeReviewsResult {
  const subjects = caseSubjects(analysis, deps.repoRoot);
  const attempt = batteryCensus(analysis, deps.repoRoot);
  const provisional = censusHold(attempt, subjects);
  // Each declared check's assertion joined to its id, so a citation names the check that passed it.
  const brief = readValidatedBrief(join(deps.repoRoot, analysis.treeRoot));
  const byAssertion = new Map(brief?.truthChecks.map((check) => [check.assertion, check.id] as const) ?? []);
  const contested = attempt.census === null ? [] : contestedCases(subjects, byAssertion);
  const verified = analysis.cases.filter((row) => row.truthOk !== null).length;
  const exit = judgeExit(contested, verified);
  const absent: string[] = [];
  if (attempt.census === null) absent.push(`main-judge census: no census to read (${attempt.reason})`);
  const result: JudgeReviewsResult = {
    schema: JUDGE_REVIEWS_SCHEMA,
    slug: analysis.slug,
    runId: analysis.runId,
    judgePin: deps.judgePin,
    promptPolicyDigests: ACTIVE_JUDGE_PROMPT_DIGESTS,
    analysisDigest: hashJsonBytes(analysis),
    census: attempt.census,
    contested,
    coverage: {
      reviewable: attempt.census?.evidence.censusSize.battery ?? 0,
      reviewed: attempt.census?.evidence.verdicts.battery ?? 0,
    },
    provisional,
    exit,
    findings: exitFindings(analysis, exit, contested),
    absent,
  };
  safeguardJudgeReview(
    result,
    analysis.cases.filter((row) => row.truthOk === false).length,
    deps.safeguardContext,
  );
  return result;
}
