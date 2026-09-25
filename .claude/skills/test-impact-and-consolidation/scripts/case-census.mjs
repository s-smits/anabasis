// A fast, coverage-free look at what every test suite imports, names, and repeats.
//
// Case extraction uses a character scanner to find test declarations, block bodies and describe
// nesting. It counts declarations, not expanded runtime cases; it.each is flagged. The scanner
// is not a TypeScript parser, so inspect reported spans before drawing a deletion conclusion.
//
// Four overlap signals:
//   import subsets     suite A only reads modules suite B already reads — absorb candidate
//   duplicate cases    same describe::title appearing more than once anywhere
//   helper names       a helper name appears in three or more suites; bodies may differ
//   case-count ledger  totals per suite plus the duplicate breakdown
//
// Duplicate classification — read before acting:
//   IDENTICAL-SOURCE  the extracted block-body hashes match. This is initial
//                     evidence of a copy, NOT permission to delete: identical text can
//                     still close over different module-level helpers. A human confirms
//                     every removal against the survivor's coverage.
//   TITLE-TWIN        same name, different body — two angles share a name; read and keep.
//
// After any consolidation, re-run: the invariant is "instance count may drop only by
// confirmed copies; every distinct angle survives".
//
// Usage:
//   bun case-census.mjs [--repo /abs/repo] [--json] [--top N]

import { existsSync, readdir } from "#src/meta/filesystem.ts";
import path from "#src/meta/path.ts";

import { exitWith, parseOrDie } from "#skills/main/cli.ts";
import { runtimeProcess } from "#src/meta/process.ts";

// check-fixtures.mjs imports this module, and its own arguments are not this script's.
const ARGS = parseOrDie(
  exitWith("case-census"),
  { values: ["repo", "top"], flags: ["json"] },
  import.meta.main ? Bun.argv.slice(2) : [],
);
const asJson = ARGS.flags.has("json");
const repo = ARGS.single.get("repo") ?? runtimeProcess.cwd();

const DIRS = ["test", "starters/pi-built-harness/correctness-model"];
const EXTS = [".test.ts", ".test.tsx", ".test.js", ".test.jsx", ".spec.ts", ".spec.js"];

// Scan strings, templates and comments before matching parentheses. collectCases derives
// describe nesting from those spans. Regex literals and unfamiliar syntax still need review.
const CASE_NAMES = new Set(["it", "test"]);
const DESCRIBE_NAMES = new Set(["describe"]);

function extractImports(text) {
  const specifiers = new Set();
  for (const m of text.matchAll(/from\s+["']([^"']+)["']/g)) {
    const spec = m[1];
    if (!spec.startsWith(".") && !spec.startsWith("@")) continue;
    specifiers.add(spec.replaceAll("\\", "/"));
  }
  return specifiers;
}

function resolveSpecifier(specifier, fromDir) {
  const base = path.posix.normalize(path.posix.join(fromDir, specifier));
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}/index.ts`];
  for (const candidate of candidates) {
    const abs = path.join(repo, candidate);
    if (!existsSync(abs)) continue;
    const rel = path.relative(repo, abs);
    if (rel.startsWith("..")) continue;
    for (const root of ["src/", "tools/", "vendor/", "starters/", "packages/"]) {
      if (rel.startsWith(root)) return rel;
    }
  }
  return null;
}

function extractHelpers(text) {
  const helpers = new Map();
  for (const m of text.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm)) {
    helpers.set(m[1], (helpers.get(m[1]) ?? 0) + 1);
  }
  for (const m of text.matchAll(/^const\s+(\w+)\s*=\s*(?:\(|async|\w+\s*=>)/gm)) {
    helpers.set(m[1], (helpers.get(m[1]) ?? 0) + 1);
  }
  return helpers;
}

function skipRegion(text, i) {
  const c = text[i];
  const n = text[i + 1];
  if (c === "/" && n === "/") {
    const nl = text.indexOf("\n", i);
    return nl === -1 ? text.length : nl;
  }
  if (c === "/" && n === "*") {
    const close = text.indexOf("*/", i + 2);
    return close === -1 ? text.length : close + 2;
  }
  if (c === '"' || c === "'" || c === "`") return skipQuoted(text, i);
  return -1;
}

/** From the opening quote at `i`, the index just past the closing one, or the end of the text. */
function skipQuoted(text, i) {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length) {
    if (text[j] === "\\") {
      j += 2;
      continue;
    }
    if (quote === "`" && text[j] === "$" && text[j + 1] === "{") {
      j = skipSubstitution(text, j);
      continue;
    }
    if (text[j] === quote) return j + 1;
    j++;
  }
  return j;
}

/** From the `${` at `i`, the index just past its matching `}`; strings and comments inside the
 *  substitution are skipped by the same scanner. */
function skipSubstitution(text, i) {
  let depth = 1;
  let j = i + 2;
  while (j < text.length && depth > 0) {
    const skip = skipRegion(text, j);
    if (skip > j) {
      j = skip;
      continue;
    }
    if (text[j] === "{") depth++;
    else if (text[j] === "}") depth--;
    j++;
  }
  return j;
}

function matchParen(text, open) {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const skip = skipRegion(text, i);
    if (skip > i) {
      i = skip;
      continue;
    }
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function readIdent(text, i) {
  let j = i;
  while (j < text.length && /[$\w]/.test(text[j])) j++;
  return text.slice(i, j);
}

function scanCalls(text) {
  const calls = [];
  let i = 0;
  while (i < text.length) {
    const skip = skipRegion(text, i);
    if (skip > i) {
      i = skip;
      continue;
    }
    if (!/[$A-Za-z_]/.test(text[i])) {
      i++;
      continue;
    }
    const ident = readIdent(text, i);
    const after = text[i + ident.length];
    const named = (CASE_NAMES.has(ident) || DESCRIBE_NAMES.has(ident)) && !/[$\w]/.test(after ?? "");
    const call = named ? callAt(text, i, ident) : null;
    if (call === null) {
      i += ident.length;
      continue;
    }
    calls.push(call);
    // Descend into the arguments: nested describes and cases live there.
    i = call.argsOpen + 1;
  }
  return calls;
}

/** The case or describe call whose identifier `ident` starts at `i`, or null when its argument
 *  list does not close. `it.each(table)(title, fn)` keeps both argument groups. */
function callAt(text, i, ident) {
  let j = i + ident.length;
  let parametrized = false;
  while (text[j] === ".") {
    const prop = readIdent(text, j + 1);
    if (prop === "each") parametrized = true;
    j += 1 + prop.length;
  }
  if (text[j] !== "(") return null;
  const end = matchParen(text, j);
  if (end === -1) return null;
  // it.each(table)(title, fn): the case lives in the SECOND argument group.
  const invoke = parametrized ? invokeGroup(text, end + 1) : null;
  return {
    name: ident,
    parametrized,
    start: i,
    argsOpen: j,
    argsEnd: end,
    invokeOpen: invoke?.open ?? -1,
    invokeEnd: invoke?.end ?? -1,
  };
}

/** The `(…)` group following `it.each(table)`, or null when the next token is not one. */
function invokeGroup(text, from) {
  let k = from;
  while (k < text.length && /\s/.test(text[k])) k++;
  if (text[k] !== "(") return null;
  const end = matchParen(text, k);
  return end === -1 ? null : { open: k, end };
}

function firstString(text, from, to) {
  let i = from;
  while (i < to) {
    const quote = text[i];
    if (quote !== '"' && quote !== "'" && quote !== "`") {
      i++;
      continue;
    }
    // The opening quote itself is the string we want; do not let skipRegion eat it.
    let j = i + 1;
    while (j < to && text[j] !== quote) j += text[j] === "\\" ? 2 : 1;
    return text.slice(i + 1, j);
  }
  return null;
}

function bodyBlock(text, from, to) {
  let i = from;
  while (i < to) {
    const skip = skipRegion(text, i);
    if (skip > i) {
      i = skip;
      continue;
    }
    if (text[i] === "{") return braceSpan(text, i, to);
    i++;
  }
  return null;
}

/** From the `{` at `open`, the span through its matching `}`, or null when it does not close. */
function braceSpan(text, open, to) {
  let depth = 0;
  let j = open;
  while (j <= to) {
    const skip = skipRegion(text, j);
    if (skip > j) {
      j = skip;
      continue;
    }
    if (text[j] === "{") depth++;
    else if (text[j] === "}" && --depth === 0) return { start: open, end: j + 1 };
    j++;
  }
  return null;
}

function collectCases(text) {
  const calls = scanCalls(text);
  const cases = [];
  const stack = [];
  for (const call of calls) {
    while (stack.length > 0 && stack.at(-1).end < call.start) stack.pop();
    const hasInvoke = call.invokeOpen >= 0 && call.invokeEnd >= 0;
    const titleFrom = hasInvoke ? call.invokeOpen : call.argsOpen;
    const titleTo = hasInvoke ? call.invokeEnd : call.argsEnd;
    const title = firstString(text, titleFrom + 1, titleTo);
    if (title === null) continue;
    if (DESCRIBE_NAMES.has(call.name)) {
      stack.push({ title, end: matchParen(text, call.argsOpen) });
      continue;
    }
    const body = bodyBlock(text, titleFrom + 1, titleTo);
    cases.push({
      describe: stack.map((d) => d.title).join(" > "),
      title,
      line: text.slice(0, call.start).split("\n").length,
      parametrized: call.parametrized,
      hash: body ? Bun.hash(text.slice(body.start, body.end)).toString(36) : "no-body",
    });
  }
  return cases;
}

function analyseSuite(file, text) {
  const modules = new Set(
    extractImports(text)
      .values()
      .map((s) => resolveSpecifier(s, path.dirname(file)))
      .filter((m) => m !== null),
  );
  return {
    lines: text.split("\n").length,
    modules,
    cases: collectCases(text),
    helpers: extractHelpers(text),
  };
}

async function gatherSuites() {
  const files = [];
  for (const dir of DIRS) {
    let found;
    try {
      found = await readdir(path.join(repo, dir));
    } catch {
      continue;
    }
    for (const f of found.sort()) {
      if (EXTS.some((ext) => f.endsWith(ext))) files.push(`${dir}/${f}`);
    }
  }
  const suites = new Map();
  for (const file of files) {
    suites.set(file, analyseSuite(file, await Bun.file(path.join(repo, file)).text()));
  }
  return suites;
}

function buildReport(suites) {
  const subsetPairs = [];
  for (const [a, sa] of suites) {
    if (sa.modules.size === 0) continue;
    for (const [b, sb] of suites) {
      if (a === b || sb.modules.size === 0) continue;
      if (sa.modules.isSubsetOf(sb.modules) && sb.modules.size >= sa.modules.size) {
        subsetPairs.push({ a, b, absorbedLines: sa.lines });
      }
    }
  }
  subsetPairs.sort((x, y) => y.absorbedLines - x.absorbedLines);

  const byKey = new Map();
  let instanceTotal = 0;
  for (const [file, s] of suites) {
    for (const c of s.cases) {
      instanceTotal += 1;
      const key = `${c.describe}::${c.title}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push({ file, line: c.line, hash: c.hash });
    }
  }
  const duplicateGroups = byKey
    .entries()
    .filter(([, owners]) => owners.length > 1)
    .map(([key, owners]) => ({
      key,
      owners,
      kind: new Set(owners.map((o) => o.hash)).size === 1 ? "IDENTICAL-SOURCE" : "TITLE-TWIN",
    }))
    .toArray()
    .sort((x, y) => y.owners.length - x.owners.length);

  const helperOwners = new Map();
  for (const [file, s] of suites) {
    for (const name of s.helpers.keys()) {
      if (!helperOwners.has(name)) helperOwners.set(name, new Set());
      helperOwners.get(name).add(file);
    }
  }
  const helperClones = helperOwners
    .entries()
    .filter(([, owners]) => owners.size >= 3)
    .map(([name, owners]) => ({ name, owners: [...owners] }))
    .toArray()
    .sort((x, y) => y.owners.length - x.owners.length);

  return {
    subsetPairs,
    duplicateGroups,
    helperClones,
    ledger: { instanceTotal, distinctKeys: byKey.size, duplicateGroups: duplicateGroups.length },
  };
}

function printReport(report) {
  const l = report.ledger;
  console.error(
    `case ledger: ${l.instanceTotal} instances, ${l.distinctKeys} distinct titles, ${l.duplicateGroups} duplicate groups`,
  );
  console.error(`\nimport-subset pairs (absorb candidate):`);
  for (const p of report.subsetPairs.slice(0, TOPN())) {
    console.error(`  ~${String(p.absorbedLines).padStart(4)} lines  ${p.a}  ->  ${p.b}`);
  }
  console.error(`\nduplicate groups (IDENTICAL-SOURCE is evidence of a copy, not deletion permission):`);
  for (const d of report.duplicateGroups.slice(0, TOPN())) {
    console.error(`  [${d.kind}] "${d.key}"`);
    console.error(`    in: ${d.owners.map((o) => `${o.file}:${o.line}`).join(", ")}`);
  }
  console.error(`\nhelper names defined in 3+ suites (${report.helperClones.length}):`);
  for (const h of report.helperClones.slice(0, TOPN())) {
    console.error(`  ${h.name}: ${h.owners.length} suites`);
  }
}

function TOPN() {
  return ARGS.single.has("top") ? Number(ARGS.single.get("top")) : 20;
}

export { analyseSuite, buildReport, collectCases, scanCalls, skipRegion };

if (import.meta.main) {
  const report = buildReport(await gatherSuites());
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
}
