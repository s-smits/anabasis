// Shared readers for the review-yield modules. Campaign JSON only, no execution, and a missing or
// unreadable file is a row fact (`null`) rather than a crash.
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { isRecord, isString } from "#src/meta/json-shape.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";

export const YIELD_SCHEMA = "wri-review-yield/v1";

export const CURRENT_LOOP_SCHEMA = "iteration-analysis/v4";

/** Iteration run ids ordered by current `-analysis.json` modification time, then id. */
export function iterationRunIds(campaignDir) {
  const dir = join(campaignDir, "analysis");
  if (!existsSync(dir)) return [];
  const suffix = "-analysis.json";
  return readdirSync(dir)
    .filter((name) => name.endsWith(suffix))
    .map((name) => ({ runId: name.slice(0, -suffix.length), at: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => a.at - b.at || a.runId.localeCompare(b.runId))
    .map((entry) => entry.runId);
}

export function analysisFile(campaignDir, runId, kind) {
  return join(campaignDir, "analysis", `${runId}-${kind}.json`);
}

export function readAnalysis(campaignDir, runId, kind) {
  return readJsonFileOrNull(analysisFile(campaignDir, runId, kind));
}

/** A finding's identity for joins across files: kind, owner and claim text, never printed. */
export function findingKey(finding) {
  if (!isRecord(finding)) return null;
  return JSON.stringify([finding.kind ?? null, finding.proposedOwner ?? null, finding.claim ?? null]);
}

export function findingKeys(findings) {
  return new Set((Array.isArray(findings) ? findings : []).map(findingKey).filter((key) => key !== null));
}

/** The recorded loop that wrote this iteration. `repair-engineer.mjs` already dispatches on it,
 *  because `iteration-analysis/v4` is the loop that replaced the paired repair contest. */
export function iterationSchema(campaignDir, runId) {
  const analysis = readAnalysis(campaignDir, runId, "analysis");
  return isString(analysis?.schema) ? analysis.schema : null;
}

/** One iteration of a loop that does not contain this component. A component the loop no longer
 *  contains cannot miss an opportunity, so the row states absence instead of counting a zero that
 *  reads like a live but unproductive component and invites a reviewer to retire it again. */
export function absentRow(runId, component) {
  return {
    runId,
    absent: true,
    opportunity: false,
    output: null,
    consumer: null,
    changed: false,
    note: `${component} is not part of the loop that recorded this iteration`,
  };
}

/** Rows where the recording loop contains this component, and the reason naming the rest. */
export function presentRows(component, rows) {
  const present = rows.filter((entry) => entry.absent !== true);
  const reasons =
    rows.length > present.length
      ? [
          `${component} is not part of the loop that recorded ${rows.length - present.length} of ${rows.length} iteration(s)`,
        ]
      : [];
  return { present, reasons };
}

/**
 * What the next iteration's contest did with the findings this one admitted: the repair owner it
 * selected, whether that owner is one an admitted finding named, and whether another producer
 * routed the same owner.
 */
export function nextRepair(campaignDir, nextRunId, consumed) {
  const nextContest = nextRunId === null ? null : readAnalysis(campaignDir, nextRunId, "contest");
  const nextOwner =
    isRecord(nextContest) && isRecord(nextContest.repair) ? (nextContest.repair.selectedOwner ?? null) : null;
  const changed = consumed !== null && nextOwner !== null && consumed.value.owners.includes(nextOwner);
  const shared = changed && consumed.value.alsoRoutedByOthers.includes(nextOwner);
  return { nextOwner, changed, shared };
}

/** `key count` for every key `pick` names across the rows, comma-separated; a null key is skipped. */
export function tallyText(rows, pick) {
  const out = {};
  for (const entry of rows) {
    const key = pick(entry);
    if (key === null) continue;
    out[key] = (out[key] ?? 0) + 1;
  }
  return Object.entries(out)
    .map(([key, value]) => `${key} ${value}`)
    .join(", ");
}

export function count(rows, predicate) {
  return rows.reduce((sum, row) => sum + (predicate(row) ? 1 : 0), 0);
}

/** The verdict every module states from its own counts. */
export function verdictFrom(summary) {
  if (summary.opportunities === null || summary.consumed === null) return "unobservable";
  if (summary.opportunities === 0) return "no-opportunity";
  if (summary.changed > 0) return "decision-bearing";
  if (summary.consumed > 0) return "advisory-only";
  return "not-consumed";
}

export function summarise(rows) {
  return {
    iterations: rows.length,
    opportunities: rows.some((row) => row.opportunity === null)
      ? null
      : count(rows, (row) => row.opportunity),
    outputs: rows.some((row) => row.unknown) ? null : count(rows, (row) => row.output !== null),
    consumed: rows.some((row) => row.unknown) ? null : count(rows, (row) => row.consumer !== null),
    changed: rows.some((row) => row.changed === null) ? null : count(rows, (row) => row.changed),
  };
}

export function report(component, campaignDir, rows, reasons) {
  const summary = summarise(rows);
  const absent = rows.length > 0 && rows.every((row) => row.absent === true);
  return {
    schema: YIELD_SCHEMA,
    component,
    campaign: basename(campaignDir),
    runs: rows,
    summary,
    verdict: absent ? "component-absent" : verdictFrom(summary),
    reasons,
  };
}
