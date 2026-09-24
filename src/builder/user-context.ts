/**
 * The context mechanism: the controller admits an explicit corpus, fingerprints it, lists a compact
 * manifest in the kickoff, and `context-tool.ts` serves the files as its user source. Context is
 * user input — not a generated ask, and not verifier truth — which is why it is admitted once and
 * read through a controller-owned snapshot rather than consulted live.
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
import { sha256, sha256OfFile } from "../meta/digest.ts";
import { hashJsonBytes } from "../meta/json-runtime.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { scanTextFile } from "./file-window.ts";

const MAX_FILES = 5_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
// opencode's FIRST_CHUNK: enough of a file to decide what it is, small enough that deciding costs
// one page-sized read rather than the file.
const FIRST_CHUNK_BYTES = 256 * 1024;
const MANIFEST_FILES = 40;

export interface UserContextFile {
  id: string;
  label: string;
  lines: number;
  bytes: number;
  /** Code points, so an exact character page states the same total the file has. */
  characters: number;
  sha256: string;
  /** Admission copies each source file into a controller-owned staging directory and hashes, counts
   *  and validates that copy; every later read and search opens the snapshot, so a source file
   *  changed, replaced or symlink-swapped after admission cannot be returned under the admitted
   *  sha256. The snapshot is a file rather than held text because the corpus may be 200 MB and a run
   *  holds this record from launch to terminal. */
  path: string;
}

export interface PreparedUserContext {
  digest: string;
  files: UserContextFile[];
  /** The staging root holding the snapshots, or null when the corpus admitted no file and nothing
   *  was staged. The context owns this root: `dispose()` removes it. */
  readonly root: string | null;
  /** Removes the staging root. Idempotent. */
  dispose(): void;
}

export const EMPTY_USER_CONTEXT: PreparedUserContext = {
  digest: sha256("[]"),
  files: [],
  root: null,
  dispose: () => {},
};

/**
 * opencode's content sniff, applied to the first chunk: magic-number prefixes as type, bytes and
 * offset. It answers three questions a zero-byte scan alone gets wrong — a PDF or PNG is named in
 * the refusal rather than reported as unspecified binary, UTF-16 and other non-UTF-8 encodings are
 * refused instead of decoding into replacement characters, and a file that is mostly control bytes
 * is refused even when none of them is zero.
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
 * opencode's read shape: stat, then a bounded descriptor read into a fixed buffer, rather than
 * loading a file to find out what it holds. A PDF is refused after this one read instead of after
 * 25 MiB.
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
 * Scans one copied snapshot: the head check, the text pass and the hash all read the snapshot, so
 * they describe the same bytes as every later window does.
 */
function scanSnapshot(root: string, physical: string, snapshot: string): Omit<UserContextFile, "id"> {
  const head = firstChunk(snapshot, Math.min(statSync(snapshot).size, FIRST_CHUNK_BYTES));
  const detected = detectContentType(head);
  if (detected !== "text/plain") throw new Error(`context admits text files only (${detected}): ${physical}`);
  // The head names a known binary; this pass answers for a file that hides a zero byte or a bad
  // sequence past it, and returns the totals every later window states, without holding any text.
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
  // The staging root is created when the first file is copied, not on entry, so an empty context
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
        const snapshot = join(staging, `${admitted.length + 1}`);
        copyFileSync(physical, snapshot);
        // The caps bind the snapshot's actual bytes, not the directory entry read before the copy:
        // a source that grew or was replaced mid-copy is caught here, after the copy and before any
        // scan admits it.
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

/** The compact prompt card: what the corpus holds, not what it says. Contents stay on demand behind
 *  the context tool, so the kickoff costs a manifest rather than a corpus. */
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
    "The context tool reads and searches these user files (source user). They are input material, not answers.",
    listed,
    ...(omitted === 0
      ? []
      : [`- … ${omitted} more; the context tool's overview of source user lists all of them.`]),
  ].join("\n");
}
