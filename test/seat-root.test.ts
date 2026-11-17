// A seat's root, executed: claimed once, refused to a second claim, and released with whatever its
// commands left working in it. On Linux a seat's leftovers end with its pid namespace, so only the
// claim and the removal are read there (`src/wall/seat-root.ts`). Then what a killed claimant
// leaves: a sweep releases it by its claim, and never a root a live process holds.
import { describe, expect, it } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  utimesSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { processTable } from "../src/meta/process-table.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { hostScratch } from "../src/wall/policy.ts";
import {
  claimed,
  claimRoot,
  endHolders,
  hostFolder,
  releaseLeft,
  releaseRoot,
} from "../src/wall/seat-root.ts";

const onDarwin = runtimeProcess.platform === "darwin";
const DAY = 86_400_000;
/** Whether `path` is there, as a claim whose link points nowhere is too. */
const there = (path: string): boolean => lstatSync(path, { throwIfNoEntry: false }) !== undefined;
/** Where the claim on `root` is written. */
const claimOf = (root: string): string => `${root}.owner`;
const quoted = (...parts: string[]): string => JSON.stringify(join(...parts));

/** A process of its own that claims `root`, as a campaign claims a solve's, makes its host folder
 *  and a home, and waits to be killed. */
function claimant(root: string) {
  const source = [
    `const { claimRoot, hostFolder } = await import(${quoted(import.meta.dir, "..", "src", "wall", "seat-root.ts")});`,
    `const { mkdirSync } = await import(${quoted(import.meta.dir, "..", "src", "meta", "filesystem.ts")});`,
    `claimRoot(${quoted(root)});`,
    `mkdirSync(hostFolder(${quoted(root)}));`,
    `mkdirSync(${quoted(root, "home")});`,
    "await Bun.sleep(60_000);",
  ];
  return Bun.spawn([capturedExecPath, "-e", source.join("\n")], { stdio: ["ignore", "ignore", "inherit"] });
}

/** `paths` as last written `days` ago, deepest first: a folder made in another moves that one's time. */
function aged(days: number, ...paths: string[]): void {
  const then = new Date(Date.now() - days * DAY);
  for (const path of paths) utimesSync(path, then, then);
}

/** A root under a fresh parent, not yet claimed, and the parent to remove after. */
function unclaimed(): { parent: string; root: string } {
  const parent = mkdtempSync(join(tmpdir(), "ana-seat-root-"));
  return { parent, root: join(parent, "solve") };
}

async function ready(check: () => boolean): Promise<void> {
  const deadline = performance.now() + 1000;
  while (!check() && performance.now() < deadline) await Bun.sleep(10);
  expect(check()).toBe(true);
}

describe("a seat's root", () => {
  // Two rounds once ran a Builder session under one id: the second claim's cleanup removed the
  // first's command profiles under it.
  it("is claimed once, refused to a second claim before anything in it is touched, and free again once released", async () => {
    const { parent, root } = unclaimed();
    const release = claimRoot(root);
    mkdirSync(join(root, "home"));
    expect(() => claimRoot(root)).toThrow("EEXIST");
    expect(existsSync(join(root, "home"))).toBe(true);
    await release();
    expect(existsSync(root)).toBe(false);
    // Released, it can be claimed again, as a session run again under its id claims it.
    await claimRoot(root)();
    rmSync(parent, { recursive: true, force: true });
  });

  // A command the host killed left its child running, which wrote its home again after the
  // release, and ran on at 80 forks a second (2026-10-09).
  it.skipIf(!onDarwin)(
    "ends a process working in it, and spares one working beside it",
    async () => {
      const { parent, root } = unclaimed();
      claimRoot(root);
      const home = join(root, "home");
      mkdirSync(home);
      const beside = join(parent, "beside");
      mkdirSync(beside);
      const loop = (at: string) =>
        Bun.spawn(["/bin/sh", "-c", `while :; do mkdir -p ${at}/cache; echo x > ${at}/cache/f; done`], {
          cwd: at,
          stdio: ["ignore", "ignore", "ignore"],
        });
      const left = loop(home);
      const spared = loop(beside);
      try {
        await ready(() => existsSync(join(home, "cache", "f")) && existsSync(join(beside, "cache", "f")));
        await releaseRoot(root);
        await left.exited;
        expect(left.signalCode).toBe("SIGKILL");
        expect(spared.exitCode).toBeNull();
        expect(existsSync(root)).toBe(false);
      } finally {
        spared.kill("SIGKILL");
        await spared.exited;
        rmSync(parent, { recursive: true, force: true });
      }
    },
    20_000,
  );

  // A process may leave the root as its working directory and still run a program the seat built.
  it.skipIf(!onDarwin)(
    "ends a process running a program from it, wherever that process works",
    async () => {
      const { parent, root } = unclaimed();
      const release = claimRoot(root);
      const program = join(root, "sleeper");
      copyFileSync("/bin/sleep", program);
      chmodSync(program, 0o755);
      const left = Bun.spawn([program, "60"], {
        cwd: realpathSync.native(tmpdir()),
        stdio: ["ignore", "ignore", "ignore"],
      });
      try {
        await ready(() =>
          processTable().some((row) => row.pid === left.pid && row.program === realpathSync(program)),
        );
        endHolders(root);
        await left.exited;
        expect(left.signalCode).toBe("SIGKILL");
      } finally {
        left.kill("SIGKILL");
        await release();
        rmSync(parent, { recursive: true, force: true });
      }
    },
    20_000,
  );

  // A killed parent can finish a fork between a pass's listing and the pass's read of it: it then
  // reads as gone, and its child is in no listing until the next. The listing here keeps the second
  // process back until the pass after the one that read the first as gone.
  it.skipIf(!onDarwin)(
    "ends a child no listing held until its parent read as gone",
    async () => {
      const { parent, root } = unclaimed();
      claimRoot(root);
      const home = join(root, "home");
      mkdirSync(home);
      const working = () =>
        Bun.spawn(["/bin/sleep", "60"], { cwd: home, stdio: ["ignore", "ignore", "ignore"] });
      const first = working();
      const child = working();
      const reads = (pid: number, rows = processTable()) =>
        rows.some((row) => row.pid === pid && row.cwd !== null);
      let gone = false;
      const listing = () => {
        const rows = processTable();
        const shown = gone ? rows : rows.filter(({ pid }) => pid !== child.pid);
        gone ||= !reads(first.pid, rows);
        return shown;
      };
      try {
        await ready(() => reads(first.pid) && reads(child.pid));
        endHolders(root, undefined, listing);
        await ready(() => first.signalCode === "SIGKILL" && child.signalCode === "SIGKILL");
      } finally {
        first.kill("SIGKILL");
        child.kill("SIGKILL");
        await releaseRoot(root);
        rmSync(parent, { recursive: true, force: true });
      }
    },
    20_000,
  );

  // The release's passes run a few milliseconds apart since the listing became libproc's, where each
  // waited 240 ms on lsof: a child forked between a pass's listing and its kill is the next pass's.
  it.skipIf(!onDarwin)(
    "ends a loop that forks children which live on, and every child it forked",
    async () => {
      const { parent, root } = unclaimed();
      claimRoot(root);
      const home = join(root, "home");
      mkdirSync(home);
      const marker = `61.${String(runtimeProcess.pid)}`;
      const alive = () =>
        Bun.spawnSync(["/usr/bin/pgrep", "-f", `sleep ${marker}`])
          .stdout.toString()
          .trim()
          .split("\n")
          .filter(Boolean).length;
      const loop = Bun.spawn(["/bin/sh", "-c", `while :; do /bin/sleep ${marker} & done`], {
        cwd: home,
        stdio: ["ignore", "ignore", "ignore"],
      });
      try {
        await ready(() => alive() > 0);
        expect(alive()).toBeGreaterThan(0);
        await releaseRoot(root);
        await loop.exited;
        expect(loop.signalCode).toBe("SIGKILL");
        expect(alive()).toBe(0);
      } finally {
        loop.kill("SIGKILL");
        await releaseRoot(root);
        Bun.spawnSync(["/usr/bin/pkill", "-9", "-f", `sleep ${marker}`]);
        rmSync(parent, { recursive: true, force: true });
      }
    },
    20_000,
  );
});

describe("what a seat left", () => {
  it("is let go whole by its release: the root, the host's folder beside it and the claim", async () => {
    const { parent, root } = unclaimed();
    const release = claimRoot(root);
    mkdirSync(join(hostFolder(root), "model"), { recursive: true });
    expect(claimed(root)).toBe(true);
    await release();
    expect([root, hostFolder(root), claimOf(root)].map(there)).toEqual([false, false, false]);
    expect(claimed(root)).toBe(false);
    rmSync(parent, { recursive: true, force: true });
  });

  it("claims a folder of the host's scratch as it is made, and lets it go the same way", async () => {
    const folder = hostScratch("seat-root-test-");
    expect(claimed(folder)).toBe(true);
    await releaseRoot(folder);
    expect([folder, claimOf(folder)].map(there)).toEqual([false, false]);
  });

  // A campaign that was killed released nothing, and nothing said whose its roots were: on
  // 16 November 111 roots and 49 verifier cells stood on one host.
  it("is released by a sweep once its claimant is gone, and never while that process lives", async () => {
    const { parent, root } = unclaimed();
    const holder = claimant(root);
    try {
      await ready(() => existsSync(join(root, "home")));
      // Whatever the bound for an unclaimed root, and however old the root: a live claim holds.
      aged(30, join(root, "home"), root, hostFolder(root));
      expect(await releaseLeft([parent], Date.now() + DAY, "release")).toEqual([]);
      expect(existsSync(join(root, "home"))).toBe(true);
      holder.kill("SIGKILL");
      await holder.exited;
      // Written this instant, and released all the same: a dead claimant releases nothing itself.
      mkdirSync(join(root, "tmp"));
      expect(await releaseLeft([parent], 0, "describe")).toEqual([root]);
      expect(existsSync(join(root, "home"))).toBe(true);
      expect(await releaseLeft([parent], 0, "release")).toEqual([root]);
      expect([root, hostFolder(root), claimOf(root)].map(there)).toEqual([false, false, false]);
    } finally {
      holder.kill("SIGKILL");
      await holder.exited;
      rmSync(parent, { recursive: true, force: true });
    }
  }, 20_000);

  // What a tree from before the claim left: nothing names its owner, so only its age speaks, and a
  // root a run still names is its caller's to hold.
  it("takes an unclaimed root only once nothing has written it since the bound, and none it is told to spare", async () => {
    const parent = mkdtempSync(join(tmpdir(), "ana-seat-root-"));
    const at = (name: string) => join(parent, name);
    for (const name of ["old", "fresh", "named", "written"]) {
      mkdirSync(join(at(name), "home"), { recursive: true });
    }
    // A host's folder whose root went long ago, as 19,697 stood on one host that day.
    mkdirSync(hostFolder(at("orphan")));
    mkdirSync(hostFolder(at("written")));
    aged(
      8,
      join(at("old"), "home"),
      at("old"),
      join(at("named"), "home"),
      at("named"),
      hostFolder(at("orphan")),
    );
    // Old but for the one folder a seat wrote yesterday.
    aged(8, at("written"), hostFolder(at("written")));
    aged(1, join(at("written"), "home"));
    const released = await releaseLeft(
      [parent, at("no-such-parent")],
      Date.now() - 7 * DAY,
      "release",
      new Set([at("named")]),
    );
    expect(released.toSorted()).toEqual([at("old"), at("orphan")]);
    expect([at("old"), hostFolder(at("orphan"))].map(there)).toEqual([false, false]);
    expect(["fresh", "named", "written"].map((name) => there(at(name)))).toEqual([true, true, true]);
    expect(there(hostFolder(at("written")))).toBe(true);
    rmSync(parent, { recursive: true, force: true });
  });

  // Claude Code works in its home in the host's folder and lives on after its query closes: it
  // wrote its state into a folder already removed, behind 19,697 solves that had ended well.
  it.skipIf(!onDarwin)(
    "ends a process working in the host's folder, so nothing is written back after the release",
    async () => {
      const { parent, root } = unclaimed();
      const release = claimRoot(root);
      const model = join(hostFolder(root), "model");
      const caches = join(model, "Library", "Caches");
      mkdirSync(model, { recursive: true });
      const late = Bun.spawn(["/bin/sh", "-c", 'while :; do mkdir -p "$0"; touch "$0/f"; done', caches], {
        cwd: model,
        stdio: ["ignore", "ignore", "ignore"],
      });
      try {
        await ready(() => existsSync(join(caches, "f")));
        await release();
        await late.exited;
        expect(late.signalCode).toBe("SIGKILL");
        expect(there(hostFolder(root))).toBe(false);
      } finally {
        late.kill("SIGKILL");
        await late.exited;
        rmSync(parent, { recursive: true, force: true });
      }
    },
    20_000,
  );
});
