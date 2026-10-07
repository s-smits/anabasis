// The solver's bash tool: the description the sweep's solves read, less what v2 no longer does; the
// v1 timeout clamp; and, on the real command wall, the three timeout clauses, a failing exit, the
// output and a home that outlives one command.
import { describe, expect, it } from "bun:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { type CommandWall, solveDirs } from "../src/solve/command.ts";
import { shellDescription, shellSeconds, shellTool } from "../src/solve/shell.ts";
import { solveIsolationPolicy } from "../src/verify/solve-sandbox.ts";

/** The sweep's tool tree: the Builder's interpreter in `bin`, a venv beside it whose `activate` is
 *  sourced rather than run and whose `python3` repeats a name `bin` already holds. */
function sweepToolTree(): string {
  const tree = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-shell-tree-")));
  const program = (path: string, mode: number) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "#!/bin/sh\n");
    chmodSync(path, mode);
  };
  for (const name of ["pynite-python", "python3"]) program(join(tree, "bin", name), 0o755);
  for (const name of ["f2py", "numpy-config", "python3"]) program(join(tree, "venv", "bin", name), 0o755);
  program(join(tree, "venv", "bin", "activate"), 0o644);
  return tree;
}

describe("the solver's bash tool", () => {
  it("tells the solver what the sweep told it, without the guard v2 does not have", () => {
    const tree = sweepToolTree();
    try {
      expect(shellDescription(tree, 4)).toBe(
        "Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds. The command runs in a fresh private folder that is removed when it ends; nothing there becomes your answer, which you still record with the harness's own tools. A driver you keep in your home directory and re-run, reading its inputs from a file you edit between commands, buys more candidates than retyping the work each time. It has network access, so a toolchain or package can be downloaded into your home directory, a separate folder that survives between commands and is never read back; $TMPDIR is fresh for each command. It can write those places and /tmp, and read the host's own toolchains and public runtime roots, but no repository or private data. It does not check whether your answer is correct. sh, bun, node, python3 and the system C and C++ compilers run, with versions and libraries that differ by host: check one before building on it, and install what is missing into your home directory. Your home directory already holds this task as public/task.json and this domain's public rules under public/resources/ (4 files). Programs this harness installed run by name: pynite-python, python3, f2py, numpy-config. Use them instead of fetching or re-implementing what they compute. Keep scripts and results in $HOME; do not scan the filesystem. A command has a default time limit; pass timeout for a long build, never for a search.",
      );
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });

  it("lets a named timeout only raise the default, up to the maximum", () => {
    const limits = { shellDefaultSeconds: 300, shellMaxSeconds: 900 };
    const table: [number | undefined, number, number][] = [
      [undefined, 300, 300],
      [120, 120, 300],
      [0, 1, 300],
      [-5, 1, 300],
      [450.9, 450, 450],
      [900, 900, 900],
      [880, 880, 880],
      [5000, 5000, 900],
    ];
    for (const [timeout, asked, seconds] of table) {
      expect(shellSeconds(timeout, limits)).toEqual({ asked, seconds });
    }
  });

  it.skipIf(runtimeProcess.platform !== "darwin")(
    "names what the wall allowed on a cut, fails a failing exit, and keeps the home",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-shell-repo-")));
      const dirs = solveDirs(`shell-${String(runtimeProcess.pid)}-${String(Date.now())}`);
      try {
        for (const dir of [dirs.home, dirs.runs, dirs.host]) mkdirSync(dir, { recursive: true });
        const base = solveIsolationPolicy({ repoRoot, cap: { root: dirs.root, bytes: 16 * 1024 * 1024 } });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        const wall: CommandWall = { base, dirs, toolTree: null };
        const tool = shellTool(wall, { shellDefaultSeconds: 1, shellMaxSeconds: 2 }, 0);
        const call = (command: string, timeout?: number) =>
          tool.execute("call", timeout === undefined ? { command } : { command, timeout });

        const sleep = "echo started; sleep 5";
        await expect(call(sleep)).rejects.toThrow(
          "started\n\n\nCommand timed out after 1 seconds\n\nThis harness allows 2 s for one command, and 1 s when you pass none, so there is more time to ask for.",
        );
        await expect(call(sleep, 9)).rejects.toThrow(
          "Command timed out after 2 seconds\n\nYour 9 s is above the 2 s this harness allows one command, so it ran as 2 s — the most there is, and the move left is cheaper work rather than longer.",
        );
        await expect(call(sleep, 2)).rejects.toThrow(
          "Command timed out after 2 seconds\n\nThat is the whole 2 s this harness allows one command, so the move left is cheaper work rather than longer.",
        );

        const failed = await call("echo partial; exit 3");
        expect(failed.isError).toBe(true);
        expect(text(failed)).toBe("partial\n\n\nCommand exited with code 3");

        expect(text(await call('echo kept > "$HOME/note" && echo wrote'))).toBe("wrote\n");
        expect(text(await call('cat "$HOME/note"'))).toBe("kept\n");
      } finally {
        rmSync(dirs.root, { recursive: true, force: true });
        rmSync(dirs.host, { recursive: true, force: true });
        rmSync(repoRoot, { recursive: true, force: true });
      }
    },
    60_000,
  );
});

function text(result: Awaited<ReturnType<AgentTool["execute"]>>): string {
  return result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}
