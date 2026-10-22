// Durable registrations run against the real OS wall. The fake invocation API only records
// output and diagnostics; every file and shell operation uses the seat's walled environment.
import { describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import type { ToolDiagnostic, ToolExecutionApi } from "@earendil-works/pi-durable";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools";
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
import { CODING_TOOLS, codingTools, selectedCodingTools } from "../src/tools/coding.ts";
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
  clock?: CommandWall["clock"],
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
      clock,
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

describe("the solver's durable coding tools", () => {
  it("keeps durable's file schemas and descriptions and makes every call sequential", () => {
    const wall: CommandWall = {
      // SAFETY: making registrations never reads the policy or starts a command.
      base: undefined as never,
      dirs: solveDirs("definitions"),
      toolTree: null,
      limits: { shellDefaultSeconds: 1, shellMaxSeconds: 2 },
    };
    const ours = codingTools(wall, ["read", "edit", "write"]);
    const images = { prepare: async () => undefined };
    for (const [index, pi] of [createReadTool({ images }), createEditTool(), createWriteTool()].entries()) {
      expect(ours[index]?.name).toBe(pi.name);
      expect(ours[index]?.description).toBe(pi.description);
      expect(ours[index]?.parameters).toEqual(pi.parameters);
      expect(ours[index]?.executionMode).toBe("sequential");
    }
  });

  it("selects the declared presets in pi's order", () => {
    expect(selectedCodingTools(["write", "read", "read", "shell"])).toEqual(["read", "bash", "write"]);
    expect(selectedCodingTools([])).toEqual([]);
    expect(() => selectedCodingTools(["python"])).toThrow("not python");
  });
});

describe.skipIf(!osIsolationSupport().ok)("the coding tools on the OS wall", () => {
  it("shares the home across tools and resolves ~ to the seat rather than the host", async () => {
    await withSeat(async (wall, call) => {
      const tools = codingTools(wall, ["write", "bash", "read"]);
      expect(tools.map((each) => each.name)).toEqual(["read", "bash", "write"]);
      expect(tools.every((each) => each.executionMode === "sequential")).toBe(true);
      expect(tools.find((each) => each.name === "bash")?.parameters).toMatchObject({
        properties: {
          timeout: { description: expect.stringContaining("1 when omitted, at most 2") },
        },
      });
      expect((await call("bash", { command: "pwd -P" })).text.trim()).toBe(
        realpathSync.native(wall.dirs.home),
      );
      await call("write", { path: "~/nested/a", content: "one\ntwo\n" });
      expect((await call("read", { path: "nested/a", offset: 2 })).text).toBe("two\n");
      await call("edit", { path: "nested/a", edits: [{ oldText: "two", newText: "three" }] });
      expect((await call("bash", { command: "cat ~/nested/a" })).text).toBe("one\nthree\n");
    });
  });

  it("refuses a denied read through read and bash and a write outside the home", async () => {
    await withSeat(async (_wall, call, repo) => {
      const secret = join(repo, "canary");
      writeFileSync(secret, "hidden-canary");
      await expect(call("read", { path: secret })).rejects.toThrow();
      const shell = await call("bash", { command: `cat '${secret}'` });
      expect(shell.isError).toBe(true);
      expect(shell.text).not.toContain("hidden-canary");
      await expect(call("write", { path: join(repo, "escape"), content: "bad" })).rejects.toThrow();
      expect(existsSync(join(repo, "escape"))).toBe(false);
    });
  });

  it("carries literal content without shell evaluation and refuses missing or oversized files", async () => {
    await withSeat(async (wall, call) => {
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

  it("reads an image attachment through the environment, converting a BMP to PNG", async () => {
    await withSeat(async (wall, call) => {
      writeFileSync(
        join(wall.dirs.home, "dot.png"),
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64",
        ),
      );
      expect((await call("read", { path: "dot.png" })).output?.map((part) => part.type)).toEqual(["image"]);
      writeFileSync(
        join(wall.dirs.home, "dot.bmp"),
        Buffer.from(
          "424d3a000000000000003600000028000000010000000100000001001800000000000400000000000000000000000000000000000000" +
            "0000ff00",
          "hex",
        ),
      );
      const bmp = (await call("read", { path: "dot.bmp" })).output ?? [];
      expect(bmp.map((part) => (part.type === "image" ? part.mimeType : part.type))).toEqual(["image/png"]);
    });
  });

  it("names the host's default, maximum and oversized request on timeout", async () => {
    await withSeat(async (_wall, call) => {
      await expect(call("bash", { command: "sleep 5" })).rejects.toThrow("The host allows 2 s");
      await expect(call("bash", { command: "sleep 5", timeout: 9 })).rejects.toThrow(
        "Your 9 s is above the 2 s",
      );
      await expect(call("bash", { command: "sleep 5", timeout: 2 })).rejects.toThrow("That is the whole 2 s");
    });
  }, 15_000);

  it("names the solve's reserve when it shortens a command's timeout", async () => {
    const clock: NonNullable<CommandWall["clock"]> = { started: null, seconds: 30 };
    await withSeat(async (_wall, call) => {
      clock.started = performance.now() - 25_000;
      await expect(call("bash", { command: "sleep 5", timeout: 2 })).rejects.toThrow(
        "solve's time is nearly up",
      );
    }, clock);
  });

  it("keeps full output readable in the seat's TMPDIR after a later command times out", async () => {
    await withSeat(async (wall, call) => {
      const result = await call("bash", { command: "seq 1 3000" });
      const full = result.diagnostics
        .find((note) => note.code === "full_output")
        ?.message.slice("Full output: ".length);
      expect(full?.startsWith(`${wall.dirs.temp}/`)).toBe(true);
      if (full === undefined) throw new Error("Missing output file");
      expect(readFileSync(full, "utf8").split("\n")).toHaveLength(3001);
      // The separate environment test checks the spill path carried by a timeout error.
      await expect(call("bash", { command: "seq 1 3000; sleep 5" })).rejects.toThrow("timed out");
      expect((await call("read", { path: full, offset: 2999 })).text).toContain("3000");
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
