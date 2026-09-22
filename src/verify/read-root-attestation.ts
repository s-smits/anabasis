/**
 * Bounded content hashing and mutation checks for verifier input files.
 *
 * Input identity is host evidence, so hashing must have a finite cost. Shared budgets limit the
 * number of files, logical bytes and elapsed time. Each file is read in chunks, with metadata
 * checked before and after the read on both the path and the open descriptor. Those comparisons
 * detect observed replacement, truncation, mode and timestamp changes. Symbolic links are
 * refused by this file reader; the exact-read caller records and resolves them separately.
 *
 * This is not an OS snapshot. A same-UID writer can still replace a path and restore bytes and
 * metadata between observations (the pathname ABA case); the host records a typed refusal when
 * a transition is visible, but this module does not claim to exclude that operator-level
 * race without a filesystem snapshot or a separate writer boundary.
 */
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readlinkSync,
} from "../meta/filesystem.ts";

/** The recorded ESP32 W47 tool tree has 109,509 entries; retain finite headroom above that shape. */
const READ_ROOT_MAX_ENTRIES = 250_000;
/** One declared root may contribute at most sixteen GiB of logical file and link bytes. */
export const READ_ROOT_MAX_BYTES = 16n * 1024n * 1024n * 1024n;
/** A large but finite root gets five minutes on the host before becoming a non-result. */
const READ_ROOT_MAX_DURATION_MS = 5 * 60 * 1000;
/** One condition may name several engines; their distinct roots share these ceilings. */
const READ_ROOT_AGGREGATE_MAX_ENTRIES = 500_000;
export const READ_ROOT_AGGREGATE_MAX_BYTES = 32n * 1024n * 1024n * 1024n;
export const READ_ROOT_AGGREGATE_MAX_DURATION_MS = 10 * 60 * 1000;
const READ_ROOT_READ_CHUNK_BYTES = 1024 * 1024;

type ReadRootKind = "directory" | "file" | "symlink";

/** Private metadata: it is deliberately not part of the condition digest. */
export interface ReadRootMetadata {
  path: string;
  kind: ReadRootKind;
  dev: string;
  ino: string;
  mode: string;
  size: string;
  mtimeNs: string;
  ctimeNs: string;
  symlinkTarget: string | null;
}

interface ReadRootFileAttestation {
  path: string;
  digest: string;
  metadata: ReadRootMetadata;
}

/** One budget is shared by every root a condition asks the host to attest. */
export interface ReadRootBudget {
  roots: number;
  /** Entries and logical bytes charged by the one content-hashing attestation. */
  entries: number;
  contentBytes: bigint;
  /** Metadata-only revalidation is separately bounded work; it never silently resets the
   * aggregate counters for the content walk that made the digest. */
  metadataEntries: number;
  metadataBytes: bigint;
  startedAt: number;
  /** Canonical roots whose content charge is already represented in this budget. Aliases share it. */
  canonicalRoots: Set<string>;
}

interface RootWalkBudget {
  aggregate: ReadRootBudget;
  phase: "content" | "metadata";
  aggregateBaseEntries: number;
  aggregateBaseBytes: bigint;
  entries: number;
  contentBytes: bigint;
  startedAt: number;
}

/** Digests this process has already computed, reusable while the file's complete metadata
 *  (device, inode, mode, size, mtime, ctime) is identical: the rule the same-host metadata
 *  revalidation applies to whole roots. The Bun runtime closure is attested when a worker policy
 *  is built and again before and after every confined execution, so without this one battery of
 *  four tasks hashed the same 62 MB executable about 170 times. */
const DIGEST_BY_METADATA = new Map<string, { metadata: ReadRootMetadata; digest: string }>();

/**
 * POSIX permits directory names and symlink targets which are not UTF-8. They cannot be represented
 * by the JSON condition identity without an ambiguous replacement character, so the host refuses
 * such a root. The buffer API is important here: the default string API has already performed a
 * lossy decode before we can make that decision.
 */
function utf8PathBytes(value: string | Uint8Array, description: string): string {
  if (!(value instanceof Uint8Array)) return value;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new Error(`read root contains invalid UTF-8 ${description}`);
  }
}

export function createReadRootBudget(): ReadRootBudget {
  return {
    roots: 0,
    entries: 0,
    contentBytes: 0n,
    metadataEntries: 0,
    metadataBytes: 0n,
    startedAt: Date.now(),
    canonicalRoots: new Set(),
  };
}

function statMetadata(
  path: string,
  stat: ReturnType<typeof lstatSync>,
  symlinkTarget: string | null,
): ReadRootMetadata {
  if (stat === undefined) throw new Error(`read root metadata is unavailable: ${path}`);
  // SAFETY: callers use lstatSync(path, { bigint: true }); these fields are the Node bigint stat contract.
  const bigintStat = stat as ReturnType<typeof lstatSync> & {
    dev: bigint;
    ino: bigint;
    mode: bigint;
    size: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
  };
  return {
    path,
    kind: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file",
    dev: String(bigintStat.dev),
    ino: String(bigintStat.ino),
    mode: String(bigintStat.mode),
    size: String(bigintStat.size),
    mtimeNs: String(bigintStat.mtimeNs),
    ctimeNs: String(bigintStat.ctimeNs),
    symlinkTarget,
  };
}

export function sameReadRootMetadata(left: ReadRootMetadata, right: ReadRootMetadata): boolean {
  return (
    left.path === right.path &&
    left.kind === right.kind &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.symlinkTarget === right.symlinkTarget
  );
}

/** Snapshot one host path for command identity and for the root walk's before/after checks. */
export function snapshotReadRootPath(path: string): ReadRootMetadata {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isSymbolicLink() && !stat.isFile() && !stat.isDirectory()) {
    throw new Error(`read root path has an unsupported kind: ${path}`);
  }
  const target = stat.isSymbolicLink()
    ? utf8PathBytes(readlinkSync(path, { encoding: "buffer" }), `symlink target at ${path}`)
    : null;
  return statMetadata(path, stat, target);
}

function failIfTimedOut(rootStartedAt: number, budget: ReadRootBudget, path: string): void {
  if (Date.now() - rootStartedAt > READ_ROOT_MAX_DURATION_MS) {
    throw new Error(`read root attestation exceeded ${String(READ_ROOT_MAX_DURATION_MS)}ms: ${path}`);
  }
  if (Date.now() - budget.startedAt > READ_ROOT_AGGREGATE_MAX_DURATION_MS) {
    throw new Error(
      `read root aggregate attestation exceeded ${String(READ_ROOT_AGGREGATE_MAX_DURATION_MS)}ms: ${path}`,
    );
  }
}

function reserveEntry(budget: RootWalkBudget, path: string): void {
  if (budget.entries >= READ_ROOT_MAX_ENTRIES) {
    throw new Error(`read root has more than ${String(READ_ROOT_MAX_ENTRIES)} entries: ${path}`);
  }
  if (budget.aggregateBaseEntries + budget.entries >= READ_ROOT_AGGREGATE_MAX_ENTRIES) {
    throw new Error(
      `read root aggregate has more than ${String(READ_ROOT_AGGREGATE_MAX_ENTRIES)} entries: ${path}`,
    );
  }
  budget.entries += 1;
  if (budget.phase === "content") budget.aggregate.entries += 1;
  else budget.aggregate.metadataEntries += 1;
}

function reserveBytes(budget: RootWalkBudget, bytes: bigint, path: string): void {
  const aggregateBytes = budget.aggregateBaseBytes + budget.contentBytes;
  if (
    bytes < 0n ||
    bytes > READ_ROOT_MAX_BYTES - budget.contentBytes ||
    bytes > READ_ROOT_AGGREGATE_MAX_BYTES - aggregateBytes
  ) {
    throw new Error(`read root content-byte budget exceeded: ${path}`);
  }
  budget.contentBytes += bytes;
  if (budget.phase === "content") budget.aggregate.contentBytes += bytes;
  else budget.aggregate.metadataBytes += bytes;
}

const READ_ROOT_OPEN_FLAGS = (() => {
  const { O_NOFOLLOW, O_NONBLOCK, O_RDONLY } = constants;
  if (![O_NOFOLLOW, O_NONBLOCK, O_RDONLY].every((flag) => Number.isInteger(flag))) {
    throw new Error("read root attestation requires numeric O_RDONLY, O_NONBLOCK and O_NOFOLLOW flags");
  }
  return O_RDONLY | O_NONBLOCK | O_NOFOLLOW;
})();

/** One read buffer for every file digest. The walk is synchronous, so no two reads overlap, and
 *  allocating a zeroed 1 MiB buffer per file made a root of 20,000 one-byte files cost two
 *  seconds in memset alone. */
const READ_CHUNK = new Uint8Array(READ_ROOT_READ_CHUNK_BYTES);

function readFileDigest(
  path: string,
  startedAt: number,
  budget: RootWalkBudget,
  expected: ReadRootMetadata,
): string {
  if (expected.kind !== "file") throw new Error(`read root expected a regular file: ${path}`);
  const size = BigInt(expected.size);
  reserveBytes(budget, size, path);
  const known = DIGEST_BY_METADATA.get(path);
  if (known !== undefined && sameReadRootMetadata(known.metadata, expected)) return known.digest;
  // O_NONBLOCK prevents a lstat→open replacement with a FIFO from blocking the host. O_NOFOLLOW
  // refuses a symlink replacement. Descriptor fstat below remains necessary for regular-file
  // replacement and for a race which swaps the path back before the second path check.
  const handle = openSync(path, READ_ROOT_OPEN_FLAGS);
  const bytes = READ_CHUNK;
  const hasher = new Bun.CryptoHasher("sha256");
  let position = 0;
  let remaining = size;
  let bytesRead = 0n;
  try {
    const opened = descriptorMetadata(path, handle);
    if (!sameReadRootMetadata(expected, opened)) {
      throw new Error(`read root file descriptor changed before reading: ${path}`);
    }
    while (remaining > 0n) {
      failIfTimedOut(startedAt, budget.aggregate, path);
      const requested = Number(remaining > BigInt(bytes.byteLength) ? BigInt(bytes.byteLength) : remaining);
      const read = readSync(handle, bytes, 0, requested, position);
      if (read === 0) break;
      hasher.update(bytes.subarray(0, read));
      position += read;
      bytesRead += BigInt(read);
      remaining -= BigInt(read);
    }
    failIfTimedOut(startedAt, budget.aggregate, path);
    if (bytesRead !== size) throw new Error(`read root file was shorter than its frozen size: ${path}`);
    const closed = descriptorMetadata(path, handle);
    if (!sameReadRootMetadata(expected, closed)) {
      throw new Error(`read root file descriptor changed after reading: ${path}`);
    }
    const digest = hasher.digest("hex");
    DIGEST_BY_METADATA.set(path, { metadata: expected, digest });
    return digest;
  } finally {
    closeSync(handle);
  }
}

function descriptorMetadata(path: string, handle: number): ReadRootMetadata {
  // SAFETY: fstatSync(handle, { bigint: true }) has the same bigint stat shape as lstatSync.
  const stat = fstatSync(handle, { bigint: true }) as ReturnType<typeof lstatSync>;
  if (stat === undefined) throw new Error(`read root descriptor metadata is unavailable: ${path}`);
  if (!stat.isFile()) throw new Error(`read root descriptor is not a regular file: ${path}`);
  return statMetadata(path, stat, null);
}

/**
 * Hash one host file with a bounded reader that checks the open descriptor.
 * Callers use this for command binaries and declared attested files; whole-file readFileSync is
 * deliberately absent from those identity paths. The file's recorded size is charged before open,
 * so an oversized or sparse file becomes a typed unavailable/non-result without allocation.
 */
export function attestReadRootFile(
  path: string,
  budget: ReadRootBudget = createReadRootBudget(),
): ReadRootFileAttestation {
  const before = snapshotReadRootPath(path);
  if (before.kind !== "file") throw new Error(`read root file is not a regular file: ${path}`);
  const startedAt = Date.now();
  const walkBudget: RootWalkBudget = {
    aggregate: budget,
    phase: "content",
    aggregateBaseEntries: budget.entries + budget.metadataEntries,
    aggregateBaseBytes: budget.contentBytes + budget.metadataBytes,
    entries: 0,
    contentBytes: 0n,
    startedAt,
  };
  reserveEntry(walkBudget, path);
  const digest = readFileDigest(path, startedAt, walkBudget, before);
  const after = snapshotReadRootPath(path);
  if (!sameReadRootMetadata(before, after)) {
    throw new Error(`read root file changed while it was being attested: ${path}`);
  }
  return { path, digest, metadata: after };
}
