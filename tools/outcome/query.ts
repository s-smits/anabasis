/**
 * Search with optional result limits over the two operator-facing trace indexes:
 * `case-record.jsonl` for measured cases and `observability/*.jsonl` for lifecycle events.
 *
 * This is discovery, not a new evidence owner. Case facts still come from the strict record
 * reader and the digest-bound trace reader. Observation rows remain telemetry and are parsed
 * strictly so a torn line is visible instead of disappearing from a search result.
 */
import { existsSync, readFileSync, readdirSync } from "../../src/meta/filesystem.ts";
import { join, relative } from "../../src/meta/path.ts";
import {
  CASE_RECORD_FILE,
  type CaseOutcome,
  type CaseRecordRow,
  caseVerdict,
  classifyCaseOutcome,
  readCaseRecord,
} from "../../src/claim/case-record.ts";
import {
  type TraceReadState,
  campaignTraceRoots,
  readVerifiedTraceUnder,
} from "../../src/claim/trace-read.ts";
import { plainRecord } from "../../src/meta/json-evidence.ts";
import type { ObservationLevel, ObservedInterface } from "../../src/observe/run-observer.ts";
import { type CaseTraceFacts, NO_TRACE_FACTS, caseTraceFacts } from "./trace-facts.ts";
import { type JsonValue, isNumber, isString } from "../../src/meta/json-shape.ts";
import { errorMessage } from "../../src/meta/runtime-values.ts";

export type CaseResult = CaseOutcome;

export interface CaseFilters {
  result: CaseResult | null;
  variant: string | null;
  family: string | null;
  tool: string | null;
  telemetry: TraceReadState | null;
  query: string | null;
  limit: number | null;
}

export interface ObservationFilters {
  level: ObservationLevel | null;
  contract: ObservedInterface | null;
  type: string | null;
  subject: string | null;
  query: string | null;
  includePrompts: boolean;
  limit: number | null;
}

interface CaseProjection {
  runId: string;
  taskId: string;
  family: string;
  variant: string | null;
  outcome: CaseResult;
  nonResultKind: string | null;
  backendPin: string;
  telemetry: TraceReadState;
  turns: number | null;
  toolCalls: number | null;
  tools: string[];
  truncated: boolean | null;
  /** Solver elapsed time, from the start and end timestamps copied into the case record. This
   *  allows cross-run duration reports without opening each run's battery.json.
   *  Null for older rows without timestamps, or when either timestamp cannot be parsed. */
  solverDurationMs: number | null;
}

interface ReadCase {
  row: CaseRecordRow;
  projection: CaseProjection;
  facts: CaseTraceFacts;
  trace: ReturnType<typeof readVerifiedTraceUnder>;
}

function selectedRows(campaignDir: string, selector: string): CaseRecordRow[] {
  return readCaseRecord(join(campaignDir, CASE_RECORD_FILE))
    .map((stored) => stored.row)
    .filter((row) => row.runId === selector || row.runId.startsWith(`${selector}-`));
}

function solverDurationMs(row: CaseRecordRow): number | null {
  if (row.solverStartedAt === undefined || row.solverEndedAt === undefined) return null;
  const started = Date.parse(row.solverStartedAt);
  const ended = Date.parse(row.solverEndedAt);
  return Number.isFinite(started) && Number.isFinite(ended) ? ended - started : null;
}

function readCase(row: CaseRecordRow, campaignDir: string, roots: readonly string[]): ReadCase {
  const trace = readVerifiedTraceUnder(row, campaignDir, roots);
  const facts = trace.trace === null ? NO_TRACE_FACTS : caseTraceFacts(trace.trace);
  return {
    row,
    facts,
    trace,
    projection: {
      runId: row.runId,
      taskId: row.taskId,
      family: row.family,
      variant: row.condition?.variant ?? null,
      outcome: classifyCaseOutcome(row),
      nonResultKind: row.runtimeNonResultKind,
      backendPin: row.backendPin,
      telemetry: trace.state,
      turns: facts.turns,
      toolCalls: facts.toolCalls,
      tools: facts.toolNames,
      truncated: trace.trace === null ? null : facts.truncated,
      solverDurationMs: solverDurationMs(row),
    },
  };
}

function caseMatches(subject: ReadCase, filters: CaseFilters): boolean {
  const { projection } = subject;
  if (filters.result !== null && projection.outcome !== filters.result) return false;
  if (filters.variant !== null && projection.variant !== filters.variant) return false;
  if (filters.family !== null && projection.family !== filters.family) return false;
  if (filters.telemetry !== null && projection.telemetry !== filters.telemetry) return false;
  if (
    filters.tool !== null &&
    !projection.tools.some(
      (tool) => tool === filters.tool || tool.replace(/^mcp__.+?__/, "") === filters.tool,
    )
  ) {
    return false;
  }
  if (
    filters.query !== null &&
    !JSON.stringify(projection).toLowerCase().includes(filters.query.toLowerCase())
  ) {
    return false;
  }
  return true;
}

function bounded<T>(values: readonly T[], limit: number | null): T[] {
  return limit === null ? [...values] : values.slice(0, limit);
}

function counts<T>(values: readonly T[], pick: (value: T) => string | null) {
  const result: Record<string, number> = {};
  for (const value of values) {
    const key = pick(value) ?? "<none>";
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function caseFacets(cases: readonly CaseProjection[]) {
  return {
    byOutcome: counts(cases, (item) => item.outcome),
    byVariant: counts(cases, (item) => item.variant),
    byFamily: counts(cases, (item) => item.family),
    byTelemetry: counts(cases, (item) => item.telemetry),
  };
}

/** Search the case record with verified trace facts. `matched` is before the optional limit. */
export function queryCases(campaignDir: string, selector: string, filters: CaseFilters) {
  const roots = campaignTraceRoots(campaignDir);
  const all = selectedRows(campaignDir, selector).map((row) => readCase(row, campaignDir, roots));
  const matches = all.filter((subject) => caseMatches(subject, filters)).map((subject) => subject.projection);
  const cases = bounded(matches, filters.limit);
  return {
    schema: "outcome-case-search/v1",
    selector,
    filters,
    matched: matches.length,
    returned: cases.length,
    truncated: cases.length < matches.length,
    facets: { all: caseFacets(all.map((subject) => subject.projection)), matched: caseFacets(matches) },
    cases,
  };
}

function dossierObservations(campaignDir: string, selector: string, taskId: string) {
  try {
    return {
      state: "readable",
      report: queryObservations(campaignDir, selector, {
        level: null,
        contract: null,
        type: null,
        subject: taskId,
        query: null,
        includePrompts: false,
        limit: null,
      }),
    };
  } catch (error) {
    return { state: "unreadable", error: errorMessage(error) };
  }
}

/** One task's evidence-and-trace dossier. The raw model transcript remains behind `--trace`. */
export function caseDossier(campaignDir: string, selector: string, taskId: string, variant: string | null) {
  const roots = campaignTraceRoots(campaignDir);
  const matches = selectedRows(campaignDir, selector)
    .filter((row) => row.taskId === taskId && (variant === null || row.condition?.variant === variant))
    .map((row) => readCase(row, campaignDir, roots));
  if (matches.length === 0) {
    const variantClause = variant === null ? "" : ` for variant ${variant}`;
    throw new Error(`no case ${taskId}${variantClause} under ${selector} in ${campaignDir}`);
  }
  return {
    schema: "outcome-case-dossier/v1",
    selector,
    taskId,
    observations: dossierObservations(
      campaignDir,
      variant === null ? selector : `${selector}-${variant}`,
      taskId,
    ),
    cases: matches.map(({ row, projection, facts, trace }) => ({
      ...projection,
      identity: {
        builderId: row.builderId,
        slug: row.slug,
        buildInputsHash: row.buildInputsHash,
        backendPin: row.backendPin,
      },
      verdict: caseVerdict(row),
      isolation:
        row.isolation === null
          ? null
          : {
              strength: row.isolation.strength,
              probe:
                row.isolation.probe === undefined
                  ? null
                  : {
                      fixture: row.isolation.probe.fixture,
                      profileDigest: row.isolation.probe.profileDigest,
                      isolated: row.isolation.probe.isolated,
                      available: row.isolation.probe.available,
                    },
              session: row.isolation.session ?? null,
            },
      condition: row.condition,
      trace: {
        state: trace.state,
        schema: trace.trace?.schema ?? null,
        backend: trace.trace?.backend ?? null,
        facts,
      },
      evidence: {
        caseRecord: join(campaignDir, CASE_RECORD_FILE),
        trace:
          trace.path === null
            ? null
            : {
                baseDir: trace.baseDir,
                path: trace.path,
                sha256: row.traces.find((pointer) => pointer.path === trace.path)?.sha256 ?? null,
              },
        pointers: row.traces,
      },
    })),
  };
}

function observationFiles(campaignDir: string, selector: string): string[] {
  const directory = join(campaignDir, "observability");
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter(
      (name) => name === `${selector}.jsonl` || (name.startsWith(`${selector}-`) && name.endsWith(".jsonl")),
    )
    .sort()
    .map((name) => join(directory, name));
}

export function readObservationFile(path: string, campaignDir: string): Array<Record<string, JsonValue>> {
  const rows: Array<Record<string, JsonValue>> = [];
  for (const [index, line] of readFileSync(path, "utf8").split(/\r?\n/).entries()) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`${path}:${index + 1}: malformed observation line`);
    }
    const row = plainRecord(parsed);
    if (
      row === null ||
      !isString(row.schema) ||
      !row.schema.startsWith("ana-observation/") ||
      !isString(row.id) ||
      !isNumber(row.seq) ||
      !isString(row.runId) ||
      !isString(row.type)
    ) {
      throw new Error(`${path}:${index + 1}: misshapen observation row`);
    }
    rows.push({ ...row, source: relative(campaignDir, path) });
  }
  return rows;
}

/** The row as the caller's filters allow it to be read: without the prompt body unless that was
 *  explicitly requested. Both readers hold the filters already, and `observationMatches` beside
 *  it takes them the same way, so nothing here reads as a bare `true`. */
function projectedObservation(
  row: Record<string, JsonValue>,
  filters: ObservationFilters,
): Record<string, JsonValue> {
  if (filters.includePrompts) return row;
  const { prompt: _prompt, ...projection } = row;
  return projection;
}

/** A recorded field read as text. An observation row is JSON, so a field a writer left as an
 *  object or a number sorts as the empty string rather than as `[object Object]`. */
function text(row: Record<string, JsonValue>, field: string): string {
  const value = row[field];
  return isString(value) ? value : "";
}

function observationMatches(
  row: Record<string, JsonValue>,
  filters: ObservationFilters,
  subjectIds: ReadonlySet<string> | null,
): boolean {
  if (filters.level !== null && row.level !== filters.level) return false;
  if (filters.contract !== null && row.contract !== filters.contract) return false;
  if (filters.type !== null && row.type !== filters.type) return false;
  if (subjectIds !== null && (!isString(row.id) || !subjectIds.has(row.id))) return false;
  const visible = projectedObservation(row, filters);
  if (
    filters.query !== null &&
    !JSON.stringify(visible).toLowerCase().includes(filters.query.toLowerCase())
  ) {
    return false;
  }
  return true;
}

/** A subject means the rows naming it plus every descendant in the observation tree. */
function subjectClosure(
  rows: readonly Record<string, JsonValue>[],
  subject: string | null,
): ReadonlySet<string> | null {
  if (subject === null) return null;
  const ids = new Set(
    rows
      .values()
      .filter((row) => row.subjectId === subject && isString(row.id))
      .map((row) => /* SAFETY: the filter above kept only rows whose `id` is a string. */ row.id as string)
      .toArray(),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (isString(row.id) && isString(row.parentId) && ids.has(row.parentId) && !ids.has(row.id)) {
        ids.add(row.id);
        changed = true;
      }
    }
  }
  return ids;
}

function observationFacets(rows: readonly Record<string, JsonValue>[]) {
  const stringAt = (row: Record<string, JsonValue>, key: string): string | null =>
    isString(row[key]) ? row[key] : null;
  return {
    byLevel: counts(rows, (row) => stringAt(row, "level")),
    byInterface: counts(rows, (row) => stringAt(row, "contract")),
    byType: counts(rows, (row) => stringAt(row, "type")),
    byKind: counts(rows, (row) => stringAt(row, "kind")),
  };
}

/** Search lifecycle observations without printing prompt bodies unless explicitly requested. */
export function queryObservations(campaignDir: string, selector: string, filters: ObservationFilters) {
  const files = observationFiles(campaignDir, selector);
  const all = files
    .flatMap((path) => readObservationFile(path, campaignDir))
    .sort((a, b) => {
      const byTime = text(a, "at").localeCompare(text(b, "at"));
      return byTime === 0 ? text(a, "id").localeCompare(text(b, "id")) : byTime;
    });
  const subjects = subjectClosure(all, filters.subject);
  const matches = all.filter((row) => observationMatches(row, filters, subjects));
  const observations = bounded(matches, filters.limit).map((row) => projectedObservation(row, filters));
  return {
    schema: "outcome-observation-search/v1",
    selector,
    files: files.map((path) => relative(campaignDir, path)),
    filters,
    total: all.length,
    matched: matches.length,
    returned: observations.length,
    truncated: observations.length < matches.length,
    promptsIncluded: filters.includePrompts,
    facets: { all: observationFacets(all), matched: observationFacets(matches) },
    observations,
  };
}
