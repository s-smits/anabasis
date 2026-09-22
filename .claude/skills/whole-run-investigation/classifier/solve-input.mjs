// Deterministic Built-solver prose discovery for one run. The Builder's sidecar is only the
// authoring half of a campaign; the scored half is the Built Harness solving the battery, and its
// own words are already recorded, redacted and digest-bound inside each case trace. This module
// finds those rows and joins each case to the outcome the case record gives it, so a posture can
// be read against verified, unaccepted and non-result cases instead of against submit refusals
// alone. It loads no model, calls no provider and returns no row text from its public census.
//
// A case trace is read only when its bytes match the digest the case record published for it: an
// investigation that reads posture off unverified bytes is reading a file, not the run.
import { existsSync, readFileSync, readdirSync, statSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { isNumber, isRecord, isString } from "#src/meta/json-shape.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";

export const SOLVE_CENSUS_SCHEMA = "built-solve-prose-census/v1";
const CASE_RECORD = "case-record.jsonl";
const CASE_SCHEMA = "case-record/v1";
/** trace-capture.ts caps each turn's preview at this many characters before redaction. */
export const PREVIEW_CHARS = 240;

/** The three case kinds the working contract separates before any rate is read. A row whose
 *  `truthOk` is boolean reached the verifier; a typed environment failure leaves it null beside a
 *  named kind; anything else is an attempt that produced no accepted submission. */
export function caseOutcome(row) {
  if (row.runtimeNonResult === true || isString(row.runtimeNonResultKind)) return "non-result";
  if (row.truthOk === true || row.truthOk === false) return "verified";
  return "unaccepted";
}

function readCaseRecord(campaign, runId) {
  const path = join(campaign, CASE_RECORD);
  if (!existsSync(path)) {
    return {
      rows: [],
      issue: `${CASE_RECORD}: absent, so the run has no recorded cases to read posture against`,
    };
  }
  const rows = [];
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
  for (const [index, line] of lines.entries()) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { rows: [], issue: `${CASE_RECORD} line ${index + 1} is unreadable` };
    }
    const row = isRecord(parsed) && isRecord(parsed.row) ? parsed.row : parsed;
    if (!isRecord(row) || row.schema !== CASE_SCHEMA) {
      return { rows: [], issue: `${CASE_RECORD} line ${index + 1}: unknown case schema` };
    }
    if (runId === undefined || row.runId === runId) rows.push(row);
  }
  return { rows, issue: null };
}

/** Case-record trace paths are relative to a retained version directory, and one campaign holds
 *  several. The owning directory is the one where the published digest matches the bytes on disk;
 *  a path that exists everywhere with the wrong bytes is reported, never read. */
function resolveTrace(campaign, taskId, traces) {
  const entry = (Array.isArray(traces) ? traces : []).find(
    (row) => isRecord(row) && isString(row.path) && row.path.endsWith(`cases/${taskId}/trace.json`),
  );
  if (entry === undefined) return { state: "unlisted", path: null };
  const versions = join(campaign, "versions");
  const names = existsSync(versions) && statSync(versions).isDirectory() ? readdirSync(versions) : [];
  let seen = null;
  for (const name of names) {
    const path = join(versions, name, entry.path);
    if (!existsSync(path)) continue;
    seen = path;
    const digest = new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");
    if (digest === entry.sha256) return { state: "verified", path };
  }
  return seen === null ? { state: "absent", path: null } : { state: "digest-mismatch", path: seen };
}

/** One row per turn that said something. `assistantPreview` is the redacted opening of the turn's
 *  assistant text; `assistantChars` keeps its true length, so a truncated row stays honest. */
function turnRows(trace, taskId) {
  const rows = [];
  for (const turn of Array.isArray(trace.turns) ? trace.turns : []) {
    if (!isRecord(turn)) continue;
    const text = isString(turn.assistantPreview) ? turn.assistantPreview.trim() : "";
    if (text.length === 0) continue;
    const chars =
      isNumber(turn.assistantChars) &&
      Number.isInteger(turn.assistantChars) &&
      turn.assistantChars >= text.length
        ? turn.assistantChars
        : text.length;
    rows.push({
      taskId,
      turn: Number.isInteger(turn.turn) ? turn.turn : rows.length + 1,
      kind: "solve-message",
      chars,
      truncated: chars > text.length,
      status: isString(turn.status) ? turn.status : null,
      text,
    });
  }
  return rows;
}

function inspectCase(campaign, row) {
  const taskId = isString(row.taskId) ? row.taskId : "(unnamed)";
  const outcome = caseOutcome(row);
  const base = {
    taskId,
    family: isString(row.family) ? row.family : null,
    outcome,
    nonResultKind: isString(row.runtimeNonResultKind) ? row.runtimeNonResultKind : null,
    pass: row.pass === true || row.pass === false ? row.pass : null,
    // The only clock a solve leaves behind: its turn rows carry a turn number and no timestamp, so
    // a reader placing solver prose on the run clock places the case window, never the turn.
    startedAt: isString(row.solverStartedAt) ? row.solverStartedAt : null,
    endedAt: isString(row.solverEndedAt) ? row.solverEndedAt : null,
  };
  const trace = resolveTrace(campaign, taskId, row.traces);
  if (trace.state !== "verified") {
    const issue =
      trace.state === "digest-mismatch"
        ? `${taskId}: the case trace on disk does not match the digest the case record published`
        : null;
    return { entry: { ...base, trace: trace.state, turns: 0, rows: 0, chars: 0 }, rows: [], issue };
  }
  let parsed;
  try {
    parsed = readJsonFile(trace.path);
  } catch {
    return {
      entry: { ...base, trace: "malformed", turns: 0, rows: 0, chars: 0 },
      rows: [],
      issue: `${taskId}: the case trace is unreadable`,
    };
  }
  const rows = turnRows(parsed, taskId);
  const turns = Array.isArray(parsed.turns) ? parsed.turns.length : 0;
  const entry = {
    ...base,
    trace: "verified",
    turns,
    rows: rows.length,
    chars: rows.reduce((sum, item) => sum + item.chars, 0),
  };
  return {
    entry,
    rows: rows.map((item) => ({ ...item, family: base.family, outcome, nonResultKind: base.nonResultKind })),
    issue: null,
  };
}

/** True when `target` is a campaign directory carrying a case record, so a caller pointed at an
 *  epoch directory or a bare sidecar does not read a missing file as an integrity failure. */
export function hasCaseRecord(target) {
  return existsSync(target) && statSync(target).isDirectory() && existsSync(join(target, CASE_RECORD));
}

/** Every recorded case of `runId` under `campaign`, with the solver prose each one left behind.
 *  A campaign with no case record is not an integrity failure: a run can end before its battery. */
export function censusSolves(campaign, { runId } = {}) {
  const issues = [];
  const cases = [];
  const rows = [];
  const record = readCaseRecord(campaign, runId);
  if (record.issue !== null) issues.push(record.issue);
  for (const row of record.rows) {
    const inspected = inspectCase(campaign, row);
    cases.push(inspected.entry);
    if (inspected.issue !== null) issues.push(inspected.issue);
    for (const item of inspected.rows) rows.push(item);
  }
  const counted = (outcome) => cases.filter((entry) => entry.outcome === outcome).length;
  const totals = {
    cases: cases.length,
    verified: counted("verified"),
    unaccepted: counted("unaccepted"),
    nonResult: counted("non-result"),
    tracesRead: cases.filter((entry) => entry.trace === "verified").length,
    tracesUnverified: cases.filter((entry) => entry.trace !== "verified").length,
    rows: rows.length,
    silentCases: cases.filter((entry) => entry.trace === "verified" && entry.rows === 0).length,
  };
  return {
    schema: SOLVE_CENSUS_SCHEMA,
    ok: issues.length === 0,
    scope: runId === undefined ? { kind: "campaign" } : { kind: "run", runId },
    cases,
    totals,
    issues,
    rows,
  };
}

/** Public projection: no solver row text leaves the deterministic census. */
export function publicSolveCensus(census) {
  const { rows: _rows, ...safe } = census;
  return safe;
}
