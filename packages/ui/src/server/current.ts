import { existsSync, readdirSync } from "../../../../src/meta/filesystem.ts";
import { join } from "../../../../src/meta/path.ts";
import { keyIfDefined } from "../../../../src/meta/optional-key.ts";
import { CASE_RECORD_FILE, type CaseRecordRow, readCaseRecord } from "../../../../src/claim/case-record.ts";
import { campaignTraceRoots, readVerifiedTraceUnder } from "../../../../src/claim/trace-read.ts";
import { outcomeReport, type OutcomeMetrics } from "../../../../tools/outcome/metrics.ts";
import { judgeReport, OUTCOME_JUDGE_SCHEMA } from "../../../../tools/outcome/judge.ts";
import type { CaseSummary, EvidenceIssue, FileRef, RunView, VariantSummary } from "../models.js";
import { readJson, safeRunPath, toFileRef } from "./files.js";
import { bool, object, objectArray, number, text } from "./json.js";
import { NO_STORY, readRequest, readDifficulty } from "./story.js";
import { recordedTaskContent } from "./task-content.js";

export interface RunSelection {
  project: string | null;
  run: string | null;
}

/** A directory the read boundary refuses (a symlinked campaigns tree) lists no runs instead of aborting the reader. */
function directories(repoRoot: string, relativePath: string): string[] {
  const path = safeRunPath(repoRoot, relativePath);
  if (path === null || !existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

/** Opening records discover runs; only the chosen run loads measurements and verified traces. */
export function controllerRuns(repoRoot: string): RunView[] {
  const runs: RunView[] = [];
  for (const project of directories(repoRoot, "campaigns/.")) {
    for (const run of directories(repoRoot, `campaigns/${project}/controller`)) {
      const path = `campaigns/${project}/controller/${run}/opening.json`;
      const issues: EvidenceIssue[] = [];
      const opening = object(readJson(repoRoot, path, issues));
      const request = readRequest(repoRoot, project, run, issues);
      if (opening === null) {
        issues.push({ level: "error", source: path, message: "Opening is missing or unreadable." });
      }
      if (opening !== null && text(opening.runId) !== run) {
        issues.push({ level: "error", source: path, message: "Opening names a different run." });
      }
      runs.push({
        id: `controller:${project}:${run}`,
        projectId: project,
        title: run,
        status: "unknown",
        currentPhase: "Select this run to read its outcome",
        startedAt: request?.openedAt ?? null,
        updatedAt: request?.openedAt ?? null,
        sourceIdentity: request?.commit ?? null,
        variants: [],
        story: { ...NO_STORY, request },
        files: [],
        issues,
      });
    }
  }
  return runs.sort(
    (a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "") || a.id.localeCompare(b.id),
  );
}

function recordedFiles(repoRoot: string, paths: string[]): FileRef[] {
  return [...new Set(paths)].flatMap((path) => {
    const safe = safeRunPath(repoRoot, path);
    return safe !== null && existsSync(safe) ? [toFileRef(repoRoot, safe)] : [];
  });
}

/**
 * The three recorded case kinds, read in the order the working contract reads them: a typed
 * environment failure first, then an attempt that produced no accepted submission, then the
 * verifier's verdict over the bytes that did arrive.
 */
function caseStatus(row: CaseRecordRow): CaseSummary["status"] {
  if (row.runtimeNonResultKind !== null) return "partial";
  if (!row.acceptedSubmit) return "unaccepted";
  return row.pass === true ? "complete" : "failed";
}

function caseView(
  repoRoot: string,
  campaign: string,
  row: CaseRecordRow,
  battery: OutcomeMetrics,
): CaseSummary {
  const read = readVerifiedTraceUnder(row, campaign, campaignTraceRoots(campaign));
  const { trace } = read;
  const facts = battery.telemetry.cases.find((item) => item.taskId === row.taskId);
  const tools = objectArray(trace?.toolCalls).map((tool, index) => ({
    seq: number(tool.seq) ?? index + 1,
    turn: number(tool.turn) ?? 0,
    toolName: text(tool.toolName) ?? "unrecorded",
    toolCallId: text(tool.toolCallId),
    isError: bool(tool.isError),
    argsExcerpt: text(tool.argsExcerpt),
    resultExcerpt: text(tool.resultExcerpt),
    resultPreview: text(tool.resultPreview),
    timingMs: number(tool.timingMs),
  }));
  const preview =
    objectArray(trace?.turns)
      .map((turn) => text(turn.assistantPreview))
      .find((value) => value !== null) ?? null;
  const relativeTrace =
    read.path === null || read.baseDir === null
      ? []
      : [join(read.baseDir, read.path).slice(repoRoot.length + 1)];
  return {
    id: row.taskId,
    runId: row.runId,
    variant: row.runId,
    family: row.family,
    status: caseStatus(row),
    acceptedSubmit: row.acceptedSubmit,
    truthOk: row.truthOk,
    pass: row.pass,
    nonResult: row.runtimeNonResultKind,
    solverErrors: row.runtimeNonResult === null ? [] : [row.runtimeNonResult],
    turns: facts?.turns ?? null,
    toolCalls: facts?.toolCalls ?? null,
    backend: row.backendPin,
    assistantPreview: preview,
    tools,
    traceState: read.state,
    files: recordedFiles(repoRoot, relativeTrace),
    updatedAt: row.solverEndedAt ?? "",
  };
}

function variantView(
  repoRoot: string,
  campaign: string,
  battery: OutcomeMetrics,
  rows: CaseRecordRow[],
): VariantSummary {
  const own = rows.filter((row) => row.runId === battery.runId);
  const tasks = recordedTaskContent(campaign, own[0]);
  const cases = own.map((row) => ({
    ...caseView(repoRoot, campaign, row, battery),
    ...keyIfDefined("publicTask", tasks.get(row.taskId)),
  }));
  return { runId: battery.runId, cases, files: cases.flatMap((item) => item.files) };
}

export function hydrateControllerRun(repoRoot: string, run: RunView): void {
  if (run.issues.some((issue) => issue.level === "error")) {
    run.status = "blocked";
    return;
  }
  const campaign = join(repoRoot, "campaigns", run.projectId);
  try {
    const report = outcomeReport(campaign, run.title, null);
    if (report.controller.state === "recorded" && report.controller.denominator.state === "invalid") {
      throw new Error("The case record is unreadable; no capability score can be shown.");
    }
    const rows = readCaseRecord(join(campaign, CASE_RECORD_FILE)).map((stored) => stored.row);
    run.outcome = report;
    run.story.difficulty = readDifficulty(repoRoot, run.projectId, run.title, run.issues);
    run.reviews = Object.keys(report.batteries).map((selector) => {
      try {
        return judgeReport(campaign, selector);
      } catch (error) {
        return {
          schema: OUTCOME_JUDGE_SCHEMA,
          campaign,
          selector,
          available: false as const,
          reason: String(error),
        };
      }
    });
    run.variants = Object.values(report.batteries).map((battery) =>
      variantView(repoRoot, campaign, battery, rows),
    );
    const { controller } = report;
    const held = controller.state === "unfinished" && controller.holder === "held";
    const recorded =
      controller.state === "recorded" && controller.outcome === "aborted" ? "failed" : "complete";
    run.status = controller.state === "recorded" ? recorded : held ? "active" : "partial";
    run.currentPhase = controller.state === "recorded" ? controller.terminalReason : "No recorded ending";
    run.files = [
      ...recordedFiles(repoRoot, [
        `campaigns/${run.projectId}/${CASE_RECORD_FILE}`,
        ...report.promotions.map((row) => `campaigns/${run.projectId}/promotions/${row.runId}.json`),
      ]),
      ...run.variants.flatMap((variant) => variant.files),
    ];
  } catch (error) {
    run.status = "blocked";
    run.issues.push({
      level: "error",
      source: `campaigns/${run.projectId}/controller/${run.title}`,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
