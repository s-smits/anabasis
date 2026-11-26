import { AGENT_DIR, GUIDE_FILE, TOOL_TREE_DIR } from "../meta/bundle-layout.ts";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "../meta/filesystem.ts";
import { asRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { hasWholeToken } from "../meta/text.ts";
import { portableGuide } from "./starter.ts";

const INSTALLED = /(^|\/)(site-packages|dist-packages|node_modules|\.?venv|vendor|include|__pycache__)(\/|$)/;
const SKIP_DIR = /^(?:node_modules|\.?venv|vendor|include|__pycache__)$/;
const SITE_DIR = /^(?:site|dist)-packages$/;
const INTERPRETER_HOME = /\/lib\/python\d[\d.]*\//;
const PYTHON_LIB = /^python\d[\d.]*$/;
const METADATA = /\.(?:dist-info|egg-info)$/;
const PAST_NAME = /(?:-[^/]*)?\.(?:dist-info|egg-info)$/;
const WHEEL_LIBS = /(^|\/)[^/]+\.libs\//;
const MAX_WRITTEN_BYTES = 256 * 1024;
const GUIDE_PATH = `${AGENT_DIR}${GUIDE_FILE}`;
const HOST_PATH_RE = /(?:\/Users\/|\/home\/|\/opt\/homebrew\/|\/private\/tmp\/|\/var\/folders\/|\.ana\/)/gu;
const HOST_SHEBANG_RE = /^#!\s*\/(?:Users|home|opt\/homebrew|Library)\//u;
const CAMPAIGN_FILE_RE = /public\/(?:task\.json|files\/|resources\/)|answer\.json/gu;
const HOST_REF_RE = new RegExp(`${CAMPAIGN_FILE_RE.source}|\\bsubmit\\b`, "gu");
const MIN_KEY_LEN = 4;
const WORD_RE = /[\p{L}\p{N}]+/gu;
const TOKEN_RE = /[\p{L}\p{N}_](?:[\p{L}\p{N}_.:-]*[\p{L}\p{N}_])?/gu;
const TASK_CODE_RE = /^[A-Za-z][A-Za-z0-9_-]*[-_]\d{2,}$/;
export const QUOTE_WORDS = 6;
const BUILDER_QUOTE_WORDS = 8;
const RARE_TASKS = 2;

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

interface TaskStrings {
  readonly name: string;
  readonly strings: readonly string[];
}

type MetadataMarks = ReadonlyMap<string, { readonly site: string; readonly name: string }>;

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

function installedBy(marks: MetadataMarks, recordOf: (path: string) => string | null) {
  const paths = new Set<string>();
  const folders = new Set<string>();
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
  marks: MetadataMarks,
  recordOf: (path: string) => string | null,
): string[] {
  const installed = installedBy(marks, recordOf);
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

function isInterpreterHome(dir: string): boolean {
  const lib = join(dir, "lib");
  if (!existsSync(lib) || !lstatSync(lib).isDirectory()) return false;
  return readdirSync(lib, { withFileTypes: true }).some(
    (entry) =>
      entry.isDirectory() && PYTHON_LIB.test(entry.name) && readdirSync(join(lib, entry.name)).length > 0,
  );
}

function dirMode(mode: "all" | "site" | "count", name: string, child: string): "all" | "site" | "count" {
  if (mode !== "all") return "count";
  if (SKIP_DIR.test(name) || name.endsWith(".libs") || METADATA.test(name) || isInterpreterHome(child)) {
    return "count";
  }
  return SITE_DIR.test(name) ? "site" : "all";
}

function walkTree(state: string, scope: "full" | "own") {
  const tree = join(state, TOOL_TREE_DIR);
  const empty: string[] = [];
  if (!existsSync(tree)) return { root: tree, paths: empty, brokenLinks: 0, treeFiles: 0 };
  const root = realpathSync(tree);
  const files: { path: string; bytes: number }[] = [];
  const marks = new Map<string, { readonly site: string; readonly name: string }>();
  let [brokenLinks, treeFiles] = [0, 0];
  const walk = (dir: string, prefix: string, mode: "all" | "site" | "count"): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      treeFiles += 1;
      if (entry.isDirectory()) {
        const child = join(dir, entry.name);
        if (mode !== "count" && METADATA.test(entry.name)) {
          const site = prefix === "" ? "" : `${prefix}/`;
          marks.set(`${site}${entry.name}/`, { site, name: entry.name.replace(PAST_NAME, "") });
        }
        const next = dirMode(mode, entry.name, child);
        if (next !== "count" || scope === "full") {
          walk(child, next === "count" ? "" : join(prefix, entry.name), next);
        }
      } else if (entry.isSymbolicLink() && !existsSync(join(dir, entry.name))) {
        brokenLinks += 1;
      } else if (mode === "all" && entry.isSymbolicLink()) {
        const target = realpathSync(join(dir, entry.name));
        if (target.startsWith(`${root}/`) && lstatSync(target).isFile()) {
          files.push({ path: join(prefix, entry.name), bytes: 0 });
        }
      } else if (mode === "all" && entry.isFile()) {
        files.push({ path: join(prefix, entry.name), bytes: lstatSync(join(dir, entry.name)).size });
      }
    }
  };
  walk(root, "", "all");
  const recordOf = (path: string) =>
    existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null;
  return { root, paths: filterOwn(files, marks, recordOf).toSorted(), brokenLinks, treeFiles };
}

export const ownFiles = (state: string): { readonly root: string; readonly paths: readonly string[] } =>
  walkTree(state, "own");

export function writtenFiles(state: string, scope: "full" | "own" = "full") {
  const { root, paths, brokenLinks, treeFiles } = walkTree(state, scope);
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

export function formatKeys(node: JsonValue | undefined): string[] {
  const held = asRecord(node);
  if (held === null) return [];
  const own = Object.entries(asRecord(held.properties) ?? {}).flatMap(([key, value]) => [
    ...(key.length >= MIN_KEY_LEN ? [key] : []),
    ...formatKeys(value),
  ]);
  return [...own, ...formatKeys(held.items)];
}

export function readHarnessFiles(
  stateDir: string,
  answerKeys: readonly string[],
  ruleIds: readonly string[],
) {
  const { written, brokenLinks, treeFiles, size } = writtenFiles(stateDir);
  let [hostPaths, hostShebangs, plainBins, filesWithKeys, campaignRefs] = [0, 0, 0, 0, 0];
  const matchedKeys = new Set<string>();
  const campaignRefFiles: string[] = [];
  for (const { path, text, executable } of written) {
    hostPaths += (text.match(HOST_PATH_RE) ?? []).length;
    hostShebangs += Number(HOST_SHEBANG_RE.test(text));
    plainBins += Number(path.startsWith("bin/") && !executable);
    if (path !== "guide") {
      const refs = (text.match(CAMPAIGN_FILE_RE) ?? []).length;
      campaignRefs += refs;
      if (refs > 0) campaignRefFiles.push(path);
    }
    const matched = answerKeys.filter((key) => text.includes(key));
    for (const key of matched) matchedKeys.add(key);
    filesWithKeys += Number(matched.length > 0);
  }
  const guideEntry = written.find(({ path }) => path === "guide");
  const kept = guideEntry === undefined ? "" : portableGuide(guideEntry.text);
  const keptHostRefMatches = kept.match(HOST_REF_RE) ?? [];
  const keptHostRefNames = [...new Set(keptHostRefMatches)].toSorted();
  const keptFormatKeyNames = answerKeys.filter((key) => hasWholeToken(kept, key)).toSorted();
  const keptRuleIdNames = ruleIds.filter((id) => hasWholeToken(kept, id)).toSorted();
  return {
    written,
    brokenLinks,
    treeFiles,
    size,
    hasSplit: guideEntry !== undefined && kept.length < guideEntry.text.length,
    keptLines: nonblank(kept),
    keptHostRefs: keptHostRefMatches.length,
    keptHostRefNames,
    keptFormatKeys: keptFormatKeyNames.length,
    keptFormatKeyNames,
    keptRuleIds: keptRuleIdNames.length,
    keptRuleIdNames,
    hostPaths,
    hostShebangs,
    plainBins,
    campaignRefs,
    campaignRefFiles: campaignRefFiles.toSorted(),
    matchedKeys,
    filesWithKeys,
  };
}

export function stringsIn(value: JsonValue | undefined): string[] {
  if (isString(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  const record = asRecord(value);
  return record === null
    ? []
    : Object.entries(record).flatMap(([key, each]) => (key === "base64" ? [key] : [key, ...stringsIn(each)]));
}

const wordsOf = (text: string): string[] => text.toLowerCase().match(WORD_RE) ?? [];

function bigramIndex(wanted: ReadonlySet<string> | null, length: number) {
  if (wanted === null || length < 2) return null;
  const pairs = new Map<string, Set<string>>();
  for (const span of wanted) {
    const [first = "", second = ""] = span.split(" ", 2);
    pairs.set(first, (pairs.get(first) ?? new Set()).add(second));
  }
  return pairs;
}

export function spansOf(
  tasks: readonly TaskStrings[],
  length = QUOTE_WORDS,
  wanted: ReadonlySet<string> | null = null,
) {
  const spans = new Map<string, Set<string>>();
  if (wanted?.size === 0) return { spans, common: 0 };
  const pairs = bigramIndex(wanted, length);
  const streams = tasks.flatMap(({ name, strings }) => strings.map((text) => [name, wordsOf(text)] as const));
  for (const [name, words] of streams) {
    for (let from = 0; from + length <= words.length; from += 1) {
      if (pairs !== null && pairs.get(words[from] ?? "")?.has(words[from + 1] ?? "") !== true) continue;
      const span = words.slice(from, from + length).join(" ");
      if (wanted === null || wanted.has(span)) spans.set(span, (spans.get(span) ?? new Set()).add(name));
    }
  }
  const everyone = new Set(tasks.map(({ name }) => name)).size;
  const common = everyone < 2 ? [] : [...spans].filter(([, holders]) => holders.size === everyone);
  for (const [span] of common) spans.delete(span);
  return { spans, common: common.length };
}

export function quotedSpans(
  path: string,
  text: string,
  spans: ReadonlyMap<string, ReadonlySet<string>>,
  length = QUOTE_WORDS,
): QuotedSpan[] {
  if (spans.size === 0) return [];
  const starts = new Set([...spans.keys()].map((span) => span.split(" ", 1)[0] ?? ""));
  const words = [...text.matchAll(WORD_RE)].map((match) => ({
    word: match[0].toLowerCase(),
    at: match.index,
  }));
  const plain = words.map(({ word }) => word);
  const hits: QuotedSpan[] = [];
  const tasks = new Set<string>();
  let from = -1;
  for (let at = 0; at <= plain.length; at += 1) {
    const holders =
      at + length <= plain.length && starts.has(plain[at] ?? "")
        ? spans.get(plain.slice(at, at + length).join(" "))
        : undefined;
    if (holders !== undefined) {
      from = from === -1 ? at : from;
      for (const task of holders) tasks.add(task);
    } else if (from !== -1) {
      const line = text.slice(0, words[from]?.at ?? 0).split("\n").length;
      const span = plain.slice(from, at - 1 + length).join(" ");
      hits.push({ path, line, text: span, tasks: [...tasks] });
      tasks.clear();
      from = -1;
    }
  }
  return hits;
}

function rareCodes(tasks: readonly TaskStrings[], wanted: ReadonlySet<string> | null = null) {
  const codes = new Map<string, Set<string>>();
  if (wanted?.size === 0) return codes;
  for (const { name, strings } of tasks) {
    for (const token of strings.flatMap((text) => text.match(TOKEN_RE) ?? [])) {
      if (token !== name && (wanted === null ? TASK_CODE_RE.test(token) : wanted.has(token))) {
        codes.set(token, (codes.get(token) ?? new Set()).add(name));
      }
    }
  }
  return new Map([...codes].filter(([, holders]) => holders.size <= RARE_TASKS));
}

function codeHitsIn(path: string, text: string, codes: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  if (codes.size === 0) return [];
  const seen = new Set<string>();
  const hits: string[] = [];
  for (const [at, line] of text.split("\n").entries()) {
    for (const token of line.match(TOKEN_RE) ?? []) {
      if (seen.has(token)) continue;
      const holders = codes.get(token);
      if (holders === undefined) continue;
      seen.add(token);
      hits.push(`${path}:${String(at + 1)} uses code "${token}" from ${[...holders].toSorted().join(", ")}`);
    }
  }
  return hits;
}

export function namedTasks(
  written: readonly WrittenFile[],
  tasks: readonly { readonly taskId: string; readonly publicInput: JsonValue }[],
): string[] {
  if (written.length === 0 || tasks.length === 0) return [];
  const wantedSpans = new Set<string>();
  const wantedCodes = new Set<string>();
  for (const { text } of written) {
    const words = wordsOf(text);
    for (let from = 0; from + BUILDER_QUOTE_WORDS <= words.length; from += 1) {
      wantedSpans.add(words.slice(from, from + BUILDER_QUOTE_WORDS).join(" "));
    }
    for (const token of text.match(TOKEN_RE) ?? []) {
      if (TASK_CODE_RE.test(token)) wantedCodes.add(token);
    }
  }
  const inputs = tasks.map(({ taskId, publicInput }) => ({ name: taskId, strings: stringsIn(publicInput) }));
  const { spans } = spansOf(inputs, BUILDER_QUOTE_WORDS, wantedSpans);
  const rare = new Map([...spans].filter(([, holders]) => holders.size <= RARE_TASKS));
  const codes = rareCodes(inputs, wantedCodes);
  const found: string[] = [];
  for (const { path, text } of written) {
    const named = tasks
      .filter(({ taskId }) => taskId !== "" && hasWholeToken(text, taskId))
      .map(({ taskId }) => taskId)
      .toSorted();
    if (named.length > 0) found.push(`${path} names ${named.join(", ")}`);
    found.push(...codeHitsIn(path, text, codes));
    for (const hit of quotedSpans(path, text, rare, BUILDER_QUOTE_WORDS)) {
      found.push(`${path}:${String(hit.line)} quotes ${hit.tasks.toSorted().join(", ")} ("${hit.text}")`);
    }
  }
  return found;
}
