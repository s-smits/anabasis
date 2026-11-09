/**
 * Synthetic positives: explicit owners of state in a real tree, rewritten mechanically into the
 * implicit forms the detectors look for. Each mutant is applied to a copy of its tree (`trees.ts`),
 * never to this repository's source, and the corpus pairs it with the original site at its commit,
 * labelled negative. Two generators do most of the work, each from the owner alone:
 *
 * - `inlineSet` replaces every `NAME.has(x)` or `NAME.includes(x)` in the files that import a named
 *   set of literals with `x === "a" || x === "b"`, the spread the set had removed;
 * - `booleanise` turns a union of string literals into a record of one flag per state.
 *
 * The rest are single edits written out here, each the implicit twin of the explicit form at its
 * site: a second read of the process table, a lock judged by its age, a phase read from files, a
 * fact parsed from a name, a log rewritten whole.
 */
import { readdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { basename, join } from "#src/meta/path.ts";
import type { Range } from "./corpus.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";

/** One textual edit: `find` must occur in the file, and its first occurrence is replaced. */
interface Edit {
  file: string;
  find: string;
  replace: string;
}

type Mutant = (root: string) => Edit[];

const SOURCE = /\.(?:ts|tsx)$/u;
const SKIPPED = /^(?:node_modules|\.git|dist|vendor)$/u;

function filesUnder(root: string, at = root): string[] {
  return readdirSync(at, { withFileTypes: true }).flatMap((entry) => {
    const path = join(at, entry.name);
    if (entry.isDirectory()) return SKIPPED.test(entry.name) ? [] : filesUnder(root, path);
    return SOURCE.test(entry.name) ? [path.slice(root.length + 1)] : [];
  });
}

/**
 * Every membership test of a named set, in each file that imports it from its owner, spelled out
 * as a chain of comparisons. A subject is a name, a member chain or an optional chain.
 */
function inlineSet(owner: string, name: string, values: readonly string[]): Mutant {
  const stem = basename(owner).replace(/\.ts$/u, "");
  const imports = new RegExp(String.raw`import[^;]*\b${name}\b[^;]*from "[^"]*${stem}(?:\.ts)?"`, "u");
  const test = new RegExp(String.raw`\b${name}\.(?:has|includes)\(([\w.?]+)\)`, "gu");
  return (root) =>
    filesUnder(root).flatMap((file) => {
      const text = readFileSync(join(root, file), "utf8");
      if (file === owner || !imports.test(text)) return [];
      return [...text.matchAll(test)].map(([found, subject = ""]) => ({
        file,
        find: found,
        replace: `(${values.map((value) => `${subject} === "${value}"`).join(" || ")})`,
      }));
    });
}

/** A union of string literals declared as `type NAME = "a" | "b" | …;`, rewritten as one flag per state. */
function booleanise(file: string, name: string): Mutant {
  return (root) => {
    const text = readFileSync(join(root, file), "utf8");
    const found = new RegExp(String.raw`type ${name} = ((?:"[\w-]+"(?: \| )?)+);`, "u").exec(text);
    if (found === null) throw new Error(`${file} declares no union ${name}`);
    const states = [...(found[1] ?? "").matchAll(/"([\w-]+)"/gu)].map(([, state = ""]) =>
      state.replaceAll(/-(\w)/gu, (_, c: string) => c.toUpperCase()),
    );
    const fields = states
      .map((state) => `  ${state === "continue" ? "continued" : state}: boolean;`)
      .join("\n");
    return [{ file, find: found[0], replace: `interface ${name} {\n${fields}\n}` }];
  };
}

/** The mutants by id. */
const MUTANTS = {
  "inline-cut": inlineSet("src/kernel/reports.ts", "CUT", ["killed", "crashed"]),
  "inline-at-a-limit": inlineSet("src/kernel/reports.ts", "AT_A_LIMIT", [
    "wall-ended",
    "turns-ended",
    "context-ended",
  ]),
  "inline-starts": inlineSet(".claude/skills/examiner-complexity/scripts/ambition.ts", "STARTS", [
    "exam.started",
    "draft.started",
  ]),
  "booleanise-turn": booleanise("tools/runs/keep.ts", "Turn"),
  "booleanise-ruling": booleanise("src/referee/referee.ts", "Ruling"),
  "booleanise-tool-kind": booleanise("src/harness/open.ts", "ToolKind"),
  "booleanise-verdict": () => [
    {
      file: "src/kernel/verify.ts",
      find: 'export type Verdict =\n  | { readonly kind: "pass"; readonly objective?: number }\n  | { readonly kind: "fail"; readonly blocking: readonly string[] }\n  | { readonly kind: "faulty"; readonly check: string; readonly reason: string }\n  | { readonly kind: "non-result"; readonly reason: string };',
      replace:
        "export interface Verdict {\n  readonly passed: boolean;\n  readonly failed: boolean;\n  readonly faulty: boolean;\n  readonly nonResult: boolean;\n  readonly objective?: number;\n  readonly blocking?: readonly string[];\n  readonly reason?: string;\n}",
    },
  ],
  "reread-processes-alerts": () => [
    {
      file: "tools/runs/alerts.ts",
      find: "    const open = writers(run, running).length > 0;",
      replace: "    const open = writers(run, processes()).length > 0;",
    },
  ],
  "reread-processes-catalogue": () => [
    {
      file: "tools/runs/snapshots.ts",
      find: "      open: writers(run, running).length > 0,",
      replace: "      open: writers(run, processes()).length > 0,",
    },
  ],
  "mtime-hold-alone": () => [
    {
      file: "tools/runtime/landing.ts",
      find: '      if (holder !== null) runtimeProcess.kill(holder, 0);\n      else if (looks >= 5) throw new Error("a lock left without its pid");',
      replace:
        "      if (Date.now() - statSync(lock).mtimeMs > STALE_MS) throw new Error(`a lock older than ${String(STALE_MS)} ms`);",
    },
  ],
  "files-phase-opened": () => [
    {
      file: "tools/wri/wri.ts",
      find: 'function opened(): Investigation {\n  const out = resolve(needed("out"));',
      replace:
        'function opened(): Investigation {\n  const out = resolve(needed("out"));\n  if (!existsSync(join(out, INVESTIGATION))) throw new Error(`${out} was never started`);\n  if (existsSync(join(out, "synthesis.md"))) throw new Error(`${out} is already synthesised`);',
    },
  ],
  "name-parse-login": () => [
    {
      file: "tools/runs/live.ts",
      find: "payerOf(launch?.login, launch?.flags ?? [])",
      replace: "payerOf(/-login(\\d+)$/u.exec(run.name)?.[1], launch?.flags ?? [])",
    },
  ],
  "overwrite-log": () => [
    {
      file: "src/kernel/log.ts",
      find: '    const line = Buffer.from(`${capturedJsonStringify(event)}\\n`, "utf8");',
      replace:
        '    writeFileSync(path, capturedJsonStringify([...read(path), event]));\n    const line = Buffer.from("", "utf8");',
    },
  ],
} satisfies Record<string, Mutant>;

const BY_ID = new Map<string, Mutant>(Object.entries(MUTANTS));

/** Applies a mutant's edits to a tree in place and returns the line ranges they now occupy. */
export function applyMutant(id: string, root: string): Range[] {
  const mutant = BY_ID.get(id);
  if (mutant === undefined) throw new Error(`no mutant ${id}`);
  const edits = mutant(root);
  if (edits.length === 0) throw new Error(`mutant ${id} found nothing to edit`);
  return edits.map(({ file, find, replace }) => {
    const path = join(root, file);
    const text = readFileSync(path, "utf8");
    const at = text.indexOf(find);
    if (at === -1) {
      throw new Error(`mutant ${id}: ${file} does not hold ${capturedJsonStringify(find.slice(0, 60))}`);
    }
    writeFileSync(path, text.slice(0, at) + replace + text.slice(at + find.length));
    const start = text.slice(0, at).split("\n").length;
    return { file, lines: [start, start + replace.split("\n").length - 1] as const };
  });
}
