import type { RuleExample } from "./rule-examples.ts";
import { existsSync, readFileSync } from "../../src/meta/filesystem.ts";
import { dirname, join } from "../../src/meta/path.ts";
import { AUTHORED_ROOTS, corpus } from "../loc/source-policy.ts";
import {
  NOT_SLOP_LEDGER,
  type Place,
  readLedger,
  siteExcerpt,
  siteId,
  TREE_RULE_PREFIX,
} from "./not-slop-ledger.ts";
import { buildImportGraph, isTestPath, parsedSources } from "./tree-ast.ts";
import { copiedBlocks } from "./tree-copied-block.ts";
import { crossedArguments } from "./tree-crossed-argument.ts";
import { identitiesWithoutOwner } from "./tree-identity.ts";
import { implicitStateFindings } from "./tree-implicit-state.ts";
import { overwrittenKeys } from "./tree-overwritten-key.ts";
import { envExamples, staleReferences } from "./tree-stale-reference.ts";
import {
  constantParameters,
  deadExports,
  duplicateFunctions,
  duplicateTypes,
  unusedFields,
  unusedReexports,
} from "./tree-structure.ts";

type TreeFindingKind = keyof typeof TREE_FINDING_ARGUMENTS;

export interface TreeFinding {
  readonly kind: TreeFindingKind;
  readonly path: string;
  readonly line: number;
  readonly detail: string;
  readonly places?: readonly { readonly path: string; readonly line: number; readonly end: number }[];
}

export interface TreeSite extends TreeFinding {
  readonly id: string;
  readonly excerpt: string;
}

export const TREE_FINDING_ARGUMENTS = {
  "no-unused-export":
    "A named export that no other module imports (resolved through the AST import graph, including re-exports, namespace imports, dynamic imports, and import types). Drop `export`, or delete the symbol if its own module never uses it.",
  "no-test-only-export":
    "An exported function or class that its own module never uses and that only tests import. Nothing in production executes it, so its tests prove no live path. Delete both, or wire it into production.",
  "no-unused-reexport":
    'A re-export (`export { a } from "./owner.ts"`, or `export { a }` of an imported binding) that no other module imports from this forwarder. Delete the unused forward. Package `index` files and `node:` forwards are skipped.',
  "no-unused-field":
    "A field declared in an interface or object type (at least four characters) that no file in the repository spells again. Nothing reads or writes it: delete the dead field.",
  "no-constant-parameter":
    "An exported function whose optional parameter is never passed across all callers, or whose required parameter receives the exact same literal across three or more calls (and never escapes as a callback or spread). Remove the dead configurability and inline the invariant value.",
  "no-duplicate-function":
    "A top-level production helper function whose normalized AST body (at least 22 tokens) is identical across two or more files. Give the helper one owner and import it.",
  "no-duplicate-type":
    "A top-level interface or object type alias (at least four fields) with the exact same field set declared in two or more production files. Share one authoritative type.",
  "no-duplicate-block":
    "Two or more consecutive statements (at least four lines and 84 tokens) written out at two or more places once local names and literals are abstracted away. Extract one owner both places call.",
  "no-unowned-identity":
    "A repository path, artifact filename, or versioned schema tag spelled as a literal in two or more files without a shared constant owner. Import the owner constant or declare one. Type nodes, `satisfies` tables, and `as const` lists read with `typeof` are skipped.",
  "no-superseded-schema-tag":
    "A `name/vN` tag spelled in a production file while another production file spells a later version of it. Drop the obsolete reader branch.",
  "no-unused-module":
    "A module no file imports, spawns, or names in source, scripts, hooks, workflows, or docs. Delete it, or wire it where it runs.",
  "no-test-only-module":
    "A production module that only tests import or name. Delete it with its tests, or import it where production needs it.",
  "no-overwritten-key":
    "A key a caller passes in an object argument to a function that spreads that parameter and unconditionally overwrites the same key, so the caller's value is silently ignored. Remove the dead key or honour it in the callee.",
  "no-transposed-argument":
    "A cross-file call whose arguments are swapped or rotated relative to the callee's parameter names (`copyTree(destination, source)` against `copyTree(source, destination)`). Fix the argument order or binding name.",
  "no-stale-reference":
    "A backticked repository path in Markdown or a TypeScript comment that names no file or directory, or an `ANA_*` setting documented in `.env*.example`, AGENTS.md, or a SKILL.md that no code or script reads. Point live docs at the current path or cite `<sha>:path` for history.",
  "no-scattered-state-literals":
    "A declared exported state set (union of string literals, `as const`, string `enum`, `Set`, or discriminated union tags) whose values two or more other files hand-group into subsets. Name each grouping as a predicate or table in the owner and call it.",
  "no-repeated-external-read":
    "One function or module top level performs the same external command, file read, directory listing, or fetch twice on one call path. Read once where the paths join and pass the result down.",
  "no-duplicate-derivation":
    "A domain expression or array scan that re-derives by hand a fact an exported function in another file already computes and returns. Call the owning function instead.",
  "require-exhaustive-mapping":
    "A lookup `Map` read with a computed key that maps most or all of a declared set without a type holding it exhaustive. Build it from `Object.entries({ ... } satisfies Record<Union, Value>)` so the compiler checks every member.",
} as const;

export const TREE_FINDING_EXAMPLES: Readonly<Record<TreeFindingKind, readonly RuleExample[]>> = {
  "no-unused-export": [
    {
      before:
        "export function internalSum(values: readonly number[]): number {\n  return values.reduce((total, one) => total + one, 0);\n}",
      after:
        "function internalSum(values: readonly number[]): number {\n  return values.reduce((total, one) => total + one, 0);\n}",
    },
  ],
  "no-test-only-export": [
    {
      before: "export function rankOf(row: Row): number {\n  return row.rank;\n}",
      after:
        "export function ranked(rows: readonly Row[]): number[] {\n  return rows.map((row) => row.rank);\n}",
    },
  ],
  "no-unused-reexport": [
    {
      before: 'export { roomOf } from "./room.ts";',
      after: 'import { roomOf } from "./room.ts";',
    },
  ],
  "no-unused-field": [
    {
      before: "interface Slot {\n  readonly id: string;\n  readonly rankHint: number;\n}",
      after: "interface Slot {\n  readonly id: string;\n}",
    },
  ],
  "no-constant-parameter": [
    {
      before: 'export function hold(lock: string, owner = "land"): string {\n  return `${lock}:${owner}`;\n}',
      after: "export function hold(lock: string): string {\n  return `${lock}:land`;\n}",
    },
  ],
  "no-duplicate-function": [
    {
      before:
        'const nonblank = (text: string): number => text.split("\\n").filter((line) => line.trim() !== "").length;',
      after: 'import { countNonBlank } from "./nonblank-loc.ts";\nexport const lines = countNonBlank(text);',
    },
  ],
  "no-duplicate-type": [
    {
      before:
        "export interface LinuxSupport {\n  ok: boolean;\n  path: string;\n  digest: string;\n  reason: string;\n}",
      after: 'import type { WallSupport } from "./support.ts";\nexport type LinuxSupport = WallSupport;',
    },
  ],
  "no-duplicate-block": [
    {
      before:
        'const text = await Bun.file(path).text();\nconst rows = text.split("\\n").filter(Boolean);\nreturn rows.map((row) => parseRow(row));',
      after:
        'export async function rowsAt(path: string): Promise<Row[]> {\n  const text = await Bun.file(path).text();\n  return text.split("\\n").filter(Boolean).map(parseRow);\n}',
    },
  ],
  "no-unowned-identity": [
    {
      before: 'const verdicts = join(folder, "verdicts.jsonl");',
      after:
        'import { VERDICTS_FILE } from "../../src/kernel/log.ts";\nconst verdicts = join(folder, VERDICTS_FILE);',
    },
  ],
  "no-superseded-schema-tag": [
    {
      before: 'const current = row.schema === "trace-row/v1" || row.schema === TRACE_ROW;',
      after: "const current = row.schema === TRACE_ROW;",
    },
  ],
  "no-unused-module": [
    {
      before: "export async function replay(): Promise<void> {\n  await run(REPLAY);\n}",
      after: 'import { replay } from "./replay.ts";\nawait replay();',
    },
  ],
  "no-test-only-module": [
    {
      before:
        "export function degenerate(schema: Schema): boolean {\n  return schema.fields.length === 0;\n}",
      after:
        'import { degenerate } from "./degeneracy.ts";\nif (degenerate(schema)) throw new Error("empty schema");',
    },
  ],
  "no-overwritten-key": [
    {
      before: 'export const listTool = tool({ name: "list", executionMode: "sequential", execute });',
      after: 'export const listTool = tool({ name: "list", execute });',
    },
  ],
  "no-transposed-argument": [
    {
      before:
        'import { roundDir } from "./rounds.ts";\nexport const trail = (campaign: string, round: string) => join(roundDir(round, campaign), "trail.jsonl");',
      after:
        'import { roundDir } from "./rounds.ts";\nexport const trail = (campaign: string, round: string) => join(roundDir(campaign, round), "trail.jsonl");',
    },
  ],
  "no-stale-reference": [
    {
      before: "// Measured on `src/run/admission.ts`.\nexport const FLOOR = 8;",
      after: "// Measured on `5bc9988:src/run/admission.ts`.\nexport const FLOOR = 8;",
    },
    {
      before: "// # \u0041NA_CENTRAL=here",
      after: 'export const SETTINGS = ["\u0041NA_HOSTS"];',
    },
  ],
  "no-scattered-state-literals": [
    {
      before: 'const ended = job.state === "done" || job.state === "failed";',
      after: 'import { ended } from "./job.ts";\nexport const finished = jobs.filter(ended);',
    },
  ],
  "no-repeated-external-read": [
    {
      before: 'if (alive(pid) && holder(pid) !== "") release(pid);',
      after:
        'const table = processTable();\nif (alive(table, pid) && holder(table, pid) !== "") release(pid);',
    },
  ],
  "no-duplicate-derivation": [
    {
      before: "if (writersOf(run, listProcs()).length > 0 || keepersOf(run.name).length > 0) return;",
      after: "if (isRunning(run, listProcs())) return;",
    },
  ],
  "require-exhaustive-mapping": [
    {
      before:
        'const SAID = new Map([["queued", "waits"], ["running", "runs"], ["done", "ended"]]);\nexport const said = (job: Job) => SAID.get(job.state);',
      after:
        'const SAID = new Map(\n  Object.entries({ queued: "waits", running: "runs", done: "ended", failed: "failed" } satisfies Record<Job["state"], string>),\n);\nexport const said = (job: Job) => SAID.get(job.state);',
    },
  ],
};

const PARSABLE = /\.(?:ts|tsx|mts|mjs|js)$/u;
const READER_ROOTS = [
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
const READ_AS_SOURCE = [".ts", ".tsx", ".mts", ".mjs", ".js", ".py", ".json"];
const OWNED_ROOTS = [...AUTHORED_ROOTS, ".claude"];
const UNREAD = ["tools/oxlint/anti-slop/", "vendor/pi-claude-bridge/"];
const PROSE_ROOTS = [...READER_ROOTS, "docs", ".github", ".codex", ".config", ".harness"];
const PROSE_SUFFIXES = [".md", ".cjs", ".zsh", ".sh", ".yml", ".yaml", ".toml", ".html"];
const ROOT_FILES = [
  "package.json",
  "bunfig.toml",
  "biome.json",
  ".oxlintrc.json",
  "tsconfig.json",
  "AGENTS.md",
  "README.md",
  ".githooks/pre-commit",
  ".githooks/pre-push",
];
const CODE_PATH = /\.(?:ts|tsx|mts|mjs|js|cjs)$/u;
const DECLARATION_FILE = /\.d\.m?ts$/u;
const IDENTIFIER = /[A-Za-z_$][\w$]*/gu;
const SCHEMA_TAG = /["']([a-z][a-z0-9-]*)\/v(\d+)["']/gu;
const RELATIVE = /["'](\.\.?\/[^"'\s]*)["']/gu;
const SPELLED_PATH = /[\w./-]*[\w-]\.(?:ts|tsx|mts|mjs|js|cjs)(?!\w)/gu;

const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

function codeOf(path: string, text: string): string {
  const comment = path.endsWith(".py") ? /^\s*#/u : /^\s*(?:\/\/|\/?\*)/u;
  if (path.endsWith(".json")) return text;
  return text
    .split("\n")
    .map((line) => (comment.test(line) ? "" : line))
    .join("\n");
}

function supersededSchemaTags(code: ReadonlyMap<string, string>): TreeFinding[] {
  const tags: { path: string; line: number; name: string; version: number }[] = [];
  for (const [path, text] of code) {
    if (isTestPath(path) || !text.includes("/v")) continue;
    for (const [index, line] of text.split("\n").entries()) {
      for (const match of line.matchAll(SCHEMA_TAG)) {
        tags.push({ path, line: index + 1, name: match[1] ?? "", version: Number(match[2]) });
      }
    }
  }
  const latest = new Map<string, (typeof tags)[number]>();
  for (const tag of tags) if (tag.version > (latest.get(tag.name)?.version ?? -1)) latest.set(tag.name, tag);
  const stale = Map.groupBy(
    tags.filter((tag) => tag.version < (latest.get(tag.name)?.version ?? 0)),
    (tag) => `${tag.path}\0${tag.name}`,
  );
  return [...stale.values()].flatMap(([first, ...rest]): TreeFinding[] => {
    const top = first && latest.get(first.name);
    if (!top) return [];
    const versions = [...new Set([first, ...rest].map((tag) => tag.version))].toSorted((a, b) => a - b);
    const spelled = versions.map((version) => `\`${top.name}/v${String(version)}\``).join(", ");
    const detail = `${spelled} still spelled here after \`${top.name}/v${String(top.version)}\` in ${top.path}:${String(top.line)}`;
    return [{ kind: "no-superseded-schema-tag", path: first.path, line: first.line, detail }];
  });
}

function modulesNamed(
  reader: string,
  text: string,
  byName: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const named = new Set<string>();
  for (const [, specifier = ""] of text.matchAll(RELATIVE)) {
    const base = join(dirname(reader), specifier);
    const stem = base.replace(/\.m?js$/u, "");
    for (const candidate of [base, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${base}/index.ts`]) {
      if (byName.get(fileName(candidate))?.includes(candidate) === true) named.add(candidate);
    }
  }
  for (const match of text.matchAll(SPELLED_PATH)) {
    const barePath = match[0].replace(/^(?:\.\.?\/|\/)+/u, "");
    const path = text[match.index - 1] === "$" ? barePath.slice(barePath.indexOf("/") + 1) : barePath;
    for (const module of byName.get(fileName(path)) ?? []) {
      if (module === path || module.endsWith(`/${path}`) || path.endsWith(`/${module}`)) named.add(module);
    }
  }
  named.delete(reader);
  return named;
}

export function unreadModules(
  code: ReadonlyMap<string, string>,
  prose: ReadonlyMap<string, string> = new Map(),
): TreeFinding[] {
  const modules = [...code.keys()].filter(
    (path) => CODE_PATH.test(path) && !DECLARATION_FILE.test(path) && !isTestPath(path),
  );
  const byName = Map.groupBy(modules, fileName);
  const readers = new Map(modules.map((path) => [path, { production: 0, tests: 0 }]));
  for (const [reader, text] of [...code, ...prose]) {
    for (const module of modulesNamed(reader, text, byName)) {
      const count = readers.get(module);
      if (count !== undefined) count[isTestPath(reader) ? "tests" : "production"] += 1;
    }
  }
  return [...readers].flatMap(([path, { production, tests }]): TreeFinding[] => {
    if (production > 0) return [];
    if (tests === 0) {
      return [{ kind: "no-unused-module", path, line: 0, detail: "no file imports, spawns or names it" }];
    }
    const detail = `read by ${tests === 1 ? "one test file" : `${String(tests)} test files`} and nothing else`;
    return [{ kind: "no-test-only-module", path, line: 0, detail }];
  });
}

function identCountsOf(files: ReadonlyMap<string, string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of files.values()) {
    for (const name of text.match(IDENTIFIER) ?? []) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

function sitePlaces(finding: TreeFinding, files: ReadonlyMap<string, string>): Place[] {
  if (finding.line === 0) return [{ path: finding.path, text: "" }];
  const places = finding.places ?? [{ path: finding.path, line: finding.line, end: finding.line }];
  return places.map((place) => ({
    path: place.path,
    text: (files.get(place.path) ?? "")
      .split("\n")
      .slice(place.line - 1, place.end)
      .join("\n"),
  }));
}

export function treeSites(): TreeSite[] {
  const files = corpus(READER_ROOTS, READ_AS_SOURCE);
  const prose = new Map([...corpus(PROSE_ROOTS, PROSE_SUFFIXES), ...envExamples()]);
  for (const path of ROOT_FILES) if (existsSync(path)) prose.set(path, readFileSync(path, "utf8"));
  const parsable = new Map([...files].filter(([path]) => PARSABLE.test(path) && !path.startsWith("vendor/")));
  const ownedFiles = new Map(
    [...parsable].filter(
      ([path]) =>
        OWNED_ROOTS.some((root) => path.startsWith(`${root}/`)) &&
        !UNREAD.some((tree) => path.startsWith(tree)),
    ),
  );
  const authoredFiles = new Map(
    [...ownedFiles].filter(([path]) => AUTHORED_ROOTS.some((root) => path.startsWith(`${root}/`))),
  );
  const parsedOwned = parsedSources(ownedFiles);
  const parsedAuthored = new Map([...parsedOwned].filter(([path]) => authoredFiles.has(path)));
  const extraFiles = new Map(
    [...parsable].filter(
      ([path, text]) => !ownedFiles.has(path) && /(?:\bfrom\s*["'][.#]|\bimport\s*\(|\bexport\b)/u.test(text),
    ),
  );
  const parsedAll = new Map([...parsedOwned, ...parsedSources(extraFiles)]);
  const graph = buildImportGraph(parsedAll);
  const allPaths = new Set(parsedAll.keys());
  const code = new Map([...files].map(([path, text]) => [path, codeOf(path, text)]));
  const all = new Map([...files, ...prose]);
  const counts = identCountsOf(files);
  return [
    ...deadExports(parsedAuthored, graph),
    ...unusedReexports(parsedOwned, graph, allPaths),
    ...unusedFields(parsedOwned, counts),
    ...constantParameters(parsedAuthored, parsedAll, graph),
    ...duplicateFunctions(parsedAuthored),
    ...duplicateTypes(parsedAuthored),
    ...copiedBlocks(parsedOwned),
    ...identitiesWithoutOwner(parsedOwned),
    ...supersededSchemaTags(code),
    ...unreadModules(code, prose),
    ...overwrittenKeys(parsedOwned),
    ...crossedArguments(parsedAll),
    ...staleReferences(all),
    ...implicitStateFindings(parsedOwned),
  ]
    .filter((finding) => !UNREAD.some((root) => finding.path.startsWith(root)))
    .map((finding) => {
      const places = sitePlaces(finding, all);
      return {
        ...finding,
        id: siteId(`${TREE_RULE_PREFIX}${finding.kind}`, places),
        excerpt: siteExcerpt(places),
      };
    });
}

export function treeFindings(): TreeSite[] {
  const text = existsSync(NOT_SLOP_LEDGER) ? readFileSync(NOT_SLOP_LEDGER, "utf8") : "";
  const answered = new Set(readLedger(text).answers.map((answer) => answer.id));
  return treeSites().filter((site) => !answered.has(site.id));
}
