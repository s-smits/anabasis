// The simplify findings that need the whole tree in view at once. An oxlint rule sees one file, so
// none of these can be one: "this export has one reader", "these statements are in two files",
// "nothing spells this field again", "no file names this module". Each is the shape of a recorded
// `/simplify` removal that the file carrying it cannot show.
//
// Every scan is textual and fails open: a name spelled anywhere, a comment of another file
// included, counts as read. What survives is a name no other file spells, or spells once. That
// makes the output a question for a person rather than a gate: `bun run simplify` prints all of
// it, and `bun run commit:check` prints the sites on the lines a commit changes.
//
// Rewritten from scratch on 27 October to half its size. Over nine trees of main from 22 September
// to 27 October, the rewrite reports the sites the earlier scans reported, within a few; the
// pull request gives the counts. Dropped with it: the closed-set scan (no site in any of the nine
// trees, one ledger row ever), and a filter that kept the scans' own files from reading as helpers,
// which merging them made moot.

import type { RuleExample } from "./rule-examples.ts";
import { existsSync, readFileSync } from "../../src/meta/filesystem.ts";
import { dirname, join } from "../../src/meta/path.ts";
import {
  AUTHORED_ROOTS,
  copiedFileLimits,
  corpus,
  NEW_FILE_CEILING,
  READ_AS_SOURCE,
  READER_ROOTS,
} from "../loc/source-policy.ts";
import { copiedBlocks } from "./tree-copied-block.ts";
import { identitiesWithoutOwner } from "./tree-identity.ts";
import {
  NOT_SLOP_LEDGER,
  type Place,
  readLedger,
  siteExcerpt,
  siteId,
  TREE_RULE_PREFIX,
} from "./not-slop-ledger.ts";

type TreeFindingKind =
  | "single-reader-export"
  | "test-only-export"
  | "copied-block"
  | "unread-field"
  | "rule-without-fixture"
  | "identity-without-owner"
  | "superseded-schema-tag"
  | "compatibility-path"
  | "orphan-module"
  | "test-only-module"
  | "unread-forward"
  | "filesystem-import-budget";

export interface TreeFinding {
  kind: TreeFindingKind;
  path: string;
  /** 1-based, or 0 for a finding about the file as a whole. */
  line: number;
  detail: string;
  /** Every place the site spans, when it is more than its own line. */
  places?: readonly { path: string; line: number; end: number }[];
}

/** A finding with the id and excerpt the not-slop ledger names it by. */
export interface TreeSite extends TreeFinding {
  id: string;
  excerpt: string;
}

/** The corpora every scan reads, each read once. */
interface Tree {
  /** Authored TypeScript this repository may restructure: the declarations that are candidates. */
  owned: ReadonlyMap<string, string>;
  /** Every source file a name may be read from, as written. */
  files: ReadonlyMap<string, string>;
  /** The same files with their comment lines blanked, so line numbers still hold. */
  code: ReadonlyMap<string, string>;
}

/**
 * Kinds that are a standing register rather than a list to empty. The filesystem budget is a rule
 * about the delta (a file keeps its count, and a change adds at most one), so its rows never reach
 * zero and are counted apart.
 */
export const TREE_REGISTER_KINDS: readonly TreeFindingKind[] = ["filesystem-import-budget"];

/** Why each shape is a finding, printed once above its sites. */
export const TREE_FINDING_ARGUMENTS: Readonly<Record<TreeFindingKind, string>> = {
  "single-reader-export":
    "A file of 10 to 60 lines whose one export, a function or class, is read by one other file in the same directory with room to hold it. Answering yes moves the code and deletes a file: 86 of 138 net-negative /simplify commits moved a helper into its single caller. A type or a constant stays beside the value it describes, and a reader near its size limit cannot take it.",
  "test-only-export":
    "An exported function or class that only a test reads and that its own module never calls. Nothing in the product runs it, so its test proves nothing about a live path. Delete both, or find the caller that was meant to exist; where it wraps a function the product does call, point the test at that function. A unit the module itself calls, exported so a test can name it, is not counted.",
  "copied-block":
    "Two or more consecutive statements written out at two or more places, once each function's own local names and every literal are abstracted away. Give the block one owner both places call. Tests, vendored code and generated files are not read, and a copy whose places say different things (five word-bearing literals differ, or mostly data whose literals differ) is the content's structure rather than a copy of work.",
  "unread-field":
    "A field declared in an interface or object type whose name no file spells again, comments included. Nothing reads or writes it: delete it, with whatever handled it. Names under seven characters are words and are skipped.",
  "rule-without-fixture":
    "A lint rule a plugin registers that no file under test/ names. A rule that has stopped reporting and a clean tree read the same, so each rule keeps a fixture. Vendored plugins are read too, because their rules fail this repository's strict lint.",
  "identity-without-owner":
    'One name this repository owns (a bundle path, an evidence file, a schema tag) spelled as a literal in two or more files with no constant naming it. A typo in one copy reaches a reader as a missing file. Import the owner the detail names, or give the name one. Literals the compiler already checks (a type, a `satisfies` table, an `as const` list a type is read from), prose inside another string or a template, import specifiers and short words are skipped; `join(dir, "a", "b.ts")` reads as `a/b.ts`.',
  "superseded-schema-tag":
    "A `name/vN` tag spelled in a file while another file spells a later version of it. One version is written, so the reader of the older one is a compatibility path: drop it.",
  "compatibility-path":
    "A name carrying `legacy` in authored, non-test code: a reader or branch kept for what an older version left behind. This repository keeps none (HABITS 12.3): a reader that meets an older version refuses it.",
  "orphan-module":
    "A module no file imports, spawns or names: not an import, a package script, a hook, a workflow or a SKILL.md line. Delete it, or name it where it runs.",
  "test-only-module":
    "A module only tests import or name. The product never reaches it, so its tests prove a path nobody takes. Delete it with its tests, or import it where the product needs it.",
  "unread-forward":
    'A re-export (`export { a } from "./owner.ts"`, or `export { a }` of an imported name) that no file imports from the forwarding module. Every caller reads the owner, so the forward is a second door kept in step for nobody. Delete it. A package `index` and a `node:` forward are skipped.',
  "filesystem-import-budget":
    "How many names a file imports from src/meta/filesystem.ts, above six. A register: the count stands, and a change adds at most one.",
};

/**
 * One pair for each scan, shown once per kind after its sites (`rule-examples.ts` says why). A
 * scan reads the whole tree, so a pair names the files it spans in a comment. A register keeps none.
 */
export const TREE_FINDING_EXAMPLES: Readonly<
  Record<Exclude<TreeFindingKind, "filesystem-import-budget">, readonly RuleExample[]>
> = {
  "single-reader-export": [
    {
      before:
        "// slots.ts: its one export, read only by plan.ts beside it\nexport function slotOf(row: Row): Slot {\n  return row.slot ?? DEFAULT_SLOT;\n}",
      after:
        "// plan.ts holds it, and slots.ts is deleted\nfunction slotOf(row: Row): Slot {\n  return row.slot ?? DEFAULT_SLOT;\n}",
    },
  ],
  "test-only-export": [
    {
      before:
        "// read by test/plan.test.ts alone; plan.ts never calls it\nexport function rankOf(row: Row): number {\n  return row.rank;\n}",
      after:
        "// deleted with its test, or called where the product needs it\nexport function ranked(rows: readonly Row[]): number[] {\n  return rows.map((row) => row.rank);\n}",
    },
  ],
  "copied-block": [
    {
      before:
        '// the same three statements in a.ts and in b.ts\nconst text = await Bun.file(path).text();\nconst rows = text.split("\\n").filter(Boolean);\nreturn rows.map((row) => parseRow(row));',
      after:
        '// one owner both files call\nexport async function rowsAt(path: string): Promise<Row[]> {\n  const text = await Bun.file(path).text();\n  return text.split("\\n").filter(Boolean).map(parseRow);\n}',
    },
  ],
  "unread-field": [
    {
      before:
        "interface Slot {\n  readonly id: string;\n  readonly rankHint: number; // named nowhere else in the tree\n}",
      after: "interface Slot {\n  readonly id: string;\n}",
    },
  ],
  "rule-without-fixture": [
    {
      before:
        '// no file under test/ names the rule this registers\nexport const rules = { "no-hand-rolled-sleep": noHandRolledSleepRule };',
      after:
        '// test/no-hand-rolled-sleep.test.ts\nconst found = await reportedLines("ana", "no-hand-rolled-sleep", SLEEPS);\nexpect(found).toStrictEqual(expectedLines(SLEEPS));',
    },
  ],
  "identity-without-owner": [
    {
      before:
        '// tools/runs/view.ts, and the same literal in tools/runs/zip.ts\nconst verdicts = join(folder, "verdicts.jsonl");',
      after:
        '// both import the owner\nimport { VERDICTS_FILE } from "../../src/kernel/log.ts";\nconst verdicts = join(folder, VERDICTS_FILE);',
    },
  ],
  "superseded-schema-tag": [
    {
      before:
        '// another file writes trace-row/v2\nconst current = row.schema === "trace-row/v1" || row.schema === TRACE_ROW;',
      after: "// nothing writes v1 any more, so nothing reads it\nconst current = row.schema === TRACE_ROW;",
    },
  ],
  "compatibility-path": [
    {
      // `\u006c` spells the l of legacy, so the scan does not report this file for its own example.
      before:
        "const \u006cegacyRows = rows.filter((row) => row.version === 1);\nexport const read = [...\u006cegacyRows.map(upgrade), ...rows];",
      after: "// one version is written, so one is read\nexport const read = rows.map(parseRow);",
    },
  ],
  "orphan-module": [
    {
      before:
        "// tools/old/replay.ts: no import, script, hook or SKILL.md line names it\nexport async function replay(): Promise<void> {\n  await run(REPLAY);\n}",
      after: '// deleted, or named where it runs, in package.json\n// "replay": "bun tools/old/replay.ts"',
    },
  ],
  "test-only-module": [
    {
      before:
        "// src/solve/degeneracy.ts: two tests import it, and no solve path does\nexport function degenerate(schema: Schema): boolean {\n  return schema.fields.length === 0;\n}",
      after:
        '// deleted with its tests, or imported where a solve reads it\nimport { degenerate } from "./degeneracy.ts";\nif (degenerate(schema)) throw new Error("the schema names no field");',
    },
  ],
  "unread-forward": [
    {
      before:
        '// reports.ts forwards a name every caller imports from room.ts itself\nexport { roomOf } from "./room.ts";',
      after: '// the forward is deleted; callers keep their own import\nimport { roomOf } from "./room.ts";',
    },
  ],
};

/** Authored roots whose declarations are candidates, skill scripts included. */
const OWNED_ROOTS = [...AUTHORED_ROOTS, ".claude"];

/** Trees inside those roots copied from upstream: a taste pass there pays a merge cost at the next
 *  copy and buys nothing. `.oxlintrc.json` turns the promoted catchers off over the same trees. */
const UNREAD = ["tools/oxlint/anti-slop/", "vendor/pi-claude-bridge/"];

/** Where a module may be named without being imported. */
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

const TEST_PATH = /(?:^|\/)test\/|\.test\.|\.bun-tests\.|test-support\./u;
const CODE_PATH = /\.(?:ts|tsx|mts|mjs|js|cjs)$/u;
const DECLARATION_FILE = /\.d\.m?ts$/u;
const FROZEN_PATH = /(?:^|\/)(?:vendor|vendored|third[-_]party|migrations?|examples?)\//iu;
const IDENTIFIER = /[A-Za-z_$][\w$]*/gu;

/** A declaration carrying `export` and a name, as `source-policy.ts` reads them. */
const EXPORTED =
  /^export (?:declare )?(?:async )?(interface|type|function|const|let|class|enum|abstract class) ([A-Za-z_$][\w$]*)/gmu;
const MOVABLE = new Set(["function", "class", "abstract class"]);

/** The nonblank size of a home file that the recorded moves took, and the most a reader may hold
 *  after taking one: judged blind on 24 September, every refused move landed at 559 or more. */
const HELPER_LINES = { least: 10, most: 60 } as const;
const READER_ROOM = 560;
/** A skill script reads repository source and cannot receive it. */
const MOVE_TARGETS = ["src/", "tools/", "packages/"];

const DECLARATION_HEAD = /^(?:export )?(?:declare )?(?:interface|type) [A-Za-z_$][\w$]* ?=? ?\{\s*$/u;
const DECLARED_FIELD = /^\s+(?:readonly )?([A-Za-z_$][\w$]*)\??:/u;
const FIELD_LENGTH_FLOOR = 7;

const REGISTERED_RULE = /^\s*"([a-z][a-z0-9-]*)":\s*[A-Za-z]/gu;
const FILESYSTEM_IMPORT = /import\s*\{([^}]*)\}\s*from\s*"[^"]*meta\/filesystem\.ts"/u;
const FILESYSTEM_BUDGET = 6;
const SCHEMA_TAG = /["']([a-z][a-z0-9-]*)\/v(\d+)["']/gu;
/** One name, as the compatibility record was measured: an identifier or a kebab-case member. */
const NAME = /[A-Za-z_][\w-]*[A-Za-z0-9]/gu;
const COMPAT_CODE = /\.(?:ts|tsx|mts|mjs|js|py)$/u;

/** A relative specifier, and a spelled path to a code file, the two ways a file names a module. */
const RELATIVE = /["'](\.\.?\/[^"'\s]*)["']/gu;
const SPELLED_PATH = /[\w./-]*[\w-]\.(?:ts|tsx|mts|mjs|js|cjs)(?!\w)/gu;
const FORWARD = /^export (?:type )?\{([^}]*)\}(?:\s*from\s*["']([^"']+)["'])?/gmu;
const NAMED_IMPORT = /^import (?:type )?\{([^}]*)\}\s*from\s*["']([^"']+)["']/gmu;
const QUOTED = /["'`]([^"'`\n]*)["'`]/gu;

const isTest = (path: string): boolean => TEST_PATH.test(path);
const nonblank = (text: string): number => text.split("\n").filter((line) => line.trim() !== "").length;
const lineAt = (text: string, index: number): number => text.slice(0, index).split("\n").length;
const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const stemOf = (path: string): string => fileName(path).replace(CODE_PATH, "");

/** The text with each comment line blanked, so a name in prose is not read as a use of it. */
function codeOf(path: string, text: string): string {
  const comment = path.endsWith(".py") ? /^\s*#/u : /^\s*(?:\/\/|\/?\*)/u;
  if (path.endsWith(".json")) return text;
  return text
    .split("\n")
    .map((line) => (comment.test(line) ? "" : line))
    .join("\n");
}

/** Which files' code spells each identifier. */
function spellers(code: ReadonlyMap<string, string>): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const [path, text] of code) {
    for (const name of new Set(text.match(IDENTIFIER))) {
      found.set(name, (found.get(name) ?? new Set()).add(path));
    }
  }
  return found;
}

/**
 * Whether a production export can move into its one reader: the home file is the size the recorded
 * moves took and holds nothing else, the two sit in one directory, the reader has room, and the
 * reader imports the home rather than launching it as a process (`"./child.ts"` outside an import).
 */
function movesInto(home: string, reader: string, tree: Tree): boolean {
  const homeText = tree.owned.get(home) ?? "";
  const readerText = tree.files.get(reader) ?? "";
  const size = nonblank(homeText);
  const room = Math.min(copiedFileLimits[reader] ?? NEW_FILE_CEILING, READER_ROOM);
  const launched = `"./${fileName(home)}"`;
  return (
    size >= HELPER_LINES.least &&
    size <= HELPER_LINES.most &&
    MOVE_TARGETS.some((root) => reader.startsWith(root)) &&
    dirname(home) === dirname(reader) &&
    (homeText.match(EXPORTED) ?? []).length === 1 &&
    nonblank(readerText) + size <= room &&
    !readerText.split("\n").some((line) => line.includes(launched) && !line.includes(" from "))
  );
}

/**
 * An exported function or class (or arrow `const`) exactly one other file spells, and its own file
 * spells once. A type or a plain constant belongs beside what it describes; a name its own module
 * also uses is a unit the module runs; a name two files declare cannot be attributed.
 */
function exportsReadOnce(tree: Tree): TreeFinding[] {
  const spelled = spellers(tree.code);
  const homes = new Map<string, { path: string; line: number } | null>();
  for (const [path, text] of tree.owned) {
    for (const match of text.matchAll(EXPORTED)) {
      const [, keyword = "", name = ""] = match;
      const line = text.slice(match.index, text.indexOf("\n", match.index));
      const movable = MOVABLE.has(keyword) || (keyword === "const" && line.includes("=>"));
      homes.set(name, homes.has(name) || !movable ? null : { path, line: lineAt(text, match.index) });
    }
  }
  const rows: TreeFinding[] = [];
  for (const [name, home] of homes) {
    const readers = [...(spelled.get(name) ?? [])].filter((path) => path !== home?.path);
    const [reader] = readers;
    if (home === null || reader === undefined || readers.length > 1) continue;
    const own = (tree.owned.get(home.path) ?? "").match(IDENTIFIER)?.filter((word) => word === name).length;
    if ((own ?? 0) > 1) continue;
    if (isTest(reader)) {
      rows.push({ kind: "test-only-export", ...home, detail: `\`${name}\` is exported only for ${reader}` });
    } else if (movesInto(home.path, reader, tree)) {
      rows.push({
        kind: "single-reader-export",
        ...home,
        detail: `\`${name}\` is read by one file, ${reader}`,
      });
    }
  }
  return rows;
}

/** A field of a declared object type, read by indentation: the block opens on a line ending in `{`
 *  and closes at the first line starting `}`, which keeps object literals and parameter lists out. */
function unreadFields(tree: Tree): TreeFinding[] {
  const counts = new Map<string, number>();
  for (const text of tree.files.values()) {
    for (const name of text.match(IDENTIFIER) ?? []) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const rows: TreeFinding[] = [];
  for (const [path, text] of tree.owned) {
    let inside = false;
    for (const [index, line] of text.split("\n").entries()) {
      const name = inside ? DECLARED_FIELD.exec(line)?.[1] : undefined;
      inside = inside ? !line.startsWith("}") : DECLARATION_HEAD.test(line);
      if (name === undefined || name.length < FIELD_LENGTH_FLOOR || counts.get(name) !== 1) continue;
      rows.push({
        kind: "unread-field",
        path,
        line: index + 1,
        detail: `\`${name}\` is declared and never spelled again`,
      });
    }
  }
  return rows;
}

function rulesWithoutFixture(tree: Tree): TreeFinding[] {
  const fixtures = [...tree.files]
    .flatMap(([path, text]) => (path.startsWith("test/") ? [text] : []))
    .join("\n");
  const plugins = new Map([...tree.files].filter(([path]) => /^tools\/oxlint\/.*\/index\.ts$/u.test(path)));
  return matchesOf(plugins, REGISTERED_RULE)
    .filter(({ match: [, name = ""] }) => !fixtures.includes(name))
    .map(({ path, line, match: [, name] }) => ({
      kind: "rule-without-fixture",
      path,
      line,
      detail: `\`${name}\` is registered and no file under test/ names it`,
    }));
}

function filesystemBudget(tree: Tree): TreeFinding[] {
  return [...tree.owned].flatMap(([path, text]): TreeFinding[] => {
    const match = FILESYSTEM_IMPORT.exec(text);
    const names = (match?.[1] ?? "").split(",").filter((name) => name.trim() !== "").length;
    if (match === null || names <= FILESYSTEM_BUDGET) return [];
    const detail = `${names} names imported, over the budget of ${FILESYSTEM_BUDGET}`;
    return [{ kind: "filesystem-import-budget", path, line: lineAt(text, match.index), detail }];
  });
}

/** Each match of a pattern on a line of each file's code, with its line. */
function matchesOf(code: ReadonlyMap<string, string>, pattern: RegExp) {
  return [...code].flatMap(([path, text]) =>
    text
      .split("\n")
      .flatMap((line, index) =>
        [...line.matchAll(pattern)].map((match) => ({ path, line: index + 1, match })),
      ),
  );
}

/** Per file and tag, the older versions it spells once another production file spells a later one. */
function supersededSchemaTags(code: ReadonlyMap<string, string>): TreeFinding[] {
  const tags = matchesOf(code, SCHEMA_TAG)
    .filter((tag) => !isTest(tag.path))
    .map(({ path, line, match }) => ({ path, line, name: match[1] ?? "", version: Number(match[2]) }));
  const latest = new Map<string, (typeof tags)[number]>();
  for (const tag of tags) if (tag.version > (latest.get(tag.name)?.version ?? -1)) latest.set(tag.name, tag);
  const stale = Map.groupBy(
    tags.filter((tag) => tag.version < (latest.get(tag.name)?.version ?? 0)),
    (tag) => `${tag.path}\0${tag.name}`,
  );
  return [...stale.values()].flatMap(([first, ...rest]): TreeFinding[] => {
    const top = latest.get(first?.name ?? "");
    if (first === undefined || top === undefined) return [];
    const versions = [...new Set([first, ...rest].map((tag) => tag.version))].toSorted((a, b) => a - b);
    const spelled = versions.map((version) => `\`${top.name}/v${version}\``).join(", ");
    const detail = `${spelled} still spelled here after \`${top.name}/v${top.version}\` in ${top.path}:${top.line}`;
    return [{ kind: "superseded-schema-tag", path: first.path, line: first.line, detail }];
  });
}

/** One row per authored production file, at the first line spelling `legacy` inside a longer name. */
export function compatibilityPaths(code: ReadonlyMap<string, string>): TreeFinding[] {
  const spelled = matchesOf(code, NAME).filter(
    ({ path, match: [name] }) =>
      /legacy/iu.test(name) &&
      !/^legacy$/iu.test(name) &&
      COMPAT_CODE.test(path) &&
      !isTest(path) &&
      !FROZEN_PATH.test(path),
  );
  return [...Map.groupBy(spelled, (one) => one.path)].map(([path, names]): TreeFinding => {
    const list = [...new Set(names.map(({ match: [name] }) => `\`${name}\``))].join(", ");
    return {
      kind: "compatibility-path",
      path,
      line: names[0]?.line ?? 0,
      detail: `names a legacy path: ${list}`,
    };
  });
}

/** The modules one file names: a relative specifier that resolves to one, or a spelled path one
 *  ends with (an `#src/…` alias, a package script, `$ROOT/tools/x.ts` in a hook). */
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
    const bare = match[0].replace(/^(?:\.\.?\/|\/)+/u, "");
    const path = text[match.index - 1] === "$" ? bare.slice(bare.indexOf("/") + 1) : bare;
    for (const module of byName.get(fileName(path)) ?? []) {
      if (module === path || module.endsWith(`/${path}`) || path.endsWith(`/${module}`)) named.add(module);
    }
  }
  named.delete(reader);
  return named;
}

/** A module no other file names, or only tests do. */
export function unreadModules(
  code: ReadonlyMap<string, string>,
  prose: ReadonlyMap<string, string> = new Map(),
): TreeFinding[] {
  const modules = [...code.keys()].filter(
    (path) => CODE_PATH.test(path) && !DECLARATION_FILE.test(path) && !isTest(path),
  );
  const byName = Map.groupBy(modules, fileName);
  const readers = new Map(modules.map((path) => [path, { production: 0, tests: 0 }]));
  for (const [reader, text] of [...code, ...prose]) {
    for (const module of modulesNamed(reader, text, byName)) {
      const count = readers.get(module);
      if (count !== undefined) count[isTest(reader) ? "tests" : "production"] += 1;
    }
  }
  return [...readers].flatMap(([path, { production, tests }]): TreeFinding[] => {
    if (production > 0) return [];
    if (tests === 0) {
      return [{ kind: "orphan-module", path, line: 0, detail: "no file imports, spawns or names it" }];
    }
    const detail = `read by ${tests === 1 ? "one test file" : `${tests} test files`} and nothing else`;
    return [{ kind: "test-only-module", path, line: 0, detail }];
  });
}

/** `a`, `b as c` and `type d` in a brace list, as [local, exported]. */
function braceNames(list: string): [string, string][] {
  return list.split(",").flatMap((entry): [string, string][] => {
    const [local = "", exported = local] = entry
      .trim()
      .replace(/^type\s+/u, "")
      .split(/\s+as\s+/u);
    return local === "" ? [] : [[local, exported]];
  });
}

/** A re-export no file reads from the forwarder: no file that quotes the forwarder's name spells
 *  the forwarded one. */
function unreadForwards(tree: Tree): TreeFinding[] {
  const quoting = new Map<string, Set<string>>();
  const spelled = new Map<string, Set<string>>();
  for (const [reader, text] of tree.code) {
    spelled.set(reader, new Set(text.match(IDENTIFIER)));
    for (const [, quoted = ""] of text.matchAll(QUOTED)) {
      quoting.set(stemOf(quoted), (quoting.get(stemOf(quoted)) ?? new Set()).add(reader));
    }
  }
  const rows: TreeFinding[] = [];
  for (const [path, text] of tree.owned) {
    if (isTest(path) || DECLARATION_FILE.test(path) || stemOf(path) === "index") continue;
    const imported = new Map(
      [...text.matchAll(NAMED_IMPORT)].flatMap(([, list = "", from = ""]) =>
        braceNames(list).map(([, local]): [string, string] => [local, from]),
      ),
    );
    const readers = [...(quoting.get(stemOf(path)) ?? [])].filter((reader) => reader !== path);
    for (const match of text.matchAll(FORWARD)) {
      const unread = braceNames(match[1] ?? "")
        .filter(([local]) => !(match[2] ?? imported.get(local) ?? "node:").startsWith("node:"))
        .filter(([, exported]) => !readers.some((reader) => spelled.get(reader)?.has(exported) === true))
        .map(([, exported]) => `\`${exported}\``);
      if (unread.length === 0) continue;
      const line = lineAt(text, match.index);
      const [verb, them] = unread.length === 1 ? ["is", "it"] : ["are", "them"];
      rows.push({
        kind: "unread-forward",
        path,
        line,
        detail: `${unread.join(", ")} ${verb} re-exported here and no file imports ${them} from this module`,
        places: [{ path, line, end: line + match[0].split("\n").length - 1 }],
      });
    }
  }
  return rows;
}

/** The text of every place a finding spans; empty for a finding about a whole file, whose answer
 *  is about the file and whose detail moves without the file changing. */
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

/** Every whole-tree site in this repository, answered or not. `bun run not-slop` and the lint's
 *  ledger check read this to find an id and to judge a row stale. */
export function treeSites(): TreeSite[] {
  const files = corpus(READER_ROOTS, READ_AS_SOURCE);
  const prose = corpus(PROSE_ROOTS, PROSE_SUFFIXES);
  for (const path of ROOT_FILES) if (existsSync(path)) prose.set(path, readFileSync(path, "utf8"));
  const owned = new Map(
    [...corpus(OWNED_ROOTS, [".ts", ".tsx", ".mts"])].filter(
      ([path]) => !UNREAD.some((tree) => path.startsWith(tree)),
    ),
  );
  const code = new Map([...files].map(([path, text]) => [path, codeOf(path, text)]));
  const tree: Tree = { owned, files, code };
  const all = new Map([...owned, ...files]);
  return [
    ...exportsReadOnce(tree),
    ...copiedBlocks(owned),
    ...unreadFields(tree),
    ...rulesWithoutFixture(tree),
    ...identitiesWithoutOwner(owned),
    ...supersededSchemaTags(code),
    ...compatibilityPaths(code),
    ...unreadModules(code, prose),
    ...unreadForwards(tree),
    ...filesystemBudget(tree),
  ]
    .filter(
      (finding) =>
        finding.kind === "rule-without-fixture" || !UNREAD.some((root) => finding.path.startsWith(root)),
    )
    .map((finding) => {
      const places = sitePlaces(finding, all);
      return {
        ...finding,
        id: siteId(`${TREE_RULE_PREFIX}${finding.kind}`, places),
        excerpt: siteExcerpt(places),
      };
    });
}

/** The sites no row of the not-slop ledger answers: what `bun run simplify` and the pre-commit
 *  report print. */
export function treeFindings(): TreeSite[] {
  const text = existsSync(NOT_SLOP_LEDGER) ? readFileSync(NOT_SLOP_LEDGER, "utf8") : "";
  const answered = new Set(readLedger(text).answers.map((answer) => answer.id));
  return treeSites().filter((site) => !answered.has(site.id));
}
