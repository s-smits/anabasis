/**
 * The run-end numbers: where each battery landed on the band, how it read against its round's
 * plan, and how many truth checks ran through a tool that had public packages installed beside it.
 *
 * The controller records them once, in `terminal.json`, from a readout it takes at the close; the
 * outcome report reads that record, and reads the same numbers live from the newest difficulty
 * decision only while a run has no terminal. Every input is a record some other owner already
 * wrote, so this module stores nothing of its own. None of it reaches a model: the terminal lives
 * under controller evidence, outside every model-facing reader, and so do the files it joins.
 */
import { existsSync, readdirSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { readJsonFileOrNull } from "../meta/completed-json.ts";
import { isNumber, isRecord, isString } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { NO_PLAN, planScoreLine } from "../author/experiment-plan.ts";
import type { ClaimStatement } from "../claim/claim-evidence.ts";
import type { ClimbReadout } from "./climb-readout.ts";
import { DIFFICULTY_DECISION_SCHEMA, type DifficultyDecisionEvidence } from "./difficulty-decision.ts";

type ReadoutRow = ClimbReadout["rows"][number];

type ClimbRunEnd = {
  /** The decision file the rows come from, relative to the campaign, or `terminal` for the
   *  readout the controller took at the close. */
  readFrom: string;
  band: [number, number];
  /** Placed batteries whose point count sat inside the band. */
  onAim: number;
  /** Batteries the decision placed at all; a refused claim or an unplaced battery is not counted. */
  placed: number;
  /** Oldest first. */
  batteries: Array<{
    runId: string;
    zone: ReadoutRow["zone"];
    passed: number | null;
    verified: number;
    /** The round plan scored against its bytes and the verified count; absent when the battery
     *  bound no plan or the plan stated neither families nor a range. */
    plan?: string;
  }>;
};

type GroundingKind = ClaimStatement["groundings"][number]["kind"];

type ProvenanceRunEnd = {
  runId: string;
  /** Per declared grounding kind: how many truth checks, how many named a tool that ran with public
   *  packages installed beside its interpreter, and how many ran a program built in their own cell
   *  on a verified case. Installation, never independence: a wrapper can import a package and ignore
   *  it, and an `external-verifier` check that ran a built program did not decide by its tool alone. */
  byKind: Partial<Record<GroundingKind, { checks: number; withPackages: number; withCellProgram: number }>>;
};

export type RunEnd = {
  climb: ClimbRunEnd | null;
  /** This run's batteries that have a claim, in measured order. */
  provenance: ProvenanceRunEnd[];
};

/** What the terminal records: the numbers, or why the close could not read them. A failure here
 *  must never cost the run its terminal, so it is recorded rather than thrown. */
export type RecordedRunEnd = RunEnd | { unreadable: string };

/** The numbers at the close: a readout taken now, so the last battery is in it even when no later
 *  round recorded a decision that saw it, and provenance for this run's own batteries. */
export function runEndAtClose(
  campaignDir: string,
  readClimb: (() => ClimbReadout | null) | undefined,
  batteryRunIds: readonly string[],
): RecordedRunEnd {
  try {
    const readout = readClimb?.() ?? null;
    return {
      climb: readout === null ? null : climbFromReadout("terminal", readout),
      provenance: batteryRunIds.flatMap((runId) => provenanceRunEnd(campaignDir, runId) ?? []),
    };
  } catch (error) {
    return { unreadable: errorMessage(error) };
  }
}

/** The difficulty decision that saw the newest battery, by that battery's recorded `createdAt`
 *  rather than file time; of two that saw the same battery, the one reading more history. This is
 *  the live reading, for a run that has not recorded its terminal yet. */
export function climbRunEnd(campaignDir: string): ClimbRunEnd | null {
  const dir = join(campaignDir, "difficulty-decisions");
  if (!existsSync(dir)) return null;
  let newest: { file: string; evidence: DifficultyDecisionEvidence } | null = null;
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    const evidence = readDecision(join(dir, file));
    if (evidence === null) continue;
    if (newest === null || seesLater(evidence, newest.evidence)) newest = { file, evidence };
  }
  if (newest === null) return null;
  return climbFromReadout(join("difficulty-decisions", newest.file), newest.evidence.difficulty);
}

function climbFromReadout(readFrom: string, readout: ClimbReadout): ClimbRunEnd {
  const { rows, band } = readout;
  const batteries = rows.toReversed().map((row) => ({
    runId: row.runId,
    zone: row.zone,
    passed: row.passed,
    verified: row.verified,
    ...keyIfDefined("plan", planScoreLine(row.experiment ?? NO_PLAN) ?? undefined),
  }));
  return {
    readFrom,
    band,
    onAim: rows.filter((row) => row.zone === "on-aim").length,
    placed: rows.filter((row) => row.zone !== null).length,
    batteries,
  };
}

function seesLater(candidate: DifficultyDecisionEvidence, current: DifficultyDecisionEvidence): boolean {
  const order = compareCodeUnits(
    candidate.difficulty.rows[0]?.createdAt ?? "",
    current.difficulty.rows[0]?.createdAt ?? "",
  );
  return order > 0 || (order === 0 && candidate.difficulty.rows.length > current.difficulty.rows.length);
}

/** A decision under the current schema, or null. A continued project keeps the decisions its
 *  earlier runs wrote under older schemas, which belong to those runs and not to the live reading,
 *  so they are passed over; a campaign holding none under this one reads as climb unavailable. */
function readDecision(path: string): DifficultyDecisionEvidence | null {
  const parsed = readJsonFileOrNull(path);
  if (!isRecord(parsed) || parsed.schema !== DIFFICULTY_DECISION_SCHEMA) return null;
  const { difficulty } = parsed;
  if (!isRecord(difficulty) || !Array.isArray(difficulty.rows) || !Array.isArray(difficulty.band)) {
    return null;
  }
  // SAFETY: the one schema the controller writes, with the two fields read here present.
  return parsed as DifficultyDecisionEvidence;
}

/** One battery's claim, read for its groundings, the tools that ran and its coverage rows. Null
 *  when the claim is absent, unreadable, or carries any of those lists in another shape, and that
 *  includes a coverage row without its cell-program count: a claim that never recorded the count
 *  cannot be read as having run none. */
export function provenanceRunEnd(campaignDir: string, runId: string): ProvenanceRunEnd | null {
  const evidence = readJsonFileOrNull(join(campaignDir, "claims", `${runId}.json`));
  const statement = isRecord(evidence) && isRecord(evidence.claim) ? evidence.claim.statement : undefined;
  if (
    !isRecord(statement) ||
    !Array.isArray(statement.groundings) ||
    !Array.isArray(statement.verifierTools) ||
    !Array.isArray(statement.externalCheckCoverage)
  ) {
    return null;
  }
  const cellBuilt = new Set<unknown>();
  for (const row of statement.externalCheckCoverage) {
    if (!isRecord(row) || !isString(row.checkId) || !isNumber(row.cellProgramLaunches)) return null;
    if (row.cellProgramLaunches > 0) cellBuilt.add(row.checkId);
  }
  const packaged = new Set<unknown>(
    statement.verifierTools.flatMap((tool) =>
      isRecord(tool) && isString(tool.toolId) && Array.isArray(tool.packages) && tool.packages.length > 0
        ? [tool.toolId]
        : [],
    ),
  );
  const byKind: ProvenanceRunEnd["byKind"] = {};
  for (const grounding of statement.groundings) {
    if (!isRecord(grounding) || !isString(grounding.kind)) return null;
    const kind =
      /* SAFETY: a claim's grounding kind is the closed set its writer declares. */ grounding.kind as GroundingKind;
    const tools = [grounding.adapterId, grounding.requiredToolIds].flat();
    const row = (byKind[kind] ??= { checks: 0, withPackages: 0, withCellProgram: 0 });
    row.checks += 1;
    if (tools.some((tool) => packaged.has(tool))) row.withPackages += 1;
    if (cellBuilt.has(grounding.checkId)) row.withCellProgram += 1;
  }
  return { runId, byKind };
}
