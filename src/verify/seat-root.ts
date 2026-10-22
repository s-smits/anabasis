/**
 * A seat's root: the one folder a solve's, a Builder session's or an Examiner session's commands
 * write, claimed before the seat's first command and removed after its last, with whatever its
 * commands left running. On both platforms it is a folder of the host's disk.
 *
 * Until 19 October Darwin mounted a sparse APFS image of 2 GiB at the root, as a cap on the disk a
 * seat could fill, and Linux, where an unprivileged host has neither a loop mount nor a quota,
 * capped nothing. The cap almost never bound: of 28,309 finished solves on the operator's macOS
 * host the median home held 0.4 MiB, the 99th percentile 232 MiB and the largest 1.47 GiB, and of
 * the 15 "No space left on device" in the record 2 were inside solves, neither of which lost its
 * answer to it. Keeping the image cost 397 lines and a run of incidents: cloning a template,
 * waiting out hdiutil calling a device busy on loaded runners, a detach that hung disk
 * arbitration for the whole host (11 October), and images a stopped run left attached. So both
 * platforms now run as Linux did, a seat bounded by its wall, its turns and the campaign's dollars.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync } from "../meta/filesystem.ts";
import { dirname, join, resolve } from "../meta/path.ts";
import { runtimeProcess } from "../meta/process.ts";
import { processPaths } from "../meta/process-table.ts";

/** Undo `claimRoot`: `releaseRoot` on its root. */
export type ReleaseRoot = () => void;

/**
 * Create the seat's root, and return its release, which the caller runs once the solve or session
 * that holds the root has ended.
 */
export function claimRoot(root: string): ReleaseRoot {
  const at = resolve(root);
  mkdirSync(dirname(at), { recursive: true });
  // Not recursive: a root another solve or Builder session already holds is refused, not shared.
  // Two rounds once ran a Builder session under one id, and the second's cleanup removed the
  // first's command profiles.
  mkdirSync(at, { mode: 0o700 });
  return () => releaseRoot(at);
}

/**
 * End what still works in `root`, and remove it. The solve or session that claimed it does this
 * when it ends; one that was stopped or killed never does, and a stop of its run does it from the
 * root's name in the log (`tools/runs/stop.ts`). A process a seat left behind is ended here, where
 * the root it works in goes: on 9 October one ran on at 80 forks a second after its solve.
 */
export function releaseRoot(root: string): void {
  endHolders(root);
  removeWhole(root);
}

/**
 * Removes `root` and all it holds. A seat may close a folder to itself, as `chmod 0` does, and a
 * folder nobody can list cannot be emptied: on Linux the release threw EACCES on one and took its
 * solve with it (18 October, the solve test "judges an answer whose home cannot be walked" run on
 * Bubblewrap). Each folder is opened to its owner again, a link never followed, and the removal
 * tried once more.
 */
function removeWhole(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true });
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
  rmSync(root, { recursive: true, force: true });
}

/**
 * Darwin's, as Linux ends a pid namespace: kill every process working in `root` or running a
 * program from it, for a few passes while one that forks leaves another. Each walled command's end
 * calls this too (`runWalled`), for what left the command's group or outran its exit trap.
 */
export function endHolders(root: string): void {
  if (runtimeProcess.platform !== "darwin" || !existsSync(root)) return;
  // libproc names a file by its real path, and a root under /var is /private/var to it.
  const real = realpathSync.native(root);
  for (let pass = 0; pass < 5; pass++) {
    const holders = holdersOf(real);
    if (holders.length === 0) return;
    for (const pid of holders) {
      try {
        runtimeProcess.kill(pid, "SIGKILL");
      } catch {
        // Gone between the listing and the kill.
      }
    }
  }
}

/** The pids, but this process's and launchd's, whose working directory or program lies in `root`
 *  (`processPaths`, libproc, which reads them as lsof named them: by their real paths). */
function holdersOf(root: string): number[] {
  const inRoot = (path: string | null) => path !== null && (path === root || path.startsWith(`${root}/`));
  return processPaths()
    .filter(
      ({ pid, cwd, program }) => pid > 1 && pid !== runtimeProcess.pid && (inRoot(cwd) || inRoot(program)),
    )
    .map(({ pid }) => pid);
}
