/**
 * What the recorded evidence says was used: the Builder's tool findings epoch by epoch, and which
 * of the runtime safeguards named in `src/meta/safeguard.ts` ever fired. It reads, and it decides
 * nothing — which matters most for the safeguard half, because a `fired: 0` row is a candidate for
 * retirement rather than a verdict on one. A zero cannot separate a sensor whose watched branch
 * stayed healthy from one no recorded run ever reached, so `.claude/skills/safeguards/SKILL.md`
 * asks for two completed runs, named by run id, whose evidence shows the branch was reached before
 * a quiet sensor may go. That is a judgement about reachability, and nothing in these logs can
 * make it, so a census finding that most live ids have never fired retires none of them on that
 * fact alone.
 */
import type { BuilderToolsReport, EpochToolCensus } from "./builder-tools.ts";
import { builderFailureFindings } from "./builder-failed-calls.ts";
import { type BuilderExecutionEvidence, submitProjection } from "../../src/author/builder-execution.ts";
import { existsSync, readFileSync, readdirSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { SAFEGUARD_INVENTORY, parseSafeguardLog, safeguardLogFile } from "../../src/meta/safeguard.ts";

interface SafeguardUsageRow {
  readonly name: string;
  readonly introduced: string;
  fired: number;
  firstFired: string | null;
  lastFired: string | null;
  campaigns: string[];
}

interface SafeguardUsageReport {
  readonly rows: SafeguardUsageRow[];
  /** Inventory names with zero fired lines across every log read — the lifecycle candidates. */
  readonly neverFired: string[];
  /** Fired names absent from the inventory: a removed safeguard's old logs, or a naming drift. */
  readonly unknownNames: string[];
  readonly logsRead: number;
  readonly malformedLines: number;
}

/**
 * What the execution evidence says about the session's activity. `recordRows` is the path
 * record's row count for the same epoch: stating it beside the native-call count is the point, since
 * the record stopped seeing native Read/Edit/Bash and its silence was being read as an idle Builder.
 */
function executionFindings(epoch: string, execution: BuilderExecutionEvidence, recordRows: number): string[] {
  const out: string[] = [];
  const { submitCounts, unchangedTreeSubmits, repeatedFindingSubmits } = submitProjection(execution.submits);
  const submits = submitCounts.raw;
  const candidateSubmits = submitCounts.candidates;
  const comparisonDenominator =
    submitCounts.controllerTerminals > 0 ? "candidate submissions" : "submissions";
  if (unchangedTreeSubmits > 0) {
    out.push(
      `${epoch}: ${unchangedTreeSubmits} of ${candidateSubmits} ${comparisonDenominator} completed at the commit the submission before them had already completed — the tree did not move`,
    );
  }
  if (repeatedFindingSubmits > 0) {
    out.push(
      `${epoch}: ${repeatedFindingSubmits} of ${candidateSubmits} ${comparisonDenominator} were refused with the findings the submission before them had already returned`,
    );
  }
  if (execution.toolCalls.native > 0) {
    out.push(
      `${epoch}: ${execution.toolCalls.native} of ${execution.toolCalls.total} tool calls ran on the backend's native contract, which the path record's ${recordRows} rows do not cover`,
    );
  }
  if (submitCounts.controllerTerminals > 0) {
    out.push(
      `${epoch}: ${submitCounts.candidates} candidate submissions and ${submitCounts.controllerTerminals} controller-terminal event(s) among ${submits} raw submit rows`,
    );
  }
  return out;
}

/** Compare the path record with the session configuration: undeclared policies, the first
 *  successful workspace read, and capabilities denied every time. */
function pathRecordFindings(epoch: EpochToolCensus): string[] {
  const { record, composed } = epoch;
  const out: string[] = [];
  const declaredPolicies = new Set(composed?.isolations.map((isolation) => isolation.policyDigest) ?? []);
  const undeclaredPolicies = record?.policyDigests.filter((digest) => !declaredPolicies.has(digest)) ?? [];
  if (undeclaredPolicies.length > 0) {
    out.push(
      `${epoch.epoch}: record rows used policies the session evidence never composed: ${undeclaredPolicies.join(", ")}`,
    );
  }
  const firstRead = record?.firstAllowedRead ?? null;
  if (record !== null && firstRead === null) {
    out.push(`${epoch.epoch}: no successful primary workspace read was recorded`);
  } else if (firstRead !== null && !/(^|\/)STARTER\.md$/.test(firstRead.resolved ?? firstRead.requested)) {
    out.push(
      `${epoch.epoch}: first successful primary workspace read was ${firstRead.requested}, not STARTER.md`,
    );
  }
  for (const [name, use] of Object.entries(record?.byCapability ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (use.allowed === 0 && use.denied > 0) {
      out.push(
        `${epoch.epoch}: ${name} was denied all ${use.denied} times (${use.reasons.join(", ")}) — the Builder kept asking for access it never had`,
      );
    }
  }
  return out;
}

function epochToolFindings(epoch: EpochToolCensus): string[] {
  // Failed calls are execution evidence, so they stay readable in exactly the epoch the other
  // evidence sources miss: an epoch can hold dozens of failed native calls beside null session
  // evidence and a path record that covers none of them.
  const failures = builderFailureFindings(epoch.epoch, epoch.failures);
  const { record, composed } = epoch;
  if (composed === null && record === null) {
    return [
      `${epoch.epoch}: no builder session evidence and no path record — nothing was composed here`,
      ...failures,
    ];
  }
  const out: string[] = [];
  out.push(...pathRecordFindings(epoch));
  if (epoch.undeclared.length > 0) {
    out.push(
      `${epoch.epoch}: record names capabilities the evidence never composed: ${epoch.undeclared.join(", ")}`,
    );
  }
  if (epoch.workshop !== null && (epoch.workshop.failed > 0 || epoch.workshop.nonResults > 0)) {
    const reasons = Object.entries(epoch.workshop.byReason)
      .map(([reason, count]) => `${reason}=${count}`)
      .join(", ");
    out.push(
      `${epoch.epoch}: verifier workshop completed ${epoch.workshop.failed} failed and ${epoch.workshop.nonResults} non-result actions${reasons === "" ? "" : ` (${reasons})`}`,
    );
  }
  if (epoch.neverUsed !== null && epoch.neverUsed.length > 0) {
    out.push(
      `${epoch.epoch}: composed and never used: ${epoch.neverUsed.join(", ")} — path capabilities the Builder carried and did not touch`,
    );
  }
  if (epoch.neverUsed === null && composed !== null) {
    out.push(`${epoch.epoch}: no path record, so capability use is unknown`);
  }
  if ((epoch.executionUnavailable?.length ?? 0) > 0) {
    out.push(
      `${epoch.epoch}: Builder execution evidence unavailable: ${epoch.executionUnavailable?.join("; ")}`,
    );
  }
  for (const evidence of epoch.authoring.nonResults) {
    out.push(
      `${epoch.epoch}: authoring non-result at ${evidence.terminal.role} (${evidence.terminal.status}); ${evidence.sessions.length} session states and ${Object.values(evidence.authorCalls).reduce((sum, count) => sum + count, 0)} started author calls receipted`,
    );
  }
  out.push(...failures);
  epoch.execution.forEach((execution, index) => {
    const label = epoch.execution.length === 1 ? epoch.epoch : `${epoch.epoch} session ${String(index + 1)}`;
    out.push(...executionFindings(label, execution, record?.rows ?? 0));
  });
  return out;
}

/** Strict, diagnostic findings derived from the report; they never change acceptance. */
export function builderToolFindings(report: BuilderToolsReport): string[] {
  const out: string[] = [];
  if (report.customToolCalls !== null && report.customToolCalls.neverCalled.length > 0) {
    const rows = report.customToolCalls.neverCalled.map((name) => {
      const use = report.customToolCalls?.byName[name];
      return `${name} (exposed ${use?.sessionsExposed ?? 0}, exposure unknown ${use?.sessionsExposureUnknown ?? 0})`;
    });
    out.push(
      `campaign: custom tools never called where exposure is recorded: ${rows.join(", ")} — overhead evidence, not deletion proof`,
    );
  }
  for (const epoch of report.epochs) out.push(...epochToolFindings(epoch));
  return out;
}

function logFilesUnder(campaignDir: string): string[] {
  const root = join(campaignDir, "safeguards");
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const runId of readdirSync(root)) {
    const file = safeguardLogFile(campaignDir, runId);
    if (existsSync(file)) files.push(file);
  }
  return files;
}

export function safeguardUsageReport(campaignDirs: readonly string[]): SafeguardUsageReport {
  const rows = new Map<string, SafeguardUsageRow>(
    SAFEGUARD_INVENTORY.map((entry) => [
      entry.name,
      { ...entry, fired: 0, firstFired: null, lastFired: null, campaigns: [] },
    ]),
  );
  const unknown = new Set<string>();
  let logsRead = 0;
  let malformedLines = 0;
  /** One recorded firing: its time widens the row's window and its campaign joins the list. A name
   *  outside the inventory is collected rather than counted. */
  const count = (name: string, at: string, campaignDir: string): void => {
    const row = rows.get(name);
    if (row === undefined) {
      unknown.add(name);
      return;
    }
    row.fired += 1;
    if (row.firstFired === null || at < row.firstFired) row.firstFired = at;
    if (row.lastFired === null || at > row.lastFired) row.lastFired = at;
    if (!row.campaigns.includes(campaignDir)) row.campaigns.push(campaignDir);
  };
  for (const campaignDir of campaignDirs) {
    for (const file of logFilesUnder(campaignDir)) {
      logsRead += 1;
      const log = parseSafeguardLog(readFileSync(file, "utf8"));
      malformedLines += log.malformed;
      for (const firing of log.firings) count(firing.name, firing.at, campaignDir);
    }
  }
  const ordered = [...rows.values()];
  return {
    rows: ordered,
    neverFired: ordered
      .values()
      .filter((row) => row.fired === 0)
      .map((row) => row.name)
      .toArray(),
    unknownNames: [...unknown].sort(),
    logsRead,
    malformedLines,
  };
}
