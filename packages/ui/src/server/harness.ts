/**
 * `GET /api/harness`, `/api/harness-file` and `/api/harness-diff`: a kept harness's folder
 * (`states/<digest>/` beside the log) whole, one file of it, and two compared, one unified diff a
 * file. The listing is whatever the folder holds, `.toolchain/` included: a harness's programs live
 * in `.toolchain/bin/`, so `agent/` alone would hide its tools and its diffs. `correctness-model`,
 * the exam side's copy a v1 harness carries, is closed wherever it stands; every other path is open
 * where, resolved through every link, it lies under the campaign's `states/` and passes through no
 * closed name. A digest must be one the log names, a single path segment, and `states/<digest>`
 * must resolve to itself. A listing enters no folder twice; a file is read up to `FILE_BYTES`, and
 * one with a NUL byte in its head is listed with no value. A diff is bounded in time too
 * (`FILE_DIFF_MS`, `DIFF_MS`), since its work grows with how far apart two texts are and it runs on
 * the thread that answers every request; a file the bound cuts is listed with no diff and an issue.
 * A program is listed with its head comment (`src/harness/programs.ts`), since the guide only names
 * them.
 */
import { createTwoFilesPatch } from "diff";
import {
  closeSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
} from "../../../../src/meta/filesystem.ts";
import { TOOL_TREE_DIR } from "../../../../src/meta/bundle-layout.ts";
import { sha256 } from "../../../../src/meta/digest.ts";
import { capturedJsonParse, capturedJsonStringify } from "../../../../src/meta/json-runtime.ts";
import { isString, type JsonValue } from "../../../../src/meta/json-shape.ts";
import { containsPath } from "../../../../src/meta/path-containment.ts";
import { isSafePathSegment } from "../../../../src/meta/path-segment.ts";
import { dirname, extname, join, relative } from "../../../../src/meta/path.ts";
import { errorMessage } from "../../../../src/meta/runtime-values.ts";
import { programsOf } from "../../../../src/harness/programs.ts";
import type { FileContent, HarnessDiff, HarnessFile, HarnessFiles, Issue, Query } from "../models.ts";
import type { Reading } from "./context.ts";
import type { Log } from "./folds.ts";
import { harnessesIn } from "./lineage.ts";
import { campaignAt, type Found } from "./logs.ts";

interface HarnessPart {
  readonly path: string;
  readonly at: string;
  readonly bytes: number;
}

interface Kept {
  readonly root: string;
  readonly states: string;
}

interface Rooted {
  readonly kept: Kept | null;
  readonly issues: Issue[];
}

interface Resolved {
  readonly at: string | null;
  readonly why: string;
}

/** The exam side's copy a harness imported from v1 carries, closed at any depth. */
const CLOSED = "correctness-model";
const FILE_BYTES = 512 * 1024;
/** How deep and how many files a listing walks, so that a harness folder cannot hold the server. */
const DEPTH = 12;
const MOST_FILES = 400;
/** The most one file's diff may take, and the most one answer's diffs may take together; the
 *  library gives up past its `timeout`. */
const FILE_DIFF_MS = 500;
const DIFF_MS = 2000;
const SEGMENT = /^[A-Za-z0-9._-]+$/u;
/** The extensions read as text: a program under `.toolchain/bin` most often has none. */
const TEXT = new Set([".md", ".txt", ".log", ".yaml", ".yml", ".js", ".mjs", ".cjs", ".py", ".sh", ""]);
const NUL = 0;

function contentOf(path: string): FileContent {
  if (path.endsWith(".jsonl")) return "jsonl";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  return TEXT.has(extname(path)) ? "text" : "other";
}

function resolved(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function isOpen(at: string, states: string): boolean {
  return containsPath(at, states) && !at.slice(states.length).split("/").includes(CLOSED);
}

function harnessRoot(
  found: Found,
  log: Log,
  digest: string,
): { readonly kept: Kept | null; readonly issue: Issue | null } {
  const source = `states/${digest}`;
  const refused = (message: string) => ({
    kept: null,
    issue: { level: "error", source, message } satisfies Issue,
  });
  if (!isSafePathSegment(digest)) return refused("a digest is one path segment, and this is not");
  if (!harnessesIn(log).some((card) => card.digest === digest)) {
    return refused("the log names no harness by this digest, so nothing under states/ is read for it");
  }
  const named = join(dirname(found.path), "states");
  const [states, root] = [resolved(named), resolved(join(named, digest))];
  if (states === null || root === null) {
    return refused("no such folder beside the log: the harness is not kept on this disk");
  }
  // A link at `states/<digest>` resolves elsewhere, so this one comparison refuses it with every other
  // way out.
  return root === join(states, digest)
    ? { kept: { root, states }, issue: null }
    : refused("the folder is a link or resolves outside states/, so it is not read");
}

/** Every file of a harness, through no link that leaves `states/` or enters a closed name, and into
 *  no folder twice. */
function walk({ root, states }: Kept, issues: Issue[]): HarnessPart[] {
  const files: HarnessPart[] = [];
  const entered = new Set<string>([root]);
  const visit = (dir: string, under: string, depth: number): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).toSorted((one, other) =>
      one.name.localeCompare(other.name),
    );
    for (const entry of entries) {
      if (files.length >= MOST_FILES || entry.name === CLOSED || !SEGMENT.test(entry.name)) continue;
      const at = resolved(join(dir, entry.name));
      const path = under === "" ? entry.name : `${under}/${entry.name}`;
      if (at === null || !isOpen(at, states)) {
        issues.push({
          level: "warning",
          source: path,
          message:
            "a link that leaves the campaign's kept harnesses or enters the exam side's copy, not followed",
        });
        continue;
      }
      const stat = statSync(at);
      if (stat.isFile()) files.push({ path, at, bytes: stat.size });
      else if (stat.isDirectory() && depth < DEPTH && !entered.has(at)) {
        entered.add(at);
        visit(at, path, depth + 1);
      }
    }
  };
  visit(root, "", 0);
  if (files.length >= MOST_FILES) {
    issues.push({
      level: "warning",
      source: `states/${root.split("/").at(-1) ?? ""}`,
      message: `listed the first ${String(MOST_FILES)} files only`,
    });
  }
  return files;
}

function fileAt({ root, states }: Kept, path: string): Resolved {
  const segments = path.split("/");
  if (segments.some((each) => each === "." || each === ".." || !SEGMENT.test(each))) {
    return {
      at: null,
      why: "a path is segments of letters, digits, dots, dashes and underscores",
    };
  }
  const at = resolved(join(root, ...segments));
  if (at === null) return { at: null, why: "no such file in this harness" };
  if (!isOpen(at, states) || !statSync(at).isFile()) {
    return {
      at: null,
      why: "the path leaves the campaign's kept harnesses, enters the exam side's copy, or is no file",
    };
  }
  return { at, why: "" };
}

function headOf(at: string, bytes: number): string {
  const fd = openSync(at, "r");
  try {
    const buffer = Buffer.alloc(Math.min(bytes, FILE_BYTES));
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** The file's value as the inspector takes it: a whole JSON file parsed, a binary nothing, anything
 *  else (or a file cut at `FILE_BYTES`) as text. */
function valueOf(text: string, path: string, bytes: number): JsonValue {
  if (text.includes(String.fromCodePoint(NUL))) return null;
  if (contentOf(path) !== "json" || bytes > FILE_BYTES) return text;
  try {
    return capturedJsonParse(text);
  } catch {
    // A file named .json that does not parse is shown as the text it is.
    return text;
  }
}

function diffText(file: HarnessPart | undefined): string {
  if (file === undefined) return "";
  const text = headOf(file.at, file.bytes);
  const value = valueOf(text, file.path, file.bytes);
  if (value === null) return `a binary file of ${String(file.bytes)} bytes, ${sha256(text)}\n`;
  return isString(value) ? text : `${capturedJsonStringify(value, null, 2)}\n`;
}

function rooted(reading: Reading, key: string, digest: string): Rooted {
  const { found, log, issues: read } = campaignAt(reading, key);
  const { kept, issue } = harnessRoot(found, log, digest);
  return { kept, issues: issue === null ? [...read] : [...read, issue] };
}

export function harnessAnswer(reading: Reading, query: Query<"harness">): HarnessFiles {
  const { kept, issues } = rooted(reading, query.key, query.digest);
  if (kept === null) return { tier: reading.tier, issues, files: [] };
  const programs = programsOf(join(kept.root, TOOL_TREE_DIR));
  const about = new Map(programs.map(({ at, account }) => [relative(kept.root, at), account]));
  const files = walk(kept, issues).map(({ path, bytes }) => ({
    path,
    bytes,
    about: about.get(path) ?? null,
  }));
  return { tier: reading.tier, issues, files };
}

export function harnessFileAnswer(reading: Reading, query: Query<"harness-file">): HarnessFile {
  const { kept, issues } = rooted(reading, query.key, query.digest);
  const file = kept === null ? null : fileAt(kept, query.path);
  const base = { tier: reading.tier, issues };
  if (file?.at == null) {
    if (file !== null) issues.push({ level: "error", source: query.path, message: file.why });
    return { ...base, content: "other", value: null, truncated: false, bytes: 0 };
  }
  try {
    const { size } = statSync(file.at);
    const value = valueOf(headOf(file.at, size), query.path, size);
    return {
      ...base,
      content: value === null ? "other" : contentOf(query.path),
      value,
      truncated: size > FILE_BYTES,
      bytes: size,
    };
  } catch (error) {
    issues.push({ level: "error", source: query.path, message: errorMessage(error) });
    return { ...base, content: "other", value: null, truncated: false, bytes: 0 };
  }
}

export function harnessDiffAnswer(reading: Reading, query: Query<"harness-diff">): HarnessDiff {
  const { found, log, issues: read } = campaignAt(reading, query.key);
  const issues: Issue[] = [...read];
  const listed = (digest: string) => {
    const { kept, issue } = harnessRoot(found, log, digest);
    if (issue !== null) issues.push(issue);
    return new Map((kept === null ? [] : walk(kept, issues)).map((file) => [file.path, file]));
  };
  const [a, b] = [listed(query.a), listed(query.b)];
  const paths = [...new Set([...a.keys(), ...b.keys()])].toSorted();
  const deadline = Date.now() + DIFF_MS;
  const files = paths.flatMap((path) => {
    const [left, right] = [a.get(path), b.get(path)];
    if (left !== undefined && left.at === right?.at) return [];
    const [before, after] = [diffText(left), diffText(right)];
    if (before === after) return [];
    const kept = right === undefined ? "removed" : "changed";
    const change = left === undefined ? "added" : kept;
    const timeout = Math.min(FILE_DIFF_MS, deadline - Date.now());
    const diff =
      timeout > 0
        ? createTwoFilesPatch(`a/${path}`, `b/${path}`, before, after, undefined, undefined, { timeout })
        : undefined;
    if (diff === undefined) {
      issues.push({
        level: "warning",
        source: path,
        message: `not diffed: a file's diff may take ${String(FILE_DIFF_MS)} ms and an answer's diffs ${String(DIFF_MS)} ms together, and this one did not finish within what was left`,
      });
    }
    return [{ path, change, diff: diff ?? null } as const];
  });
  return { tier: reading.tier, issues, files };
}
