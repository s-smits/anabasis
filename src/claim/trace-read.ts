/**
 * Shared case-trace reader: resolve pointer → verify digest → check schema → return parsed trace.
 *
 * Case traces once had three readers with different integrity checks: the operator view in
 * tools/outcome verified pointer digests, the UI constructed a path and read its contents, and the
 * former per-case Judge 2 checked only that the file existed, although its comment claimed digest
 * verification. This shared reader resolves the row's pointer, recalculates the digest through
 * `verifyTracePointers`, and requires a schema from `CASE_TRACE_SCHEMA` before returning a trace,
 * so every consumer now applies the same checks. Missing or changed traces produce a specific
 * state for the consumer to report, and a file is never accepted merely because its name matches.
 * Operator views and Judge reviews share this implementation, kept beside the case record that
 * creates these pointers.
 */
import { defaultProductDir } from "../meta/campaign-root.ts";
import { readdirSync, realpathSync, statSync } from "../meta/filesystem.ts";
import { basename, dirname, join, resolve } from "../meta/path.ts";
import { CASE_TRACE_SCHEMA } from "../backends/trace-capture.ts";
import { plainRecord } from "../meta/json-evidence.ts";
import { type TracePointer, tracePointerPath, verifyTracePointers } from "./case-record.ts";
import { isSafePathSegment } from "../meta/path-segment.ts";
import { type JsonValue, isNumber, isObject, isString } from "../meta/json-shape.ts";
import { readJsonFile } from "../meta/completed-json.ts";

/** The same vocabulary the operator projection always reported, now shared by every reader. */
export type TraceReadState = "recorded" | "no-trace-pointer" | "trace-missing" | "trace-drifted";

/**
 * The structure the reader checks on a current-schema trace. Timing, usage and cost stay per
 * field, because the producer records null for a duration, token count or cost it did not observe;
 * consumers check those fields at use. The producer's `CaseTrace` type defines what a write holds.
 */
export interface ReadCaseTrace {
  schema: string;
  backend: string | null;
  turns: Array<Record<string, JsonValue>>;
  toolCalls: Array<Record<string, JsonValue>>;
  truncated: boolean;
  droppedRawEvents: number;
}

export interface VerifiedTraceRead {
  state: TraceReadState;
  /** Parsed trace when state is "recorded", else null — never bytes that failed the digest. */
  trace: ReadCaseTrace | null;
  /** Where the pointer resolved (base dir + relative path), for evidence citation. */
  baseDir: string | null;
  path: string | null;
}

const ABSENT: VerifiedTraceRead = { state: "no-trace-pointer", trace: null, baseDir: null, path: null };

function parseReadableTrace(absPath: string): ReadCaseTrace | null {
  let parsed: unknown;
  try {
    parsed = readJsonFile(absPath);
  } catch {
    return null;
  }
  const record = plainRecord(parsed);
  if (record === null) return null;
  if (record.schema !== CASE_TRACE_SCHEMA) return null;
  if (!Array.isArray(record.turns) || !Array.isArray(record.toolCalls)) return null;
  return {
    schema: record.schema,
    backend: isString(record.backend) ? record.backend : null,
    turns: record.turns.filter((t): t is Record<string, JsonValue> => isObject(t)),
    toolCalls: record.toolCalls.filter((c): c is Record<string, JsonValue> => isObject(c)),
    truncated: record.truncated === true,
    droppedRawEvents: isNumber(record.droppedRawEvents) ? record.droppedRawEvents : 0,
  };
}

/**
 * Read under one base directory. Return the first pointer with an intact digest that parses
 * as a supported trace, trying trace.json names first. Record rows begin with a battery.json
 * pointer, and hashing and parsing that 60 KB file for every row only to reject its schema was
 * measured unnecessary work; the ordering avoids that read while keeping the digest and schema
 * checks on every pointer actually tried. Once a trace is found the remaining pointers are not
 * read. If none qualifies, report changed evidence before missing evidence when both were found,
 * and if every pointer is intact but none carries a supported trace schema, report no trace
 * pointer.
 */
export function readVerifiedTrace(row: { traces: TracePointer[] }, baseDir: string): VerifiedTraceRead {
  const ordered = [
    ...row.traces.filter((pointer) => basename(pointer.path) === "trace.json"),
    ...row.traces.filter((pointer) => basename(pointer.path) !== "trace.json"),
  ];
  const states = new Set<string>();
  for (const pointer of ordered) {
    const verdict = verifyTracePointers({ traces: [pointer] }, baseDir)[0];
    states.add(verdict?.state ?? "missing");
    if (verdict?.state !== "intact") continue;
    const trace = parseReadableTrace(join(baseDir, pointer.path));
    if (trace !== null) return { state: "recorded", trace, baseDir, path: pointer.path };
  }
  if (states.has("drifted")) return { ...ABSENT, state: "trace-drifted" };
  if (states.has("missing")) return { ...ABSENT, state: "trace-missing" };
  return ABSENT;
}

/**
 * The producer (run-driver) writes pointers relative to the battery's tree root: the
 * adopted tree `domains/<slug>/` (a sibling of the campaign dir), or `candidates/<run>/` and
 * `contest/<run>/` under it, or a retained tree under `promotions/` or `versions/`. The case
 * record itself sits at the campaign root. Readers search these conventional locations and still
 * verify the digest, so a matching filename alone is insufficient. All of those locations have to
 * be searched: a battery measured against the adopted tree leaves a reader that searches only the
 * campaign root reporting every intact trace as missing. Each candidate root must be a direct
 * directory before it is used.
 */
function directDirectory(path: string, parent: string): boolean {
  try {
    return statSync(path).isDirectory() && realpathSync(path) === join(realpathSync(parent), basename(path));
  } catch {
    return false;
  }
}

/** The campaign subtrees a trace may be discovered under. Nothing writes `contest/` any more --
 *  the paired repair contest is gone, and `measurePair`, `pairedContestApplies` and
 *  `withheldContest` all sit on the refused-calls list in `tools/loc/source-policy.json`, so it
 *  cannot return without that list moving first. It stays here as a read-only surface because one
 *  recorded campaign still has the directory, and dropping the name would not make that archive
 *  refuse to load: it would make its traces silently read as missing, which is the failure this
 *  reader's own header says it exists to prevent. */
const CAMPAIGN_TREE_CONTAINERS = ["candidates", "contest", "promotions", "versions"] as const;

/** The configured campaigns/domains collections may be linked by a run worktree. Their
 * children must remain direct directories, including when a caller reuses cached roots. */
function campaignTraceRoot(root: string, campaignDir: string): boolean {
  const campaign = resolve(campaignDir);
  const path = resolve(root);
  if (!isSafePathSegment(basename(campaign)) || !directDirectory(campaign, dirname(campaign))) return false;
  const domain = defaultProductDir(dirname(dirname(campaign)), basename(campaign));
  if (path === campaign || path === domain) return directDirectory(path, dirname(path));
  const parent = dirname(path);
  return (
    CAMPAIGN_TREE_CONTAINERS.some((name) => parent === join(campaign, name)) &&
    directDirectory(parent, campaign) &&
    directDirectory(path, parent)
  );
}

export function campaignTraceRoots(campaignDir: string): string[] {
  const roots = [campaignDir, defaultProductDir(dirname(dirname(campaignDir)), basename(campaignDir))].filter(
    (root) => campaignTraceRoot(root, campaignDir),
  );
  for (const parent of CAMPAIGN_TREE_CONTAINERS) {
    const dir = join(campaignDir, parent);
    if (!directDirectory(dir, campaignDir)) continue;
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (campaignTraceRoot(abs, campaignDir)) roots.push(abs);
    }
  }
  return roots;
}

/** Campaign-relative verified read: probe the conventional roots for the first pointer's path,
 *  then read under the root that carries it. No root carrying it is a stated missing. A caller
 *  folding many rows of one campaign passes the roots once instead of re-scanning per row. */
export function readVerifiedTraceUnder(
  row: { traces: TracePointer[] },
  campaignDir: string,
  roots: readonly string[] = campaignTraceRoots(campaignDir),
): VerifiedTraceRead {
  const first = row.traces[0];
  if (first === undefined) return ABSENT;
  const base = roots.find(
    (root) => campaignTraceRoot(root, campaignDir) && tracePointerPath(root, first.path) !== null,
  );
  if (base === undefined) return { ...ABSENT, state: "trace-missing" };
  return readVerifiedTrace(row, base);
}
