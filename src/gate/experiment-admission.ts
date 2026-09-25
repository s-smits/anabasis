/**
 * Whether a captured candidate may be measured as the experiment it declares, judged against the
 * adopted product. These rules read bytes and recorded evidence only; they run no tool, so the
 * pipeline reports them beside the executed stages instead of before them. A scope refusal used to
 * return early, and the author then met conformance, the census and F2 for the first time only
 * after rewriting EXPERIMENT.json — paying two round trips for findings that were already
 * available in the first.
 */
import type { CampaignFeedback } from "../author/campaign-types.ts";
import type { CandidateSnapshot } from "../author/candidate-check.ts";
import { EXPERIMENT_FILE } from "../author/builder-memory.ts";
import {
  type LastBattery,
  repeatedMoveDetail,
  unmovedChangeDetail,
  unreachableTargetDetail,
} from "../author/experiment-plan.ts";
import { BATTERY_SERVED, EVALUATION_SERVED } from "../author/feedback-routing.ts";
import type { FingerprintEvidence } from "../claim/fingerprint.ts";
import { readBoundConformance, recordedVerifierEnvironmentHash } from "../claim/conformance-evidence.ts";
import type { HarnessAuthoring } from "../critic/types.ts";
import { readFileSync } from "../meta/filesystem.ts";
import { canonicalJson } from "../meta/stable-json.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import type { JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { join } from "../meta/path.ts";
import { harnessBundleIdentity } from "../run/climb-battery-admission.ts";
import { productConditionFingerprint, publicBatteryFingerprint } from "../run/climb-history.ts";
import {
  type ExperimentDimension,
  type ExperimentOperation,
  evaluationFilesUnmoved,
  evaluationInvariantClauses,
  publicTaskRows,
  readableFingerprint,
  rebuildEvaluationUnmovedRefusal,
} from "../run/experiment-freeze.ts";
import { compilePublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import { type ContractFinding, controllerValidatedFinding } from "../truth/brief.ts";
import { isControlCorpus } from "../truth/controls.ts";
import { CONTROLS_FILE } from "../meta/bundle-layout.ts";

export interface AdmissionInput {
  experiment?: HarnessAuthoring;
  /** The adopted tree a continuation moves away from; absent on an initial build. */
  adoptedDir?: string;
  /** Admitted findings about the adopted product, not findings on an earlier candidate. */
  feedback?: readonly CampaignFeedback[];
  /** Admitted-history public battery fingerprints for the task-only A→B→A refusal. */
  priorPublicTaskFingerprints?: readonly string[];
  /** The newest measured battery and the plan it was measured under, for the declared-move rule. */
  lastBattery?: LastBattery;
}

/** What this refusal observed is a byte comparison: `publicBatteryFingerprint` hashes the sorted
 *  public inputs, so ids, families and levels are outside the identity and a moved number is inside
 *  it. The text states that comparison and no other. Read wider, it would name a battery that only
 *  moved its published magnitudes as though this check had caught it; it has not, and that
 *  obligation is the authoring prompt's, where a rule no check enforces has its one owner. */
const REPEATED_CONDITION =
  "This fixed product already measured these public inputs: every task's public input is byte-identical to a battery in the admitted history, whatever its ids, families or levels are now called. A new experiment changes what the tasks require of the solver, or changes the product.";

type Baseline = ReturnType<typeof adoptedBaseline>;

/** Whether the candidate keeps the adopted installed verifier and compiled submission schema.
 *  Unproven is neither preserved nor moved, and the three answers stay apart because a missing
 *  baseline proof certifies neither reading: treating it as preserved would let an unmeasurable
 *  change through as a controlled operation, and treating it as moved would deny a candidate that
 *  changed nothing. */
function submissionCondition(
  adoptedDir: string,
  candidate: CandidateSnapshot,
): "preserved" | "moved" | "unproven" {
  try {
    const baseline = readBoundConformance(adoptedDir);
    const { brief, corpus } = candidate.bundle;
    // An empty accept corpus compiles no submission schema, so nothing certifies preservation.
    if (baseline === null || corpus.accept.length === 0) return "unproven";
    const compiled = compilePublicArtifactSchema(
      brief.artifactSchema,
      corpus.accept.map((accept) => accept.artifact),
    );
    return baseline.verifierEnvironmentHash === candidate.verifierEnvironmentHash &&
      baseline.publicArtifactSchemaHash === compiled.sha256
      ? "preserved"
      : "moved";
  } catch {
    return "unproven";
  }
}

/** Public rows and per-input scoring of one tree, keyed by public input rather than task id, so
 *  renaming a retained task cannot hide its scoring change. Null when the tree is unreadable. */
function scoringOf(dir: string) {
  try {
    const corpus = parseJsonAs<JsonValue>(readFileSync(join(dir, CONTROLS_FILE), "utf8"));
    if (!isControlCorpus(corpus)) return null;
    const controls: Array<{ taskId: string }> = [...corpus.accept, ...corpus.reject];
    const rows = publicTaskRows(dir);
    const scoring = new Map<string, string[]>();
    for (const task of rows) {
      const bound = controls
        .flatMap(({ taskId, ...row }) => (taskId === task.taskId ? [canonicalJson(row)] : []))
        .sort();
      const key = canonicalJson(task.publicInput);
      scoring.set(
        key,
        [...(scoring.get(key) ?? []), canonicalJson([task.family, task.hidden, bound])].sort(),
      );
    }
    return { rows, scoring: new Map([...scoring].map(([key, values]) => [key, values.join("\n")])) };
  } catch {
    return null;
  }
}

const SINGLE_OPERATION = {
  harness: "harness-intervention",
  tasks: "task-probe",
  scoring: "evaluation-correction",
} as const;

/** What the accepted bytes moved against the adopted baseline, derived by the host: one moved
 *  dimension is a controlled operation, none a repeat, and several, or no readable baseline proof,
 *  a new baseline that carries no attributable-improvement claim. Expectations, controls and family
 *  of a retained task count as scoring, since the family selects the checks that apply to it. So
 *  does the scoring program, and only that: a reference solve or test rewritten for a new battery
 *  moves what the gate rehearses, not what the verifier decides, which is why `scoringHash` is the
 *  evaluator's own import closure rather than the correctness-model directory. Counting any byte
 *  under correctness-model/ instead calls a candidate a new baseline for a rewritten reference solve
 *  or test, when what it did was one harness intervention or one task probe. */
export function experimentOperation(
  candidate: CandidateSnapshot,
  adoptedDir: string | undefined,
): ExperimentOperation {
  const adopted = adoptedDir === undefined ? null : readableFingerprint(adoptedDir);
  if (adoptedDir === undefined || adopted === null) {
    return { operation: "new-baseline", moved: [], unproven: "no adopted baseline" };
  }
  const submission = submissionCondition(adoptedDir, candidate);
  const [base, next] = [scoringOf(adoptedDir), scoringOf(candidate.snapshotDir)];
  if (submission === "unproven" || base === null || next === null) {
    return {
      operation: "new-baseline",
      moved: [],
      unproven: "baseline verifier, submission schema or battery unreadable",
    };
  }
  const moved: ExperimentDimension[] = [];
  if (adopted.agentHash !== candidate.fingerprint.agentHash) moved.push("harness");
  if (publicBatteryFingerprint(base.rows) !== publicBatteryFingerprint(next.rows)) moved.push("tasks");
  if (
    adopted.scoringHash !== candidate.fingerprint.scoringHash ||
    submission === "moved" ||
    [...next.scoring].some(([key, value]) => (base.scoring.get(key) ?? value) !== value)
  ) {
    moved.push("scoring");
  }
  const before = new Map(adopted.correctnessModelFiles.map((file) => [file.path, file.sha256]));
  const after = new Map(candidate.fingerprint.correctnessModelFiles.map((file) => [file.path, file.sha256]));
  const changedFiles = [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
  const [only] = moved;
  return {
    operation: only === undefined ? "repeat" : moved.length === 1 ? SINGLE_OPERATION[only] : "new-baseline",
    moved,
    ...keyIfDefined("correctnessModelChangedFiles", changedFiles.length > 0 ? changedFiles : undefined),
  };
}

/** The readable adopted baseline and whether the candidate keeps its agent, scoring program,
 *  installed verifier and compiled submission schema: the fixed condition a tasks-scope experiment needs. */
function adoptedBaseline(
  adoptedDir: string | undefined,
  candidate: CandidateSnapshot,
): { dir: string; adopted: FingerprintEvidence; fixed: boolean } | null {
  const adopted = adoptedDir === undefined ? null : readableFingerprint(adoptedDir);
  if (adoptedDir === undefined || adopted === null) return null;
  const fixed =
    adopted.agentHash === candidate.fingerprint.agentHash &&
    adopted.scoringHash === candidate.fingerprint.scoringHash &&
    submissionCondition(adoptedDir, candidate) === "preserved";
  return { dir: adoptedDir, adopted, fixed };
}

const refuse = (code: string, detail: string): ContractFinding =>
  controllerValidatedFinding({ code, path: EXPERIMENT_FILE, detail });

/** Whether the admitted blocking feedback still needs a product repair this candidate did not make. */
function productRepairOwed(
  candidate: CandidateSnapshot,
  baseline: NonNullable<ReturnType<typeof adoptedBaseline>>,
  blocking: readonly CampaignFeedback[],
): boolean {
  if (blocking.every((row) => BATTERY_SERVED.has(row.owner))) return false;
  // Controls and private expectations can repair an evaluator without changing its source hash.
  return !(
    blocking.every((row) => EVALUATION_SERVED.has(row.owner)) &&
    evaluationInvariantClauses(baseline.dir, candidate.snapshotDir, baseline.adopted, candidate.fingerprint)
      .length === 0 &&
    !evaluationFilesUnmoved(
      baseline.dir,
      candidate.snapshotDir,
      baseline.adopted.scoringHash,
      candidate.fingerprint.scoringHash,
    )
  );
}

/** Every independent refusal of the declared scope. Revising the proposal can resolve them without
 *  new bytes, so each is reported at once rather than one per check. */
function candidateProposalRefusals(candidate: CandidateSnapshot, input: AdmissionInput): ContractFinding[] {
  if (candidate.experimentProposal === undefined) return [];
  const baseline = adoptedBaseline(input.adoptedDir, candidate);
  return [
    ...declaredScopeRefusals(candidate, candidate.experimentProposal, baseline),
    ...conditionRefusals(candidate, input, baseline),
  ];
}

/** What EXPERIMENT.json itself claims that the bytes do not support. */
function declaredScopeRefusals(
  candidate: CandidateSnapshot,
  proposal: NonNullable<CandidateSnapshot["experimentProposal"]>,
  baseline: Baseline,
): ContractFinding[] {
  const findings: ContractFinding[] = [];
  if (proposal.scope === "tasks" && baseline?.fixed !== true) {
    findings.push(
      refuse(
        "experiment-scope-mismatch",
        "The tasks proposal does not establish preservation of the adopted agent, scoring program (brief.json and evaluator.ts with every module it imports), installed verifier and compiled submission schema. Reference solves and tests may change with the battery. Restore the fixed condition or revise EXPERIMENT.json to product scope and explain the repair; submit again in this session.",
      ),
    );
  }
  const unmoved =
    baseline === null ? null : unmovedChangeDetail(proposal.change, baseline.adopted, candidate.fingerprint);
  if (unmoved !== null) findings.push(refuse("experiment-change-unmoved", unmoved));
  const unreachable = unreachableTargetDetail(proposal, publicTaskRows(candidate.snapshotDir).length);
  if (unreachable !== null) findings.push(refuse("experiment-target-unreachable", unreachable));
  return findings;
}

/** What the adopted product's history and admitted feedback forbid this experiment to measure. */
function conditionRefusals(
  candidate: CandidateSnapshot,
  input: AdmissionInput,
  baseline: Baseline,
): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const rows = publicTaskRows(candidate.snapshotDir);
  const prints = input.priorPublicTaskFingerprints ?? [];
  const print = publicBatteryFingerprint(rows);
  // The repeat is this product's own earlier reading: another product measuring the exam leaves it
  // open here. A tree whose identity cannot be resolved matches no recorded reading.
  const product =
    baseline === null
      ? null
      : harnessBundleIdentity(baseline.adopted, recordedVerifierEnvironmentHash(baseline.dir));
  if (
    baseline?.fixed === true &&
    product !== null &&
    prints.includes(productConditionFingerprint(product, print)) &&
    evaluationInvariantClauses(baseline.dir, candidate.snapshotDir, baseline.adopted, candidate.fingerprint)
      .length > 0
  ) {
    findings.push(refuse("climb-battery-repeats-history", REPEATED_CONDITION));
  }
  const proposal = candidate.experimentProposal;
  const repeatedMove = proposal === undefined ? null : repeatedMoveDetail(input.lastBattery, proposal);
  if (repeatedMove !== null) findings.push(refuse("climb-battery-repeats-history", repeatedMove));
  const blocking = (input.feedback ?? []).filter((row) => row.severity === "blocking");
  if (baseline?.fixed === true && productRepairOwed(candidate, baseline, blocking)) {
    findings.push(
      refuse(
        "experiment-product-repair-required",
        `The admitted blocking feedback still requires product repair (${[...new Set(blocking.map((row) => row.owner))].join(", ")}). Changing the task battery or its declared scope cannot resolve those product findings; repair the adopted product before measuring another task-only condition.`,
      ),
    );
  }
  return findings;
}

/** Every admission finding on this candidate: an EXPERIMENT.json that could not be captured, a
 *  continuation that moved nothing measured, and a declared scope the bytes do not support. All are
 *  reported; none stops the executed stages. */
export function admissionFindings(candidate: CandidateSnapshot, input: AdmissionInput): ContractFinding[] {
  const unmoved =
    (input.experiment === "build" || candidate.experimentProposal !== undefined) &&
    input.adoptedDir !== undefined
      ? rebuildEvaluationUnmovedRefusal({
          adoptedDir: input.adoptedDir,
          candidate: candidate.fingerprint,
          verifierEnvironmentHash: candidate.verifierEnvironmentHash,
          commit: candidate.commit,
        })
      : null;
  return [
    ...(candidate.proposalFindings ?? []),
    ...(unmoved?.findings ?? []),
    ...candidateProposalRefusals(candidate, input),
  ];
}
