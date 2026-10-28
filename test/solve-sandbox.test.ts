// The solve isolation's policy, and the wall built on it proved by running it: every case that runs
// a command runs it as a seat's commands run (`runWalled`, in a claimed root), on the host the suite
// runs on, because a profile checked only as configuration is a profile nobody has seen refuse
// anything. Until 11 October these cases ran v1's launch of its sandboxed model process, which no
// seat of v2 runs (`7f0add79:docs/simplify.md`, F5 and W2).
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
import { homedir } from "../src/meta/os.ts";
import { containsPath } from "../src/meta/path-containment.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import {
  type CommandWall,
  makeSeatDirs,
  probeWall,
  runWalled,
  solveDirs,
  walledBase,
} from "../src/tools/command.ts";
import { claimRoot } from "../src/wall/seat-root.ts";
import { LINUX_BWRAP_ID } from "../src/wall/linux-bwrap.ts";
import { commandIsolationPolicy } from "../src/wall/isolation.ts";
import { userTempRules } from "../src/wall/policy.ts";
import { toolchainTemp } from "./helpers/toolchain-temp.ts";
import {
  HOST_SOLVE_ISOLATION_PROFILE_ID,
  type SolveIsolationPolicy,
  solveIsolationPolicy,
} from "../src/wall/base.ts";
import { CLOSED } from "./helpers/wall.ts";

const onDarwin = runtimeProcess.platform === "darwin";
const nodePath = Bun.which("node");
const realNode = nodePath !== null && !realpathSync(nodePath).endsWith("/bun");

const made: string[] = [];
function workRepo(): string {
  // Named as `mktemp` names a folder, so that a policy that does not deny it lets a walled command
  // read it, as a folder anywhere else outside the denied trees would be read (`toolchainTemp`).
  const root = toolchainTemp("ana-solve-sandbox");
  made.push(root);
  return root;
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});
let seats = 0;

/** A seat's wall over `repoRoot`, unprobed, in a claimed root; `fn` runs with it, and the root
 *  goes after. */
async function inSeat(
  repoRoot: string,
  otherTrees: readonly string[],
  fn: (wall: CommandWall, run: (command: string, under?: CommandWall) => Promise<string>) => Promise<void>,
) {
  const dirs = solveDirs(`sandbox-${String(runtimeProcess.pid)}-${String(Date.now())}-${String(seats++)}`);
  const release = claimRoot(dirs.root);
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
    const run = async (command: string, under = wall) => {
      let output = "";
      await runWalled(under, command, {
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
    await inSeat(repoRoot, [], async (wall, run) => {
      const output = await run(`cat ${homeCanary} 2>&1; cat ${runtimeCanary} 2>&1`, { ...wall, base });
      expect(output).not.toContain("HOME-CANARY");
      expect(output).toContain("RUNTIME-CANARY");
    });
  }, 60_000);

  // esp32 (12 October): Node, deciding a `.js` program's module type, walked up from a kept tree to
  // the checkout's package.json, and the wall's refusal of it ended every program of the tree.
  // A host with no Node of its own, as a Linux one may be, has no module walk to test: `bun run`
  // puts a `node` that is Bun on the path, in a folder the wall closes.
  it.skipIf(!realNode)(
    "runs a program of a kept tool tree with no manifest of its own, and keeps the checkout's closed",
    async () => {
      const repoRoot = workRepo();
      writeFileSync(join(repoRoot, "package.json"), '{ "type": "module" }\n');
      const campaign = join(repoRoot, ".ana", "d2", "c");
      const tree = join(campaign, "states", "tree-abc");
      mkdirSync(join(tree, "bin"), { recursive: true });
      // The empty manifest a campaign's folder holds (`openCampaign`).
      writeFileSync(join(campaign, "package.json"), "{}\n");
      writeFileSync(join(tree, "bin", "list.js"), 'console.log(require("node:path").basename("/a/ran"));\n');
      await inSeat(repoRoot, [], async (wall, run) => {
        const command = `node ${join(tree, "bin", "list.js")} 2>&1; cat ${join(repoRoot, "package.json")} 2>&1`;
        const output = await run(command, { ...wall, toolTree: tree });
        expect(output).toStartWith("ran\n");
        // Seatbelt refuses the read; Bubblewrap leaves the path out of the mount, so it is not there.
        expect(output).toContain(CLOSED);
        expect(output).not.toContain("module");
      });
    },
    60_000,
  );

  // pip installs into the user base, and refused there it reads as a broken pip (21 October).
  it.skipIf(Bun.which("python3") === null)(
    "keeps Python's user base in the seat's home, where a package installs",
    async () => {
      await inSeat(workRepo(), [], async (wall, run) => {
        const said = await run(
          [
            "site=$(python3 -c 'import site; print(site.getusersitepackages())')",
            'mkdir -p "$site" && echo "SAID = 1" > "$site/ana_seat_mod.py"',
            "python3 -c 'import ana_seat_mod, site; print(ana_seat_mod.SAID); print(site.USER_BASE)'",
          ].join(" && "),
        );
        const [imported, base] = said.trim().split("\n");
        expect(imported).toBe("1");
        expect(containsPath(realpathSync(base ?? "/"), realpathSync(wall.dirs.home))).toBe(true);
      });
    },
    60_000,
  );

  // On Linux an overmount leaves the directory empty, so its listing names no tenant either way.
  it.skipIf(!onDarwin)(
    "closes the per-user temporary directory but for what mktemp and the shims make in it, and keeps TMPDIR on the seat's root",
    async () => {
      const [shared] = userTempRules().roots;
      if (shared === undefined) throw new Error("this host names no user temporary directory");
      // Another process's folder there, and a file it left directly in it.
      const other = mkdtempSync(join(shared, "ana-other-"));
      const left = join(shared, `ana-left-${String(runtimeProcess.pid)}.txt`);
      const named = join(shared, `ana-named-${String(runtimeProcess.pid)}`);
      made.push(other, left, named);
      writeFileSync(join(other, "secret.txt"), "OTHER\n");
      writeFileSync(left, "LEFT\n");
      await inSeat(workRepo(), [], async (wall, run) => {
        const said = await run(
          [
            `ls ${shared} >/dev/null 2>&1 && echo listed || echo unlisted`,
            `ls ${other} >/dev/null 2>&1 && echo other-listed || echo other-unlisted`,
            `cat ${other}/secret.txt 2>/dev/null || echo other-unread`,
            `{ echo x > ${other}/planted; } 2>/dev/null || echo other-unwritten`,
            `mkdir ${named} 2>/dev/null || echo unnamed`,
            `cat ${left}`,
            'made=$(mktemp -d) && echo kept > "$made/f" && cat "$made/f" && rm -r "$made"',
            'echo "$TMPDIR"',
          ].join("; "),
        );
        expect(said.split("\n").slice(0, 8)).toEqual([
          "unlisted",
          "other-unlisted",
          "other-unread",
          "other-unwritten",
          "unnamed",
          "LEFT",
          "kept",
          wall.dirs.temp,
        ]);
        expect(existsSync(join(other, "planted"))).toBe(false);
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
      const base = await walledBase(wall.dirs, { repoRoot, otherTrees: [sibling, bare] }, "a test");
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
});

describe("the rename guard", () => {
  it("keeps a command from reading the repository by renaming its parent", async () => {
    const outer = workRepo();
    const repoRoot = join(outer, "parent", "repo");
    mkdirSync(repoRoot, { recursive: true });
    writeFileSync(join(repoRoot, "canary.txt"), "RENAMED-CANARY\n");
    await inSeat(repoRoot, [], async (_wall, run) => {
      const moved = join(outer, "moved");
      const output = await run(
        `echo started; ls ${outer} 2>&1; mv ${join(outer, "parent")} ${moved} 2>&1; cat ${join(moved, "repo", "canary.txt")} 2>&1; true`,
      );
      // The command ran: a launch that refused everything would also leave the canary unread.
      expect(output).toStartWith("started\n");
      if (onDarwin) {
        // The parent is in sight, and the rename guard, not a missing path, refuses its rename. On
        // Linux the folder lies in the hidden temporary directory, so the command cannot see it.
        expect(output.split("\n")).toContain("parent");
        expect(output).toMatch(/^mv: .*Operation not permitted$/m);
      }
      expect(output).not.toContain("RENAMED-CANARY");
      expect(existsSync(join(repoRoot, "canary.txt"))).toBe(true);
      expect(existsSync(moved)).toBe(false);
    });
  }, 60_000);
});
