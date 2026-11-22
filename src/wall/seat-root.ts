/**
 * Lifecycle management for seat roots: the single writable host directory allocated to each solve,
 * Builder session, or Examiner session, claimed before its first command and removed (together
 * with any lingering child processes) when the seat finishes.
 *
 * Each root is paired with a sibling ownership claim (`src/meta/holder.ts`) recording the owning
 * process so `releaseLeft` can distinguish orphaned directories from active ones deterministically
 * instead of relying on directory age or naming heuristics. Neither platform enforces a filesystem
 * disk quota on seat roots; seats are bounded instead by their wall-clock deadline, turn limit,
 * and campaign budget.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rm,
} from "../meta/filesystem.ts";
import { held, hold, recordIn } from "../meta/holder.ts";
import { dirname, join, resolve } from "../meta/path.ts";
import { runtimeProcess } from "../meta/process.ts";
import { processTable } from "../meta/process-table.ts";

/** Cleanup callback returned by `claimRoot`, invoking `releaseRoot` on the claimed directory. */
export type ReleaseRoot = () => Promise<void>;

/** Returns the sibling host-owned directory for `root`, placed outside the seat's writable tree. */
export const hostFolder = (root: string): string => `${root}.host`;

/** Returns the sibling ownership-claim path for `root`. */
const claimOf = (root: string): string => `${root}.owner`;

/** Records this process's ownership claim on an existing `root` directory. */
export function claim(root: string): void {
  hold(claimOf(root));
}

/** Reports whether a live process currently holds the ownership claim on `root`. */
export const claimed = (root: string): boolean => held(claimOf(root));

let reclaimSeq = 0;

/** Atomically moves a dead claimant's `.owner`, root and host folder onto private sibling paths
 *  before removing them asynchronously, so concurrent callers racing on one stale root never
 *  delete the winner's live root or ownership claim. */
async function reclaimDead(at: string): Promise<void> {
  const owner = claimOf(at);
  if (recordIn(owner) === "" || claimed(at)) return;
  const tomb = `${at}.reclaiming-${String(runtimeProcess.pid)}-${String((reclaimSeq += 1))}`;
  const move = (from: string, to: string): string | null => {
    try {
      renameSync(from, to);
      return to;
    } catch {
      return null;
    }
  };
  const movedOwner = move(owner, `${tomb}.owner`);
  if (movedOwner === null) return;
  endHolders(at);
  endHolders(hostFolder(at));
  const movedRoot = move(at, tomb);
  const movedHost = move(hostFolder(at), `${tomb}.host`);
  try {
    if (movedRoot !== null) await removeWhole(movedRoot);
    if (movedHost !== null) await rm(movedHost, { recursive: true, force: true });
  } finally {
    await rm(movedOwner, { force: true });
  }
}

/**
 * Creates a fresh seat root directory, claims it for this process, and returns its release
 * callback for cleanup once the seat terminates. A root whose claim names a dead process is
 * released first, just as the daily sweep would release it: because a campaign uses each session id
 * once, such a root belongs to a terminated seat whose id is being reused (for example, a seed
 * re-seeded under the same name), and refusing it would block restarts until the daily sweep.
 */
export async function claimRoot(root: string): Promise<ReleaseRoot> {
  const at = resolve(root);
  mkdirSync(dirname(at), { recursive: true });
  await reclaimDead(at);
  // Refuse an already-existing root held by a live claimant instead of sharing it across concurrent seats.
  mkdirSync(at, { mode: 0o700 });
  claim(at);
  return () => releaseRoot(at);
}

/**
 * Terminates processes still holding `root` or its sibling host directory, then removes the root,
 * the host directory, and finally the ownership claim (last so an interrupted cleanup remains
 * attributable to the live run stop, the daily sweep, or the next `claimRoot` call). Holder
 * termination runs synchronously before returning the asynchronous removal promise so verdict
 * recording can proceed while large virtual environments are deleted.
 */
export async function releaseRoot(root: string): Promise<void> {
  endHolders(root);
  // Terminate processes in the host directory as well (for example, Claude Code writing session
  // state briefly after query close) before deleting it.
  endHolders(hostFolder(root));
  await removeWhole(root);
  await rm(hostFolder(root), { recursive: true, force: true });
  await rm(claimOf(root), { force: true });
}

/** Returns top-level entries inside `folder`, or an empty list if the directory is unreadable. */
function inside(folder: string): string[] {
  try {
    return readdirSync(folder).map((name) => join(folder, name));
  } catch {
    return [];
  }
}

/**
 * Releases orphaned roots under `parents`: directories whose claiming process has exited are
 * released immediately, whereas unclaimed directories are released once their latest top-level
 * modification time precedes `unclaimedBefore`. Roots claimed by live processes or listed in
 * `spared` are skipped. When `act` is `"describe"`, returns candidate paths without deleting them.
 */
export async function releaseLeft(
  parents: readonly string[],
  unclaimedBefore: number,
  act: "release" | "describe",
  spared: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const left: string[] = [];
  for (const parent of parents.filter((each) => existsSync(each))) {
    const roots = new Set(
      readdirSync(parent).map((name) => join(parent, name.replace(/\.(?:host|owner)$/, ""))),
    );
    for (const root of roots) {
      try {
        if (spared.has(root)) continue;
        // Compute the most recent modification time across the root, host folder, and top-level entries.
        const tops = [root, hostFolder(root)].filter((top) => existsSync(top));
        const written = Math.max(
          ...tops.flatMap((top) => [top, ...inside(top)]).map((path) => lstatSync(path).mtimeMs),
        );
        if (recordIn(claimOf(root)) === "" ? written >= unclaimedBefore : claimed(root)) continue;
        if (act === "release") await releaseRoot(root);
        left.push(root);
      } catch {
        // Ignore roots modified concurrently during the sweep.
      }
    }
  }
  return left;
}

/**
 * Recursively deletes `root`. If a seat revoked directory permissions (such as `chmod 0`),
 * restores owner `0700` permissions without following symlinks and retries deletion.
 */
async function removeWhole(root: string): Promise<void> {
  try {
    await rm(root, { recursive: true, force: true });
    return;
  } catch {
    const open = (dir: string): void => {
      chmodSync(dir, 0o700);
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) open(join(dir, entry.name));
      }
    };
    open(root);
  }
  await rm(root, { recursive: true, force: true });
}

/**
 * Darwin equivalent of tearing down a Linux PID namespace: sends `SIGKILL` to every process whose
 * working directory or executable lies inside `root`, every process in `group`, and all of their
 * live descendants. Loops until two consecutive listings find no holders (avoiding a fork race
 * between listing and killing) or until one second elapses.
 */
export function endHolders(root: string, group?: number, table: typeof processTable = processTable): void {
  if (runtimeProcess.platform !== "darwin" || !existsSync(root)) return;
  // `libproc` reports canonical paths (for example, `/private/var` rather than `/var`).
  const real = realpathSync.native(root);
  const until = performance.now() + 1000;
  for (let settled = true; performance.now() < until; ) {
    const holders = holdersOf(real, group, table());
    if (holders.length === 0 && settled) return;
    settled = holders.length === 0;
    for (const pid of holders) {
      try {
        runtimeProcess.kill(pid, "SIGKILL");
      } catch {
        // Process exited between listing and `SIGKILL`.
      }
    }
  }
}

/** Returns PIDs from `rows` (excluding `launchd` and the current process) whose working directory
 *  or executable resides in `root`, or whose process group equals `group`, plus all descendants. */
function holdersOf(root: string, group: number | undefined, rows: ReturnType<typeof processTable>): number[] {
  const inRoot = (path: string | null) => path !== null && (path === root || path.startsWith(`${root}/`));
  const table = rows.filter(({ pid }) => pid > 1 && pid !== runtimeProcess.pid);
  const found = new Set(
    table.filter((row) => row.pgid === group || inRoot(row.cwd) || inRoot(row.program)).map(({ pid }) => pid),
  );
  for (let size = -1; size !== found.size; ) {
    size = found.size;
    for (const { pid, ppid } of table) if (found.has(ppid)) found.add(pid);
  }
  return [...found];
}
