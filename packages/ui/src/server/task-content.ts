import { join } from "../../../../src/meta/path.ts";
import { isSafePathSegment } from "../../../../src/meta/path-segment.ts";
import {
  type CaseRecordRow,
  tracePointerPath,
  verifyTracePointers,
} from "../../../../src/claim/case-record.ts";
import { campaignTraceRoots } from "../../../../src/claim/trace-read.ts";
import { verifyTree } from "../../../../src/claim/bundle-snapshot-verify.ts";
import { readPublicResources } from "../../../../src/correctness-bundle/public-resources.ts";
import type { CaseSummary } from "../models.js";
import { object, objectArray, text } from "./json.js";
import { TASKS_FILE } from "../../../../src/meta/bundle-layout.ts";
import { readJsonFile } from "../../../../src/meta/completed-json.ts";

/** Historical task content comes from the measured bundle, never today's adopted task set. */
export function recordedTaskContent(
  campaign: string,
  row: Pick<CaseRecordRow, "traces" | "runId"> | undefined,
): Map<string, NonNullable<CaseSummary["publicTask"]>> {
  const tasks = new Map<string, NonNullable<CaseSummary["publicTask"]>>();
  if (row === undefined) return tasks;
  const pointer = row.traces.find((item) => item.path === `runs/${row.runId}/battery.json`);
  if (pointer === undefined) return tasks;
  for (const root of campaignTraceRoots(campaign)) {
    if (verifyTracePointers({ traces: [pointer] }, root)[0]?.state !== "intact") continue;
    const battery = object(readJsonFile(join(root, pointer.path)));
    const snapshot = object(battery?.bundleSnapshot);
    const id = text(snapshot?.id);
    const agentHash = text(snapshot?.agentHash);
    const correctnessModelHash = text(snapshot?.correctnessModelHash);
    const taskSetHash = text(snapshot?.taskSetHash);
    if (
      battery?.runId !== row.runId ||
      id === null ||
      !isSafePathSegment(id) ||
      agentHash === null ||
      correctnessModelHash === null ||
      taskSetHash === null
    ) {
      continue;
    }
    for (const dir of [
      tracePointerPath(root, `.bundle-snapshots/${id}`),
      tracePointerPath(root, `.sealed-bundles/${id}`),
      root,
    ]) {
      if (dir === null) continue;
      try {
        verifyTree(dir, { agentHash, correctnessModelHash, taskSetHash }, "UI task content");
        return publicTasks(dir);
      } catch {
        // Missing or drifted archives cannot supply a task description.
      }
    }
  }
  return tasks;
}

function publicTasks(dir: string): Map<string, NonNullable<CaseSummary["publicTask"]>> {
  const tasks = new Map<string, NonNullable<CaseSummary["publicTask"]>>();
  const resources = readPublicResources(dir);
  const saved: unknown = readJsonFile(join(dir, TASKS_FILE));
  for (const task of objectArray(saved)) {
    const taskId = text(task.taskId);
    if (taskId !== null && Object.hasOwn(task, "publicInput")) {
      tasks.set(taskId, { input: task.publicInput, resources });
    }
  }
  return tasks;
}
