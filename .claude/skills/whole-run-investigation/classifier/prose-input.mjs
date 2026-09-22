// Deterministic Builder-prose discovery and receipt validation. This module never loads an
// embedding model and never returns prose text from its public census; prose remains local to the
// classifier process.
import { existsSync, readFileSync, readdirSync, statSync } from "#src/meta/filesystem.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { isBoolean, isRecord, isString } from "#src/meta/json-shape.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";

export const CENSUS_SCHEMA = "builder-prose-census/v1";
/** Execution outcomes that record an environment failure rather than authoring work. Their prose
 *  rows are the provider talking, not the Builder: run 064960 captured "You've hit your session
 *  limit" as the only row of its second epoch. Rows from these sessions carry no posture. */
export const NON_EVIDENCE_OUTCOMES = new Set(["turn-non-result", "evidence-unavailable"]);
const CAPTURE_SCHEMA = "builder-prose-capture/v1";
const ROW_SCHEMA = "builder-prose/v1";
const EXECUTION_SCHEMA = "builder-execution/v5";
const EXECUTION_RE = /^builder-execution(?:-(\d{2}))?\.json$/;
const PROSE_RE = /^builder-prose(?:-(\d{2}))?\.jsonl$/;
const EPOCH_RE = /^epoch-[0-9a-f]{12}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Absolute session start: the record's last write minus how long the session ran. Every prose row
 *  carries `atMs` from this instant and nothing else in the sidecar is absolute, so this is the
 *  only way a Builder row reaches the run clock. `NaN` when the record carries no usable clock. */
const startedMsOf = (record) =>
  Date.parse(record?.writtenAt ?? "") -
  (Number.isFinite(record?.durationMs) ? record.durationMs : Number.NaN);
const clock = (value) => (Number.isFinite(value) ? value : null);
/** The session's absolute window, which is the only route a prose row has onto the run clock. */
const sessionWindow = (execution) => ({
  startedMs: clock(startedMsOf(execution)),
  endedMs: clock(Date.parse(execution?.writtenAt ?? "")),
});
const sessionOf = (name, pattern) => Number(pattern.exec(name)?.[1] ?? 1);
const executionName = (session) =>
  session === 1 ? "builder-execution.json" : `builder-execution-${String(session).padStart(2, "0")}.json`;
const proseName = (session) =>
  session === 1 ? "builder-prose.jsonl" : `builder-prose-${String(session).padStart(2, "0")}.jsonl`;

function directoryLocations(target) {
  const entries = readdirSync(target, { withFileTypes: true });
  const epochs = entries
    .filter((entry) => entry.isDirectory() && EPOCH_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (epochs.length > 0) return epochs.map((epoch) => ({ dir: join(target, epoch), epoch }));
  // Without epoch folders the target is itself one epoch's directory.
  const direct = entries.some(
    (entry) => entry.isFile() && (EXECUTION_RE.test(entry.name) || PROSE_RE.test(entry.name)),
  );
  return direct ? [{ dir: target, epoch: basename(target) }] : [];
}

function locationsFor(target) {
  if (!existsSync(target)) throw new Error(`${target}: target does not exist`);
  if (statSync(target).isDirectory()) return directoryLocations(target);
  const name = basename(target);
  const match = EXECUTION_RE.exec(name) ?? PROSE_RE.exec(name);
  if (match === null) throw new Error(`${target}: expected a Builder execution or prose filename`);
  return [{ dir: dirname(target), epoch: basename(dirname(target)), onlySession: Number(match[1] ?? 1) }];
}

function parseJson(file) {
  try {
    return readJsonFile(file);
  } catch (error) {
    throw new Error(`${basename(file)} is unreadable: ${errorMessage(error)}`, { cause: error });
  }
}

function validInteger(value, minimum = 0) {
  return Number.isInteger(value) && value >= minimum;
}

function validateRow(row, index, file) {
  const label = `${basename(file)} row ${index + 1}`;
  if (!isRecord(row) || row.schema !== ROW_SCHEMA) throw new Error(`${label}: unknown schema`);
  if (row.sequence !== index + 1) throw new Error(`${label}: sequence is not contiguous`);
  if (!validInteger(row.turn, 1) || !validInteger(row.atMs)) {
    throw new Error(`${label}: invalid turn or atMs`);
  }
  if (row.kind !== "message" && row.kind !== "reasoning") throw new Error(`${label}: invalid kind`);
  if (!validInteger(row.chars, 1) || !isString(row.text) || row.text.length === 0) {
    throw new Error(`${label}: invalid text length`);
  }
  if (row.text !== row.text.trim() || row.text.length > 4000) {
    throw new Error(`${label}: text is untrimmed or over the capture bound`);
  }
  if (
    !isBoolean(row.truncated) ||
    (row.truncated ? row.chars <= row.text.length : row.chars !== row.text.length)
  ) {
    throw new Error(`${label}: chars and truncation disagree`);
  }
}

function parseSidecar(file) {
  const values = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${basename(file)} line ${index + 1} is unreadable: ${errorMessage(error)}`, {
          cause: error,
        });
      }
    });
  const header = isRecord(values[0]) && values[0].schema === CAPTURE_SCHEMA ? values.shift() : null;
  values.forEach((row, index) => validateRow(row, index, file));
  if (header !== null) {
    if (!UUID_RE.test(header.captureId ?? "") || !isString(header.file) || !isString(header.executionFile)) {
      throw new Error(`${basename(file)}: malformed capture header identity`);
    }
    if (!validInteger(header.rows) || !validInteger(header.omitted) || header.rows !== values.length) {
      throw new Error(`${basename(file)}: capture header counts disagree with rows`);
    }
  }
  return { header, rows: values };
}

function pairSessions(location) {
  if (location.onlySession !== undefined) return [location.onlySession];
  const names = readdirSync(location.dir);
  const sessions = new Set();
  for (const name of names) {
    if (EXECUTION_RE.test(name)) sessions.add(sessionOf(name, EXECUTION_RE));
    if (PROSE_RE.test(name)) sessions.add(sessionOf(name, PROSE_RE));
  }
  const ordered = [...sessions].sort((a, b) => a - b);
  const maximum = ordered.at(-1) ?? 0;
  return Array.from({ length: maximum }, (_, index) => index + 1);
}

/** A session whose execution record names a typed non-result or unavailable evidence produced no
 *  authoring work to have a posture about. The outcome travels with the capture so the classifier
 *  can exclude those rows instead of labelling a provider message as Builder reasoning. */
function outcomeOf(execution) {
  if (!isRecord(execution) || !isString(execution.outcome)) return null;
  return execution.outcome;
}

function inspectPair(location, session) {
  const executionFile = executionName(session);
  const proseFile = proseName(session);
  const executionPath = join(location.dir, executionFile);
  const prosePath = join(location.dir, proseFile);
  const execution = existsSync(executionPath) ? parseJson(executionPath) : null;
  const sidecar = existsSync(prosePath) ? parseSidecar(prosePath) : null;
  if (execution !== null && (!isRecord(execution) || execution.schema !== EXECUTION_SCHEMA)) {
    throw new Error(`${executionFile}: unknown execution schema`);
  }
  const receipt = isRecord(execution?.proseCapture) ? execution.proseCapture : null;
  const base = {
    epoch: location.epoch,
    session,
    dir: location.dir,
    executionFile,
    proseFile,
    outcome: outcomeOf(execution),
    ...sessionWindow(execution),
  };
  if (execution === null && sidecar === null) {
    return {
      capture: { ...base, state: "missing-session", rows: 0, omitted: 0, captureId: null },
      rows: [],
      issue: `${location.epoch}/session-${String(session).padStart(2, "0")}: missing middle session`,
    };
  }
  if (execution === null) {
    return {
      capture: {
        ...base,
        state: "orphan-sidecar",
        rows: sidecar?.rows.length ?? 0,
        omitted: 0,
        captureId: null,
      },
      rows: [],
      issue: `${proseFile}: no matching execution record`,
    };
  }
  if (sidecar === null) {
    const state = receipt === null ? "embedding-unavailable" : "missing-sidecar";
    return {
      capture: {
        ...base,
        state,
        rows: 0,
        omitted: execution.proseOmitted ?? 0,
        captureId: receipt?.captureId ?? null,
      },
      rows: [],
      issue: receipt === null ? null : `${executionFile}: receipt names a missing sidecar`,
    };
  }
  if (receipt === null || sidecar.header === null) {
    return {
      capture: { ...base, state: "receipt-mismatch", rows: sidecar.rows.length, omitted: 0, captureId: null },
      rows: [],
      issue: `${executionFile} and ${proseFile}: a capture receipt is missing`,
    };
  }
  const header = sidecar.header;
  const matching =
    receipt.schema === CAPTURE_SCHEMA &&
    receipt.captureId === header.captureId &&
    receipt.file === proseFile &&
    header.file === proseFile &&
    header.executionFile === executionFile &&
    receipt.rows === header.rows &&
    receipt.omitted === header.omitted &&
    execution.proseOmitted === header.omitted;
  if (!matching) {
    return {
      capture: {
        ...base,
        state: "receipt-mismatch",
        rows: sidecar.rows.length,
        omitted: header.omitted,
        captureId: header.captureId,
      },
      rows: [],
      issue: `${executionFile} and ${proseFile}: capture receipts disagree`,
    };
  }
  return {
    capture: {
      ...base,
      state: "bound",
      rows: sidecar.rows.length,
      omitted: header.omitted,
      captureId: header.captureId,
    },
    rows: sidecar.rows,
  };
}

/** Controller runs by opening time. A campaign's invocations run one after another, so the run
 *  that owns a Builder session is the latest one opened before that session started. An opening
 *  whose clock will not parse stays in the list, because the run exists and the caller may name it;
 *  its `NaN` fails every comparison in `sessionRun`, so it attributes no session to itself. */
function runOpenings(campaign) {
  const controller = join(campaign, "controller");
  if (!existsSync(controller)) {
    throw new Error(`${campaign}: a run scope needs a campaign directory with controller/`);
  }
  return readdirSync(controller)
    .filter((runId) => existsSync(join(controller, runId, "opening.json")))
    .map((runId) => ({
      runId,
      openedMs: Date.parse(parseJson(join(controller, runId, "opening.json")).writtenAt ?? ""),
    }))
    .sort((a, b) => a.openedMs - b.openedMs);
}

/** The run whose invocation started this session: the record's last write minus its duration, so a
 *  late checkpoint written after the next run opened still belongs to the run that started it.
 *  Null when the record is absent or carries no usable clock. */
function sessionRun(location, session, runs) {
  const path = join(location.dir, executionName(session));
  if (!existsSync(path)) return null;
  let record;
  try {
    record = parseJson(path);
  } catch {
    return null;
  }
  const startedMs = startedMsOf(record);
  if (!Number.isFinite(startedMs)) return null;
  return runs.findLast((run) => run.openedMs <= startedMs)?.runId ?? null;
}

/** Every Builder session under `target`, or only those one controller run started when `runId` is
 *  given. Epochs are no run boundary: two runs can author sessions in the same epoch. */
export function censusProse(target, { runId } = {}) {
  const captures = [];
  const rows = [];
  const issues = [];
  const runs = runId === undefined ? null : runOpenings(target);
  if (runs !== null && !runs.some((run) => run.runId === runId)) {
    throw new Error(`${target}: no opening for run ${runId}`);
  }
  const scope =
    runs === null
      ? { kind: "campaign" }
      : { kind: "run", runId, otherRunSessions: 0, unattributedSessions: 0 };
  for (const location of locationsFor(target)) {
    for (const session of pairSessions(location)) {
      if (runs !== null) {
        const owner = sessionRun(location, session, runs);
        if (owner !== runId) {
          scope[owner === null ? "unattributedSessions" : "otherRunSessions"] += 1;
          continue;
        }
      }
      try {
        const inspected = inspectPair(location, session);
        captures.push(inspected.capture);
        if (inspected.issue !== null && inspected.issue !== undefined) issues.push(inspected.issue);
        for (const row of inspected.rows) {
          rows.push({ ...row, epoch: location.epoch, session, sessionOutcome: inspected.capture.outcome });
        }
      } catch (error) {
        const message = errorMessage(error);
        captures.push({
          epoch: location.epoch,
          session,
          dir: location.dir,
          executionFile: executionName(session),
          proseFile: proseName(session),
          state: "malformed",
          rows: 0,
          omitted: 0,
          captureId: null,
          startedMs: null,
          endedMs: null,
        });
        issues.push(message);
      }
    }
  }
  const totals = {
    sessions: captures.length,
    bound: captures.filter((row) => row.state === "bound").length,
    unavailable: captures.filter((row) => row.state === "embedding-unavailable").length,
    integrityFailures: captures.filter((row) => !["bound", "embedding-unavailable"].includes(row.state))
      .length,
    rows: rows.length,
    omitted: captures.reduce((sum, row) => sum + row.omitted, 0),
    nonEvidenceSessions: captures.filter((row) => NON_EVIDENCE_OUTCOMES.has(row.outcome)).length,
  };
  return { schema: CENSUS_SCHEMA, ok: issues.length === 0, scope, captures, totals, issues, rows };
}

/** Public projection: no protected row text leaves the deterministic census. */
export function publicCensus(census) {
  const { rows: _rows, ...safe } = census;
  return safe;
}
