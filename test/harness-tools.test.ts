// A v1 harness state opened for a v2 solve: bundled over the shim, listed and called one-shot under
// the real command wall, with each tool's label and description as its factory states them, the
// harness's own errors reaching the caller and the host-only folder out of reach.
import { describe, expect, it } from "bun:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, validateToolArguments } from "@earendil-works/pi-ai";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { type CommandWall, makeSeatDirs, solveDirs } from "../src/solve/command.ts";
import { harnessTools, openHarness } from "../src/solve/harness.ts";
import { mountDiskCap } from "../src/verify/disk-cap.ts";
import { solveIsolationPolicy } from "../src/verify/solve-sandbox.ts";
import { osIsolationSupport } from "../src/verify/os-isolation.ts";
import { CLOSED_CODE } from "./helpers/wall.ts";

const FIXTURE = new URL("fixtures/harness-min", import.meta.url).pathname;
const CAP_BYTES = 64 * 1024 * 1024;
const TASK = { taskId: "t-1", family: "fixture", publicInput: { base: 7 } };
const walled = osIsolationSupport().ok;

/** A mounted solve wall for `body`, torn down after it. */
async function withWall(body: (wall: CommandWall) => Promise<void>, toolTree: string | null = null) {
  const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-harness-repo-")));
  const dirs = solveDirs(`harness-${String(runtimeProcess.pid)}-${String(Date.now())}`);
  const release = await mountDiskCap({ root: dirs.root, bytes: CAP_BYTES });
  try {
    makeSeatDirs(dirs);
    const base = solveIsolationPolicy({ repoRoot });
    if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
    await body({
      base,
      dirs,
      toolTree,
      limits: { shellDefaultSeconds: 60, shellMaxSeconds: 60 },
    });
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

  it("opens with no artifact-writer, and with no tool at all: the answer is a file and no tool's", async () => {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-harness-writer-")));
    try {
      cpSync(FIXTURE, dir, { recursive: true });
      const spec = join(dir, "agent", "tools-spec.json");
      const { tools } = parseJsonAs<{ tools: { kind: string }[] }>(readFileSync(spec, "utf8"));
      const readers = tools.filter((row) => row.kind !== "artifact-writer");
      writeFileSync(spec, JSON.stringify({ presets: ["read", "bash"], tools: readers }));
      const opened = await openHarness(dir);
      expect([...opened.kinds.values()]).not.toContain("artifact-writer");
      expect(opened.presets).toEqual(["read", "bash"]);
      writeFileSync(spec, JSON.stringify({ presets: [], tools: [] }));
      expect((await openHarness(dir)).kinds.size).toBe(0);
      // A solver has one tool under each name, and five names are pi's and the host's.
      const named = [
        { name: "edit", kind: "advisor", description: "Edits." },
        { name: "submit", kind: "reader", description: "Submits." },
      ];
      writeFileSync(spec, JSON.stringify({ presets: ["bash"], tools: named }));
      await expect(openHarness(dir)).rejects.toThrow(
        "agent/tools-spec.json names a tool edit, submit: read, bash, edit, write, submit are the host's own",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("changes its digest with any file or mode in the tool tree, as with the module, whatever its times say", async () => {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-harness-tree-")));
    try {
      cpSync(FIXTURE, dir, { recursive: true });
      const bin = join(dir, ".toolchain", "bin");
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, "tool"), "#!/bin/sh\necho one\n");
      // A link back up the tree, as a v1 state's node_modules links into its run: listed, not entered.
      symlinkSync("..", join(bin, "loop"));
      const digests = [(await openHarness(dir)).digest];
      writeFileSync(join(bin, "tool"), "#!/bin/sh\necho two\n");
      digests.push((await openHarness(dir)).digest);
      chmodSync(join(bin, "tool"), 0o755);
      // Its times in whole seconds, as `tar` and `cp -p` leave them.
      const then = new Date("2026-10-01T00:00:00Z");
      utimesSync(join(bin, "tool"), then, then);
      digests.push((await openHarness(dir)).digest);
      // A rewrite of the same size with its modification time set back: until 11 October the tree's
      // stamp held, and its content was read from before it. The wait puts the change time past
      // the coarse clock a file system stamps it with.
      const settled = statSync(join(bin, "tool")).ctimeMs + 20;
      while (Date.now() < settled) await Bun.sleep(5);
      writeFileSync(join(bin, "tool"), "#!/bin/sh\necho six\n");
      utimesSync(join(bin, "tool"), then, then);
      digests.push((await openHarness(dir)).digest);
      expect(new Set(digests).size).toBe(4);
      expect(digests[3]).toBe((await openHarness(dir)).digest);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The shim drops v1's nullable-number rewrite on this behaviour of the pinned pi.
  it("has one digest wherever it sits, though the bundle names where each file was read", async () => {
    const root = mkdtempSync(join(tmpdir(), "ana-harness-place-"));
    try {
      const places = [join(root, "a"), join(root, "deeper", "b")];
      for (const place of places) cpSync(FIXTURE, place, { recursive: true });
      const [here, there] = await Promise.all(places.map((place) => openHarness(place)));
      expect(here?.module).not.toBe(there?.module);
      expect(here?.digest).toBe(there?.digest ?? "");
      expect(here?.digest).toBe((await openHarness(FIXTURE)).digest);
      // A changed line of a tool is still another harness.
      writeFileSync(
        join(places[0] ?? "", "agent", "helper.ts"),
        "export function scaled(base: number, factor: number): number {\n  return base * factor + 1;\n}\n",
      );
      expect((await openHarness(places[0] ?? "")).digest).not.toBe(there?.digest ?? "");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds a harness's tools from its own files alone: no macro, no file outside it", async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-harness-wall-")));
    try {
      const secret = join(root, "host-secret.txt");
      const mark = join(root, "macro-ran");
      writeFileSync(secret, "host-canary-4e1b");
      const tools = (name: string, source: string) => {
        const dir = join(root, name);
        cpSync(FIXTURE, dir, { recursive: true });
        const fixture = join(dir, "agent", "tools.ts");
        writeFileSync(fixture, `${source}\n${readFileSync(fixture, "utf8")}`);
        return dir;
      };
      // A macro would run in the host as it bundles; this one would leave a file behind.
      const macro = tools(
        "macro",
        'import { ran } from "./macro.ts" with { type: "macro" };\nexport const RAN = ran();',
      );
      writeFileSync(
        join(macro, "agent", "macro.ts"),
        `import { writeFileSync } from "node:fs";\nexport function ran() { writeFileSync(${JSON.stringify(mark)}, "x"); return 1; }\n`,
      );
      await expect(openHarness(macro)).rejects.toThrow("Macros are disabled");
      expect(existsSync(mark)).toBe(false);
      // A text import would inline a host file into the module the solver's tools run.
      const text = tools(
        "text",
        `import secret from ${JSON.stringify(secret)} with { type: "text" };\nexport const SECRET = secret;`,
      );
      await expect(openHarness(text)).rejects.toThrow("which is outside the harness");
      // So would an import of a file that is a link out of the harness, and so would a linked guide.
      const linked = tools(
        "linked",
        'import leak from "./leak.txt" with { type: "text" };\nexport const LEAK = leak;',
      );
      symlinkSync(secret, join(linked, "agent", "leak.txt"));
      await expect(openHarness(linked)).rejects.toThrow("host-secret.txt, which is outside the harness");
      // A package under the harness is the Builder's to write, so its imports are held to the same
      // rule: one that reaches out of the harness is refused, whoever the importer is.
      const packaged = tools("packaged", 'import leak from "leaky";\nexport const LEAK = leak;');
      const leaky = join(packaged, "node_modules", "leaky");
      mkdirSync(leaky, { recursive: true });
      writeFileSync(join(leaky, "package.json"), '{"name":"leaky","version":"1.0.0","main":"index.ts"}');
      writeFileSync(
        join(leaky, "index.ts"),
        'import secret from "../../../host-secret.txt" with { type: "text" };\nexport default secret;\n',
      );
      await expect(openHarness(packaged)).rejects.toThrow("host-secret.txt, which is outside the harness");
      // A package linked in from another checkout's packages is outside it too, as v1's states link
      // theirs into the run that built them.
      const borrowed = tools("borrowed", 'import six from "sixfold";\nexport const SIX = six;');
      const elsewhere = join(root, "elsewhere", "node_modules", "sixfold");
      mkdirSync(elsewhere, { recursive: true });
      writeFileSync(
        join(elsewhere, "package.json"),
        '{"name":"sixfold","version":"1.0.0","main":"index.cjs"}',
      );
      writeFileSync(join(elsewhere, "index.cjs"), "module.exports = 6;\n");
      mkdirSync(join(borrowed, "node_modules"));
      symlinkSync(elsewhere, join(borrowed, "node_modules", "sixfold"));
      await expect(openHarness(borrowed)).rejects.toThrow("index.cjs, which is outside the harness");
      const guide = tools("guide", "");
      rmSync(join(guide, "agent", "BUILT_AGENTS.md"));
      symlinkSync(secret, join(guide, "agent", "BUILT_AGENTS.md"));
      await expect(openHarness(guide)).rejects.toThrow("agent/BUILT_AGENTS.md links outside the harness");
      // Its own files and a package installed under it still bundle.
      const honest = tools("honest", 'import six from "sixfold";\nexport const SIX = six;');
      const sixfold = join(honest, "node_modules", "sixfold");
      mkdirSync(sixfold, { recursive: true });
      writeFileSync(join(sixfold, "package.json"), '{"name":"sixfold","version":"1.0.0","main":"index.cjs"}');
      writeFileSync(join(sixfold, "index.cjs"), "module.exports = { six: 6, from: __dirname };\n");
      const opened = await openHarness(honest);
      expect(opened.module).not.toContain("host-canary-4e1b");
      // A CommonJS file's `__dirname` is written into the module whole, and the digest reads past it:
      // the same harness somewhere else is the same harness.
      expect(opened.module).toContain(sixfold);
      const moved = join(root, "moved");
      cpSync(honest, moved, { recursive: true });
      expect((await openHarness(moved)).digest).toBe(opened.digest);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

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

  it.skipIf(!walled)(
    "lists its tools and runs each call alone under the wall",
    async () => {
      const harness = await openHarness(FIXTURE);
      await withWall(async (wall) => {
        writeFileSync(join(wall.dirs.host, "config"), "host-canary");
        const tools = await harnessTools(harness, TASK, wall);
        // The fixture is a harness kept before the answer was a file: its factory lists a writer,
        // its spec declares it, and no solve is given it.
        expect([...harness.kinds]).toEqual([
          ["scale_base", "reader"],
          ["read_path", "advisor"],
          ["record_answer", "artifact-writer"],
        ]);
        expect(tools.map((tool) => [tool.name, tool.executionMode])).toEqual([
          ["scale_base", undefined],
          ["read_path", undefined],
        ]);
        // The label and the description reach the model as the factory states them.
        expect(tools.map(({ label, description }) => [label, description])).toEqual([
          ["Scale base", "Returns the task's base multiplied by a factor."],
          ["Read path", "Returns a file's text."],
        ]);
        const [scale, read] = tools;
        expect(scale?.parameters).toEqual({
          type: "object",
          required: ["factor"],
          properties: { factor: { type: "number" } },
        });

        const scaled = await scale!.execute("c1", { factor: 3 });
        expect(textOf(scaled)).toBe("t-1 (fixture): 21");
        expect(scaled.details).toEqual({ value: 21 });
        await expect(read!.execute("c3", { path: "missing.txt" })).rejects.toThrow(
          "cannot read missing.txt: ENOENT",
        );
        await expect(scale!.execute("c4", { factor: "3" })).rejects.toThrow(
          'tool "scale_base" arguments do not match its declared parameter schema (/factor: must be number)',
        );
        const host = join(wall.dirs.host, "config");
        await expect(read!.execute("c5", { path: host })).rejects.toThrow(
          `cannot read ${host}: ${CLOSED_CODE}`,
        );
      });
    },
    120_000,
  );
});
