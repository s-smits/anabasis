// A seat's root: claimed once, refused a second claim, and released with its commands' leftovers ended;
// a sweep never releases a root a live process holds (`src/wall/seat-root.ts`).
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
const there = (path: string): boolean => lstatSync(path, { throwIfNoEntry: false }) !== undefined;
const claimOf = (root: string): string => `${root}.owner`;
const quoted = (...parts: string[]): string => JSON.stringify(join(...parts));

function claimant(root: string) {
  const source = [
    `const { claimRoot, hostFolder } = await import(${quoted(import.meta.dir, "..", "src", "wall", "seat-root.ts")});`,
    `const { mkdirSync } = await import(${quoted(import.meta.dir, "..", "src", "meta", "filesystem.ts")});`,
    `await claimRoot(${quoted(root)});`,
    `mkdirSync(hostFolder(${quoted(root)}));`,
    `mkdirSync(${quoted(root, "home")});`,
    "await Bun.sleep(60_000);",
  ];
  return Bun.spawn([capturedExecPath, "-e", source.join("\n")], { stdio: ["ignore", "ignore", "inherit"] });
}

function aged(days: number, ...paths: string[]): void {
  const then = new Date(Date.now() - days * DAY);
  for (const path of paths) utimesSync(path, then, then);
}

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
  // A second claim's cleanup must not remove the first's command profiles under one session id.
  it("is claimed once, refused to a second claim before anything in it is touched, and free again once released", async () => {
    const { parent, root } = unclaimed();
    const release = await claimRoot(root);
    mkdirSync(join(root, "home"));
    await expect(claimRoot(root)).rejects.toThrow("EEXIST");
    expect(existsSync(join(root, "home"))).toBe(true);
    await release();
    expect(existsSync(root)).toBe(false);
    await (await claimRoot(root))();
    rmSync(parent, { recursive: true, force: true });
  });

  it.skipIf(!onDarwin)("keeps its claim where the root outlives a failed release", async () => {
    const { parent, root } = unclaimed();
    const release = await claimRoot(root);
    const stuck = join(root, "stuck");
    mkdirSync(stuck);
    Bun.spawnSync(["/usr/bin/chflags", "uchg", stuck]);
    try {
      await expect(release()).rejects.toThrow();
      expect(existsSync(root)).toBe(true);
      for (const until = performance.now() + 250; performance.now() < until; await Bun.sleep(10)) {
        expect(there(claimOf(root))).toBe(true);
      }
    } finally {
      Bun.spawnSync(["/usr/bin/chflags", "nouchg", stuck]);
      await releaseRoot(root);
      rmSync(parent, { recursive: true, force: true });
    }
  });

  // A command the host kills must not leave its child running, which would write its home again
  // after the release and run on, forking.
  it.skipIf(!onDarwin)(
    "ends a process working in it, and spares one working beside it",
    async () => {
      const { parent, root } = unclaimed();
      await claimRoot(root);
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

  it.skipIf(!onDarwin)(
    "ends a process running a program from it, wherever that process works",
    async () => {
      const { parent, root } = unclaimed();
      const release = await claimRoot(root);
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

  // A killed parent can finish a fork between a pass's listing and its read, so its child shows up a
  // pass later.
  it.skipIf(!onDarwin)(
    "ends a child no listing held until its parent read as gone",
    async () => {
      const { parent, root } = unclaimed();
      await claimRoot(root);
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

  it.skipIf(!onDarwin)(
    "ends a loop that forks children which live on, and every child it forked",
    async () => {
      const { parent, root } = unclaimed();
      await claimRoot(root);
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
    const release = await claimRoot(root);
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

  // A killed campaign releases nothing and says nothing of whose its roots were, so roots and verifier
  // cells would pile up on a host.
  it("is released by a sweep once its claimant is gone, and never while that process lives", async () => {
    const { parent, root } = unclaimed();
    const holder = claimant(root);
    try {
      await ready(() => existsSync(join(root, "home")));
      aged(30, join(root, "home"), root, hostFolder(root));
      expect(await releaseLeft([parent], Date.now() + DAY, "release")).toEqual([]);
      expect(existsSync(join(root, "home"))).toBe(true);
      holder.kill("SIGKILL");
      await holder.exited;
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

  // A drafting seat stopped and seeded afresh under its name must not be refused its root by the one
  // its killed predecessor left.
  it("is released by the next claim of it once its claimant is gone, and refused to it while that process lives", async () => {
    const { parent, root } = unclaimed();
    const holder = claimant(root);
    try {
      await ready(() => existsSync(join(root, "home")));
      await expect(claimRoot(root)).rejects.toThrow("EEXIST");
      expect(existsSync(join(root, "home"))).toBe(true);
      holder.kill("SIGKILL");
      await holder.exited;
      // Two concurrent claims racing on the dead claimant's root must let only one win and leave
      // its live root intact.
      const raced = await Promise.allSettled([claimRoot(root), claimRoot(root)]);
      const won = raced.flatMap((each) => (each.status === "fulfilled" ? [each.value] : []));
      const lost = raced.flatMap((each) => (each.status === "rejected" ? [String(each.reason)] : []));
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(lost[0]).toContain("EEXIST");
      expect([existsSync(join(root, "home")), there(hostFolder(root)), claimed(root)]).toEqual([
        false,
        false,
        true,
      ]);
      await won[0]?.();
    } finally {
      holder.kill("SIGKILL");
      await holder.exited;
      rmSync(parent, { recursive: true, force: true });
    }
  }, 20_000);

  // A tree from before the claim names no owner, so only its age speaks, and a root a run still names
  // is its caller's to hold.
  it("takes an unclaimed root only once nothing has written it since the bound, and none it is told to spare", async () => {
    const parent = mkdtempSync(join(tmpdir(), "ana-seat-root-"));
    const at = (name: string) => join(parent, name);
    for (const name of ["old", "fresh", "named", "written"]) {
      mkdirSync(join(at(name), "home"), { recursive: true });
    }
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

  // Claude Code works in its home in the host's folder and outlives its query's close, writing its
  // state into a folder already removed.
  it.skipIf(!onDarwin)(
    "ends a process working in the host's folder, so nothing is written back after the release",
    async () => {
      const { parent, root } = unclaimed();
      const release = await claimRoot(root);
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
