/**
 * The run-end numbers: where each battery landed on the band, how far the Builder's own target
 * was from what it measured, and how many truth checks ran through a tool that had public
 * packages installed beside it.
 *
 * The controller records them once, in `terminal.json`, from a readout it takes at the close; the
 * outcome report reads that record, and reads the same numbers live from the newest difficulty
 * decision only while a run has no terminal. Every input is a record some other owner already
 * wrote, so this module stores nothing of its own. None of it reaches a model: the terminal lives
 * under controller evidence, outside every model-facing reader, and so do the files it joins.
 */
import { existsSync, readFileSync, readdirSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { isRecord, isString } from "../meta/json-shape.ts";
import { keyIfNotNull } from "../meta/optional-key.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
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
  /** Batteries the decision placed at all; a refused claim or a set-aside shape is not placed. */
  placed: number;
  /** Oldest first. */
  batteries: Array<{
    runId: string;
    zone: ReadoutRow["zone"];
    passed: number | null;
    verified: number;
    /** The plan's target read against the verified passes. */
    target?: NonNullable<ReadoutRow["target"]>;
  }>;
};

type GroundingKind = ClaimStatement["groundings"][number]["kind"];

type ProvenanceRunEnd = {
  runId: string;
  /** Per declared grounding kind: how many truth checks, and how many of them named a tool that
   *  ran with public packages installed beside its interpreter. Installation, never independence:
   *  a wrapper can import a package and ignore it. */
  byKind: Partial<Record<GroundingKind, { checks: number; withPackages: number }>>;
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
    ...keyIfNotNull("target", row.target),
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

function readDecision(path: string): DifficultyDecisionEvidence | null {
  try {
    const parsed = parseJsonAs<unknown>(readFileSync(path, "utf8"));
    if (!isRecord(parsed) || parsed.schema !== DIFFICULTY_DECISION_SCHEMA) return null;
    const { difficulty } = parsed;
    if (!isRecord(difficulty) || !Array.isArray(difficulty.rows) || !Array.isArray(difficulty.band)) {
      return null;
    }
    // SAFETY: the one schema the controller writes, with the two fields read here present.
    return parsed as DifficultyDecisionEvidence;
  } catch {
    return null;
  }
}

/** One battery's claim, read for its groundings and the tools that ran. Null when the claim is
 *  absent, unreadable or carries neither list. */
export function provenanceRunEnd(campaignDir: string, runId: string): ProvenanceRunEnd | null {
  const path = join(campaignDir, "claims", `${runId}.json`);
  if (!existsSync(path)) return null;
  let statement: unknown;
  try {
    const evidence = parseJsonAs<unknown>(readFileSync(path, "utf8"));
    statement = isRecord(evidence) && isRecord(evidence.claim) ? evidence.claim.statement : undefined;
  } catch {
    return null;
  }
  if (
    !isRecord(statement) ||
    !Array.isArray(statement.groundings) ||
    !Array.isArray(statement.verifierTools)
  ) {
    return null;
  }
  const packaged = new Set(
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
    const tools = [
      ...(isString(grounding.adapterId) ? [grounding.adapterId] : []),
      ...(Array.isArray(grounding.requiredToolIds) ? grounding.requiredToolIds.filter(isString) : []),
    ];
    const row = (byKind[kind] ??= { checks: 0, withPackages: 0 });
    row.checks += 1;
    if (tools.some((tool) => packaged.has(tool))) row.withPackages += 1;
  }
  return { runId, byKind };
}
