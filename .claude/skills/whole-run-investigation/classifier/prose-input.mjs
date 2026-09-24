// Deterministic prose discovery for one whole run, both halves of it. The Builder's words sit in a
// sidecar beside each execution record, bound to it by a capture receipt; the Built solver's sit
// redacted inside each case trace, bound to the case record by digest. This module finds both,
// refuses what does not bind, and never returns row text from a public census: prose stays inside
// the classifier process. It loads no model and calls no provider.
import { existsSync, readFileSync, readdirSync, statSync } from "#src/meta/filesystem.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { isBoolean, isNumber, isRecord, isString } from "#src/meta/json-shape.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";
import { campaignEpochOrder } from "#src/author/campaign-epoch.ts";
import { BUILDER_EXECUTION_SCHEMA } from "#src/author/builder-execution.ts";
import { proseRowCap, proseSidecarPath } from "#src/author/builder-prose.ts";
import { CASE_RECORD_FILE, classifyCaseOutcome, readCaseRecord } from "#src/claim/case-record.ts";
import { campaignTraceRoots, readVerifiedTraceUnder } from "#src/claim/trace-read.ts";
import { campaignRuns, openedAt } from "#tools/runs/discover.ts";

export const CENSUS_SCHEMA = "builder-prose-census/v1";
export const SOLVE_CENSUS_SCHEMA = "built-solve-prose-census/v1";
/** Execution outcomes that record an environment failure rather than authoring work. Their prose
 *  rows are the provider talking, not the Builder: a session closed on a provider limit can capture
 *  "You've hit your session limit" as its only row. Rows from these sessions carry no posture. */
export const NON_EVIDENCE_OUTCOMES = new Set(["turn-non-result", "evidence-unavailable"]);
const CAPTURE_SCHEMA = "builder-prose-capture/v1";
const ROW_SCHEMA = "builder-prose/v2";
const ROW_KINDS = new Set(["message", "reasoning", "prompt", "compaction"]);
/** The rows in the Builder's own words. `prompt` and `compaction` rows record what the controller
 *  sent and what the transport did, so they carry no posture of the Builder's. */
const BUILDER_KINDS = new Set(["message", "reasoning"]);
const BACKENDS = ["codex", "claude", "openrouter"];
// The writer pads a session number to two digits and keeps every digit past them.
const EXECUTION_RE = /^builder-execution(?:-(\d{2,}))?\.json$/;
const PROSE_RE = /^builder-prose(?:-(\d{2,}))?\.jsonl$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const sessionOf = (name) => Number((EXECUTION_RE.exec(name) ?? PROSE_RE.exec(name))?.[1] ?? 1);
const executionName = (session) =>
  session === 1 ? "builder-execution.json" : `builder-execution-${String(session).padStart(2, "0")}.json`;
const proseName = (session) => basename(proseSidecarPath(`/${executionName(session)}`));
const validInteger = (value, minimum = 0) => Number.isInteger(value) && value >= minimum;
const clock = (value) => (Number.isFinite(value) ? value : null);

/** Absolute session start: the record's last write minus how long the session ran. Every prose row
 *  carries `atMs` from this instant and nothing else in the sidecar is absolute, so this is the
 *  only way a Builder row reaches the run clock. `NaN` when the record carries no usable clock. */
const startedMsOf = (record) =>
  Date.parse(record?.writtenAt ?? "") -
  (Number.isFinite(record?.durationMs) ? record.durationMs : Number.NaN);

/** Each epoch with every session number up to the highest on disk, so a missing middle session is
 *  reported. Epochs come in the order epochs.json recorded them, since their names are hashes and
 *  sort into no chronology; without that record the target is itself one epoch's directory. */
function locationsFor(target) {
  if (!existsSync(target)) throw new Error(`${target}: target does not exist`);
  if (!statSync(target).isDirectory()) {
    const name = basename(target);
    if (!EXECUTION_RE.test(name) && !PROSE_RE.test(name)) {
      throw new Error(`${target}: expected a Builder execution or prose filename`);
    }
    return [{ dir: dirname(target), epoch: basename(dirname(target)), sessions: [sessionOf(name)] }];
  }
  const epochs = campaignEpochOrder(target);
  const located =
    epochs.length > 0
      ? epochs.map((epoch) => ({ dir: join(target, epoch), epoch }))
      : [{ dir: target, epoch: basename(target) }];
  return located.map((location) => {
    const numbers = readdirSync(location.dir)
      .filter((name) => EXECUTION_RE.test(name) || PROSE_RE.test(name))
      .map(sessionOf);
    const maximum = numbers.length === 0 ? 0 : Math.max(...numbers);
    return { ...location, sessions: Array.from({ length: maximum }, (_, index) => index + 1) };
  });
}

function validateRow(row, index, label) {
  const at = `${label} row ${index + 1}`;
  if (!isRecord(row) || row.schema !== ROW_SCHEMA) throw new Error(`${at}: unknown schema`);
  if (row.sequence !== index + 1) throw new Error(`${at}: sequence is not contiguous`);
  if (!validInteger(row.turn, 1) || !validInteger(row.atMs)) throw new Error(`${at}: invalid turn or atMs`);
  if (!ROW_KINDS.has(row.kind)) throw new Error(`${at}: invalid kind`);
  if (!validInteger(row.chars, 1) || !isString(row.text) || row.text.length === 0) {
    throw new Error(`${at}: invalid text length`);
  }
  if (row.text !== row.text.trim() || row.text.length > proseRowCap(row.kind)) {
    throw new Error(`${at}: text is untrimmed or over the capture bound`);
  }
  if (
    !isBoolean(row.truncated) ||
    (row.truncated ? row.chars <= row.text.length : row.chars !== row.text.length)
  ) {
    throw new Error(`${at}: chars and truncation disagree`);
  }
}

/** The sidecar's capture header, or null when its first line is not one, and its rows. */
function parseSidecar(file) {
  const label = basename(file);
  const values = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${label} line ${index + 1} is unreadable: ${errorMessage(error)}`, { cause: error });
      }
    });
  const header = isRecord(values[0]) && values[0].schema === CAPTURE_SCHEMA ? values.shift() : null;
  values.forEach((row, index) => validateRow(row, index, label));
  if (header !== null) {
    if (!UUID_RE.test(header.captureId ?? "") || !isString(header.file) || !isString(header.executionFile)) {
      throw new Error(`${label}: malformed capture header identity`);
    }
    if (!validInteger(header.rows) || !validInteger(header.omitted) || header.rows !== values.length) {
      throw new Error(`${label}: capture header counts disagree with rows`);
    }
  }
  return { header, rows: values };
}

/** The execution record for one session, read once: null when absent, the read error when torn. */
function readExecution(location, session) {
  const path = join(location.dir, executionName(session));
  if (!existsSync(path)) return { execution: null, unreadable: null };
  try {
    return { execution: readJsonFile(path), unreadable: null };
  } catch (error) {
    const unreadable = new Error(`${basename(path)} is unreadable: ${errorMessage(error)}`, { cause: error });
    return { execution: null, unreadable };
  }
}

/** One session's capture state, from its execution record and its sidecar. */
function inspectSession(location, session, execution) {
  const executionFile = executionName(session);
  const proseFile = proseName(session);
  const prosePath = join(location.dir, proseFile);
  const sidecar = existsSync(prosePath) ? parseSidecar(prosePath) : null;
  if (execution !== null && (!isRecord(execution) || execution.schema !== BUILDER_EXECUTION_SCHEMA)) {
    throw new Error(`${executionFile}: unknown execution schema`);
  }
  const receipt = isRecord(execution?.proseCapture) ? execution.proseCapture : null;
  const header = sidecar?.header ?? null;
  const base = {
    epoch: location.epoch,
    session,
    dir: location.dir,
    executionFile,
    proseFile,
    outcome: isString(execution?.outcome) ? execution.outcome : null,
    startedMs: clock(startedMsOf(execution)),
    endedMs: clock(Date.parse(execution?.writtenAt ?? "")),
  };
  const unbound = (state, issue, extra = {}) => ({
    capture: { ...base, state, rows: sidecar?.rows.length ?? 0, omitted: 0, captureId: null, ...extra },
    rows: [],
    issue,
  });
  if (execution === null && sidecar === null) {
    return unbound(
      "missing-session",
      `${location.epoch}/session-${String(session).padStart(2, "0")}: missing middle session`,
    );
  }
  if (execution === null) return unbound("orphan-sidecar", `${proseFile}: no matching execution record`);
  if (sidecar === null) {
    const state = receipt === null ? "embedding-unavailable" : "missing-sidecar";
    const issue = receipt === null ? null : `${executionFile}: receipt names a missing sidecar`;
    return unbound(state, issue, {
      omitted: execution.proseOmitted ?? 0,
      captureId: receipt?.captureId ?? null,
    });
  }
  if (receipt === null || header === null) {
    return unbound("receipt-mismatch", `${executionFile} and ${proseFile}: a capture receipt is missing`);
  }
  const matching =
    receipt.schema === CAPTURE_SCHEMA &&
    receipt.captureId === header.captureId &&
    receipt.file === proseFile &&
    header.file === proseFile &&
    header.executionFile === executionFile &&
    receipt.rows === header.rows &&
    receipt.omitted === header.omitted &&
    execution.proseOmitted === header.omitted;
  const bound = { omitted: header.omitted, captureId: header.captureId };
  if (!matching) {
    return unbound("receipt-mismatch", `${executionFile} and ${proseFile}: capture receipts disagree`, bound);
  }
  return {
    capture: { ...base, state: "bound", rows: sidecar.rows.length, ...bound },
    rows: sidecar.rows.filter((row) => BUILDER_KINDS.has(row.kind)),
    issue: null,
  };
}

/** Candidate submits in record order, with the clock of every `correctness_check` that returned,
 *  from the same execution record the capture was bound against. The record answers outright
 *  whether a preview ran between two submits, which is why no anchor class asks it. */
function sessionTools(capture, execution) {
  const at = { epoch: capture.epoch, session: capture.session };
  const backend = BACKENDS.find((kind) => kind === execution.backend) ?? null;
  const submits = (Array.isArray(execution.submits) ? execution.submits : [])
    .filter(
      (row) => row.kind !== "controller-terminal" && Number.isInteger(row.turn) && Number.isInteger(row.atMs),
    )
    .map((row) => ({
      ...at,
      backend,
      turn: row.turn,
      atMs: row.atMs,
      outcome: row.outcome ?? null,
      stage: row.stage ?? null,
    }));
  const checks = (Array.isArray(execution.customCalls) ? execution.customCalls : [])
    .filter(
      (call) =>
        call.tool === "correctness_check" &&
        call.dispatchOutcome === "returned" &&
        Number.isInteger(call.startedAtMs),
    )
    .map((call) => ({ ...at, atMs: call.startedAtMs }));
  return { submits, checks };
}

/** Controller runs by opening time. The run that owns a Builder session is the latest one opened
 *  at or before that session started, so a late checkpoint written after the next run opened still
 *  belongs to the run that started it. An opening whose clock will not parse stays listed, because
 *  the run exists and the caller may name it, but its `NaN` attributes no session to itself. */
function runOpenings(campaign, runId) {
  if (!existsSync(join(campaign, "controller"))) {
    throw new Error(`${campaign}: a run scope needs a campaign directory with controller/`);
  }
  const runs = campaignRuns(campaign)
    .map((run) => ({ runId: run.runId, openedMs: Date.parse(openedAt(run) ?? "") }))
    .sort((a, b) => a.openedMs - b.openedMs);
  if (!runs.some((run) => run.runId === runId)) throw new Error(`${campaign}: no opening for run ${runId}`);
  return runs;
}

const malformed = (location, session) => ({
  epoch: location.epoch,
  session,
  dir: location.dir,
  executionFile: executionName(session),
  proseFile: proseName(session),
  outcome: null,
  startedMs: null,
  endedMs: null,
  state: "malformed",
  rows: 0,
  omitted: 0,
  captureId: null,
});

/** Every Builder session under `target`, or only those one controller run started when `runId` is
 *  given, with the submits and checks of its bound sessions. Epochs are no run boundary: two runs
 *  can author sessions in the same epoch. Each execution record is read once. */
export function censusProse(target, { runId } = {}) {
  const found = { captures: [], issues: [], rows: [], submits: [], checks: [] };
  const runs = runId === undefined ? null : runOpenings(target, runId);
  const scope =
    runs === null
      ? { kind: "campaign" }
      : { kind: "run", runId, otherRunSessions: 0, unattributedSessions: 0 };
  for (const location of locationsFor(target)) {
    for (const session of location.sessions) {
      const { execution, unreadable } = readExecution(location, session);
      if (runs !== null) {
        const startedMs = startedMsOf(execution);
        const owner = Number.isFinite(startedMs)
          ? (runs.findLast((run) => run.openedMs <= startedMs)?.runId ?? null)
          : null;
        if (owner !== runId) {
          scope[owner === null ? "unattributedSessions" : "otherRunSessions"] += 1;
          continue;
        }
      }
      try {
        if (unreadable !== null) throw unreadable;
        const { capture, rows, issue } = inspectSession(location, session, execution);
        found.captures.push(capture);
        if (issue !== null) found.issues.push(issue);
        for (const row of rows) {
          found.rows.push({ ...row, epoch: location.epoch, session, sessionOutcome: capture.outcome });
        }
        if (capture.state === "bound" && capture.rows > 0) {
          const tools = sessionTools(capture, execution);
          found.submits.push(...tools.submits);
          found.checks.push(...tools.checks);
        }
      } catch (error) {
        found.captures.push(malformed(location, session));
        found.issues.push(errorMessage(error));
      }
    }
  }
  const { captures } = found;
  const counted = (holds) => captures.filter((row) => holds(row) === true).length;
  const totals = {
    sessions: captures.length,
    bound: counted((row) => row.state === "bound"),
    unavailable: counted((row) => row.state === "embedding-unavailable"),
    integrityFailures: counted((row) => !["bound", "embedding-unavailable"].includes(row.state)),
    rows: found.rows.length,
    omitted: captures.reduce((sum, row) => sum + row.omitted, 0),
    nonEvidenceSessions: counted((row) => NON_EVIDENCE_OUTCOMES.has(row.outcome)),
  };
  const { issues, rows, submits, checks } = found;
  return {
    schema: CENSUS_SCHEMA,
    ok: issues.length === 0,
    scope,
    captures,
    totals,
    issues,
    rows,
    submits,
    checks,
  };
}

/** Public projection of either census: no row text, and no tool clocks, leave the reading. */
export function publicCensus(census) {
  const { rows: _rows, submits: _submits, checks: _checks, ...safe } = census;
  return safe;
}

/** One row per turn that said something. `assistantPreview` is the redacted opening of the turn's
 *  assistant text; `assistantChars` keeps its true length, so a truncated row stays honest. */
function turnRows(trace, taskId) {
  const rows = [];
  for (const turn of trace.turns) {
    const text = isString(turn.assistantPreview) ? turn.assistantPreview.trim() : "";
    if (text.length === 0) continue;
    const chars =
      isNumber(turn.assistantChars) &&
      Number.isInteger(turn.assistantChars) &&
      turn.assistantChars >= text.length
        ? turn.assistantChars
        : text.length;
    const status = isString(turn.status) ? turn.status : null;
    const number = Number.isInteger(turn.turn) ? turn.turn : rows.length + 1;
    rows.push({
      taskId,
      turn: number,
      kind: "solve-message",
      chars,
      truncated: chars > text.length,
      status,
      text,
    });
  }
  return rows;
}

/** A case trace is read only when its bytes match the digest the case record published for it: an
 *  investigation that reads posture off unverified bytes is reading a file, not the run. A pass and
 *  a fail are both verified cases, which is the separation the working contract reads rates by. */
function inspectCase(campaign, roots, row) {
  const taskId = isString(row.taskId) ? row.taskId : "(unnamed)";
  const kind = classifyCaseOutcome(row);
  const base = {
    taskId,
    family: isString(row.family) ? row.family : null,
    outcome: kind === "pass" || kind === "fail" ? "verified" : kind,
    nonResultKind: isString(row.runtimeNonResultKind) ? row.runtimeNonResultKind : null,
    pass: row.pass === true || row.pass === false ? row.pass : null,
    // The only clock a solve leaves behind: its turn rows carry a turn number and no timestamp, so
    // a reader placing solver prose on the run clock places the case window, never the turn.
    startedAt: isString(row.solverStartedAt) ? row.solverStartedAt : null,
    endedAt: isString(row.solverEndedAt) ? row.solverEndedAt : null,
  };
  const read = readVerifiedTraceUnder(row, campaign, roots);
  if (read.trace === null) {
    const issue =
      read.state === "trace-drifted"
        ? `${taskId}: the case trace on disk does not match the digest the case record published`
        : null;
    return { entry: { ...base, trace: read.state, turns: 0, rows: 0, chars: 0 }, rows: [], issue };
  }
  const rows = turnRows(read.trace, taskId).map((item) => ({
    ...item,
    family: base.family,
    outcome: base.outcome,
    nonResultKind: base.nonResultKind,
  }));
  const chars = rows.reduce((sum, item) => sum + item.chars, 0);
  return {
    entry: { ...base, trace: read.state, turns: read.trace.turns.length, rows: rows.length, chars },
    rows,
    issue: null,
  };
}

/** True when `target` is a campaign directory carrying a case record, so a caller pointed at an
 *  epoch directory or a bare sidecar does not read a missing file as an integrity failure. */
export function hasCaseRecord(target) {
  return existsSync(target) && statSync(target).isDirectory() && existsSync(join(target, CASE_RECORD_FILE));
}

/** The case rows through the strict case-record reader; a torn record is one issue, not read around. */
function caseRows(campaign, runId) {
  const path = join(campaign, CASE_RECORD_FILE);
  if (!existsSync(path)) {
    return {
      rows: [],
      issue: `${CASE_RECORD_FILE}: absent, so the run has no recorded cases to read posture against`,
    };
  }
  try {
    const rows = readCaseRecord(path)
      .map((entry) => entry.row)
      .filter((row) => runId === undefined || row.runId === runId);
    return { rows, issue: null };
  } catch (error) {
    return { rows: [], issue: errorMessage(error) };
  }
}

/** Every recorded case of `runId` under `campaign`, with the solver prose each one left behind. */
export function censusSolves(campaign, { runId } = {}) {
  const record = caseRows(campaign, runId);
  const issues = record.issue === null ? [] : [record.issue];
  const roots = record.rows.length === 0 ? [] : campaignTraceRoots(campaign);
  const cases = [];
  const rows = [];
  for (const row of record.rows) {
    const inspected = inspectCase(campaign, roots, row);
    cases.push(inspected.entry);
    if (inspected.issue !== null) issues.push(inspected.issue);
    rows.push(...inspected.rows);
  }
  const counted = (holds) => cases.filter((entry) => holds(entry) === true).length;
  const totals = {
    cases: cases.length,
    verified: counted((entry) => entry.outcome === "verified"),
    unaccepted: counted((entry) => entry.outcome === "unaccepted"),
    nonResult: counted((entry) => entry.outcome === "non-result"),
    tracesRead: counted((entry) => entry.trace === "recorded"),
    tracesUnverified: counted((entry) => entry.trace !== "recorded"),
    rows: rows.length,
    silentCases: counted((entry) => entry.trace === "recorded" && entry.rows === 0),
  };
  const scope = runId === undefined ? { kind: "campaign" } : { kind: "run", runId };
  return { schema: SOLVE_CENSUS_SCHEMA, ok: issues.length === 0, scope, cases, totals, issues, rows };
}
