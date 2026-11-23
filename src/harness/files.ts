/**
 * Shared reader of a harness's own files: separates what the Builder wrote from installed
 * interpreters, packages, and binaries, counts guide and program lines, checks for host-specific
 * paths or campaign details before `HOST_ONLY`, and matches verbatim public-input spans.
 *
 * Used by Builder's `check_harness` (`src/builder/tools.ts`, wall-safe against released practice
 * tasks and the public contract) and WRI readers (`tools/wri/`).
 */
import { AGENT_DIR, GUIDE_FILE, TOOL_TREE_DIR } from "../meta/bundle-layout.ts";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "../meta/filesystem.ts";
import { asRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { hasWholeToken } from "../meta/text.ts";
import { portableGuide } from "./starter.ts";

/** Path segments installed by package managers rather than written by the Builder. */
const INSTALLED = /(^|\/)(site-packages|dist-packages|node_modules|\.?venv|vendor|include|__pycache__)(\/|$)/;
const SKIP_DIR = /^(?:node_modules|\.?venv|vendor|include|__pycache__)$/;
const SITE_DIR = /^(?:site|dist)-packages$/;
/** A bundled interpreter's home, known by its Python library folder. */
const INTERPRETER_HOME = /\/lib\/python\d[\d.]*\//;
const METADATA = /\.(?:dist-info|egg-info)$/;
const PAST_NAME = /(?:-[^/]*)?\.(?:dist-info|egg-info)$/;
const WHEEL_LIBS = /(^|\/)[^/]+\.libs\//;
/** A Builder-written program is smaller than this; bundled binaries are larger. */
const MAX_WRITTEN_BYTES = 256 * 1024;
const GUIDE_PATH = `${AGENT_DIR}${GUIDE_FILE}`;
/** Machine-local or Anabasis-internal path prefixes that break when exported. */
const HOST_PATH_RE = /(?:\/Users\/|\/home\/|\/opt\/homebrew\/|\/private\/tmp\/|\/var\/folders\/|\.ana\/)/gu;
/** Absolute shebangs tied to one machine (portable ones use `#!/usr/bin/env` or `/bin/sh`). */
const HOST_SHEBANG_RE = /^#!\s*\/(?:Users|home|opt\/homebrew|Library)\//u;
/** Campaign-only paths and tools that belong under `HOST_ONLY` (`## Validity and score`). */
const HOST_REF_RE = /(?:public\/task\.json|public\/files\/|public\/resources\/|answer\.json|\bsubmit\b)/gu;
const MIN_KEY_LEN = 4;
const WORD_RE = /[\p{L}\p{N}]+/gu;
/** Word span length used to spot copied public-input text. */
export const QUOTE_WORDS = 6;

interface WrittenFile {
  readonly path: string;
  readonly text: string;
  readonly executable: boolean;
}

export interface HarnessSize {
  readonly guide: number;
  readonly files: number;
  readonly lines: number;
}

interface QuotedSpan {
  readonly path: string;
  readonly line: number;
  readonly text: string;
  readonly tasks: readonly string[];
}

/** Nonblank line count of `body`. */
export const nonblank = (body: string): number =>
  body.split("\n").filter((line) => line.trim() !== "").length;

function resolved(path: string): string {
  const kept: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "..") kept.pop();
    else if (segment !== "." && segment !== "") kept.push(segment);
  }
  return kept.join("/");
}

function installedBy(files: readonly { readonly path: string }[], recordOf: (path: string) => string | null) {
  const paths = new Set<string>();
  const folders = new Set<string>();
  const marks = new Map(
    files.flatMap(({ path }) => {
      const segments = path.split("/");
      const at = segments.findIndex((seg, i) => i < segments.length - 1 && METADATA.test(seg));
      if (at === -1) return [];
      const folder = segments[at] ?? "";
      const site = segments
        .slice(0, at)
        .map((seg) => `${seg}/`)
        .join("");
      return [[`${site}${folder}/`, { site, name: folder.replace(PAST_NAME, "") }] as const];
    }),
  );
  for (const [meta, { site, name }] of marks) {
    folders.add(meta);
    const record = recordOf(`${meta}RECORD`) ?? recordOf(`${meta}installed-files.txt`);
    if (record === null) {
      const tops = recordOf(`${meta}top_level.txt`)
        ?.split("\n")
        .filter((line) => line.trim() !== "") ?? [name];
      for (const top of tops) {
        folders.add(`${site}${top.trim()}/`);
        paths.add(`${site}${top.trim()}.py`);
      }
      continue;
    }
    const from = meta.endsWith(".egg-info/") ? meta : site;
    for (const line of record.split("\n")) {
      const entry = line.startsWith('"') ? line.slice(1, line.indexOf('"', 1)) : (line.split(",")[0] ?? "");
      if (entry.trim() !== "") paths.add(resolved(`${from}${entry}`));
    }
  }
  return { paths, folders: [...folders] };
}

function filterOwn(
  files: readonly { readonly path: string; readonly bytes: number }[],
  recordOf: (path: string) => string | null,
): string[] {
  const installed = installedBy(files, recordOf);
  const homes = [
    ...new Set(files.map(({ path }) => path.slice(0, path.search(INTERPRETER_HOME) + 1))),
  ].filter(Boolean);
  return files
    .filter(
      ({ path, bytes }) =>
        bytes <= MAX_WRITTEN_BYTES &&
        !INSTALLED.test(path) &&
        !homes.some((home) => path.startsWith(home)) &&
        !WHEEL_LIBS.test(path) &&
        !installed.paths.has(path) &&
        !installed.folders.some((folder) => path.startsWith(folder)),
    )
    .map(({ path }) => path);
}

function dirMode(mode: "all" | "site" | "count", name: string): "all" | "site" | "count" {
  if (mode === "all") return SKIP_DIR.test(name) ? "count" : SITE_DIR.test(name) ? "site" : "all";
  return mode === "site" && METADATA.test(name) ? "all" : "count";
}

function walkTree(state: string, scope: "full" | "own") {
  const tree = join(state, TOOL_TREE_DIR);
  const empty: string[] = [];
  if (!existsSync(tree)) return { root: tree, paths: empty, brokenLinks: 0, treeFiles: 0 };
  const root = realpathSync(tree);
  const files: { path: string; bytes: number }[] = [];
  let [brokenLinks, treeFiles] = [0, 0];
  const walk = (dir: string, prefix: string, mode: "all" | "site" | "count"): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      treeFiles += 1;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const next = dirMode(mode, entry.name);
        if (next !== "count" || scope === "full") walk(full, join(prefix, entry.name), next);
      } else if (entry.isSymbolicLink() && !existsSync(full)) {
        brokenLinks += 1;
      } else if (mode === "all" && entry.isSymbolicLink()) {
        const target = realpathSync(full);
        if (target.startsWith(`${root}/`) && lstatSync(target).isFile()) {
          files.push({ path: join(prefix, entry.name), bytes: 0 });
        }
      } else if (mode === "all" && entry.isFile()) {
        files.push({ path: join(prefix, entry.name), bytes: lstatSync(full).size });
      }
    }
  };
  walk(root, "", "all");
  const recordOf = (path: string) =>
    existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null;
  return { root, paths: filterOwn(files, recordOf).toSorted(), brokenLinks, treeFiles };
}

/** Files a harness wrote under `.toolchain/`, excluding installed packages and binaries. */
export function ownFiles(state: string): { readonly root: string; readonly paths: readonly string[] } {
  return walkTree(state, "own");
}

/** Written files (programs + guide), broken link count, tree entry count, and line size of one harness. */
export function writtenFiles(state: string) {
  const { root, paths, brokenLinks, treeFiles } = walkTree(state, "full");
  const guideFile = join(state, GUIDE_PATH);
  const entries = [
    ...paths.map((path) => [path, join(root, path)] as const),
    ...(existsSync(guideFile) ? [["guide", guideFile] as const] : []),
  ];
  const written: WrittenFile[] = [];
  let [guide, lines] = [0, 0];
  for (const [path, file] of entries) {
    const [stat, text] = [lstatSync(file), readFileSync(file, "utf8")];
    if (path === "guide") guide = nonblank(text);
    else lines += nonblank(text);
    if (!stat.isSymbolicLink()) written.push({ path, text, executable: (stat.mode & 0o111) !== 0 });
  }
  const size = existsSync(state) ? { guide, files: paths.length, lines } : null;
  return { written, brokenLinks, treeFiles, size };
}

/** Property names in `answerFormat` (top-level and nested) of length >= `MIN_KEY_LEN`. */
export function formatKeys(node: JsonValue | undefined): string[] {
  const held = asRecord(node);
  if (held === null) return [];
  const own = Object.entries(asRecord(held.properties) ?? {}).flatMap(([key, value]) => [
    ...(key.length >= MIN_KEY_LEN ? [key] : []),
    ...formatKeys(value),
  ]);
  return [...own, ...formatKeys(held.items)];
}

/** Reads one harness directory for size, host-specific paths, and campaign details before `HOST_ONLY`. */
export function readHarnessFiles(
  stateDir: string,
  answerKeys: readonly string[],
  ruleIds: readonly string[],
) {
  const { written, brokenLinks, treeFiles, size } = writtenFiles(stateDir);
  let [hostPaths, hostShebangs, plainBins, filesWithKeys] = [0, 0, 0, 0];
  const matchedKeys = new Set<string>();
  for (const { path, text, executable } of written) {
    hostPaths += (text.match(HOST_PATH_RE) ?? []).length;
    hostShebangs += Number(HOST_SHEBANG_RE.test(text));
    plainBins += Number(path.startsWith("bin/") && !executable);
    const matched = answerKeys.filter((key) => text.includes(key));
    for (const key of matched) matchedKeys.add(key);
    filesWithKeys += Number(matched.length > 0);
  }
  const guideEntry = written.find(({ path }) => path === "guide");
  const kept = guideEntry === undefined ? "" : portableGuide(guideEntry.text);
  return {
    written,
    brokenLinks,
    treeFiles,
    size,
    hasSplit: guideEntry !== undefined && kept.length < guideEntry.text.length,
    keptLines: nonblank(kept),
    keptHostRefs: (kept.match(HOST_REF_RE) ?? []).length,
    keptFormatKeys: answerKeys.filter((key) => hasWholeToken(kept, key)).length,
    keptRuleIds: ruleIds.filter((id) => hasWholeToken(kept, id)).length,
    hostPaths,
    hostShebangs,
    plainBins,
    matchedKeys,
    filesWithKeys,
  };
}

/** Every string in a JSON public input, keys and values, at any depth. */
export function stringsIn(value: JsonValue | undefined): string[] {
  if (isString(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  const record = asRecord(value);
  return record === null ? [] : Object.entries(record).flatMap(([key, each]) => [key, ...stringsIn(each)]);
}

function wordsIn(text: string): { word: string; at: number }[] {
  return [...text.matchAll(WORD_RE)].map((match) => ({ word: match[0].toLowerCase(), at: match.index }));
}

/** Six-word spans of public inputs mapped to their tasks, dropping spans shared by every task. */
export function spansOf(tasks: readonly { readonly name: string; readonly strings: readonly string[] }[]) {
  const spans = new Map<string, Set<string>>();
  for (const { name, strings } of tasks) {
    for (const words of strings.map((text) => wordsIn(text).map(({ word }) => word))) {
      for (let from = 0; from + QUOTE_WORDS <= words.length; from += 1) {
        const span = words.slice(from, from + QUOTE_WORDS).join(" ");
        spans.set(span, (spans.get(span) ?? new Set()).add(name));
      }
    }
  }
  const everyone = new Set(tasks.map(({ name }) => name)).size;
  const common = everyone < 2 ? [] : [...spans].filter(([, holders]) => holders.size === everyone);
  for (const [span] of common) spans.delete(span);
  return { spans, common: common.length };
}

/** Verbatim public-input spans found in one written file, merged across overlapping windows. */
export function quotedSpans(
  path: string,
  text: string,
  spans: ReadonlyMap<string, ReadonlySet<string>>,
): QuotedSpan[] {
  const words = wordsIn(text);
  const plain = words.map(({ word }) => word);
  const hits: QuotedSpan[] = [];
  const tasks = new Set<string>();
  let from = -1;
  for (let at = 0; at <= plain.length; at += 1) {
    const holders = spans.get(plain.slice(at, at + QUOTE_WORDS).join(" "));
    if (holders !== undefined) {
      from = from === -1 ? at : from;
      for (const task of holders) tasks.add(task);
    } else if (from !== -1) {
      const line = text.slice(0, words[from]?.at ?? 0).split("\n").length;
      const span = plain.slice(from, at - 1 + QUOTE_WORDS).join(" ");
      hits.push({ path, line, text: span, tasks: [...tasks] });
      tasks.clear();
      from = -1;
    }
  }
  return hits;
}

/** Plain descriptions of harness files that name or quote released practice tasks. */
export function namedTasks(
  written: readonly WrittenFile[],
  tasks: readonly { readonly taskId: string; readonly publicInput: JsonValue }[],
): string[] {
  if (written.length === 0 || tasks.length === 0) return [];
  const { spans } = spansOf(
    tasks.map(({ taskId, publicInput }) => ({ name: taskId, strings: stringsIn(publicInput) })),
  );
  const found: string[] = [];
  for (const { path, text } of written) {
    const named = new Set(
      tasks.filter(({ taskId }) => taskId !== "" && hasWholeToken(text, taskId)).map(({ taskId }) => taskId),
    );
    const quoted = new Set(quotedSpans(path, text, spans).flatMap((hit) => hit.tasks));
    const both = [...new Set([...named, ...quoted])].toSorted();
    if (both.length === 0) continue;
    const verb = [named.size > 0 ? "names" : "", quoted.size > 0 ? "quotes" : ""]
      .filter(Boolean)
      .join(" and ");
    found.push(`${path} ${verb} ${both.join(", ")}`);
  }
  return found;
}
