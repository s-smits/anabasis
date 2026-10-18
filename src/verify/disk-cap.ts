/**
 * The disk cap on one solve: a root holding every directory the solve's commands may write, and the
 * most bytes that root may hold. v1 capped no disk, so a solve that filled the host's disk took
 * every concurrent solve and the controller down with it.
 *
 * Only Darwin caps. There `mountDiskCap` attaches a sparse APFS image of `bytes` at the root on
 * the host before anything runs; measured on an M3 Pro under macOS 15.7, creating a 64 MiB image
 * took about 1 s, attaching it about 0.2 s, and a `dd` of 200 MB into it stopped at 61 MB with
 * ENOSPC. So the image is made once a size and each mount clones it (`emptyImage`). On Linux nothing caps a solve, a Builder session or an Examiner session: each runs its
 * commands under the command wall (`stageCommandIsolation`), which binds the seat's root from
 * the host's disk read-write and mounts no tmpfs there, since the root has to survive from one
 * command to the next. So on Linux `mountDiskCap` makes the root and `diskBytes` binds nothing
 * there: nine Builder sessions and 308 solves finished so on a Linux test host on
 * 9 October. A capped volume on Linux would take a loop mount or a quota, neither of which an
 * unprivileged host has, so the gap is stated here and in AGENTS.md section 10 rather than closed,
 * and a campaign on Linux is bounded by its dollar total and its walls.
 *
 * What stays uncapped. On Darwin the command profile in `solve-command-isolation.ts` also lets a
 * command write the user temporary root system toolchains take through `confstr`, outside the root;
 * `/tmp` it closes. On Linux the command wall overmounts `/tmp` and the host temporary directory with
 * writable tmpfs of the kernel's default size, which is memory rather than disk. Those are the
 * remaining paths a solve's commands can fill. The host process that runs the loop writes outside
 * the root as well.
 */
import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "../meta/filesystem.ts";
import { tmpdir } from "../meta/os.ts";
import { dirname, join, resolve } from "../meta/path.ts";
import { runtimeProcess } from "../meta/process.ts";
import { errorMessage } from "../meta/runtime-values.ts";

interface DiskCap {
  /** The one directory the solve's writable roots (work, home, temp) all sit inside. */
  readonly root: string;
  readonly bytes: number;
}

/** What lists the processes holding a file on a volume and reads a holder's state, how long
 *  either answer may take, and how long a killed holder may stay in uninterruptible wait, as one
 *  in the middle of a write does, before its volume counts as stalled. A test names one that never
 *  answers, and a stall it need not wait ten seconds for. */
interface HolderListing {
  lsof: string;
  ps: string;
  boundMs: number;
  stallMs: number;
}

/**
 * `lsof` and `ps` read the kernel's tables: `lsof` answered in 0.1 s at a host load near 20. Both
 * walk every process, though, and one stuck in the kernel holds the walk: on 2026-10-11 a volume
 * left half unmounted made every `lsof`, `ps -A` and `ps -p` of a stuck pid on the host sit in
 * uninterruptible wait, and each controller that ran one, from every command's end, stopped there.
 * So neither is awaited past the bound, and a listing that runs past it reads as a stalled volume.
 */
const LSOF: HolderListing = { lsof: "/usr/sbin/lsof", ps: "/bin/ps", boundMs: 30_000, stallMs: 10_000 };

/** Undo `mountDiskCap`: `releaseDiskCap` on its root. */
export type ReleaseDiskCap = () => Promise<void>;

/** hdiutil sizes in 512-byte sectors; its `-size 1b` means a sector too, not a byte. */
const SECTOR_BYTES = 512;

/** How often a create or an attach the host answered "Resource busy" is made, and the wait before
 *  the second, doubled before each one after. On 13 October three tests of a macOS CI run failed so
 *  at a load of 15.8 on three cores, and passed when run again. */
const BUSY_TRIES = 4;
const BUSY_MS = 500;

/** Null, or why hdiutil failed in its own words. No call passes `-quiet`, which drops those words:
 *  until 12 October every failure on a loaded runner read "hdiutil detach exited 1:" and no more. */
async function hdiutil(args: readonly string[]): Promise<string | null> {
  const child = Bun.spawn(["/usr/bin/hdiutil", ...args], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return code === 0 ? null : `hdiutil ${args[0]} exited ${code}: ${stderr.trim()}`;
}

/** `hdiutil` with `args`, made again while the host says it is busy, and its last answer. */
async function patiently(args: readonly string[]): Promise<string | null> {
  for (let tried = 1, ms = BUSY_MS; ; tried += 1, ms *= 2) {
    const failed = await hdiutil(args);
    if (failed === null || tried >= BUSY_TRIES || !/resource busy/i.test(failed)) return failed;
    await Bun.sleep(ms);
  }
}

/**
 * An empty volume of `bytes` at `image`, or why there is none: a clone of the one empty image of
 * that size this host keeps under its temporary folder, made there first where it is missing.
 * Measured on an M3 Pro on 18 October, `hdiutil create` of a 64 MiB image took about 1,030 ms and
 * an APFS clone of one 9 ms, beside an attach of about 170 ms; and every solve, Builder session,
 * Examiner shell and walled test case mounts one. Three clones of one image attached at once each
 * kept its own writes. Where the template and the root sit on two volumes, the copy is a byte copy
 * of its few megabytes. The template is made under a name of its own and renamed, so one that
 * exists is whole, whichever of two first mounts made it; the name was the pid and the clock until
 * three caps mounted in one millisecond took one name and two of them failed (18 October).
 */
let making = 0;

async function emptyImage(bytes: number, image: string): Promise<string | null> {
  const sectors = String(Math.ceil(bytes / SECTOR_BYTES));
  const templates = join(tmpdir(), "ana-disk-cap");
  const template = join(templates, `${sectors}.sparseimage`);
  if (!existsSync(template)) {
    mkdirSync(templates, { recursive: true });
    const made = join(
      templates,
      `${sectors}-${String(runtimeProcess.pid)}-${String((making += 1))}.sparseimage`,
    );
    const volume = ["-type", "SPARSE", "-fs", "APFS", "-volname", "disk-cap"];
    const failed = await patiently(["create", "-sectors", sectors, ...volume, made]);
    if (failed !== null) {
      rmSync(made, { force: true });
      return failed;
    }
    renameSync(made, template);
  }
  try {
    copyFileSync(template, image, constants.COPYFILE_FICLONE);
    return null;
  } catch (error) {
    return `the empty image of ${sectors} sectors was not copied: ${errorMessage(error)}`;
  }
}

/**
 * Create the cap's root and, on Darwin, mount a volume of `cap.bytes` there. Returns the release,
 * which the caller runs once the solve or session that holds the root has ended. On Linux the root
 * is only created, and the commands of a solve or a session run uncapped (above).
 */
export async function mountDiskCap(cap: DiskCap): Promise<ReleaseDiskCap> {
  const root = resolve(cap.root);
  mkdirSync(dirname(root), { recursive: true });
  // Not recursive: a root another solve or Builder session already holds is refused, not shared.
  mkdirSync(root, { mode: 0o700 });
  if (runtimeProcess.platform !== "darwin") return () => releaseDiskCap(root);
  // Beside the root rather than inside it, so the image is not part of what it caps.
  const image = `${root}.sparseimage`;
  const failed =
    (await emptyImage(cap.bytes, image)) ??
    (await patiently(["attach", "-nobrowse", "-noautoopen", "-owners", "on", "-mountpoint", root, image]));
  if (failed !== null) {
    // What this call made goes, so the root can be claimed again: until 12 October a failed create
    // left it, and a retry failed at EEXIST (the stack review, finding 5). An attach that failed
    // after mounting is released as any volume is, and one left attached keeps its root.
    const left = await releaseDiskCap(root).then(
      () => "",
      (error: unknown) => `; ${errorMessage(error)}`,
    );
    throw new Error(`${failed}${left}`);
  }
  return () => releaseDiskCap(root);
}

/**
 * Let go of a root a cap was mounted at: detach its volume, remove the image and remove the empty
 * mountpoint. The solve or session that mounted it does this when it ends. One that was
 * stopped or killed never does, and its root stays attached until a stop of its run releases it
 * (`tools/runs/stop.ts`): six such roots were mounted on one host on 2026-10-08, two of them a
 * Builder's with a third of a gigabyte each.
 *
 * A root with no volume at it is released too. A solve stopped inside its mount or inside its own
 * release leaves the folder and the image and nothing attached, and a detach of that exits 1 with
 * "No such file or directory". Three of four solves stopped two seconds after they started were
 * left so, and the stop gave up at the first (2026-10-08).
 *
 * A process the solve left behind is ended here, where the root it works in goes. Each command's
 * end already ends what it left on the volume (`runWalled`), so this is for a solve stopped or
 * killed inside a command, and for what outran those passes. The forced detach closed such a
 * process's files and left it running, and one that then wrote its home made the bare
 * mountpoint again, so the release threw on a folder that was not empty and took a round and its
 * three other solves with it; the process ran on at 80 forks a second (2026-10-09). So whatever
 * holds a file on the volume is killed first, and what a process wrote into the mountpoint after
 * the volume went is removed with it.
 *
 * A volume whose I/O has stopped is left attached, and the release throws. Its readers sit in
 * uninterruptible wait, which SIGKILL does not end, and a detach of it waits on that I/O inside
 * disk arbitration, which serves every volume on the host: on 2026-10-11 an Examiner's image
 * stalled under twelve concurrent writers, a forced detach of it hung `diskarbitrationd`, and every
 * seat on the host took minutes to mount after it. A reboot clears such a volume; a detach does not.
 */
export async function releaseDiskCap(root: string, listing: HolderListing = LSOF): Promise<void> {
  if (runtimeProcess.platform === "darwin") {
    // A mountpoint is on another device than its parent.
    const mounted = () => statSync(root).dev !== statSync(dirname(root)).dev;
    if (mounted()) {
      const wedged = await endHolders(root, listing);
      if (wedged !== null) throw new Error(`the volume at ${root} is left attached: ${wedged}`);
      // "resource busy" is a file open on the volume, a working directory among them. A detach
      // that failed with the volume gone, as one exits 1 with "No such file or directory", has
      // released it: on a loaded Darwin runner (12 October) both detaches exited 1 and the
      // release threw, from campaign tests that passed on an idle host.
      const detached = await hdiutil(["detach", root]);
      if (detached !== null && mounted()) {
        const still = await endHolders(root, listing);
        if (still !== null) throw new Error(`the volume at ${root} is left attached: ${still}`);
        const forced = await hdiutil(["detach", root, "-force"]);
        if (forced !== null && mounted()) throw new Error(forced);
      }
    }
    // Unlinked. Until 14 October it went to the Trash, so that a release run against the wrong
    // path could be undone, and every capped solve and session, a test's among them, left one
    // there for a person to empty.
    rmSync(`${root}.sparseimage`, { force: true });
  }
  removeWhole(root);
}

/**
 * Removes `root` and all it holds. A seat may close a folder to itself, as `chmod 0` does, and a
 * folder nobody can list cannot be emptied: on Linux, where the root is a folder of the host's disk
 * and no image, the release threw EACCES on one and took its solve with it (18 October, the solve
 * test "judges an answer whose home cannot be walked" run on Bubblewrap). Each folder is opened to
 * its owner again, a link never followed, and the removal tried once more.
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
 * Darwin's, as Linux ends a pid namespace: kill every process with a file open on the volume at
 * `root`, for a few passes while one that forks leaves another; a forced detach takes the rest.
 * Returns null, or why the volume's I/O has stopped: no listing of its holders within the bound, or
 * a holder still in uninterruptible wait once killed. Each walled command's end calls this too,
 * and the bound is what keeps a stalled volume from holding its controller there.
 */
export async function endHolders(root: string, listing: HolderListing = LSOF): Promise<string | null> {
  if (runtimeProcess.platform !== "darwin") return null;
  for (let pass = 0; pass < 5; pass++) {
    const holders = await holdersOf(root, listing);
    if (holders === null) return `no listing of what holds it came within ${String(listing.boundMs)} ms`;
    if (holders.length === 0) return null;
    for (const pid of holders) {
      try {
        runtimeProcess.kill(pid, "SIGKILL");
      } catch {
        // Gone between the listing and the kill.
      }
    }
  }
  // What survived five passes either forks faster than they ran, which the forced detach takes, or
  // cannot die: a process in uninterruptible wait takes its SIGKILL only when its I/O returns.
  const until = Date.now() + listing.stallMs;
  for (;;) {
    const holders = await holdersOf(root, listing);
    if (holders === null) return `no listing of what holds it came within ${String(listing.boundMs)} ms`;
    // `ps` state, `U` first for uninterruptible wait. A `ps` of a process stuck in the kernel waits
    // with it, so a state that does not come within the bound reads as that wait.
    const states = await Promise.all(
      holders.map((pid) => answered([listing.ps, "-o", "stat=", "-p", String(pid)], listing.boundMs)),
    );
    const waiting = states.filter((state) => state === null || state.trim().startsWith("U"));
    if (waiting.length === 0) return null;
    if (Date.now() >= until) {
      return `${String(waiting.length)} of its holders stayed in uninterruptible wait for ${String(listing.stallMs)} ms after SIGKILL`;
    }
    await Bun.sleep(500);
  }
}

/** The pids holding a file on the volume at `root` but this process, or null when the listing did
 *  not answer within its bound. A listing stuck on the volume cannot be killed, and is left behind. */
async function holdersOf(root: string, listing: HolderListing): Promise<number[] | null> {
  const answer = await answered([listing.lsof, "-t", "+f", "--", root], listing.boundMs);
  if (answer === null) return null;
  return answer
    .split("\n")
    .map(Number)
    .filter((pid) => pid > 1 && pid !== runtimeProcess.pid);
}

/** What `argv` prints, or null when it has not finished within `boundMs`. A child stuck in the
 *  kernel cannot be killed, and is left behind. */
async function answered(argv: readonly string[], boundMs: number): Promise<string | null> {
  const child = Bun.spawn([...argv], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((done) => {
    timer = setTimeout(() => done(null), boundMs);
  });
  const answer = await Promise.race([new Response(child.stdout).text(), late]);
  clearTimeout(timer);
  return answer;
}
