#!/usr/bin/env bun
/**
 * How far apart are two agents' changes?
 *
 * Finds which exported symbols each side changed, then measures the distance between
 * the two change sets over the module import graph of the composed tree.
 *
 *   # one pair
 *   bun .claude/skills/intelligent-rebase/scripts/coupling.mts --a <base>...<A> --b <base>...<B>
 *
 *   # every pair in a range, to find changes that may interfere
 *   bun .claude/skills/intelligent-rebase/scripts/coupling.mts --review <base>..<head>
 *
 * A range may be any expression `git diff --name-only` accepts; a bare ref is read as
 * `<base>...<ref>`, with --base defaulting to HEAD. `--all` stops weak rows being collapsed,
 * `--json` prints the raw record.
 *
 * Findings are ranked by severity instead of by hop count, because at one hop a precise symbol
 * contact and an incidental file contact are not the same evidence:
 *
 *   6  broken reference — one side removed a name the other still uses
 *   5  same file, same exported symbol changed by both sides
 *   4  same file, disjoint exports
 *   3  symbol contact — one side imports an export the other changed
 *   2  namespace contact — one side imports the other's whole module interface
 *   1  file contact — imports the module, but no changed export crosses
 *   0  file contact through a hub — the importer pulls in a large share of the tree anyway
 *
 * A hub is a file whose fan-out sits at or above the tree's 90th percentile, measured per run.
 * Hub edges are demoted because they connect almost everything to almost everything: in this repo
 * `full-run.ts`, `build-campaign.ts`, and `verification-runner.ts` each import 26-32 modules, so an edge
 * through one of them is a property of the file rather than of the two changes.
 *
 * Two questions the import graph cannot answer are asked separately:
 *
 *   - `dangling-refs.mts` reports a name one side removed that the other side still writes, ranked
 *     by whether an import backs it. A rename produces no conflict, so this is the one contact a
 *     clean merge actively hides. It runs in every mode; a range asks it in one direction only.
 *   - `literal-contact.mts` intersects the literals both sides changed — env variable names, record
 *     field keys, policy keys, fixture paths — which is where this repository's couplings live when
 *     no import crosses. It reads text, so it covers JSON, YAML and Markdown as well as source, and
 *     it runs in pair mode, where both sides' full endpoints are already in hand.
 *
 * Both read text and both over-report: every row is a lead to confirm in source. Coupling through
 * computed names, a value behind a shared key, and prompt digests remains unchecked.
 *
 * Parsing uses the Bun-compatible TypeScript 5 compiler API. Historical blobs overlay the checked
 * out tree, so a past revision is parsed without being checked out.
 */
import { exitWith, parseOrDie } from "#skills/main/cli.ts";
import { gitMaybe, gitText } from "#skills/main/git.ts";
import { listWorktrees } from "#tools/runs/discover.ts";
import { readFileSync, readdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import path from "#src/meta/path.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import type { JsonValue } from "#src/meta/json-shape.ts";
import * as ast from "typescript5";
import { runtimeProcess } from "#src/meta/process.ts";
import { BREAK, danglingRefs, renameHints } from "./dangling-refs.mts";
import type { ImportView, Imports } from "./dangling-refs.mts";
import { literalContact } from "./literal-contact.mts";
import { hasText, textOr } from "#src/meta/text.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";

type Range = { from: string; to: string; expr: string };
type Symbols = Map<string, string>;
type Changed = Map<string, Set<string>>;
/** The exports one side dropped and gained, which is what a rename looks like from outside. */
type Delta = { removed: Changed; added: Changed };
type Edge = { to: string; names: Set<string>; namespace: boolean; alias?: string };
/** What one import or re-export clause pulls across, before its target is resolved. */
type Binding = { names: Set<string>; alias?: string };
type Graph = Map<string, Edge[]>;
/** A clone of this project found outside `.git/worktrees`, with the state worth printing. */
/** What one scan of the worktree roots found, and how many git trees it had to open. */
type CheckoutScan = { found: Checkout[]; scanned: number };
type Checkout = {
  path: string;
  head: string;
  fullHead: string;
  branch: string;
  subject: string;
  dirty: number;
  origin: string;
};
type Finding = { severity: number; kind: string; detail: string; hub: boolean };

const REPO = gitText(runtimeProcess.cwd(), "rev-parse", "--show-toplevel");
const HUB_PERCENTILE = 0.9;

const EXTENSIONS = [
  "",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.mts",
  "/index.js",
];

const SOURCE_EXT = /\.(?:[cm]?tsx?|[cm]?jsx?)$/;
// ── beyond the import graph ─────────────────────────────────────────────────────────────────

// text the break scan reads; wider than the graph, because a name can be written anywhere
const TEXTUAL = /\.(ts|mts|cts|tsx|js|mjs|cjs|json|ya?ml|md|txt|sh|zsh|py)$/;

// ── scoring ─────────────────────────────────────────────────────────────────────────────────

const SEVERITY_LABEL = [
  "file contact via hub",
  "file contact",
  "namespace contact",
  "symbol contact",
  "same file",
  "same file, same symbol",
  "broken reference",
];

/**
 * `dA`/`dB` are hop maps from each side's changed files. Pass them in when comparing many pairs:
 * the walk is per change set, so N sets cost N walks instead of one per pair.
 */
/** Hop distances already computed for one or both sides. Absent means this pair walks them. */
type PairHops = {
  readonly a?: Map<string, number> | undefined;
  readonly b?: Map<string, number> | undefined;
};

/**
 * process.exit() discards writes still queued on a pipe, which silently truncates a large --json
 * document at the pipe buffer. Write to fd 1 synchronously instead, so the whole record lands.
 */
function emitJson(value: JsonValue): never {
  writeFileSync(1, `${JSON.stringify(value, null, 2)}\n`);
  runtimeProcess.exit(0);
  throw new Error("process exit returned unexpectedly");
}

const ARGS = parseOrDie(exitWith("coupling"), {
  values: ["a", "b", "base", "commits", "review", "root", "scan-dir"],
  flags: ["all", "json", "worktrees", "scan"],
});

/** Whether `--<name>` was passed, as a flag or as a value option. */
function flag(name: string): boolean {
  return ARGS.flags.has(name) || ARGS.single.has(name);
}

function arg(name: string, fallback?: string): string {
  const value = ARGS.single.get(name);
  if (value !== undefined && value !== "") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

function git(args: string[]): string {
  // a path missing at a ref is an answer, not an error, so the caller reads the throw
  return gitText(REPO, ...args);
}

/** `a..b` and `a...b` are read verbatim; a bare ref becomes `<base>...<ref>`. */
function parseRange(expr: string, base: string): Range {
  const dots = expr.includes("...") ? "..." : expr.includes("..") ? ".." : null;
  if (!dots) return { from: base, to: expr, expr: `${base}...${expr}` };
  const [from, to] = expr.split(dots);
  return { from: textOr(from, "HEAD"), to: textOr(to, "HEAD"), expr };
}

/** Empty when the path is absent at that ref, so added and deleted files read as no exports. */
function showAt(ref: string, file: string): string {
  try {
    return git(["show", `${ref}:${file}`]);
  } catch {
    return "";
  }
}

// ── parsing: historical blobs overlay the checked-out tree ──────────────────────────────────

/** Parse one tree view, with absolute overlay paths shadowing checked-out files. */
function withView<T>(
  overlay: Record<string, string>,
  read: (get: (f: string) => ast.SourceFile | undefined) => T,
): T {
  return read((file: string) => {
    const absolute = path.join(REPO, file);
    let text = overlay[absolute];
    if (text === undefined) {
      try {
        text = readFileSync(absolute, "utf8");
      } catch {
        return undefined;
      }
    }
    if (text === "") return undefined;
    return ast.createSourceFile(absolute, text, ast.ScriptTarget.Latest, false, ast.ScriptKind.TS);
  });
}

/** The name a top-level exported declaration is known by; `default` when it has none. */
function declaredName(st: ast.Statement): string {
  if (ast.isFunctionDeclaration(st) || ast.isClassDeclaration(st)) return st.name?.text ?? "default";
  if (ast.isInterfaceDeclaration(st) || ast.isTypeAliasDeclaration(st)) return st.name.text;
  if (ast.isEnumDeclaration(st) || ast.isModuleDeclaration(st)) return st.name.text;
  return "default";
}

/** Top-level exported declarations, by name, with their normalised source text. */
function exportedSymbols(sf: ast.SourceFile | undefined): Symbols {
  const out: Symbols = new Map();
  if (!sf) return out;
  const norm = (n: ast.Node): string => n.getText(sf).replace(/\s+/g, " ").trim();
  for (const st of sf.statements) {
    // `export { a, b }` with no module specifier: the names are the interface, wherever they live
    if (ast.isExportDeclaration(st) && !st.moduleSpecifier) {
      const clause = st.exportClause;
      if (clause === undefined || !ast.isNamedExports(clause)) continue;
      for (const el of clause.elements) out.set(el.name.text, `export {${el.name.text}}`);
      continue;
    }
    const mods = ast.canHaveModifiers(st) ? (ast.getModifiers(st) ?? []) : [];
    if (!mods.some((m) => m.kind === ast.SyntaxKind.ExportKeyword)) continue;
    if (!ast.isVariableStatement(st)) {
      out.set(declaredName(st), norm(st));
      continue;
    }
    // a destructuring declaration exports names this scan does not follow, so it declares none
    const bound = st.declarationList.declarations.flatMap((d) =>
      ast.isIdentifier(d.name) ? [{ name: d.name.text, text: norm(d) }] : [],
    );
    for (const d of bound) out.set(d.name, d.text);
  }
  return out;
}

/**
 * `@ana/agent-bundle` is not a third-party package: the root manifest lists `vendor/agent-bundle` as
 * a workspace and that package exports `./index.ts`. Dropping every non-relative specifier dropped
 * 27 edges into vendored source, which is where the shared bundle contract lives.
 */
const workspaceEntries = ((): Map<string, { dir: string; entry: string }> => {
  const out = new Map<string, { dir: string; entry: string }>();
  const read = (file: string) => {
    const parsed: unknown = readJsonFile(path.join(REPO, file));
    return asRecord(parsed) ?? {};
  };
  try {
    const dirs = read("package.json").workspaces;
    for (const dir of Array.isArray(dirs) ? dirs : []) {
      if (!isString(dir) || dir.includes("*")) continue;
      const pkg = read(`${dir}/package.json`);
      const dot = asRecord(pkg.exports)?.["."];
      const entry = isString(dot) ? dot : isString(pkg.main) ? pkg.main : "index";
      if (isString(pkg.name)) out.set(pkg.name, { dir, entry: entry.replace(/^\.\//, "") });
    }
  } catch {
    // a checkout with no workspace manifest resolves relative specifiers only
  }
  return out;
})();

function firstKnown(base: string, known: Set<string>): string | null {
  // a `.js` or `.mjs` specifier in TypeScript source names the `.ts` or `.mts` file beside it
  const compiled = base
    .replace(/\.mjs$/, ".mts")
    .replace(/\.cjs$/, ".cts")
    .replace(/\.js$/, ".ts");
  return [base, compiled, ...EXTENSIONS.map((e) => `${base}${e}`)].find((c) => known.has(c)) ?? null;
}

function resolveSpec(fromFile: string, spec: string, known: Set<string>): string | null {
  if (spec.startsWith(".")) return firstKnown(path.posix.join(path.posix.dirname(fromFile), spec), known);
  // the root manifest maps `#src/*` onto `./src/*`, so the alias is the path behind its `#`
  if (spec.startsWith("#")) return firstKnown(spec.slice(1), known);
  for (const [name, { dir, entry }] of workspaceEntries) {
    if (spec !== name && !spec.startsWith(`${name}/`)) continue;
    const sub = spec.slice(name.length).replace(/^\//, "");
    return firstKnown(path.posix.join(dir, sub || entry), known);
  }
  return null;
}

/**
 * What one clause pulls across: the named symbols, and the alias when it is a `* as` binding.
 * `import x from` counts as the name `default`, which is what the export side calls it.
 */
function clauseBinding(clause: ast.ImportClause | ast.NamedExportBindings | undefined): Binding {
  if (clause === undefined) return { names: new Set() };
  if (ast.isNamedExports(clause)) {
    return { names: new Set(clause.elements.map((el) => (el.propertyName ?? el.name).text)) };
  }
  if (ast.isNamespaceExport(clause)) return { names: new Set(), alias: clause.name.text };
  const named = new Set(clause.name ? ["default"] : []);
  const bindings = clause.namedBindings;
  if (bindings === undefined) return { names: named };
  if (ast.isNamespaceImport(bindings)) return { names: named, alias: bindings.name.text };
  for (const el of bindings.elements) named.add((el.propertyName ?? el.name).text);
  return { names: named };
}

/** Import and re-export edges, with the names each one pulls across. */
function importEdges(sf: ast.SourceFile | undefined, file: string, known: Set<string>): Edge[] {
  if (!sf) return [];
  const edges: Edge[] = [];
  for (const st of sf.statements) {
    const from = ast.isImportDeclaration(st) || ast.isExportDeclaration(st) ? st : undefined;
    if (from === undefined) continue;
    const spec = from.moduleSpecifier;
    if (spec === undefined || !ast.isStringLiteral(spec)) continue;
    const target = resolveSpec(file, spec.text, known);
    if (target === null) continue;
    const clause = ast.isImportDeclaration(from) ? from.importClause : from.exportClause;
    const binding = clauseBinding(clause);
    // `export * from` names nothing and still crosses the whole interface
    const wildcard = clause === undefined && ast.isExportDeclaration(from);
    edges.push({ ...binding, to: target, namespace: binding.alias !== undefined || wildcard });
  }
  return edges;
}

/**
 * The same edges read the other way round: which file each imported name came from, and what each
 * `* as` alias points at. This is the evidence that separates a broken import from a local of the
 * same name.
 */
function importView(sf: ast.SourceFile | undefined, file: string, known: Set<string>): ImportView {
  const named = new Map<string, string[]>();
  const namespaces = new Map<string, string>();
  for (const edge of importEdges(sf, file, known)) {
    for (const name of edge.names) named.set(name, [...(named.get(name) ?? []), edge.to]);
    if (hasText(edge.alias)) namespaces.set(edge.alias, edge.to);
  }
  return { named, namespaces };
}

/** Shortest undirected hop count from every file to the nearest member of `seeds`. */
function distances(seeds: string[], graph: Graph): Map<string, number> {
  const rev = new Map<string, string[]>();
  for (const [from, edges] of graph) {
    for (const e of edges) rev.set(e.to, [...(rev.get(e.to) ?? []), from]);
  }
  const dist = new Map<string, number>();
  let limit = seeds.filter((s) => graph.has(s));
  for (const s of limit) dist.set(s, 0);
  let d = 0;
  while (limit.length > 0) {
    d += 1;
    const next: string[] = [];
    for (const f of limit) {
      for (const n of [...(graph.get(f) ?? []).map((e) => e.to), ...(rev.get(f) ?? [])]) {
        if (dist.has(n)) continue;
        dist.set(n, d);
        next.push(n);
      }
    }
    limit = next;
  }
  return dist;
}

// ── change sets ─────────────────────────────────────────────────────────────────────────────

/**
 * Every root the typecheck boundary covers, not `src/` alone. tsconfig compiles `src`, `tools` and
 * `test`; the `vendor/` workspaces are source reached through `@ana/*`; `.claude/skills` holds
 * scripts that import `src/meta` directly, and a check in `test/` binds them to the gate. A change
 * in any of these can break a change in another, so the graph has to hold all of them.
 */
const SOURCE_ROOTS = arg("root", "src,tools,test,vendor,packages,starters,.claude/skills")
  .split(",")
  .flatMap((r) => r.trim().replace(/\/+$/, "") || []);
const isSource = (f: string): boolean =>
  SOURCE_ROOTS.some((r) => f.startsWith(`${r}/`)) && SOURCE_EXT.test(f);
const rootsLabel = SOURCE_ROOTS.join(", ");

/**
 * Exported interface of `files` at each ref. Read each revision once, then reuse its parsed view.
 * The reader answers for any ref in `refs`; anything else reads as an empty tree, which is what an
 * absent revision already means in `showAt`.
 */
function viewsForRefs(refs: string[], files: string[]): (ref: string) => Map<string, Symbols> {
  const views = new Map<string, Map<string, Symbols>>();
  for (const ref of new Set(refs)) {
    const overlay: Record<string, string> = {};
    for (const f of files) overlay[path.join(REPO, f)] = showAt(ref, f);
    views.set(
      ref,
      withView(overlay, (get) => new Map(files.map((f) => [f, exportedSymbols(get(f))]))),
    );
  }
  return (ref) => views.get(ref) ?? new Map();
}

function diffSymbols(before: Map<string, Symbols>, after: Map<string, Symbols>, files: string[]): Changed {
  const changed: Changed = new Map();
  for (const file of files) {
    const b = before.get(file) ?? new Map();
    const a = after.get(file) ?? new Map();
    const symbols = new Set<string>();
    for (const [name, text] of a) if (b.get(name) !== text) symbols.add(name);
    for (const name of b.keys()) if (!a.has(name)) symbols.add(name);
    changed.set(file, symbols);
  }
  return changed;
}

/** What a rename and a move look like from outside: the exports one side dropped and gained. */
function exportDelta(before: Map<string, Symbols>, after: Map<string, Symbols>, files: string[]): Delta {
  const removed: Changed = new Map();
  const added: Changed = new Map();
  for (const file of files) {
    const b = before.get(file) ?? new Map();
    const a = after.get(file) ?? new Map();
    const gone = new Set([...b.keys()].filter((n) => !a.has(n)));
    const fresh = new Set([...a.keys()].filter((n) => !b.has(n)));
    if (gone.size > 0) removed.set(file, gone);
    if (fresh.size > 0) added.set(file, fresh);
  }
  return { removed, added };
}

function textsAt(ref: string, files: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of files) if (TEXTUAL.test(f)) out.set(f, showAt(ref, f));
  return out;
}

/** What each of one side's changed source files imports at that side's own tip. */
function importViewsAt(ref: string, files: string[], known: Set<string>): Imports {
  const parseable = files.filter(isSource);
  const overlay: Record<string, string> = {};
  for (const f of parseable) overlay[path.join(REPO, f)] = showAt(ref, f);
  return withView(overlay, (get) => new Map(parseable.map((f) => [f, importView(get(f), f, known)])));
}

/** How one import edge out of a changed file meets the symbols the other side changed. */
function edgeFinding(from: string, e: Edge, theirs: Set<string>, hub: boolean, label: string): Finding {
  const tag = hub ? " (hub)" : "";
  const hit = [...e.names].filter((n) => theirs.has(n));
  if (hit.length > 0) {
    return {
      severity: 3,
      hub,
      kind: `symbol contact ${label}${tag}`,
      detail: `${from} → ${e.to}: ${hit.join(", ")}`,
    };
  }
  if (e.namespace && theirs.size > 0) {
    return {
      severity: 2,
      hub,
      kind: `namespace contact ${label}${tag}`,
      detail: `${from} → ${e.to}: whole interface`,
    };
  }
  return {
    severity: hub ? 0 : 1,
    hub,
    kind: `file contact ${label}${hub ? " via hub" : ""}`,
    detail: `${from} → ${e.to}`,
  };
}

/** Every import edge from one side's changed files that lands on a file the other side changed. */
function crossings(
  label: string,
  mine: Changed,
  theirs: Changed,
  graph: Graph,
  hubs: Set<string>,
): Finding[] {
  const out: Finding[] = [];
  for (const from of mine.keys()) {
    // an edge out of a hub says more about the hub than about the two changes
    const hub = hubs.has(from);
    for (const e of graph.get(from) ?? []) {
      const landed = theirs.get(e.to);
      if (landed !== undefined) out.push(edgeFinding(from, e, landed, hub, label));
    }
  }
  return out;
}

function analysePair(a: Changed, b: Changed, graph: Graph, hubs: Set<string>, known: PairHops = {}) {
  const { a: dA, b: dB } = known;
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const add = (f: Finding): void => {
    const key = `${f.severity}|${f.detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(f);
  };

  for (const [file, aSyms] of a) {
    const bSyms = b.get(file);
    if (!bSyms) continue;
    const shared = [...aSyms].filter((s) => bSyms.has(s));
    add(
      shared.length > 0
        ? { severity: 5, hub: false, kind: "same file, same symbol", detail: `${file}: ${shared.join(", ")}` }
        : { severity: 4, hub: false, kind: "same file", detail: `${file} — disjoint exports` },
    );
  }

  for (const f of [...crossings("A→B", a, b, graph, hubs), ...crossings("B→A", b, a, graph, hubs)]) {
    add(f);
  }

  // within one severity band, a contact out of a narrow module outranks one out of a hub
  findings.sort((x, y) => y.severity - x.severity || Number(x.hub) - Number(y.hub));

  const hopsA = dA ?? distances([...a.keys()], graph);
  const hopsB = dB ?? distances([...b.keys()], graph);
  let hops = Number.POSITIVE_INFINITY;
  const meeting: { file: string; total: number }[] = [];
  for (const [file, da] of hopsA) {
    const db = hopsB.get(file);
    if (db === undefined) continue;
    hops = Math.min(hops, da + db);
    if (da > 0 && db > 0) meeting.push({ file, total: da + db });
  }
  meeting.sort((x, y) => x.total - y.total);

  const severity = findings[0]?.severity ?? -1;
  return { findings, severity, hops, meeting };
}

function verdictLine(severity: number, hops: number, aFiles: number, bFiles: number): string {
  if (severity >= 6) return "broken — one side removed a name the other still uses";
  if (aFiles === 0 || bFiles === 0) {
    const which =
      aFiles === 0 && bFiles === 0
        ? "neither side changed a source file"
        : `${aFiles === 0 ? "side A" : "side B"} changed no source file`;
    return `no source contact — ${which} under ${rootsLabel}`;
  }
  if (severity >= 4) return "same file — both sides edited one file";
  if (severity === 3) return "adjacent — one side imports a symbol the other changed";
  if (severity === 2) return "adjacent — one side imports the other's whole module interface";
  if (severity === 1) return "adjacent — imports the module, but no changed export crosses";
  if (severity === 0) return "adjacent through a hub only — weak, the importer pulls in most of the tree";
  if (!Number.isFinite(hops)) return "disconnected — no import path between the two change sets";
  return `${hops <= 3 ? "near" : "far"} — ${hops} import hops apart, no direct contact`;
}

// ── modes ───────────────────────────────────────────────────────────────────────────────────

// the composed tree is what is checked out, so the graph reads the real filesystem
const treeFiles = git(["ls-files"]).split("\n").filter(isSource);
const known = new Set(treeFiles);
const graph: Graph = withView({}, (get) => new Map(treeFiles.map((f) => [f, importEdges(get(f), f, known)])));

const fanOut = [...graph.values()].map((e) => e.length).sort((x, y) => x - y);
const hubCut = Math.max(5, fanOut[Math.floor(fanOut.length * HUB_PERCENTILE)] ?? 10);
const hubs = new Set([...graph].flatMap(([f, e]) => (e.length >= hubCut ? [f] : [])));

const showAll = flag("all");
const asJson = flag("json");

/**
 * Checkouts that this repo's `.git/worktrees` cannot know about: a separate clone made by another
 * tool. Codex keeps them at `~/.codex/worktrees/<task>/<repo>`, Cursor at
 * `~/.cursor/worktrees/<project>/<id>`, both two levels down. A clone is matched to this project by
 * origin URL or by a shared root commit, since path and directory name prove nothing.
 */
function scanForCheckouts(roots: string[], depth = 3): CheckoutScan {
  const ourOrigin = gitMaybe(REPO, "remote", "get-url", "origin") ?? "";
  const ourRoots = new Set(git(["rev-list", "--max-parents=0", "HEAD"]).split("\n").filter(Boolean));
  const at = (dir: string, args: string[]): string => gitMaybe(dir, ...args) ?? "";

  const found: Checkout[] = [];
  let scanned = 0;
  const walk = (dir: string, left: number): void => {
    if (left < 0) return;
    let entries: string[];
    try {
      // readdir instead of `ls`, which hides dotfiles and so would never reveal .git
      entries = readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() || e.name === ".git" ? [e.name] : [],
      );
    } catch {
      return;
    }
    if (entries.includes(".git")) {
      scanned += 1;
      const origin = at(dir, ["remote", "get-url", "origin"]);
      const rootCommits = at(dir, ["rev-list", "--max-parents=0", "HEAD"]).split("\n").filter(Boolean);
      const mine = (origin && origin === ourOrigin) || rootCommits.some((r) => ourRoots.has(r));
      if (mine) {
        const head = at(dir, ["rev-parse", "HEAD"]);
        found.push({
          path: dir,
          head: head.slice(0, 7),
          fullHead: head,
          branch: at(dir, ["rev-parse", "--abbrev-ref", "HEAD"]) || "detached",
          subject: at(dir, ["log", "-1", "--format=%s"]),
          dirty: at(dir, ["status", "--porcelain"]).split("\n").filter(Boolean).length,
          origin,
        });
      }
      return; // do not descend into a checkout
    }
    for (const e of entries) walk(path.join(dir, e), left - 1);
  };
  for (const r of roots) walk(r, depth);
  return { found, scanned };
}

if (flag("worktrees")) {
  // What is actually in flight. Committed history says what landed; the other agents' trees say
  // what is being written right now, which is the population this skill is really about.
  const base = arg("base", "HEAD");
  const entries = listWorktrees(REPO).map((entry) => ({
    path: entry.path,
    head: entry.head ?? "",
    branch: entry.branch?.replace("refs/heads/", "") ?? "detached",
  }));

  const rows = entries.map((e) => {
    const at = (args: string[]): string => gitMaybe(e.path, ...args) ?? "";
    const dirty = at(["status", "--porcelain"]).split("\n").filter(Boolean);
    const [ahead = "0", behind = "0"] = at([
      "rev-list",
      "--left-right",
      "--count",
      `${e.head}...${base}`,
    ]).split(/\s+/);
    // Worktrees live wherever their creator put them — session scratchpads, run trees, /tmp —
    // and git finds them all through .git/worktrees regardless of path. Basenames repeat across
    // those directories, so carry the parent segment to keep two trees distinguishable.
    const parent = path.basename(path.dirname(e.path));
    return {
      name: `${parent === "scratchpad" ? path.basename(path.dirname(path.dirname(e.path))).slice(0, 8) : parent}/${path.basename(e.path)}`,
      path: e.path,
      branch: e.branch,
      head: e.head.slice(0, 7),
      subject: at(["log", "-1", "--format=%s", e.head]),
      dirty: dirty.length,
      dirtySource: dirty.filter((l) => isSource(l.slice(3))).length,
      ahead: Number(ahead || 0),
      behind: Number(behind || 0),
      stale: dirty.length === 0 && Number(ahead || 0) === 0,
    };
  });

  if (asJson) emitJson({ base, worktrees: rows });

  console.log(`\nactive worktrees — ${rows.length}, compared against ${base}\n`);
  const live = rows.filter((r) => !r.stale);
  for (const r of rows.slice().sort((x, y) => y.ahead + y.dirty - (x.ahead + x.dirty))) {
    const marks = [
      r.ahead ? `+${r.ahead}` : "",
      r.behind ? `-${r.behind}` : "",
      r.dirty ? `${r.dirty} dirty${r.dirtySource ? ` (${r.dirtySource} source)` : ""}` : "",
    ].filter(Boolean);
    console.log(`  ${r.name.padEnd(22)} ${r.head}  ${r.branch.padEnd(30)} ${marks.join("  ")}`);
    if (r.subject) console.log(`  ${" ".repeat(22)} ${r.subject}`);
  }
  // Opt-in: other tools keep their checkouts outside this repo's worktree registry, so they are
  // invisible above. Off by default because it walks directories that have nothing to do with git.
  if (flag("scan")) {
    const home = Bun.env.HOME ?? "";
    const roots = flag("scan-dir")
      ? arg("scan-dir")
          .split(",")
          .map((d) => d.trim())
      : [
          path.join(home, ".codex/worktrees"),
          path.join(home, ".cursor/worktrees"),
          path.join(home, ".claude/worktrees"),
          path.join(REPO, ".claude/worktrees"),
        ];
    const registered = new Set(entries.map((e) => e.path));
    const scan = scanForCheckouts(roots);
    const external = scan.found.filter((c) => !registered.has(c.path));
    console.log(
      `\nexternal checkouts — scanned ${roots.length} roots, ${scan.scanned} git trees, ${external.length} for this project`,
    );
    if (external.length === 0) {
      console.log("  none: the trees found there belong to other projects");
    }
    for (const c of external) {
      // a separate clone's commits may simply not exist in our object store yet
      const local = (() => {
        try {
          git(["cat-file", "-e", `${c.fullHead}^{commit}`]);
          return true;
        } catch {
          return false;
        }
      })();
      const rel = local
        ? `+${git(["rev-list", "--count", `${base}..${c.fullHead}`]).trim()} -${git(["rev-list", "--count", `${c.fullHead}..${base}`]).trim()}`
        : "not in our object store — fetch it before comparing";
      const subject = c.subject ? `\n    ${c.subject}` : "";
      console.log(
        `  ${c.path.replace(home, "~")}\n    ${c.head}  ${c.branch}  ${c.dirty ? `${c.dirty} dirty  ` : ""}${rel}${subject}`,
      );
    }
  }

  console.log(`\n${live.length} of ${rows.length} carry work not in ${base}`);
  console.log("compare two of them with:");
  console.log(`  --a ${base}..<branch-or-head-A> --b ${base}..<branch-or-head-B>`);
  console.log("\nuncommitted work is invisible to the comparison — both sides are read from refs,");
  console.log("so uncommitted source needs a separate diff review or a commit before comparison.\n");
  runtimeProcess.exit(0);
  throw new Error("process exit returned unexpectedly");
}

if (flag("review") || flag("commits")) {
  // --commits takes an explicit set, for when the caller has already decided which commits
  // are worth comparing; --review takes every commit in a range.
  const expr = flag("commits") ? arg("commits") : arg("review");
  const commits = flag("commits")
    ? expr.split(",").map((c) => git(["rev-parse", c.trim()]).trim())
    : git(["rev-list", "--reverse", expr]).split("\n").filter(Boolean);
  if (commits.length < 2) throw new Error(`need at least two commits, got ${commits.length}`);

  const perCommit = commits.map((ref) => ({
    ref,
    sha: ref.slice(0, 7),
    subject: git(["log", "-1", "--format=%s", ref]).trim(),
    files: git(["diff", "--name-only", `${ref}^`, ref])
      .split("\n")
      .filter(Boolean),
  }));
  const union = [...new Set(perCommit.flatMap((c) => c.files.filter(isSource)))];

  // Read and parse each revision here, once per distinct ref. Everything
  // below is set arithmetic over what these views produced, so comparing every pair instead of
  // only neighbours costs almost nothing extra.
  const viewAt = viewsForRefs(
    perCommit.flatMap((c) => [`${c.ref}^`, c.ref]),
    union,
  );

  // What each commit changed, and what it dropped from its own exports, one record per commit.
  const each = perCommit.map((c) => {
    const source = c.files.filter(isSource);
    const changed = diffSymbols(viewAt(`${c.ref}^`), viewAt(c.ref), source);
    return {
      ...c,
      changed,
      delta: exportDelta(viewAt(`${c.ref}^`), viewAt(c.ref), source),
      // one graph walk per commit rather than one per pair
      hops: distances([...changed.keys()], graph),
    };
  });

  // What the other commits import at their own tips, read only when something was dropped
  // anywhere. The extra reads are two blobs per changed file, so they are paid for once, and only
  // by a range where a removal actually happened.
  const anyRemoval = each.some((c) => c.delta.removed.size > 0);
  const useSite = each.map((c) =>
    anyRemoval
      ? {
          before: textsAt(`${c.ref}^`, c.files),
          after: textsAt(c.ref, c.files),
          imports: importViewsAt(c.ref, c.files, known),
        }
      : {
          before: new Map<string, string>(),
          after: new Map<string, string>(),
          imports: new Map<string, ImportView>(),
        },
  );

  const pairs = each.flatMap((left, i) =>
    each.slice(i + 1).map((right, k) => ({ left, right, i, j: i + 1 + k })),
  );
  const rows = pairs.map(({ left, right, i, j }) => {
    const r = analysePair(left.changed, right.changed, graph, hubs, { a: left.hops, b: right.hops });
    return {
      i,
      j,
      pair: `${left.sha}→${right.sha}`,
      adjacent: j === i + 1,
      severity: r.severity,
      hops: Number.isFinite(r.hops) ? r.hops : null,
      top: r.findings[0] ?? null,
      subject: right.subject,
    };
  });

  // the ordered direction: an earlier commit removed the name, a later one still imports it
  const breaks = (anyRemoval ? pairs : []).flatMap(({ left, right, j }) => {
    const site = useSite[j];
    if (site === undefined) return [];
    return danglingRefs({
      remover: left.sha,
      user: right.sha,
      ...left.delta,
      before: site.before,
      after: site.after,
      imports: site.imports,
    }).filter((b) => b.severity === BREAK);
  });

  if (asJson) {
    emitJson({ range: expr, hubCut, commits: perCommit.map((c) => c.sha), rows, breaks });
  }

  if (breaks.length > 0) {
    console.log(
      `\nbroken references — a later commit imports a name an earlier one removed (${breaks.length})`,
    );
    for (const b of breaks) console.log(`  ${b.severity}  ${b.kind}\n     ${b.detail}`);
    console.log("");
  }

  const ranked = rows.filter((r) => r.severity >= 0).sort((x, y) => y.severity - x.severity);
  console.log(`\n${commits.length} commits, ${rows.length} pairs (every pair, not only neighbours)`);
  console.log(`hub cut-off: fan-out >= ${hubCut} (${hubs.size} of ${graph.size} files)\n`);

  // One contended symbol shows up in a pair row for every pair of commits that touched it, so
  // four commits on one function fill six rows with one fact. Group by what is contended instead.
  const bySymbol = new Map<string, string[]>();
  const byFile = new Map<string, string[]>();
  const touched = each.flatMap(({ sha, changed }) =>
    [...changed].map(([file, syms]) => ({ sha, file, syms })),
  );
  for (const { sha, file, syms } of touched) {
    byFile.set(file, [...(byFile.get(file) ?? []), sha]);
    for (const s of syms) {
      const key = `${file}: ${s}`;
      bySymbol.set(key, [...(bySymbol.get(key) ?? []), sha]);
    }
  }
  const contended = [...bySymbol].filter(([, s]) => s.length > 1).sort((x, y) => y[1].length - x[1].length);
  const sharedFiles = [...byFile].filter(
    ([f, s]) => s.length > 1 && ![...bySymbol].some(([k, v]) => k.startsWith(`${f}: `) && v.length > 1),
  );

  if (contended.length > 0) {
    console.log(`contended symbols — one export changed by several commits (${contended.length})`);
    for (const [key, shas] of showAll ? contended : contended.slice(0, 12)) {
      console.log(`  ${String(shas.length).padStart(2)}x  ${key}`);
      console.log(`      ${shas.join(" ")}`);
    }
    if (!showAll && contended.length > 12) console.log(`  ... ${contended.length - 12} more — --all to list`);
    console.log("");
  }
  if (sharedFiles.length > 0) {
    console.log("shared files — several commits, no single shared export");
    for (const [f, shas] of sharedFiles.slice(0, 8)) {
      console.log(`  ${String(shas.length).padStart(2)}x  ${f}`);
    }
    console.log("");
  }

  const shown = showAll ? ranked : ranked.slice(0, 8);
  console.log(`entangled pairs — ${ranked.length} of ${rows.length} have any contact, strongest first`);
  for (const r of shown) {
    console.log(
      `  sev ${r.severity}  ${r.pair}${r.adjacent ? " " : "*"} ${(SEVERITY_LABEL[r.severity] ?? "").padEnd(22)} ${r.top ? r.top.detail : ""}`,
    );
  }
  if (ranked.length > shown.length) console.log(`  ... ${ranked.length - shown.length} more — --all to list`);
  console.log("\n  * non-adjacent: these commits are not neighbours in history");

  // A commit entangled with many others is the one to rebase first, or to split. Report how many
  // distinct files drive that count: hub demotion applies to import edges but not to same-file
  // severity 4 and 5, so one hot file can make every commit that touches it look entangled with
  // every other. A high count over one file measures the file; over many files it measures the
  // commit. Measured on this repo's history, 14 of 21 commits drew 60%+ of their count from a
  // single file, so the split is worth printing rather than assuming.
  const degree = perCommit.map((c, i) => {
    const mine = rows.filter((r) => (r.i === i || r.j === i) && r.severity >= 3);
    const perFile = new Map<string, number>();
    for (const r of mine) {
      const file =
        String(r.top?.detail ?? "")
          .split(":")[0]
          ?.split(" ")[0]
          ?.trim() ?? "";
      if (file) perFile.set(file, (perFile.get(file) ?? 0) + 1);
    }
    const top = [...perFile].sort((x, y) => y[1] - x[1])[0];
    return {
      sha: c.sha,
      subject: c.subject,
      n: mine.length,
      files: perFile.size,
      share: top && mine.length > 0 ? Math.round((top[1] / mine.length) * 100) : 0,
      topFile: top?.[0] ?? "",
    };
  });
  const busy = degree.filter((d) => d.n > 0).sort((x, y) => y.n - x.n);
  if (busy.length > 0) {
    console.log("\nmost entangled commits — strong contact with how many others");
    for (const d of busy.slice(0, 8)) {
      const spread = d.files <= 1 ? `all in ${d.topFile}` : `${d.files} files, ${d.share}% ${d.topFile}`;
      console.log(`  ${String(d.n).padStart(2)}  ${d.sha}  ${String(`(${spread})`).padEnd(34)} ${d.subject}`);
    }
    console.log("  a count concentrated in one file measures the file instead of the commit");
  }
  console.log("");
  runtimeProcess.exit(0);
}

const base = arg("base", "HEAD");
const ranges = { A: parseRange(arg("a"), base), B: parseRange(arg("b"), base) };
const allFiles = {
  A: git(["diff", "--name-only", ranges.A.expr]).split("\n").filter(Boolean),
  B: git(["diff", "--name-only", ranges.B.expr]).split("\n").filter(Boolean),
};
const srcFiles = { A: allFiles.A.filter(isSource), B: allFiles.B.filter(isSource) };
const union = [...new Set([...srcFiles.A, ...srcFiles.B])];
const pick = viewsForRefs([ranges.A.from, ranges.A.to, ranges.B.from, ranges.B.to], union);
const changed = {
  A: diffSymbols(pick(ranges.A.from), pick(ranges.A.to), srcFiles.A),
  B: diffSymbols(pick(ranges.B.from), pick(ranges.B.to), srcFiles.B),
};

const { findings, severity, hops, meeting } = analysePair(changed.A, changed.B, graph, hubs);

const delta = {
  A: exportDelta(pick(ranges.A.from), pick(ranges.A.to), srcFiles.A),
  B: exportDelta(pick(ranges.B.from), pick(ranges.B.to), srcFiles.B),
};
const texts = {
  A: { before: textsAt(ranges.A.from, allFiles.A), after: textsAt(ranges.A.to, allFiles.A) },
  B: { before: textsAt(ranges.B.from, allFiles.B), after: textsAt(ranges.B.to, allFiles.B) },
};
// the imports each side carries at its own tip, which is what decides a break from a mention
const imports = {
  A: importViewsAt(ranges.A.to, allFiles.A, known),
  B: importViewsAt(ranges.B.to, allFiles.B, known),
};
const breaks = [
  ...danglingRefs({
    remover: "A",
    user: "B",
    ...delta.A,
    before: texts.B.before,
    after: texts.B.after,
    imports: imports.B,
  }),
  ...danglingRefs({
    remover: "B",
    user: "A",
    ...delta.B,
    before: texts.A.before,
    after: texts.A.after,
    imports: imports.A,
  }),
].sort((x, y) => y.severity - x.severity);
const renames = [
  ...renameHints(delta.A.removed, delta.A.added).map((h) => `A  ${h}`),
  ...renameHints(delta.B.removed, delta.B.added).map((h) => `B  ${h}`),
];
const changesOf = (side: "A" | "B"): Map<string, { before: string; after: string }> =>
  new Map(
    [...texts[side].after.keys()].map((f) => [
      f,
      { before: texts[side].before.get(f) ?? "", after: texts[side].after.get(f) ?? "" },
    ]),
  );
const literals = literalContact(changesOf("A"), changesOf("B"));
// a literal confined to files both sides changed is the same-file row above, said a second way
const bothChanged = new Set(srcFiles.A.filter((f) => srcFiles.B.includes(f)));
const crossing = literals.filter((r) => [...r.a, ...r.b].some((f) => !bothChanged.has(f)));
const worst = breaks.length > 0 ? Math.max(severity, ...breaks.map((b) => b.severity)) : severity;
const bothOther = allFiles.A.filter((f) => !isSource(f) && allFiles.B.includes(f));
const countExports = (c: Changed): number => [...c.values()].reduce((n, s) => n + s.size, 0);
const verdict = verdictLine(worst, hops, srcFiles.A.length, srcFiles.B.length);

if (asJson) {
  emitJson({
    ranges,
    severity: worst,
    importSeverity: severity,
    hops: Number.isFinite(hops) ? hops : null,
    verdict,
    breaks,
    renames,
    findings,
    literals: crossing.slice(0, 20),
    meeting: meeting.slice(0, 5),
    sharedNonSource: bothOther,
  });
}

console.log(
  `\nA  ${ranges.A.expr}   ${srcFiles.A.length} source files, ${countExports(changed.A)} changed exports`,
);
console.log(
  `B  ${ranges.B.expr}   ${srcFiles.B.length} source files, ${countExports(changed.B)} changed exports`,
);
console.log(`\n${verdict}\n`);

if (breaks.length > 0) {
  console.log("broken references — one side removed a name the other still names");
  for (const b of breaks) console.log(`  [${b.severity}] ${b.kind}: ${b.detail}`);
  console.log("");
}
if (renames.length > 0) {
  console.log("renamed or replaced exports — the name the rest of the stack is measured against");
  for (const h of renames) console.log(`  ${h}`);
  console.log("");
}

const strong = findings.filter((f) => f.severity >= 2);
const weak = findings.filter((f) => f.severity < 2);
if (strong.length > 0) {
  console.log("contact points");
  for (const f of strong) console.log(`  [${f.severity}] ${f.kind}: ${f.detail}`);
}
if (weak.length > 0) {
  if (showAll) {
    for (const f of weak) console.log(`  [${f.severity}] ${f.kind}: ${f.detail}`);
  } else {
    const hub = weak.filter((f) => f.severity === 0).length;
    console.log(`  ${weak.length} weak file contacts collapsed (${hub} through hubs) — --all to list`);
  }
}
if (strong.length > 0 || weak.length > 0) console.log("");

// meeting points are the useful signal exactly when nothing touches directly
if (strong.length === 0 && meeting.length > 0) {
  console.log("nearest shared consumers — where the two sides meet");
  for (const m of meeting.slice(0, 5)) console.log(`  [${m.total}] ${m.file}`);
  console.log("");
}

if (bothOther.length > 0) {
  console.log("both sides changed these non-source files");
  for (const f of bothOther) console.log(`  ${f}`);
  console.log("");
}

if (crossing.length > 0) {
  const shown = showAll ? crossing : crossing.slice(0, 12);
  console.log("shared literals — both sides changed a line carrying the same token");
  for (const r of shown) {
    console.log(`  ${r.token}`);
    console.log(`      A  ${r.a.join(", ")}`);
    console.log(`      B  ${r.b.join(", ")}`);
  }
  if (crossing.length > shown.length) {
    console.log(`  ... ${crossing.length - shown.length} more — --all to list`);
  }
  console.log("");
}

console.log("not checked here — verify by hand");
console.log("  the value behind a shared key, a name either side computes, record rows a producer");
console.log("  and a reader spell apart, prompt digests — a shared literal is a lead, not a verdict\n");
