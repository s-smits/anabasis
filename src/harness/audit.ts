/**
 * Single production owner for static harness-tree auditing: own-file discovery (excluding installed
 * interpreters, packages, and binaries), guide/tool weight, portability hazards, `HOST_ONLY` leak
 * checks, and shared public-input phrase matching.
 *
 * Shared by Builder's `check_harness` (`src/builder/tools.ts`, wall-safe against released practice
 * tasks and the public contract) and WRI readers (`tools/wri/{trajectory,portability,names,
 * diagnostics,provenance}.ts`).
 */
import { AGENT_DIR, GUIDE_FILE, TOOL_TREE_DIR } from "../meta/bundle-layout.ts";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "../meta/filesystem.ts";
import { asRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { hasWholeToken } from "../meta/text.ts";
import { portableGuide } from "./starter.ts";

/** Path segments of what a harness installed rather than wrote. A folder named `python` is none: a
 *  harness keeps its own modules in `lib/python/`, and an interpreter's home goes by `HOME`. */
const INSTALLED = /(^|\/)(site-packages|dist-packages|node_modules|\.?venv|vendor|include|__pycache__)(\/|$)/;
const SKIP_DIR = /^(?:node_modules|\.?venv|vendor|include|__pycache__)$/;
const SITE_DIR = /^(?:site|dist)-packages$/;
/** A bundled interpreter's home, known by the library folder its build lays out. */
const HOME = /\/lib\/python\d[\d.]*\//;
/** An installed package's metadata folder, and what follows its package's name in that folder's name. */
const METADATA = /\.(?:dist-info|egg-info)$/;
const PAST_NAME = /(?:-[^/]*)?\.(?:dist-info|egg-info)$/;
/** A wheel's folder of bundled shared libraries, written whole by the installer. */
const LIBS = /(^|\/)[^/]+\.libs\//;
/** A program a harness wrote is shorter than this; an interpreter or a library's binary is not. */
const WRITTEN_BYTES = 256 * 1024;
const GUIDE_PATH = `${AGENT_DIR}${GUIDE_FILE}`;
/** Hardcoded host-environment or Anabasis-internal path prefixes that break external transfer. */
const HOST_PATH_RE = /(?:\/Users\/|\/home\/|\/opt\/homebrew\/|\/private\/tmp\/|\/var\/folders\/|\.ana\/)/gu;
/** Absolute-path shebangs that fail across OSes/hosts (portable ones use `#!/usr/bin/env` or `/bin/sh`). */
const BAD_SHEBANG_RE = /^#!\s*\/(?:Users|home|opt\/homebrew|Library)\//u;
/** Campaign-only mechanics that belong strictly below `HOST_ONLY` (`## Validity and score`). */
const PORTABLE_LEAK_RE =
  /(?:public\/task\.json|public\/files\/|public\/resources\/|answer\.json|\bsubmit\b)/gu;
const MIN_KEY_LEN = 4;
const PLAIN = /[\p{L}\p{N}]+/gu;
/** Word span length used for verbatim public-input phrase detection. */
export const PHRASE_WORDS = 6;

interface WrittenAuditFile {
  readonly path: string;
  readonly text: string;
  readonly executable: boolean;
}

export interface HarnessWeight {
  readonly guide: number;
  readonly files: number;
  readonly lines: number;
}

interface HarnessAudit {
  readonly written: readonly WrittenAuditFile[];
  readonly brokenLinks: number;
  readonly toolTreeFiles: number;
  readonly weight: HarnessWeight | null;
  readonly hasHostOnly: boolean;
  readonly portableLines: number;
  readonly aboveLeaks: number;
  readonly aboveKeys: number;
  readonly aboveRules: number;
  readonly hostPathHits: number;
  readonly badShebangs: number;
  readonly nonExecBins: number;
  readonly matchedKeys: ReadonlySet<string>;
  readonly filesWithExamKeys: number;
}

interface PhraseMatch {
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

function ownPrograms(
  files: readonly { readonly path: string; readonly bytes: number }[],
  recordOf: (path: string) => string | null,
): string[] {
  const installed = installedBy(files, recordOf);
  const homes = [...new Set(files.map(({ path }) => path.slice(0, path.search(HOME) + 1)))].filter(Boolean);
  return files
    .filter(
      ({ path, bytes }) =>
        bytes <= WRITTEN_BYTES &&
        !INSTALLED.test(path) &&
        !homes.some((home) => path.startsWith(home)) &&
        !LIBS.test(path) &&
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
  if (!existsSync(tree)) return { root: tree, paths: empty, brokenLinks: 0, toolTreeFiles: 0 };
  const root = realpathSync(tree);
  const files: { path: string; bytes: number }[] = [];
  let [brokenLinks, toolTreeFiles] = [0, 0];
  const walk = (dir: string, prefix: string, mode: "all" | "site" | "count"): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      toolTreeFiles += 1;
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
  return { root, paths: ownPrograms(files, recordOf).toSorted(), brokenLinks, toolTreeFiles };
}

/** The programs a kept harness wrote, under the real root of its tool tree. */
export function ownFilesOf(state: string): { readonly root: string; readonly paths: readonly string[] } {
  return walkTree(state, "own");
}

/** Static file inventory and weight of one harness state directory. */
export function stateAuditFiles(state: string) {
  const { root, paths, brokenLinks, toolTreeFiles } = walkTree(state, "full");
  const guideFile = join(state, GUIDE_PATH);
  const entries = [
    ...paths.map((path) => [path, join(root, path)] as const),
    ...(existsSync(guideFile) ? [["guide", guideFile] as const] : []),
  ];
  const written: WrittenAuditFile[] = [];
  let [guide, lines] = [0, 0];
  for (const [path, file] of entries) {
    const [stat, text] = [lstatSync(file), readFileSync(file, "utf8")];
    if (path === "guide") guide = nonblank(text);
    else lines += nonblank(text);
    if (!stat.isSymbolicLink()) written.push({ path, text, executable: (stat.mode & 0o111) !== 0 });
  }
  const weight = existsSync(state) ? { guide, files: paths.length, lines } : null;
  return { written, brokenLinks, toolTreeFiles, weight };
}

/** Top-level and nested `answerFormat` property keys of length >= `MIN_KEY_LEN`. */
export function schemaKeys(node: JsonValue | undefined): string[] {
  const held = asRecord(node);
  if (held === null) return [];
  const own = Object.entries(asRecord(held.properties) ?? {}).flatMap(([key, value]) => [
    ...(key.length >= MIN_KEY_LEN ? [key] : []),
    ...schemaKeys(value),
  ]);
  return [...own, ...schemaKeys(held.items)];
}

/** Audits one harness state for portability hazards, `HOST_ONLY` split, exam-key coupling, and weight. */
export function auditHarnessState(
  stateDir: string,
  answerKeys: readonly string[],
  ruleIds: readonly string[],
): HarnessAudit {
  const { written, brokenLinks, toolTreeFiles, weight } = stateAuditFiles(stateDir);
  let [hostPathHits, badShebangs, nonExecBins, filesWithExamKeys] = [0, 0, 0, 0];
  const matchedKeys = new Set<string>();
  for (const { path, text, executable } of written) {
    hostPathHits += (text.match(HOST_PATH_RE) ?? []).length;
    badShebangs += Number(BAD_SHEBANG_RE.test(text));
    nonExecBins += Number(path.startsWith("bin/") && !executable);
    const matched = answerKeys.filter((key) => text.includes(key));
    for (const key of matched) matchedKeys.add(key);
    filesWithExamKeys += Number(matched.length > 0);
  }
  const guideEntry = written.find(({ path }) => path === "guide");
  const portable = guideEntry === undefined ? "" : portableGuide(guideEntry.text);
  const hasHostOnly = guideEntry !== undefined && portable.length < guideEntry.text.length;
  const portableLines = nonblank(portable);
  const aboveLeaks = (portable.match(PORTABLE_LEAK_RE) ?? []).length;
  const aboveKeys = answerKeys.filter((key) => hasWholeToken(portable, key)).length;
  const aboveRules = ruleIds.filter((id) => hasWholeToken(portable, id)).length;
  return {
    written,
    brokenLinks,
    toolTreeFiles,
    weight,
    hasHostOnly,
    portableLines,
    aboveLeaks,
    aboveKeys,
    aboveRules,
    hostPathHits,
    badShebangs,
    nonExecBins,
    matchedKeys,
    filesWithExamKeys,
  };
}

/** Every string of a JSON public input, keys and values, at any depth. */
export function stringsIn(value: JsonValue | undefined): string[] {
  if (isString(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  const record = asRecord(value);
  return record === null ? [] : Object.entries(record).flatMap(([key, each]) => [key, ...stringsIn(each)]);
}

/** The words of a text as a phrase is matched: lower-cased runs of letters and digits with offsets. */
function plainWords(text: string): { word: string; at: number }[] {
  return [...text.matchAll(PLAIN)].map((match) => ({ word: match[0].toLowerCase(), at: match.index }));
}

/** Six-word spans of public inputs mapped to the tasks holding each, dropping spans common to all. */
export function spansOf(tasks: readonly { readonly name: string; readonly strings: readonly string[] }[]) {
  const spans = new Map<string, Set<string>>();
  for (const { name, strings } of tasks) {
    for (const words of strings.map((text) => plainWords(text).map(({ word }) => word))) {
      for (let from = 0; from + PHRASE_WORDS <= words.length; from += 1) {
        const span = words.slice(from, from + PHRASE_WORDS).join(" ");
        spans.set(span, (spans.get(span) ?? new Set()).add(name));
      }
    }
  }
  const everyone = new Set(tasks.map(({ name }) => name)).size;
  const common = everyone < 2 ? [] : [...spans].filter(([, holders]) => holders.size === everyone);
  for (const [span] of common) spans.delete(span);
  return { spans, common: common.length };
}

/** Verbatim public-input phrases in one written file, merged across overlapping windows. */
export function phrasesIn(
  path: string,
  text: string,
  spans: ReadonlyMap<string, ReadonlySet<string>>,
): PhraseMatch[] {
  const words = plainWords(text);
  const plain = words.map(({ word }) => word);
  const hits: PhraseMatch[] = [];
  const tasks = new Set<string>();
  let from = -1;
  for (let at = 0; at <= plain.length; at += 1) {
    const holders = spans.get(plain.slice(at, at + PHRASE_WORDS).join(" "));
    if (holders !== undefined) {
      from = from === -1 ? at : from;
      for (const task of holders) tasks.add(task);
    } else if (from !== -1) {
      const line = text.slice(0, words[from]?.at ?? 0).split("\n").length;
      const span = plain.slice(from, at - 1 + PHRASE_WORDS).join(" ");
      hits.push({ path, line, text: span, tasks: [...tasks] });
      tasks.clear();
      from = -1;
    }
  }
  return hits;
}

/** Compact wall-safe notes where harness files name or verbatim-copy released practice tasks only. */
export function practiceCopyHits(
  written: readonly WrittenAuditFile[],
  tasks: readonly { readonly taskId: string; readonly publicInput: JsonValue }[],
): string[] {
  if (written.length === 0 || tasks.length === 0) return [];
  const { spans } = spansOf(
    tasks.map(({ taskId, publicInput }) => ({ name: taskId, strings: stringsIn(publicInput) })),
  );
  const notes: string[] = [];
  for (const { path, text } of written) {
    const named = new Set(
      tasks.filter(({ taskId }) => taskId !== "" && hasWholeToken(text, taskId)).map(({ taskId }) => taskId),
    );
    const copied = new Set(phrasesIn(path, text, spans).flatMap((hit) => hit.tasks));
    const both = [...new Set([...named, ...copied])].toSorted();
    if (both.length === 0) continue;
    const kinds = [...(named.size > 0 ? ["names"] : []), ...(copied.size > 0 ? ["copies"] : [])].join("/");
    notes.push(`${path} (${kinds} ${both.join(", ")})`);
  }
  return notes;
}
