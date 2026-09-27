/** When a round's battery grades recorded solves instead of solving. An evaluation correction after
 *  a battery at or above the aim, over the same agent bytes and the same public tasks, keeps every
 *  byte the solver read, so the Built solver would be paid to write artifacts that already exist:
 *  the round regrades that battery under the corrected evaluator instead. Below the aim a
 *  correction still measures a fresh battery, because there the question is whether the solver can
 *  reach the tasks at all, which regrading its old attempts cannot answer. */
import { existsSync } from "../meta/filesystem.ts";
import { isString } from "../meta/json-shape.ts";
import { dirname, join } from "../meta/path.ts";
import { FROZEN_MANIFEST_PATH } from "../critic/manifest.ts";
import { fingerprintSlug } from "../claim/fingerprint.ts";
import { type BatteryRecord, readRecordedBatteryRecord } from "../correctness-bundle/battery-record.ts";
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
import { readClimbReadout } from "./climb-readout.ts";
import { selectedProductDir } from "./product-versions.ts";
import { loadRecordedTasks } from "./run-driver.ts";

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

/** Whether `candidateDir` poses exactly the exam the latest battery sat — the same agent bytes, the
 *  same backend pin and the same public task bytes over the same task ids — when that battery sat
 *  at or above the aim. The reason says which condition failed. */
function identicalExamOverAim(input: {
  repoRoot: string;
  slug: string;
  runPin: string;
  candidateDir: string;
}): ExamRead {
  const source = latestBatteryAtOrAboveAim(input.repoRoot, input.slug, input.runPin);
  if (isString(source)) return { exam: null, reason: source };
  let battery: Pick<BatteryRecord, "backendPin" | "bundleSnapshot" | "cases">;
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
export function regradeForCorrection(input: {
  repoRoot: string;
  slug: string;
  runPin: string;
  candidateDir: string;
  experimentAuthoring: ExperimentAuthoring | undefined;
}): CorrectionRegrade {
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
