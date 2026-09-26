/**
 * Every check a battery ran, case by case and then per check: its outcome, its time against the
 * harness's own per-check wall, the closed kind of a throw, and the tool runs it launched. The rows
 * come from each case's `verifier.json`, which the battery writes as each case settles, so a
 * battery killed before its manifest was published still reads here; such a file is shown as
 * unrecorded rather than trusted as claim evidence. Operator-only: nothing here reaches a model.
 */
import { existsSync, readFileSync, readdirSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { recordedEvidence, verifyRunDir } from "../../src/claim/evidence-log.ts";
import { campaignTraceRoots } from "../../src/claim/trace-read.ts";
import { capturedJsonParse } from "../../src/meta/json-runtime.ts";
import { isRecord, isString, type JsonObject } from "../../src/meta/json-shape.ts";
import { harnessSettings } from "../../src/correctness-bundle/harness-config.ts";
import { BUNDLE_SNAPSHOT_DIRECTORY } from "../../src/claim/bundle-snapshot.ts";
import { BATTERY_FILE } from "../../src/correctness-bundle/battery-record.ts";
import type { CheckRun } from "../../src/verify/correctness-model-result.ts";
import type { VerifierExecutionEvidence } from "../../src/verify/verifier-port.ts";

const OUTCOME_CHECKS_SCHEMA = "outcome-checks/v1";

type ToolRun = Pick<VerifierExecutionEvidence, "toolId" | "outcome" | "durationMs" | "exitCode" | "timedOut">;
type CaseChecks = { taskId: string; recorded: boolean; ok: boolean | null; checkRuns: CheckRun[] };
type CheckTotals = { checkId: string; runs: number; totalMs: number; maxMs: number; atWall: number } & Record<
  CheckRun["outcome"],
  number
> & { errorKinds: string[] };

/** The case file's bytes, verified against the manifest when one names it, raw otherwise. */
function caseFile(runDir: string, taskId: string, violations: ReturnType<typeof verifyRunDir>) {
  const rel = `cases/${taskId}/verifier.json`;
  const read = recordedEvidence(runDir, rel, violations);
  if (read.ok) return { recorded: true, value: capturedJsonParse(read.bytes) };
  const path = join(runDir, rel);
  return existsSync(path) ? { recorded: false, value: capturedJsonParse(readFileSync(path, "utf8")) } : null;
}

/** The snapshot's own `check_seconds`, which is the wall every row here ran under. */
function checkWallMs(slugDir: string, battery: JsonObject | null): number | null {
  const snapshot = isRecord(battery?.bundleSnapshot) ? battery.bundleSnapshot.id : undefined;
  if (!isString(snapshot)) return null;
  const dir = join(slugDir, BUNDLE_SNAPSHOT_DIRECTORY, snapshot);
  return existsSync(dir) ? harnessSettings(dir).checkWallMs : null;
}

function totalsOf(cases: readonly CaseChecks[], wallMs: number | null): CheckTotals[] {
  const byCheck = new Map<string, CheckTotals>();
  for (const run of cases.flatMap((row) => row.checkRuns)) {
    const zero = { runs: 0, totalMs: 0, maxMs: 0, atWall: 0, pass: 0, fail: 0, threw: 0, "not-run": 0 };
    const totals = byCheck.get(run.checkId) ?? { checkId: run.checkId, ...zero, errorKinds: [] };
    const ms = run.durationMs ?? 0;
    totals.runs += 1;
    totals[run.outcome] += 1;
    totals.totalMs += ms;
    totals.maxMs = Math.max(totals.maxMs, ms);
    if (wallMs !== null && ms >= wallMs) totals.atWall += 1;
    if (run.errorKind !== null && !totals.errorKinds.includes(run.errorKind)) {
      totals.errorKinds.push(run.errorKind);
    }
    byCheck.set(run.checkId, totals);
  }
  return [...byCheck.values()].sort((a, b) => b.totalMs - a.totalMs);
}

export function checksReport(campaignDir: string, runId: string) {
  const slugDir = campaignTraceRoots(campaignDir).find((root) => existsSync(join(root, "runs", runId)));
  if (slugDir === undefined) throw new Error(`no runs/${runId} under ${campaignDir}`);
  const runDir = join(slugDir, "runs", runId);
  const violations = verifyRunDir(runDir);
  const batteryPath = join(runDir, BATTERY_FILE);
  const parsed = existsSync(batteryPath) ? capturedJsonParse(readFileSync(batteryPath, "utf8")) : null;
  const battery = isRecord(parsed) ? parsed : null;
  const rows = battery?.executionEvidence;
  /* SAFETY: the battery writer stores `verifier.evidence()` here, and every row is matched on its
     own subject and check, so a row of another shape joins nothing rather than something wrong. */
  const toolRuns = Array.isArray(rows) ? (rows as VerifierExecutionEvidence[]) : [];
  const casesDir = join(runDir, "cases");
  const taskIds = existsSync(casesDir) ? readdirSync(casesDir).sort() : [];
  const cases = taskIds.flatMap((taskId): Array<CaseChecks & { toolRuns: Record<string, ToolRun[]> }> => {
    const file = caseFile(runDir, taskId, violations);
    if (file === null || !isRecord(file.value) || !Array.isArray(file.value.checkRuns)) return [];
    /* SAFETY: `verification-runner.ts` writes `checkRuns` as the grading's own `CheckRun[]`. */
    const checkRuns = file.value.checkRuns as CheckRun[];
    const ok = file.value.ok === true || file.value.ok === false ? file.value.ok : null;
    const launched = toolRuns.filter((row) => row.phase === "battery" && row.subjectId === taskId);
    const byCheck = Object.fromEntries(
      checkRuns.map((run) => [
        run.checkId,
        launched
          .filter((row) => row.checkId === run.checkId)
          .map(({ toolId, outcome, durationMs, exitCode, timedOut }) => ({
            toolId,
            outcome,
            durationMs,
            exitCode,
            timedOut,
          })),
      ]),
    );
    return [{ taskId, recorded: file.recorded, ok, checkRuns, toolRuns: byCheck }];
  });
  const wallMs = checkWallMs(slugDir, battery);
  return {
    schema: OUTCOME_CHECKS_SCHEMA,
    runId,
    runDir,
    checkWallMs: wallMs,
    cases,
    byCheck: totalsOf(cases, wallMs),
  };
}
