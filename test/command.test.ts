// A solve's commands, executed under the real command wall on a mounted cap: the home survives
// between commands, each command's own folder does not, staged input reaches it, and neither the
// host-only folder nor the repository can be read, and no command outlives the shell limits.
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { type CommandWall, runWalled, solveDirs } from "../src/solve/command.ts";
import { mountDiskCap } from "../src/verify/disk-cap.ts";
import { solveIsolationPolicy } from "../src/verify/solve-sandbox.ts";

const CAP_BYTES = 16 * 1024 * 1024;

async function run(wall: CommandWall, command: string, stage?: (work: string) => void, timeout?: number) {
  let output = "";
  const onData = (data: Buffer) => {
    output += data.toString("utf8");
  };
  const result = await runWalled(wall, command, {
    onData,
    timeout,
    ...(stage === undefined ? {} : { stage: ({ work }: { work: string }) => stage(work) }),
  });
  return { exitCode: result.exitCode, output };
}

describe("a solve's walled commands", () => {
  it.skipIf(runtimeProcess.platform !== "darwin")(
    "keep the home, drop each command's folder, and read neither the host folder nor the repository",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-repo-")));
      writeFileSync(join(repoRoot, "secret"), "repo-canary");
      const dirs = solveDirs(`test-${String(runtimeProcess.pid)}-${String(Date.now())}`);
      const release = await mountDiskCap({ root: dirs.root, bytes: CAP_BYTES });
      try {
        for (const dir of [dirs.home, dirs.runs, dirs.host]) mkdirSync(dir, { recursive: true });
        writeFileSync(join(dirs.host, "config"), "host-canary");
        const base = solveIsolationPolicy({ repoRoot, cap: { root: dirs.root, bytes: CAP_BYTES } });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        const wall: CommandWall = {
          base,
          dirs,
          toolTree: null,
          limits: { shellDefaultSeconds: 1, shellMaxSeconds: 2 },
          cpu: { seconds: 0, unmeasured: 0 },
        };

        const first = await run(wall, 'echo kept > "$HOME/note" && pwd && cat staged', (work) =>
          writeFileSync(join(work, "staged"), "staged-input"),
        );
        expect(first.exitCode).toBe(0);
        expect(first.output).toContain("staged-input");
        const firstFolder = first.output.split("\n")[0] ?? "";

        const second = await run(wall, `cat "$HOME/note"; ls ${JSON.stringify(firstFolder)} 2>&1; true`);
        expect(second.output).toContain("kept");
        expect(second.output).toContain("No such file");

        const host = await run(wall, `cat ${JSON.stringify(join(dirs.host, "config"))} 2>&1; true`);
        expect(host.output).not.toContain("host-canary");
        const repo = await run(wall, `cat ${JSON.stringify(join(repoRoot, "secret"))} 2>&1; true`);
        expect(repo.output).not.toContain("repo-canary");

        // Every command is held to the condition's shell limits here, whoever launched it: one that
        // names no timeout runs for the default, and one that names too long a timeout for the maximum.
        await expect(run(wall, "sleep 5")).rejects.toThrow("timeout:1");
        await expect(run(wall, "sleep 5", undefined, 60)).rejects.toThrow("timeout:2");
      } finally {
        await release();
        rmSync(dirs.host, { recursive: true, force: true });
        rmSync(repoRoot, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
