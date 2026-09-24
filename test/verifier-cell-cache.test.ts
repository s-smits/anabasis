/**
 * The cell a verifier tool run starts in, and the one thing it may carry over from an earlier run:
 * the platform cache the same tool left behind.
 *
 * Every run gets a fresh cell, HOME and TMPDIR, and that is what keeps one run's files out of the
 * next verdict. It is also why a compiler rebuilt its whole platform core on every check, since
 * the core it cached under HOME went with the cell. So the cache directory under that fresh HOME is
 * restored from a store beside the cells and published back afterwards, keyed by the tool tree, the
 * tool's bytes and its interpreter's bytes, and written only by verifier runs outside the battery,
 * because a battery run executes bytes the Built solver chose.
 *
 * The cases pin the three ways a cache could go wrong: a run that should start warm does not, a
 * run that should share nothing starts warm, and a store the host did not write is read as an
 * answer rather than as a cold start with its reason.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { spawnTextSync as spawnSync } from "./helpers/bun-spawn-sync.ts";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { dirname, join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { createVerifierHost } from "../src/verify/host.ts";
import { resolveToolInventory } from "../src/verify/tool-inventory.ts";
import { commandIsolationPolicy, commandSearchPath } from "../src/verify/solve-command-isolation.ts";
import { solveIsolationPolicy } from "../src/verify/solve-sandbox.ts";
import { darwinSeatbeltSupport, prepareDarwinSeatbelt } from "../src/verify/darwin-seatbelt.ts";
import { createVerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import { VERIFIER_TEMP_SIBLING_DENY_PATTERNS, darwinUserTempRoot } from "../src/verify/wall-policy.ts";
import { deriveCandidateIsolation } from "../src/builder/candidate-isolation.ts";
import { candidateIsolationProfile } from "../src/builder/candidate-isolation-profile.ts";
import type { ToolRunResult, VerifierHostHandle } from "../src/verify/verifier-port.ts";
import { required } from "./helpers/doubles.ts";
import { makeIsolationRepo } from "./helpers/isolation-fixture.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { TOOL_PATH, hostFixture, runOnce, script, subject, workspace } from "./helpers/verifier-host.ts";

const STORE = "ana-verifier-cache";
/** Where the platform's own tools look for the user cache under HOME, as Go's `os.UserCacheDir`
 *  and every tool built on it resolve it. */
const USER_CACHE = runtimeProcess.platform === "darwin" ? ["Library", "Caches"] : [".cache"];

/** A tool that answers "warm <what the first run stored>" when its cache entry exists, and stores
 *  its first argument and answers "cold" when it does not. An argument of "slow" then sleeps past
 *  any timeout the case sets, after it has written its entry. */
const CACHE_TOOL = [
  'entry="$XDG_CACHE_HOME/cache-tool/entry"',
  'if [ -f "$entry" ]; then echo "warm $(cat "$entry")"',
  'else mkdir -p "$XDG_CACHE_HOME/cache-tool" && printf %s "$1" > "$entry" && echo cold; fi',
  'echo "home=$HOME"',
  'echo "tmp=$TMPDIR"',
  'if [ "$1" = slow ]; then sleep 30; fi',
];

afterAll(cleanupScratch);
const DARWIN = darwinSeatbeltSupport().ok;

const answer = (out: ToolRunResult) => out.stdout.split("\n")[0];
const line = (out: ToolRunResult, name: string) =>
  out.stdout
    .split("\n")
    .find((row) => row.startsWith(`${name}=`))
    ?.slice(name.length + 1);
const cacheOf = (out: ToolRunResult) => required(out.evidence.cache, "evidence.cache");

/** One run of the cache tool in its own subject, so no two runs share a cell. */
const runCache = (
  host: VerifierHostHandle,
  arg: string,
  phase: "discrimination" | "solvability" | "battery",
) => runOnce(host, subject({}, { phase }), { toolId: "cache-tool", checkId: "c-cache", args: [arg] });

/** A second host over an existing tool tree and store, as the next gate pass of one epoch opens. */
function nextHost(fx: { toolTree: string; cells: string; dir: string }, name: string) {
  const resolved = resolveToolInventory({ toolIds: ["cache-tool"], toolTree: fx.toolTree, pathDirs: [] });
  return createVerifierHost({
    inventory: resolved.inventory,
    toolTree: fx.toolTree,
    baseDir: fx.cells,
    parentEnv: { PATH: TOOL_PATH },
    requireOsSandbox: false,
    lifetime: createVerifierLifetime({ root: join(fx.dir, `lifetime-${name}`) }),
  });
}

describe("the cell a verifier tool run starts in", () => {
  it("gets a fresh home with no inherited credential or search path, and its cache inside", async () => {
    const stage = scratchDir("ana-host-env-");
    const parentHome = join(stage, "parent-home");
    // The launcher's PATH names an interpreter directory first; the cell must not search it, or a
    // `#!/usr/bin/env python3` tool would run under a different Python than the Builder shell's.
    const launcherBin = join(stage, "launcher-bin");
    script(launcherBin, "python3", ["echo launcher-python"]);
    const fx = hostFixture(
      { "env-tool": ["/usr/bin/env"] },
      {
        parentEnv: {
          PATH: `${launcherBin}:${TOOL_PATH}`,
          HOME: parentHome,
          AWS_SECRET_ACCESS_KEY: "leak-one",
          DATABASE_URL: "postgres://user:leak-two@host/db",
          OPENROUTER_API_KEY: "leak-three",
        },
      },
    );

    const out = await runOnce(fx.host, subject({}), { toolId: "env-tool", checkId: "c-env" });
    expect(out.executed).toBe(true);
    const env = Object.fromEntries(
      out.stdout
        .split("\n")
        .filter((row) => row.includes("="))
        .map((row): [string, string] => [row.slice(0, row.indexOf("=")), row.slice(row.indexOf("=") + 1)]),
    );

    // The cell env is built up from empty, so nothing crosses that was not named.
    const cellPrefix = join(fx.cells, "ana-cell-");
    const home = required(env.HOME, "HOME");
    expect(home.startsWith(cellPrefix)).toBe(true);
    expect(required(env.TMPDIR, "TMPDIR").startsWith(cellPrefix)).toBe(true);
    expect(home).not.toBe(parentHome);
    // Tools that honour XDG and tools that ask the platform land in the one directory the host
    // restores and publishes, so neither kind keeps a cache the next run cannot see.
    expect(env.XDG_CACHE_HOME).toBe(join(home, ...USER_CACHE));
    expect(env.PATH).toBe(commandSearchPath(fx.toolTree));
    expect(required(env.PATH, "PATH").startsWith(join(fx.toolTree, "bin"))).toBe(true);
    expect(env.PATH).not.toContain(launcherBin);
    for (const secret of ["leak-one", "leak-two", "leak-three"]) expect(out.stdout).not.toContain(secret);
    const cellOwned = new Set(["HOME", "PATH", "TMPDIR", "XDG_CACHE_HOME", "PWD", "SHLVL", "_"]);
    expect(Object.keys(env).filter((name) => !cellOwned.has(name))).toEqual([]);
  });
});

describe("the verifier tool cache", () => {
  it("starts a later run warm from an earlier gate run, in a HOME and TMPDIR of its own", async () => {
    const fx = hostFixture({ "cache-tool": CACHE_TOOL });
    const first = await runCache(fx.host, "one", "discrimination");
    expect(answer(first)).toBe("cold");
    const stored = cacheOf(first);
    expect(stored.key).toMatch(/^[0-9a-f]{64}$/);
    // The key and the store tree sit beside the tool digest they were derived from.
    expect(stored).toMatchObject({ path: join(fx.cells, STORE, stored.key), start: "cold", published: true });
    expect(first.evidence.toolDigest).toMatch(/^[0-9a-f]{64}$/);

    const second = await runCache(fx.host, "two", "solvability");
    expect(answer(second)).toBe("warm one");
    // It read the cache and changed nothing, so there was nothing new to store.
    expect(cacheOf(second)).toMatchObject({ key: stored.key, start: "warm", published: false });
    // What was carried is the cache alone: the cell, its HOME and its TMPDIR are new.
    expect(line(second, "home")).not.toBe(line(first, "home"));
    expect(line(second, "tmp")).not.toBe(line(first, "tmp"));
    expect(existsSync(required(line(first, "tmp"), "first tmp"))).toBe(false);
  });

  it("records beside each tool digest how the run started, its key, and why it was cold", async () => {
    // A verdict that depended on a restored cache and one that ran clean must read differently
    // afterwards, so the recorded row says which it was rather than leaving a reader to infer it.
    const fx = hostFixture({ "cache-tool": CACHE_TOOL });
    await runCache(fx.host, "one", "discrimination");
    await runCache(fx.host, "two", "discrimination");
    const [cold, warm] = fx.host.evidence();
    for (const row of [cold, warm]) {
      expect(row?.toolDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(row?.cache?.key).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(cold?.cache).toMatchObject({ start: "cold", coldReason: "nothing is stored under this key" });
    expect(warm?.cache).toMatchObject({ key: cold?.cache?.key, start: "warm" });
    // A warm start has no cold reason to give, so it records none rather than an empty one.
    expect(warm?.cache).not.toHaveProperty("coldReason");
  });

  it("shares one store across hosts over one tool tree, and never across trees or tool bytes", async () => {
    const fx = hostFixture({ "cache-tool": CACHE_TOOL });
    const first = await runCache(fx.host, "one", "discrimination");
    const key = cacheOf(first).key;

    // The next gate pass of the same epoch opens a new host over the same tree and store.
    const again = await runCache(nextHost(fx, "again"), "one", "discrimination");
    expect(answer(again)).toBe("warm one");
    expect(cacheOf(again).key).toBe(key);
    // The cache is not part of the question: the same request asks the same thing warm or cold.
    expect(again.evidence.requestDigest).toBe(first.evidence.requestDigest);

    // The same tool bytes in another tool tree, over the same store, share nothing.
    const other = workspace();
    script(join(other.toolTree, "bin"), "cache-tool", CACHE_TOOL);
    const otherTree = await runCache(nextHost({ ...other, cells: fx.cells }, "other"), "two", "battery");
    expect(answer(otherTree)).toBe("cold");
    expect(otherTree.evidence.toolDigest).toBe(first.evidence.toolDigest);
    expect(cacheOf(otherTree).key).not.toBe(key);

    // Changed tool bytes in the same tree start cold under a key of their own.
    script(join(fx.toolTree, "bin"), "cache-tool", [...CACHE_TOOL, "# another build of the tool"]);
    const rebuilt = await runCache(nextHost(fx, "rebuilt"), "three", "battery");
    expect(answer(rebuilt)).toBe("cold");
    expect(cacheOf(rebuilt).key).not.toBe(key);
  });

  it("restores into a battery run and never publishes from one", async () => {
    // A battery run executes the Built solver's submission, so what it leaves in the cache is
    // theirs, and a later verification must not start from it.
    const fx = hostFixture({ "cache-tool": CACHE_TOOL });
    const battery = await runCache(fx.host, "solver", "battery");
    expect(answer(battery)).toBe("cold");
    expect(cacheOf(battery)).toMatchObject({ start: "cold", published: false });

    const gate = await runCache(fx.host, "gate", "discrimination");
    expect(answer(gate)).toBe("cold");
    expect(cacheOf(gate).published).toBe(true);

    const measured = await runCache(fx.host, "solver-again", "battery");
    expect(answer(measured)).toBe("warm gate");
    expect(cacheOf(measured)).toMatchObject({ start: "warm", published: false });
  });

  it("publishes nothing from a run that did not execute", async () => {
    const fx = hostFixture({ "cache-tool": CACHE_TOOL });
    const cut = await runOnce(fx.host, subject({}, { phase: "discrimination" }), {
      toolId: "cache-tool",
      checkId: "c-cache",
      args: ["slow"],
      timeoutMs: 2_000,
    });
    expect(cut.nonResult?.kind).toBe("timeout");
    expect(cacheOf(cut)).toMatchObject({ start: "cold", published: false });
    // The entry it wrote before the wall ended it never reached the store.
    expect(answer(await runCache(fx.host, "after", "battery"))).toBe("cold");
  });

  it("starts cold from a store holding more than plain files and directories, and says why", async () => {
    const fx = hostFixture({ "cache-tool": CACHE_TOOL });
    const seeded = await runCache(fx.host, "real", "discrimination");
    const tree = cacheOf(seeded).path;
    const entryDir = join(tree, "cache-tool");
    // The probes run in battery so that none of them republishes a clean tree over the plant.
    const probe = async (name: string) => runCache(fx.host, name, "battery");
    const refusedCold = async (name: string, reason: string) => {
      const out = await probe(name);
      expect(out.executed).toBe(true);
      expect(answer(out)).toBe("cold");
      expect(cacheOf(out).start).toBe("cold");
      expect(cacheOf(out).coldReason).toContain(reason);
    };

    // A link planted beside a real entry: the restore would hand the tool a path out of its cell.
    const planted = join(fx.dir, "planted-entry");
    writeFileSync(planted, "planted");
    symlinkSync(planted, join(entryDir, "link"));
    await refusedCold("link", "cache-tool/link, which is neither a plain file nor a directory");
    rmSync(join(entryDir, "link"));
    // The nearest legitimate shape, the same tree of plain files, restores.
    expect(answer(await probe("plain"))).toBe("warm real");

    const fifo = spawnSync("/usr/bin/mkfifo", [join(entryDir, "pipe")]);
    expect(fifo.status).toBe(0);
    await refusedCold("fifo", "cache-tool/pipe, which is neither a plain file nor a directory");
    rmSync(join(entryDir, "pipe"));

    // The key's own tree replaced by a link to a directory someone else wrote.
    const elsewhere = join(fx.dir, "elsewhere");
    mkdirSync(join(elsewhere, "cache-tool"), { recursive: true });
    writeFileSync(join(elsewhere, "cache-tool", "entry"), "planted");
    renameSync(tree, join(fx.dir, "set-aside"));
    symlinkSync(elsewhere, tree);
    await refusedCold("linked-tree", "the stored cache is not a directory");
  });

  it("gives an answer reused within one host no cache of its own", async () => {
    // A reused answer spawned nothing and restored nothing, so a cache row would describe a run
    // that never happened.
    const fx = hostFixture({ "cache-tool": CACHE_TOOL });
    const first = await runCache(fx.host, "same", "discrimination");
    expect(cacheOf(first).published).toBe(true);
    const reused = await runCache(fx.host, "same", "discrimination");
    expect(reused.evidence.reusedFrom).toBeDefined();
    expect(reused.evidence.cache).toBeUndefined();
  });
});

describe("the walls around the store", () => {
  it("names the store in the temp-sibling denies every Darwin wall carries", () => {
    expect(VERIFIER_TEMP_SIBLING_DENY_PATTERNS).toContain(`/${STORE}`);
    const repo = makeIsolationRepo(realpathSync.native(scratchDir("ana-cache-repo-")), "repo");
    for (const mode of ["author", "workshop"] as const) {
      const { profile } = candidateIsolationProfile(deriveCandidateIsolation(repo.binding, mode), "write");
      expect(profile, mode).toContain(`(regex #"/${STORE}")`);
    }
  });

  describe.if(DARWIN)("under the live Darwin walls", () => {
    /** A probe directory under the temporary root every wall grants, so only a deny by name can
     *  close the store inside it. The root is read per probe rather than in this body, which Bun
     *  runs on every platform to collect the tests it then skips. */
    const probeRoot = () =>
      realpathSync.native(scratchDir("ana-cache-wall-", required(darwinUserTempRoot(), "confstr temp root")));
    const touch = (profile: string, target: string) =>
      spawnSync("/usr/bin/sandbox-exec", ["-p", profile, "/usr/bin/touch", target], {
        env: {},
        timeout: 10_000,
      }).status === 0;
    const read = (profile: string, target: string) =>
      spawnSync("/usr/bin/sandbox-exec", ["-p", profile, "/bin/cat", target], { env: {}, timeout: 10_000 })
        .status === 0;
    const layout = () => {
      const root = probeRoot();
      mkdirSync(join(root, STORE, "key"), { recursive: true });
      mkdirSync(join(root, "verifier-notes"), { recursive: true });
      return { store: join(root, STORE, "key", "planted"), sibling: join(root, "verifier-notes", "note") };
    };

    it("keeps a warm restore working inside the verifier wall, which cannot reach the store", async () => {
      const baseDir = probeRoot();
      const fx = hostFixture(
        {
          "cache-tool": CACHE_TOOL,
          "store-probe": [
            `cat "${join(baseDir, STORE)}"/*/cache-tool/entry && echo read-store`,
            `echo x > "${join(baseDir, STORE, "planted")}" && echo wrote-store`,
            `echo x > "${join(baseDir, "verifier-notes")}" && echo wrote-sibling`,
            "exit 0",
          ],
        },
        { baseDir, requireOsSandbox: true },
      );
      const first = await runCache(fx.host, "walled", "discrimination");
      expect(first.evidence.sandbox).toBe("darwin-seatbelt/v1");
      expect(answer(first)).toBe("cold");
      expect(answer(await runCache(fx.host, "again", "solvability"))).toBe("warm walled");

      const probe = await runOnce(fx.host, subject({}, { phase: "discrimination" }), {
        toolId: "store-probe",
        checkId: "c-probe",
      });
      expect(probe.executed).toBe(true);
      expect(probe.stdout).not.toContain("read-store");
      expect(probe.stdout).not.toContain("wrote-store");
      // The deny is by name: the temporary tree a toolchain writes is still open beside it.
      expect(probe.stdout).toContain("wrote-sibling");
      expect(existsSync(join(baseDir, STORE, "planted"))).toBe(false);
    });

    it("keeps the Built solver's command wall out of the store and in the tree beside it", () => {
      const repoRoot = scratchDir("ana-cache-built-repo-");
      const session = solveIsolationPolicy({ repoRoot });
      if ("unsupported" in session) throw new Error(session.unsupported);
      const dirs = {
        work: scratchDir("ana-cache-work-"),
        home: scratchDir("ana-cache-home-"),
        temp: scratchDir("ana-cache-temp-"),
      };
      const isolation = commandIsolationPolicy(session, dirs);
      const { store, sibling } = layout();
      expect(touch(isolation.profile, store)).toBe(false);
      expect(touch(isolation.profile, sibling)).toBe(true);
    });

    it("keeps the Builder's authoring and workshop walls out of the store and in the tree beside it", () => {
      const repo = makeIsolationRepo(realpathSync.native(scratchDir("ana-cache-builder-")), "repo");
      for (const mode of ["author", "workshop"] as const) {
        const { profile } = candidateIsolationProfile(deriveCandidateIsolation(repo.binding, mode), "write");
        const { store, sibling } = layout();
        expect(touch(profile, store), mode).toBe(false);
        expect(touch(profile, sibling), mode).toBe(true);
        expect(read(profile, sibling), mode).toBe(true);
        // A concurrent verification's cell holds a check's tool output, and the Builder may not read
        // it any more than the store, whichever temporary directory the launch froze.
        const root = probeRoot();
        for (const pattern of VERIFIER_TEMP_SIBLING_DENY_PATTERNS) {
          const planted = join(root, `${pattern.slice(1)}probe`, "held");
          mkdirSync(dirname(planted), { recursive: true });
          writeFileSync(planted, "tool output");
          expect(read(profile, planted), `${mode} ${pattern}`).toBe(false);
        }
      }
    });

    it("names the store in the verifier profile a tool run is prepared under", () => {
      const workdir = scratchDir("ana-cache-verifier-");
      const prepared = prepareDarwinSeatbelt({
        workdir,
        resolvedCommand: "/bin/sh",
        engineArgs: [],
        attestedFiles: [],
        sandboxReadRoots: [],
      });
      if ("unsupported" in prepared) throw new Error(prepared.unsupported);
      expect(prepared.profile).toContain(`(regex #"/${STORE}")`);
    });
  });
});
