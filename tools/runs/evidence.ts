/**
 * What a run recorded about itself, read the way the operator would have to read it by hand.
 *
 * `readControllerEvidence` is the strict owner of this tree and stays the owner for one run in
 * depth: it recomputes denominators, verifies battery seals and throws on any disagreement. A
 * listing of every run on the machine cannot use it — one damaged campaign would take the table
 * with it, and sixty-three strict reads cost far more than the question deserves. So this module
 * reads the same files leniently and names what it could not read, and `show` keeps the strict
 * reader for the run the operator actually asked about.
 *
 * Every instant here is one a producer recorded. No file mtime is read; a run's progress is what
 * its evidence says, not when the filesystem last touched a byte.
 */
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
  type JsonObject,
  type JsonValue,
} from "../../src/meta/json-shape.ts";
import {
  CASE_RECORD_FILE,
  classifyCaseOutcome,
  outcomeTally,
  readCaseRecord,
  type CaseOutcome,
} from "../../src/claim/case-record.ts";

/** The tally its own producer returns: the shape stays owned by `outcomeTally`, not restated here. */
type OutcomeTally = ReturnType<typeof outcomeTally>;
import type { RunLocation } from "./discover.ts";

const SLOT_ROLES = ["builder", "built", "review"] as const;
type SlotRole = (typeof SLOT_ROLES)[number];

export interface SlotFacts {
  role: SlotRole;
  enabled: boolean;
  kind: string | null;
  model: string | null;
  effort: string | null;
}

export interface OpeningFacts {
  writtenAt: string | null;
  commit: string | null;
  dirty: boolean | null;
  sourceDigest: string | null;
  projectId: string | null;
  epochKey: string | null;
  slots: SlotFacts[];
  /** The provider-turn cap the run opened with; the counter beside it is always 0 at open. */
  cap: number | null;
}

interface TerminalFacts {
  writtenAt: string | null;
  outcome: string | null;
  terminalReason: string | null;
  abortClause: string | null;
  /** Battery run ids in recorded iteration order. */
  iterations: string[];
  denominator: { total: number; verified: number; unaccepted: number; nonResults: number } | null;
  turnsUsed: number | null;
  byRole: Array<{ role: string; turns: number }>;
}

/** One observability row, reduced to the fields that say where in the loop the run stood. */
export interface Observation {
  at: string;
  phase: string | null;
  type: string | null;
  state: string | null;
  subjectId: string | null;
}

export interface RunEvidence {
  location: RunLocation;
  opening: OpeningFacts | null;
  terminal: TerminalFacts | null;
  lastObservation: Observation | null;
  /** The Builder's own execution record for this run's epoch: its recorded write instant and the
   *  turns it had settled by then. */
  authoring: AuthoringProgress | null;
  /** Evidence this reader could not trust, named rather than defaulted away. */
  damaged: string[];
}

interface AuthoringProgress {
  writtenAt: string;
  /** Settled Builder turns at that instant; null when the record names none. */
  turns: number | null;
}

export interface CaseCounts {
  /** Null when the campaign's case record could not be read; the count is unknown, not zero. */
  tally: OutcomeTally | null;
  /** Per battery run id, in first-recorded order. */
  batteries: Array<{ runId: string; tally: OutcomeTally }>;
  unreadable: string | null;
}

/** One recorded claim, reduced to what orders and labels a battery. */
export interface ClaimFacts {
  runId: string;
  createdAt: string;
  ok: boolean | null;
  clauses: string[];
}

/** One recorded climb decision, as the difficulty evidence states it. */
interface DifficultyFacts {
  runId: string;
  action: string | null;
  rationale: string | null;
}

function readJson(path: string): JsonObject | null {
  if (!existsSync(path)) return null;
  const parsed = parseJsonAs<JsonValue>(readFileSync(path, "utf8"));
  return isRecord(parsed) ? parsed : null;
}

function stringOr(value: JsonValue | undefined): string | null {
  return isString(value) ? value : null;
}

function numberOr(value: JsonValue | undefined): number | null {
  return isNumber(value) && Number.isFinite(value) ? value : null;
}

function nested(record: JsonObject | null, key: string): JsonObject | null {
  const value = record?.[key];
  return isRecord(value) ? value : null;
}

function slotFacts(slots: JsonObject | null, role: SlotRole): SlotFacts {
  const slot = nested(slots, role);
  const enabled = slot === null ? false : !isBoolean(slot.enabled) || slot.enabled;
  return {
    role,
    enabled,
    kind: stringOr(slot?.kind),
    model: stringOr(slot?.model),
    effort: stringOr(slot?.reasoningEffort),
  };
}

function openingFacts(opening: JsonObject): OpeningFacts {
  const source = nested(opening, "source");
  const slots = nested(opening, "modelSlots");
  const dirty = source?.dirty;
  const roles: SlotFacts[] = [];
  for (const role of SLOT_ROLES) roles.push(slotFacts(slots, role));
  return {
    writtenAt: stringOr(opening.writtenAt),
    commit: stringOr(source?.commit),
    dirty: isBoolean(dirty) ? dirty : null,
    sourceDigest: stringOr(source?.sourceDigest),
    projectId: stringOr(nested(opening, "project")?.id),
    epochKey: stringOr(nested(opening, "epoch")?.key),
    slots: roles,
    cap: numberOr(nested(opening, "providerResourceBudget")?.cap),
  };
}

function denominatorFacts(terminal: JsonObject): TerminalFacts["denominator"] {
  const recorded = nested(terminal, "denominator");
  const total = numberOr(recorded?.total);
  const verified = numberOr(recorded?.verified);
  const unaccepted = numberOr(recorded?.unaccepted);
  const nonResults = numberOr(recorded?.nonResults);
  if (total === null || verified === null || unaccepted === null || nonResults === null) return null;
  return { total, verified, unaccepted, nonResults };
}

function iterationRunIds(terminal: JsonObject): string[] {
  const rows = terminal.iterations;
  if (!Array.isArray(rows)) return [];
  const ids: string[] = [];
  for (const row of rows) {
    const id = isRecord(row) ? stringOr(row.runId) : null;
    if (id !== null) ids.push(id);
  }
  return ids;
}

function roleTurns(terminal: JsonObject): Array<{ role: string; turns: number }> {
  const byRole = nested(nested(terminal, "providerResourceBudget"), "byRole");
  const rows: Array<{ role: string; turns: number }> = [];
  for (const [role, value] of Object.entries(byRole ?? {})) {
    const turns = numberOr(value);
    if (turns !== null) rows.push({ role, turns });
  }
  return rows;
}

function terminalFacts(terminal: JsonObject): TerminalFacts {
  return {
    writtenAt: stringOr(terminal.writtenAt),
    outcome: stringOr(terminal.outcome),
    terminalReason: stringOr(terminal.terminalReason),
    abortClause: stringOr(terminal.abortClause),
    iterations: iterationRunIds(terminal),
    denominator: denominatorFacts(terminal),
    turnsUsed: numberOr(nested(terminal, "providerResourceBudget")?.used),
    byRole: roleTurns(terminal),
  };
}

/**
 * The tail of a file, in whole lines.
 *
 * Observability rows carry whole prompts, so a run's journal reaches megabytes while the question
 * — where did it get to — is answered by its last row. Reading the last window keeps a listing of
 * every run on the machine cheap.
 */
function tailLines(path: string, window = 256 * 1024): string[] {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, window);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const text = buffer.toString("utf8");
    const lines = (length < size ? text.slice(text.indexOf("\n") + 1) : text).split("\n");
    const kept: string[] = [];
    for (const line of lines) if (line.trim() !== "") kept.push(line);
    return kept;
  } finally {
    closeSync(fd);
  }
}

function observation(line: string): Observation | null {
  let row: JsonValue;
  try {
    row = parseJsonAs<JsonValue>(line);
  } catch {
    return null;
  }
  if (!isRecord(row) || !isString(row.at)) return null;
  return {
    at: row.at,
    phase: stringOr(row.phase),
    type: stringOr(row.type),
    state: stringOr(row.state),
    subjectId: stringOr(row.subjectId),
  };
}

export function observabilityPath(campaignDir: string, runId: string): string {
  return join(campaignDir, "observability", `${runId}.jsonl`);
}

/** Every observation this run recorded, oldest first. Used by `show`, which reads one run. */
export function readObservations(campaignDir: string, runId: string): Observation[] {
  const path = observabilityPath(campaignDir, runId);
  if (!existsSync(path)) return [];
  const rows: Observation[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const parsed = observation(line);
    if (parsed !== null) rows.push(parsed);
  }
  return rows;
}

function lastObservation(campaignDir: string, runId: string): Observation | null {
  const path = observabilityPath(campaignDir, runId);
  if (!existsSync(path)) return null;
  const lines = tailLines(path);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = observation(lines[index] ?? "");
    if (parsed !== null) return parsed;
  }
  return null;
}

/**
 * The Builder's execution record for this epoch, by its own recorded write instant. Each authoring
 * session writes its own numbered record and never overwrites an earlier one, so the latest write
 * instant across them is the authoring side's own liveness evidence. The record is checkpointed
 * during a long turn, which is why it says more about progress than any file timestamp.
 */
function authoringProgress(campaignDir: string, epochKey: string | null): AuthoringProgress | null {
  if (epochKey === null) return null;
  const dir = join(campaignDir, epochKey);
  if (statSync(dir, { throwIfNoEntry: false })?.isDirectory() !== true) return null;
  let latest: AuthoringProgress | null = null;
  for (const entry of readdirSync(dir)) {
    if (!entry.startsWith("builder-execution")) continue;
    let record: JsonObject | null;
    try {
      record = readJson(join(dir, entry));
    } catch {
      record = null;
    }
    const writtenAt = stringOr(record?.writtenAt);
    if (writtenAt === null || (latest !== null && writtenAt <= latest.writtenAt)) continue;
    latest = { writtenAt, turns: numberOr(record?.turns) };
  }
  return latest;
}

/** One run's recorded facts, with unreadable evidence named instead of silently dropped. */
export function readRunEvidence(location: RunLocation): RunEvidence {
  const damaged: string[] = [];
  let opening: OpeningFacts | null = null;
  let terminal: TerminalFacts | null = null;
  try {
    const raw = readJson(location.openingPath);
    opening = raw === null ? null : openingFacts(raw);
    if (opening === null) damaged.push("opening.json is not a recorded opening");
  } catch (error) {
    damaged.push(`opening.json unreadable: ${String(error)}`);
  }
  try {
    const raw = readJson(location.terminalPath);
    terminal = raw === null ? null : terminalFacts(raw);
  } catch (error) {
    damaged.push(`terminal.json unreadable: ${String(error)}`);
  }
  let observed: Observation | null = null;
  try {
    observed = lastObservation(location.campaignDir, location.runId);
  } catch (error) {
    damaged.push(`observability unreadable: ${String(error)}`);
  }
  return {
    location,
    opening,
    terminal,
    lastObservation: observed,
    authoring: authoringProgress(location.campaignDir, opening?.epochKey ?? null),
    damaged,
  };
}

/** The most recent instant a producer recorded for this run, and which producer recorded it. */
export function lastRecordedWrite(evidence: RunEvidence): { at: string; source: string } | null {
  const candidates: Array<{ at: string | null; source: string }> = [
    { at: evidence.terminal?.writtenAt ?? null, source: "terminal" },
    { at: evidence.lastObservation?.at ?? null, source: "observability" },
    { at: evidence.authoring?.writtenAt ?? null, source: "builder-execution" },
    { at: evidence.opening?.writtenAt ?? null, source: "opening" },
  ];
  let best: { at: string; source: string } | null = null;
  for (const candidate of candidates) {
    if (candidate.at !== null && (best === null || candidate.at > best.at)) {
      best = { at: candidate.at, source: candidate.source };
    }
  }
  return best;
}

/** Whether a case row belongs to this run: the run itself or one of its numbered iterations. */
export function belongsToRun(rowRunId: string, runId: string): boolean {
  return rowRunId === runId || rowRunId.startsWith(`${runId}-`);
}

const EMPTY_COUNTS: CaseCounts = { tally: outcomeTally([]), batteries: [], unreadable: null };

/** A campaign's case record is shared by every run in it, and a listing asks for each in turn. The
 *  cache lives as long as one command; nothing here is written back. */
const caseRows = new Map<string, ReturnType<typeof readCaseRecord>>();

function cachedCaseRows(path: string): ReturnType<typeof readCaseRecord> {
  const cached = caseRows.get(path);
  if (cached !== undefined) return cached;
  const rows = readCaseRecord(path);
  caseRows.set(path, rows);
  return rows;
}

/**
 * Case outcomes for one run, from the campaign's own case record. The classifier and the tally are
 * the shared owners, so these counts cannot drift from the ones the controller and the outcome
 * views report.
 */
export function readCaseCounts(location: RunLocation): CaseCounts {
  const path = join(location.campaignDir, CASE_RECORD_FILE);
  if (!existsSync(path)) return EMPTY_COUNTS;
  let rows;
  try {
    rows = cachedCaseRows(path);
  } catch (error) {
    return { tally: null, batteries: [], unreadable: String(error) };
  }
  const byBattery = new Map<string, CaseOutcome[]>();
  const mine: CaseOutcome[] = [];
  for (const stored of rows) {
    if (!belongsToRun(stored.row.runId, location.runId)) continue;
    const outcome = classifyCaseOutcome(stored.row);
    mine.push(outcome);
    const battery = byBattery.get(stored.row.runId) ?? [];
    battery.push(outcome);
    byBattery.set(stored.row.runId, battery);
  }
  const batteries: CaseCounts["batteries"] = [];
  for (const [runId, outcomes] of byBattery) batteries.push({ runId, tally: outcomeTally(outcomes) });
  return { tally: outcomeTally(mine), batteries, unreadable: null };
}

/** How many of a campaign's recorded openings have no terminal beside them. */
export function unfinishedInCampaign(runs: readonly RunLocation[], campaignDir: string): number {
  let count = 0;
  for (const run of runs) if (run.campaignDir === campaignDir && !existsSync(run.terminalPath)) count += 1;
  return count;
}

function claimClauses(claim: JsonObject | null): string[] {
  const rows = claim?.clauses;
  if (!Array.isArray(rows)) return [];
  const clauses: string[] = [];
  for (const row of rows) {
    if (isString(row)) clauses.push(row);
    else if (isRecord(row)) {
      const code = stringOr(row.code) ?? stringOr(row.clause);
      if (code !== null) clauses.push(code);
    }
  }
  return clauses;
}

/**
 * The claims recorded for this run's batteries, oldest first by their own `createdAt`. Chronology
 * is the claim's, not the directory's: a before/after reading ordered by filename is refused
 * elsewhere in the repository for the same reason.
 */
export function readClaims(location: RunLocation): ClaimFacts[] {
  const dir = join(location.campaignDir, "claims");
  if (statSync(dir, { throwIfNoEntry: false })?.isDirectory() !== true) return [];
  const claims: ClaimFacts[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    let raw: JsonObject | null;
    try {
      raw = readJson(join(dir, entry));
    } catch {
      continue;
    }
    const runId = stringOr(raw?.runId);
    const createdAt = stringOr(raw?.createdAt);
    if (raw === null || runId === null || createdAt === null || !belongsToRun(runId, location.runId)) {
      continue;
    }
    const ok = nested(raw, "claim")?.ok;
    claims.push({
      runId,
      createdAt,
      ok: isBoolean(ok) ? ok : null,
      clauses: claimClauses(nested(raw, "claim")),
    });
  }
  claims.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return claims;
}

/** The climb decisions recorded for this run's batteries, in recorded battery order. */
export function readDifficultyDecisions(location: RunLocation): DifficultyFacts[] {
  const dir = join(location.campaignDir, "difficulty-decisions");
  if (statSync(dir, { throwIfNoEntry: false })?.isDirectory() !== true) return [];
  const rows: DifficultyFacts[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith(".json")) continue;
    let raw: JsonObject | null;
    try {
      raw = readJson(join(dir, entry));
    } catch {
      continue;
    }
    const runId = stringOr(raw?.runId);
    if (raw === null || runId === null || !belongsToRun(runId, location.runId)) continue;
    const decision = nested(nested(raw, "difficulty"), "decision");
    rows.push({
      runId,
      action: stringOr(decision?.action),
      rationale: stringOr(decision?.rationale) ?? stringOr(raw.rationale),
    });
  }
  return rows;
}
