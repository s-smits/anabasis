/**
 * Bounded content hashing and mutation checks for verifier input files.
 *
 * Input identity is host evidence, which means the hashing has to have a finite cost however large
 * the declared root turns out to be: shared budgets bound the number of files, the logical bytes and
 * the elapsed time, and a root that exceeds one of them is refused rather than allowed to run long.
 * Each file is read in chunks, with metadata checked before and after the read on both the path and
 * the open descriptor, and those two comparisons are what detect an observed replacement, a
 * truncation, or a change of mode or timestamp. Symbolic links are refused by this file reader; the
 * exact-read caller records and resolves them separately, because a link's identity is its target's
 * and this reader only ever has the name.
 *
 * What this is not is an OS snapshot. A same-UID writer can still replace a path and restore both
 * bytes and metadata between two observations — the pathname ABA case — and the host records a
 * typed refusal whenever a transition is visible to it. Excluding that race would need a filesystem
 * snapshot or a separate writer boundary, so this module does not claim to.
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

/** Above the largest tool tree recorded, which was campaign w47's at 109,509 entries, with finite
 *  headroom over that shape rather than a number chosen to be large. */
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

/** Private metadata. It is deliberately kept out of the condition digest: an inode number or an
 *  mtime is a fact about this host at this moment, so including it would make two runs of identical
 *  bytes report different conditions. */
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
  /** Metadata-only revalidation is separately bounded work, counted in its own pair of fields so it
   *  can never silently reset the aggregate counters belonging to the content walk that produced the
   *  digest. */
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

/**
 * POSIX permits directory names and symlink targets that are not valid UTF-8. The JSON condition
 * identity cannot represent them without an ambiguous replacement character, so the host refuses
 * such a root instead of recording a name that is not the name on disk. Taking a buffer matters
 * here: by the time the default string API has returned, the lossy decode has already happened and
 * the decision can no longer be made.
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

/** One read buffer shared by every file digest. The walk is synchronous, so no two reads overlap
 *  and a shared buffer is safe; allocating a zeroed 1 MiB buffer per file instead made a root of
 *  20,000 one-byte files cost two seconds in memset alone. */
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
  // O_NONBLOCK prevents a path replaced with a FIFO between lstat and open from blocking the host
  // on a writer that never arrives, and O_NOFOLLOW refuses a replacement with a symlink. Neither
  // covers a replacement with another regular file, nor a race that swaps the path back before the
  // second path check, which is why the descriptor fstat below is still required.
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
    return hasher.digest("hex");
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
 * Hash one host file with a bounded reader that checks the open descriptor. Callers use this for
 * command binaries and declared attested files, and nothing in this module reads a whole file into
 * memory: every digest goes through the chunked reader above, so a file's size cannot decide how
 * much the host allocates. The recorded size is charged against the budget before the open, which is
 * what turns an oversized or sparse file into a typed unavailable or non-result rather than an
 * allocation.
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
