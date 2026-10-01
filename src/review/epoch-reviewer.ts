/**
 * The epoch reviewer asks whether measured passes reflect the requested capability or a weakness in
 * the evaluation. It is the one model-facing component allowed to read the protected verifier
 * material (operator decision) alongside the tasks, the agent code and the correctness model,
 * because that is the only vantage point from which a pass and the reason it was awarded can be
 * compared. The same reader inspects an authoring checkpoint before measurement too, judging the
 * source against the request and claiming no run result, since nothing has run.
 *
 * A session is three questions asked in order.
 *
 *   May this review run at all?   `openSession` — the slot, the tree on disk, and whether this
 *                                 exact condition and procedure were already read to completion.
 *                                 Every no is recorded as `skipped` with its reason, so a campaign
 *                                 never reads an absent review as a clean one.
 *   What is the reviewer shown?   `orientation` and the three tools: read_source over a closed
 *                                 path set, probe_check within its budget, one finding recorder.
 *   What came back?               `recordedReview` — coverage, probes, every finding the host
 *                                 admitted, and, only from a turn that finished, the report.
 *
 * `epoch-review-findings.ts` owns what a review is worth afterwards and what the reviewer may
 * record. Its authority is deliberately small: one finding tool, one budgeted experiment tool, at
 * most six findings, none naming an individual task and each admitted at the severity its own
 * evidence supports, and no power over a pass, an acceptance, a claim or a promotion. Several may
 * block; how many owners a round reopens is the continuation's decision (`src/run/next-move.ts`). A
 * completed review may also dispute a standing issue as the evaluation's, which withholds its agent
 * advice so the next authoring pass does not rebuild the agent around a defect it lacks.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { existsSync, mkdirSync, readFileSync } from "../meta/filesystem.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { join, relative } from "../meta/path.ts";
import type { IterationAnalysis } from "../analyse/iteration-analysis.ts";
import {
  isStanding,
  type AdviceIssue,
  type RebuildAdvicePacket,
  adviceTotals,
  blockingLine,
  diagnosisLine,
} from "../author/rebuild-advice.ts";
import type { RehearsalRow } from "../builder/harness-trial.ts";
import { familyTally } from "../claim/case-record.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { boundText } from "../meta/bounded-text.ts";
import { writeCompleted } from "../meta/completed-json.ts";
import { type ClimbReadout, readClimbReadout, readingSentence } from "../run/climb-readout.ts";
import { selectedProductDir } from "../run/product-versions.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { keyIfDefined, keysIf } from "../meta/optional-key.ts";
import { type ReviewChoice, backendConditionPin } from "../backends/resolve.ts";
import type { RunObserver } from "../observe/run-observer.ts";
import type { ProviderResourceBudget } from "../run/provider-resource-budget.ts";
import { type ReaderTurn, readerPhase, runReaderTurn } from "./review-reader.ts";
import { emptyProbeState, probeTool } from "./review-probe.ts";
import { type AdvisoryDefect, type Demonstrations, NOTHING_CARRIED, advisoryRecord } from "./review-carry.ts";
import { EPOCH_REVIEW_PROMPT } from "./epoch-review-prompt.ts";
import type { EnabledReview } from "./review-session.ts";
import type { ContestedCase, ContestedKind } from "../analyse/judge-contested.ts";
import {
  type ReviewInventory,
  type ReviewVerifierEvidence,
  deliveredSource,
  readSourceTool,
  type ToolchainReach,
  TOOLCHAIN_PREFIX,
  namedTexts,
  toolchainReach,
  reviewCoverage,
  reviewInventory,
  reviewVerifierEvidence,
} from "./review-sources.ts";
import { draftTaskRows } from "../run/experiment-freeze.ts";
import {
  EPOCH_REVIEW_SCHEMA,
  type EpochReviewEvidence,
  type ReviewState,
  type SettlementCase,
  briefIdentities,
  epochReviewOutcome,
  measuredConditionOf,
  earlierTaskFindings,
  measuredAdvisory,
  recordFindingTool,
  reviewOfCondition,
} from "./epoch-review-findings.ts";
import { TASKS_FILE } from "../meta/bundle-layout.ts";
import { earlierTaskFindingLines } from "./epoch-review-public.ts";

export interface EpochReviewInput {
  repoRoot: string;
  slug: string;
  runId: string;
  treeRoot: string;
  /** Null before measurement; the same reader then reviews source without a capability claim. */
  analysis: IterationAnalysis | null;
  /** The latest recorded advice packet, or null when none exists. Two parts of it reach the review:
   *  the standing issues it may dispute unless `disputable` names them, and — at an authoring
   *  checkpoint alone — the counts of the battery the packet was derived from. Its run id also finds
   *  the previous battery's review, whose advisory defects this one is shown. Nothing a reader of
   *  this review's own battery attaches is in either, so nothing circular crosses. */
  priorAdvice: RebuildAdvicePacket | null;
  /** The standing issues this review may dispute, when the caller holds a newer register than
   *  `priorAdvice`: a measured battery's own, advanced by its host and Judge evidence, so an issue
   *  the battery raised for the first time is disputable in that battery rather than the next one.
   *  Absent, the standing issues of `priorAdvice`. */
  disputable?: readonly AdviceIssue[];
  /** Whether the prior packet's battery measured the version the tree under review was seeded from,
   *  read off the controller ledger. False means the packet measured a candidate this tree is not,
   *  and null leaves the comparison unmade rather than guessing; `whoseBattery` words all three, so
   *  that a null cannot fall through to the confident sentence and assert what it withholds. */
  priorAdviceOnSeededTree?: boolean | null;
  /** The contested cases the review must settle (`mustSettle`): vetoes, and verifier fails the Main
   *  Judge passed with the failing checks on record. Empty at an authoring
   *  checkpoint and for batteries reviewed without a Judge. */
  settle?: readonly ContestedCase[];
  /** Every other case the Judge and the verifier decided differently — unconfirmed, or a failing
   *  case with no deciding check on record. Offered to read beside the settlement work, never owed. */
  otherContested?: readonly ContestedCase[];
  /** The round's blind rehearsals, at an authoring checkpoint alone. */
  rehearsals?: readonly RehearsalCase[];
  /** What the previous authoring review of this round carried, at an authoring checkpoint alone.
   *  Its probes hold counterexample values, so the next reviewer is their one reader. */
  demonstrations?: Demonstrations;
  review: ReviewChoice;
  publicRequest: string | null;
  observer?: RunObserver;
  providerBudget?: ProviderResourceBudget;
  /** The reader turn, injectable so that tests exercise the real tools, the real orientation and
   *  the real admission rules without a provider call: those rules all live on this side of the
   *  model. */
  readerTurn?: typeof runReaderTurn;
}

/** One blind rehearsal under the measured projection: the bytes the Built solver submitted, or null
 *  when it accepted none, and the one verdict the declared checks gave them. `current` says whether
 *  it solved the bytes under review rather than an earlier draft. */
export interface RehearsalCase {
  ordinal: number;
  taskId: string;
  family: string | null;
  verdict: RehearsalRow["verdict"];
  artifact: string | null;
  current: boolean;
}

type ReviewCoverage = ReturnType<typeof reviewCoverage>;

/** A session that may read, carrying everything the read depends on, or one that may not and
 *  already knows what it owes its campaign. Both arms hold evidence, because a refused review still
 *  writes a record; a refusal an earlier review stands in for carries that review too. */
type OpenSession =
  | { admitted: false; evidence: EpochReviewEvidence; earlier?: EpochReviewEvidence }
  | {
      admitted: true;
      review: EnabledReview;
      evidence: EpochReviewEvidence;
      root: string;
      analysisDir: string;
      verifier: ReviewVerifierEvidence;
    };

/**
 * The question a placement opens. A battery on the aim opens the one a battery below it opens: its
 * fails locate a limit only where the checks that failed it are right, and a false rejection placed
 * on the aim reads exactly like a limit reached.
 *
 * The two sides do not open the same question. Above the aim the question is whether the tasks
 * demand too little of the request, and "they were easy, and I found no obligation they leave
 * undemanded" is an answer to it: a finding required by the score alone presses the author to add
 * rules the request never held. Below the aim the count says the opposite, and two things produce
 * it without the tasks being hard at all: a rule the checks apply that the brief does not publish,
 * and a valid answer the writer tool cannot express. Each of those fails every task, which is what
 * hardness looks like from the count, and neither can be told from hardness by the count alone.
 *
 * This review is where they become separable, because `probe_check` runs the declared checks here
 * and the Builder never sees a verifier verdict at all. The probe runs in the opposite direction on
 * the two sides: above the aim it looks for a check that does not move on a field the request
 * constrains, below it for one that moves on a field the brief leaves free. Below the aim the
 * first probe goes to the check the orientation lists first under verified failures, the one that
 * blocked the most: a check reading narrower than its published rule fails valid work and reads
 * exactly like difficulty from the counts. That instruction is the reviewer's own, which is why it
 * is the reviewer's alone.
 */
const PLACEMENT_LEADS = {
  above:
    // ABLATED(easy-result): the clause that reads easy tasks as a result to report. A battery that passes
    // whole found no limit, and the guard against a finding on the score alone stays in "a lead, not a
    // finding on its own" (AGENTS.md "Ablated components").
    // " A placement above the aim is a lead, not a finding on its own: it asks which obligation of the request those tasks do not demand, or demand only one at a time, and tasks that were easy while leaving none undemanded are a result to report, not a defect to record.",
    // ADDED(easy-result): the same lead without that clause.
    " A placement above the aim is a lead, not a finding on its own: it asks which obligation of the request those tasks do not demand, or demand only one at a time.",
  below:
    " A placement on or below the aim is a lead, not a finding on its own, and hardness is the last of its readings rather than the first. A rule the checks apply that the brief does not publish fails every task: probe an accept control at a field the public contract leaves free, and a check that moves on it is that rule, owned by `correctness-model/brief.json`. Where the verified failures are listed by declared check, start from the first one listed: probe at a path it reads, with a value a practitioner of the request would accept and the published rules allow, and say whether it reads narrower than its rule, wider, or as stated. An answer a correct solver cannot write through the tools it was given fails every task too, owned by `agent/tools-spec.json`; the accept controls are the shapes the writer is known to produce. Record an observation of hardness, owned by correctness-model/tasks.json, once you have read the brief and the writer schema against the artifact and neither holds.",
};

/** What each side did with a contested case, in the words the reviewer reads it in. */
const CONTESTED_WORDS: Record<ContestedKind, { verifier: string; judge: string }> = {
  veto: { verifier: "passed", judge: "failed it" },
  "unconfirmed-fail": { verifier: "passed", judge: "failed it" },
  "disputed-pass": { verifier: "failed", judge: "passed it" },
};

/** The settlement work a review owes beyond its source: each contested case with its direction, its
 *  checks and its artifact bytes, and each standing issue it may dispute. `reviewOfCondition`
 *  compares this digest, so what goes into it decides when a review is repeated. A readable artifact
 *  is identified by its bytes rather than its run-bound path, so remeasuring a case that produced
 *  identical bytes buys no second reading; an unreadable artifact contributes its path instead. */
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
    settle: cases(input.settle),
    issues: issues.map((issue) => issue.id).sort(),
  });
}

/** The standing issues a review may dispute, which is the only set worth offering: an issue
 *  already disputed, retired, or absent from the last battery is not directing an authoring pass,
 *  so arguing against it would change nothing. */
const disputableIssues = (input: EpochReviewInput) =>
  input.disputable ?? (input.priorAdvice?.issues ?? []).filter(isStanding);

/** Decide whether this review reads anything, and settle the condition it would read under. The
 *  verifier identity is part of that condition and so is resolved before the reuse question: the
 *  same product measured by a different verifier is a different condition. */
function openSession(input: EpochReviewInput): OpenSession {
  const { analysis, repoRoot, treeRoot } = input;
  const analysisDir = join(campaignDir(repoRoot, input.slug), "analysis");
  const measured =
    analysis === null
      ? null
      : measuredConditionOf({
          ...analysis.identities.bundleSnapshot,
          builtPin: analysis.identities.backendPin,
          builtEffort: analysis.identities.builtEffort,
          verifierIdentity: null,
        });
  // Every field a skipped or failed review still owes its campaign, filled in before anything can
  // refuse the read. `requestDigest` is the procedure's identity — request, policy version, prompt
  // text — so a review recorded under a different prompt or policy cannot stand in for this one.
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
      // ABLATED(easy-result): policy: "review-probing-findings/v14",
      // ADDED(easy-result): a review under this arm's text is not reused for the control's.
      policy: "review-probing-findings/v14+easy-result",
      prompt: EPOCH_REVIEW_PROMPT,
    }),
    obligationsDigest: obligationsDigest(input, disputableIssues(input)),
    reads: [],
    dispositions: [],
    unsettled: settlementCases(input).map((row) => row.taskId),
    coverage: { files: 0, opened: 0, chars: 0 },
    findings: [],
    disputes: [],
    report: null,
  };
  const { review } = input;
  if (!review.enabled) return { admitted: false, evidence: { ...blank, reason: "review-slot-off" } };
  const root = join(repoRoot, treeRoot);
  if (!existsSync(root)) {
    const reason = `source tree ${treeRoot} is not on disk`;
    return { admitted: false, evidence: { ...blank, status: "failed", reason } };
  }
  // An authoring checkpoint has no recorded battery, so there is no verifier execution to cover.
  const verifier =
    analysis === null
      ? { identity: null, tools: {}, unavailable: null }
      : reviewVerifierEvidence(root, input.runId);
  const condition =
    measured === null ? null : measuredConditionOf({ ...measured, verifierIdentity: verifier.identity });
  const evidence = { ...blank, condition, verifier };
  const earlier =
    condition === null
      ? undefined
      : reviewOfCondition(analysisDir, condition, { ...evidence, reviewerPin: backendConditionPin(review) });
  if (earlier !== undefined) {
    return { admitted: false, evidence: { ...evidence, reason: "condition-already-reviewed" }, earlier };
  }
  return { admitted: true, review, evidence, root, analysisDir, verifier };
}

/** Per-family passed/verified counts for the review to read. A family that never fails is worth
 *  inspecting, because tasks that cannot distinguish solvers are how an evaluation goes quiet; but
 *  a pass rate establishes nothing about the checks, so the finding still comes from the source. */
function familyLine(analysis: IterationAnalysis): string {
  return (
    [...familyTally(analysis.cases)]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([family, { passed, verified }]) => `${family} ${passed}/${verified}`)
      .join(", ") || "none"
  );
}

/** The contested artifact's path relative to the measured tree, the form read_source's closed path
 *  set is spelled in; an absolute path matches no entry the reviewer may open. Null when the record
 *  refused the artifact, and the orientation says so rather than offering a dead path. */
function contestedArtifact(treeRoot: string, row: ContestedCase): string | null {
  return row.artifact === null ? null : relative(treeRoot, row.artifact);
}

/** The cases the Judge and the verifier settled differently, in the one shape both directions
 *  share: which side each took, the reason it gave, and where the artifact is. A veto or a disputed
 *  fail is settled here, and only by reading the artifact against the rule the Judge cited, so the
 *  line carries the path rather than a summary of the disagreement. */
function contestedLines(input: EpochReviewInput): string[] {
  const line = (label: string, row: ContestedCase, middle: string) =>
    `${label}: ${row.taskId} (${row.family}) ${middle}: ${row.rationale ?? "(no reason recorded)"}. Artifact: ${contestedArtifact(input.treeRoot, row) ?? "not recorded"}.`;
  const cited = (row: ContestedCase) => row.rules.map((rule) => capturedJsonStringify(rule)).join(", ");
  return [
    ...(input.settle ?? []).map((row) =>
      row.kind === "veto"
        ? line(
            "Vetoed",
            row,
            `passed ${row.checkIds.join(", ") || "the verifier"}; the Judge cited ${cited(row)}`,
          )
        : line(
            "Disputed fail",
            row,
            `failed ${row.checkIds.join(", ")}; the Judge ${CONTESTED_WORDS[row.kind].judge}`,
          ),
    ),
    ...(input.otherContested ?? []).map((row) =>
      line(
        "Also contested, not required to settle",
        row,
        `the verifier ${CONTESTED_WORDS[row.kind].verifier} it${row.checkIds.length > 0 ? ` on ${row.checkIds.join(", ")}` : ""} and the Judge ${CONTESTED_WORDS[row.kind].judge}`,
      ),
    ),
  ];
}

/** The name read_source returns a rehearsal's submitted bytes under. */
const rehearsalName = (row: RehearsalCase) => `rehearsal:${row.ordinal}:${row.taskId}`;

/**
 * The round's blind rehearsals, each with the one verdict it earned and the name its bytes are read
 * by. A rehearsal is where a solver holding only the public contract met the declared checks before
 * measurement, so a failed one can be the first sign that a rule admits two readings. The reviewer
 * is shown the solver's reading, and which rule it bears on is settled from the source.
 */
function rehearsalLines(rehearsals: readonly RehearsalCase[]): string[] {
  if (rehearsals.length === 0) return [];
  return [
    "Blind rehearsals this round. The Builder ran each on one task with the measured Built solver, which saw only the public contract, and was shown the verdict alone. read_source returns what the solver submitted under the name each line gives. A rehearsal carries no check result, verifier output or failure location: a failed one is a lead on how a solver reads the public contract, to weigh against the brief and the checks, and the finding still comes from the source.",
    ...rehearsals.map((row) => {
      const earlier = row.current ? "" : ", solved against earlier bytes than the tree under review";
      const note = row.artifact === null ? ", nothing submitted" : earlier;
      return `- ${rehearsalName(row)} (${row.family ?? "no family"}): ${row.verdict}${note}.`;
    }),
  ];
}

/**
 * Each carried probe as the probe_check call that re-runs it and the checks it moved. Its number
 * stays behind, since it numbered a probe of another review and this review's own numbering starts
 * again at one: a finding here rests on the probe this review runs, and on nothing it was shown.
 * Then each check a carried finding or probe named that the brief under review no longer declares,
 * as a fact: a reviewer shown only the probe of a deleted check reads the deletion as a repair. A
 * brief declaring no check, as an unreadable one reads, proves no removal.
 */
function demonstrationLines({ probes, named }: Demonstrations, declared: readonly string[]): string[] {
  const namers = new Map<string, string>();
  for (const { checkId, severity } of named) {
    if (severity === "blocking" || !namers.has(checkId)) {
      namers.set(checkId, `the previous review's ${severity} finding named`);
    }
  }
  for (const checkId of probes.flatMap((row) => row.movedCheckIds)) {
    if (!namers.has(checkId)) namers.set(checkId, "a carried probe moved");
  }
  const gone = [...namers].flatMap(([checkId, namer]) =>
    declared.length === 0 || declared.includes(checkId)
      ? []
      : [`Check ${checkId}, which ${namer}, is no longer declared in this candidate's brief.`],
  );
  if (probes.length === 0) return gone;
  return [
    "Probes the previous review of this round rested its findings on, as it ran them against the bytes it read. Re-run any you rely on with probe_check, since the tree may have changed, and cite the new numbers: a line here is a lead, not a probe of this review, and backs no finding.",
    ...probes.map(({ controlId, path, change, movedCheckIds }) => {
      const moved =
        movedCheckIds.length === 0 ? "no declared check moved" : `moved ${movedCheckIds.join(", ")}`;
      return `- probe_check ${capturedJsonStringify({ controlId, path, ...change })}: ${moved}.`;
    }),
    ...gone,
  ];
}

/**
 * Whose battery the prior counts describe, which is the other half of showing them at all. The
 * issue register advances on every measured battery, held candidates included, because an issue
 * that survived a held candidate is still an issue — but the tree seeded for the next authoring
 * pass is then the version that candidate failed to displace, not the one those counts measured. A
 * reviewer told "the previous battery of this product" about counts over tasks it cannot see reads
 * a contradiction, and spends a finding on it that costs the next authoring pass
 * a round. So the sentence says which battery it is, and where the ledger could not answer it says
 * that rather than falling through to the confident wording.
 */
function whoseBattery(runId: string, counts: string, onSeededTree: boolean | null): string {
  if (onSeededTree === null) {
    return `A previous battery of this campaign (${runId}) ${counts}. Which product version it measured is not recorded, so read the counts as evidence about the campaign rather than as a description of these bytes.`;
  }
  if (onSeededTree) return `The previous battery of this product (${runId}) ${counts}.`;
  return `A previous battery of this campaign (${runId}) ${counts}. Its candidate was not adopted, so the tree you are reading is not the one those counts measured: read them as evidence about the campaign, never as a description of these bytes, and expect no family they name to be present here.`;
}

/**
 * What an authoring checkpoint is told about measurement. A checkpoint has no battery of its own,
 * and a reviewer told only that reasons instead from the accept control about what a solver can
 * reach. That inference is unsound in one direction: the author pinned the accept control to the
 * published limit by construction, so probing that a small change loses the check reads as "an
 * all-fail battery is the likely outcome" on limits real batteries then pass entirely. The previous
 * battery's counts are the correction, and they come from the packet the caller already reads for
 * its standing issues rather than from a second reader.
 */
function checkpointLines(input: EpochReviewInput): string[] {
  const advice = input.priorAdvice;
  const head =
    "Authoring checkpoint before measurement. No new battery result or verifier execution is supplied. Review the current source; previous scores and a clear gate do not prove the next result.";
  if (advice === null) return [head];
  const total = adviceTotals(advice.families);
  const families =
    advice.families.map((row) => `${row.family} ${row.passed}/${row.verified}`).join(", ") || "none";
  const counts = `measured ${total.passed} of ${total.verified} verified cases passed, ${total.unaccepted} unaccepted at submission, ${total.nonResults} runtime non-result${total.nonResults === 1 ? "" : "s"}; per family (passed/verified): ${families}`;
  return [
    head,
    whoseBattery(advice.runId, counts, input.priorAdviceOnSeededTree ?? null),
    aimLine(input, () => selectedProductDir(input.repoRoot, input.slug), {
      runId: advice.runId,
      pin: advice.backendPin,
    }),
    "Read it wherever you would otherwise infer what a solver reaches: how wide the feasible set is, whether a published limit is attainable, whether a battery is about to fail. An accept control sits where its author put it and is no sample of solver behaviour.",
  ];
}

/**
 * Where a battery landed against the band the campaign climbs towards.
 *
 * The reviewer is the only component that reads the measured tree against the original request, so
 * it has to be told what a battery aims for: a raw pass count does not say how far above the aim it
 * sits, which is the shape design prior 10 exists to catch. `placeOnBand` already placed each row of
 * the climb readout, so the review takes the readout's own row for the battery and words it through
 * `readingSentence`, the one sentence that states a placement to a model (who hears it is AGENTS.md
 * "Goals and the climb"). Placing it again here would be a second standard, and the sizing decision
 * and this review could then read one battery two ways.
 *
 * The readout is read once, under the pin the battery was measured with, which the caller already
 * holds. It is public: every sentence it sends is stated to the Builder, so nothing protected
 * crosses here. It is a lead and not a verdict, and a readout that cannot be read leaves the
 * counts alone, because this reader is advisory and must not stop the analysis that runs it.
 */
function aimLine(
  input: EpochReviewInput,
  domainDir: () => string,
  battery: { runId: string; pin: string },
): string {
  let readout: ClimbReadout | null;
  try {
    readout = readClimbReadout(domainDir(), battery.pin, { repoRoot: input.repoRoot, slug: input.slug });
  } catch (cause) {
    return `Aim: the climb readout could not be read (${errorMessage(cause)}); read the counts alone.`;
  }
  const { runId } = battery;
  const row = readout?.rows.find((entry) => entry.runId === runId);
  if (readout === null || row === undefined) {
    const excluded = readout?.excluded.find((entry) => entry.runId === runId)?.reason;
    return `Aim: the climb readout holds no row for this battery (${excluded ?? "not recorded"}), so it has no placement; read the counts alone.`;
  }
  if (row.claimRefusal !== null) {
    return `Aim: this battery's claim was refused (${row.claimRefusal}), so the climb readout places it nowhere; read the counts alone.`;
  }
  const { zone, aim, toAim, deciding, wilson } = row;
  if (zone === null || aim === null || toAim === null || deciding === null || wilson === null) {
    const decided = readout.decision.evidence.at(-1)?.runId === runId;
    return decided
      ? `Reading: ${readout.decision.rationale}.`
      : "Aim: the climb readout placed no zone for this battery; read the counts alone.";
  }
  const reading = readingSentence({ deciding, wilson, aim, zone }, readout.band);
  return `${reading ?? ""}${toAim < 0 ? PLACEMENT_LEADS.above : PLACEMENT_LEADS.below}`;
}

/** The standing issues the review may dispute, each with the diagnosis reader's reading of it. The
 *  reviewer is shown the cause as well, which the author is not: the author would adopt a causal
 *  paragraph without checking it, and checking it against the tree is exactly this reader's work. */
function standingIssueLines(issues: readonly AdviceIssue[]): string[] {
  if (issues.length === 0) {
    return ["No issue is standing in the issue register, so nothing here can be disputed."];
  }
  return [
    "Standing issues you may dispute, each with the diagnosis reader's reading where one was recorded:",
    ...issues.map((issue) => {
      const head = `- ${issue.id.slice(0, 12)} (${issue.family}, ${issue.kind}, ${issue.count}/${issue.denominator})`;
      return issue.diagnosis === null
        ? `${head}: no diagnosis recorded.`
        : `${head}: ${diagnosisLine(issue.diagnosis)} Cause: ${issue.diagnosis.cause}`;
    }),
  ];
}

function orientation(
  input: EpochReviewInput,
  inventory: ReviewInventory,
  verifier: ReviewVerifierEvidence,
  issues: readonly AdviceIssue[],
  measured: {
    aim: string;
    earlier: readonly string[];
    declared: readonly string[];
  },
): string {
  const { analysis } = input;
  return [
    `Campaign ${input.slug}, review ${input.runId}, source tree ${input.treeRoot}.`,
    `Original request (verbatim): ${input.publicRequest ?? "(not available to this review)"}`,
    ...(analysis === null
      ? checkpointLines(input)
      : [
          `Battery: ${analysis.battery.summary.passed} of ${analysis.battery.summary.verified} verified cases passed; ${analysis.battery.summary.unaccepted} unaccepted at submission; ${analysis.battery.summary.nonResults} runtime non-result${analysis.battery.summary.nonResults === 1 ? "" : "s"}.`,
          `Per family (passed/verified): ${familyLine(analysis)}.`,
          blockingLine(
            analysis.battery.blockingByCheck,
            analysis.battery.applicableByCheck,
            analysis.battery.summary.verified,
            analysis.battery.summary.passed,
          ),
          measured.aim,
          ...measured.earlier,
        ]),
    ...contestedLines(input),
    ...rehearsalLines(input.rehearsals ?? []),
    ...demonstrationLines(input.demonstrations ?? NOTHING_CARRIED, measured.declared),
    ...standingIssueLines(issues),
    `Read with read_source, then record findings. Files in the review (${inventory.files.length}, truncated: ${inventory.truncated}):`,
    inventory.files.join("\n"),
    `Missing core files or unreadable entries: ${inventory.missing.join(", ") || "none"}.`,
    verifier.unavailable ??
      "Recorded verifier entry points (cell-produced programs are not installed tools):",
    ...Object.entries(verifier.tools).map(
      ([alias, tool]) => `${alias}: ${tool.kind}, ${tool.source}, ${tool.path}, sha256 ${tool.digest}`,
    ),
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** The tool tree the review may read, when the recorded tree digest still covers the tree. */
function toolchainLines(toolchain: ToolchainReach | null): string[] {
  return toolchain === null
    ? []
    : [
        `The recorded verifier tree digest covers the tool tree, which lies outside the coverage this review is held to. Every file and directory in it reads by name as ${TOOLCHAIN_PREFIX}<path>, installed packages included, and a directory reads as its listing (${TOOLCHAIN_PREFIX} alone for the top).`,
      ];
}

/** Resume a reader that stopped while pages remain, and count the resumption. It resumes only
 *  while reads are still arriving: a session that has stopped reading is finishing its synthesis,
 *  not stalling, and pushing it round the same loop again would buy nothing but another turn. */
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

/** What the session recorded. A failed turn keeps everything that happened: its reads, coverage and
 *  probes, and every finding and dispute the host admitted, since each passed the admission a
 *  completed review's does. What an unfinished review may route is its readers' decision, and they
 *  route a failed turn's findings as an incomplete one's. `failure` is an exception the turn or the
 *  probe cleanup raised, which fails the review as a failed turn does; a turn that finished before
 *  its cleanup failed keeps its report. */
function recordedReview(
  evidence: EpochReviewEvidence,
  turn: ReaderTurn & { failure: string | null },
  state: ReviewState,
  coverage: ReviewCoverage,
  verifier: ReviewVerifierEvidence,
): EpochReviewEvidence {
  const settled = {
    ...evidence,
    reviewerPin: turn.pin,
    reads: state.reads,
    dispositions: state.dispositions,
    unsettled: evidence.unsettled.filter(
      (taskId) => !state.dispositions.some((row) => row.taskId === taskId),
    ),
    coverage,
    admission: state.admission,
    findings: state.findings,
    disputes: state.disputes,
    ...keysIf(state.probes.rows.length > 0, () => ({ probes: state.probes.rows })),
  };
  if (turn.error !== null) return { ...settled, status: "failed", reason: turn.error };
  if (turn.failure !== null) {
    return { ...settled, status: "failed", reason: turn.failure, report: turn.text || null };
  }
  return {
    ...settled,
    status: coverage.complete ? "completed" : "incomplete",
    reason: coverage.complete
      ? null
      : (verifier.unavailable ??
        `Source coverage incomplete: truncated=${coverage.truncated}, ${coverage.missing.length} missing or incompletely read entries`),
    report: turn.text,
  };
}

/** The advisory defects the review before this one left: the round's previous review's at an
 *  authoring checkpoint, and the previous battery's completed review's for a measured one. */
function earlierAdvisory(input: EpochReviewInput, analysisDir: string): readonly AdvisoryDefect[] {
  if (input.analysis === null) return input.demonstrations?.advisory ?? [];
  return measuredAdvisory(analysisDir, input.priorAdvice?.runId);
}

/** What a measured battery adds to the session: its placement against the aim, and the task-set
 *  findings earlier reviews of the same task set recorded. */
function measuredContext(input: EpochReviewInput, evidence: EpochReviewEvidence, analysisDir: string) {
  const { analysis } = input;
  if (analysis === null) return { aim: "", earlier: [] };
  return {
    aim: aimLine(input, () => join(input.repoRoot, input.treeRoot), {
      runId: input.runId,
      pin: analysis.identities.backendPin,
    }),
    earlier:
      evidence.condition === null
        ? []
        : earlierTaskFindingLines(earlierTaskFindings(analysisDir, evidence.condition, input.runId)),
  };
}

/** The listed vetoes and disputed fails, as `record_finding` may settle them. `mustSettle` never
 *  lists an unconfirmed fail, so every kind here is a settlement kind. */
function settlementCases(input: EpochReviewInput): SettlementCase[] {
  return (input.settle ?? []).flatMap((row) =>
    row.kind === "unconfirmed-fail"
      ? []
      : [
          {
            taskId: row.taskId,
            family: row.family,
            kind: row.kind,
            checkIds: row.checkIds,
            path: contestedArtifact(input.treeRoot, row),
          },
        ],
  );
}

/** The review's one writer, which `runEpochReview` calls on every way out: a refused session, a
 *  finished or failed turn, and an exception the turn or the probe cleanup raised. */
export function recordEpochReview(repoRoot: string, evidence: EpochReviewEvidence): EpochReviewEvidence {
  const dir = join(campaignDir(repoRoot, evidence.slug), "analysis");
  mkdirSync(dir, { recursive: true });
  writeCompleted(join(dir, `${evidence.runId}-epoch-review.json`), evidence);
  return evidence;
}

/** Read one condition once, and record what came back whether or not the reader finished. A
 *  refused session records its evidence unread rather than nothing, so every campaign round leaves
 *  a review record that says what happened to it, and a review an exception ends is recorded before
 *  the exception propagates: its findings, coverage and probes were admitted before it, and a
 *  caller that never receives a return value has nothing else to write them from. A condition read
 *  before returns the review that read it, whose findings then reach this round too. */
export async function runEpochReview(input: EpochReviewInput): Promise<EpochReviewEvidence> {
  const opened = openSession(input);
  if (!opened.admitted) {
    recordEpochReview(input.repoRoot, opened.evidence);
    return opened.earlier ?? opened.evidence;
  }
  const { review, evidence, root, analysisDir, verifier } = opened;
  const inventory = reviewInventory(root);
  const issues = disputableIssues(input);
  const state: ReviewState = {
    reads: [],
    readChars: 0,
    refused: 0,
    delivered: [],
    probes: emptyProbeState(),
    dispositions: [],
    findings: [],
    disputes: [],
    admission: { continuations: 0, citationRefusals: 0, severityAdjusted: [] },
  };
  const lifetime = join(analysisDir, `${input.runId}-probe-lifetime`);
  const probe = probeTool(root, lifetime, state.probes, verifier.tools);
  const measured = measuredContext(input, evidence, analysisDir);
  const identities = briefIdentities(root);
  const contested = [...(input.settle ?? []), ...(input.otherContested ?? [])].flatMap(
    (row) => contestedArtifact(input.treeRoot, row) ?? [],
  );
  // A rehearsal's bytes are read under its name and, like a contested artifact, lie outside the
  // coverage the review is held to, which counts the tree and the verifier alone.
  const rehearsed = new Map(
    (input.rehearsals ?? []).flatMap((row) =>
      row.artifact === null ? [] : [[rehearsalName(row), row.artifact] as const],
    ),
  );
  const sourcePaths = new Set([
    ...inventory.files,
    ...Object.keys(verifier.tools),
    ...contested,
    ...rehearsed.keys(),
  ]);
  const unread = unreadSourcePrompt(state, sourcePaths);
  // The tool tree is readable beside the source and outside it: not in the coverage the review is
  // held to, and not among the pages the unread prompt resumes the reader for, so the automatic
  // scan reads none of it: every tree file is read by name.
  const toolchain = toolchainReach(root, verifier.tools);
  // The task ids a finding may not name, since a finding is about a family and a claim pinned to
  // one task cannot direct an authoring pass. A measured battery supplies them; at an authoring
  // checkpoint they come from the draft's own task file, and a partial draft still gets a reading.
  // A draft with no task yet names none. An unreadable task file is recorded as a missing core
  // file, which keeps coverage incomplete rather than silently leaving every task id nameable.
  let taskIds: string[] = input.analysis?.cases.map((row) => row.taskId) ?? [];
  if (input.analysis === null) {
    try {
      taskIds = draftTaskRows(root).map((row) => row.taskId);
    } catch {
      inventory.missing.push(TASKS_FILE);
    }
  }
  // The reader rethrows a provider-budget stop, and the probe cleanup throws when a verifier child is
  // left unsettled after a clean turn; either is held until the review is recorded. A cleanup failure
  // behind a failure already on its way up is swallowed by `closeVerifierLifetime`.
  let turn: ReaderTurn = { pin: backendConditionPin(review), text: "", error: null };
  let thrown: { cause: unknown } | null = null;
  const closePhase = readerPhase("epoch-reviewer", input.observer);
  try {
    turn = await (input.readerTurn ?? runReaderTurn)({
      review,
      repoRoot: input.repoRoot,
      role: "epoch-reviewer",
      tools: [
        readSourceTool(root, sourcePaths, state, verifier.tools, namedTexts(rehearsed, toolchain)),
        probe.tool,
        recordFindingTool(
          issues,
          taskIds,
          join("campaigns", input.slug, "analysis", `${input.runId}-epoch-review.json`),
          state,
          { identities, cases: settlementCases(input) },
        ),
      ],
      continuePrompt: unread,
      systemPrompt: EPOCH_REVIEW_PROMPT,
      prompt: [
        orientation(input, inventory, verifier, issues, { ...measured, declared: identities.checkIds }),
        ...toolchainLines(toolchain),
      ].join("\n"),
      ...keyIfDefined("providerBudget", input.providerBudget),
    });
  } catch (cause) {
    thrown = { cause };
  }
  try {
    await probe.close(thrown !== null);
  } catch (cause) {
    thrown ??= { cause };
  }
  const failure =
    thrown === null ? null : boundText(`epoch-reviewer: ${errorMessage(thrown.cause)}`, 300).shown;
  const recorded = recordedReview(
    evidence,
    { ...turn, failure },
    state,
    reviewCoverage(inventory, verifier, state),
    verifier,
  );
  const written = recordEpochReview(input.repoRoot, {
    ...recorded,
    ...advisoryRecord(recorded, earlierAdvisory(input, analysisDir)),
  });
  closePhase(epochReviewOutcome(written));
  if (thrown !== null) throw thrown.cause;
  return written;
}
