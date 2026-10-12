/**
 * `GET /api/harness`, `/api/harness-file` and `/api/harness-diff`: a kept harness's `agent/`
 * subtree under the campaign's `states/<digest>/`, one file of it, and two of them compared, one
 * unified diff a file (the root package's `diff`).
 *
 * Nothing outside `agent/` is read: a harness's `correctness-model/` copy is the exam side's, and
 * its `.toolchain/` is a link into the host's store. A digest is one the log names as a harness and
 * a path segment with no separator. `states/<digest>/agent` must be a folder and no link, its real
 * path must be the real path of `states/<digest>` with `agent` after it, and that must lie under the
 * campaign's `states/` as resolved: a link at `agent` would serve whatever it points at in the
 * default tier, `correctness-model/` beside it for one (found by review, 11 October). A file path is
 * `agent/` and segments of plain characters, and once resolved through every link it has to lie
 * under that folder, as v1's read boundary held its paths (`safeRunPath`, v1
 * `packages/ui/src/server/files.ts`); a listing follows no link that leaves it. A file is read up
 * to `FILE_BYTES`. A refused or missing path is an issue the answer carries.
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
import { capturedJsonParse, capturedJsonStringify } from "../../../../src/meta/json-runtime.ts";
import { isString, type JsonValue } from "../../../../src/meta/json-shape.ts";
import { containsPath } from "../../../../src/meta/path-containment.ts";
import { isSafePathSegment } from "../../../../src/meta/path-segment.ts";
import { dirname, extname, join } from "../../../../src/meta/path.ts";
import { errorMessage } from "../../../../src/meta/runtime-values.ts";
import type { FileContent, HarnessDiff, HarnessFile, HarnessFiles, Issue, Query } from "../models.ts";
import type { Reading } from "./context.ts";
import type { Log } from "./folds.ts";
import { harnessesIn } from "./lineage.ts";
import { campaignAt, type Found } from "./logs.ts";

/** One file of an `agent/` folder: its path as the page names it, where it is, and its size. */
interface AgentFile {
  readonly path: string;
  readonly at: string;
  readonly bytes: number;
}

/** A harness's `agent/` folder as resolved, null where it is refused, and what was said. */
interface Rooted {
  readonly root: string | null;
  readonly issues: Issue[];
}

/** A file path resolved under `agent/`, or why it was refused. */
interface Resolved {
  readonly at: string | null;
  readonly why: string;
}

const AGENT = "agent";
/** The most of a file an answer carries: a guide or a tool list is a few kilobytes. */
const FILE_BYTES = 512 * 1024;
/** How deep and how many files a listing walks, so that a harness folder cannot hold the server. */
const DEPTH = 12;
const MOST_FILES = 400;
const SEGMENT = /^[A-Za-z0-9._-]+$/u;

function contentOf(path: string): FileContent {
  if (path.endsWith(".jsonl")) return "jsonl";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  return [".md", ".txt", ".log", ".yaml", ".yml", ""].includes(extname(path)) ? "text" : "other";
}

/** `path` with every link in it resolved, or null where nothing is there. */
function resolved(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    // A missing path, or a link whose target is missing: either is nothing to read.
    return null;
  }
}

/** The `agent/` folder of harness `digest` as resolved, or why it is refused. */
function agentRoot(
  found: Found,
  log: Log,
  digest: string,
): { readonly root: string | null; readonly issue: Issue | null } {
  const source = `states/${digest}/${AGENT}`;
  const refused = (message: string) => ({
    root: null,
    issue: { level: "error", source, message } satisfies Issue,
  });
  if (!isSafePathSegment(digest)) return refused("a digest is one path segment, and this is not");
  if (!harnessesIn(log).some((card) => card.digest === digest)) {
    return refused("the log names no harness by this digest, so nothing under states/ is read for it");
  }
  const states = join(dirname(found.path), "states");
  const dir = join(states, digest, AGENT);
  const [root, kept, own] = [resolved(dir), resolved(states), resolved(join(states, digest))];
  if (root === null || kept === null || own === null) {
    return refused("no such folder beside the log: the harness is not kept on this disk");
  }
  // A link at `agent` resolves somewhere else than its harness's own folder followed by `agent`,
  // so the one comparison refuses it with every other way out.
  return root === join(own, AGENT) && containsPath(root, kept)
    ? { root, issue: null }
    : refused("the folder is a link or resolves outside its harness's own folder, so it is not read");
}

/** Every file under `root`, walked through no link that leaves it. */
function walk(root: string, issues: Issue[]): AgentFile[] {
  const files: AgentFile[] = [];
  const visit = (dir: string, under: string, depth: number): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).toSorted((one, other) =>
      one.name.localeCompare(other.name),
    );
    for (const entry of entries) {
      if (files.length >= MOST_FILES || !SEGMENT.test(entry.name)) continue;
      const at = resolved(join(dir, entry.name));
      const path = `${under}/${entry.name}`;
      if (at === null || !containsPath(at, root)) {
        issues.push({ level: "warning", source: path, message: "a link that leaves agent/, not followed" });
        continue;
      }
      const stat = statSync(at);
      if (stat.isDirectory() && depth < DEPTH) visit(at, path, depth + 1);
      else if (stat.isFile()) files.push({ path, at, bytes: stat.size });
    }
  };
  visit(root, AGENT, 0);
  if (files.length >= MOST_FILES) {
    issues.push({
      level: "warning",
      source: AGENT,
      message: `listed the first ${String(MOST_FILES)} files only`,
    });
  }
  return files;
}

/** The file `path` names under `root`, or why it is refused. */
function fileAt(root: string, path: string): Resolved {
  const [first, ...rest] = path.split("/");
  if (
    first !== AGENT ||
    rest.length === 0 ||
    rest.some((each) => each === "." || each === ".." || !SEGMENT.test(each))
  ) {
    return {
      at: null,
      why: "a path is agent/ and segments of letters, digits, dots, dashes and underscores",
    };
  }
  const named = join(root, ...rest);
  const at = resolved(named);
  if (at === null) return { at: null, why: "no such file in this harness's agent/" };
  if (!containsPath(at, root) || !statSync(at).isFile()) {
    return { at: null, why: "the path leaves agent/ or is no file" };
  }
  return { at, why: "" };
}

/** The head of a file, `FILE_BYTES` at most, as text. */
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

/** The value of the file at `path`, of `bytes` bytes, as the inspector takes it: a whole JSON file
 *  parsed, and any other, or one cut at `FILE_BYTES`, as text. */
function valueOf(text: string, path: string, bytes: number): JsonValue {
  if (contentOf(path) !== "json" || bytes > FILE_BYTES) return text;
  try {
    return capturedJsonParse(text);
  } catch {
    // A file named .json that does not parse is shown as the text it is.
    return text;
  }
}

/** The text a diff compares of one file: its JSON pretty-printed, so a diff reads by lines. */
function diffText(file: AgentFile | undefined): string {
  if (file === undefined) return "";
  const text = headOf(file.at, file.bytes);
  const value = valueOf(text, file.path, file.bytes);
  return isString(value) ? text : `${capturedJsonStringify(value, null, 2)}\n`;
}

/** The campaign `key` names and the `agent/` folder of `digest` in it, with what was said of
 *  either. */
function rooted(reading: Reading, key: string, digest: string): Rooted {
  const { found, log, issues: read } = campaignAt(reading, key);
  const { root, issue } = agentRoot(found, log, digest);
  return { root, issues: issue === null ? [...read] : [...read, issue] };
}

export function harnessAnswer(reading: Reading, query: Query<"harness">): HarnessFiles {
  const { root, issues } = rooted(reading, query.key, query.digest);
  const files = root === null ? [] : walk(root, issues).map(({ path, bytes }) => ({ path, bytes }));
  return { tier: reading.tier, issues, files };
}

export function harnessFileAnswer(reading: Reading, query: Query<"harness-file">): HarnessFile {
  const { root, issues } = rooted(reading, query.key, query.digest);
  const file = root === null ? null : fileAt(root, query.path);
  const base = { tier: reading.tier, issues };
  if (file?.at == null) {
    if (file !== null) issues.push({ level: "error", source: query.path, message: file.why });
    return { ...base, content: "other", value: null, truncated: false, bytes: 0 };
  }
  try {
    const { size } = statSync(file.at);
    return {
      ...base,
      content: contentOf(query.path),
      value: valueOf(headOf(file.at, size), query.path, size),
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
    const { root, issue } = agentRoot(found, log, digest);
    if (issue !== null) issues.push(issue);
    return new Map((root === null ? [] : walk(root, issues)).map((file) => [file.path, file]));
  };
  const [a, b] = [listed(query.a), listed(query.b)];
  const paths = [...new Set([...a.keys(), ...b.keys()])].toSorted();
  const files = paths.flatMap((path) => {
    const [left, right] = [a.get(path), b.get(path)];
    const [before, after] = [diffText(left), diffText(right)];
    if (before === after) return [];
    const kept = right === undefined ? "removed" : "changed";
    const change = left === undefined ? "added" : kept;
    return [{ path, change, diff: createTwoFilesPatch(`a/${path}`, `b/${path}`, before, after) } as const];
  });
  return { tier: reading.tier, issues, files };
}
