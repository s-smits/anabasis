/**
 * The disk cap on one solve: a root holding every directory the solve's commands may write, and the
 * most bytes that root may hold. Neither v1 nor the sweep this repository's plan targets capped disk,
 * so a solve that filled the host's disk took every concurrent solve and the controller down with
 * it.
 *
 * The two hosts cap in different places. On Linux the worker's Bubblewrap launch mounts a tmpfs of
 * `bytes` at the root (`isolationArgv` in `solve-sandbox.ts`), so the cap exists only inside the
 * worker's namespace and its contents vanish when that namespace ends. That is accepted: the answer
 * and the trace cross the worker's pipe, not the disk. It also means the root is empty when the
 * worker starts, whatever the host put there, so a solve's layout under it is made from inside.
 * Darwin has no mount namespace, so `mountDiskCap` attaches a sparse APFS image of `bytes` at the
 * root on the host before the worker starts; measured on an M3 Pro under macOS 15.7, creating a 64 MiB
 * image took about 1 s, attaching it about 0.2 s, and a `dd` of 200 MB into it stopped at 61 MB with
 * ENOSPC.
 *
 * What stays uncapped. On Darwin the command profile in `solve-command-isolation.ts` also lets a
 * command write the user temporary root system toolchains take through `confstr`, and `/tmp`, both
 * outside the root. On Linux the command wall overmounts `/tmp` and the host temporary directory with
 * writable tmpfs of the kernel's default size, which is memory rather than disk. Those are the
 * remaining paths a solve's commands can fill. The worker itself, host code under an allow-default
 * wall, writes outside the root as well.
 */
import { mkdirSync, rmSync, statSync } from "../meta/filesystem.ts";
import { dirname, resolve } from "../meta/path.ts";
import { runtimeProcess } from "../meta/process.ts";

export interface DiskCap {
  /** The one directory the solve's writable roots (work, home, temp) all sit inside. */
  readonly root: string;
  readonly bytes: number;
}

/** Undo `mountDiskCap`: `releaseDiskCap` on its root. */
export type ReleaseDiskCap = () => Promise<void>;

/** hdiutil sizes in 512-byte sectors; its `-size 1b` means a sector too, not a byte. */
const SECTOR_BYTES = 512;

async function hdiutil(args: readonly string[]): Promise<string | null> {
  const child = Bun.spawn(["/usr/bin/hdiutil", ...args], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return code === 0 ? null : `hdiutil ${args[0]} exited ${code}: ${stderr.trim()}`;
}

/** Move the spent image to the Trash rather than unlinking it, so a release that ran against the
 *  wrong path can still be undone by hand. */
async function trash(path: string): Promise<void> {
  await Bun.spawn(["/usr/bin/trash", path], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).exited;
}

/**
 * Create the cap's root and, on Darwin, mount a volume of `cap.bytes` there. Returns the release,
 * which the caller runs once the solve's worker has exited. On Linux the root is only created,
 * because the worker's own launch applies the cap.
 */
export async function mountDiskCap(cap: DiskCap): Promise<ReleaseDiskCap> {
  const root = resolve(cap.root);
  mkdirSync(dirname(root), { recursive: true });
  // Not recursive: a root another solve or Builder session already holds is refused, not shared.
  mkdirSync(root, { mode: 0o700 });
  if (runtimeProcess.platform !== "darwin") return () => releaseDiskCap(root);
  // Beside the root rather than inside it, so the image is not part of what it caps.
  const image = `${root}.sparseimage`;
  const sectors = String(Math.ceil(cap.bytes / SECTOR_BYTES));
  const created = await hdiutil([
    "create",
    "-sectors",
    sectors,
    "-type",
    "SPARSE",
    "-fs",
    "APFS",
    "-volname",
    "disk-cap",
    "-quiet",
    image,
  ]);
  if (created !== null) throw new Error(created);
  const attached = await hdiutil([
    "attach",
    "-nobrowse",
    "-noautoopen",
    "-owners",
    "on",
    "-quiet",
    "-mountpoint",
    root,
    image,
  ]);
  if (attached !== null) {
    await trash(image);
    throw new Error(attached);
  }
  return () => releaseDiskCap(root);
}

/**
 * Let go of a root a cap was mounted at: detach its volume, move the image away and remove the
 * empty mountpoint. The solve or session that mounted it does this when it ends. One that was
 * stopped or killed never does, and its root stays attached until a stop of its run releases it
 * (`tools/runs/launch.ts`): six such roots were mounted on one host on 2026-10-08, two of them a
 * Builder's with a third of a gigabyte each.
 *
 * A root with no volume at it is released too. A solve stopped inside its mount or inside its own
 * release leaves the folder and the image and nothing attached, and a detach of that exits 1 with
 * "No such file or directory". Three of four solves stopped two seconds after they started were
 * left so, and the stop gave up at the first (2026-10-08).
 *
 * A process the solve left behind is ended here, where the root it works in goes. A command's own
 * exit reaps what it started (`stageCommandIsolation`), and a command the host kills never runs
 * that: its children live on under launchd with the volume as their working directory. The forced
 * detach closed their files and left them running, and one that then wrote its home made the bare
 * mountpoint again, so the release threw on a folder that was not empty and took a round and its
 * three other solves with it; the process ran on at 80 forks a second (2026-10-09). So whatever
 * holds a file on a volume that will not detach is killed first, and what a process wrote into the
 * mountpoint after the volume went is removed with it.
 */
export async function releaseDiskCap(root: string): Promise<void> {
  if (runtimeProcess.platform === "darwin") {
    // A mountpoint is on another device than its parent.
    if (statSync(root).dev !== statSync(dirname(root)).dev) {
      // "resource busy" is a file open on the volume, a working directory among them.
      const detached = await hdiutil(["detach", root, "-quiet"]);
      if (detached !== null) {
        await endHolders(root);
        const forced = await hdiutil(["detach", root, "-force", "-quiet"]);
        if (forced !== null) throw new Error(forced);
      }
    }
    await trash(`${root}.sparseimage`);
  }
  rmSync(root, { recursive: true, force: true });
}

/** Kill every process with a file open on the volume at `root`, and again while one that forks
 *  leaves another: a few passes, since the forced detach takes whatever outlasts them. */
async function endHolders(root: string): Promise<void> {
  for (let pass = 0; pass < 5; pass++) {
    const listed = Bun.spawn(["/usr/sbin/lsof", "-t", "+f", "--", root], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    });
    const holders = (await new Response(listed.stdout).text()).split("\n").map(Number);
    const others = holders.filter((pid) => pid > 1 && pid !== runtimeProcess.pid);
    if (others.length === 0) return;
    for (const pid of others) {
      try {
        runtimeProcess.kill(pid, "SIGKILL");
      } catch {
        // Gone between the listing and the kill.
      }
    }
  }
}
