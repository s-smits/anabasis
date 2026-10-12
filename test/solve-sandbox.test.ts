// The solve isolation's policy, and the wall built on it proved by running it: every case that runs
// a command runs it as a seat's commands run (`runWalled`, on a mounted cap), on the host the suite
// runs on, because a profile checked only as configuration is a profile nobody has seen refuse
// anything. Until 11 October these cases ran v1's launch of its sandboxed model process, which no
// seat of v2 runs (`docs/simplify.md`, F5 and W2).
//
// Each refusal is paired with a read that has to succeed: a wall that refuses everything would pass
// a suite testing refusals alone while making the product unusable. Run 4 is the reason it is not
// hypothetical — it walled off its own repair-attribution and Judge paths.
import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { homedir, tmpdir } from "../src/meta/os.ts";
import { containsPath } from "../src/meta/path-containment.ts";
import { dirname, join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import {
  type CommandWall,
  makeSeatDirs,
  probeWall,
  runWalled,
  solveDirs,
  walledBase,
} from "../src/solve/command.ts";
import { mountDiskCap } from "../src/verify/disk-cap.ts";
import { LINUX_BWRAP_ID } from "../src/verify/linux-bwrap.ts";
import { guardedAncestors, moveBlockingRules } from "../src/verify/seatbelt-path-guard.ts";
import { commandIsolationPolicy } from "../src/verify/solve-command-isolation.ts";
import { userTempRules } from "../src/verify/wall-policy.ts";
import {
  HOST_SOLVE_ISOLATION_PROFILE_ID,
  type SolveIsolationPolicy,
  solveIsolationPolicy,
} from "../src/verify/solve-sandbox.ts";

const onDarwin = runtimeProcess.platform === "darwin";
const CAP_BYTES = 16 * 1024 * 1024;

const made: string[] = [];
function workRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "ana-solve-sandbox-"));
  made.push(root);
  return root;
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});
let seats = 0;

/** A seat's wall over `repoRoot`, unprobed, on a mounted cap; `fn` runs with it, and the cap goes
 *  after. */
async function inSeat(
  repoRoot: string,
  otherTrees: readonly string[],
  fn: (wall: CommandWall, run: (command: string) => Promise<string>) => Promise<void>,
) {
  const dirs = solveDirs(`sandbox-${String(runtimeProcess.pid)}-${String(Date.now())}-${String(seats++)}`);
  const release = await mountDiskCap({ root: dirs.root, bytes: CAP_BYTES });
  try {
    makeSeatDirs(dirs);
    const base = solveIsolationPolicy({ repoRoot, otherTrees });
    if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
    const wall: CommandWall = {
      base,
      dirs,
      toolTree: null,
      limits: { shellDefaultSeconds: 30, shellMaxSeconds: 30 },
    };
    const run = async (command: string) => {
      let output = "";
      await runWalled(wall, command, {
        onData: (data) => {
          output += data.toString("utf8");
        },
      });
      return output;
    };
    await fn(wall, run);
  } finally {
    await release();
    rmSync(dirs.host, { recursive: true, force: true });
  }
}

describe("the solve isolation's policy", () => {
  it("denies the repository's other worktrees with it, and names them in its identity", () => {
    // A campaign runs from a worktree kept for it, and its log, every hidden value in it, lies
    // under `.ana` there. Until 10 October a shell in a sibling worktree could read it.
    const repoRoot = workRepo();
    const sibling = workRepo();
    const alone = solveIsolationPolicy({ repoRoot });
    const closed = solveIsolationPolicy({ repoRoot, otherTrees: [sibling] });
    if ("unsupported" in alone || "unsupported" in closed) {
      throw new Error("this host cannot run the isolation");
    }
    expect(alone.deniedReadRoots).not.toContain(sibling);
    expect(closed.deniedReadRoots).toContain(sibling);
    expect(closed.deniedReadRoots).toContain(realpathSync.native(sibling));
    expect(closed.deniedWriteRoots).toContain(sibling);
    expect(closed.policyHash).not.toBe(alone.policyHash);
  });

  it("denies the repository and whole operator home, reopening only explicit runtimes", () => {
    const repoRoot = workRepo();
    const policy = solveIsolationPolicy({ repoRoot });
    if ("unsupported" in policy) throw new Error(`this host cannot run the isolation: ${policy.unsupported}`);
    expect(policy.deniedReadRoots).toContain(homedir());
    // Both path forms of the repository, or the symlink form stays readable and the isolation leaks.
    expect(policy.deniedReadRoots).toContain(repoRoot);
    expect(policy.deniedReadRoots).toContain(realpathSync.native(repoRoot));
    expect(policy.deniedWriteRoots.length).toBeGreaterThan(0);
    expect(policy.allowedReadRoots.every((root) => root.startsWith(`${homedir()}/`))).toBe(true);
    expect(policy.allowedReadRoots.some((root) => root.includes("/.ssh") || root.includes("/.claude"))).toBe(
      false,
    );
    expect(policy.profileId).toBe(HOST_SOLVE_ISOLATION_PROFILE_ID);
  });

  it("reopens a tool tree with what it links to, but for one in the seat's root that links out of it", () => {
    // Until 11 October the tree's real path was reopened wherever a link led, so a Builder that
    // linked `harness/.toolchain` to the repository read it through the wall. A tree the host or a
    // pack provides keeps its link. The policy is built by hand, as it is a pure function of its
    // roots and runs where no wall does.
    const repoRoot = realpathSync(workRepo());
    const base: SolveIsolationPolicy = {
      profileId: HOST_SOLVE_ISOLATION_PROFILE_ID,
      policyHash: "fixture",
      deniedReadRoots: [repoRoot],
      deniedWriteRoots: [repoRoot],
      allowedReadRoots: [],
      mechanismPath: "/usr/bin/bwrap",
      mechanismId: LINUX_BWRAP_ID,
      network: true,
    };
    // A kept state names its tree by the link the host writes, to a tree beside it.
    const states = join(repoRoot, ".ana", "d2", "c", "states");
    const keptTree = join(states, "kept", ".toolchain");
    mkdirSync(join(states, "tree-abc", "bin"), { recursive: true });
    mkdirSync(join(states, "kept"));
    symlinkSync(join("..", "tree-abc"), keptTree);
    const seat = realpathSync(workRepo());
    const home = join(seat, "home");
    const homeTree = join(home, "harness", ".toolchain");
    mkdirSync(join(home, "harness"), { recursive: true });
    const dirs = { root: seat, kept: join(seat, "kept"), home, temp: join(seat, "tmp") };
    const allows = (toolTree: string) => commandIsolationPolicy(base, { ...dirs, toolTree }).readAllowRoots;
    expect(allows(keptTree)).toContain(join(states, "tree-abc"));
    // A stored bundle whose tree is a link to one elsewhere is reopened with its target, as before.
    const bundleTree = join(realpathSync(workRepo()), "bundle", ".toolchain");
    mkdirSync(join(bundleTree, ".."));
    mkdirSync(join(repoRoot, "shared-tree"));
    symlinkSync(join(repoRoot, "shared-tree"), bundleTree);
    expect(allows(bundleTree)).toContain(join(repoRoot, "shared-tree"));
    mkdirSync(homeTree);
    expect(allows(homeTree)).toContain(homeTree);
    rmSync(homeTree, { recursive: true });
    symlinkSync(repoRoot, homeTree);
    const opened = allows(homeTree);
    expect(opened.filter((path) => containsPath(path, repoRoot) || containsPath(path, home))).toEqual([]);
  });

  it("refuses to create an isolation policy on an unsupported platform", () => {
    // This policy supports neither Seatbelt nor bubblewrap on win32.
    const policy = solveIsolationPolicy({ repoRoot: workRepo(), runtime: { platform: "win32" } });
    expect("unsupported" in policy).toBe(true);
  });

  it("refuses a command an ordinary home canary and reads only an explicit runtime inside a denied root", async () => {
    const repoRoot = workRepo();
    const runtimeRoot = join(repoRoot, "node_modules", "transport-runtime");
    mkdirSync(runtimeRoot, { recursive: true });
    const runtimeCanary = join(runtimeRoot, "canary.txt");
    writeFileSync(runtimeCanary, "RUNTIME-CANARY\n");
    const homeRoot = mkdtempSync(join(homedir(), ".ana-solve-home-"));
    made.push(homeRoot);
    const homeCanary = join(homeRoot, "canary.txt");
    writeFileSync(homeCanary, "HOME-CANARY\n");
    const base = solveIsolationPolicy({ repoRoot, readAllowRoots: [runtimeRoot] });
    if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
    expect(base.allowedReadRoots).toContain(runtimeRoot);
    // `inSeat` builds its own base without the runtime, so this case builds the wall it runs under.
    await inSeat(repoRoot, [], async (wall) => {
      let output = "";
      await runWalled({ ...wall, base }, `cat ${homeCanary} 2>&1; cat ${runtimeCanary} 2>&1`, {
        onData: (data) => {
          output += data.toString("utf8");
        },
      });
      expect(output).not.toContain("HOME-CANARY");
      expect(output).toContain("RUNTIME-CANARY");
    });
  }, 60_000);

  // esp32 (12 October): Node, deciding a `.js` program's module type, walked up from a kept tree to
  // the checkout's package.json, and the wall's refusal of it ended every program of the tree.
  it("runs a program of a kept tool tree with no manifest of its own, and keeps the checkout's closed", async () => {
    const repoRoot = workRepo();
    writeFileSync(join(repoRoot, "package.json"), '{ "type": "module" }\n');
    const campaign = join(repoRoot, ".ana", "d2", "c");
    const tree = join(campaign, "states", "tree-abc");
    mkdirSync(join(tree, "bin"), { recursive: true });
    // The empty manifest a campaign's folder holds (`openCampaign`).
    writeFileSync(join(campaign, "package.json"), "{}\n");
    writeFileSync(join(tree, "bin", "list.js"), 'console.log(require("node:path").basename("/a/ran"));\n');
    await inSeat(repoRoot, [], async (wall) => {
      let output = "";
      const command = `node ${join(tree, "bin", "list.js")} 2>&1; cat ${join(repoRoot, "package.json")} 2>&1`;
      await runWalled({ ...wall, toolTree: tree }, command, {
        onData: (data) => {
          output += data.toString("utf8");
        },
      });
      expect(output).toStartWith("ran\n");
      expect(output).toContain("Operation not permitted");
      expect(output).not.toContain("module");
    });
  }, 60_000);

  it("starts a command under a policy that names a worktree removed since it was made", async () => {
    // The other worktrees are read once when a campaign opens. On 10 October two were removed
    // while a simulated campaign ran, and from the next policy on every solve ended
    // `sandbox-crash`: Bubblewrap cannot make a mountpoint under the read-only root. A removed
    // tree cannot be read, so it stays in the identity and takes no mount.
    const repoRoot = workRepo();
    const sibling = workRepo();
    await inSeat(repoRoot, [sibling], async (wall, run) => {
      rmSync(sibling, { recursive: true, force: true });
      expect(wall.base.deniedReadRoots).toContain(sibling);
      expect(await run("echo started")).toBe("started\n");
    });
  }, 60_000);

  // On Linux an overmount leaves the directory empty, so its listing names no tenant either way.
  it.skipIf(!onDarwin)(
    "lists nothing of the shared temporary directory, and opens a file in it by its name",
    async () => {
      const [shared] = userTempRules([]).roots;
      if (shared === undefined) throw new Error("this host names no user temporary directory");
      const tree = mkdtempSync(join(shared, "ana-unlisted-"));
      made.push(tree);
      writeFileSync(join(tree, "named.txt"), "NAMED\n");
      await inSeat(workRepo(), [], async (_wall, run) => {
        const said = await run(
          `ls ${shared} >/dev/null 2>&1 && echo listed || echo unlisted; cat ${tree}/named.txt`,
        );
        expect(said).toBe("unlisted\nNAMED\n");
      });
    },
    60_000,
  );
});

describe("the wall's probe", () => {
  it("holds on this host: the repository, the other worktree and the host's folder refused, a staged file written and read", async () => {
    const repoRoot = workRepo();
    const sibling = workRepo();
    writeFileSync(join(sibling, "package.json"), '{\n  "name": "a-sibling"\n}\n');
    const bare = workRepo();
    await inSeat(repoRoot, [sibling, bare], async (wall) => {
      expect(await probeWall(wall, repoRoot, sibling)).toBeNull();
      // A sibling with no `package.json` proves nothing by refusing it, and is not tried.
      expect(await probeWall(wall, repoRoot, bare)).toBeNull();
      // The seat's probe: once a policy a process, before the wall's first use.
      const base = await walledBase(
        wall.dirs,
        { repoRoot, otherTrees: [sibling, bare], diskBytes: CAP_BYTES },
        "a test",
      );
      expect(base.policyHash).toBe(wall.base.policyHash);
      // The probe writes nothing in a sibling, which another user may own (10 October), leaves
      // nothing in the repository, and nothing in the seat's own folders or the host's in it.
      expect(readdirSync(sibling)).toEqual(["package.json"]);
      expect(readdirSync(bare)).toEqual([]);
      expect(readdirSync(repoRoot)).toEqual([]);
      expect(readdirSync(wall.dirs.kept)).toEqual([]);
      expect(readdirSync(wall.dirs.temp)).toEqual([]);
    });
  }, 60_000);

  // On Linux the command wall hides the whole temporary directory, where every tree a test makes
  // lies, so no tree here is readable to a command whatever the policy says.
  it.skipIf(!onDarwin)(
    "says which read got through, under a policy that does not deny the trees it reads",
    async () => {
      const elsewhere = workRepo();
      const repoRoot = workRepo();
      const sibling = workRepo();
      writeFileSync(join(sibling, "package.json"), '{\n  "name": "a-sibling"\n}\n');
      await inSeat(elsewhere, [], async (wall) => {
        const said = await probeWall(wall, repoRoot, sibling);
        expect(said).toContain("repository canary: read");
        expect(said).toContain("other worktree's package.json: read");
        expect(said).toContain("host folder: refused");
        // Its own folder still read back: the launch ran, and refused what it should not have read.
        expect(said).toContain("ANA-WALL-PROBE");
        expect(readdirSync(repoRoot)).toEqual([]);
      });
    },
    60_000,
  );

  it("does not hold where its command cannot start", async () => {
    const repoRoot = workRepo();
    await inSeat(repoRoot, [], async (wall) => {
      rmSync(wall.dirs.kept, { recursive: true, force: true });
      expect(await probeWall(wall, repoRoot)).toStartWith("the probe did not run: ");
      expect(readdirSync(repoRoot)).toEqual([]);
    });
  }, 60_000);
});

describe("the rename guard", () => {
  // A read restriction names a path, so a profile without `seatbelt-path-guard.ts` refuses the
  // direct read and the rename of the denied directory, and then lets a rename of its parent
  // through: the canary comes back at exit 0.
  it("denies in the command profile the rename of every protected root's ancestors", () => {
    const repoRoot = workRepo();
    const base = solveIsolationPolicy({ repoRoot });
    if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
    const ancestors = guardedAncestors(base.deniedReadRoots);
    expect(ancestors).toContain(dirname(repoRoot));
    expect(ancestors).toContain(dirname(homedir()));
    expect(ancestors).not.toContain("/");
    if (onDarwin) {
      const scratch = join(tmpdir(), "ana-solve-sandbox-scratch");
      const { profile } = commandIsolationPolicy(base, {
        root: scratch,
        kept: join(scratch, "kept"),
        home: join(scratch, "home"),
        temp: join(scratch, "tmp"),
      });
      // Both halves of the rename: the source is unlinked and the destination is created.
      expect(profile).toContain("(deny file-write-unlink");
      expect(profile).toContain("(deny file-write-create");
      for (const ancestor of ancestors) expect(profile).toContain(`(literal ${JSON.stringify(ancestor)})`);
      // Upstream tags every rule with a per-session random suffix for its log stream.
      expect(profile).not.toContain("with message");
    }
    const again = solveIsolationPolicy({ repoRoot });
    if ("unsupported" in again) throw new Error("this host cannot run the isolation");
    expect(again.policyHash).toBe(base.policyHash);
  });

  it("keeps a command from reading the repository by renaming its parent", async () => {
    const outer = workRepo();
    const repoRoot = join(outer, "parent", "repo");
    mkdirSync(repoRoot, { recursive: true });
    writeFileSync(join(repoRoot, "canary.txt"), "RENAMED-CANARY\n");
    await inSeat(repoRoot, [], async (_wall, run) => {
      const moved = join(outer, "moved");
      const output = await run(
        `mv ${join(outer, "parent")} ${moved} 2>&1; cat ${join(moved, "repo", "canary.txt")} 2>&1; true`,
      );
      expect(output).not.toContain("RENAMED-CANARY");
      expect(existsSync(join(repoRoot, "canary.txt"))).toBe(true);
      expect(existsSync(moved)).toBe(false);
    });
  }, 60_000);

  it("emits nothing when there is nothing to protect, rather than a rule matching everything", () => {
    expect(moveBlockingRules([])).toStrictEqual([]);
    expect(guardedAncestors([])).toStrictEqual([]);
  });
});
