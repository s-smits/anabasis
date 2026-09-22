/**
 * Host-code execution facts for a run: V8 coverage aggregation and the diff intersection that
 * answers "did the functions this commit range changed actually execute". Coverage exists only
 * when the run was launched with NODE_V8_COVERAGE (the launchd launcher's --env flag carries
 * it); without it the intersection still names the changed functions and reports execution as
 * unknown instead of guessing.
 */
import { existsSync, readFileSync, readdirSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { scanTokens } from "../loc/token-facts.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { hostTool } from "../../src/meta/host-tool.ts";
import { CAPTURE_MAX_BYTES, runTextSyncOrThrow } from "../../src/meta/subprocess.ts";

export interface FnCount {
  file: string;
  name: string;
  count: number;
}

interface V8Script {
  url?: string;
  functions?: Array<{ functionName?: string; ranges?: Array<{ count?: number }> }>;
}

interface FnSpan {
  name: string;
  start: number;
  end: number;
}

export interface ChangedFn {
  file: string;
  name: string;
  executed: number | null;
}

/** Sum function-level V8 counts across all coverage files, keyed by (repo-relative file, function
 *  name). tsx keeps the module URL on the .ts source, so file identity is exact even though byte
 *  offsets describe transpiled text — which is why aggregation keys on names, never offsets. */
export function aggregateCoverage(scripts: V8Script[], repoRoot: string): FnCount[] {
  const rows = new Map<string, FnCount>();
  for (const script of scripts) {
    const url = script.url ?? "";
    if (!url.startsWith("file://")) continue;
    const path = decodeURIComponent(url.slice("file://".length));
    if (!path.startsWith(repoRoot) || path.includes("/node_modules/")) continue;
    const rel = path.slice(repoRoot.length).replace(/^\//, "");
    if (!/^(src|tools|starters)\//.test(rel)) continue;
    for (const fn of script.functions ?? []) {
      const name = fn.functionName === undefined || fn.functionName === "" ? "(anonymous)" : fn.functionName;
      const count = fn.ranges?.[0]?.count ?? 0;
      const key = `${rel}|${name}`;
      const row = rows.get(key) ?? { file: rel, name, count: 0 };
      row.count += count;
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.count - a.count);
}

/** Load every coverage-*.json a NODE_V8_COVERAGE directory holds. */
export function readV8Coverage(dir: string, repoRoot: string): FnCount[] {
  if (!existsSync(dir)) return [];
  const scripts: V8Script[] = [];
  for (const name of readdirSync(dir).filter((n) => n.startsWith("coverage-") && n.endsWith(".json"))) {
    const d = parseJsonAs<{ result?: V8Script[] }>(readFileSync(join(dir, name), "utf8"));
    scripts.push(...(d.result ?? []));
  }
  return aggregateCoverage(scripts, repoRoot);
}

/** Named function spans in one source file, from the token scanner — the same
 *  brace-bodied frames the 80-line ceiling measures. Method shorthand has no `function` or `=>`
 *  token and is not framed; the repository's source is declarations and arrow consts, and a
 *  missed method reads as "unknown", never as a false execution claim. */
export function functionSpans(sourceText: string): FnSpan[] {
  return scanTokens(sourceText).spans;
}

/** New-side changed line ranges per file from a unified diff with zero context. A pure-deletion
 *  hunk keeps its anchor line so the enclosing function still counts as changed. */
export function parseUnifiedDiff(diffText: string): Map<string, Array<[number, number]>> {
  const out = new Map<string, Array<[number, number]>>();
  let file: string | null = null;
  for (const line of diffText.split("\n")) {
    const header = /^\+\+\+ b\/(.*)$/.exec(line);
    if (header !== null) {
      file = header[1] ?? null;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk === null || file === null) continue;
    const start = Number(hunk[1]);
    const added = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const ranges = out.get(file) ?? [];
    ranges.push([start, start + Math.max(added, 1) - 1]);
    out.set(file, ranges);
  }
  return out;
}

/** The changed functions of a commit range, joined to coverage when it exists. A changed line
 *  attributes to the smallest enclosing span, so an edit inside a helper names the helper and
 *  not its parent. */
export function diffIntersection(repoDir: string, range: string, cov: FnCount[] | null): ChangedFn[] {
  const diff = runTextSyncOrThrow(
    [hostTool("git"), "-C", repoDir, "diff", "--unified=0", range, "--", "src", "tools"],
    { maxBuffer: CAPTURE_MAX_BYTES },
  );
  const byFn = new Map<string, ChangedFn>();
  for (const [file, ranges] of parseUnifiedDiff(diff)) {
    if (!file.endsWith(".ts")) continue;
    const path = join(repoDir, file);
    if (!existsSync(path)) continue;
    const spans = functionSpans(readFileSync(path, "utf8"));
    for (const [start, end] of ranges) {
      for (let line = start; line <= end; line += 1) {
        const span = smallestSpanAt(spans, line);
        if (span === null) continue;
        const key = `${file}|${span.name}`;
        if (byFn.has(key)) continue;
        const hit = cov?.find((c) => c.file === file && c.name === span.name);
        byFn.set(key, { file, name: span.name, executed: cov === null ? null : (hit?.count ?? 0) });
      }
    }
  }
  return [...byFn.values()].sort((a, b) => a.file.localeCompare(b.file));
}

function smallestSpanAt(spans: FnSpan[], line: number): FnSpan | null {
  let best: FnSpan | null = null;
  for (const span of spans) {
    if (line < span.start || line > span.end) continue;
    if (best === null || span.end - span.start < best.end - best.start) best = span;
  }
  return best;
}
