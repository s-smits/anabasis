// Enforces the five push-gating source policies: file-size and function-size ceilings, banned
// literals and calls that would reintroduce retired systems, unused exports in authored roots, and
// retirement of stale copied-file ceiling exemptions once a file fits within the standard limits.
// Provenance and history belong to Git rather than policy metadata.

import { existsSync, readFileSync, readdirSync, statSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import { countNonBlank } from "./nonblank-loc.ts";
import sourcePolicy from "./source-policy.json" with { type: "json" };
import { scanTokens } from "./token-facts.ts";

// File and function ceilings scaled for `biome format` at `lineWidth: 110`. The earlier 600-line
// file and 80-line function ceilings assumed manual line breaks; automatic wrapping at 110 columns
// expands deeply indented functions disproportionately (90th-percentile multipliers of 1.330 per
// file and 1.425 per function across formatted files), giving 800 and 115 when rounded up.
// Measurements across 100 to 160 columns showed 96.5% of authored lines already fit within 110
// columns, so the ceilings were adjusted rather than widening the formatter.
export const NEW_FILE_CEILING = 800;
export const NEW_FUNCTION_CEILING = 115;

const SOURCE_ROOTS = ["src", "tools", "vendor", ".claude/skills"] as const;

/** Authored roots owned by this repository whose unused exports are reported as findings. `vendor`
 *  is pinned verbatim and `starters` is copied into Builder workspaces with external consumers, so
 *  neither is checked for unused exports. The simplification census scans these roots plus
 *  `.claude`. */
export const AUTHORED_ROOTS = ["src", "tools", "packages/ui/src"] as const;

/** Roots searched for references to exported names. Intentionally broader than the TypeScript
 *  import graph because skill scripts under `.claude` and configuration files may reference
 *  repository exports. */
export const READER_ROOTS = [
  "src",
  "tools",
  "vendor",
  "starters",
  "test",
  "packages",
  "scripts",
  ".claude",
  "studies",
] as const;

/** Matches named `export` declarations. Excludes `export { ... }` re-export lists (which repeat
 *  existing names) and `export default` (which introduces no bound name). */
const EXPORTED =
  /^export (?:declare )?(?:async )?(?:interface|type|function|const|let|class|enum|abstract class) ([A-Za-z_$][\w$]*)/gm;

const IDENTIFIER = /[A-Za-z_$][\w$]*/g;

export const READ_AS_SOURCE = [".ts", ".tsx", ".mts", ".mjs", ".js", ".py", ".json"];
/** Per-file line ceilings for legacy or copied files exempt from the standard authored limits.
 *  Also consulted by `tree-findings.ts` before suggesting code moves into a file. */
export const copiedFileLimits: Readonly<Record<string, number>> = sourcePolicy.copiedFileLimits;
const refusedLiterals: ReadonlySet<string> = new Set(sourcePolicy.refusedLiterals);
const refusedCalls: ReadonlySet<string> = new Set(sourcePolicy.refusedCalls);

interface SourcePolicyFinding {
  check: "file-size" | "function-size" | "literal-cut" | "call-cut" | "stale-copy-limit" | "unused-export";
  path: string;
  detail: string;
}

function walkFiles(root: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const name of entries.toSorted()) {
    // Skip installed dependencies, build output, and nested dot-directories (including `.git` and
    // temporary test scratch directories, which would otherwise distort counts and race with test
    // cleanup). Top-level roots such as `.claude` are passed directly and remain included.
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const path = join(root, name);
    // Skip nested Git checkouts (for example agent worktrees under `.claude/worktrees/`) so
    // duplicated repository files are not scanned twice.
    if (!statSync(path).isDirectory()) files.push(path);
    else if (!existsSync(join(path, ".git"))) files.push(...walkFiles(path));
  }
  return files;
}

/**
 * Reports exported declarations that no other file references.
 */
export function unusedExports(
  declaring: ReadonlyMap<string, string>,
  readers: ReadonlyMap<string, string>,
): SourcePolicyFinding[] {
  const home = new Map<string, string | null>();
  for (const [path, text] of declaring) {
    for (const match of text.matchAll(EXPORTED)) {
      const name = match[1] ?? "";
      home.set(name, home.has(name) ? null : path);
    }
  }
  for (const [path, text] of readers) {
    for (const match of text.matchAll(IDENTIFIER)) {
      if (home.get(match[0]) !== undefined && home.get(match[0]) !== path) home.set(match[0], null);
    }
  }
  return [...home]
    .flatMap(([name, path]) => (path === null ? [] : [{ check: "unused-export" as const, path, name }]))
    .toSorted((left, right) =>
      left.path === right.path ? left.name.localeCompare(right.name) : left.path.localeCompare(right.path),
    )
    .map((row) => ({
      check: row.check,
      path: row.path,
      detail: `\`${row.name}\` is exported and no other file names it; drop the \`export\``,
    }));
}

/** Reads all files matching `suffixes` under `roots` into a path-to-content map. Shared with
 *  `tools/oxlint/tree-findings.ts` so both scans inspect the same file corpus. */
export function corpus(roots: readonly string[], suffixes: readonly string[]): Map<string, string> {
  const files = new Map<string, string>();
  for (const root of roots) {
    for (const path of walkFiles(root)) {
      if (suffixes.some((suffix) => path.endsWith(suffix))) files.set(path, readFileSync(path, "utf8"));
    }
  }
  return files;
}

function sizeFindings(path: string, text: string, copiedLimit?: number): SourcePolicyFinding[] {
  const findings: SourcePolicyFinding[] = [];
  const fileLimit = copiedLimit ?? NEW_FILE_CEILING;
  const lines = countNonBlank(text);
  // Markdown documentation under source roots (such as oxlint decision ledgers) is exempt from the
  // default code-file ceiling unless explicitly listed in `copiedFileLimits`.
  if (lines > fileLimit && !(copiedLimit === undefined && path.endsWith(".md"))) {
    findings.push({
      check: "file-size",
      path,
      detail: `${lines} nonblank lines exceeds ${fileLimit}`,
    });
  }
  if (copiedLimit === undefined && /\.tsx?$/.test(path)) {
    const worst = scanTokens(text).worstFunction;
    if (worst.lines > NEW_FUNCTION_CEILING) {
      findings.push({
        check: "function-size",
        path,
        detail: `${worst.name} is ${worst.lines} lines; ceiling ${NEW_FUNCTION_CEILING}`,
      });
    }
  }
  return findings;
}

function cutFindings(path: string, text: string): SourcePolicyFinding[] {
  if (!/\.tsx?$/.test(path)) return [];
  const findings: SourcePolicyFinding[] = [];
  const facts = scanTokens(text);
  for (const literal of refusedLiterals) {
    if (facts.literals.has(literal)) {
      findings.push({ check: "literal-cut", path, detail: `reintroduces ${JSON.stringify(literal)}` });
    }
  }
  for (const call of refusedCalls) {
    if (facts.calls.has(call)) {
      findings.push({ check: "call-cut", path, detail: `reintroduces ${call}()` });
    }
  }
  return findings;
}

export function sourceTextFindings(
  path: string,
  text: string,
  copiedLimit: number | undefined = copiedFileLimits[path],
): SourcePolicyFinding[] {
  return [...sizeFindings(path, text, copiedLimit), ...cutFindings(path, text)];
}

/**
 * Reports entries in `copiedFileLimits` that no longer have any effect, either because the named
 * file was deleted or because it now satisfies both standard authored ceilings. Because a copied
 * ceiling also disables the function-size check for that file, stale exemptions are refused rather
 * than retained.
 */
function staleCopyLimits(read: (path: string) => string | null): SourcePolicyFinding[] {
  const findings: SourcePolicyFinding[] = [];
  for (const path of Object.keys(copiedFileLimits)) {
    const text = read(path);
    if (text === null) {
      findings.push({
        check: "stale-copy-limit",
        path,
        detail: "copied-file ceiling names a file that no longer exists",
      });
    } else if (sizeFindings(path, text).length === 0) {
      findings.push({
        check: "stale-copy-limit",
        path,
        detail: `${countNonBlank(text)} nonblank lines and no function over ${NEW_FUNCTION_CEILING}: the ceiling exempts nothing`,
      });
    }
  }
  return findings;
}

/** Finds unused exports across the tree rooted at `base` (defaulting to the current working
 *  directory), returning paths relative to `base`. Shared by the source gate and commit preflight. */
export function unreadExports(base = ""): SourcePolicyFinding[] {
  const read = (roots: readonly string[], suffixes: readonly string[]) => {
    const files = corpus(
      roots.map((top) => join(base, top)),
      suffixes,
    );
    return base === ""
      ? files
      : new Map([...files].map(([path, text]) => [path.slice(base.length + 1), text]));
  };
  return unusedExports(read(AUTHORED_ROOTS, [".ts", ".tsx", ".mts"]), read(READER_ROOTS, READ_AS_SOURCE));
}

function sourcePolicyFindings(): SourcePolicyFinding[] {
  const paths = SOURCE_ROOTS.flatMap((root) => walkFiles(root));
  const onDisk = new Set(paths);
  return [
    ...paths.flatMap((path) => sourceTextFindings(path, readFileSync(path, "utf8"))),
    ...staleCopyLimits((path) => (onDisk.has(path) ? readFileSync(path, "utf8") : null)),
    ...unreadExports(),
  ];
}

function main(): number {
  const findings = sourcePolicyFindings();
  if (findings.length === 0) {
    console.log("source-policy: all checks passed");
    return 0;
  }
  for (const finding of findings) {
    console.error(`${finding.check}: ${finding.path}: ${finding.detail}`);
  }
  console.error(`source-policy: FAILED — ${findings.length} finding(s)`);
  return 1;
}

if (Bun.argv[1]?.endsWith("source-policy.ts") === true) runtimeProcess.exit(main());
