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
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
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
const HDIUTIL = "/usr/bin/hdiutil";

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
    "is released from its root's name alone, mounted, attached with no volume or already detached, and the root can be claimed again",
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
      // A solve stopped between its attach and its mount: the image attached, no volume at the root.
      await mountDiskCap({ root, bytes: CAP_BYTES });
      expect(spawnSync("/usr/bin/hdiutil", ["detach", root, "-quiet"]).status).toBe(0);
      const image = `${root}.sparseimage`;
      expect(spawnSync("/usr/bin/hdiutil", ["attach", "-nomount", "-nobrowse", image]).status).toBe(0);
      expect(spawnSync("/usr/bin/hdiutil", ["info"]).stdout).toContain(image);
      await releaseDiskCap(root);
      expect(spawnSync("/usr/bin/hdiutil", ["info"]).stdout).not.toContain(image);
      expect(existsSync(root)).toBe(false);
      expect(existsSync(image)).toBe(false);
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
      expect(
        await endHolders(parent, { lsof, ps: "/bin/ps", hdiutil: HDIUTIL, boundMs: 200, stallMs: 10_000 }),
      ).toBe("no listing of what holds it came within 200 ms");
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
      // The listing must answer inside the bound and `ps` must not, so the bound sits well above a
      // shell's start on a loaded host (200 ms failed there three times on 11 October) and well
      // below `ps`'s 5 s.
      writeFileSync(lsof, "#!/bin/sh\necho 1000000\n", { mode: 0o755 });
      writeFileSync(ps, "#!/bin/sh\nexec /bin/sleep 5\n", { mode: 0o755 });
      // One second of stall rather than the hosts' ten: the case still lists, kills and rereads.
      expect(await endHolders(parent, { lsof, ps, hdiutil: HDIUTIL, boundMs: 2_000, stallMs: 1_000 })).toBe(
        "1 of its holders stayed in uninterruptible wait for 1000 ms after SIGKILL",
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
      await expect(
        releaseDiskCap(root, { lsof, ps: "/bin/ps", hdiutil: HDIUTIL, boundMs: 200, stallMs: 10_000 }),
      ).rejects.toThrow(`the volume at ${root} is left attached: no listing`);
      expect(spawnSync("/sbin/mount", []).stdout).toContain(root);
      expect(existsSync(`${root}.sparseimage`)).toBe(true);
      await releaseDiskCap(root);
      expect(spawnSync("/sbin/mount", []).stdout).not.toContain(root);
      rmSync(parent, { recursive: true, force: true });
    },
  );

  // A failed create left the root it claimed, and a retry of the same root failed at EEXIST (the
  // stack review, 12 October); under `-quiet` the failure said nothing of why.
  it.skipIf(runtimeProcess.platform !== "darwin")(
    "frees the root a failed mount claimed, says hdiutil's reason, and the root can be claimed again",
    async () => {
      const parent = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-disk-cap-")));
      const root = join(parent, "solve");
      // One sector holds no APFS volume.
      await expect(mountDiskCap({ root, bytes: 1 })).rejects.toThrow(
        /^hdiutil create exited 1: hdiutil: create failed/,
      );
      expect(existsSync(root)).toBe(false);
      // Nor is a template of that size left, whole or half made, for the next mount to clone.
      const templates = readdirSync(join(tmpdir(), "ana-disk-cap"));
      expect(templates.filter((name) => name === "1.sparseimage" || name.startsWith("1-"))).toEqual([]);
      const release = await mountDiskCap({ root, bytes: CAP_BYTES });
      await release();
      expect(existsSync(root)).toBe(false);
      rmSync(parent, { recursive: true, force: true });
    },
  );

  // On a loaded Darwin runner both detaches exited 1 and the release threw (12 October). A detach
  // finds a volume already gone so, as one that detached it in between leaves it: here the listing.
  it.skipIf(runtimeProcess.platform !== "darwin")(
    "is released where a detach exits 1 because the volume is already gone",
    async () => {
      const parent = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-disk-cap-")));
      const root = join(parent, "solve");
      await mountDiskCap({ root, bytes: CAP_BYTES });
      const lsof = join(parent, "lsof");
      writeFileSync(lsof, '#!/bin/sh\n/usr/bin/hdiutil detach "$4" >/dev/null 2>&1\n', { mode: 0o755 });
      await releaseDiskCap(root, { lsof, ps: "/bin/ps", hdiutil: HDIUTIL, boundMs: 30_000, stallMs: 10_000 });
      expect(spawnSync("/sbin/mount", []).stdout).not.toContain(root);
      expect(existsSync(root)).toBe(false);
      expect(existsSync(`${root}.sparseimage`)).toBe(false);
      rmSync(parent, { recursive: true, force: true });
    },
  );

  // A release took a failed `hdiutil info` for an image attached nowhere, and a root unmounted
  // under it for a detached image: either way it unlinked an image still attached (the review of
  // 19 October). Here the listing of images fails, and then another actor unmounts the root while
  // the release lists its holders, so the detach by the root finds no volume and the device stays.
  it.skipIf(runtimeProcess.platform !== "darwin")(
    "keeps an image whose attachment it cannot establish, and detaches one unmounted under it",
    async () => {
      const parent = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-disk-cap-")));
      const root = join(parent, "solve");
      const image = `${root}.sparseimage`;
      const attached = () => spawnSync(HDIUTIL, ["info"]).stdout.includes(image);
      await mountDiskCap({ root, bytes: CAP_BYTES });
      expect(spawnSync(HDIUTIL, ["detach", root, "-quiet"]).status).toBe(0);
      expect(spawnSync(HDIUTIL, ["attach", "-nomount", "-nobrowse", image]).status).toBe(0);
      const failing = join(parent, "hdiutil");
      writeFileSync(failing, "#!/bin/sh\necho no listing >&2\nexit 1\n", { mode: 0o755 });
      const listing = { lsof: "/usr/sbin/lsof", ps: "/bin/ps", boundMs: 30_000, stallMs: 10_000 };
      await expect(releaseDiskCap(root, { ...listing, hdiutil: failing })).rejects.toThrow(
        `${image} is left in place: hdiutil info exited 1: no listing`,
      );
      expect(attached()).toBe(true);
      expect(existsSync(image)).toBe(true);
      expect(existsSync(root)).toBe(true);
      // A listing that never answers: `runs stop` releases roots in turn, and would wait here on all.
      const silent = join(parent, "silent");
      writeFileSync(silent, "#!/bin/sh\nexec /bin/sleep 30\n", { mode: 0o755 });
      const started = Date.now();
      await expect(releaseDiskCap(root, { ...listing, hdiutil: silent, boundMs: 500 })).rejects.toThrow(
        `${image} is left in place: hdiutil info did not answer within 500 ms`,
      );
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(attached()).toBe(true);
      expect(existsSync(image)).toBe(true);
      expect(existsSync(root)).toBe(true);
      // A listing that names the device, and a detach of it that never answers.
      const stalled = join(parent, "stalled");
      writeFileSync(stalled, `#!/bin/sh\n[ "$1" = info ] && exec ${HDIUTIL} info\nexec /bin/sleep 30\n`, {
        mode: 0o755,
      });
      const begun = Date.now();
      await expect(releaseDiskCap(root, { ...listing, hdiutil: stalled, boundMs: 2_000 })).rejects.toThrow(
        `${image} is left in place: hdiutil detach did not answer within 2000 ms`,
      );
      expect(Date.now() - begun).toBeLessThan(8_000);
      expect(attached()).toBe(true);
      expect(existsSync(image)).toBe(true);
      expect(existsSync(root)).toBe(true);
      await releaseDiskCap(root);
      expect(attached()).toBe(false);
      expect(existsSync(image)).toBe(false);
      // Mounted at the start, unmounted by another while the release lists what holds it.
      await mountDiskCap({ root, bytes: CAP_BYTES });
      const lsof = join(parent, "lsof");
      writeFileSync(lsof, `#!/bin/sh\n${HDIUTIL} unmount "$4" >/dev/null 2>&1\n`, { mode: 0o755 });
      await releaseDiskCap(root, { ...listing, lsof, hdiutil: HDIUTIL });
      expect(attached()).toBe(false);
      expect(existsSync(image)).toBe(false);
      expect(existsSync(root)).toBe(false);
      rmSync(parent, { recursive: true, force: true });
    },
  );

  // An interrupted release unlinks the image before it removes the root. hdiutil names an image by
  // its real path, so with the file gone a root under /var matched nothing under /private/var, and
  // the root went under a device still attached (the review of 19 October).
  it.skipIf(runtimeProcess.platform !== "darwin")(
    "detaches an image whose file is gone and whose root is named through a link",
    async () => {
      // Not resolved: the temporary folder is under /var, which hdiutil names /private/var.
      const parent = mkdtempSync(join(tmpdir(), "ana-disk-cap-"));
      const root = join(parent, "solve");
      const real = join(realpathSync.native(parent), "solve.sparseimage");
      const attached = () => spawnSync(HDIUTIL, ["info"]).stdout.includes(real);
      try {
        expect(real).not.toBe(`${root}.sparseimage`);
        await mountDiskCap({ root, bytes: CAP_BYTES });
        expect(spawnSync(HDIUTIL, ["detach", root, "-quiet"]).status).toBe(0);
        expect(spawnSync(HDIUTIL, ["attach", "-nomount", "-nobrowse", real]).status).toBe(0);
        rmSync(real);
        expect(attached()).toBe(true);
        await releaseDiskCap(root);
        expect(attached()).toBe(false);
        expect(existsSync(root)).toBe(false);
      } finally {
        // What a failed release left attached is this case's own image.
        const entry = spawnSync(HDIUTIL, ["info"])
          .stdout.split(/^=+$/m)
          .find((each) => each.includes(real));
        const device = entry === undefined ? undefined : /^(\/dev\/disk\d+)\s/m.exec(entry)?.[1];
        if (device !== undefined) spawnSync(HDIUTIL, ["detach", device, "-force"]);
        rmSync(parent, { recursive: true, force: true });
      }
    },
  );

  // A mount clones the one empty image of its size (`emptyImage`). The size here is this case's
  // alone, so the template it reads is the one its three first mounts made between them.
  it.skipIf(runtimeProcess.platform !== "darwin")(
    "makes one empty image a size, which three caps mounted at once clone, each keeping its own writes",
    async () => {
      const parent = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-disk-cap-")));
      const bytes = CAP_BYTES + 7 * 512;
      const template = join(tmpdir(), "ana-disk-cap", `${String(bytes / 512)}.sparseimage`);
      const roots = ["a", "b", "c"].map((name) => join(parent, name));
      const releases = await Promise.all(roots.map((root) => mountDiskCap({ root, bytes })));
      try {
        roots.forEach((root, index) => writeFileSync(join(root, "own"), String(index)));
        roots.forEach((root, index) => expect(readFileSync(join(root, "own"), "utf8")).toBe(String(index)));
        expect(readdirSync(dirname(template)).filter((name) => name.startsWith(String(bytes / 512)))).toEqual(
          [`${String(bytes / 512)}.sparseimage`],
        );
      } finally {
        await Promise.all(releases.map((release) => release()));
      }
      // The writes went to the clones: a cap mounted later starts empty, from the same template.
      const made = statSync(template).mtimeMs;
      const later = join(parent, "d");
      const release = await mountDiskCap({ root: later, bytes });
      try {
        expect(readdirSync(later).filter((name) => !name.startsWith("."))).toEqual([]);
        expect(statSync(template).mtimeMs).toBe(made);
      } finally {
        await release();
      }
      rmSync(parent, { recursive: true, force: true });
    },
  );

  it.skipIf(runtimeProcess.platform === "darwin")(
    "makes the root and no image where nothing caps a disk",
    async () => {
      const parent = mkdtempSync(join(tmpdir(), "ana-disk-cap-"));
      const root = join(parent, "solve");
      const release = await mountDiskCap({ root, bytes: CAP_BYTES });
      expect(readdirSync(parent)).toEqual(["solve"]);
      await release();
      expect(existsSync(root)).toBe(false);
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
