/**
 * A seat's root: the one folder a solve's, a Builder session's or an Examiner session's commands
 * write, claimed before the seat's first command and removed after its last, with whatever its
 * commands left running. On both platforms it is a folder of the host's disk.
 *
 * A root is claimed by a link beside it that names the claiming process (`src/meta/holder.ts`), so
 * what a killed process left is told from what a live one holds by a fact and never by a name or
 * an age: `releaseLeft` releases the first and passes the second. Until 16 November nothing said
 * whose a root was. A stop released the roots its run's log named, and nothing else was ever
 * removed: on the operator's macOS host 111 seat roots, 19,697 host folders, 49 verifier cells
 * with their check programs and 419 homes of Claude Code stood that day.
 *
 * Until 19 October Darwin mounted a sparse APFS image of 2 GiB at the root, as a cap on the disk a
 * seat could fill, and Linux, where an unprivileged host has neither a loop mount nor a quota,
 * capped nothing. The cap almost never bound: of 28,309 finished solves on the operator's macOS
 * host the median home held 0.4 MiB, the 99th percentile 232 MiB and the largest 1.47 GiB, and of
 * the 15 "No space left on device" in the record 2 were inside solves, neither of which lost its
 * answer to it. Keeping the image cost 397 lines and a run of incidents: cloning a template,
 * waiting out hdiutil calling a device busy on loaded runners, a detach that hung disk
 * arbitration for the whole host (11 October), and images a stopped run left attached. So both
 * platforms now run as Linux did, a seat bounded by its deadline, its model turn limit and the campaign's dollars.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rm,
} from "../meta/filesystem.ts";
import { held, hold, recordIn } from "../meta/holder.ts";
import { dirname, join, resolve } from "../meta/path.ts";
import { runtimeProcess } from "../meta/process.ts";
import { processTable } from "../meta/process-table.ts";

/** Undo `claimRoot`: `releaseRoot` on its root. */
export type ReleaseRoot = () => Promise<void>;

/** The host's folder of the seat whose root is `root`: beside the root, so out of the seat's reach. */
export const hostFolder = (root: string): string => `${root}.host`;

/** Where the claim on `root` is written: beside it, as its host folder is. */
const claimOf = (root: string): string => `${root}.owner`;

/** Write this process's claim on `root`, a folder that exists. */
export function claim(root: string): void {
  hold(claimOf(root));
}

/** Whether a live process claims `root`. */
export const claimed = (root: string): boolean => held(claimOf(root));

/**
 * Create the seat's root with this process's claim on it, and return its release, which the caller
 * runs once the solve or session that holds the root has ended.
 */
export function claimRoot(root: string): ReleaseRoot {
  const at = resolve(root);
  mkdirSync(dirname(at), { recursive: true });
  // Not recursive: a root another solve or Builder session already holds is refused, not shared.
  // Two rounds once ran a Builder session under one id, and the second's cleanup removed the
  // first's command profiles.
  mkdirSync(at, { mode: 0o700 });
  claim(at);
  return () => releaseRoot(at);
}

/**
 * End what still works in `root`, and remove it with its host folder and, last, its claim, so
 * that a release cut part way still says whose the rest was. The solve or session that claimed it
 * does this when it ends; one that was stopped or killed never does, and a stop of its run does it
 * from the root's name in the log (`tools/runs/stop.ts`), and the daily sweep from its claim
 * (`releaseLeft`). A process a seat left behind is ended here, where the root it works in goes: on
 * 9 October one ran on at 80 forks a second after its solve.
 *
 * The holders end before this returns its promise, and the removal runs off this thread, so a
 * solve reads its verdict beside it (`attemptSolve`): a home of 7,372 entries and 205 MB, as an
 * esp32 solver leaves with a solver library in a virtual environment, took 356 to 416 ms to remove
 * on the operator's macOS host (22 October).
 */
export async function releaseRoot(root: string): Promise<void> {
  endHolders(root);
  // The host's folder too: a seat's Claude Code works in its home there, and lives on for up to
  // three seconds after its query closes, writing its state back into a folder removed under it.
  // Until 16 November that left 19,697 host folders behind solves that had ended well.
  endHolders(hostFolder(root));
  await removeWhole(root);
  await rm(hostFolder(root), { recursive: true, force: true });
  await rm(claimOf(root), { force: true });
}

/** The entries at the top of `folder`, or none where a seat closed it to its owner (`removeWhole`). */
function inside(folder: string): string[] {
  try {
    return readdirSync(folder).map((name) => join(folder, name));
  } catch {
    return [];
  }
}

/**
 * Release every root under `parents` that nobody will release: one whose claimant is gone, at
 * once, since a claim names a process and a dead process releases nothing; and one with no claim,
 * which only a tree from before 16 November or a kill between a root's creation and its claim
 * leaves, once nothing has written it since `unclaimedBefore`. A root a live process claims stands
 * whatever its age, and so does one in `spared`, which its caller holds for another owner. Returns
 * the roots it released, or those it would have where `act` is `describe`.
 *
 * A root that changes under the sweep, as one its own process is releasing does, is passed: the
 * next sweep reads it again.
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
        // Last written when the root or its host folder was, or an entry at the top of either.
        const tops = [root, hostFolder(root)].filter((top) => existsSync(top));
        const written = Math.max(
          ...tops.flatMap((top) => [top, ...inside(top)]).map((path) => lstatSync(path).mtimeMs),
        );
        if (recordIn(claimOf(root)) === "" ? written >= unclaimedBefore : claimed(root)) continue;
        if (act === "release") await releaseRoot(root);
        left.push(root);
      } catch {
        // Changed under the sweep.
      }
    }
  }
  return left;
}

/**
 * Removes `root` and all it holds. A seat may close a folder to itself, as `chmod 0` does, and a
 * folder nobody can list cannot be emptied: on Linux the release threw EACCES on one and took its
 * solve with it (18 October, the solve test "judges an answer whose home cannot be walked" run on
 * Bubblewrap). Each folder is opened to its owner again, a link never followed, and the removal
 * tried once more.
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
 * Darwin's, as Linux ends a pid namespace: kill every process working in `root` or running a
 * program from it, every process of `group` where a walled command's end names its process group
 * (`runWalled`), and every live descendant of those, in passes while one that forks leaves
 * another. A descendant is found by its parent, as Bun's `--no-orphans` walks them, which catches
 * one that left the group with `setsid` while its parent lives; one that left both the group and
 * the root after its parent ended is out of reach. Each pass kills from one listing, since a kill
 * changes what the next listing shows.
 *
 * The passes end at the second in a row that finds nothing to kill, or after a second. One
 * empty pass after a kill proves nothing: a pass lists the pids and then reads each, and a killed
 * parent can finish a fork in between, so that it reads as gone while its child is in no listing
 * yet. With eight loops forking at once, a release that ended at its first empty pass, or after
 * five, left a child running in 4 of 800 (11 November); ending at the second left none in 1,920,
 * the longest taking 349 ms.
 */
export function endHolders(root: string, group?: number, table: typeof processTable = processTable): void {
  if (runtimeProcess.platform !== "darwin" || !existsSync(root)) return;
  // libproc names a file by its real path, and a root under /var is /private/var to it.
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
        // Gone between the listing and the kill.
      }
    }
  }
}

/** The pids of `rows`, but this process's and launchd's, whose working directory or program lies in
 *  `root` (`processTable`, libproc, which reads them as lsof named them: by their real paths), or whose
 *  process group is `group`, with every descendant of theirs. */
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
