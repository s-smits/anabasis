// A v1 harness state opened for a v2 solve: bundled over the shim, listed and called one-shot under
// the real command wall, with each tool's label and description as its factory states them, the
// harness's own errors reaching the caller and the host-only folder out of reach.
import { expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { SeatTool } from "../src/agent/session.ts";
import { copyHarness } from "../src/builder/kept.ts";
import { stagedState } from "../src/builder/tools.ts";
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
import { type CommandWall, makeSeatDirs, solveDirs } from "../src/tools/command.ts";
import { harnessTools, openHarness } from "../src/harness/open.ts";
import { claimRoot } from "../src/wall/seat-root.ts";
import { solveIsolationPolicy } from "../src/wall/base.ts";
import { osIsolationSupport } from "../src/wall/os-isolation.ts";
import { CLOSED_CODE } from "./helpers/wall.ts";
import { writeHarness } from "./helpers/write-harness.ts";

const FIXTURE = new URL("fixtures/harness-min", import.meta.url).pathname;
const TASK = { taskId: "t-1", family: "fixture", publicInput: { base: 7 } };
const walled = osIsolationSupport().ok;
// SAFETY: harness registrations use only the context's abort signal, no tool API methods.
const UNUSED_API = undefined as never;

/** A solve wall in a claimed root for `body`, torn down after it. */
async function withWall(body: (wall: CommandWall) => Promise<void>, toolTree: string | null = null) {
  const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-harness-repo-")));
  const dirs = solveDirs(`harness-${String(runtimeProcess.pid)}-${String(Date.now())}`);
  const release = claimRoot(dirs.root);
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

function textOf(result: Awaited<ReturnType<SeatTool["execute"]>>): string {
  const [part] = result.output ?? [];
  return part?.type === "text" ? part.text : "";
}

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

it("leaves the bytecode caches a run of its Python programs writes out of its digest, and a sourceless .pyc in", async () => {
  // v065-b on 24 October: running its programs left `__pycache__` in 26 of the 54 states it kept,
  // and two states that differed from the one practised by those caches alone read as unpractised.
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-harness-bytecode-")));
  try {
    cpSync(FIXTURE, dir, { recursive: true });
    const lib = join(dir, ".toolchain", "lib");
    mkdirSync(join(lib, "deeper"), { recursive: true });
    writeFileSync(join(lib, "method.py"), "print(1)\n");
    writeFileSync(join(lib, "deeper", "other.py"), "print(2)\n");
    const clean = (await openHarness(dir)).digest;
    for (const [at, name] of [
      [lib, "method.cpython-310.pyc"],
      [join(lib, "deeper"), "other.cpython-312.pyc"],
    ] as const) {
      mkdirSync(join(at, "__pycache__"));
      writeFileSync(join(at, "__pycache__", name), "bytecode");
    }
    expect((await openHarness(dir)).digest).toBe(clean);
    // Python imports a `.pyc` outside `__pycache__` with no source beside it: it is code.
    writeFileSync(join(lib, "sourceless.pyc"), "bytecode");
    expect((await openHarness(dir)).digest).not.toBe(clean);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it.each(["__dirname", "__filename"])(
  "keeps its digest when a toolchain import uses %s through freezing and handover",
  async (location) => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-harness-toolchain-place-")));
    try {
      const source = join(root, "source");
      cpSync(FIXTURE, source, { recursive: true });
      const tools = join(source, "agent", "tools.ts");
      writeFileSync(
        tools,
        `import location from "../.toolchain/lib.cjs";\nexport const LOCATION = location;\n${readFileSync(tools, "utf8")}`,
      );
      const tree = join(source, ".toolchain");
      mkdirSync(tree);
      writeFileSync(join(tree, "lib.cjs"), `module.exports = ${location};\n`);
      const original = await openHarness(source);
      const states = join(root, "states");
      const keptTree = join(states, "tree-one");
      cpSync(tree, keptTree, { recursive: true });
      const frozen = stagedState(source, states, keptTree, "freezing-");
      const opened = await openHarness(frozen);
      expect(opened.module).toContain(keptTree);
      expect(opened.digest).toBe(original.digest);
      const handed = join(root, "handover", "harness");
      copyHarness(frozen, handed);
      expect((await openHarness(handed)).digest).toBe(original.digest);
      // Normalising the location must still leave a changed dependency as another harness.
      writeFileSync(join(handed, ".toolchain", "lib.cjs"), `module.exports = [${location}, 7];\n`);
      expect((await openHarness(handed)).digest).not.toBe(original.digest);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

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
    writeFileSync(join(elsewhere, "package.json"), '{"name":"sixfold","version":"1.0.0","main":"index.cjs"}');
    writeFileSync(join(elsewhere, "index.cjs"), "module.exports = 6;\n");
    mkdirSync(join(borrowed, "node_modules"));
    symlinkSync(elsewhere, join(borrowed, "node_modules", "sixfold"));
    await expect(openHarness(borrowed)).rejects.toThrow("index.cjs, which is outside the harness");
    const guide = tools("guide", "");
    rmSync(join(guide, "agent", "BUILT_AGENTS.md"));
    symlinkSync(secret, join(guide, "agent", "BUILT_AGENTS.md"));
    await expect(openHarness(guide)).rejects.toThrow("agent/BUILT_AGENTS.md links outside the harness");
    // A kept state's programs lie in a tree beside it, linked as `.toolchain`: its tools may import
    // them. A link to the folder above, or to a tree that does not lie beside it, reaches outside.
    const shared = 'import { lib } from "../.toolchain/lib.ts";\nexport const LIB = lib;';
    mkdirSync(join(root, "tree-1"));
    writeFileSync(join(root, "tree-1", "lib.ts"), 'export const lib = "shared-7c2d";\n');
    const kept = tools("kept", shared);
    symlinkSync(join("..", "tree-1"), join(kept, ".toolchain"));
    expect((await openHarness(kept)).module).toContain("shared-7c2d");
    const above = tools(
      "above",
      'import leak from "../.toolchain/host-secret.txt" with { type: "text" };\nexport const LEAK = leak;',
    );
    symlinkSync("..", join(above, ".toolchain"));
    await expect(openHarness(above)).rejects.toThrow("host-secret.txt, which is outside the harness");
    mkdirSync(join(root, "distant", "tree-2"), { recursive: true });
    writeFileSync(join(root, "distant", "tree-2", "lib.ts"), 'export const lib = "far-9e1f";\n');
    const far = tools("far", shared);
    symlinkSync(join("..", "distant", "tree-2"), join(far, ".toolchain"));
    await expect(openHarness(far)).rejects.toThrow("lib.ts, which is outside the harness");
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

it.skipIf(!walled)(
  "keeps JSON details and termination while every domain tool stays sequential",
  async () => {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-harness-control-")));
    try {
      writeHarness(dir, {
        spec: { presets: [], tools: [{ name: "finish_advice", kind: "advisor" }] },
        tools: `import { defineDraftTool } from "@ana/agent-bundle";
import { Type } from "@earendil-works/pi-ai";
export const createDomainHarness = () => ({ tools: [defineDraftTool({
  name: "finish_advice", label: "Finish advice", description: "Finish the advice.",
  parameters: Type.Object({}), executionMode: "parallel",
  run: () => ({ text: "Done.", details: [0, null], terminate: true }),
})] });`,
      });
      const harness = await openHarness(dir);
      await withWall(async (wall) => {
        const [registered] = await harnessTools(harness, TASK, wall);
        expect(registered?.executionMode).toBe("sequential");
        expect(await registered?.execute({}, UNUSED_API, BACKGROUND_CONTEXT)).toMatchObject({
          output: [{ type: "text", text: "Done." }],
          details: [0, null],
          control: { terminate: true },
        });
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  120_000,
);

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
        ["scale_base", "sequential"],
        ["read_path", "sequential"],
      ]);
      // Durable declarations carry each name and description as the factory states them.
      expect(tools.map(({ name, description }) => [name, description])).toEqual([
        ["scale_base", "Returns the task's base multiplied by a factor."],
        ["read_path", "Returns a file's text."],
      ]);
      const [scale, read] = tools;
      expect(scale?.parameters).toEqual({
        type: "object",
        required: ["factor"],
        properties: { factor: { type: "number" } },
      });

      const scaled = await scale!.execute({ factor: 3 }, UNUSED_API, BACKGROUND_CONTEXT);
      expect(textOf(scaled)).toBe("t-1 (fixture): 21");
      expect(scaled.details).toEqual({ value: 21 });
      await expect(read!.execute({ path: "missing.txt" }, UNUSED_API, BACKGROUND_CONTEXT)).rejects.toThrow(
        "cannot read missing.txt: ENOENT",
      );
      await expect(scale!.execute({ factor: "3" }, UNUSED_API, BACKGROUND_CONTEXT)).rejects.toThrow(
        'tool "scale_base" arguments do not match its declared parameter schema (/factor: must be number)',
      );
      const host = join(wall.dirs.host, "config");
      await expect(read!.execute({ path: host }, UNUSED_API, BACKGROUND_CONTEXT)).rejects.toThrow(
        `cannot read ${host}: ${CLOSED_CODE}`,
      );
    });
  },
  120_000,
);
