// Darwin's process table as libproc reads it (`src/meta/process-table.ts`): a process's working
// directory and its program, by their real paths, as `lsof -d cwd,txt` named them for a seat's
// release; and a program whose file was removed after it started, which `proc_pidpath` no longer
// names, still named by its first mapped region.
import { describe, expect, it } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { processPaths } from "../src/meta/process-table.ts";

const onDarwin = runtimeProcess.platform === "darwin";

/** A copy of `sleep` under a fresh folder, run from another folder beside it. */
function sleeper() {
  const folder = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-process-table-")));
  const works = join(folder, "works");
  mkdirSync(works);
  const program = join(folder, "sleeper");
  copyFileSync("/bin/sleep", program);
  chmodSync(program, 0o755);
  const child = Bun.spawn([program, "60"], { cwd: works, stdio: ["ignore", "ignore", "ignore"] });
  const row = () => processPaths().find(({ pid }) => pid === child.pid);
  const end = async () => {
    child.kill("SIGKILL");
    await child.exited;
    rmSync(folder, { recursive: true, force: true });
  };
  return { works, program, row, end };
}

describe("the process table", () => {
  it.skipIf(!onDarwin)("reads a process's working directory and program by their real paths", async () => {
    const { works, program, row, end } = sleeper();
    try {
      expect(row()).toEqual({ pid: expect.any(Number), cwd: works, program });
      expect(processPaths().find(({ pid }) => pid === runtimeProcess.pid)?.cwd).toBe(
        realpathSync.native(runtimeProcess.cwd()),
      );
    } finally {
      await end();
    }
  });

  it.skipIf(!onDarwin)("still names a program whose file was removed after it started", async () => {
    const { program, row, end } = sleeper();
    try {
      expect(row()?.program).toBe(program);
      rmSync(program);
      expect(row()?.program).toBe(program);
    } finally {
      await end();
    }
  });
});
