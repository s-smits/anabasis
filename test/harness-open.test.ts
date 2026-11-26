// A Built Harness opened for a solve: its guide, its selection of pi's coding tools and its tool
// tree, named by one digest. The host reads three things under a harness and builds or runs
// nothing from its files, so a harness written before the tool module went keeps its name.
import { afterAll, describe, expect, it } from "bun:test";
import { copyHarness, stagedState } from "../src/builder/store.ts";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { openHarness } from "../src/harness/open.ts";
import { writeHarness } from "./helpers/write-harness.ts";

const scratchRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-harness-open-")));
const GUIDE = "Use the checker.\n";
const PLAIN = { spec: { presets: ["bash"], tools: [] }, guide: GUIDE };
/** The module `agent/tools.ts` held in every harness that declared no tool, as the Starter wrote it. */
const NO_TOOLS = `import type { DomainHarnessFactory } from "@ana/agent-bundle";

export const createDomainHarness: DomainHarnessFactory = () => ({
  tools: [],
});
`;

afterAll(() => rmSync(scratchRoot, { recursive: true, force: true }));

function written(name: string, harness: Parameters<typeof writeHarness>[1] = PLAIN): string {
  const dir = join(scratchRoot, name);
  writeHarness(dir, harness);
  return dir;
}

describe("opening a harness", () => {
  it("opens with its guide and pi's tools as selected, and refuses a spec that declares a tool or lacks a list", async () => {
    const opened = await openHarness(
      written("plain", { ...PLAIN, spec: { presets: ["read", "bash"], tools: [] } }),
    );
    expect(opened).toMatchObject({ presets: ["read", "bash"], guide: GUIDE, toolTree: null });
    expect((await openHarness(written("unguided", { spec: PLAIN.spec }))).guide).toBeNull();
    // Some kept harnesses on record declare a tool. One is refused by the names it declares,
    // whatever their kind.
    const declares = written("declares", {
      ...PLAIN,
      spec: {
        presets: ["bash"],
        tools: [
          { name: "count_hours", kind: "advisor", description: "Counts." },
          { name: "record_answer", kind: "artifact-writer", description: "Records the answer." },
        ],
      },
    });
    await expect(openHarness(declares)).rejects.toThrow(
      "agent/tools-spec.json declares 2 tools (count_hours, record_answer): a harness gives its solver programs under .toolchain/bin and a guide, and its tools list stays empty",
    );
    const listless = written("listless");
    writeFileSync(join(listless, "agent", "tools-spec.json"), '{ "presets": ["bash"] }');
    await expect(openHarness(listless)).rejects.toThrow(
      "agent/tools-spec.json needs presets and tools lists",
    );
  });

  it("names a harness without a tool as the opener that bundled its tool module named it", async () => {
    // Read from an older opener, which bundled `agent/tools.ts` into the digest: a condition on
    // record names its harness by these, so a harness kept then is the same one now.
    expect((await openHarness(written("named"))).digest).toBe(
      "a3cd175d636a164ed528a48a80b67368f3caf7c68dd147340980dbd35dfa1c6b",
    );
    expect((await openHarness(written("named-unguided", { spec: { presets: [], tools: [] } }))).digest).toBe(
      "5da9068884e8cdb2911092a1026f8c31c74e43a5aad614db36a91cae4d3c26ef",
    );
    // The file such a harness still holds is read by nobody, so it names the same harness.
    const kept = written("named-with-module");
    writeFileSync(join(kept, "agent", "tools.ts"), NO_TOOLS);
    expect((await openHarness(kept)).digest).toBe((await openHarness(join(scratchRoot, "named"))).digest);
  });

  it("refuses a guide or a spec that links outside the harness", async () => {
    // Either would be read by the host, outside every wall, and handed to the solver.
    const secret = join(scratchRoot, "host-secret.txt");
    writeFileSync(secret, '{ "presets": ["bash"], "tools": [] }');
    const guide = written("linked-guide");
    rmSync(join(guide, "agent", "BUILT_AGENTS.md"));
    symlinkSync(secret, join(guide, "agent", "BUILT_AGENTS.md"));
    await expect(openHarness(guide)).rejects.toThrow("agent/BUILT_AGENTS.md links outside the harness");
    const spec = written("linked-spec");
    rmSync(join(spec, "agent", "tools-spec.json"));
    symlinkSync(secret, join(spec, "agent", "tools-spec.json"));
    await expect(openHarness(spec)).rejects.toThrow("agent/tools-spec.json links outside the harness");
  });

  it("changes its digest with any file or mode in the tool tree, whatever its times say", async () => {
    const dir = written("tree");
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
    // A same-size rewrite with its modification time set back must change the tree's stamp; the wait
    // puts the change time past the file system's coarse clock.
    const settled = statSync(join(bin, "tool")).ctimeMs + 20;
    while (Date.now() < settled) await Bun.sleep(5);
    writeFileSync(join(bin, "tool"), "#!/bin/sh\necho six\n");
    utimesSync(join(bin, "tool"), then, then);
    digests.push((await openHarness(dir)).digest);
    expect(new Set(digests).size).toBe(4);
    expect(digests[3]).toBe((await openHarness(dir)).digest);
    // A harness with a tool tree is another harness than the same one without.
    expect(digests).not.toContain((await openHarness(written("treeless"))).digest);
  });

  it("leaves the bytecode caches a run of its Python programs writes out of its digest, and a sourceless .pyc in", async () => {
    // Running programs can leave `__pycache__` in kept states, and states differing from the practised
    // one by caches alone must not read as unpractised.
    const dir = written("bytecode");
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
  });

  it("keeps its digest through freezing and handover, and a changed program is another harness", async () => {
    const root = join(scratchRoot, "freezing");
    const source = join(root, "source");
    writeHarness(source, { ...PLAIN, programs: { fit: "#!/bin/sh\necho fitted\n" } });
    const original = await openHarness(source);
    // A kept state's programs lie in a tree beside it, linked as `.toolchain`.
    const states = join(root, "states");
    const keptTree = join(states, "tree-one");
    cpSync(join(source, ".toolchain"), keptTree, { recursive: true });
    const frozen = stagedState(source, states, keptTree, "freezing-");
    expect((await openHarness(frozen)).digest).toBe(original.digest);
    const handed = join(root, "handover", "harness");
    copyHarness(frozen, handed);
    expect((await openHarness(handed)).digest).toBe(original.digest);
    writeFileSync(join(handed, ".toolchain", "bin", "fit"), "#!/bin/sh\necho refitted\n");
    expect((await openHarness(handed)).digest).not.toBe(original.digest);
  });
});
