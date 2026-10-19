/**
 * `GET /api/harness`, `/api/harness-file` and `/api/harness-diff`: a kept harness's folder,
 * `states/<digest>/` beside the campaign's log, whole, one file of it, and two of them compared,
 * one unified diff a file (the root package's `diff`).
 *
 * The listing is whatever the folder holds, so that a part the page has no name for is shown all
 * the same. Until 19 October it read `agent/` alone and left out `.toolchain/`, a link into the
 * host's store: but a Builder's programs are there, beside `states/` in a `tree-*` folder, and
 * the guide only names them. 0 of the 193 harnesses kept in this repository's worktrees from
 * 11 to 19 October declared a tool of its own in `agent/tools.ts`; each put its computation in
 * `.toolchain/bin/`, so the page showed a template with an empty list as the harness's tools, and
 * esp32-fresh-opus's E, which differs from its parent in one program, compared as unchanged.
 *
 * One name is closed wherever it stands: `correctness-model`, the exam side's copy that a harness
 * imported from v1 carries beside `agent/` and in each `.bundle-snapshots/` entry. Every other
 * path is open where, resolved through every link, it lies under the campaign's own `states/`
 * and passes through no closed name: a `.toolchain` link to the `tree-*` beside it is followed,
 * and one to the host's own toolchains, or into the exam side's copy by another name, is not and
 * is said. A digest is one the log names as a harness and a path segment with no separator, and
 * `states/<digest>` must resolve to itself: a link there would serve whatever it points at in the
 * default tier, `correctness-model/` beside it for one (found by review, 11 October). A listing
 * enters no folder twice, so a link back up ends there. A file is read up to `FILE_BYTES`, and
 * one whose head holds a NUL byte, an engine's binary, is listed and sent with no value. A
 * refused or missing path is an issue the answer carries.
 *
 * A diff is bounded in time as well as in bytes (`FILE_DIFF_MS`, `DIFF_MS`): its work grows with
 * how far apart two texts are and not with their size alone, and it runs on the thread that
 * answers every request. Two files of 8,000 one-character lines that share none took about 11
 * seconds in one call, well inside `FILE_BYTES` (the stack review of 12 October, finding 4). A file
 * the bound cuts is listed with no diff, and an issue names it. A path both harnesses reach as the
 * same file is not read.
 *
 * A program under `.toolchain/bin/` is listed with its own account of itself, the comment at its
 * head (`src/solve/programs.ts`): the page shows the solver's toolset by those, since the guide only
 * names them.
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
import { programsOf } from "../../../../src/solve/programs.ts";
import type { FileContent, HarnessDiff, HarnessFile, HarnessFiles, Issue, Query } from "../models.ts";
import type { Reading } from "./context.ts";
import type { Log } from "./folds.ts";
import { harnessesIn } from "./lineage.ts";
import { campaignAt, type Found } from "./logs.ts";

/** One file of a harness: its path as the page names it, where it is, and its size. */
interface HarnessPart {
  readonly path: string;
  readonly at: string;
  readonly bytes: number;
}

/** A harness's folder and the campaign's `states/`, as resolved: null where it is refused. */
interface Kept {
  readonly root: string;
  readonly states: string;
}

/** A harness's folder as resolved, null where it is refused, and what was said. */
interface Rooted {
  readonly kept: Kept | null;
  readonly issues: Issue[];
}

/** A file path resolved in a harness, or why it was refused. */
interface Resolved {
  readonly at: string | null;
  readonly why: string;
}

/** The exam side's copy a harness imported from v1 carries, closed at any depth. */
const CLOSED = "correctness-model";
/** The most of a file an answer carries: a guide or a program is a few kilobytes. */
const FILE_BYTES = 512 * 1024;
/** How deep and how many files a listing walks, so that a harness folder cannot hold the server. */
const DEPTH = 12;
const MOST_FILES = 400;
/** The most one file's diff may take, and the most one answer's diffs may take together: the
 *  library gives up past its `timeout` (`createTwoFilesPatch`). */
const FILE_DIFF_MS = 500;
const DIFF_MS = 2_000;
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

/** `path` with every link in it resolved, or null where nothing is there. */
function resolved(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    // A missing path, or a link whose target is missing: either is nothing to read.
    return null;
  }
}

/** Whether `at`, a resolved path, may be read: under `states` and through no closed name. */
function isOpen(at: string, states: string): boolean {
  return containsPath(at, states) && !at.slice(states.length).split("/").includes(CLOSED);
}

/** The folder of harness `digest` as resolved, or why it is refused. */
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
  // A link at `states/<digest>` resolves somewhere else than itself, so the one comparison
  // refuses it with every other way out.
  return root === join(states, digest)
    ? { kept: { root, states }, issue: null }
    : refused("the folder is a link or resolves outside states/, so it is not read");
}

/** Every file of a harness, walked through no link that leaves the campaign's `states/` or enters
 *  a closed name, and into no folder twice. */
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

/** The file `path` names in a harness, or why it is refused. */
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
 *  parsed, a binary nothing, and any other, or one cut at `FILE_BYTES`, as text. */
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

/** The text a diff compares of one file: its JSON pretty-printed, so a diff reads by lines. */
function diffText(file: HarnessPart | undefined): string {
  if (file === undefined) return "";
  const text = headOf(file.at, file.bytes);
  const value = valueOf(text, file.path, file.bytes);
  if (value === null) return `a binary file of ${String(file.bytes)} bytes, ${sha256(text)}\n`;
  return isString(value) ? text : `${capturedJsonStringify(value, null, 2)}\n`;
}

/** The campaign `key` names and the folder of harness `digest` in it, with what was said of
 *  either. */
function rooted(reading: Reading, key: string, digest: string): Rooted {
  const { found, log, issues: read } = campaignAt(reading, key);
  const { kept, issue } = harnessRoot(found, log, digest);
  return { kept, issues: issue === null ? [...read] : [...read, issue] };
}

export function harnessAnswer(reading: Reading, query: Query<"harness">): HarnessFiles {
  const { kept, issues } = rooted(reading, query.key, query.digest);
  if (kept === null) return { tier: reading.tier, issues, files: [] };
  // Each program's account, by the path the panel lists it at.
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
