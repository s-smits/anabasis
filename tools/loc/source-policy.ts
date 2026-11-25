// Enforces the push-gating source policies: file- and function-size ceilings, banned literals and calls
// that would reintroduce retired systems, dependency and security layer boundaries, and retirement of
// stale copied-file ceiling exemptions.

import { existsSync, readFileSync, readdirSync, statSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import { importsOf } from "../runtime/gate.ts";
import { countNonBlank } from "./nonblank-loc.ts";
import sourcePolicy from "./source-policy.json" with { type: "json" };
import { scanTokens } from "./token-facts.ts";

// Ceilings scaled for `biome format` at `lineWidth: 110`: wrapping expands deeply indented functions
// disproportionately (90th-percentile multipliers of 1.330 per file and 1.425 per function), which
// takes the 600-line file and 80-line function ceilings to 800 and 115.
export const NEW_FILE_CEILING = 800;
export const NEW_FUNCTION_CEILING = 115;
export const AGENTS_MD_BYTE_CEILING = 24_000;
const AGENTS_MD = "AGENTS.md";

const SOURCE_ROOTS = ["src", "tools", "vendor", ".claude/skills"] as const;
/** Production roots whose source files must not import helper or test trees (`AGENTS.md` §12). */
export const PRODUCTION_ROOTS = ["src", "vendor", "packages", "tools"] as const;
const HELPER_ROOTS = [".claude/", "tools/wri/", "studies/", "test/"] as const;
const CHECK_CHILD = "src/kernel/check-child.ts";
const META_LAYER = "src/meta/";
const ISOLATED_LAYERS = ["src/kernel/", "src/wall/"] as const;
const FORBIDDEN_FROM_ISOLATED = [
  "src/builder/",
  "src/examiner/",
  "src/referee/",
  "src/solver/",
  "src/campaign/",
] as const;
const SOURCE_EXT = /\.[cm]?[jt]sx?$/u;

/** Authored roots owned by this repository; `vendor` is pinned verbatim. The simplification census
 *  scans these roots plus `.claude`. */
export const AUTHORED_ROOTS = ["src", "tools", "packages/ui/src"] as const;

const copiedFileLimits: Readonly<Record<string, number>> = sourcePolicy.copiedFileLimits;
const refusedLiterals: ReadonlySet<string> = new Set(sourcePolicy.refusedLiterals);
const refusedCalls: ReadonlySet<string> = new Set(sourcePolicy.refusedCalls);

interface SourcePolicyFinding {
  check:
    | "file-size"
    | "function-size"
    | "literal-cut"
    | "call-cut"
    | "stale-copy-limit"
    | "dependency-direction";
  path: string;
  detail: string;
}

const helperOf = (path: string): string | null =>
  HELPER_ROOTS.find((root) => path.startsWith(root)) ??
  (/^packages\/[^/]+\/test\//u.test(path) ? "test/" : null);

const boundaryOf = (file: string, imported: string): string | null => {
  const helper = helperOf(imported);
  if (helper !== null) return helper;
  if (file === CHECK_CHILD && !imported.startsWith(META_LAYER)) return "offline-cell";
  if (file.startsWith(META_LAYER) && !imported.startsWith(META_LAYER)) return META_LAYER;
  if (ISOLATED_LAYERS.some((layer) => file.startsWith(layer))) {
    return FORBIDDEN_FROM_ISOLATED.find((layer) => imported.startsWith(layer)) ?? null;
  }
  return null;
};

export const production = (path: string): boolean =>
  SOURCE_EXT.test(path) &&
  PRODUCTION_ROOTS.some((root) => path.startsWith(`${root}/`)) &&
  helperOf(path) === null;

export function breaches(files: readonly string[], graph: (file: string) => readonly string[]) {
  return files.filter(production).flatMap((file) =>
    graph(file).flatMap((imported) => {
      const root = boundaryOf(file, imported);
      return root === null ? [] : [{ file, imported, root }];
    }),
  );
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
    // Nested dot-directories include `.git` and test scratch directories, which would distort counts
    // and race with test cleanup; top-level roots such as `.claude/skills` are passed directly.
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const path = join(root, name);
    // Nested Git checkouts (agent worktrees under `.claude/worktrees/`) would scan the repository
    // twice.
    if (!statSync(path).isDirectory()) files.push(path);
    else if (!existsSync(join(path, ".git"))) files.push(...walkFiles(path));
  }
  return files;
}

/** Shared with `tools/oxlint/tree-findings.ts` so both scans inspect the same file corpus. */
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
  if (path === AGENTS_MD) {
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > AGENTS_MD_BYTE_CEILING) {
      findings.push({
        check: "file-size",
        path,
        detail: `${bytes} bytes exceeds ${AGENTS_MD_BYTE_CEILING} (per-file rule cap)`,
      });
    }
  }
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

export function sourceTextFindings(path: string, text: string): SourcePolicyFinding[] {
  return [...sizeFindings(path, text, copiedFileLimits[path]), ...cutFindings(path, text)];
}

/**
 * Entries in `copiedFileLimits` that no longer have any effect: the file was deleted or now meets
 * both standard ceilings. A copied ceiling also disables the function-size check, so a stale one is
 * refused.
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

function sourcePolicyFindings(): SourcePolicyFinding[] {
  const cwd = runtimeProcess.cwd();
  const paths = SOURCE_ROOTS.flatMap((root) => walkFiles(root));
  const onDisk = new Set(paths);
  return [
    ...paths.flatMap((path) => sourceTextFindings(path, readFileSync(path, "utf8"))),
    ...(existsSync(AGENTS_MD) ? sourceTextFindings(AGENTS_MD, readFileSync(AGENTS_MD, "utf8")) : []),
    ...staleCopyLimits((path) => (onDisk.has(path) ? readFileSync(path, "utf8") : null)),
    ...breaches(
      PRODUCTION_ROOTS.flatMap((root) => walkFiles(root)),
      (file) => importsOf(cwd, file),
    ).map(({ file, imported, root }) => ({
      check: "dependency-direction" as const,
      path: file,
      detail: `imports ${imported} (${root})`,
    })),
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
