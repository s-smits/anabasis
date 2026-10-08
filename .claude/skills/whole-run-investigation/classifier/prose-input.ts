// Deterministic prose discovery for one whole run, both halves of it. The Builder's words sit in a
// sidecar beside each execution record, bound to it by a capture receipt; the Built solver's sit
// redacted inside each case trace, bound to the case record by digest. This module finds both,
// refuses what does not bind, and never returns row text from a public census: prose stays inside
// the classifier process. It loads no model and calls no provider.
import { existsSync, readFileSync, readdirSync, statSync } from "#src/meta/filesystem.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { asRecord, isBoolean, isNumber, isRecord, isString } from "#src/meta/json-shape.ts";
import type { JsonObject, JsonValue } from "#src/meta/json-shape.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";
import { campaignEpochOrder } from "#src/author/campaign-epoch.ts";
import { BUILDER_EXECUTION_EVIDENCE_FILE, BUILDER_EXECUTION_SCHEMA } from "#src/author/builder-execution.ts";
import {
  BUILDER_PROSE_CAPTURE_SCHEMA,
  BUILDER_PROSE_SCHEMA,
  type BuilderProseRow,
  proseRowCap,
  proseSidecarPath,
} from "#src/author/builder-prose.ts";
import {
  CASE_RECORD_FILE,
  type CaseRecordRow,
  classifyCaseOutcome,
  readCaseRecord,
} from "#src/claim/case-record.ts";
import { type ReadCaseTrace, campaignTraceRoots, readVerifiedTraceUnder } from "#src/claim/trace-read.ts";
import { campaignRuns, openedAt } from "#tools/runs/discover.ts";
import { jsonText } from "../scripts/run-overview.ts";

/** One epoch directory and the session numbers expected in it. */
interface EpochLocation {
  dir: string;
  epoch: string;
  sessions: number[];
}

/** A sidecar row that passed `validateRow`, with every field it carried. */
export interface ProseRow {
  schema: string;
  sequence: number;
  turn: number;
  atMs: number;
  kind: BuilderProseRow["kind"];
  chars: number;
  text: string;
  truncated: boolean;
}

/** The fields of a capture header `parseSidecar` checks and later compares. */
interface CaptureHeader {
  captureId: JsonValue;
  file: string;
  executionFile: string;
  rows: number;
  omitted: number;
}

interface Sidecar {
  header: CaptureHeader | null;
  rows: ProseRow[];
}

interface ExecutionRead {
  execution: JsonValue | null;
  unreadable: Error | null;
}

/** One session's capture state, as a public census lists it. */
export interface SessionCapture {
  epoch: string;
  session: number;
  dir: string;
  executionFile: string;
  proseFile: string;
  outcome: string | null;
  startedMs: number | null;
  endedMs: number | null;
  state: string;
  rows: number;
  omitted: number;
  captureId: JsonValue;
}

interface SessionInspection {
  capture: SessionCapture;
  rows: ProseRow[];
  issue: string | null;
}

/** A Builder row as the census returns it: the sidecar row plus where it came from. */
export interface CensusRow extends ProseRow {
  epoch: string;
  session: number;
  sessionOutcome: string | null;
}

/** One candidate submit on a session's own clock. */
export interface SessionSubmit {
  epoch: string;
  session: number;
  backend: string | null;
  turn: number;
  atMs: number;
  outcome: JsonValue;
  stage: JsonValue;
}

/** One `correctness_check` that returned, on a session's own clock. */
export interface SessionCheck {
  epoch: string;
  session: number;
  atMs: number;
}

/** The submits and returned checks of one session's execution record. */
interface SessionTools {
  submits: SessionSubmit[];
  checks: SessionCheck[];
}

/** The run's case rows, or the one issue that stopped them being read. */
interface CaseRows {
  rows: CaseRecordRow[];
  issue: string | null;
}

interface ProseFindings {
  captures: SessionCapture[];
  issues: string[];
  rows: CensusRow[];
  submits: SessionSubmit[];
  checks: SessionCheck[];
}

interface RunOpening {
  runId: string;
  openedMs: number;
}

interface RunScope {
  kind: "run";
  runId: string;
  otherRunSessions: number;
  unattributedSessions: number;
}

/** One solver turn that said something. */
export interface TurnRow {
  taskId: string;
  turn: number;
  kind: "solve-message";
  chars: number;
  truncated: boolean;
  status: string | null;
  text: string;
}

export type SolveOutcome = "verified" | "unaccepted" | "non-result";

/** A solver turn row joined to the kind its case ended as. */
export interface SolveRow extends TurnRow {
  family: string | null;
  outcome: SolveOutcome;
  nonResultKind: string | null;
}

/** One recorded case and what its trace held. */
export interface SolveCase {
  taskId: string;
  family: string | null;
  outcome: SolveOutcome;
  nonResultKind: string | null;
  pass: boolean | null;
  startedAt: string | null;
  endedAt: string | null;
  trace: string;
  turns: number;
  rows: number;
  chars: number;
}

interface CaseInspection {
  entry: SolveCase;
  rows: SolveRow[];
  issue: string | null;
}

/** The census options both readers take. */
export interface CensusOptions {
  runId?: string | undefined;
}

export const CENSUS_SCHEMA = "builder-prose-census/v1";
export const SOLVE_CENSUS_SCHEMA = "built-solve-prose-census/v1";
/** Execution outcomes that record an environment failure rather than authoring work. Their prose
 *  rows are the provider talking, not the Builder: a session closed on a provider limit can capture
 *  "You've hit your session limit" as its only row. Rows from these sessions carry no posture. A
 *  session the controller's closing signal ended (`signal-terminated`) is not one of them. */
export const NON_EVIDENCE_OUTCOMES = new Set(["turn-non-result", "evidence-unavailable"]);
const ROW_KINDS = ["message", "reasoning", "prompt", "compaction"] as const;
/** The rows in the Builder's own words. `prompt` and `compaction` rows record what the controller
 *  sent and what the transport did, so they carry no posture of the Builder's. */
const BUILDER_KINDS = new Set(["message", "reasoning"]);
const BACKENDS = ["codex", "claude", "openrouter"];
// The writer pads a session number to two digits and keeps every digit past them.
const EXECUTION_RE = /^builder-execution(?:-(\d{2,}))?\.json$/;
const PROSE_RE = /^builder-prose(?:-(\d{2,}))?\.jsonl$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const sessionOf = (name: string): number =>
  Number((EXECUTION_RE.exec(name) ?? PROSE_RE.exec(name))?.[1] ?? 1);
const executionName = (session: number): string =>
  session === 1
    ? BUILDER_EXECUTION_EVIDENCE_FILE
    : `builder-execution-${String(session).padStart(2, "0")}.json`;
const proseName = (session: number): string => basename(proseSidecarPath(`/${executionName(session)}`));
const validInteger = (value: JsonValue | undefined, minimum = 0): value is number =>
  isNumber(value) && Number.isInteger(value) && value >= minimum;
const isInteger = (value: JsonValue | undefined): value is number =>
  isNumber(value) && Number.isInteger(value);
const clock = (value: number): number | null => (Number.isFinite(value) ? value : null);
/** The text `Date.parse` reads for a recorded clock field; an absent or null field reads as "". */
const clockText = (value: JsonValue | undefined): string =>
  value === undefined || value === null ? "" : jsonText(value);

/** `value[key]` read the way a property read reads it: a null row throws, naming the field, and a
 *  primitive or a list has no such field. */
function field(value: JsonValue, key: string): JsonValue | undefined {
  if (value === null) throw new TypeError(`cannot read ${key} of a null row`);
  return isRecord(value) ? value[key] : undefined;
}

/** Absolute session start: the record's last write minus how long the session ran. Every prose row
 *  carries `atMs` from this instant and nothing else in the sidecar is absolute, so this is the
 *  only way a Builder row reaches the run clock. `NaN` when the record carries no usable clock. */
const startedMsOf = (value: JsonValue | null): number => {
  const record = asRecord(value);
  const durationMs = record?.durationMs;
  return (
    Date.parse(clockText(record?.writtenAt)) -
    (isNumber(durationMs) && Number.isFinite(durationMs) ? durationMs : Number.NaN)
  );
};

/** Each epoch with every session number up to the highest on disk, so a missing middle session is
 *  reported. Epochs come in the order epochs.json recorded them, since their names are hashes and
 *  sort into no chronology; without that record the target is itself one epoch's directory. */
function locationsFor(target: string): EpochLocation[] {
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

function validateRow(row: JsonValue, index: number, label: string): ProseRow {
  const at = `${label} row ${index + 1}`;
  if (!isRecord(row) || row.schema !== BUILDER_PROSE_SCHEMA) throw new Error(`${at}: unknown schema`);
  const { sequence, turn, atMs, chars, text, truncated } = row;
  if (sequence !== index + 1) throw new Error(`${at}: sequence is not contiguous`);
  if (!validInteger(turn, 1) || !validInteger(atMs)) throw new Error(`${at}: invalid turn or atMs`);
  const kind = ROW_KINDS.find((name) => name === row.kind);
  if (kind === undefined) throw new Error(`${at}: invalid kind`);
  if (!validInteger(chars, 1) || !isString(text) || text.length === 0) {
    throw new Error(`${at}: invalid text length`);
  }
  if (text !== text.trim() || text.length > proseRowCap(kind)) {
    throw new Error(`${at}: text is untrimmed or over the capture bound`);
  }
  if (!isBoolean(truncated) || (truncated ? chars <= text.length : chars !== text.length)) {
    throw new Error(`${at}: chars and truncation disagree`);
  }
  return { ...row, schema: BUILDER_PROSE_SCHEMA, sequence, turn, atMs, kind, chars, text, truncated };
}

/** The sidecar's capture header, or null when its first line is not one, and its rows. */
function parseSidecar(file: string): Sidecar {
  const label = basename(file);
  const values = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return capturedJsonParse(line);
      } catch (error) {
        throw new Error(`${label} line ${index + 1} is unreadable: ${errorMessage(error)}`, { cause: error });
      }
    });
  const first = values[0];
  const header = isRecord(first) && first.schema === BUILDER_PROSE_CAPTURE_SCHEMA ? first : null;
  if (header !== null) values.shift();
  const rows = values.map((row, index) => validateRow(row, index, label));
  if (header === null) return { header, rows };
  const captureId = header.captureId ?? "";
  const { file: headerFile, executionFile, rows: headerRows, omitted } = header;
  if (!UUID_RE.test(jsonText(captureId)) || !isString(headerFile) || !isString(executionFile)) {
    throw new Error(`${label}: malformed capture header identity`);
  }
  if (!validInteger(headerRows) || !validInteger(omitted) || headerRows !== rows.length) {
    throw new Error(`${label}: capture header counts disagree with rows`);
  }
  return { header: { captureId, file: headerFile, executionFile, rows: headerRows, omitted }, rows };
}

/** The execution record for one session, read once: null when absent, the read error when torn. */
function readExecution(location: EpochLocation, session: number): ExecutionRead {
  const path = join(location.dir, executionName(session));
  if (!existsSync(path)) return { execution: null, unreadable: null };
  try {
    return { execution: readJsonFile(path), unreadable: null };
  } catch (error) {
    const unreadable = new Error(`${basename(path)} is unreadable: ${errorMessage(error)}`, { cause: error });
    return { execution: null, unreadable };
  }
}

/** The omitted-row count an execution record states, 0 when it states none. The writer records a
 *  number, so any other value is a malformed record and is refused naming the field. */
function omittedOf(record: JsonObject): number {
  const omitted = record.proseOmitted ?? 0;
  if (!isNumber(omitted)) throw new Error("execution record proseOmitted is not a number");
  return omitted;
}

/** One session's capture state, from its execution record and its sidecar. */
function inspectSession(
  location: EpochLocation,
  session: number,
  execution: JsonValue | null,
): SessionInspection {
  const executionFile = executionName(session);
  const proseFile = proseName(session);
  const prosePath = join(location.dir, proseFile);
  const sidecar = existsSync(prosePath) ? parseSidecar(prosePath) : null;
  const record = asRecord(execution);
  if (execution !== null && (record === null || record.schema !== BUILDER_EXECUTION_SCHEMA)) {
    throw new Error(`${executionFile}: unknown execution schema`);
  }
  const proseCapture = record?.proseCapture;
  const receipt = isRecord(proseCapture) ? proseCapture : null;
  const header = sidecar?.header ?? null;
  const base = {
    epoch: location.epoch,
    session,
    dir: location.dir,
    executionFile,
    proseFile,
    outcome: isString(record?.outcome) ? record.outcome : null,
    startedMs: clock(startedMsOf(execution)),
    endedMs: clock(Date.parse(clockText(record?.writtenAt))),
  };
  const unbound = (
    state: string,
    issue: string | null,
    extra: { omitted?: number; captureId?: JsonValue } = {},
  ): SessionInspection => ({
    capture: { ...base, state, rows: sidecar?.rows.length ?? 0, omitted: 0, captureId: null, ...extra },
    rows: [],
    issue,
  });
  if (record === null && sidecar === null) {
    return unbound(
      "missing-session",
      `${location.epoch}/session-${String(session).padStart(2, "0")}: missing middle session`,
    );
  }
  if (record === null) return unbound("orphan-sidecar", `${proseFile}: no matching execution record`);
  if (sidecar === null) {
    const state = receipt === null ? "embedding-unavailable" : "missing-sidecar";
    const issue = receipt === null ? null : `${executionFile}: receipt names a missing sidecar`;
    return unbound(state, issue, {
      omitted: omittedOf(record),
      captureId: receipt?.captureId ?? null,
    });
  }
  if (receipt === null || header === null) {
    return unbound("receipt-mismatch", `${executionFile} and ${proseFile}: a capture receipt is missing`);
  }
  const matching =
    receipt.schema === BUILDER_PROSE_CAPTURE_SCHEMA &&
    receipt.captureId === header.captureId &&
    receipt.file === proseFile &&
    header.file === proseFile &&
    header.executionFile === executionFile &&
    receipt.rows === header.rows &&
    receipt.omitted === header.omitted &&
    record.proseOmitted === header.omitted;
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
function sessionTools(capture: SessionCapture, execution: JsonObject): SessionTools {
  const at = { epoch: capture.epoch, session: capture.session };
  const backend = BACKENDS.find((kind) => kind === execution.backend) ?? null;
  const submits = (Array.isArray(execution.submits) ? execution.submits : []).flatMap((row) => {
    const kind = field(row, "kind");
    const turn = field(row, "turn");
    const atMs = field(row, "atMs");
    if (kind === "controller-terminal" || !isInteger(turn) || !isInteger(atMs)) return [];
    return [
      {
        ...at,
        backend,
        turn,
        atMs,
        outcome: field(row, "outcome") ?? null,
        stage: field(row, "stage") ?? null,
      },
    ];
  });
  const checks = (Array.isArray(execution.customCalls) ? execution.customCalls : []).flatMap((call) => {
    const startedAtMs = field(call, "startedAtMs");
    const returned =
      field(call, "tool") === "correctness_check" && field(call, "dispatchOutcome") === "returned";
    return returned && isInteger(startedAtMs) ? [{ ...at, atMs: startedAtMs }] : [];
  });
  return { submits, checks };
}

/** Controller runs by opening time. The run that owns a Builder session is the latest one opened
 *  at or before that session started, so a late checkpoint written after the next run opened still
 *  belongs to the run that started it. An opening whose clock will not parse stays listed, because
 *  the run exists and the caller may name it, but its `NaN` attributes no session to itself. */
function runOpenings(campaign: string, runId: string): RunOpening[] {
  if (!existsSync(join(campaign, "controller"))) {
    throw new Error(`${campaign}: a run scope needs a campaign directory with controller/`);
  }
  const runs = campaignRuns(campaign)
    .map((run) => ({ runId: run.runId, openedMs: Date.parse(openedAt(run) ?? "") }))
    .sort((a, b) => a.openedMs - b.openedMs);
  if (!runs.some((run) => run.runId === runId)) throw new Error(`${campaign}: no opening for run ${runId}`);
  return runs;
}

const malformed = (location: EpochLocation, session: number): SessionCapture => ({
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
export function censusProse(target: string, { runId }: CensusOptions = {}) {
  const found: ProseFindings = { captures: [], issues: [], rows: [], submits: [], checks: [] };
  const run =
    runId === undefined
      ? null
      : {
          runs: runOpenings(target, runId),
          scope: { kind: "run", runId, otherRunSessions: 0, unattributedSessions: 0 } satisfies RunScope,
        };
  const scope: RunScope | { kind: "campaign" } = run?.scope ?? { kind: "campaign" };
  for (const location of locationsFor(target)) {
    for (const session of location.sessions) {
      const { execution, unreadable } = readExecution(location, session);
      if (run !== null) {
        const startedMs = startedMsOf(execution);
        const owner = Number.isFinite(startedMs)
          ? (run.runs.findLast((opening) => opening.openedMs <= startedMs)?.runId ?? null)
          : null;
        if (owner !== runId) {
          run.scope[owner === null ? "unattributedSessions" : "otherRunSessions"] += 1;
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
        const record = asRecord(execution);
        if (capture.state === "bound" && capture.rows > 0 && record !== null) {
          const tools = sessionTools(capture, record);
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
  const counted = (holds: (row: SessionCapture) => boolean): number =>
    captures.filter((row) => holds(row)).length;
  const totals = {
    sessions: captures.length,
    bound: counted((row) => row.state === "bound"),
    unavailable: counted((row) => row.state === "embedding-unavailable"),
    integrityFailures: counted((row) => !["bound", "embedding-unavailable"].includes(row.state)),
    rows: found.rows.length,
    omitted: captures.reduce((sum, row) => sum + row.omitted, 0),
    nonEvidenceSessions: counted((row) => row.outcome !== null && NON_EVIDENCE_OUTCOMES.has(row.outcome)),
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
export function publicCensus<
  T extends { rows: readonly object[]; submits?: readonly object[]; checks?: readonly object[] },
>(census: T): Omit<T, "rows" | "submits" | "checks"> {
  const { rows: _rows, submits: _submits, checks: _checks, ...safe } = census;
  return safe;
}

/** One row per turn that said something. `assistantPreview` is the redacted opening of the turn's
 *  assistant text; `assistantChars` keeps its true length, so a truncated row stays honest. */
function turnRows(trace: ReadCaseTrace, taskId: string): TurnRow[] {
  const rows: TurnRow[] = [];
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
    const number = isInteger(turn.turn) ? turn.turn : rows.length + 1;
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
function inspectCase(campaign: string, roots: readonly string[], row: CaseRecordRow): CaseInspection {
  const taskId = isString(row.taskId) ? row.taskId : "(unnamed)";
  const kind = classifyCaseOutcome(row);
  const base = {
    taskId,
    family: isString(row.family) ? row.family : null,
    outcome: kind === "pass" || kind === "fail" ? ("verified" as const) : kind,
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
export function hasCaseRecord(target: string): boolean {
  return existsSync(target) && statSync(target).isDirectory() && existsSync(join(target, CASE_RECORD_FILE));
}

/** The case rows through the strict case-record reader; a torn record is one issue, not read around. */
function caseRows(campaign: string, runId: string | undefined): CaseRows {
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
export function censusSolves(campaign: string, { runId }: CensusOptions = {}) {
  const record = caseRows(campaign, runId);
  const issues = record.issue === null ? [] : [record.issue];
  const roots = record.rows.length === 0 ? [] : campaignTraceRoots(campaign);
  const cases: SolveCase[] = [];
  const rows: SolveRow[] = [];
  for (const row of record.rows) {
    const inspected = inspectCase(campaign, roots, row);
    cases.push(inspected.entry);
    if (inspected.issue !== null) issues.push(inspected.issue);
    rows.push(...inspected.rows);
  }
  const counted = (holds: (entry: SolveCase) => boolean): number =>
    cases.filter((entry) => holds(entry)).length;
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
