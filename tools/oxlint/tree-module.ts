/**
 * A module no file reads, and a production module only tests read.
 *
 * A file under `src/`, `tools/` or a skill's `scripts/` is a mechanism, and a mechanism has a
 * caller: an import, a `new URL("./x-child.ts", import.meta.url)` spawn, a `package.json` script,
 * a SKILL.md line telling the operator to run it. A module none of those name is one the tree
 * has already stopped using; a production module whose only readers are tests is a mechanism the
 * product never reaches, kept alive by the test that proves it. Both are the clearest shape slop
 * takes, and the rarest: at 117 sampled revisions of main from 2026-07-27 to 2026-09-20 the tree
 * held five orphan modules in all and eight test-only ones.
 *
 * Measured 2026-09-21. Over the simplify record no simplify commit touched an orphan and one
 * touched a test-only module without removing it, so there is no per-visit rate; the record only
 * says what became of each. Orphan: 5 of 5 resolved by the record head (4 deleted, 1 given a
 * reader). Test-only: 6 of 8 (4 deleted, 1 given its production caller, 1 given the SKILL.md line
 * that runs it); the two open at the record head ee766c7e2 were `src/meta/assert.ts`, imported by
 * four skill tests, and `src/solve/public-artifact-schema-degeneracy.ts`, imported by two, and
 * this branch deleted the second and names the first in its `require-meta-runtime-import` rule,
 * so the scan writes no row at its head. A module with one production reader is deleted at 0.34
 * over the same revisions and one with more at 0.28, which is the base the two rates stand
 * against. At five and eight sites the 95% Wilson lower bounds are
 * 0.57 and 0.41; the point estimates are what clear the bar, and the scan is admitted because
 * every row it can write is a file whose reader a person can look for and fail to find.
 *
 * Readers are every file of the corpus, prose included, and a spelling counts however it is
 * spelled: an import, `require` or `import.meta.resolve` specifier is resolved, and a path or bare
 * basename anywhere else — a string, a script line, a Markdown sentence — is matched by suffix. A
 * comment line in code is left out, and so is the module's own text. Two modules sharing a basename
 * each count a bare spelling of it, which fails open on purpose. A module reached only through a
 * template, `import(\`./${name}.ts\`)`, would be reported; the tree holds no such import.
 */
import { dirname, join } from "../../src/meta/path.ts";
import type { TreeFinding } from "./tree-findings.ts";

interface Readers {
  production: number;
  tests: number;
}

/** A module: authored code that runs, not a declaration file. */
const CODE = /\.(?:ts|tsx|mts|mjs|js|cjs)$/u;
const DECLARATION = /\.d\.m?ts$/u;

/** A test or its helper, wherever it sits; a reader there keeps a module alive only for tests. */
const TEST_PATH = /(?:^|\/)test\/|\.test\.|\.bun-tests\.|test-support\./u;

/** A comment line in code names a file without running it. */
const COMMENT_LINE = /^\s*(?:\/\/|\/?\*)/u;

/** A relative specifier in `import … from`, `import(…)`, `require(…)` or a `resolve(…)` call. */
const RELATIVE_IMPORT = /(?:from|import|require\(|resolve\()\s*["']([./][^"']*)["']/gu;

/** A path or basename ending in a code suffix, spelled anywhere. */
const SPELLED_PATH = /[\w./-]*[\w-]\.(?:ts|tsx|mts|mjs|js|cjs)(?![\w])/gu;

/** `export { a, b as c } from "…"`, its `export type` form, or `export { a }` naming bindings. */
const FORWARD = /^export (?:type )?\{([^}]*)\}(?:\s*from\s*["']([^"']+)["'])?/gmu;

/** `import { a, type b as c } from "…"`: the names a module binds from another. */
const NAMED_IMPORT = /^import (?:type )?\{([^}]*)\}\s*from\s*["']([^"']+)["']/gmu;

/** A quoted string on one line, which may be a specifier or a path naming a module. */
const QUOTED = /["'`]([^"'`\n]*)["'`]/gu;

/** A file's lines, less the comment lines when it is code: a comment naming a module or an export
 *  says where something came from, not that the file reads it. */
export function codeLines(path: string, text: string): string[] {
  const lines = text.split("\n");
  return CODE.test(path) ? lines.filter((line) => !COMMENT_LINE.test(line)) : lines;
}

/** The files a relative specifier may mean, in the order the runtime tries them. */
function resolutions(reader: string, specifier: string): string[] {
  const base = join(dirname(reader), specifier);
  return [
    base,
    base.replace(/\.js$/u, ".ts"),
    base.replace(/\.js$/u, ".tsx"),
    base.replace(/\.mjs$/u, ".mts"),
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}/index.ts`,
  ];
}

/** The modules one line of a reader names, by resolved import or by spelled path. */
function modulesOnLine(
  reader: string,
  line: string,
  modules: ReadonlySet<string>,
  byBasename: ReadonlyMap<string, readonly string[]>,
): string[] {
  const imported = [...line.matchAll(RELATIVE_IMPORT)]
    .flatMap((match) => resolutions(reader, match[1] ?? ""))
    .filter((candidate) => modules.has(candidate));
  // A spelling names the module when one is a suffix of the other on a segment boundary: a
  // relative `scripts/x.mjs` is a suffix of the module, and an absolute `/Users/…/.claude/…/x.mjs`
  // ends in it. A leading shell variable is a root the line resolves at run time, so
  // `"$ROOT/scripts/x.mjs"` names `scripts/x.mjs`. Judged on 2026-09-24, four of the five
  // test-only-module rows answered no were skill scripts a SKILL.md or its wrapper ran through
  // one of those two spellings.
  const spelled = [...line.matchAll(SPELLED_PATH)].flatMap((match) => {
    const variable = line[(match.index ?? 0) - 1] === "$";
    const bare = match[0].replace(/^(?:\.\.?\/|\/)+/u, "");
    const path = variable ? bare.slice(bare.indexOf("/") + 1) : bare;
    return (byBasename.get(path.slice(path.lastIndexOf("/") + 1)) ?? []).filter(
      (module) => module === path || module.endsWith(`/${path}`) || path.endsWith(`/${module}`),
    );
  });
  return [...imported, ...spelled];
}

/** How many production and test files read each module, by import or by spelling. */
function readerCounts(
  modules: ReadonlySet<string>,
  corpus: ReadonlyMap<string, string>,
): Map<string, Readers> {
  const counts = new Map<string, Readers>([...modules].map((path) => [path, { production: 0, tests: 0 }]));
  const byBasename = new Map<string, string[]>();
  for (const path of modules) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    byBasename.set(name, [...(byBasename.get(name) ?? []), path]);
  }
  for (const [reader, text] of corpus) {
    const isTest = TEST_PATH.test(reader);
    const read = new Set(
      codeLines(reader, text).flatMap((line) => modulesOnLine(reader, line, modules, byBasename)),
    );
    read.delete(reader);
    for (const module of read) {
      const count = counts.get(module);
      if (count === undefined) continue;
      if (isTest) count.tests += 1;
      else count.production += 1;
    }
  }
  return counts;
}

/**
 * One row per module no file reads, and one per production module only tests read.
 *
 * Candidates are the code files of the corpus outside tests and declaration files; readers are
 * the whole corpus, so a scan quiet on a prose file still counts it.
 */
export function unreadModules(corpus: ReadonlyMap<string, string>): TreeFinding[] {
  const modules = new Set(
    [...corpus.keys()].filter((path) => CODE.test(path) && !DECLARATION.test(path) && !TEST_PATH.test(path)),
  );
  const rows: TreeFinding[] = [];
  for (const [path, { production, tests }] of readerCounts(modules, corpus)) {
    if (production > 0) continue;
    rows.push(
      tests === 0
        ? { kind: "orphan-module", path, line: 0, detail: "no file imports, spawns or names it" }
        : {
            kind: "test-only-module",
            path,
            line: 0,
            detail: `read by ${tests === 1 ? "one test file" : `${tests} test files`} and nothing else`,
          },
    );
  }
  return rows;
}

/** A module's name without its directory or code suffix: what every spelling of it ends in. */
const stemOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1).replace(CODE, "");

/** Each entry of a brace list as `[local, exported]`: `type a as b` is `["a", "b"]`. */
function braceNames(list: string): [string, string][] {
  return list.split(",").flatMap((entry) => {
    const [local = "", exported = local] = entry
      .trim()
      .replace(/^type\s+/u, "")
      .split(/\s+as\s+/u);
    return local === "" ? [] : [[local, exported]];
  });
}

/**
 * One row per forwarding statement whose names no file imports from the forwarder.
 *
 * A module that re-exports a name another module declares is a second door to it, and a door no
 * caller uses is a surface the forwarder keeps in step for nobody. PR #120 deleted 16 of these on
 * 2026-10-01, each beside callers that already imported the owner, and the other whole-tree scans
 * saw none: the forwarder spells the name, so it counts as a reader of the owner, and the forward
 * itself declares nothing. A forward is read when another file spells the forwarded name and
 * names the forwarder's module in a quoted string, which is how an import, a dynamic import or a
 * namespace import of it reads; two modules sharing a basename both count, which fails open. An
 * `index` module is a package's entry and is left out, as is a declaration file, whose surface is
 * its runtime twin's, and a forward of a `node:` module, which is the shim the meta layer exists to
 * be. Replayed at #120's base, it prints 13 of those 16 and the one #120 left, `DARWIN_SEATBELT_ID`
 * in os-isolation.ts.
 */
export function unreadForwards(
  declaring: ReadonlyMap<string, string>,
  corpus: ReadonlyMap<string, string>,
): TreeFinding[] {
  const namers = new Map<string, Set<string>>();
  const spelled = new Map<string, Set<string>>();
  for (const [reader, text] of corpus) {
    const code = codeLines(reader, text).join("\n");
    spelled.set(reader, new Set(code.match(/[A-Za-z_$][\w$]*/gu) ?? []));
    for (const [, quoted = ""] of code.matchAll(QUOTED)) {
      const stem = stemOf(quoted);
      namers.set(stem, (namers.get(stem) ?? new Set()).add(reader));
    }
  }
  const rows: TreeFinding[] = [];
  for (const [path, text] of declaring) {
    if (TEST_PATH.test(path) || DECLARATION.test(path) || stemOf(path) === "index") continue;
    const imported = new Map(
      [...text.matchAll(NAMED_IMPORT)].flatMap((match) =>
        braceNames(match[1] ?? "").map(([, local]): [string, string] => [local, match[2] ?? ""]),
      ),
    );
    const readers = [...(namers.get(stemOf(path)) ?? [])].filter((reader) => reader !== path);
    for (const match of text.matchAll(FORWARD)) {
      const unread = braceNames(match[1] ?? "")
        .filter(([local]) => {
          const source = match[2] ?? imported.get(local);
          return source !== undefined && !source.startsWith("node:");
        })
        .filter(([, exported]) => !readers.some((reader) => spelled.get(reader)?.has(exported) === true))
        .map(([, exported]) => `\`${exported}\``);
      if (unread.length === 0) continue;
      const line = text.slice(0, match.index).split("\n").length;
      rows.push({
        kind: "unread-forward",
        path,
        line,
        detail: `${unread.join(", ")} ${unread.length === 1 ? "is" : "are"} re-exported here and no file imports ${unread.length === 1 ? "it" : "them"} from this module`,
        places: [{ path, line, end: line + match[0].split("\n").length - 1 }],
      });
    }
  }
  return rows;
}
