/**
 * Content-addressed bundle hashing. A fingerprinted slug is two bundles — agent (solve-side) and
 * correctness model (evaluation) — and every claim carries both hashes, so the measurement is tied
 * to exact bytes, not to a directory name that may have drifted since the battery ran.
 *
 * The hash is deterministic: sorted posix-relative paths, one `path\0sha256\n` line per file,
 * sha256 over the concatenation. Renaming, adding, removing, or editing any file changes it.
 */
import { readdirSync } from "../meta/filesystem.ts";
import { join, relative } from "../meta/path.ts";
import { sha256, sha256OfFile } from "../meta/digest.ts";

export interface BundleFile {
  /** Posix-style path relative to the bundle root. */
  path: string;
  sha256: string;
}

interface BundleHash {
  hash: string;
  files: BundleFile[];
}

/** Never bundle content: their presence rejects the bundle instead of leaving executable bytes unhashed. */
const REFUSED_DIRS = new Set(["node_modules", ".git"]);

/**
 * A bundle entry that is neither a regular file nor a directory. It is rejected rather than
 * skipped, because an unhashed link would let runtime reads escape what the content address covers.
 */
export class IrregularBundleEntryError extends Error {
  constructor(readonly entries: string[]) {
    super(
      `bundle contains unsupported entries: ${entries.join(", ")} — excluded directories, symlinks and special files are rejected, not skipped: unhashed content would escape the fingerprint`,
    );
    this.name = "IrregularBundleEntryError";
  }
}

function walk(root: string, dir: string, out: string[], irregular: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = relative(root, abs).split("\\").join("/");
    if (entry.isSymbolicLink()) irregular.push(rel);
    else if (entry.isDirectory()) {
      if (REFUSED_DIRS.has(entry.name)) irregular.push(rel);
      else walk(root, abs, out, irregular);
    } else if (entry.isFile()) out.push(rel);
    else irregular.push(rel);
  }
}

export function hashBundle(dir: string, opts?: { excludeTop?: readonly string[] }): BundleHash {
  const excludeTop = new Set(opts?.excludeTop ?? []);
  const paths: string[] = [];
  const irregular: string[] = [];
  walk(dir, dir, paths, irregular);
  if (irregular.length > 0) throw new IrregularBundleEntryError(irregular.sort());
  paths.sort();
  const files = paths
    .values()
    .filter((path) => !excludeTop.has(path))
    .map((path) => ({ path, sha256: sha256OfFile(join(dir, path)) }))
    .toArray();
  const hash = sha256(files.map((f) => `${f.path}\0${f.sha256}\n`).join(""));
  return { hash, files };
}
