/**
 * The epoch reviewer asks whether measured passes reflect the requested capability or a weakness
 * in the evaluation. It reads tasks, agent code, the correctness model, protected verifier
 * material and, when measured, battery results. At an authoring checkpoint it reviews the source
 * alone and claims no run result.
 *
 * A session answers three questions in order:
 *
 *   May this review run at all?   `openSession`: the slot, the tree on disk, and whether this
 *                                 condition was already reviewed. Every no is recorded as
 *                                 `skipped` with its reason.
 *   What is the reviewer shown?   `orientation` and three tools: read_source over a closed path
 *                                 set, a bounded probe and the finding recorder.
 *   What came back?               `recordedReview`: coverage, probes and, only from a finished
 *                                 turn, the findings.
 *
 * `epoch-review-findings.ts` owns what the reviewer may record and what earlier reviews prove.
 *
 * The reviewer cannot change a pass, an acceptance, a claim or a promotion. It may record at most
 * one blocking harness defect per review, and a finding may dispute a standing issue as belonging
 * to the evaluation, which withholds that issue's agent advice.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { join, relative } from "../meta/path.ts";
import type { IterationAnalysis } from "../analyse/iteration-analysis.ts";
import {
  isStanding,
  type AdviceIssue,
  type RebuildAdvicePacket,
  adviceTotals,
} from "../author/rebuild-advice.ts";
import { type BandPlacement, placeOnBand } from "../claim/battery-difficulty.ts";
import { classifyCaseOutcome } from "../claim/case-record.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { keyIfDefined, keysIf } from "../meta/optional-key.ts";
import type { ReviewChoice } from "../backends/resolve.ts";
import type { RunObserver } from "../observe/run-observer.ts";
import type { ProviderResourceBudget } from "../run/provider-resource-budget.ts";
import { runReaderTurn } from "./review-reader.ts";
import { emptyProbeState, probeTool } from "./review-probe.ts";
import { EPOCH_REVIEW_PROMPT } from "./epoch-review-prompt.ts";
import { reviewSlotPin } from "./review-session.ts";
import type { ContestedCase } from "../analyse/judge-contested.ts";
import {
  type ReviewInventory,
  type ReviewVerifierEvidence,
  deliveredSource,
  readSourceTool,
  reviewCoverage,
  reviewInventory,
  reviewVerifierEvidence,
} from "./review-sources.ts";
import { climbThresholds } from "../run/climb-history.ts";
import { publicTaskRows } from "../run/experiment-freeze.ts";
import {
  EPOCH_REVIEW_SCHEMA,
  type EpochReviewEvidence,
  type ReviewState,
  briefIdentities,
  conditionAlreadyReviewed,
  measuredConditionOf,
  recordFindingTool,
  recurringDefects,
} from "./epoch-review-findings.ts";
import { TASKS_FILE } from "../meta/bundle-layout.ts";

export interface EpochReviewInput {
  repoRoot: string;
  slug: string;
  runId: string;
  treeRoot: string;
  /** Null before measurement; the same reader then reviews source without a capability claim. */
  analysis: IterationAnalysis | null;
  /** The latest recorded advice packet, or null. The review reads its standing issues and, at an
   *  authoring checkpoint, its battery counts. */
  priorAdvice: RebuildAdvicePacket | null;
  /** Whether the prior packet's battery measured the version this tree was seeded from; null when
   *  that is not known. */
  priorAdviceOnSeededTree?: boolean | null;
  /** Verifier passes the Main Judge failed with a citation; each must be settled. Empty at an
   *  authoring checkpoint and for batteries reviewed without a Judge. */
  vetoed?: readonly ContestedCase[];
  /** Verifier fails the Main Judge passed, with the failing checks on record; settled the other way. */
  disputed?: readonly ContestedCase[];
  review: ReviewChoice;
  publicRequest: string | null;
  observer?: RunObserver;
  providerBudget?: ProviderResourceBudget;
  /** Tests exercise the real tools and admission without a provider call. */
  readerTurn?: typeof runReaderTurn;
}

type ReaderTurn = Awaited<ReturnType<typeof runReaderTurn>>;
type ReviewCoverage = ReturnType<typeof reviewCoverage>;

/** A session admitted to read, with what the read needs, or a refused one with its evidence. */
type OpenSession =
  | { admitted: false; evidence: EpochReviewEvidence }
  | {
      admitted: true;
      evidence: EpochReviewEvidence;
      root: string;
      analysisDir: string;
      verifier: ReviewVerifierEvidence;
    };

/** A digest of what the review must settle beyond its source: the contested cases and the
 *  disputable issues. A readable artifact is identified by its bytes, so remeasuring identical
 *  cases is not new work; an unreadable one contributes its path. */
function obligationsDigest(input: EpochReviewInput, issues: readonly AdviceIssue[]): string {
  const bytes = (artifact: string | null) => {
    if (artifact === null) return null;
    try {
      return hashJsonValue(readFileSync(join(input.repoRoot, artifact), "utf8"));
    } catch {
      return null;
    }
  };
  const cases = (rows: readonly ContestedCase[] | undefined) =>
    (rows ?? []).map((row) => ({
      taskId: row.taskId,
      checkIds: row.checkIds,
      rules: row.rules,
      artifact: bytes(row.artifact) ?? row.artifact,
    }));
  return hashJsonValue({
    vetoed: cases(input.vetoed),
    disputed: cases(input.disputed),
    issues: issues.map((issue) => issue.id).sort(),
  });
}

/** The standing issues a review may dispute. */
const disputableIssues = (input: EpochReviewInput) => (input.priorAdvice?.issues ?? []).filter(isStanding);

/** Decide whether this review runs, and the condition it reads under. The verifier identity is
 *  part of the condition, so it is resolved before checking for an earlier review. */
function openSession(input: EpochReviewInput): OpenSession {
  const { analysis, repoRoot, treeRoot } = input;
  const analysisDir = join(campaignDir(repoRoot, input.slug), "analysis");
  const measured =
    analysis === null
      ? null
      : measuredConditionOf({
          ...analysis.identities.bundleSnapshot,
          builtPin: analysis.identities.backendPin,
          verifierIdentity: null,
        });
  // The record a skipped review still writes. `requestDigest` identifies the procedure, so a review
  // under a different prompt or policy cannot stand in for this one.
  const blank: EpochReviewEvidence = {
    schema: EPOCH_REVIEW_SCHEMA,
    slug: input.slug,
    runId: input.runId,
    status: "skipped",
    reason: null,
    condition: measured,
    reviewerPin: null,
    reviewerEffort: input.review.enabled ? (input.review.reasoningEffort ?? null) : null,
    requestDigest: hashJsonValue({
      publicRequest: input.publicRequest,
      policy: "review-probing-findings/v5",
      prompt: EPOCH_REVIEW_PROMPT,
    }),
    obligationsDigest: obligationsDigest(input, disputableIssues(input)),
    reads: [],
    contestedReads: [],
    coverage: { files: 0, opened: 0, chars: 0 },
    findings: [],
    disputes: [],
    report: null,
  };
  if (!input.review.enabled) return { admitted: false, evidence: { ...blank, reason: "review-slot-off" } };
  const root = join(repoRoot, treeRoot);
  if (!existsSync(root)) {
    return { admitted: false, evidence: { ...blank, reason: `source tree ${treeRoot} is not on disk` } };
  }
  // An authoring checkpoint has no recorded battery, so there is no verifier execution to cover.
  const verifier =
    analysis === null
      ? { identity: null, tools: {}, unavailable: null }
      : reviewVerifierEvidence(root, input.runId);
  const condition =
    measured === null ? null : measuredConditionOf({ ...measured, verifierIdentity: verifier.identity });
  const evidence = { ...blank, condition, verifier };
  if (
    condition !== null &&
    conditionAlreadyReviewed(analysisDir, condition, {
      ...evidence,
      reviewerPin: reviewSlotPin(input.review),
    })
  ) {
    return { admitted: false, evidence: { ...evidence, reason: "condition-already-reviewed" } };
  }
  return { admitted: true, evidence, root, analysisDir, verifier };
}

/** Per-family passed/verified counts, sorted by family. */
function familyLine(analysis: IterationAnalysis): string {
  const rows = new Map<string, { verified: number; passed: number }>();
  for (const row of analysis.cases) {
    const outcome = classifyCaseOutcome(row);
    if (outcome !== "pass" && outcome !== "fail") continue;
    const cell = rows.get(row.family) ?? { verified: 0, passed: 0 };
    cell.verified += 1;
    if (row.truthOk === true) cell.passed += 1;
    rows.set(row.family, cell);
  }
  return (
    [...rows.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([family, cell]) => `${family} ${cell.passed}/${cell.verified}`)
      .join(", ") || "none"
  );
}

/** The contested artifact's path under the measured tree, the form read_source delivers; null when
 *  the record refused it. */
function contestedArtifact(treeRoot: string, row: ContestedCase): string | null {
  return row.artifact === null ? null : relative(treeRoot, row.artifact);
}

/** One line per case the Judge and the verifier settled differently, with the artifact to open. */
function contestedLines(input: EpochReviewInput): string[] {
  const line = (label: string, row: ContestedCase, middle: string) =>
    `${label}: ${row.taskId} (${row.family}) ${middle}: ${row.rationale ?? "(no reason recorded)"}. Artifact: ${contestedArtifact(input.treeRoot, row) ?? "not recorded"}.`;
  return [
    ...(input.vetoed ?? []).map((row) =>
      line(
        "Vetoed",
        row,
        `passed ${row.checkIds.join(", ") || "the verifier"}; the Judge cited ${row.rules.map((rule) => capturedJsonStringify(rule)).join(", ")}`,
      ),
    ),
    ...(input.disputed ?? []).map((row) =>
      line("Disputed fail", row, `failed ${row.checkIds.join(", ")}; the Judge passed it`),
    ),
  ];
}

/** Whose battery the prior counts describe. A held candidate's battery did not measure the tree
 *  under review, and an unknown answer is stated as unknown. */
function whoseBattery(runId: string, counts: string, onSeededTree: boolean | null): string {
  if (onSeededTree === null) {
    return `A previous battery of this campaign (${runId}) ${counts}. Which product version it measured is not recorded, so read the counts as evidence about the campaign rather than as a description of these bytes.`;
  }
  if (onSeededTree) return `The previous battery of this product (${runId}) ${counts}.`;
  return `A previous battery of this campaign (${runId}) ${counts}. Its candidate was not adopted, so the tree you are reading is not the one those counts measured: read them as evidence about the campaign, never as a description of these bytes, and expect no family they name to be present here.`;
}

/** What an authoring checkpoint is told about measurement: the prior battery's counts, so the
 *  reviewer does not infer solver reach from an accept control placed at a published limit. */
function checkpointLines(advice: RebuildAdvicePacket | null, onSeededTree: boolean | null): string[] {
  const head =
    "Authoring checkpoint before measurement. No new battery result or verifier execution is supplied. Review the current source; previous scores and a clear gate do not prove the next result.";
  if (advice === null) return [head];
  const total = adviceTotals(advice.families);
  const families =
    advice.families.map((row) => `${row.family} ${row.passed}/${row.verified}`).join(", ") || "none";
  const counts = `measured ${total.passed} of ${total.verified} verified cases passed, ${total.unaccepted} unaccepted at submission, ${total.nonResults} runtime non-results; per family (passed/verified): ${families}`;
  return [
    head,
    whoseBattery(advice.runId, counts, onSeededTree),
    bandLine(total.passed, total.verified),
    "Read it wherever you would otherwise infer what a solver reaches: how wide the feasible set is, whether a published limit is attainable, whether a battery is about to fail. An accept control sits where its author put it and is no sample of solver behaviour.",
  ];
}

/** Where a battery landed against the band, read through `placeOnBand` as the author's readout
 *  reads it. The band is public policy; the placement is a lead, not a verdict. */
function bandLine(passed: number, verified: number): string {
  const placement = placeOnBand(passed, verified, climbThresholds().band);
  return placement === null
    ? `Aim: too few scored cases (${verified}) to place this battery against the band; read the counts alone.`
    : `Aim: ${bandReading(placement)}${lead(placement.toAim)}`;
}

/** The question a placement opens; a battery on the aim opens none. Above the aim the tasks may
 *  demand too little of the request. Below it, an unpublished rule or a writer that cannot express
 *  a valid answer fails every task just as hardness would, and `probe_check` can tell them apart. */
function lead(toAim: number): string {
  if (toAim === 0) return "";
  return toAim < 0
    ? " A placement above the aim is a lead, not a finding on its own: the finding is the obligation of the request those tasks do not demand."
    : " A placement below the aim is a lead, not a finding on its own, and hardness is the last of its readings rather than the first. A rule the checks apply that the brief does not publish fails every task: probe an accept control at a field the public contract leaves free, and a check that moves on it is that rule, owned by `brief`. An answer a correct solver cannot write through the tools it was given fails every task too, owned by `tools-spec`; the accept controls are the shapes the writer is known to produce. Record hardness once you have read the brief and the writer schema against the artifact and neither holds.";
}

function bandReading({ zone, toAim, aim, n, passes }: BandPlacement): string {
  const aimed = `the aim is ${String(aim[0])} to ${String(aim[1])} of ${String(n)}`;
  const above = `${String(passes)} of ${String(n)} passed, ${String(-toAim)} above the aim (${aimed}), so this battery measured no limit of the product.`;
  switch (zone) {
    case "too-easy":
      return `${above} The interval rules the aim out, so the tasks are significantly too easy.`;
    case "over-aim":
      return above;
    case "on-aim":
      return `${String(passes)} of ${String(n)} passed, on the aim (${aimed}): this battery measured the product's limit on its current requirements.`;
    case "under-aim":
      return `${String(passes)} of ${String(n)} passed, ${String(toAim)} short of the aim (${aimed}), but not significantly too hard.`;
    case "too-hard":
      return `${String(passes)} of ${String(n)} passed, ${String(toAim)} short of the aim (${aimed}), and the interval rules the aim out: the battery overshot the solver, and a product whose batteries keep landing here has not eased to the aim.`;
  }
}

function orientation(
  input: EpochReviewInput,
  inventory: ReviewInventory,
  verifier: ReviewVerifierEvidence,
  issues: readonly AdviceIssue[],
): string {
  const { analysis } = input;
  return [
    `Campaign ${input.slug}, review ${input.runId}, source tree ${input.treeRoot}.`,
    `Original request (verbatim): ${input.publicRequest ?? "(not available to this review)"}`,
    ...(analysis === null
      ? checkpointLines(input.priorAdvice, input.priorAdviceOnSeededTree ?? null)
      : [
          `Battery: ${analysis.battery.summary.passed} of ${analysis.battery.summary.verified} verified cases passed; ${analysis.battery.summary.unaccepted} unaccepted at submission; ${analysis.battery.summary.nonResults} runtime non-results.`,
          `Per family (passed/verified): ${familyLine(analysis)}.`,
          bandLine(analysis.battery.summary.passed, analysis.battery.summary.verified),
        ]),
    ...contestedLines(input),
    issues.length === 0
      ? "No issue is standing in the issue register, so nothing here can be disputed."
      : `Standing issues you may dispute: ${issues.map((issue) => `${issue.id.slice(0, 12)} (${issue.family}, ${issue.kind}, ${issue.count}/${issue.denominator})`).join("; ")}.`,
    `Read with read_source, then record findings. Files in the review (${inventory.files.length}, truncated: ${inventory.truncated}):`,
    inventory.files.join("\n"),
    `Missing core files or unreadable entries: ${inventory.missing.join(", ") || "none"}.`,
    verifier.unavailable ??
      "Recorded verifier entry points (binaries return provenance only; cell-produced programs are not installed tools):",
    ...Object.entries(verifier.tools).map(
      ([alias, tool]) => `${alias}: ${tool.kind}, ${tool.source}, ${tool.path}, sha256 ${tool.digest}`,
    ),
  ].join("\n");
}

/** Resume a reader that stopped while pages remain, counting each resumption. It resumes only when
 *  the reader made new reads since the last prompt; a reader that stopped reading is finishing. */
function unreadSourcePrompt(state: ReviewState, sourcePaths: ReadonlySet<string>): () => string | null {
  let lastReads = 0;
  return () => {
    if (
      state.reads.length <= lastReads ||
      [...sourcePaths].every((path) => deliveredSource(state, path).complete)
    ) {
      return null;
    }
    lastReads = state.reads.length;
    state.admission.continuations += 1;
    return "Source remains unread. Continue with read_source({}) to read the next page, then weigh the complete evidence and finish your synthesis. If a read is refused, report the limit.";
  };
}

/** What the session recorded. A failed turn keeps its reads, coverage and probes but drops its
 *  findings, since an unfinished review has not weighed what it read. */
function recordedReview(
  evidence: EpochReviewEvidence,
  turn: ReaderTurn,
  state: ReviewState,
  coverage: ReviewCoverage,
  verifier: ReviewVerifierEvidence,
): EpochReviewEvidence {
  const settled = {
    ...evidence,
    reviewerPin: turn.pin,
    reads: state.reads,
    coverage,
    admission: state.admission,
    ...keysIf(state.probes.rows.length > 0, () => ({ probes: state.probes.rows })),
  };
  if (turn.error !== null) return { ...settled, status: "failed", reason: turn.error };
  return {
    ...settled,
    status: coverage.complete ? "completed" : "incomplete",
    reason: coverage.complete
      ? null
      : (verifier.unavailable ??
        `Source coverage incomplete: truncated=${coverage.truncated}, ${coverage.missing.length} missing or incompletely read entries`),
    findings: state.findings,
    disputes: state.disputes,
    report: turn.text.slice(0, 4_000),
  };
}

/** Review the measured condition once. */
export async function runEpochReview(input: EpochReviewInput): Promise<EpochReviewEvidence> {
  const opened = openSession(input);
  if (!opened.admitted) return opened.evidence;
  const { evidence, root, analysisDir, verifier } = opened;
  const inventory = reviewInventory(root);
  const issues = disputableIssues(input);
  const state: ReviewState = {
    reads: [],
    readChars: 0,
    refused: 0,
    delivered: [],
    probes: emptyProbeState(),
    findings: [],
    disputes: [],
    admission: { continuations: 0, citationRefusals: 0, severityAdjusted: [] },
  };
  const probe = probeTool(root, join(analysisDir, `${input.runId}-probe-lifetime`), state.probes);
  const contested = new Map(
    [...(input.vetoed ?? []), ...(input.disputed ?? [])].flatMap((row) => {
      const path = contestedArtifact(input.treeRoot, row);
      return path === null || row.artifact === null ? [] : [[path, row.artifact] as const];
    }),
  );
  const sourcePaths = new Set([...inventory.files, ...Object.keys(verifier.tools), ...contested.keys()]);
  // Task ids a finding may not name: from the battery, or from a draft's task file. An unreadable
  // task file is recorded as a missing core file.
  let taskIds: string[] = input.analysis?.cases.map((row) => row.taskId) ?? [];
  if (input.analysis === null) {
    try {
      taskIds = publicTaskRows(root).map((row) => row.taskId);
    } catch {
      inventory.missing.push(TASKS_FILE);
    }
  }
  // The probe lifetime closes in `finally`, because the reader rethrows a provider-budget stop.
  let failed = false;
  let turn: ReaderTurn;
  try {
    turn = await (input.readerTurn ?? runReaderTurn)({
      review: input.review,
      repoRoot: input.repoRoot,
      role: "epoch-reviewer",
      tools: [
        readSourceTool(root, sourcePaths, state, verifier.tools),
        probe.tool,
        recordFindingTool(
          issues,
          taskIds,
          join("campaigns", input.slug, "analysis", `${input.runId}-epoch-review.json`),
          state,
          {
            identities: briefIdentities(root),
            recurring:
              evidence.condition === null ? new Map() : recurringDefects(analysisDir, evidence.condition),
          },
        ),
      ],
      continuePrompt: unreadSourcePrompt(state, sourcePaths),
      systemPrompt: EPOCH_REVIEW_PROMPT,
      prompt: orientation(input, inventory, verifier, issues),
      ...keyIfDefined("observer", input.observer),
      ...keyIfDefined("providerBudget", input.providerBudget),
    });
  } catch (cause) {
    failed = true;
    throw cause;
  } finally {
    await probe.close(failed);
  }
  const contestedReads = [...contested].flatMap(([path, artifact]) =>
    state.reads.includes(path) ? [artifact] : [],
  );
  return recordedReview(
    { ...evidence, contestedReads },
    turn,
    state,
    reviewCoverage(inventory, verifier, state),
    verifier,
  );
}
