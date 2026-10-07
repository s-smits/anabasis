// The disk cap on Darwin, executed: a volume of the cap's size mounted at the solve's root, the
// command wall's scratch roots inside it, and a write past the cap. The Seatbelt rules are
// path-based, so the case runs a command under the real command profile to show they still let it
// write its three roots once those sit on the mounted volume. Linux applies the cap inside the
// worker's Bubblewrap launch instead; its argv is tested in solve-sandbox.test.ts.
import { spawnTextSync as spawnSync } from "./helpers/bun-spawn-sync.ts";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { describe, expect, it } from "bun:test";
import { runtimeProcess } from "../src/meta/process.ts";
import { mountDiskCap } from "../src/verify/disk-cap.ts";
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
        const dirs = { work: join(root, "work"), home: join(root, "home"), temp: join(root, "tmp") };
        for (const dir of Object.values(dirs)) mkdirSync(dir);
        const base = solveIsolationPolicy({ repoRoot, cap: { root, bytes: CAP_BYTES } });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        const policy = commandIsolationPolicy(base, dirs);
        const command = [
          `echo w > ${dirs.work}/f && echo h > "$HOME/f" && echo t > "$TMPDIR/f" && echo wrote-all-three`,
          `dd if=/dev/zero of="$HOME/big" bs=1048576 count=64 2>&1`,
        ].join("; ");
        const result = spawnSync(
          "/bin/sh",
          ["-c", stageCommandIsolation(policy, join(parent, "command.sb"), command)],
          { cwd: dirs.work, env: policy.environment, timeout: 30_000 },
        );
        const output = `${result.stdout}${result.stderr}`;
        expect(output).toContain("wrote-all-three");
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
});
