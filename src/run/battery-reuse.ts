/** When a round's battery grades recorded solves instead of solving. Both cases keep every byte the
 *  solver read, so the Built solver would be paid to write artifacts that already exist:
 *
 *  - An evaluation correction after a battery at or above the aim, over the same agent bytes and
 *    the same public tasks, regrades that battery under the corrected evaluator. Below the aim a
 *    correction still measures a fresh battery, because there the question is whether the solver
 *    can reach the tasks at all, which regrading its old attempts cannot answer.
 *  - A battery whose every non-result the environment owns, on the product still selected,
 *    re-solves exactly those cases and regrades the rest, which is what the analysis finding
 *    "rerun without changing the harness" promises. A rebuild in its place would author against a
 *    measurement the environment cut short. */
import { existsSync } from "../meta/filesystem.ts";
import { isString } from "../meta/json-shape.ts";
import { dirname, join } from "../meta/path.ts";
import { FROZEN_MANIFEST_PATH } from "../critic/manifest.ts";
import { POLICY } from "../critic/policy.ts";
import { ENVIRONMENT_OWNED_NONRESULT_KINDS } from "../claim/record-events.ts";
import { fingerprintSlug } from "../claim/fingerprint.ts";
import { bundleSnapshotToolTree } from "../claim/bundle-snapshot.ts";
import { CASE_RECORD_FILE, readCaseRecord } from "../claim/case-record.ts";
import type { SlotChoice } from "../backends/resolve.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { canonicalJson } from "../meta/stable-json.ts";
import {
  type BatteryRecord,
  readRecordedBatteryRecord,
  toolTreeDigestOf,
} from "../correctness-bundle/battery-record.ts";
import { readPublicResources } from "../correctness-bundle/public-resources.ts";
import {
  type BatteryReuse,
  readRecordedSolves,
  recordedTaskMatches,
} from "../correctness-bundle/recorded-solve.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { ExperimentAuthoring } from "./experiment-freeze.ts";
import { claimsDirFor } from "./claim-write.ts";
import { retainedRunDir } from "./climb-history.ts";
import { type ClimbReadout, readClimbReadout } from "./climb-readout.ts";
import { selectedProductDir } from "./product-versions.ts";
import { batteryCondition, loadRecordedTasks } from "./run-driver.ts";

/** A candidate that poses the exam a recorded battery already sat, with the same agent. */
interface IdenticalExam {
  runId: string;
  /** Distance of that battery's passes to the aim; at most zero here, since only a battery at or
   *  above the aim is offered. */
  toAim: number;
  /** Whether the candidate's scoring program differs from the one that battery ran. */
  scoringChanged: boolean;
  reuse: BatteryReuse;
}

/** The cases a remeasure solves again: every other case of battery `of` is regraded from its
 *  recorded solve. */
export interface Remeasure {
  of: string;
  taskIds: string[];
}

type RecordedBattery = Pick<BatteryRecord, "cases" | "regrade" | "discrimination" | "bundleSnapshot">;

/** The exam a candidate poses under this run's Built slot. */
interface ExamInput {
  repoRoot: string;
  slug: string;
  runPin: string;
  built: Pick<SlotChoice, "reasoningEffort" | "withholdInstruments">;
  candidateDir: string;
}

type ExamRead = { exam: IdenticalExam } | { exam: null; reason: string };

/** The recorded solves a round regrades, or null when it measures a fresh battery, with the reason
 *  either way. */
interface CorrectionRegrade {
  reuse: BatteryReuse | null;
  reason: string;
}

function latestBatteryAtOrAboveAim(
  repoRoot: string,
  slug: string,
  runPin: string,
): { runId: string; toAim: number; runDir: string } | string {
  const adoptedDir = selectedProductDir(repoRoot, slug);
  if (!existsSync(adoptedDir)) return "no adopted product";
  const readout = readClimbReadout(
    adoptedDir,
    runPin,
    claimsDirFor(repoRoot, slug),
    join(repoRoot, FROZEN_MANIFEST_PATH),
  );
  const latest = readout?.rows[0];
  if (latest === undefined) return "no measured battery";
  if (latest.claimRefusal !== null || latest.toAim === null) {
    return `battery ${latest.runId} has no placement`;
  }
  if (latest.toAim > 0) return `battery ${latest.runId} sat below the aim`;
  const runDir = retainedRunDir(adoptedDir, latest.runId);
  if (runDir === null) return `battery ${latest.runId} has no unique retained run directory`;
  return { runId: latest.runId, toAim: latest.toAim, runDir };
}

/** Which part of the solver's own condition moved since battery `runId` solved, or null when none
 *  did. The backend pin names no reasoning effort, the agent bytes hold neither the instruments an
 *  operator withheld nor the tool tree the solver's shell runs first on PATH, and a recorded solve
 *  answers only the condition it ran under. */
function solverConditionMoved(
  input: ExamInput,
  runId: string,
  battery: Pick<BatteryRecord, "bundleSnapshot" | "condition">,
): string | null {
  const recordPath = join(campaignDir(input.repoRoot, input.slug), CASE_RECORD_FILE);
  const session = readCaseRecord(recordPath).find((entry) => entry.row.runId === runId)?.row.isolation
    ?.session;
  if (session?.reasoningEffort !== input.built.reasoningEffort) return "the Built reasoning effort moved";
  const condition = batteryCondition(input.candidateDir, input.built.withholdInstruments === true);
  if (canonicalJson(condition) !== canonicalJson(battery.condition)) {
    return "the solver's run condition moved";
  }
  if (
    battery.bundleSnapshot.toolTreeDigest !== toolTreeDigestOf(bundleSnapshotToolTree(input.candidateDir))
  ) {
    return "the solver's tool tree moved";
  }
  return null;
}

/** Whether `candidateDir` poses exactly the exam the latest battery sat — the same agent bytes, the
 *  same backend pin and the same public task bytes over the same task ids — when that battery sat
 *  at or above the aim. The reason says which condition failed. */
function identicalExamOverAim(input: ExamInput): ExamRead {
  const source = latestBatteryAtOrAboveAim(input.repoRoot, input.slug, input.runPin);
  if (isString(source)) return { exam: null, reason: source };
  let battery: Pick<BatteryRecord, "backendPin" | "bundleSnapshot" | "cases" | "condition">;
  try {
    battery = readRecordedBatteryRecord(source.runDir, source.runId);
  } catch (error) {
    return { exam: null, reason: errorMessage(error) };
  }
  const fingerprint = fingerprintSlug(input.candidateDir);
  if (!fingerprint.ok) return { exam: null, reason: "the candidate does not fingerprint" };
  if (battery.backendPin !== input.runPin) return { exam: null, reason: "the backend pin moved" };
  if (battery.bundleSnapshot.agentHash !== fingerprint.agentHash) {
    return { exam: null, reason: "the agent bytes moved" };
  }
  const solving = solverConditionMoved(input, source.runId, battery);
  if (solving !== null) return { exam: null, reason: solving };
  const tasks = loadRecordedTasks(input.candidateDir);
  const ids = tasks.map((task) => task.taskId);
  if (ids.length !== battery.cases.length) return { exam: null, reason: "the task count moved" };
  const read = readRecordedSolves(source.runDir, source.runId, ids);
  if (!read.ok) return { exam: null, reason: read.refusal };
  const moved = tasks.filter((task) => {
    const solve = read.value.solves.get(task.taskId);
    return solve === undefined || !recordedTaskMatches(task, solve);
  });
  if (moved.length > 0) return { exam: null, reason: `${moved.length} public task(s) moved` };
  const scoringChanged = battery.bundleSnapshot.scoringHash !== fingerprint.scoringHash;
  // The solver reads the brief's public rules as well as its task, so a correction that rewrote
  // them posed a different exam even over byte-identical tasks.
  const rules = (dir: string) => capturedJsonStringify(readPublicResources(dir));
  if (scoringChanged && rules(dirname(dirname(source.runDir))) !== rules(input.candidateDir)) {
    return { exam: null, reason: "the brief's public rules moved" };
  }
  return {
    exam: {
      runId: source.runId,
      toAim: source.toAim,
      scoringChanged,
      reuse: read.value,
    },
  };
}

/** The recorded solves an evaluation correction regrades instead of solving, or null when the
 *  round measures a fresh battery. The reason is recorded either way. */
export function regradeForCorrection(
  input: ExamInput & { experimentAuthoring: ExperimentAuthoring | undefined },
): CorrectionRegrade {
  if (input.experimentAuthoring?.operation.operation !== "evaluation-correction") {
    return { reuse: null, reason: "not an evaluation correction" };
  }
  const read = identicalExamOverAim(input);
  if (read.exam === null) return { reuse: null, reason: read.reason };
  return {
    reuse: read.exam.reuse,
    reason: `evaluation correction over the exam battery ${read.exam.runId} sat at or above the aim; its ${read.exam.reuse.solves.size} recorded solves are regraded under the corrected evaluator`,
  };
}

/** Why a submitted candidate that moved nothing the verifier reads must not buy a fresh blind
 *  battery, or null when it may. A battery at or above the aim already answered the exam these
 *  agent bytes and these public tasks pose; solving it again measures the same condition twice and
 *  finds the same limit it did not find the first time. A candidate whose scoring moved is an
 *  evaluation correction, which `regradeForCorrection` settles, so the caller asks this only of a
 *  repeat. */
export function identicalExamRefusal(input: ExamInput): string | null {
  const read = identicalExamOverAim(input);
  if (read.exam === null || read.exam.scoringChanged) return null;
  return `battery ${read.exam.runId} already measured these agent bytes on these exact public tasks under this scoring program, so a fresh blind battery would pose the identical exam. This submit is not counted as a strike; submitting the same bytes again is.`;
}

/** How many remeasures in a row led to `battery`, itself included. A chain the environment keeps
 *  cutting short ends at the same allowance an all-non-result battery gets, and then the Builder
 *  has the round. */
function remeasureChain(domainDir: string, battery: Pick<BatteryRecord, "cases" | "regrade">): number {
  let count = 0;
  let at = battery;
  // A remeasure re-solved some of its cases and regraded the rest; a correction's regrade reuses
  // every case, so it does not count.
  while (at.regrade !== undefined && at.regrade.reused < at.cases.length) {
    count += 1;
    const runDir = retainedRunDir(domainDir, at.regrade.of);
    if (runDir === null) break;
    at = readRecordedBatteryRecord(runDir, at.regrade.of);
  }
  return count;
}

/** Why `battery` is not a remeasure's source, or null when it is: each censored case is a
 *  solver-side non-result of a kind the environment owns, no external check recorded an unbound
 *  result, and the product that measured it is the one selected now. */
function notRemeasurable(domainDir: string, battery: RecordedBattery): string | null {
  const censored = battery.cases.filter((row) => row.runtimeNonResultKind !== null);
  if (censored.length === 0) return "no case ended in a non-result";
  const environmentOwned = censored.every(
    (row) =>
      row.solver.nonResult !== null &&
      row.runtimeNonResultKind !== null &&
      ENVIRONMENT_OWNED_NONRESULT_KINDS.has(row.runtimeNonResultKind),
  );
  if (!environmentOwned) return "a non-result the environment does not own, or one past the solver";
  // The analysis routes an unbound external result to the check's owner and says to repair before
  // rerunning, so a remeasure here would contradict the finding the Builder reads.
  if (battery.discrimination.findings.some((row) => row.code === "EXTERNAL_RESULT_UNBOUND")) {
    return "an external check recorded an unbound result";
  }
  const fingerprint = fingerprintSlug(domainDir);
  const { bundleSnapshot: measured } = battery;
  if (
    !fingerprint.ok ||
    measured.agentHash !== fingerprint.agentHash ||
    measured.scoringHash !== fingerprint.scoringHash ||
    measured.taskSetHash !== fingerprint.taskSetHash
  ) {
    return "the selected product is not the one that measured it";
  }
  const chain = remeasureChain(domainDir, battery);
  if (chain >= POLICY.loop.environmentBlockedRounds) return `${chain} remeasures in a row already`;
  return null;
}

/** The latest battery's environment-censored cases to solve again on unchanged product bytes, or
 *  the reason it has none. */
export function censoredRemeasure(domainDir: string, readout: ClimbReadout | null): Remeasure | string {
  const latest = readout?.rows[0];
  if (latest === undefined) return "no measured battery";
  if (latest.nonResults === 0) return "no case ended in a non-result";
  const runDir = retainedRunDir(domainDir, latest.runId);
  if (runDir === null) return `battery ${latest.runId} has no unique retained run directory`;
  let battery: RecordedBattery;
  try {
    battery = readRecordedBatteryRecord(runDir, latest.runId);
  } catch (error) {
    return errorMessage(error);
  }
  const refused = notRemeasurable(domainDir, battery);
  if (refused !== null) return refused;
  const remeasure = {
    of: latest.runId,
    taskIds: battery.cases.flatMap((row) => (row.runtimeNonResultKind === null ? [] : [row.taskId])),
  };
  // Read the kept solves now, so a record that cannot be vouched for sends the round to the
  // Builder here rather than failing the battery it would have opened.
  const kept = keptSolves(domainDir, remeasure);
  return isString(kept) ? kept : remeasure;
}

function keptSolves(domainDir: string, remeasure: Remeasure): BatteryReuse | string {
  const runDir = retainedRunDir(domainDir, remeasure.of);
  if (runDir === null) return `battery ${remeasure.of} has no unique retained run directory`;
  const again = new Set(remeasure.taskIds);
  const kept = loadRecordedTasks(domainDir)
    .map((task) => task.taskId)
    .filter((id) => !again.has(id));
  const read = readRecordedSolves(runDir, remeasure.of, kept);
  return read.ok ? read.value : read.refusal;
}

/** The recorded solves a remeasure regrades: every case of its source battery except the ones it
 *  solves again. */
export function remeasureReuse(domainDir: string, remeasure: Remeasure): BatteryReuse {
  const kept = keptSolves(domainDir, remeasure);
  if (isString(kept)) throw new Error(`remeasure of ${remeasure.of}: ${kept}`);
  return kept;
}
