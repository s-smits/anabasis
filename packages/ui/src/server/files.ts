import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
} from "../../../../src/meta/filesystem.ts";
import { boundText } from "../../../../src/meta/bounded-text.ts";
import { dirname, extname, join, relative, resolve, sep } from "../../../../src/meta/path.ts";
import {
  BUNDLE_SNAPSHOT_DIRECTORY,
  EARLIER_BUNDLE_SNAPSHOT_DIRECTORY,
} from "../../../../src/claim/bundle-snapshot.ts";
import type { EvidenceIssue, FilePayload, FileRef } from "../models.js";
import { type JsonValue } from "../../../../src/meta/json-shape.ts";
import { SOLVABILITY_EVIDENCE_FILE } from "../../../../src/run/solvability-gate.ts";
import { readJsonFile } from "../../../../src/meta/completed-json.ts";

const READ_ROOTS = new Set(["campaigns", "domains", "scratchpad"]);
const SEGMENT = /^[A-Za-z0-9._-]+$/;
const WALK_EXCLUDED_DIRECTORIES = new Set([".git"]);
const MAX_DISPLAY_BYTES = 2_000_000;

/**
 * A refused path is not an absent record.
 *
 * `safeRunPath` returns null for a path the read boundary will not open, and a canonical path for a
 * record that simply is not there. Collapsing both into a silent null made a whole workspace read as
 * empty with nothing said: in a run worktree whose `campaigns` is a symlink to another checkout,
 * every controller record is refused as an escape, and the pages rendered "no opening record",
 * "no authoring record", "no gate records" as if the run had produced none of it.
 */
const REFUSED_MESSAGE =
  "The path lies outside the observatory's read boundary, so nothing was read. This is a refusal rather than a missing record; a symlinked campaigns or domains directory is the usual cause.";

function normalizedRelative(repoRoot: string, absolute: string): string {
  return relative(repoRoot, absolute).split(sep).join("/");
}

export function safeRunPath(repoRoot: string, requested: string): string | null {
  const normalized = requested.replaceAll("\\", "/").replace(/^\/+/, "");
  const segments = normalized.split("/");
  if (
    segments.length < 2 ||
    !READ_ROOTS.has(segments[0] ?? "") ||
    segments.some((segment) => segment === "" || segment === ".." || !SEGMENT.test(segment))
  ) {
    return null;
  }
  const root = realpathSync(repoRoot);
  const candidate = resolve(root, ...segments);
  const lexical = relative(root, candidate);
  if (lexical === ".." || lexical.startsWith(`..${sep}`)) return null;
  let existingAncestor = candidate;
  while (!existsSync(existingAncestor) && existingAncestor !== root) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) return null;
    existingAncestor = parent;
  }
  const canonical = resolve(realpathSync(existingAncestor), relative(existingAncestor, candidate));
  // Authorisation, protection classification and reading use this same target, not its alias.
  const collection = normalizedRelative(root, canonical).split("/")[0] ?? "";
  return READ_ROOTS.has(collection) ? canonical : null;
}

function contentKind(path: string): FileRef["content"] {
  if (path.endsWith(".jsonl")) return "jsonl";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if ([".md", ".txt", ".log"].includes(extname(path))) return "text";
  return "other";
}

function fileCategory(path: string): FileRef["category"] {
  if (path.includes("/observability/")) return "observation";
  if (path.endsWith("/iteration.json")) return "iteration";
  if (/\/(census|conformance|solvability)\.json$/.test(path)) return "gate";
  if (path.includes("/cases/")) {
    if (path.endsWith("/trace.json")) return "trace";
    if (path.endsWith("/judge.json")) return "judge";
    return "case";
  }
  if (path.includes("/judge/")) return "judge";
  if (path.includes("/claims/")) return "claim";
  if (path.includes("/analysis/")) return "analysis";
  if (path.includes("/promotions/") || path.includes("/candidates/")) return "promotion";
  if (
    path.includes("/agent/") ||
    path.includes("/correctness-model/") ||
    path.includes(`/${BUNDLE_SNAPSHOT_DIRECTORY}/`) ||
    path.includes(`/${EARLIER_BUNDLE_SNAPSHOT_DIRECTORY}/`)
  ) {
    return "harness";
  }
  if (path.endsWith(".log")) return "log";
  return "other";
}

function protectedFile(path: string): boolean {
  return (
    path.includes("/correctness-model/") ||
    path.includes("/grader/") ||
    path.endsWith("/verifier.json") ||
    path.endsWith(`/${SOLVABILITY_EVIDENCE_FILE}`) ||
    path.includes("/judge/controls/")
  );
}

export function toFileRef(repoRoot: string, absolute: string): FileRef {
  const stat = statSync(absolute);
  const path = normalizedRelative(realpathSync(repoRoot), absolute);
  return {
    path,
    category: fileCategory(path),
    bytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    content: contentKind(path),
    protected: protectedFile(path),
  };
}

/** File metadata is produced on demand; closing the iterator stops the directory walk. */
export function* walkRunFiles(lexicalRepoRoot: string, absoluteRoot: string): Generator<FileRef> {
  if (!existsSync(absoluteRoot)) return;
  const repoRoot = realpathSync(lexicalRepoRoot);
  const safe = safeRunPath(repoRoot, normalizedRelative(repoRoot, realpathSync(absoluteRoot)));
  if (safe === null) throw new Error("Evidence directory is outside the read boundary.");
  if (!existsSync(safe)) return;
  const entries = readdirSync(safe, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (!SEGMENT.test(entry.name)) continue;
    const path = join(safe, entry.name);
    if (entry.isDirectory() && !WALK_EXCLUDED_DIRECTORIES.has(entry.name)) {
      yield* walkRunFiles(repoRoot, path);
    } else if (entry.isFile()) yield toFileRef(repoRoot, path);
  }
}

function refused(path: string, issues: EvidenceIssue[]): null {
  // One row per reader, naming the first refused path. A broken boundary refuses every record in the
  // run, and three hundred identical rows would bury the sentence that explains them.
  if (issues.some((issue) => issue.message === REFUSED_MESSAGE)) return null;
  issues.push({
    level: "warning",
    source: path,
    message: REFUSED_MESSAGE,
  });
  return null;
}

/** JSON.parse of a well-formed file yields JsonValue by construction; a malformed one is an issue. */
export function readJson(repoRoot: string, path: string, issues: EvidenceIssue[]): JsonValue | null {
  const absolute = safeRunPath(repoRoot, path);
  if (absolute === null) return refused(path, issues);
  if (!existsSync(absolute)) return null;
  try {
    return readJsonFile(absolute);
  } catch (error) {
    issues.push({
      level: "error",
      source: path,
      message: `JSON could not be read: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }
}

export function readFilePayload(
  repoRoot: string,
  requested: string,
  protectedFiles: "reveal" | "withhold",
): FilePayload {
  const absolute = safeRunPath(repoRoot, requested);
  if (absolute === null || !existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error("path is outside the run-output boundary or is not a file");
  }
  const ref = toFileRef(repoRoot, absolute);
  if (ref.protected && protectedFiles === "withhold") {
    return {
      path: ref.path,
      contentType: ref.content,
      protected: true,
      value: {
        withheld: true,
        reason:
          "This evidence can contain protected verifier material. The local operator must choose to reveal it.",
      },
      truncated: false,
      bytes: ref.bytes,
    };
  }
  const handle = openSync(absolute, "r");
  const bytes = Buffer.alloc(MAX_DISPLAY_BYTES + 1);
  let length = 0;
  try {
    ref.bytes = fstatSync(handle).size;
    while (length < bytes.length) {
      const read = readSync(handle, bytes, {
        offset: length,
        length: bytes.length - length,
        position: length,
      });
      if (read === 0) break;
      length += read;
    }
  } finally {
    closeSync(handle);
  }
  const truncated = length > MAX_DISPLAY_BYTES;
  const read = bytes.subarray(0, length).toString("utf8");
  const text = truncated ? boundText(read, MAX_DISPLAY_BYTES).text : read;
  let value: unknown = text;
  if (ref.content === "json" && !truncated) {
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
  } else if (ref.content === "jsonl") {
    value = text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { malformed: line };
        }
      });
  }
  return {
    path: ref.path,
    contentType: ref.content,
    protected: ref.protected,
    value,
    truncated,
    bytes: ref.bytes,
  };
}
