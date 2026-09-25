/**
 * Read-only triage readers over one finished run worktree. Everything here reads what the
 * controller recorded — evidence, observability events, per-case traces — and never writes into
 * the run tree: the report describes the saved run without repairing it. Counts come
 * from typed fields; free text is carried only where the public run log already showed it.
 */
import { campaignRoot } from "../../src/meta/campaign-root.ts";
import { existsSync, readFileSync, readdirSync, statSync } from "../../src/meta/filesystem.ts";
import { basename, join } from "../../src/meta/path.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { JUDGE_REVIEWS_SCHEMA, type JudgeReviewsResult } from "../../src/analyse/judge-reviews.ts";
import { judgeDecision } from "../../src/claim/judge.ts";
import { BATTERY_FILE } from "../../src/truth/battery-record.ts";

interface LogLine {
  at: string;
  text: string;
}

export interface ActivityCount {
  file: string;
  kind: string;
  phase: string;
  role: string;
  /** How the span settled, empty on rows that carry no state. Grouping without it counted ten
   *  starts and ten completions as twenty occurrences of one step. */
  state: string;
  /** The emitter's own reading of the row. Without it the table showed run c1d2a7's one error and
   *  four warnings as 205 rows of ordinary progress. */
  level: string;
  count: number;
}

interface ObservationRow {
  kind?: string;
  phase?: string;
  role?: string;
  state?: string;
  level?: string;
  summary?: string;
  claim?: string;
}

interface NarrativeRow {
  kind: string;
  phase: string;
  /** `started`, `completed` or `failed`; empty on events. The narrative printed neither, so a
   *  failed step read as a finished one and an opened span as a closed one. */
  state: string;
  level: string;
  summary: string;
}

export interface CaseRow {
  taskId: string;
  family: string;
  pass: boolean | null;
  truthOk: boolean | null;
  nonResult: string | null;
  turns: number;
  toolCalls: number;
}

export interface BatteryInfo {
  runId: string;
  condition: string | null;
  dir: string;
  cases: CaseRow[];
  models: Map<string, number>;
}

interface BatteryFile {
  runId?: string;
  condition?: string;
  cases?: Array<{
    taskId?: string;
    family?: string;
    pass?: boolean | null;
    truthOk?: boolean | null;
    runtimeNonResultKind?: string | null;
    solver?: {
      turns?: number;
      toolCalls?: number;
      runtimeIdentities?: Array<{ provider?: { model?: string | null } }>;
    };
  }>;
}

export interface AnalysisEvidence {
  claims: Array<{
    name: string;
    ok: boolean;
    passed: number;
    n: number;
    identity: string;
    clauses: string[];
  }>;
  judges: Array<{
    name: string;
    /** The census decision, or why the review was not read. */
    decision: string;
    abstained: number | null;
    reviewed: string;
    contested: number | null;
    provisional: string | null;
  }>;
}

/** The `[fullrun]` lines of the worktree's run log, in file order. Any *.log at the worktree
 *  root qualifies; the launcher writes exactly one. */
export function readRunLog(runDir: string): LogLine[] {
  const lines: LogLine[] = [];
  for (const name of readdirSync(runDir)) {
    if (!name.endsWith(".log")) continue;
    for (const raw of readFileSync(join(runDir, name), "utf8").split("\n")) {
      const m = /^\[fullrun\] (\S+) (.*)$/.exec(raw);
      if (m?.[1] !== undefined && m[2] !== undefined) lines.push({ at: m[1], text: m[2] });
    }
  }
  return lines;
}

/** The campaign directory: the named slug, or the single campaign the run tree holds. */
export function runCampaignDir(runDir: string, slug?: string): string {
  const base = campaignRoot(runDir);
  const entries = existsSync(base)
    ? readdirSync(base).filter((e) => statSync(join(base, e)).isDirectory())
    : [];
  if (slug !== undefined) return join(base, slug);
  const only = entries[0];
  if (entries.length !== 1 || only === undefined) {
    throw new Error(`expected one campaign under ${base}, found ${entries.length}; pass --slug`);
  }
  return join(base, only);
}

/** Rows of the selected observation streams, in file then write order, with the file each came
 *  from. The census reads every stream and the narrative the base one; both used to spell the
 *  directory walk, the blank-line skip and the parse themselves. */
function* streamRows(camp: string, pick: (names: string[]) => string[]): Generator<[string, ObservationRow]> {
  const dir = join(camp, "observability");
  if (!existsSync(dir)) return;
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .sort();
  for (const name of pick(names)) {
    for (const line of readFileSync(join(dir, name), "utf8").split("\n")) {
      if (line.trim() !== "") yield [name, parseJsonAs<ObservationRow>(line)];
    }
  }
}

/** Model generations and spans by (kind, phase, role, state, level) for each observability stream. */
export function observabilityCensus(camp: string): ActivityCount[] {
  const rows = new Map<string, ActivityCount>();
  for (const [file, d] of streamRows(camp, (names) => names)) {
    const seen: ActivityCount = {
      file,
      kind: d.kind ?? "",
      phase: d.phase ?? "",
      role: d.role ?? "",
      state: d.state ?? "",
      level: d.level ?? "",
      count: 0,
    };
    const key = [file, seen.kind, seen.phase, seen.role, seen.state, seen.level].join("|");
    const row = rows.get(key) ?? seen;
    row.count += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => (a.file + a.kind).localeCompare(b.file + b.kind));
}

/** The base run's event stream as a decision narrative: spans and decision events with the
 *  summary text the public log already carried. The base stream is the .jsonl whose stem has
 *  no variant suffix — the shortest stem. The stored suffix remains `variant` for compatibility. */
export function loopNarrative(camp: string): NarrativeRow[] {
  const base = (names: string[]) => [...names].sort((a, b) => a.length - b.length).slice(0, 1);
  const rows: NarrativeRow[] = [];
  for (const [, d] of streamRows(camp, base)) {
    if (d.kind !== "span" && d.kind !== "event") continue;
    rows.push({
      kind: d.kind,
      phase: d.phase ?? "",
      state: d.state ?? "",
      level: d.level ?? "",
      summary: (d.summary ?? d.claim ?? "").replace(/\s+/g, " ").slice(0, 220),
    });
  }
  return rows;
}

/** Every recorded battery in the run tree, deduplicated by runId. Candidate bundles carry
 *  copies of earlier batteries, so the first hit per runId wins. */
export function readBatteries(runDir: string, camp: string): BatteryInfo[] {
  const found = new Map<string, BatteryInfo>();
  for (const path of walkFor([camp, join(runDir, "domains")], BATTERY_FILE)) {
    const d = parseJsonAs<BatteryFile>(readFileSync(path, "utf8"));
    if (d.runId === undefined || found.has(d.runId)) continue;
    const cases = d.cases ?? [];
    const models = new Map<string, number>();
    for (const id of cases.flatMap((c) => c.solver?.runtimeIdentities ?? [])) {
      const model = id.provider?.model ?? "(unrecorded)";
      models.set(model, (models.get(model) ?? 0) + 1);
    }
    found.set(d.runId, {
      runId: d.runId,
      condition: d.condition ?? null,
      dir: join(path, ".."),
      cases: cases.map((c) => ({
        taskId: c.taskId ?? "?",
        family: c.family ?? "?",
        pass: c.pass ?? null,
        truthOk: c.truthOk ?? null,
        nonResult: c.runtimeNonResultKind ?? null,
        turns: c.solver?.turns ?? 0,
        toolCalls: c.solver?.toolCalls ?? 0,
      })),
      models,
    });
  }
  return [...found.values()].sort((a, b) => a.runId.localeCompare(b.runId));
}

/** Built-agent tool usage for one battery: calls and errors by tool name across its case
 *  traces. This is the harness's tool contract as actually exercised. */
export function toolCallCensus(batteryDir: string): Map<string, { calls: number; errors: number }> {
  const out = new Map<string, { calls: number; errors: number }>();
  const casesDir = join(batteryDir, "cases");
  if (!existsSync(casesDir)) return out;
  for (const caseName of readdirSync(casesDir)) {
    const tracePath = join(casesDir, caseName, "trace.json");
    if (!existsSync(tracePath)) continue;
    const trace = parseJsonAs<{
      toolCalls?: Array<{ toolName?: string; isError?: boolean }>;
    }>(readFileSync(tracePath, "utf8"));
    for (const call of trace.toolCalls ?? []) {
      const row = out.get(call.toolName ?? "?") ?? { calls: 0, errors: 0 };
      row.calls += 1;
      if (call.isError === true) row.errors += 1;
      out.set(call.toolName ?? "?", row);
    }
  }
  return out;
}

/** Claims and judge reviews, by evidence file. */
export function readAnalysis(camp: string): AnalysisEvidence {
  const out: AnalysisEvidence = { claims: [], judges: [] };
  const claimsDir = join(camp, "claims");
  for (const name of existsSync(claimsDir) ? readdirSync(claimsDir) : []) {
    const d = parseJsonAs<{
      claim?: { ok?: boolean; statement?: { passed?: number; n?: number; modelIdentity?: string } };
      readiness?: { clauses?: string[] };
    }>(readFileSync(join(claimsDir, name), "utf8"));
    out.claims.push({
      name: basename(name, ".json"),
      ok: d.claim?.ok === true,
      passed: d.claim?.statement?.passed ?? 0,
      n: d.claim?.statement?.n ?? 0,
      identity: d.claim?.statement?.modelIdentity ?? "(absent)",
      clauses: d.readiness?.clauses ?? [],
    });
  }
  const analysisDir = join(camp, "analysis");
  for (const name of existsSync(analysisDir) ? readdirSync(analysisDir) : []) {
    if (name.endsWith("judges.json")) out.judges.push(readJudgeReview(join(analysisDir, name)));
  }
  return out;
}

/** One battery's Judge review in the schema the controller writes; any other schema is named, not read. */
function readJudgeReview(path: string): AnalysisEvidence["judges"][number] {
  const d = parseJsonAs<Partial<JudgeReviewsResult>>(readFileSync(path, "utf8"));
  const name = basename(path, ".json");
  if (d.schema !== JUDGE_REVIEWS_SCHEMA) {
    const decision = `not read: schema ${String(d.schema)} is not ${JUDGE_REVIEWS_SCHEMA}`;
    return { name, decision, abstained: null, reviewed: "—", contested: null, provisional: null };
  }
  const evidence = d.census?.evidence ?? null;
  return {
    name,
    decision: (evidence === null ? null : judgeDecision(evidence)) ?? "no census",
    abstained: evidence?.abstentions ?? null,
    reviewed: `${d.coverage?.reviewed ?? 0}/${d.coverage?.reviewable ?? 0}`,
    contested: d.contested?.length ?? 0,
    provisional: d.provisional ?? null,
  };
}

/** Walk for an evidence file name, skipping dependency and session-internal trees. */
function walkFor(roots: string[], fileName: string): string[] {
  const hits: string[] = [];
  const skip = new Set(["node_modules", ".git", ".oss", ".venv"]);
  const visit = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const path = join(dir, entry);
      // A dangling symlink (every 2026-09-05 run worktree carries one under domains/*/.toolchain)
      // is not evidence; it used to end triage before a line printed.
      const stat = statSync(path, { throwIfNoEntry: false });
      if (stat === undefined) continue;
      if (stat.isDirectory()) visit(path);
      else if (entry === fileName) hits.push(path);
    }
  };
  for (const root of roots) visit(root);
  return hits;
}
