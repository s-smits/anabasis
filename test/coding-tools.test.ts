// Durable registrations run against the real OS wall. The fake invocation API only records
// output and diagnostics; every file and shell operation uses the seat's walled environment.
import { describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import type { ToolDiagnostic, ToolExecutionApi } from "@earendil-works/pi-durable";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { CODING_TOOLS, codingTools, wallExec } from "../src/tools/coding.ts";
import { type CommandWall, solveDirs, walledBase } from "../src/tools/command.ts";
import { walledEnv } from "../src/tools/env.ts";
import { osIsolationSupport } from "../src/wall/os-isolation.ts";
import { claimRoot } from "../src/wall/seat-root.ts";

function caller(wall: CommandWall, env: ExecutionEnv) {
  const tools = new Map(codingTools(wall, CODING_TOOLS).map((each) => [each.name, each]));
  return async (name: string, args: JsonObject, signal?: AbortSignal) => {
    const each = tools.get(name);
    if (each === undefined) throw new Error(`Missing tool ${name}`);
    let streamed = "";
    const diagnostics: ToolDiagnostic[] = [];
    const api: Pick<
      ToolExecutionApi,
      "env" | "callId" | "output" | "retainedOutput" | "diagnostic" | "agent"
    > = {
      env,
      callId: "call",
      output: (chunk: string | Uint8Array) => {
        streamed += chunk instanceof Uint8Array ? new TextDecoder().decode(chunk) : chunk;
      },
      retainedOutput: () => ({ text: streamed, truncated: false }),
      diagnostic: (note) => {
        diagnostics.push(note);
      },
      agent: async () => ({
        thinkingLevel: "off",
        extensions: [],
        tools: [],
        callable: [],
        deferred: [],
        sections: [],
      }),
    };
    const context = signal === undefined ? BACKGROUND_CONTEXT : withAbortSignal(signal, BACKGROUND_CONTEXT);
    // SAFETY: these tools use only the API subset above; the image lookup returns no model.
    const result = await each.execute(args, api as ToolExecutionApi, context);
    const output =
      result.output?.map((part) => (part.type === "text" ? part.text : `<${part.type}>`)).join("") ??
      streamed;
    return { ...result, text: output, diagnostics: [...diagnostics, ...(result.diagnostics ?? [])] };
  };
}

async function withSeat(
  run: (wall: CommandWall, call: ReturnType<typeof caller>, repo: string) => Promise<void>,
) {
  const repo = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-coding-repo-")));
  const dirs = solveDirs(`coding-${crypto.randomUUID()}`);
  const release = claimRoot(dirs.root);
  let env: ExecutionEnv | undefined;
  try {
    const base = await walledBase(dirs, { repoRoot: repo }, "the coding tool test");
    const wall: CommandWall = {
      base,
      dirs,
      toolTree: null,
      limits: { shellDefaultSeconds: 1, shellMaxSeconds: 2 },
    };
    env = walledEnv(wall);
    await run(wall, caller(wall, env), repo);
  } finally {
    await env?.cleanup(BACKGROUND_CONTEXT);
    await release();
    rmSync(dirs.host, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
}

async function stopped(path: string) {
  const before = readFileSync(path, "utf8");
  const deadline = performance.now() + 200;
  while (performance.now() < deadline) {
    expect(readFileSync(path, "utf8")).toBe(before);
    await Bun.sleep(10);
  }
}

describe.skipIf(!osIsolationSupport().ok)("the coding tools on the OS wall", () => {
  it("runs Bash and literal file operations in one home while refusing forbidden paths", async () => {
    // Process substitution, `[[ ]]` and an indexed array: `/bin/sh` refuses the first on both
    // hosts, and Linux's dash all three.
    await withSeat(async (wall, call, repo) => {
      const command = 'a=(x y); [[ $(cat <(echo "${a[1]}")) == y ]] && echo bash-ok';
      const result = await call("bash", { command });
      expect(result.isError === true).toBe(false);
      expect(result.text).toBe("bash-ok\n");
      const launched = await wallExec(wall)(command);
      expect(launched.exitCode).toBe(0);
      expect(launched.output.toString("utf8")).toBe("bash-ok\n");

      const secret = join(repo, "canary");
      writeFileSync(secret, "hidden-canary");
      await expect(call("read", { path: secret })).rejects.toThrow();
      const shell = await call("bash", { command: `cat '${secret}'` });
      expect(shell.isError).toBe(true);
      expect(shell.text).not.toContain("hidden-canary");
      await expect(call("write", { path: join(repo, "escape"), content: "bad" })).rejects.toThrow();
      expect(existsSync(join(repo, "escape"))).toBe(false);

      const content = "$(touch escaped)\n`id`\n'; echo injected";
      await call("write", { path: "odd name's.txt", content });
      expect((await call("read", { path: "odd name's.txt" })).text).toBe(content);
      expect(existsSync(join(wall.dirs.home, "escaped"))).toBe(false);
      await expect(call("read", { path: "absent" })).rejects.toMatchObject({ code: "not_found" });
      await expect(call("edit", { path: "absent", edits: [{ oldText: "a", newText: "b" }] })).rejects.toThrow(
        "not_found",
      );
      writeFileSync(join(wall.dirs.home, "large"), Buffer.alloc(16 * 1024 * 1024 + 1));
      await expect(call("read", { path: "large" })).rejects.toThrow("16 MiB");
    });
  });

  it("ends commands and their children on timeout and abort", async () => {
    await withSeat(async (wall, call) => {
      const command = 'i=0; while :; do i=$((i+1)); echo $i > "$HOME/beat"; echo ready; sleep 0.01; done';
      await expect(call("bash", { command })).rejects.toThrow("timed out");
      await stopped(join(wall.dirs.home, "beat"));
      const abort = new AbortController();
      // A marker proves the command began before the abort.
      const running = call("bash", { command: command.replaceAll("beat", "abort-beat") }, abort.signal);
      const marker = join(wall.dirs.home, "abort-beat");
      const deadline = performance.now() + 1000;
      while (!existsSync(marker) && performance.now() < deadline) await Bun.sleep(10);
      expect(existsSync(marker)).toBe(true);
      abort.abort();
      await expect(running).rejects.toMatchObject({ code: "aborted" });
      await stopped(marker);
    });
  });
});
