// The disk cap on Darwin, executed: a volume of the cap's size mounted at the solve's root, the
// command wall's scratch root, and a write past the cap. The Seatbelt rules are path-based, so the
// case runs a command under the real command profile to show they still let it write its home and
// its TMPDIR once those sit on the mounted volume. On Linux nothing caps a seat's disk
// (`src/verify/disk-cap.ts`).
import { spawnTextSync as spawnSync } from "./helpers/bun-spawn-sync.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { describe, expect, it } from "bun:test";
import { runtimeProcess } from "../src/meta/process.ts";
import { endHolders, mountDiskCap, releaseDiskCap } from "../src/verify/disk-cap.ts";
import { commandIsolationPolicy, stageCommandIsolation } from "../src/verify/solve-command-isolation.ts";
import { solveIsolationPolicy } from "../src/verify/solve-sandbox.ts";

const CAP_BYTES = 16 * 1024 * 1024;

describe("the disk cap", () => {
  it.skipIf(runtimeProcess.platform !== "darwin")(
    "refuses a write past the cap under the command wall, and its release leaves no mount behind",
    async () => {
      const parent = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-disk-cap-")));
      const repoRoot = mkdtempSync(join(parent, "repo-"));
      const root = join(parent, "solve");
      const release = await mountDiskCap({ root, bytes: CAP_BYTES });
      try {
        const dirs = { root, kept: join(root, "kept"), home: join(root, "home"), temp: join(root, "tmp") };
        for (const dir of [dirs.kept, dirs.home, dirs.temp]) mkdirSync(dir);
        const base = solveIsolationPolicy({ repoRoot });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        const policy = commandIsolationPolicy(base, dirs);
        const command = [
          `echo h > "$HOME/f" && echo t > "$TMPDIR/f" && echo wrote-both`,
          `dd if=/dev/zero of="$HOME/big" bs=1048576 count=64 2>&1`,
        ].join("; ");
        const result = spawnSync(
          "/bin/sh",
          ["-c", stageCommandIsolation(policy, join(parent, "command.sb"), command, "$$")],
          { cwd: dirs.home, env: policy.environment, timeout: 30_000 },
        );
        const output = `${result.stdout}${result.stderr}`;
        expect(output).toContain("wrote-both");
        expect(output).toContain("No space left on device");
      } finally {
        await release();
      }
      expect(spawnSync("/sbin/mount", []).stdout).not.toContain(root);
      expect(existsSync(root)).toBe(false);
      expect(existsSync(`${root}.sparseimage`)).toBe(false);
      rmSync(parent, { recursive: true, force: true });
    },
  );

  // A solve that is killed never runs its own release. A stop of its run does, and has the root's
  // name from the log and nothing else: four killed solves and two stopped Builder sessions stayed
  // mounted on one host until then (2026-10-08).
  it.skipIf(runtimeProcess.platform !== "darwin")(
    "is released from its root's name alone, mounted or already detached, and the root can be claimed again",
    async () => {
      const parent = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-disk-cap-")));
      const root = join(parent, "solve");
      await mountDiskCap({ root, bytes: CAP_BYTES });
      await releaseDiskCap(root);
      expect(spawnSync("/sbin/mount", []).stdout).not.toContain(root);
      expect(existsSync(root)).toBe(false);
      expect(existsSync(`${root}.sparseimage`)).toBe(false);
      // A solve stopped inside its own release: the volume gone, the folder and the image left.
      await mountDiskCap({ root, bytes: CAP_BYTES });
      expect(spawnSync("/usr/bin/hdiutil", ["detach", root, "-quiet"]).status).toBe(0);
      await releaseDiskCap(root);
      expect(existsSync(root)).toBe(false);
      expect(existsSync(`${root}.sparseimage`)).toBe(false);
      rmSync(parent, { recursive: true, force: true });
    },
  );

  // A command the host killed left its child running on the volume. The forced detach let it live,
  // it wrote its home again, and the release threw on the mountpoint: a round and three more solves
  // went with it (2026-10-09).
  it.skipIf(runtimeProcess.platform !== "darwin")(
    "ends a process a solve left working on the volume, and is released though one wrote on",
    async () => {
      const parent = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-disk-cap-")));
      const root = join(parent, "solve");
      await mountDiskCap({ root, bytes: CAP_BYTES });
      const cache = join(root, "home", "cache");
      const left = Bun.spawn(["/bin/sh", "-c", `while :; do mkdir -p ${cache}; echo x > ${cache}/f; done`], {
        cwd: root,
        stdio: ["ignore", "ignore", "ignore"],
      });
      await Bun.sleep(300);
      await releaseDiskCap(root);
      await left.exited;
      expect(left.signalCode).toBe("SIGKILL");
      expect(spawnSync("/sbin/mount", []).stdout).not.toContain(root);
      expect(existsSync(root)).toBe(false);
      // What a holder wrote between its listing and the detach is debris in the bare mountpoint.
      await mountDiskCap({ root, bytes: CAP_BYTES });
      expect(spawnSync("/usr/bin/hdiutil", ["detach", root, "-quiet"]).status).toBe(0);
      mkdirSync(cache, { recursive: true });
      await releaseDiskCap(root);
      expect(existsSync(root)).toBe(false);
      rmSync(parent, { recursive: true, force: true });
    },
  );

  // A volume whose I/O has stopped holds up whatever reads it, and a detach of it hung disk
  // arbitration for the whole host (2026-10-11). These stand in a listing that never answers for
  // such a volume; a holder in uninterruptible wait, the other sign of one, takes a stalled volume
  // to make.
  it.skipIf(runtimeProcess.platform !== "darwin")(
    "says a volume is stalled when the listing of what holds it does not answer",
    async () => {
      const parent = mkdtempSync(join(tmpdir(), "ana-disk-cap-"));
      const lsof = join(parent, "lsof");
      writeFileSync(lsof, "#!/bin/sh\nexec /bin/sleep 5\n", { mode: 0o755 });
      expect(await endHolders(parent, { lsof, ps: "/bin/ps", boundMs: 200 })).toBe(
        "no listing of what holds it came within 200 ms",
      );
      rmSync(parent, { recursive: true, force: true });
    },
  );

  // `ps` of a process stuck in the kernel waited with it and held its controller (2026-10-11).
  it.skipIf(runtimeProcess.platform !== "darwin")(
    "says a volume is stalled when a killed holder's state does not answer",
    async () => {
      const parent = mkdtempSync(join(tmpdir(), "ana-disk-cap-"));
      const [lsof, ps] = [join(parent, "lsof"), join(parent, "ps")];
      // A pid above the kernel's ceiling: the kill finds no process, and the holder stays listed.
      writeFileSync(lsof, "#!/bin/sh\necho 1000000\n", { mode: 0o755 });
      writeFileSync(ps, "#!/bin/sh\nexec /bin/sleep 5\n", { mode: 0o755 });
      expect(await endHolders(parent, { lsof, ps, boundMs: 200 })).toBe(
        "1 of its holders stayed in uninterruptible wait for 10000 ms after SIGKILL",
      );
      rmSync(parent, { recursive: true, force: true });
    },
    20_000,
  );

  it.skipIf(runtimeProcess.platform !== "darwin")(
    "leaves a stalled volume attached and its image in place, and says why",
    async () => {
      const parent = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-disk-cap-")));
      const root = join(parent, "solve");
      await mountDiskCap({ root, bytes: CAP_BYTES });
      const lsof = join(parent, "lsof");
      writeFileSync(lsof, "#!/bin/sh\nexec /bin/sleep 5\n", { mode: 0o755 });
      await expect(releaseDiskCap(root, { lsof, ps: "/bin/ps", boundMs: 200 })).rejects.toThrow(
        `the volume at ${root} is left attached: no listing`,
      );
      expect(spawnSync("/sbin/mount", []).stdout).toContain(root);
      expect(existsSync(`${root}.sparseimage`)).toBe(true);
      await releaseDiskCap(root);
      expect(spawnSync("/sbin/mount", []).stdout).not.toContain(root);
      rmSync(parent, { recursive: true, force: true });
    },
  );

  // Two rounds once ran a Builder session under one id: the second claim failed to mount, and its
  // cleanup removed the first's command profiles under it.
  it("refuses a root another solve already holds, before touching it", async () => {
    const root = join(mkdtempSync(join(tmpdir(), "ana-disk-cap-")), "solve");
    mkdirSync(root);
    await expect(mountDiskCap({ root, bytes: CAP_BYTES })).rejects.toThrow("EEXIST");
    expect(existsSync(root)).toBe(true);
    rmSync(dirname(root), { recursive: true, force: true });
  });
});
