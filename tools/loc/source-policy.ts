// The source gate carries only the checks that change whether a push is accepted, which is five
// things. It measures every authored file and its longest function against the two ceilings below,
// refuses a literal or a call that would restore a system this repository decided to remove,
// reports an `export` that no other file names, and retires a copied-file ceiling once the file has
// come inside the authored limits and the entry exempts nothing. Git owns provenance and history,
// so nothing here records who wrote a file or what state it is in.

import { readFileSync, readdirSync, statSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import { countNonBlank } from "./nonblank-loc.ts";
import sourcePolicy from "./source-policy.json" with { type: "json" };
import { scanTokens } from "./token-facts.ts";

// 600 and 80 were chosen when an author picked every line break and a 200-character line counted
// as one. `biome format` owns the breaks now, at lineWidth 110, and the same code measures larger:
// 77,570 nonblank lines to 84,984 over src, tools and vendor. The factor is not one number. A flat
// function barely moves and a deeply indented one nearly doubles — `runReferenceChild` went from 39
// lines to 92 without a character of it changing — so no single multiplier restates the old
// ceilings, and the 90th percentile is the honest place to put them: 1.330 per file and 1.425 per
// function over everything the formatter touched. 600 x 1.330 and 80 x 1.425, rounded up.
//
// The tree was measured at 100, 110, 120, 130, 140 and 160 columns before these numbers were
// picked, because a wider setting wraps less: 110 costs 9.6% and 160 costs nothing at all. 96.5%
// of authored lines were already inside 110 columns, so 110 is the width this source was written
// to and the ceilings move instead of it.
export const NEW_FILE_CEILING = 800;
export const NEW_FUNCTION_CEILING = 115;

const SOURCE_ROOTS = ["src", "tools", "vendor"] as const;

/** Authored source this repository owns and may restructure, and so the roots whose exports are a
 *  finding when nothing outside their own file names them. `vendor` is pinned verbatim, and
 *  `starters` is copied into a Builder workspace where the consumers of its names do not exist in
 *  this tree, so neither can be read this way. The simplify census scans these plus `.claude`. */
export const AUTHORED_ROOTS = ["src", "tools", "packages/ui/src"] as const;

/** Where a name may be read from. Wider than the compiler's import graph on purpose: skill scripts
 *  under `.claude` import repository source, and a configuration file can name an export. */
export const READER_ROOTS = [
  "src",
  "tools",
  "vendor",
  "starters",
  "test",
  "packages",
  "scripts",
  ".claude",
] as const;

/** A declaration that carries `export` and a name of its own. `export { … }` lists and
 *  `export default` are not read: the first states a name a second time, the second has none. */
const EXPORTED =
  /^export (?:declare )?(?:async )?(?:interface|type|function|const|let|class|enum|abstract class) ([A-Za-z_$][\w$]*)/gm;

const IDENTIFIER = /[A-Za-z_$][\w$]*/g;

export const READ_AS_SOURCE = [".ts", ".tsx", ".mts", ".mjs", ".js", ".py", ".json"];
/** Files held at a frozen limit of their own instead of the ceiling for authored code.
 *  `tree-findings.ts` asks the same question before it proposes moving code into one. */
export const copiedFileLimits: Readonly<Record<string, number>> = sourcePolicy.copiedFileLimits;
const refusedLiterals: ReadonlySet<string> = new Set(sourcePolicy.refusedLiterals);
const refusedCalls: ReadonlySet<string> = new Set(sourcePolicy.refusedCalls);

interface SourcePolicyFinding {
  check: "file-size" | "function-size" | "literal-cut" | "call-cut" | "stale-copy-limit" | "unused-export";
  path: string;
  detail: string;
}

/** Prose under a source root, which the authored-code ceiling does not describe.
 *
 *  `walkFiles` reads every file under `src`, `tools` and `vendor`, so the 800-line ceiling applied
 *  to Markdown too. That catches the oxlint decision ledgers and nothing else: no other non-`.ts`
 *  file under those roots reaches 400 lines, and the ledgers run to several times the ceiling.
 *
 *  So the finding asked for one thing: split the record of which lint rules were shipped or
 *  refused, at 800 lines, for a reason belonging to neither half. The number is derived from what
 *  `biome format` at lineWidth 110 does to authored code — the 90th percentile of its effect on
 *  file length — and says nothing about how long a decision ledger should be. A second file would
 *  give a reader two places to search and retire nothing, which is a gate changing a decision
 *  incorrectly (AGENTS.md rule 8).
 *
 *  What bounds those ledgers is retiring an entry whose rule is decided and whose mechanism has
 *  left the source, and that is a judgement a line count cannot make. A ledger growing because the
 *  work it records is current is not the same as one accumulating dead entries, and only a reader
 *  can tell the two apart. An explicit `copiedFileLimits` entry still binds a Markdown file,
 *  because naming one is a decision rather than an accident of the walk. A line count becomes the
 *  right instrument again when a fourth Markdown ledger appears under these roots, or when one
 *  keeps growing with the same entries still standing in it. */
const PROSE = /\.md$/;

function walkFiles(root: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const name of entries.sort()) {
    // Installed dependencies and build output are nobody's authored source. The three original
    // roots hold neither; `packages` and `.claude`, which the export search reads, hold both.
    // Nor is a dot-directory: every one of the three dozen scratch roots a test opens inside the
    // checkout carries a leading dot, and no tracked file in any root sits under one. Reading them
    // costs a gate twice over: the census counts generated fixture bytes as authored shapes for as
    // long as the suite runs, and the read below loses its race with the `rmSync` that removes
    // one. `.git` was the first instance of this rule. A named root is never filtered, only what
    // the walk descends into, so `.claude` still opens.
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const path = join(root, name);
    if (statSync(path).isDirectory()) files.push(...walkFiles(path));
    else files.push(path);
  }
  return files;
}

/**
 * `export` on a declaration that nothing outside its own file names.
 *
 * An export is a statement that another file may depend on the name, so changing the declaration
 * means looking for those dependents first — and for these there are none to find. It is the
 * single largest shape a simplification pass removes.
 *
 * The search is textual, which decides two things. A name declared in two files is left alone,
 * because a mention cannot be attributed to one of them. And a name that appears anywhere in
 * another file counts as read, including in a comment or a string: the check fails open, and what
 * it reports is a name no file spells at all.
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
    .sort((left, right) =>
      left.path === right.path ? left.name.localeCompare(right.name) : left.path.localeCompare(right.path),
    )
    .map((row) => ({
      check: row.check,
      path: row.path,
      detail: `\`${row.name}\` is exported and no other file names it; drop the \`export\``,
    }));
}

/** Every file under `roots` this check can read, by path. `tools/oxlint/tree-findings.ts` reads
 *  the same corpus for its whole-tree census, so the two scans see one set of files. */
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
  if (lines > fileLimit && !(copiedLimit === undefined && PROSE.test(path))) {
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
 * The copied-file ceilings that no longer change a decision, read through `read` so the caller
 * chooses the tree. A ceiling is stale when its file is gone, and equally when the file has come
 * inside both authored limits: the entry is then a standing exemption from rules the file already
 * satisfies, because a copied limit also turns the function check off for that file entirely. An
 * obsolete exception is debt, so the gate refuses it rather than carrying it (AGENTS.md rule 8).
 *
 * Most entries in the map bind nothing. They were written when the ceilings were introduced, and
 * without this check they keep their files exempt from the function check for as long as nobody
 * reads them back.
 */
export function staleCopyLimits(read: (path: string) => string | null): SourcePolicyFinding[] {
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
  const paths = SOURCE_ROOTS.flatMap((root) => walkFiles(root));
  const onDisk = new Set(paths);
  return [
    ...paths.flatMap((path) => sourceTextFindings(path, readFileSync(path, "utf8"))),
    ...staleCopyLimits((path) => (onDisk.has(path) ? readFileSync(path, "utf8") : null)),
    ...unusedExports(corpus(AUTHORED_ROOTS, [".ts", ".tsx", ".mts"]), corpus(READER_ROOTS, READ_AS_SOURCE)),
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
