// The durable environment must enforce the same wall for file operations and shell commands.
import { describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import type { ExecutionEnv, Result, FileError } from "@earendil-works/pi-durable/env";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { type CommandWall, solveDirs, walledBase } from "../src/tools/command.ts";
import { walledEnv } from "../src/tools/env.ts";
import { osIsolationSupport } from "../src/wall/os-isolation.ts";
import { claimRoot } from "../src/wall/seat-root.ts";

const context = BACKGROUND_CONTEXT;
const SECRET = "repository-canary-must-stay-hidden";

async function withSeat(run: (env: ExecutionEnv, wall: CommandWall, canary: string) => Promise<void>) {
  const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-env-repo-")));
  const canary = join(repoRoot, "canary.txt");
  writeFileSync(canary, SECRET);
  const dirs = solveDirs(`env-test-${crypto.randomUUID()}`);
  const release = claimRoot(dirs.root);
  let env: ExecutionEnv | undefined;
  try {
    const base = await walledBase(dirs, { repoRoot }, "the environment test");
    const wall: CommandWall = {
      base,
      dirs,
      toolTree: null,
      limits: { shellDefaultSeconds: 1, shellMaxSeconds: 2 },
    };
    env = walledEnv(wall);
    await run(env, wall, canary);
  } finally {
    await env?.cleanup(context);
    await release();
    rmSync(dirs.host, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

function value<T>(result: Result<T, FileError>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

async function stopped(path: string): Promise<void> {
  const before = readFileSync(path, "utf8");
  const deadline = performance.now() + 200;
  while (performance.now() < deadline) {
    expect(readFileSync(path, "utf8")).toBe(before);
    await Bun.sleep(10);
  }
}

describe.skipIf(!osIsolationSupport().ok)("the durable environment's OS wall", () => {
  it("runs literal commands and file operations in its home while refusing protected paths", async () => {
    await withSeat(async (env, wall, canary) => {
      let deniedOutput = "";
      const deniedShell = await env.exec(
        ["cat", canary],
        {
          onOutput: (text) => {
            deniedOutput += text;
          },
        },
        context,
      );
      expect(deniedShell.ok && deniedShell.value.exitCode === 0).toBe(false);
      expect(deniedOutput).not.toContain(SECRET);
      const reads = await Promise.all([
        env.readTextFile(canary, context),
        env.readBinaryFile(canary, context),
        env.readTextLines(canary, undefined, context),
        env.openTextLineReader(canary, context),
        env.openBinaryReader(canary, undefined, context),
        env.fileInfo(canary, context),
        env.listDir(canary, context),
        env.openDirReader(canary, context),
        env.canonicalPath(canary, context),
      ]);
      for (const read of reads) expect(read.ok).toBe(false);
      const exists = await env.exists(canary, context);
      expect(exists.ok && exists.value).toBe(false);

      const outside = `${canary}.written`;
      expect((await env.writeFile(outside, "escape", context)).ok).toBe(false);
      expect((await env.appendFile(canary, "escape", context)).ok).toBe(false);
      expect((await env.truncateFile(canary, 0, context)).ok).toBe(false);
      expect((await env.flushFile(canary, context)).ok).toBe(false);
      expect((await env.remove(canary, undefined, context)).ok).toBe(false);
      expect((await env.createDir(outside, undefined, context)).ok).toBe(false);
      expect((await env.writeFile(join(wall.dirs.kept, "escape"), "escape", context)).ok).toBe(false);
      value(await env.writeFile("own", "safe", context));
      expect((await env.renameFile("own", outside, context)).ok).toBe(false);
      symlinkSync(canary, join(wall.dirs.home, "link"));
      expect((await env.readTextFile("link", context)).ok).toBe(false);
      expect((await env.writeFile("link", "escape", context)).ok).toBe(false);
      expect(readFileSync(canary, "utf8")).toBe(SECRET);
      expect(existsSync(outside)).toBe(false);

      value(await env.createDir("work", undefined, context));
      const output = { stdout: "", stderr: "" };
      const shell = await env.exec(
        ["/bin/sh", "-c", String.raw`printf "%s\n" "$PWD" "$NOTE"; printf error >&2`],
        {
          cwd: "work",
          env: { NOTE: "literal $(touch escaped)" },
          spill: { afterBytes: 1, afterLines: 1 },
          onOutput: (text, _ctx, info) => {
            output[info.stream] += text;
          },
        },
        context,
      );
      if (!shell.ok) throw shell.error;
      expect(shell.value.exitCode).toBe(0);
      expect(output.stdout).toContain(join(wall.dirs.home, "work"));
      expect(output.stdout).toContain("literal $(touch escaped)");
      expect(output.stderr).toBe("error");
      const spillPath = shell.value.spillPath;
      expect(spillPath).toBeDefined();
      if (spillPath === undefined) throw new Error("Missing spill file");
      expect(value(await env.readTextFile(spillPath, context))).toContain("literal $(touch escaped)");
      expect(value(await env.exists("work/escaped", context))).toBe(false);
    });
  });

  it("ends a command on abort and cancels a queued file operation before it starts", async () => {
    await withSeat(async (env, wall) => {
      const abort = new AbortController();
      const started = Promise.withResolvers<void>();
      const running = env.exec(
        'i=0; while :; do i=$((i+1)); echo $i > "$HOME/beat"; echo ready; sleep 0.01; done',
        {
          onOutput: () => started.resolve(),
        },
        withAbortSignal(abort.signal, context),
      );
      await started.promise;
      const queuedAbort = new AbortController();
      const queued = env.writeFile("never-written", "no", withAbortSignal(queuedAbort.signal, context));
      queuedAbort.abort();
      abort.abort();
      const result = await running;
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Command escaped the abort");
      expect(result.error.code).toBe("aborted");
      expect((await queued).ok).toBe(false);
      expect(existsSync(join(wall.dirs.home, "never-written"))).toBe(false);
      await stopped(join(wall.dirs.home, "beat"));
    });
  });
});
