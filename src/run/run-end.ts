/**
 * The run-end numbers: where each battery landed on the band, how far the Builder's own target
 * and predictions were from what it measured and from what its round's trials showed, and how
 * many truth checks ran through a tool that had public packages installed beside it.
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
import { keyIfDefined, keyIfNotNull } from "../meta/optional-key.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { EVIDENCE_SCHEMA, EVIDENCE_STEM, type PredictionScore } from "../author/experiment-plan.ts";
import type { ClaimStatement } from "../claim/claim-evidence.ts";
import type { ClimbReadout } from "./climb-readout.ts";
import { DIFFICULTY_DECISION_SCHEMA, type DifficultyDecisionEvidence } from "./difficulty-decision.ts";

type ReadoutRow = ClimbReadout["rows"][number];

/** A round's `harness_trial` evidence, joined to the battery by the digest of the plan it
 *  measured. `none` when no trial ran under that exact plan — including a plan edited after its
 *  last trial — and `ambiguous` when several rounds rehearsed byte-identical plans. */
type TrialsReading =
  | ({ state: "recorded" } & TrialsFile)
  | { state: "none" }
  | { state: "ambiguous"; evidence: string[] };

type TrialsFile = {
  /** Relative to the campaign. */
  evidence: string;
  rehearsals: number;
  /** Distinct tasks a trial passed, to read against the plan's target. */
  passedTasks: number;
  /** The plan's predictions against the trial verdicts, as the controller recorded it. */
  predictionScore: PredictionScore | null;
};

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
    /** Absent when the battery bound no plan. */
    trials?: TrialsReading;
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
      climb: readout === null ? null : climbFromReadout(campaignDir, "terminal", readout),
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
  return climbFromReadout(campaignDir, join("difficulty-decisions", newest.file), newest.evidence.difficulty);
}

function climbFromReadout(campaignDir: string, readFrom: string, readout: ClimbReadout): ClimbRunEnd {
  const { rows, band } = readout;
  const trials = trialsByPlan(campaignDir);
  const batteries = rows.toReversed().map((row) => {
    const digest = row.experiment?.proposal.digest;
    return {
      runId: row.runId,
      zone: row.zone,
      passed: row.passed,
      verified: row.verified,
      ...keyIfNotNull("target", row.target),
      ...keyIfDefined("trials", digest === undefined ? undefined : trialsReading(trials.get(digest) ?? [])),
    };
  });
  return {
    readFrom,
    band,
    onAim: rows.filter((row) => row.zone === "on-aim").length,
    placed: rows.filter((row) => row.zone !== null).length,
    batteries,
  };
}

function trialsReading(files: readonly TrialsFile[]): TrialsReading {
  const [only] = files;
  if (only === undefined) return { state: "none" };
  if (files.length > 1) return { state: "ambiguous", evidence: files.map((file) => file.evidence).sort() };
  return { state: "recorded", ...only };
}

/** Every round's trial evidence in the campaign, keyed by the plan digest it was last scored
 *  against. A round writes its file under its own epoch, so the walk covers each epoch's
 *  `rehearsals/` and reads only the one schema the controller writes. */
function trialsByPlan(campaignDir: string): Map<string, TrialsFile[]> {
  const byPlan = new Map<string, TrialsFile[]>();
  const epochs = existsSync(campaignDir)
    ? readdirSync(campaignDir).filter((name) => name.startsWith("epoch-"))
    : [];
  for (const epoch of epochs) {
    const dir = join(campaignDir, epoch, "rehearsals");
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(EVIDENCE_STEM) || !name.endsWith(".json")) continue;
      const evidence = join(epoch, "rehearsals", name);
      const read = readTrials(join(campaignDir, evidence));
      if (read === null) continue;
      byPlan.set(read.planDigest, [...(byPlan.get(read.planDigest) ?? []), { evidence, ...read.facts }]);
    }
  }
  return byPlan;
}

function readTrials(path: string): { planDigest: string; facts: Omit<TrialsFile, "evidence"> } | null {
  let parsed: unknown;
  try {
    parsed = parseJsonAs<unknown>(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (
    !isRecord(parsed) ||
    parsed.schema !== EVIDENCE_SCHEMA ||
    !isString(parsed.planDigest) ||
    !Array.isArray(parsed.rehearsals)
  ) {
    return null;
  }
  const passed = parsed.rehearsals.flatMap((row) =>
    isRecord(row) && row.verdict === "pass" && isString(row.taskId) ? [row.taskId] : [],
  );
  const score = parsed.predictionScore;
  return {
    planDigest: parsed.planDigest,
    facts: {
      rehearsals: parsed.rehearsals.length,
      passedTasks: new Set(passed).size,
      predictionScore: isRecord(score)
        ? /* SAFETY: the one schema PlanEvidence writes, whose score is predictionScore()'s result. */ (score as PredictionScore)
        : null,
    },
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
