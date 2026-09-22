/**
 * The epoch reviewer examines whether measured passes reflect the requested capability or a
 * weakness in the evaluation. It reads tasks, agent code, the correctness model and protected
 * verifier material (operator decision 2026-08-15), alongside battery results when available.
 * The same reader can inspect an authoring checkpoint before measurement, where it assesses
 * source requirements without claiming that the draft has succeeded in a run.
 *
 * This file is the reading session, and a session is three questions in order.
 *
 *   May this review run at all?   `openSession` — the slot, the tree on disk, and whether this
 *                                 exact condition and procedure were already read to completion.
 *                                 Every no is recorded as `skipped` with its reason, so a campaign
 *                                 never reads an absent review as a clean one.
 *   What is the reviewer shown?   `orientation` and the three tools — read_source over a closed
 *                                 path set, one bounded probe, one finding recorder.
 *   What came back?               `recordedReview` — coverage, probes and, only from a turn that
 *                                 finished, the findings.
 *
 * What a review is worth afterwards, and what the reviewer may record, belong together in
 * `epoch-review-findings.ts`.
 *
 * Its authority is limited: one finding tool, one bounded experiment, no claim naming a task, at
 * most one routable blocking harness defect per review, and no power over a pass, an acceptance, a
 * claim or a promotion. Its second effect is the issue dispute — a finding may argue that a
 * standing issue belongs to the evaluation rather than the harness, which suspends that issue in
 * the issue register so the next authoring pass does not rebuild the agent around it.
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
  /** The latest recorded advice packet, or null when none exists. Two parts of it reach the
   *  review: the issues it may dispute, and — at an authoring checkpoint — the counts of the
   *  battery the packet was derived from. The packet this review's own battery produces is derived
   *  after it runs, so nothing circular crosses. */
  priorAdvice: RebuildAdvicePacket | null;
  /** Whether the prior packet's battery measured the version the tree under review was seeded
   *  from, where the caller can read it off the controller ledger. False means the packet
   *  measured a candidate this tree is not; null leaves the comparison unmade. */
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

/** A session that may read, with everything the read depends on, or one that may not and already
 *  knows what it owes its campaign. */
type OpenSession =
  | { admitted: false; evidence: EpochReviewEvidence }
  | {
      admitted: true;
      evidence: EpochReviewEvidence;
      root: string;
      analysisDir: string;
      verifier: ReviewVerifierEvidence;
    };

/** The settlement work a review owes beyond its source: each contested case with its direction,
 *  checks and artifact bytes, and each standing issue it may dispute. Bytes rather than the
 *  run-bound path identify a readable artifact, so remeasuring identical cases is not new work;
 *  an unreadable artifact contributes its path. */
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

/** Decide whether this review reads anything, and settle the condition it would read under. The
 *  verifier identity is part of that condition, so it is resolved before the reuse question is
 *  asked: the same product measured by a different verifier is a different condition. */
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
  // Every field a skipped or failed review still owes its campaign. `requestDigest` is the
  // procedure's identity, so a review recorded under a different prompt or policy cannot stand in
  // for this one; that is why the probe moved it to v5.
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

/** Per-family passed/verified counts for review. A family that never fails may merit inspection,
 *  but its pass rate alone cannot establish an evaluation defect. */
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

/** The cases the Judge and the verifier settled differently, in the one shape both directions
 *  share: which side each took, its reason, and where the artifact is for the reviewer to open. */
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

/**
 * What an authoring checkpoint is told about measurement. A checkpoint has no battery of its own,
 * and until now it was told only that: it then reasoned about what a solver can reach from the
 * accept control, which its author pinned to the published limit by construction. Three
 * consecutive reviews of campaign 3fd52f9e-10 did exactly that. Each read the mass limit equal to
 * the accept control's own mass, probed that one catalogue size or one 0.1 m joint move loses the
 * check, concluded that "an all-fail battery is the likely outcome for any solver whose search
 * differs", and asked the next author to publish the limits with deliberate slack. Both batteries
 * measured on those limits passed 6 of 6, from 6.7 to 30.8 per cent under them; the third review
 * wrote its finding after the first of them had settled. The counts come from the packet the
 * caller already reads for its standing issues, so the fix carries a field rather than adding a
 * reader.
 *
 * Whose battery those counts are is the other half. The issue register advances on every measured
 * battery, held candidates included, because an issue that survived a held candidate is still an
 * issue — but the tree seeded for the next pass is then the version that candidate failed to
 * displace, not the one the counts measured. Run de8b40 called i02's 22 of 25 across five families
 * "the previous battery of this product" to a reviewer reading i01's six tasks in three, and the
 * reviewer spent a controller-defect finding on the contradiction it had been handed, closing with
 * "my other findings describe these six tasks, not the 25 that were measured". A finding it did not
 * need costs the next authoring pass a round, so the sentence now says which it is.
 */
/** Whose battery the counts are. The controller ledger answered whether the packet's battery
 *  measured the version this tree was seeded from; null means it could not, and a null that fell
 *  through to the confident sentence was exactly the claim the null was there to withhold. */
function whoseBattery(runId: string, counts: string, onSeededTree: boolean | null): string {
  if (onSeededTree === null) {
    return `A previous battery of this campaign (${runId}) ${counts}. Which product version it measured is not recorded, so read the counts as evidence about the campaign rather than as a description of these bytes.`;
  }
  if (onSeededTree) return `The previous battery of this product (${runId}) ${counts}.`;
  return `A previous battery of this campaign (${runId}) ${counts}. Its candidate was not adopted, so the tree you are reading is not the one those counts measured: read them as evidence about the campaign, never as a description of these bytes, and expect no family they name to be present here.`;
}

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

/**
 * Where a battery landed against the band the campaign climbs towards.
 *
 * The reviewer is the only component that reads the measured tree against the original request,
 * and until 2026-09-18 it was the only one that did not know what a battery aims for. It was shown
 * "20 of 25 verified cases passed" and asked to inspect a "perfect or near-perfect" battery; 20 of
 * 25 is neither, and it is eight passing cases above the top of the aim, which is the shape prior
 * 10 exists to catch. `placeOnBand` already owns that reading for the author's note and for the
 * climb readout, so the review reads the same one rather than inventing a second standard.
 *
 * The band is declared policy, stated to the Builder in every measurement note and in the starter
 * pack, so nothing protected crosses here. It is a lead and not a verdict: what a placement buys
 * the review is a question, and that question is still answered from the source.
 */
function bandLine(passed: number, verified: number): string {
  const placement = placeOnBand(passed, verified, climbThresholds().band);
  return placement === null
    ? `Aim: too few scored cases (${verified}) to place this battery against the band; read the counts alone.`
    : `Aim: ${bandReading(placement)}${lead(placement.toAim)}`;
}

/**
 * The question a placement opens. A battery on the aim opens none: it measured the limit it was
 * climbing towards, so there is nothing about its position to explain.
 *
 * The two sides do not open the same question, and until 2026-09-18 both were handed the one
 * written for the side above the aim, where the tasks demand too little of the request. Below the
 * aim the count says the opposite, and two things produce it without the tasks being hard: a rule
 * the checks apply that the brief does not publish, and a valid answer the writer tool cannot
 * express. Each fails every task, and neither can be told from difficulty by the count alone.
 *
 * This review is where they are separable. The Builder never sees a verifier verdict, so it reads
 * the same count either way; `probe_check` runs the declared checks here. The probe runs in the
 * opposite direction on the two sides: above the aim it looks for a check that does not move on a
 * field the request constrains, below it for one that moves on a field the brief leaves free.
 */
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

/** Resume a reader that stopped while pages remain, and count the resumption. It resumes only
 *  while reads are still arriving: a session that has stopped reading is finishing its synthesis,
 *  not stalling, and pushing it round the same loop again would buy nothing. */
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
 *  findings: a review that did not finish has not weighed what it read, and a half-formed finding
 *  would reopen an authoring area on its own. */
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
  // The tasks this review may name in a finding. A measured battery supplies them; a draft is read
  // from its own task file, and a partial draft still gets a reading. An unreadable battery cannot
  // grant public identities or complete coverage, so it is recorded as a missing core file.
  let taskIds: string[] = input.analysis?.cases.map((row) => row.taskId) ?? [];
  if (input.analysis === null) {
    try {
      taskIds = publicTaskRows(root).map((row) => row.taskId);
    } catch {
      inventory.missing.push(TASKS_FILE);
    }
  }
  // The reader rethrows a provider-budget stop, so the probe lifetime settles in `finally`; an
  // unresolved cleanup is suppressed only behind that propagating failure.
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
