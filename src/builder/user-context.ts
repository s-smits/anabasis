/**
 * The context mechanism: the controller admits an explicit corpus,
 * fingerprints it, lists a compact manifest in the kickoff, and gives the Builder bounded
 * list/read/search access. Context is user input, not a generated ask and not verifier truth.
 */
import {
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "../meta/filesystem.ts";
import { tmpdir } from "../meta/os.ts";
import { basename, isAbsolute, join, relative, resolve } from "../meta/path.ts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { sha256, sha256OfFile } from "../meta/digest.ts";
import { hashJsonBytes } from "../meta/json-runtime.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { defineTool } from "../solve/define-tool.ts";
import { eachFileLine, readFileCharacterWindow, readFileWindow, scanTextFile } from "./file-window.ts";
import { truncateLine } from "./pi-coding/truncate.ts";
import { hasText } from "../meta/text.ts";
import { characterLimit, jsonListPage, LIST_WINDOW_ROWS, windowNote } from "./read-window.ts";

const MAX_FILES = 5_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
// opencode's FIRST_CHUNK (packages/core/src/tool/read-filesystem.ts): enough of a file to decide
// what it is, small enough that deciding costs one page-sized read.
const FIRST_CHUNK_BYTES = 256 * 1024;
const MANIFEST_FILES = 40;
const MAX_SEARCH_MATCHES = 40;

interface UserContextFile {
  id: string;
  label: string;
  lines: number;
  bytes: number;
  /** Code points, so an exact character page states the same total the file has. */
  characters: number;
  sha256: string;
  /** The controller-owned snapshot of the admitted bytes. Admission copies each file once into a
   *  staging directory and hashes, counts and validates that copy; every later read and search
   *  opens the snapshot, so a source file changed, replaced or symlink-swapped after admission
   *  cannot be returned under the admitted sha256. The snapshot is a file rather than held text
   *  because the corpus may be 200 MB and a run holds this record from launch to terminal. */
  path: string;
}

export interface PreparedUserContext {
  digest: string;
  files: UserContextFile[];
  /** The controller-owned staging root holding the snapshots, or null when the context admitted no
   *  file and nothing was staged. The context owns this root: `dispose()` removes it. */
  readonly root: string | null;
  /** Remove the staging root. Idempotent; a second call removes nothing. */
  dispose(): void;
}

const EMPTY_USER_CONTEXT_ROOT: PreparedUserContext = {
  digest: sha256("[]"),
  files: [],
  root: null,
  dispose: () => {},
};

export const EMPTY_USER_CONTEXT: PreparedUserContext = EMPTY_USER_CONTEXT_ROOT;

/**
 * opencode's content sniff (packages/core/src/mime.ts), applied to the first chunk. Three questions
 * a zero-byte scan alone answers wrongly: a PDF or PNG is named rather than reported as unspecified
 * binary, UTF-16 and other non-UTF-8 encodings are refused instead of decoding into replacement
 * characters, and a file that is mostly control bytes is refused even when none of them is zero.
 */
const MAGIC: ReadonlyArray<readonly [string, readonly number[], number]> = [
  ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0],
  ["image/jpeg", [0xff, 0xd8, 0xff], 0],
  ["image/gif", [0x47, 0x49, 0x46, 0x38], 0],
  ["image/bmp", [0x42, 0x4d], 0],
  ["application/pdf", [0x25, 0x50, 0x44, 0x46, 0x2d], 0],
  ["application/zip", [0x50, 0x4b, 0x03, 0x04], 0],
  ["image/webp", [0x57, 0x45, 0x42, 0x50], 8],
];

/** The share of control bytes above which a file is data rather than prose. opencode's figure. */
const CONTROL_BYTE_SHARE = 0.3;

function hidden(name: string): boolean {
  return name.startsWith(".");
}

function collectFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) continue;
    if (stat.isFile()) {
      out.push(current);
      if (out.length > MAX_FILES) throw new Error(`user context contains more than ${MAX_FILES} files`);
      continue;
    }
    if (!stat.isDirectory()) continue;
    const children = readdirSync(current, { withFileTypes: true })
      .filter((entry) => !hidden(entry.name))
      .map((entry) => join(current, entry.name))
      .sort()
      .toReversed();
    stack.push(...children);
  }
  return out;
}

function detectContentType(bytes: Uint8Array): string {
  for (const [type, prefix, at] of MAGIC) {
    if (prefix.every((value, index) => bytes[at + index] === value)) return type;
  }
  if (bytes.length === 0) return "text/plain";
  if (bytes.includes(0)) return "application/octet-stream";
  try {
    // Streaming, so a multi-byte character split by the chunk boundary is not read as invalid.
    new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
  } catch {
    return "application/octet-stream";
  }
  let controls = 0;
  for (const byte of bytes) if (byte < 9 || (byte > 13 && byte < 32)) controls += 1;
  return controls / bytes.length <= CONTROL_BYTE_SHARE ? "text/plain" : "application/octet-stream";
}

/**
 * opencode's read shape (packages/core/src/environment/local.ts): stat, then a bounded descriptor
 * read into a fixed buffer, rather than loading a file to find out what it holds. A PDF is refused
 * after this one read instead of after 25 MiB.
 */
function firstChunk(path: string, length: number): Uint8Array {
  const handle = openSync(path, "r");
  try {
    const buffer = new Uint8Array(length);
    return buffer.subarray(0, readSync(handle, buffer, 0, length, 0));
  } finally {
    closeSync(handle);
  }
}

/**
 * Scan one copied snapshot: the head check, the text pass and the hash all read the snapshot, so
 * they describe the same bytes as every later window.
 */
function scanSnapshot(root: string, physical: string, snapshot: string): Omit<UserContextFile, "id"> {
  const head = firstChunk(snapshot, Math.min(statSync(snapshot).size, FIRST_CHUNK_BYTES));
  const detected = detectContentType(head);
  if (detected !== "text/plain") throw new Error(`context admits text files only (${detected}): ${physical}`);
  // The head names a known binary; the pass answers for a file that hides a zero byte or a bad
  // sequence past it, and returns the totals every later window states, without holding text.
  const facts = scanTextFile(snapshot);
  if (!facts.text) throw new Error(`context admits text files only (application/octet-stream): ${physical}`);
  return {
    label: statSync(root).isFile() ? basename(physical) : `${basename(root)}/${relative(root, physical)}`,
    lines: facts.lines,
    bytes: facts.bytes,
    characters: facts.characters,
    sha256: sha256OfFile(snapshot),
    path: snapshot,
  };
}

/** Admit explicit paths plus the repository's shared `context/` directory when present. Explicit
 *  relative paths resolve from repoRoot. Missing explicit paths refuse instead of disappearing. */
export function prepareUserContext(repoRoot: string, explicitPaths: string[] = []): PreparedUserContext {
  // The staging root is created when the first file is copied, not on entry: an empty context
  // leaves no temporary state behind.
  let staging: string | null = null;
  let disposed = false;
  const dispose = () => {
    if (disposed || staging === null) return;
    disposed = true;
    rmSync(staging, { recursive: true, force: true });
  };
  try {
    const shared = join(repoRoot, "context");
    const requested = [...(existsSync(shared) ? [shared] : []), ...explicitPaths];
    const roots = requested.map((entry) => {
      const resolved = isAbsolute(entry) ? resolve(entry) : resolve(repoRoot, entry);
      if (!existsSync(resolved)) throw new Error(`context path does not exist: ${entry}`);
      if (hidden(basename(resolved))) throw new Error(`hidden context paths are not admitted: ${entry}`);
      return realpathSync(resolved);
    });
    const seen = new Set<string>();
    const admitted: Array<Omit<UserContextFile, "id">> = [];
    let totalBytes = 0;
    for (const root of roots) {
      for (const file of collectFiles(root)) {
        const physical = realpathSync(file);
        if (seen.has(physical)) continue;
        seen.add(physical);
        // Size decides before any content is loaded, so an oversized path is refused from its
        // directory entry rather than held in memory purely to be rejected.
        const { size } = Bun.file(physical);
        if (size > MAX_FILE_BYTES) {
          throw new Error(`context file exceeds ${MAX_FILE_BYTES} bytes: ${physical}`);
        }
        if (totalBytes + size > MAX_TOTAL_BYTES) {
          throw new Error(`user context exceeds ${MAX_TOTAL_BYTES} bytes`);
        }
        staging ??= mkdtempSync(join(tmpdir(), "ana-user-context-"));
        // One copy of the source, taken before any fact is derived: the head check, the scan and
        // the hash all read the snapshot, so they describe the same bytes as every later window.
        const snapshot = join(staging, `${admitted.length + 1}`);
        copyFileSync(physical, snapshot);
        // The caps bind the snapshot's actual bytes, not the directory entry read before the
        // copy: a source that grew or was replaced mid-copy is caught here, after the copy and
        // before any scan admits it.
        const actual = statSync(snapshot).size;
        if (actual > MAX_FILE_BYTES) {
          throw new Error(`context snapshot exceeds ${MAX_FILE_BYTES} bytes: ${physical}`);
        }
        if (totalBytes + actual > MAX_TOTAL_BYTES) {
          throw new Error(`user context exceeds ${MAX_TOTAL_BYTES} bytes`);
        }
        totalBytes += actual;
        admitted.push(scanSnapshot(root, physical, snapshot));
      }
    }
    admitted.sort((a, b) => compareCodeUnits(a.label, b.label) || compareCodeUnits(a.sha256, b.sha256));
    const files = admitted.map((file, index) => ({ id: `ctx-${index + 1}`, ...file }));
    const digest = hashJsonBytes(
      files.map(({ id, label, bytes, sha256: hash }) => ({ id, label, bytes, sha256: hash })),
    );
    return { digest, files, root: staging, dispose };
  } catch (cause) {
    dispose();
    throw cause;
  }
}

/** Compact prompt card. Contents stay on demand behind the context tool, as in v1. */
export function contextManifest(context: PreparedUserContext): string {
  if (context.files.length === 0) {
    return `User context: no files supplied (digest ${context.digest}).`;
  }
  const listed = [...context.files]
    .sort((a, b) => b.lines - a.lines || compareCodeUnits(a.label, b.label))
    .slice(0, MANIFEST_FILES)
    .map(
      (file) =>
        `- ${file.id}: ${file.label} (${file.lines} line${file.lines === 1 ? "" : "s"}, sha256:${file.sha256})`,
    )
    .join("\n");
  const omitted = context.files.length - Math.min(context.files.length, MANIFEST_FILES);
  return [
    `User context: ${context.files.length} approved file(s), digest ${context.digest}.`,
    "Use the context tool to list, read, or search these user files. They are input material, not answers.",
    listed,
    ...(omitted === 0
      ? []
      : [`- … ${omitted} more; call the context tool with {"action":"list"} to see all files.`]),
  ].join("\n");
}

const Params = Type.Object({
  action: Type.Union([Type.Literal("list"), Type.Literal("read"), Type.Literal("search")]),
  id: Type.Optional(Type.String()),
  query: Type.Optional(Type.String()),
  /** 1-based first line (read), row (list), or match (search). Defaults to the start. */
  offset: Type.Optional(Type.Number()),
  /** 1-based exact character page for a minified or otherwise single-line context file. */
  characterOffset: Type.Optional(Type.Number()),
  /** How many lines, rows, or matches to return. Defaults to the window owner's size. */
  limit: Type.Optional(Type.Number()),
});

export function createUserContextTool(context: PreparedUserContext): AgentTool<typeof Params> {
  const byId = new Map(context.files.map((file) => [file.id, file]));
  return defineTool({
    name: "context",
    label: "User context",
    description:
      "List, read, or search controller-admitted user context. It is input, not verification truth. Results carry admitted hashes and explicit continuation; use characterOffset to page an oversized single line exactly.",
    parameters: Params,
    run: async (params) => {
      if (params.action === "list") {
        const rows = context.files.map(({ id, label, lines, bytes, sha256: hash }) => ({
          id,
          label,
          lines,
          bytes,
          sha256: hash,
        }));
        const page = jsonListPage(rows, "files", params.offset, params.limit ?? LIST_WINDOW_ROWS);
        return {
          text: page.text,
          details: {
            action: params.action,
            files: page.count,
            digest: context.digest,
            receipt: { outcome: "completed", resultDigest: context.digest },
          },
        };
      }
      if (params.action === "read") {
        if (!hasText(params.id)) throw new Error("context.read requires id");
        const file = byId.get(params.id);
        if (file === undefined) throw new Error(`unknown context id: ${params.id}`);
        // The note leads the body: `details` never reaches the model, so a window stated only there
        // would leave a partial read looking exactly like a whole one.
        const lineWindow =
          params.characterOffset === undefined
            ? readFileWindow(file.path, file.lines, params.offset, params.limit)
            : null;
        const characterPage =
          params.characterOffset !== undefined || lineWindow?.cut === true
            ? readFileCharacterWindow(
                file.path,
                file.characters,
                params.characterOffset,
                characterLimit(params.limit),
              )
            : null;
        const window = characterPage ?? lineWindow;
        if (window === null) throw new Error("context read window was not constructed");
        const unit = characterPage === null ? "lines" : "characters";
        const offsetName = characterPage === null ? "offset" : "characterOffset";
        return {
          text: `${file.id} ${file.label} sha256:${file.sha256} — ${windowNote(window, unit, offsetName)}\n\n${window.text}`,
          details: {
            action: params.action,
            id: file.id,
            bytes: file.bytes,
            sha256: file.sha256,
            receipt: { outcome: "completed", resultDigest: context.digest, subjectDigest: file.sha256 },
          },
        };
      }
      const query = params.query?.trim();
      if (!hasText(query)) throw new Error("context.search requires a non-empty query");
      // Collect the whole match set, then window it: stopping at one page would make 400 matches
      // look like 40. Each file still streams one line at a time rather than being held in memory.
      const needle = query.toLocaleLowerCase();
      const matches: Array<{ id: string; label: string; line: number; text: string }> = [];
      for (const file of context.files) {
        eachFileLine(file.path, (line, number) => {
          if (line.toLocaleLowerCase().includes(needle)) {
            matches.push({ id: file.id, label: file.label, line: number, text: truncateLine(line).text });
          }
        });
      }
      const page = jsonListPage(matches, "matches", params.offset, params.limit ?? MAX_SEARCH_MATCHES);
      return {
        text: page.text,
        details: {
          action: params.action,
          query,
          matches: matches.length,
          receipt: { outcome: "completed", resultDigest: context.digest },
        },
      };
    },
  });
}
