// A seat's root, executed: claimed once, refused to a second claim, and released with whatever its
// commands left working in it. On Linux a seat's leftovers end with its pid namespace, so only the
// claim and the removal are read there (`src/verify/seat-root.ts`).
import { describe, expect, it } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { claimRoot, endHolders, releaseRoot } from "../src/verify/seat-root.ts";

const onDarwin = runtimeProcess.platform === "darwin";

/** A root under a fresh parent, not yet claimed, and the parent to remove after. */
function unclaimed(): { parent: string; root: string } {
  const parent = mkdtempSync(join(tmpdir(), "ana-seat-root-"));
  return { parent, root: join(parent, "solve") };
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
    release();
    expect(existsSync(root)).toBe(false);
    // Released, it can be claimed again, as a session run again under its id claims it.
    claimRoot(root)();
    rmSync(parent, { recursive: true, force: true });
  });

  // A seat may close a folder to itself, and the release threw EACCES on one (18 October).
  it("is removed though a seat closed a folder in it to itself", async () => {
    const { parent, root } = unclaimed();
    const release = claimRoot(root);
    const closed = join(root, "home", "closed");
    mkdirSync(join(closed, "inner"), { recursive: true });
    chmodSync(closed, 0);
    release();
    expect(existsSync(root)).toBe(false);
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
        await Bun.sleep(300);
        releaseRoot(root);
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
        await Bun.sleep(300);
        endHolders(root);
        await left.exited;
        expect(left.signalCode).toBe("SIGKILL");
      } finally {
        left.kill("SIGKILL");
        release();
        rmSync(parent, { recursive: true, force: true });
      }
    },
    20_000,
  );
});
