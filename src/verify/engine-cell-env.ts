/**
 * The environment an engine cell starts with, and the one thing it may carry over from an earlier
 * cell: the cache the same tool left there. Split out of host.ts so that the fresh HOME and TMPDIR
 * rule, and the one exception to it, have one owner rather than being restated wherever a cell is
 * built.
 *
 * Every cell's HOME and TMPDIR are new, which keeps one run's files out of the next verdict. It
 * also meant that a compiler rebuilt its whole platform core on every check, because the core it
 * cached under HOME went with the cell, and on a firmware toolchain that is most of a minute per
 * run. So the user cache directory under the fresh HOME is restored from a store beside the cells
 * before a cell's first run, and stored back after a run that wrote to it. The key is the tool
 * tree, the tool's bytes and its interpreter's bytes, so another campaign's tree, another build of
 * the tool or another interpreter starts empty. A battery run restores and never stores, because
 * its inputs are the Built solver's, and every wall closes the store by name, so a program reaches
 * it only through this restore and this store.
 *
 * Only plain files and directories cross in either direction. A stored tree holding a link, a
 * device or a pipe starts the run cold with the reason in its evidence row, because a link restored
 * into a cell would hand the tool a path outside it. A store is checked on the copy, since another
 * run in the cell may still be writing to the source; a restore is checked on the stored tree
 * itself, since nothing but a store writes there.
 */
import { cpSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from "../meta/filesystem.ts";
import { join, relative } from "../meta/path.ts";
import { runtimeProcess } from "../meta/process.ts";
import { hashJsonBytes } from "../meta/json-runtime.ts";
import { errorCode, errorMessage } from "../meta/runtime-values.ts";
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import { commandSearchPath } from "./solve-command-isolation.ts";
import type { ToolRunResult, VerifierSubject } from "./verifier-port.ts";
import { VERIFIER_CACHE_STORE } from "./wall-policy.ts";

/** A cell's cache as its first run restored it: the evidence every run in the cell records, and
 *  when the cache last matched the store, so that a run which wrote nothing stores nothing. */
export interface CellToolCache {
  row: { key: string; path: string; start: "warm" | "cold"; coldReason?: string };
  syncedAt: number;
}

/** Where a tool looks for its user cache under HOME: what Go's `os.UserCacheDir` answers and what
 *  XDG_CACHE_HOME is pointed at, so a tool asking either way writes the directory the host keeps. */
function cellCacheDir(workdir: string): string {
  const home = join(workdir, "home");
  return runtimeProcess.platform === "darwin" ? join(home, "Library", "Caches") : join(home, ".cache");
}

/** The toolchain environment plus the candidate's search path. TMPDIR selects a private tool
 *  scratch space, and HOME is a child of the request workdir, writable under both OS policies and
 *  removed once process cleanup is confirmed; the cache under HOME holds only what the host
 *  restored into it. The parent environment contributes nothing at all, because the recorded
 *  toolchain must not be replaced by an unrecorded installation selected through an inherited
 *  variable — and PATH is precisely the variable that selects a script tool's interpreter. */
export function engineCellEnv(input: {
  toolchainEnv: OptionalEnvValues;
  toolTree: string | null;
  workdir: string;
  requireOsSandbox: boolean;
}): OptionalEnvValues {
  const env: OptionalEnvValues = { ...input.toolchainEnv };
  // A toolchain-owned PATH stands; otherwise the cell searches exactly where the Builder shell did.
  env.PATH ??= commandSearchPath(input.toolTree);
  const cacheDir = cellCacheDir(input.workdir);
  mkdirSync(cacheDir, { recursive: true });
  Object.assign(
    env,
    { TMPDIR: input.workdir, HOME: join(input.workdir, "home"), XDG_CACHE_HOME: cacheDir },
    input.requireOsSandbox ? { OPENSSL_CONF: "/dev/null" } : {},
  );
  return env;
}

/**
 * Runs one tool in its cell with the cache the cell's first run restored, stores the cache back
 * when a gate run wrote to it, and records both beside the tool digest. The store sits beside the
 * cells, so it lives as long as the host's temporary directory does. Without a tool tree there is
 * nothing to key a cache by, and the run starts as clean as every cell did before the store. The
 * tree is the candidate workspace's own, and a linked tree resolves to one physical path across
 * versions, so candidates of one campaign share a cache while two campaigns never do.
 */
export async function withToolCache(
  cell: { path: string; cache?: CellToolCache },
  baseDir: string,
  phase: VerifierSubject["phase"],
  tool: { tree: string | null; digest: string; interpreterDigest: string | undefined },
  run: () => Promise<ToolRunResult>,
): Promise<ToolRunResult> {
  if (tool.tree === null) return run();
  const key = hashJsonBytes(tool);
  cell.cache ??= restore(join(baseDir, VERIFIER_CACHE_STORE, key), key, cellCacheDir(cell.path));
  const cache = cell.cache;
  const result = await run();
  const published = result.executed && phase !== "battery" && publish(cache, cellCacheDir(cell.path));
  return { ...result, evidence: { ...result.evidence, cache: { ...cache.row, published } } };
}

/** The newest file time in a cache tree, or why the tree may not cross: it is not a directory, or
 *  it holds an entry that is neither a plain file nor a directory, which a recursive listing
 *  reports as what it is rather than following. */
function newestFileMs(root: string): { newestMs: number } | { refused: string } {
  if (!lstatSync(root).isDirectory()) return { refused: "is not a directory" };
  let newestMs = 0;
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isFile()) newestMs = Math.max(newestMs, lstatSync(path).mtimeMs);
    else if (!entry.isDirectory()) {
      return { refused: `holds ${relative(root, path)}, which is neither a plain file nor a directory` };
    }
  }
  return { newestMs };
}

function restore(path: string, key: string, target: string): CellToolCache {
  const cold = (coldReason: string): CellToolCache => ({
    row: { key, path, start: "cold", coldReason },
    syncedAt: Date.now(),
  });
  try {
    const stored = newestFileMs(path);
    if ("refused" in stored) return cold(`the stored cache ${stored.refused}`);
    cpSync(path, target, { recursive: true, preserveTimestamps: true });
    return { row: { key, path, start: "warm" }, syncedAt: Date.now() };
  } catch (error) {
    // A copy that stopped part way would leave the tool half a cache.
    rmSync(target, { recursive: true, force: true });
    return cold(
      errorCode(error) === "ENOENT"
        ? "nothing is stored under this key"
        : `the stored cache could not be restored: ${errorMessage(error)}`,
    );
  }
}

/** Replaces the stored tree with the cell's when a file in it is newer than the last restore or
 *  store, checking the staged copy, and says whether it did. The old tree goes only once the new
 *  one is whole, so a store cut short leaves the previous one or none. */
function publish(cache: CellToolCache, source: string): boolean {
  const { path } = cache.row;
  const stage = `${path}.stage`;
  try {
    const written = newestFileMs(source);
    if ("refused" in written || written.newestMs <= cache.syncedAt) return false;
    cpSync(source, stage, { recursive: true });
    if ("refused" in newestFileMs(stage)) return false;
    rmSync(path, { recursive: true, force: true });
    renameSync(stage, path);
    cache.syncedAt = Date.now();
    return true;
  } catch {
    return false;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
