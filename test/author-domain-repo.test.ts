/**
 * The Builder's workspace is a git repository created over the Pi starter pack, and every
 * authoring pass ends as a commit in it, so git is the Builder's memory of what it has already
 * tried. Two things have to hold for that memory to be worth anything. A commit must carry the
 * candidate contract and nothing else, because a `.gitignore` or a root helper the pass happened
 * to leave beside a real bundle change would otherwise enter the candidate diff; and a repair
 * workspace seeded from an adopted bundle must own its own copy of everything it can write,
 * because a repair writing back through a link would be editing the adopted tree the loop treats
 * as immutable.
 *
 * The seeding half is where the recorded failures are. `initWorkspace` copies the adopted
 * `.toolchain` and rewrites the links inside it, so a tool installed into the repair copy lands in
 * the repair copy while the adopted bytes stay as they were; a link pointing outside the tree,
 * such as the runtime itself, keeps its absolute target, because it names a host installation
 * rather than something the repair owns. Run 8729bb aborted its whole rebuild on one file, numpy's
 * `f2py`, because uv writes a console launcher whose interpreter path sits inside a single-quoted
 * `sh` header, and rewriting that is not the same operation as rewriting a link. Run 4c67fc lost
 * its round 2 on 2026-09-20 the other way round, to a compiled sketch whose debug strings named
 * the tree it was built in: the copy threw, and the throw reached the controller as an abort with
 * no owner. Both are now the copy's business rather than the round's, which is why several cases
 * here assert a safeguard line and a seeded workspace instead of a refusal.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { describe, expect, it } from "bun:test";
import { execTextSync } from "./helpers/bun-spawn-sync.ts";
import {
  beginIteration,
  commitAll,
  initWorkspace,
  resetWorkspaceToStarter,
  workspaceChangeBetween,
  workspaceHead,
  workspaceStatus,
} from "../src/author/domain-repo.ts";
import { BUILT_PRESET_IDS, presetToolNames } from "../src/truth/built-presets.ts";
import { loadBuiltStarterFactory } from "../src/truth/contracts.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { SAFEGUARDS_LOG_FILE, createSafeguardContext } from "../src/meta/safeguard.ts";
import { runtimeProcess } from "../src/meta/process.ts";
const TOOLCHAIN = ".toolchain";
const AGENT_TOOLS_TS = "agent/tools.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "ana-domain-repo-"));

/** Building the Mach-O case needs the Command Line Tools; elsewhere the relocation is a no-op
 *  and the refusal above is the whole behaviour. */
const buildsMachO =
  runtimeProcess.platform === "darwin" &&
  existsSync("/usr/bin/cc") &&
  existsSync("/usr/bin/install_name_tool");

/** One run-local safeguard log per test; absent file reads as no line, never as zero firings. */
function safeguardLog() {
  const context = createSafeguardContext(join(tmp(), "safeguards"));
  const lines = () => {
    const file = join(context.logDir, SAFEGUARDS_LOG_FILE);
    return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n") : [];
  };
  return { context, lines };
}

/** An adopted seed whose venv launcher uses uv's single-quoted header, as run 8729bb's f2py did. */
function seedWithUvVenv(seed: string, home: string): string {
  seedBundles(seed);
  const bin = join(seed, ".toolchain/venv/bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(seed, ".toolchain/venv/pyvenv.cfg"), `home = ${home}\n`);
  writeFileSync(join(bin, "python3"), "#!/bin/sh\n");
  const python = join(realpathSync(bin), "python3");
  writeFileSync(
    join(bin, "f2py"),
    `#!/bin/sh\n'''exec' '${python}' "$0" "$@"\n' '''\nfrom numpy.f2py.f2py2e import main\n`,
  );
  chmodSync(join(bin, "f2py"), 0o755);
  return python;
}

const gitOut = (dir: string, args: string[]): string => execTextSync("git", ["-C", dir, ...args]).trim();

/** Measurement's recorded sidecar, written under the SAME slugDir by claim/bundle-snapshot.ts. */
function writeBundleSnapshot(dir: string, id: string): string {
  const path = join(dir, ".bundle-snapshots", id, "agent");
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "tools.ts"), "export const recorded = 1;\n");
  return join(".bundle-snapshots", id, "agent", "tools.ts");
}

/** Minimal stampable two-bundle layout written into an initialised workspace. */
function seedBundles(dir: string): void {
  mkdirSync(join(dir, "agent"), { recursive: true });
  mkdirSync(join(dir, "correctness-model"), { recursive: true });
  writeFileSync(join(dir, AGENT_TOOLS_TS), "export const seeded = 1;\n");
  writeFileSync(join(dir, "correctness-model/brief.json"), JSON.stringify({ slug: "t" }));
  writeFileSync(join(dir, "correctness-model/tasks.json"), JSON.stringify([{ id: "t1", expect: 2 }]));
}

describe("the domain workspace repository", () => {
  it("owns seeded tool writes through relative and absolute internal links, preserving external runtime links", () => {
    const seed = tmp();
    const dir = tmp();
    seedBundles(seed);
    const tools = join(seed, TOOLCHAIN);
    const packages = join(tools, "packages");
    const sibling = `${tools}-sibling`;
    mkdirSync(packages, { recursive: true });
    mkdirSync(join(tools, "bin"));
    mkdirSync(sibling);
    writeFileSync(join(sibling, "external"), "external");
    for (const name of ["relative", "absolute", "directory"]) writeFileSync(join(packages, name), "adopted");
    symlinkSync("../packages/relative", join(tools, "bin/relative"));
    symlinkSync(join(packages, "absolute"), join(tools, "bin/absolute"));
    symlinkSync(packages, join(tools, "bin/directory"));
    symlinkSync(sibling, join(tools, "bin/sibling"));
    symlinkSync(join(tools, "pending/deep/tool"), join(tools, "bin/pending"));
    symlinkSync(join(sibling, "pending/tool"), join(tools, "bin/external-pending"));
    const runtime = realpathSync(Bun.argv[0]!);
    symlinkSync(runtime, join(tools, "bun"));

    initWorkspace(dir, seed, true);
    const owned = join(dir, TOOLCHAIN);
    expect(realpathSync(owned)).toBe(join(realpathSync(dir), TOOLCHAIN));
    expect(readlinkSync(join(owned, "bin/relative"))).toBe("../packages/relative");
    expect(readlinkSync(join(owned, "bin/absolute"))).toBe("../packages/absolute");
    expect(readlinkSync(join(owned, "bin/directory"))).toBe("../packages");
    expect(readlinkSync(join(owned, "bin/sibling"))).toBe(sibling);
    expect(readFileSync(join(owned, "bin/sibling/external"), "utf8")).toBe("external");
    expect(readlinkSync(join(owned, "bun"))).toBe(runtime);
    expect(readlinkSync(join(owned, "bin/pending"))).toBe("../pending/deep/tool");
    expect(readlinkSync(join(owned, "bin/external-pending"))).toBe(join(sibling, "pending/tool"));
    mkdirSync(join(owned, "pending/deep"), { recursive: true });
    writeFileSync(join(owned, "bin/pending"), "new install");
    expect(readFileSync(join(owned, "pending/deep/tool"), "utf8")).toBe("new install");
    expect(existsSync(join(tools, "pending"))).toBe(false);
    writeFileSync(join(owned, "bin/relative"), "repair");
    writeFileSync(join(owned, "bin/absolute"), "repair");
    writeFileSync(join(owned, "bin/directory/directory"), "repair");
    for (const name of ["relative", "absolute", "directory"]) {
      expect(readFileSync(join(packages, name), "utf8")).toBe("adopted");
      expect(readFileSync(join(owned, "packages", name), "utf8")).toBe("repair");
    }
    expect(readlinkSync(join(tools, "bin/absolute"))).toBe(join(packages, "absolute"));
    expect(readlinkSync(join(tools, "bun"))).toBe(runtime);
  });

  it("resumes with inherited tools without rewriting the adopted runtime link", () => {
    const dir = tmp();
    const inherited = tmp();
    initWorkspace(dir);
    symlinkSync("recorded-runtime", join(inherited, "bun"));
    rmSync(join(dir, TOOLCHAIN), { recursive: true, force: true });
    symlinkSync(inherited, join(dir, TOOLCHAIN));
    initWorkspace(dir);
    expect(readlinkSync(join(inherited, "bun"))).toBe("recorded-runtime");
    expect(readlinkSync(join(dir, TOOLCHAIN))).toBe(inherited);
  });

  it("relocates a uv console launcher, whose interpreter is single-quoted, into the repair tools", () => {
    const seed = tmp();
    seedBundles(seed);
    const bin = join(seed, ".toolchain/venv/bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(seed, ".toolchain/venv/pyvenv.cfg"), "home = /host\n");
    writeFileSync(join(bin, "python3"), "#!/bin/sh\n");
    const python = join(realpathSync(bin), "python3");
    // The header uv 0.9 writes for a console script: run 8729bb aborted its rebuild on numpy's f2py.
    writeFileSync(
      join(bin, "f2py"),
      `#!/bin/sh\n'''exec' '${python}' "$0" "$@"\n' '''\nfrom numpy.f2py.f2py2e import main\n`,
    );
    chmodSync(join(bin, "f2py"), 0o755);
    const dir = tmp();
    initWorkspace(dir, seed, true);
    const owned = readFileSync(join(dir, ".toolchain/venv/bin/f2py"), "utf8");
    expect(owned).toContain(`'''exec' "${join(dir, ".toolchain/venv/bin/python3")}" "$0" "$@"`);
    expect(owned).not.toContain(python);
    expect(owned).toContain("from numpy.f2py.f2py2e import main");
  });

  it("records the seed copy once with its launcher counts, and the venv home only when it stays in the adopted tree", () => {
    const outsideHome = tmp();
    seedWithUvVenv(outsideHome, "/host/python");
    const outside = safeguardLog();
    initWorkspace(tmp(), outsideHome, true, outside.context);
    const copied = outside.lines().filter((line) => line.includes("54-rebuild-seed-tool-tree-copied"));
    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain("launchersRewritten=1 singleQuoted=1");
    expect(outside.lines().some((line) => line.includes("55-rebuild-seed-venv-home-in-adopted-tree"))).toBe(
      false,
    );

    const insideHome = tmp();
    seedWithUvVenv(insideHome, join(realpathSync(insideHome), ".toolchain/py/bin"));
    const inside = safeguardLog();
    initWorkspace(tmp(), insideHome, true, inside.context);
    const homed = inside.lines().filter((line) => line.includes("55-rebuild-seed-venv-home-in-adopted-tree"));
    expect(homed).toHaveLength(1);
    expect(homed[0]).toContain("count=1 first=venv/pyvenv.cfg");
  });

  it("names a partial copy an interrupted pass left beside the tool tree, and still seeds", () => {
    const seed = tmp();
    seedWithUvVenv(seed, "/host/python");
    const dir = tmp();
    mkdirSync(join(dir, ".toolchain-0000-interrupted"), { recursive: true });
    const log = safeguardLog();
    initWorkspace(dir, seed, true, log.context);
    const leftover = log.lines().filter((line) => line.includes("53-rebuild-seed-copy-leftover"));
    expect(leftover).toHaveLength(1);
    expect(leftover[0]).toContain("count=1 first=.toolchain-0000-interrupted");
    expect(existsSync(join(dir, ".toolchain/venv/bin/f2py"))).toBe(true);
  });

  it("names an adopted tool-tree link that no longer resolves, and seeds the repair without it", () => {
    const seed = tmp();
    seedBundles(seed);
    symlinkSync("/moved-away/epoch/workspace/.toolchain", join(seed, TOOLCHAIN));
    const log = safeguardLog();
    const dir = tmp();
    initWorkspace(dir, seed, true, log.context);
    const unresolved = log.lines().filter((line) => line.includes("52-rebuild-seed-tool-tree-unresolved"));
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]).toContain("target=/moved-away/epoch/workspace/.toolchain");
    expect(readlinkSync(join(dir, ".toolchain/bun"))).toBeTruthy();
    expect(existsSync(join(dir, ".toolchain/venv"))).toBe(false);

    const present = safeguardLog();
    const noTree = tmp();
    seedBundles(noTree);
    initWorkspace(tmp(), noTree, true, present.context);
    expect(present.lines().some((line) => line.includes("52-rebuild-seed-tool-tree-unresolved"))).toBe(false);
  });

  it("counts the uncommitted paths a resumed repair carries, and nothing on a clean resume", () => {
    const seed = tmp();
    seedBundles(seed);
    const dir = tmp();
    initWorkspace(dir, seed, true);
    const clean = safeguardLog();
    initWorkspace(dir, seed, true, clean.context);
    expect(clean.lines().some((line) => line.includes("56-rebuild-workspace-resumed-dirty"))).toBe(false);
    writeFileSync(join(dir, AGENT_TOOLS_TS), "export const seeded = 2;\n");
    writeFileSync(join(dir, "agent/scratch.ts"), "export const extra = 1;\n");
    const dirty = safeguardLog();
    initWorkspace(dir, seed, true, dirty.context);
    const resumed = dirty.lines().filter((line) => line.includes("56-rebuild-workspace-resumed-dirty"));
    expect(resumed).toHaveLength(1);
    expect(resumed[0]).toContain("paths=2 first=agent/tools.ts,agent/scratch.ts");
    expect(readFileSync(join(dir, AGENT_TOOLS_TS), "utf8")).toBe("export const seeded = 2;\n");
  });

  /**
   * This used to throw, and the throw reached the controller as an abort with no owner. It cost
   * the firmware run 4c67fc its round 2 on 2026-09-20, over `acli/tmp/b1/
   * Blink.ino.elf` — a sketch the Builder had compiled inside the tool's scratch directory, whose
   * debug strings name the tree it was built in. The file is now dropped: the repair tree still
   * resolves nothing into the adopted one, and what is missing is a tool the Builder reinstalls.
   */
  it("drops an executable that embeds the adopted tool path, and copies the rest of the tree", () => {
    const seed = tmp();
    seedBundles(seed);
    const tools = join(seed, TOOLCHAIN);
    mkdirSync(join(tools, "bin"), { recursive: true });
    writeFileSync(join(tools, "custom"), `#!/bin/sh\nexec "${realpathSync(tools)}/private-runtime"\n`);
    chmodSync(join(tools, "custom"), 0o755);
    writeFileSync(join(tools, "bin/plain"), '#!/bin/sh\nexec cat "$@"\n');
    chmodSync(join(tools, "bin/plain"), 0o755);
    const log = safeguardLog();
    const dir = tmp();
    initWorkspace(dir, seed, true, log.context);
    expect(existsSync(join(dir, ".toolchain/custom"))).toBe(false);
    expect(readFileSync(join(dir, ".toolchain/bin/plain"), "utf8")).toContain("exec cat");
    const copied = log.lines().filter((line) => line.includes("54-rebuild-seed-tool-tree-copied"));
    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain("dropped=1 droppedFirst=custom");
  });

  it("drops a launcher whose destination cannot be quoted, rather than ending the rebuild", () => {
    // The rewritten header quotes the interpreter in a `sh` string, so a destination carrying a
    // quote, a backtick, `$`, a backslash or a newline cannot be written into one. That path comes
    // from the project slug and the campaign root, so it is the same for every launcher in the
    // tree: the throw this replaces aborted the whole rebuild and told its reader to recreate the
    // environment in a workspace it had just prevented from existing.
    const seed = tmp();
    seedWithUvVenv(seed, "/host/python");
    const dir = join(tmp(), "camp$aign");
    mkdirSync(dir, { recursive: true });
    const log = safeguardLog();
    initWorkspace(dir, seed, true, log.context);
    // The launcher is gone and the rest of the venv arrived, so the Builder has a tool to
    // reinstall rather than no run to reinstall it in.
    expect(existsSync(join(dir, ".toolchain/venv/bin/f2py"))).toBe(false);
    expect(existsSync(join(dir, ".toolchain/venv/pyvenv.cfg"))).toBe(true);
    const copied = log.lines().filter((line) => line.includes("54-rebuild-seed-tool-tree-copied"));
    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain("dropped=1 droppedFirst=venv/bin/f2py");
  });

  it("says nothing about drops when every copied file stands on its own", () => {
    const seed = tmp();
    seedBundles(seed);
    mkdirSync(join(seed, TOOLCHAIN));
    writeFileSync(join(seed, ".toolchain/plain"), '#!/bin/sh\nexec cat "$@"\n');
    chmodSync(join(seed, ".toolchain/plain"), 0o755);
    const log = safeguardLog();
    initWorkspace(tmp(), seed, true, log.context);
    const copied = log.lines().filter((line) => line.includes("54-rebuild-seed-tool-tree-copied"));
    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain("dropped=0");
    expect(copied[0]).not.toContain("droppedFirst");
  });

  it.if(buildsMachO)("moves a Mach-O install name into the copy, which run e6e332 refused instead", () => {
    const seed = tmp();
    seedBundles(seed);
    const tools = join(seed, TOOLCHAIN);
    mkdirSync(join(tools, "lib"), { recursive: true });
    // uv's cpython names itself by absolute path exactly this way; its consumers use @executable_path.
    const planted = join(realpathSync(tools), "lib/libprobe.dylib");
    execTextSync("/usr/bin/cc", ["-dynamiclib", "-o", planted, "-install_name", planted, "-x", "c", "-"], {
      stdin: "int probe(void) { return 7; }\n",
    });
    const dir = tmp();
    const log = safeguardLog();
    initWorkspace(dir, seed, true, log.context);
    const copied = log.lines().filter((line) => line.includes("54-rebuild-seed-tool-tree-copied"));
    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain("installNames=1");
    // The copy names itself, and the header still parses, so the library remains loadable.
    const moved = join(dir, ".toolchain/lib/libprobe.dylib");
    expect(execTextSync("/usr/bin/otool", ["-D", moved]).trim().endsWith(moved)).toBe(true);
  });

  it("creates the repo from the Pi starter pack with a root commit and preserves it on resume", async () => {
    const dir = tmp();
    const first = initWorkspace(dir);
    expect(first.created).toBe(true);
    expect(existsSync(join(dir, ".git"))).toBe(true);
    expect(readFileSync(join(dir, "MEMORY.md"), "utf8")).toContain("Builder memory");
    expect(readFileSync(join(dir, "SCRATCHPAD.md"), "utf8")).toContain("Scratchpad");
    const starter = readFileSync(join(dir, "STARTER.md"), "utf8");
    expect(starter).toContain("# Build the requested harness");
    const references = ["starter-pack/contract.md", "starter-pack/examples.md", "starter-pack/add-ons.json"];
    for (const path of references) {
      expect(readFileSync(join(dir, path), "utf8")).toBe(
        readFileSync(new URL(`../starters/pi-built-harness/${path}`, import.meta.url), "utf8"),
      );
    }
    // Public engine authoring belongs here; protected verifier evidence and answer material do not.
    expect(starter).not.toMatch(
      /\banswer key\b|\bexpected artifact\b|\bverifier (?:stdout|stderr|source)\b/i,
    );
    const toolsSource = readFileSync(join(dir, AGENT_TOOLS_TS), "utf8");
    expect(toolsSource).toContain("createDomainHarness");
    expect(toolsSource).not.toMatch(/projectArtifact|projectDraftFiles/);
    expect(JSON.parse(readFileSync(join(dir, "agent/tools-spec.json"), "utf8"))).toEqual({
      presets: ["files"],
      tools: [],
    });
    expect(existsSync(join(dir, "correctness-model/evaluator.ts"))).toBe(true);
    const addOns = parseJsonAs<Record<string, string[]>>(
      readFileSync(join(dir, "starter-pack/add-ons.json"), "utf8"),
    );
    // The menu is a projection of the code catalogue, not a second copy of it: a preset tool
    // added to `built-presets.ts` and not to this file would be invisible to the Builder, which
    // STARTER.md tells to select nothing absent from here. Run 56 lost its shell exactly so.
    expect(addOns).toEqual(Object.fromEntries(BUILT_PRESET_IDS.map((id) => [id, presetToolNames([id])])));
    const tracked = gitOut(dir, ["ls-tree", "-r", "--name-only", "HEAD"]).split("\n");
    expect(tracked).toEqual(
      expect.arrayContaining([
        "MEMORY.md",
        "SCRATCHPAD.md",
        "agent/tools-spec.json",
        AGENT_TOOLS_TS,
        "correctness-model/brief.json",
        "correctness-model/tasks.json",
        "correctness-model/controls.json",
        "correctness-model/evaluator.ts",
      ]),
    );
    // Starter reference stays on disk for reading but out of tracking: git carries exactly the
    // candidate contract, so an edit or helper beside the starter can never enter a candidate diff.
    expect(tracked).not.toContain("STARTER.md");
    expect(tracked.some((path) => path.startsWith("starter-pack/"))).toBe(false);
    expect(await loadBuiltStarterFactory(dir)).toBeTypeOf("function");
    expect(workspaceStatus(dir)).toEqual({ clean: true, dirtyPaths: [] });
    beginIteration(dir, "01-t");
    expect(workspaceHead(dir)).toBe(first.head);
    expect(readFileSync(join(dir, AGENT_TOOLS_TS), "utf8")).toContain("createDomainHarness");
    expect(readFileSync(join(dir, "correctness-model/evaluator.ts"), "utf8")).toContain(
      "Specialise the Pi Starter Pack",
    );
    for (const path of ["STARTER.md", ...references]) writeFileSync(join(dir, path), "stale reference\n");
    writeFileSync(join(dir, AGENT_TOOLS_TS), "export const currentCandidate = true;\n");
    const again = initWorkspace(dir);
    expect(again.created).toBe(false);
    expect(again.head).toBe(first.head);
    for (const path of ["STARTER.md", ...references]) {
      expect(readFileSync(join(dir, path), "utf8")).toBe(
        readFileSync(new URL(`../starters/pi-built-harness/${path}`, import.meta.url), "utf8"),
      );
    }
    expect(readFileSync(join(dir, AGENT_TOOLS_TS), "utf8")).toContain("currentCandidate");
  });

  it("commits the whole tree with its changed paths; a clean tree answers with no new commit", () => {
    const dir = tmp();
    initWorkspace(dir);
    seedBundles(dir);
    const status = workspaceStatus(dir);
    expect(status.clean).toBe(false);
    expect(status.dirtyPaths).toContain("correctness-model/brief.json");
    const committed = commitAll(dir, "01-t: fingerprinted");
    expect(committed.changedPaths).toContain("correctness-model/brief.json");
    expect(committed.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(committed.commit).not.toBe(committed.baseCommit);
    expect(workspaceStatus(dir).clean).toBe(true);
    const noop = commitAll(dir, "again");
    expect(noop).toEqual({
      commit: committed.commit,
      baseCommit: committed.commit,
      changedPaths: [],
      deletedPaths: [],
    });
  });

  it("records a deleted child path separately from rewrites", () => {
    const dir = tmp();
    initWorkspace(dir);
    writeFileSync(join(dir, "agent/obsolete-helper.ts"), "export const obsolete = true;\n");
    const added = commitAll(dir, "add helper");
    unlinkSync(join(dir, "agent/obsolete-helper.ts"));
    writeFileSync(join(dir, AGENT_TOOLS_TS), "export const replacement = true;\n");
    const repaired = commitAll(dir, "remove obsolete helper");
    expect(repaired.baseCommit).toBe(added.commit);
    expect(repaired.changedPaths).toEqual(["agent/obsolete-helper.ts", AGENT_TOOLS_TS]);
    expect(repaired.deletedPaths).toEqual(["agent/obsolete-helper.ts"]);
    expect(existsSync(join(dir, "agent/obsolete-helper.ts"))).toBe(false);
  });

  it("spans a salvage commit and the following authoring commit as one iteration change", () => {
    const dir = tmp();
    const born = initWorkspace(dir);
    writeFileSync(join(dir, "agent/interrupted.ts"), "export const interrupted = true;\n");
    const salvaged = beginIteration(dir, "02-t");
    if (salvaged === null) throw new Error("expected salvage");
    writeFileSync(join(dir, "correctness-model/repair.json"), "{}\n");
    const authored = commitAll(dir, "02-t: fingerprinted");
    const whole = workspaceChangeBetween(dir, salvaged.baseCommit, authored.commit);
    expect(whole.baseCommit).toBe(born.head);
    expect(whole.changedPaths).toEqual(["agent/interrupted.ts", "correctness-model/repair.json"]);
  });

  it("keeps the measurement bundleSnapshot sidecar out of Builder memory", () => {
    const dir = tmp();
    initWorkspace(dir);
    seedBundles(dir);
    const fingerprinted = commitAll(dir, "01-t: fingerprinted (repair none)");
    writeBundleSnapshot(dir, "cap1");
    // The candidate-check fact still reads "the Builder completed its work": a bundleSnapshot is not its work.
    expect(workspaceStatus(dir)).toEqual({ clean: true, dirtyPaths: [] });
    beginIteration(dir, "02-t");
    expect(workspaceHead(dir)).toBe(fingerprinted.commit);
    expect(gitOut(dir, ["log", "--name-only", "--format="])).not.toContain(".bundle-snapshots");
    // Ignoring is not deleting: measurement keeps the bytes it recorded.
    expect(existsSync(join(dir, ".bundle-snapshots/cap1/agent/tools.ts"))).toBe(true);
  });

  it("pins @ana resolution at the workspace root, replacing a shadow, for the tree and its bundle snapshots", () => {
    const dir = tmp();
    // A run-52-style shadow left behind where the controller's scope link belongs.
    const shadow = join(dir, "node_modules", "@ana", "agent-bundle");
    mkdirSync(shadow, { recursive: true });
    writeFileSync(
      join(shadow, "package.json"),
      JSON.stringify({ name: "@ana/agent-bundle", exports: { ".": "./index.js" } }),
    );
    writeFileSync(join(shadow, "index.js"), "module.exports = 'shadow';\n");
    initWorkspace(dir);
    const resolved = Bun.resolveSync("@ana/agent-bundle", join(dir, "agent"));
    expect(readFileSync(resolved, "utf8")).toBe(
      readFileSync(Bun.resolveSync("@ana/agent-bundle", import.meta.dir), "utf8"),
    );
    // A bundle snapshot beneath the workspace resolves through the same root — run w29's broken
    // walk-up past a campaigns/ symlink never gets the chance to matter.
    expect(Bun.resolveSync("@ana/agent-bundle", join(dir, ".bundle-snapshots", "cap1", "agent"))).toBe(
      resolved,
    );
    // Workspace scratch: the link is never tracked.
    expect(gitOut(dir, ["ls-files", "node_modules"])).toBe("");
  });

  it("narrows a repo created under wider rules back to the candidate contract, in its own commit", () => {
    const dir = tmp();
    initWorkspace(dir);
    writeFileSync(join(dir, ".git/info/exclude"), "node_modules/\n"); // a legacy repo tracked more
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
    writeFileSync(join(dir, "gen.mjs"), "console.log('gen');\n");
    const bundleSnapshot = writeBundleSnapshot(dir, "cap1");
    const swept = commitAll(dir, "salvage: unsettled tree before 02-t");
    expect(swept.changedPaths).toContain(bundleSnapshot); // the defect, reproduced under the wide rules
    expect(swept.changedPaths).toContain("gen.mjs");
    const migrated = initWorkspace(dir);
    expect(migrated.created).toBe(false);
    expect(migrated.head).not.toBe(swept.commit);
    const tracked = gitOut(dir, ["ls-files"]);
    expect(tracked).not.toContain(".bundle-snapshots");
    expect(tracked).not.toContain("gen.mjs");
    expect(tracked).not.toContain(".gitignore");
    expect(gitOut(dir, ["log", "-1", "--format=%s"])).toContain("only the candidate contract stays tracked");
    expect(workspaceStatus(dir)).toEqual({ clean: true, dirtyPaths: [] });
    // Untracking is not deleting: the bytes stay on disk and in the commits that recorded them.
    expect(existsSync(join(dir, "gen.mjs"))).toBe(true);
    expect(initWorkspace(dir).head).toBe(migrated.head); // idempotent: nothing left to narrow
  });

  it("salvages interrupted child work and keeps those exact bytes for the repair iteration", () => {
    const dir = tmp();
    const born = initWorkspace(dir);
    seedBundles(dir);
    writeFileSync(join(dir, "agent/interrupted.ts"), "export const interrupted = true;\n");
    beginIteration(dir, "02-t");
    expect(workspaceHead(dir)).not.toBe(born.head);
    expect(gitOut(dir, ["log", "-1", "--format=%s"])).toBe("salvage: unsettled tree before 02-t");
    expect(gitOut(dir, ["show", "--name-only", "--format=", "HEAD"])).toContain(
      "correctness-model/brief.json",
    );
    expect(readFileSync(join(dir, AGENT_TOOLS_TS), "utf8")).toBe("export const seeded = 1;\n");
    expect(readFileSync(join(dir, "agent/interrupted.ts"), "utf8")).toBe(
      "export const interrupted = true;\n",
    );
    expect(readFileSync(join(dir, "correctness-model/brief.json"), "utf8")).toBe('{"slug":"t"}');
    expect(workspaceStatus(dir)).toEqual({ clean: true, dirtyPaths: [] });
  });

  it("opens a later repair from the committed child harness without recopying the starter", () => {
    const dir = tmp();
    initWorkspace(dir);
    seedBundles(dir);
    writeFileSync(join(dir, "agent/domain-reader.ts"), "export const domainReader = true;\n");
    writeFileSync(join(dir, "correctness-model/domain-check.ts"), "export const domainCheck = true;\n");
    writeFileSync(join(dir, "MEMORY.md"), "# Builder memory\n\npreserve the child and repair it\n");
    const committed = commitAll(dir, "01-t: fingerprinted");
    beginIteration(dir, "02-t");
    expect(workspaceHead(dir)).toBe(committed.commit);
    expect(readFileSync(join(dir, AGENT_TOOLS_TS), "utf8")).toBe("export const seeded = 1;\n");
    expect(readFileSync(join(dir, "agent/domain-reader.ts"), "utf8")).toBe(
      "export const domainReader = true;\n",
    );
    expect(readFileSync(join(dir, "correctness-model/brief.json"), "utf8")).toBe('{"slug":"t"}');
    expect(readFileSync(join(dir, "correctness-model/domain-check.ts"), "utf8")).toBe(
      "export const domainCheck = true;\n",
    );
    expect(readFileSync(join(dir, "MEMORY.md"), "utf8")).toContain("preserve the child and repair it");
    expect(workspaceStatus(dir)).toEqual({ clean: true, dirtyPaths: [] });
  });

  it("keeps every path outside the candidate contract untracked at every commit", () => {
    // This reproduces run 53: the pass writes a `.gitignore` and two root helpers beside a
    // valid bundle change. None of them can enter the candidate diff, because the exclude
    // rules make them workspace scratch, and the files stay on disk for the next pass.
    const dir = tmp();
    initWorkspace(dir);
    seedBundles(dir);
    commitAll(dir, "01-t: fingerprinted");
    writeFileSync(join(dir, AGENT_TOOLS_TS), "export const revised = 2;\n");
    writeFileSync(join(dir, ".gitignore"), "specs.json\n");
    writeFileSync(join(dir, "gen.mjs"), "console.log('gen');\n");
    writeFileSync(join(dir, "specs.json"), "{}");
    const committed = commitAll(dir, "02-t: fingerprinted");
    expect(committed.changedPaths).toEqual([AGENT_TOOLS_TS]);
    expect(workspaceStatus(dir)).toEqual({ clean: true, dirtyPaths: [] });
    expect(existsSync(join(dir, "gen.mjs"))).toBe(true);
    const tracked = gitOut(dir, ["ls-files"]);
    expect(tracked).not.toContain("gen.mjs");
    expect(tracked).not.toContain(".gitignore");
  });
});

describe("the rebuild workspace reset", () => {
  it("wipes once per key, keeps memory files, and a durable marker protects a resumed round", () => {
    const dir = tmp();
    initWorkspace(dir);
    // A pristine starter wipes nothing, but the key still lands in history — otherwise a session
    // that authors after this no-op and dies would be wiped by its own resume.
    resetWorkspaceToStarter(dir, "k1");
    expect(gitOut(dir, ["log", "-1", "--format=%s"])).toBe(
      "rebuild: all already at starter (reset-key k1 scope all)",
    );
    writeFileSync(join(dir, "agent/design.ts"), "export const design = 1;\n");
    commitAll(dir, "01-t: fingerprinted");
    const resumedHead = workspaceHead(dir);
    resetWorkspaceToStarter(dir, "k1");
    expect(workspaceHead(dir)).toBe(resumedHead);
    expect(existsSync(join(dir, "agent/design.ts"))).toBe(true);
    // A new key resets: the authored design leaves the tree, starter bytes and memory return.
    const memoryPath = join(dir, "MEMORY.md");
    writeFileSync(memoryPath, `${readFileSync(memoryPath, "utf8")}\nlesson: kept across resets\n`);
    commitAll(dir, "02-t: memory");
    resetWorkspaceToStarter(dir, "k2");
    expect(existsSync(join(dir, "agent/design.ts"))).toBe(false);
    expect(readFileSync(memoryPath, "utf8")).toContain("kept across resets");
    // History keeps the replaced bytes as Builder memory.
    expect(gitOut(dir, ["show", "HEAD~1:agent/design.ts"])).toContain("design = 1");
    // The reset commit is the controller's own; an uncommitted tree is salvaged first.
    writeFileSync(join(dir, "agent/uncommitted.ts"), "export const interrupted = 1;\n");
    resetWorkspaceToStarter(dir, "k3");
    const log = gitOut(dir, ["log", "--format=%s"]);
    expect(log.indexOf("rebuild: all reset to starter (reset-key k3 scope all)")).toBeLessThan(
      log.indexOf("salvage: unsettled tree before rebuild reset"),
    );
    expect(gitOut(dir, ["show", "HEAD~1:agent/uncommitted.ts"])).toContain("interrupted");
    // A scoped reset keys on key and scope, wipes one surface and reports whether it applied.
    writeFileSync(join(dir, "agent/design.ts"), "export const design = 2;\n");
    writeFileSync(join(dir, "correctness-model/notes.json"), "{}\n");
    commitAll(dir, "03-t: both surfaces");
    expect(resetWorkspaceToStarter(dir, "k4", "correctness-model")).toBe(true);
    expect(existsSync(join(dir, "agent/design.ts"))).toBe(true);
    expect(existsSync(join(dir, "correctness-model/notes.json"))).toBe(false);
    expect(resetWorkspaceToStarter(dir, "k4", "correctness-model")).toBe(false);
    expect(gitOut(dir, ["log", "-1", "--format=%s"])).toBe(
      "rebuild: correctness-model reset to starter (reset-key k4 scope correctness-model)",
    );
  });
});
