// The cyclomatic ceiling for authored functions: every function stays below 22, which is the
// `max: 21` this file passes to oxlint's ESLint `complexity` rule. Oxlint does the counting, so
// what this file owns is the baseline, and the baseline is why the ceiling could be introduced at
// all. Freezing today's offenders at the counts they already measure lets the gate refuse a new
// offender and refuse growth in an old one from the first push, instead of blocking every push
// until the whole tree has been simplified.
//
// The baseline only ever shrinks. `--write-baseline` lowers a recorded count to what is now
// measured and drops an entry whose function no longer exceeds the ceiling, and it never adds a
// function or raises a count, so the exemption set cannot widen by running the tool. A genuinely
// new exception therefore has to be a hand edit of `complexity-baseline.json`, which is visible in
// the diff it lands in and can be argued about there. An entry that has stopped exempting anything
// is a finding of its own rather than harmless debt, for the same reason a stale copied-file
// ceiling is one: it is a standing exemption from a rule the file already satisfies.
//
// The report gives one line per problem file, naming its functions as `name:line count` — the
// three facts the measurement produces and nothing else — then two sentences on what to do. A wide
// diff is therefore one line per file rather than a block per function, and even that list is
// capped at 25 files. File or directory arguments narrow the measurement, so
// `bun tools/loc/complexity-policy.ts src/a.ts` re-measures one file after an edit without
// scanning the tree, which is what makes changing one function at a time affordable.

import oxlintrc from "../../.oxlintrc.json" with { type: "json" };
import { mkdtempSync, rmSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { asRecord, isNumber, isString } from "../../src/meta/json-shape.ts";
import { tmpdir } from "../../src/meta/os.ts";
import { join } from "../../src/meta/path.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import { OXLINT_BINARY } from "../runtime/lint.ts";
import baselineJson from "./complexity-baseline.json" with { type: "json" };
import { writeJsonFile } from "../../src/meta/completed-json.ts";

export const CYCLOMATIC_CEILING = 21;
const BASELINE_PATH = "tools/loc/complexity-baseline.json";
const SIMPLIFY_PATH = ".claude/skills/simplify/SKILL.md";
const LINT_ROOTS = ["src", "tools", "vendor", "starters", "test", "packages"] as const;
const ANONYMOUS = "(anonymous)";
const REPORT_FILE_CAP = 25;

export interface FunctionComplexity {
  path: string;
  line: number;
  name: string;
  complexity: number;
}

/** `path → function name → highest complexity still allowed`. Anonymous functions in one file
 *  share the `(anonymous)` key and its count. */
type ComplexityBaseline = Readonly<Record<string, Readonly<Record<string, number>>>>;

interface ComplexityFinding {
  check: "above-ceiling" | "grown" | "stale-baseline";
  path: string;
  /** `name:line count`, or `name count` where nothing was measured. */
  detail: string;
}

const baseline: ComplexityBaseline = baselineJson;

/** One oxlint diagnostic as a measured function; `null` for a diagnostic of another rule. */
function parseDiagnostic(diagnostic: unknown): FunctionComplexity | null {
  const row = asRecord(diagnostic);
  if (row === null || row.code !== "eslint(complexity)") return null;
  const { message } = row,
    path = row.filename;
  if (!isString(message) || !isString(path)) return null;
  const count = /has a complexity of (\d+)\./.exec(message);
  if (count === null) return null;
  const named = /\x60([^\x60]+)\x60 has a complexity of/.exec(message);
  const label = Array.isArray(row.labels) ? asRecord(row.labels[0]) : null;
  const line = asRecord(label?.span)?.line;
  return {
    path,
    line: isNumber(line) ? line : 0,
    name: named?.[1] ?? ANONYMOUS,
    complexity: Number(count[1]),
  };
}

export function parseOxlintJson(text: string): FunctionComplexity[] {
  const diagnostics = asRecord(JSON.parse(text))?.diagnostics;
  if (!Array.isArray(diagnostics)) throw new Error("oxlint json carries no diagnostics array");
  return diagnostics.map(parseDiagnostic).filter((row) => row !== null);
}

/** Run oxlint with the repository ignore list, every category off and only the complexity rule
 *  at the ceiling. A `-c` config replaces `.oxlintrc.json`, so its ignore patterns are derived
 *  from it rather than copied. */
function measureComplexity(
  ceiling: number = CYCLOMATIC_CEILING,
  roots: readonly string[] = LINT_ROOTS,
): FunctionComplexity[] {
  const dir = mkdtempSync(join(tmpdir(), "ana-complexity-"));
  const config = join(dir, "complexity.oxlintrc.json");
  writeFileSync(
    config,
    JSON.stringify({
      ignorePatterns: oxlintrc.ignorePatterns,
      categories: { correctness: "off" },
      rules: { complexity: ["error", { max: ceiling }] },
    }),
  );
  try {
    const run = Bun.spawnSync({
      cmd: ["bun", OXLINT_BINARY, "-c", config, "--format", "json", ...roots],
      maxBuffer: 1 << 28,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = run.stdout.toString();
    if (!out.trimStart().startsWith("{")) {
      throw new Error(`oxlint produced no json (exit ${run.exitCode}): ${run.stderr.toString().trim()}`);
    }
    return parseOxlintJson(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Highest measured count per `path → name`, the shape the baseline freezes. */
function worstByFunction(measured: readonly FunctionComplexity[]): Map<string, Map<string, number>> {
  const worst = new Map<string, Map<string, number>>();
  for (const row of measured) {
    const file = worst.get(row.path) ?? new Map<string, number>();
    file.set(row.name, Math.max(file.get(row.name) ?? 0, row.complexity));
    worst.set(row.path, file);
  }
  return worst;
}

/** Whether a path lies under one of the scanned roots. A baseline entry outside the scan is
 *  neither stale nor shrinkable: nothing measured it. */
function inScope(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(`${root.replace(/\/$/, "")}/`));
}

export function complexityFindings(
  measured: readonly FunctionComplexity[],
  frozen: ComplexityBaseline = baseline,
  ceiling: number = CYCLOMATIC_CEILING,
  roots: readonly string[] = LINT_ROOTS,
): ComplexityFinding[] {
  const findings: ComplexityFinding[] = [];
  for (const row of measured) {
    const allowed = frozen[row.path]?.[row.name];
    if (allowed === undefined) {
      findings.push({
        check: "above-ceiling",
        path: row.path,
        detail: `${row.name}:${row.line} ${row.complexity}`,
      });
    } else if (row.complexity > allowed) {
      findings.push({
        check: "grown",
        path: row.path,
        detail: `${row.name}:${row.line} ${row.complexity} was ${allowed}`,
      });
    }
  }
  const worst = worstByFunction(measured);
  for (const [path, functions] of Object.entries(frozen)) {
    if (!inScope(path, roots)) continue;
    for (const [name, allowed] of Object.entries(functions)) {
      const now = worst.get(path)?.get(name);
      if (now !== undefined && now >= allowed) continue;
      findings.push({
        check: "stale-baseline",
        path,
        detail: `${name} ${now ?? `<=${ceiling}`} was ${allowed}, stale: rerun with --write-baseline`,
      });
    }
  }
  return findings;
}

/** The baseline after a shrink: recorded counts fall to what is measured, functions that no
 *  longer exceed the ceiling leave, and nothing is added. Entries outside the scanned roots stay
 *  as they are, so a narrowed rewrite cannot drop the rest of the tree. */
export function shrunkBaseline(
  measured: readonly FunctionComplexity[],
  frozen: ComplexityBaseline = baseline,
  roots: readonly string[] = LINT_ROOTS,
) {
  const worst = worstByFunction(measured);
  const next: Record<string, Record<string, number>> = {};
  for (const path of Object.keys(frozen).sort()) {
    const kept: Record<string, number> = {};
    const scanned = inScope(path, roots);
    for (const name of Object.keys(frozen[path] ?? {}).sort()) {
      const allowed = frozen[path]?.[name];
      if (allowed === undefined) continue;
      const now = worst.get(path)?.get(name);
      if (!scanned) kept[name] = allowed;
      else if (now !== undefined) kept[name] = Math.min(now, allowed);
    }
    if (Object.keys(kept).length > 0) next[path] = kept;
  }
  return next;
}

function frozenCount(frozen: ComplexityBaseline): number {
  return Object.values(frozen).reduce((n, functions) => n + Object.keys(functions).length, 0);
}

/** One line per file: `path — name:line count, name:line count`. */
export function reportLines(findings: readonly ComplexityFinding[]): string[] {
  const byFile = new Map<string, string[]>();
  for (const finding of findings) {
    byFile.set(finding.path, [...(byFile.get(finding.path) ?? []), finding.detail]);
  }
  const lines = [...byFile].map(([path, details]) => `  ${path} — ${details.join(", ")}`);
  if (lines.length <= REPORT_FILE_CAP) return lines;
  return [...lines.slice(0, REPORT_FILE_CAP), `  … ${lines.length - REPORT_FILE_CAP} more file(s)`];
}

function report(findings: readonly ComplexityFinding[], frozen: ComplexityBaseline): number {
  if (findings.length === 0) {
    console.log(
      `complexity: every function below 22, or frozen in ${BASELINE_PATH} (${frozenCount(frozen)} frozen)`,
    );
    return 0;
  }
  console.error(
    `complexity: FAILED — ${findings.length} finding(s); ceiling ${CYCLOMATIC_CEILING}, exceptions in ${BASELINE_PATH}`,
  );
  for (const line of reportLines(findings)) console.error(line);
  console.error(
    `Read ${SIMPLIFY_PATH} in full, then simplify each named function until it measures ${CYCLOMATIC_CEILING} or below. ` +
      "Re-measure one file with `bun tools/loc/complexity-policy.ts <path>` and change one function at a time, so each count attributes to one edit.",
  );
  return 1;
}

function main(args: readonly string[]): number {
  const paths = args.filter((arg) => !arg.startsWith("--"));
  const roots = paths.length > 0 ? paths : LINT_ROOTS;
  const measured = measureComplexity(CYCLOMATIC_CEILING, roots);
  if (args.includes("--write-baseline")) {
    const next = shrunkBaseline(measured, baseline, roots);
    writeJsonFile(BASELINE_PATH, next);
    console.log(`complexity: ${BASELINE_PATH} shrunk to ${frozenCount(next)} frozen function(s)`);
    return report(complexityFindings(measured, next, CYCLOMATIC_CEILING, roots), next);
  }
  return report(complexityFindings(measured, baseline, CYCLOMATIC_CEILING, roots), baseline);
}

if (Bun.argv[1]?.endsWith("complexity-policy.ts") === true) runtimeProcess.exit(main(Bun.argv.slice(2)));
