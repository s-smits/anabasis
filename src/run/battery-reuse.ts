/** When a round's battery grades recorded solves instead of solving. Each case keeps every byte the
 *  solver read and the condition it solved under (`solverConditionMoved`), so the Built solver would
 *  be paid to write artifacts that already exist.
 *
 *  One reading decides which (`posedSolves`): a solve of the latest battery is regraded exactly when
 *  it still poses this candidate's exam — the same agent bytes, the same solving condition, the same
 *  public task bytes and public rules — did not end in a non-result, which measured nothing, and
 *  awaits no further solve (`unconfirmedSolves`). Every other task is solved. No round kind is
 *  named, because the reading already tells them apart:
 *
 *  - An evaluation correction regrades every task under the corrected evaluator, wherever the
 *    battery sat on the band, so the comparison moves one variable; a fresh solve would add the
 *    solver's own variance to it. One that also moved a task solves that task alone.
 *  - A task probe is decided on its changed tasks alone (`decidingSample`), so a fresh solve of an
 *    unchanged task buys a replicate nothing reads: a probe that moved one task of ten paid for ten
 *    solves to measure one.
 *  - A remeasure of a battery whose every non-result the environment owns, on the product still
 *    selected, solves exactly those cases, which is what the analysis finding "rerun without
 *    changing the harness" promises. It also solves again each fail that is not yet confirmed
 *    (`unconfirmedSolves`), so the Builder never reads a fail on one solve alone; a battery whose
 *    every case failed or was cut short is measured again whole.
 *  - A harness intervention moved the agent bytes, so nothing it reads was posed before.
 *
 *  An unaccepted attempt is a measured failure and is regraded like a pass: solving it again would
 *  give that task a second chance the rest of the battery never had. A repeat, which moves nothing
 *  the verifier reads, is solved afresh: the solver is stochastic, so a second blind solve answers
 *  whether the first result holds, which regrading it cannot. */
import { existsSync } from "../meta/filesystem.ts";
import { isString } from "../meta/json-shape.ts";
import { dirname, join } from "../meta/path.ts";
import { POLICY } from "../critic/policy.ts";
import { isEnvironmentOwnedNonResult } from "../claim/record-events.ts";
import { fingerprintSlug } from "../claim/fingerprint.ts";
import { bundleSnapshotToolTree } from "../claim/bundle-snapshot.ts";
import { CASE_RECORD_FILE, classifyCaseOutcome, readCaseRecord } from "../claim/case-record.ts";
import type { SlotChoice } from "../backends/resolve.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { canonicalJson } from "../meta/stable-json.ts";
import {
  type BatteryRecord,
  readRecordedBatteryRecord,
  toolTreeDigestOf,
} from "../correctness-bundle/battery-record.ts";
import { readPublicResources } from "../correctness-bundle/public-resources.ts";
import { recordedBuiltEffort } from "../analyse/iteration-analysis.ts";
import {
  type BatteryReuse,
  readRecordedSolves,
  recordedTaskMatches,
} from "../correctness-bundle/recorded-solve.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { ExperimentAuthoring } from "./experiment-freeze.ts";
import { retainedRunDir } from "./climb-history.ts";
import { type ClimbReadout, readClimbReadout } from "./climb-readout.ts";
import { selectedProductDir } from "./product-versions.ts";
import { batteryCondition, loadRecordedTasks } from "./run-driver.ts";

/** The cases a remeasure solves again: every other case of battery `of` is regraded from its
 *  recorded solve. */
export interface Remeasure {
  of: string;
  taskIds: string[];
}

type RecordedBattery = Pick<BatteryRecord, "cases" | "regrade" | "discrimination" | "bundleSnapshot">;

/** How many solves of one task in one group must all fail before the Builder reads the fail. In
 *  trusses-26 the same solver solved 13 tasks 59 times; 57 passed, and both fails passed in the
 *  battery beside them. */
export const AGREEING_SOLVES = 3;

/** The exam a candidate poses under this run's Built slot. */
interface ExamInput {
  repoRoot: string;
  slug: string;
  runPin: string;
  built: Pick<SlotChoice, "reasoningEffort" | "withholdInstruments">;
  candidateDir: string;
}

/** The recorded solves a round regrades, or null when it measures a fresh battery, with the reason
 *  either way. */
interface RecordedRegrade {
  reuse: BatteryReuse | null;
  reason: string;
}

function latestBattery(
  repoRoot: string,
  slug: string,
  runPin: string,
): { runId: string; runDir: string } | string {
  const adoptedDir = selectedProductDir(repoRoot, slug);
  if (!existsSync(adoptedDir)) return "no adopted product";
  const readout = readClimbReadout(adoptedDir, runPin, { repoRoot, slug });
  const latest = readout?.rows[0];
  if (latest === undefined) return "no measured battery";
  const runDir = retainedRunDir(adoptedDir, latest.runId);
  if (runDir === null) return `battery ${latest.runId} has no unique retained run directory`;
  return { runId: latest.runId, runDir };
}

/** Which part of the solving condition moved since battery `runId` solved, or null when none did:
 *  the Built pin, the run condition (the walls, the tools removed and the host's share of the
 *  solver's prompt), the tool tree the solver's shell runs first on PATH, and the reasoning effort
 *  the battery's case rows recorded. The pin names no effort, the agent bytes hold neither the
 *  instruments an operator withheld, that tool tree nor the host's prompt, and a recorded solve
 *  answers only the condition it ran under, so an effort or a procedure the battery never recorded
 *  matches nothing. Both a correction's regrade and a remeasure read it. */
export function solverConditionMoved(
  input: ExamInput,
  runId: string,
  battery: Pick<BatteryRecord, "backendPin" | "condition"> & {
    bundleSnapshot: Pick<BatteryRecord["bundleSnapshot"], "toolTreeDigest">;
  },
): string | null {
  if (battery.backendPin !== input.runPin) return "the backend pin moved";
  const condition = batteryCondition(input.candidateDir, input.built.withholdInstruments === true);
  if (canonicalJson(condition) !== canonicalJson(battery.condition)) {
    return "the solver's run condition moved";
  }
  if (
    battery.bundleSnapshot.toolTreeDigest !== toolTreeDigestOf(bundleSnapshotToolTree(input.candidateDir))
  ) {
    return "the solver's tool tree moved";
  }
  const recordPath = join(campaignDir(input.repoRoot, input.slug), CASE_RECORD_FILE);
  const rows = readCaseRecord(recordPath).flatMap((entry) => (entry.row.runId === runId ? [entry.row] : []));
  if (recordedBuiltEffort(rows) !== input.built.reasoningEffort) {
    return "the Built reasoning effort moved, or the recorded solves name none";
  }
  return null;
}

/** The tasks of battery `runId` to solve again before the Builder reads their fails: each fresh fail
 *  whose group holds fewer than `AGREEING_SOLVES` solves, every one a fail. A group is the exam one
 *  task poses (the row's `examHash`: the agent, the correctness model, the tool tree and that task's
 *  own bytes) under one Built pin, run condition and effort. Another task's edit leaves it whole, so
 *  a fail the Builder keeps stays as confirmed as it was. One pass in the group makes the fail the
 *  solver's variance, a flip, and nothing is solved again. A row restating an earlier row's solve
 *  instant is a regrade, not a solve.
 *  Neither the Judge nor the review chooses which fails are solved again; validity is read apart. */
function unconfirmedSolves(input: ExamInput, runId: string): Set<string> {
  const record = readCaseRecord(join(campaignDir(input.repoRoot, input.slug), CASE_RECORD_FILE));
  const solves = [...Map.groupBy(record, ({ row }) => `${row.taskId} ${row.solverStartedAt}`).values()]
    .flatMap((restated) =>
      restated.slice(0, 1).map(({ row }) => ({ row, outcome: classifyCaseOutcome(row) })),
    )
    .filter(({ outcome }) => outcome === "pass" || outcome === "fail");
  const groupOf = ({ row }: (typeof solves)[number]) =>
    canonicalJson([
      row.taskId,
      row.examHash ?? null,
      row.backendPin,
      row.condition,
      recordedBuiltEffort([row]),
    ]);
  const groups = Map.groupBy(solves, groupOf);
  const unconfirmed = solves.filter((solve) => {
    if (solve.row.runId !== runId || solve.outcome !== "fail") return false;
    const group = groups.get(groupOf(solve)) ?? [];
    return group.length < AGREEING_SOLVES && group.every(({ outcome }) => outcome === "fail");
  });
  return new Set(unconfirmed.map(({ row }) => row.taskId));
}

/** The latest battery's solves that still pose `candidateDir`'s exam, or null with the condition
 *  that moved. A solve is kept when its case reached no non-result, no further solve is due
 *  (`unconfirmedSolves`) and its public task bytes match the candidate's; the agent bytes, the
 *  solving condition and, when the scoring moved, the brief's public rules must match for any to be
 *  kept, because the solver read all of them. */
export function posedSolves(input: ExamInput): RecordedRegrade {
  const source = latestBattery(input.repoRoot, input.slug, input.runPin);
  if (isString(source)) return { reuse: null, reason: source };
  let battery: Pick<BatteryRecord, "backendPin" | "bundleSnapshot" | "cases" | "condition">;
  try {
    battery = readRecordedBatteryRecord(source.runDir, source.runId);
  } catch (error) {
    return { reuse: null, reason: errorMessage(error) };
  }
  const fingerprint = fingerprintSlug(input.candidateDir);
  if (!fingerprint.ok) return { reuse: null, reason: "the candidate does not fingerprint" };
  if (battery.bundleSnapshot.agentHash !== fingerprint.agentHash) {
    return { reuse: null, reason: "the agent bytes moved" };
  }
  const solving = solverConditionMoved(input, source.runId, battery);
  if (solving !== null) return { reuse: null, reason: solving };
  const rules = (dir: string) => capturedJsonStringify(readPublicResources(dir));
  if (
    battery.bundleSnapshot.scoringHash !== fingerprint.scoringHash &&
    rules(dirname(dirname(source.runDir))) !== rules(input.candidateDir)
  ) {
    return { reuse: null, reason: "the brief's public rules moved" };
  }
  const again = unconfirmedSolves(input, source.runId);
  const measured = new Set(
    battery.cases.flatMap((row) =>
      row.runtimeNonResultKind === null && !again.has(row.taskId) ? [row.taskId] : [],
    ),
  );
  const tasks = loadRecordedTasks(input.candidateDir).filter((task) => measured.has(task.taskId));
  const read = readRecordedSolves(
    source.runDir,
    source.runId,
    tasks.map((task) => task.taskId),
  );
  if (!read.ok) return { reuse: null, reason: read.refusal };
  const solves = new Map(
    tasks.flatMap((task) => {
      const solve = read.value.solves.get(task.taskId);
      return solve !== undefined && recordedTaskMatches(task, solve) ? [[task.taskId, solve] as const] : [];
    }),
  );
  // An empty reuse stays one: a remeasure of a battery whose every case failed or was cut short
  // records the regrade it is, so `remeasureChain` counts it.
  return {
    reuse: { ...read.value, solves },
    reason: `${solves.size} solve(s) of battery ${source.runId} still pose this exam and are regraded; the other task(s) are solved`,
  };
}

/** The recorded solves a candidate regrades instead of solving, or null when it measures a fresh
 *  battery, with the reason either way. It reads the solves a remeasure reads (`posedSolves`); a
 *  repeat, which moved nothing, opts out and is solved afresh, and a reuse holding no solve is a
 *  fresh battery. */
export function recordedRegrade(
  input: ExamInput & { experimentAuthoring: ExperimentAuthoring | undefined },
): RecordedRegrade {
  if (input.experimentAuthoring?.operation.operation === "repeat") {
    return { reuse: null, reason: "a repeat is solved afresh" };
  }
  const posed = posedSolves(input);
  return posed.reuse?.solves.size === 0 ? { reuse: null, reason: posed.reason } : posed;
}

/** How many remeasures in a row led to `battery`, itself included. A chain the environment keeps
 *  cutting short ends at the same allowance an all-non-result battery gets, and then the Builder
 *  has the round. */
function remeasureChain(
  domainDir: string,
  battery: Pick<BatteryRecord, "cases" | "regrade" | "bundleSnapshot">,
): number {
  let count = 0;
  let at = battery;
  // A remeasure re-solved some of its cases and regraded the rest over the task set it re-poses; a
  // correction's regrade reuses every case, and a task probe's poses another task set, so neither
  // counts.
  while (at.regrade !== undefined && at.regrade.reused < at.cases.length) {
    const runDir = retainedRunDir(domainDir, at.regrade.of);
    if (runDir === null) {
      count += 1;
      break;
    }
    const source = readRecordedBatteryRecord(runDir, at.regrade.of);
    if (source.bundleSnapshot.taskSetHash !== at.bundleSnapshot.taskSetHash) break;
    count += 1;
    at = source;
  }
  return count;
}

/** Why `battery` is not a remeasure's source, or null when it is: each censored case, if any, is a
 *  solver-side non-result of a kind the environment owns, no external check recorded an unbound
 *  result, and the product that measured it is the one selected now. */
function notRemeasurable(domainDir: string, battery: RecordedBattery): string | null {
  const censored = battery.cases.filter((row) => row.runtimeNonResultKind !== null);
  const environmentOwned = censored.every(
    (row) => row.solver.nonResult !== null && isEnvironmentOwnedNonResult(row.runtimeNonResultKind),
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

/** The latest battery's cases to solve again on the unchanged selected product (`candidateDir`)
 *  under the condition that battery solved under: its environment-censored cases and its
 *  unconfirmed solves. Or the reason it has none. */
export function remeasureOf(input: ExamInput, readout: ClimbReadout | null): Remeasure | string {
  const domainDir = input.candidateDir;
  const latest = readout?.rows[0];
  if (latest === undefined) return "no measured battery";
  const runDir = retainedRunDir(domainDir, latest.runId);
  if (runDir === null) return `battery ${latest.runId} has no unique retained run directory`;
  let battery: BatteryRecord;
  try {
    battery = readRecordedBatteryRecord(runDir, latest.runId);
  } catch (error) {
    return errorMessage(error);
  }
  // Read the solves it would keep now, so a record that cannot be vouched for sends the round to
  // the Builder here rather than failing the battery it would have opened.
  const { reuse, reason } = posedSolves(input);
  if (reuse === null) return reason;
  const taskIds = battery.cases.flatMap((row) => (reuse.solves.has(row.taskId) ? [] : [row.taskId]));
  if (taskIds.length === 0) return "no case ended in a non-result or awaits another solve";
  return notRemeasurable(domainDir, battery) ?? { of: latest.runId, taskIds };
}
