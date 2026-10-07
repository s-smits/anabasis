// A v1 harness state opened for a v2 solve: bundled over the shim, listed and called one-shot under
// the real command wall, with the harness's own errors reaching the caller and the host-only folder
// out of reach; and the sweep's c07 bundle listing exactly the rows its model was shown.
import { describe, expect, it } from "bun:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, validateToolArguments } from "@earendil-works/pi-ai";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { type CommandWall, solveDirs } from "../src/solve/command.ts";
import { harnessTools, openHarness } from "../src/solve/harness.ts";
import { mountDiskCap } from "../src/verify/disk-cap.ts";
import { solveIsolationPolicy } from "../src/verify/solve-sandbox.ts";

const FIXTURE = new URL("fixtures/harness-min", import.meta.url).pathname;
const C07 = "/Users/air/Developer/anabasis-cycles-4c67fc/hb-bundles/veryhard-hb-4c67fc-c07";
const CAP_BYTES = 64 * 1024 * 1024;
const TASK = { taskId: "t-1", family: "fixture", publicInput: { base: 7 } };
const darwin = runtimeProcess.platform === "darwin";

/** A mounted solve wall for `body`, torn down after it. */
async function withWall(body: (wall: CommandWall) => Promise<void>, toolTree: string | null = null) {
  const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-harness-repo-")));
  const dirs = solveDirs(`harness-${String(runtimeProcess.pid)}-${String(Date.now())}`);
  const release = await mountDiskCap({ root: dirs.root, bytes: CAP_BYTES });
  try {
    for (const dir of [dirs.home, dirs.runs, dirs.host]) mkdirSync(dir, { recursive: true });
    const base = solveIsolationPolicy({ repoRoot, cap: { root: dirs.root, bytes: CAP_BYTES } });
    if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
    await body({ base, dirs, toolTree, limits: { shellDefaultSeconds: 60, shellMaxSeconds: 60 } });
  } finally {
    await release();
    rmSync(dirs.host, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

function textOf(result: Awaited<ReturnType<AgentTool["execute"]>>): string {
  const [part] = result.content;
  return part?.type === "text" ? part.text : "";
}

describe("a v1 harness state", () => {
  it("opens with its guide untrimmed, its kinds, and one bundled module", async () => {
    const harness = await openHarness(FIXTURE);
    expect(harness.guide).toBe("# Fixture guide\n\nScale first, then record.  \n\n");
    expect(harness.presets).toEqual(["shell"]);
    expect([...harness.kinds]).toEqual([
      ["scale_base", "reader"],
      ["read_path", "advisor"],
      ["record_answer", "artifact-writer"],
    ]);
    expect(harness.toolTree).toBeNull();
    expect(harness.module).toContain("createDomainHarness");
    expect(harness.module).not.toMatch(/from\s*"(@ana\/agent-bundle|@earendil-works\/pi-ai|\.\/helper\.ts)"/);
    expect(harness.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes its digest with any file or mode in the tool tree, as with the module", async () => {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-harness-tree-")));
    try {
      cpSync(FIXTURE, dir, { recursive: true });
      const bin = join(dir, ".toolchain", "bin");
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, "tool"), "#!/bin/sh\necho one\n");
      const digests = [(await openHarness(dir)).digest];
      writeFileSync(join(bin, "tool"), "#!/bin/sh\necho two\n");
      digests.push((await openHarness(dir)).digest);
      chmodSync(join(bin, "tool"), 0o755);
      digests.push((await openHarness(dir)).digest);
      expect(new Set(digests).size).toBe(3);
      expect(digests[2]).toBe((await openHarness(dir)).digest);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The shim drops v1's nullable-number rewrite on this behaviour of the pinned pi.
  it("needs no nullable-number rewrite: pi keeps null and zero exact through the union", () => {
    const parameters = Type.Object({
      a: Type.Union([Type.Number(), Type.Null()]),
      b: Type.Union([Type.Null(), Type.Number()]),
    });
    const tool = { name: "t", description: "", parameters };
    expect(
      validateToolArguments(tool, { type: "toolCall", id: "1", name: "t", arguments: { a: null, b: 0 } }),
    ).toEqual({ a: null, b: 0 });
    expect(
      validateToolArguments(tool, { type: "toolCall", id: "1", name: "t", arguments: { a: 0, b: null } }),
    ).toEqual({ a: 0, b: null });
  });

  it.skipIf(!darwin)(
    "lists its tools and runs each call alone under the wall",
    async () => {
      const harness = await openHarness(FIXTURE);
      await withWall(async (wall) => {
        writeFileSync(join(wall.dirs.host, "config"), "host-canary");
        const tools = await harnessTools(harness, TASK, wall);
        expect(tools.map(({ kind, tool }) => [tool.name, kind, tool.executionMode])).toEqual([
          ["scale_base", "reader", undefined],
          ["read_path", "advisor", undefined],
          ["record_answer", "artifact-writer", "sequential"],
        ]);
        const [scale, read, record] = tools.map(({ tool }) => tool);
        expect(scale?.parameters).toEqual({
          type: "object",
          required: ["factor"],
          properties: { factor: { type: "number" } },
        });

        const scaled = await scale!.execute("c1", { factor: 3 });
        expect(textOf(scaled)).toBe("t-1 (fixture): 21");
        expect(scaled.details).toEqual({ value: 21 });
        expect(await record!.execute("c2", { answer: "x" })).toEqual({
          content: [{ type: "text", text: "recorded" }],
          details: null,
          terminate: false,
        });

        await expect(read!.execute("c3", { path: "missing.txt" })).rejects.toThrow(
          "cannot read missing.txt: ENOENT",
        );
        await expect(scale!.execute("c4", { factor: "3" })).rejects.toThrow(
          'tool "scale_base" arguments do not match its declared parameter schema (/factor: must be number)',
        );
        const host = join(wall.dirs.host, "config");
        await expect(read!.execute("c5", { path: host })).rejects.toThrow(`cannot read ${host}: EPERM`);
      });
    },
    120_000,
  );

  it.skipIf(!darwin || !existsSync(C07))(
    "lists the sweep's c07 domain tools as its model received them",
    async () => {
      const harness = await openHarness(C07);
      const recorded = parseJsonAs<{ rows: JsonValue[] }>(
        await Bun.file(new URL("fixtures/harness-c07-tools.json", import.meta.url)).text(),
      ).rows;
      await withWall(async (wall) => {
        const tools = await harnessTools(harness, { taskId: "c07", family: "truss", publicInput: {} }, wall);
        const rows = tools.map(({ kind, tool }) => ({
          name: tool.name,
          label: tool.label,
          description: `Role: ${kind}. ${tool.description}`,
          ...keyIfDefined("parameters", kind === "artifact-writer" ? undefined : tool.parameters),
          ...keyIfDefined("executionMode", tool.executionMode),
        }));
        expect<unknown>(rows).toEqual(recorded);
      }, harness.toolTree);
    },
    120_000,
  );
});
