// Each command runs as a seat's commands run (`runWalled`), and each refusal is paired with a read that
// must succeed, since a wall refusing everything passes refusals alone.
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
  const root = toolchainTemp("ana-solve-sandbox");
  made.push(root);
  return root;
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});
let seats = 0;

async function inSeat(
  repoRoot: string,
  otherTrees: readonly string[],
  fn: (wall: CommandWall, run: (command: string, under?: CommandWall) => Promise<string>) => Promise<void>,
) {
  const dirs = solveDirs(`sandbox-${String(runtimeProcess.pid)}-${String(Date.now())}-${String(seats++)}`);
  const release = await claimRoot(dirs.root);
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
    expect(policy.allowedReadRoots.every((root) => root.startsWith(`${homedir()}/`))).toBe(true);
    expect(policy.allowedReadRoots.some((root) => root.includes("/.ssh") || root.includes("/.claude"))).toBe(
      false,
    );
    expect(policy.profileId).toBe(HOST_SOLVE_ISOLATION_PROFILE_ID);
  });

  it("reopens a tool tree with what it links to, but for one in the seat's root that links out of it", () => {
    // A link must not reopen a tree's real path, or a Builder linking `harness/.toolchain` to the
    // repository reads it through the wall; host- and pack-provided trees keep their links.
    const repoRoot = realpathSync(workRepo());
    const base: SolveIsolationPolicy = {
      profileId: HOST_SOLVE_ISOLATION_PROFILE_ID,
      policyHash: "fixture",
      deniedReadRoots: [repoRoot],
      allowedReadRoots: [],
      mechanismPath: "/usr/bin/bwrap",
      mechanismId: LINUX_BWRAP_ID,
      network: true,
    };
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
    await inSeat(repoRoot, [], async (wall, run) => {
      const output = await run(`cat ${homeCanary} 2>&1; cat ${runtimeCanary} 2>&1`, { ...wall, base });
      expect(output).not.toContain("HOME-CANARY");
      expect(output).toContain("RUNTIME-CANARY");
    });
  }, 60_000);

  // Node's module-type walk from a kept tree reaches the checkout's package.json; the wall's refusal
  // there must not end the tree's programs.
  it.skipIf(!realNode)(
    "runs a program of a kept tool tree with no manifest of its own, and keeps the checkout's closed",
    async () => {
      const repoRoot = workRepo();
      writeFileSync(join(repoRoot, "package.json"), '{ "type": "module" }\n');
      const campaign = join(repoRoot, ".ana", "d2", "c");
      const tree = join(campaign, "states", "tree-abc");
      mkdirSync(join(tree, "bin"), { recursive: true });
      writeFileSync(join(campaign, "package.json"), "{}\n");
      writeFileSync(join(tree, "bin", "list.js"), 'console.log(require("node:path").basename("/a/ran"));\n');
      await inSeat(repoRoot, [], async (wall, run) => {
        const command = `node ${join(tree, "bin", "list.js")} 2>&1; cat ${join(repoRoot, "package.json")} 2>&1`;
        const output = await run(command, { ...wall, toolTree: tree });
        expect(output).toStartWith("ran\n");
        expect(output).toContain(CLOSED);
        expect(output).not.toContain("module");
      });
    },
    60_000,
  );

  // pip installs into the user base, and refused there it reads as a broken pip.
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

  it.skipIf(!onDarwin)(
    "closes the per-user temporary directory but for what mktemp and the shims make in it, and keeps TMPDIR on the seat's root",
    async () => {
      const [shared] = userTempRules().roots;
      if (shared === undefined) throw new Error("this host names no user temporary directory");
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
      expect(await probeWall(wall, repoRoot, bare)).toBeNull();
      const base = await walledBase(wall.dirs, { repoRoot, otherTrees: [sibling, bare] }, "a test");
      expect(base.policyHash).toBe(wall.base.policyHash);
      // The probe writes nothing in a sibling, which another user may own, nor in the repository or the
      // seat's own folders.
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
      expect(output).toStartWith("started\n");
      if (onDarwin) {
        expect(output.split("\n")).toContain("parent");
        expect(output).toMatch(/^mv: .*Operation not permitted$/m);
      }
      expect(output).not.toContain("RENAMED-CANARY");
      expect(existsSync(join(repoRoot, "canary.txt"))).toBe(true);
      expect(existsSync(moved)).toBe(false);
    });
  }, 60_000);
});

// Seatbelt confines a process, not what it asks of an unconfined one: each case asks one to act and
// checks nothing came back.
describe.skipIf(!onDarwin)("the Darwin wall's edges", () => {
  it("is not started by `open` on an app the command wrote", async () => {
    const repoRoot = workRepo();
    writeFileSync(join(repoRoot, "secret.txt"), "OPEN-CANARY\n");
    await inSeat(repoRoot, [], async (wall, run) => {
      const app = join(wall.dirs.root, "Probe.app");
      const leak = join(wall.dirs.root, "leak.txt");
      mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
      writeFileSync(
        join(app, "Contents", "MacOS", "Probe"),
        `#!/bin/sh\ncat ${repoRoot}/secret.txt > ${leak}\n`,
        {
          mode: 0o755,
        },
      );
      writeFileSync(
        join(app, "Contents", "Info.plist"),
        '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Probe</string>' +
          "<key>LSBackgroundOnly</key><true/></dict></plist>",
      );
      const output = await run(`echo started; open -g -j ${app} 2>/dev/null; echo "open=$?"; sleep 3`);
      expect(output).toStartWith("started\n");
      expect(output).not.toContain("open=0");
      expect(existsSync(leak)).toBe(false);
    });
  }, 60_000);

  it("reaches a socket in the seat's root and the resolver's, and no other listener's", async () => {
    // A folder no path rule closes, so only the socket rule stands between the command and the
    // listener, as for the VPN daemon's and print server's sockets.
    const cache = Bun.spawnSync(["/usr/bin/getconf", "DARWIN_USER_CACHE_DIR"]).stdout.toString().trim();
    const unclosed = mkdtempSync(join(cache, "ana-wall-"));
    made.push(unclosed);
    let heard = 0;
    const listener = Bun.listen({
      unix: join(unclosed, "s"),
      socket: {
        open: () => {
          heard += 1;
        },
        data: () => {},
      },
    });
    const client = (path: string) =>
      `python3 -I -c 'import socket,sys;socket.socket(socket.AF_UNIX).connect(sys.argv[1])' ${path} 2>/dev/null && echo reached || echo refused`;
    const probes = (own: string) =>
      `${client(join(unclosed, "s"))}; cd "$TMPDIR" && python3 -I -c 'import socket,sys;s=socket.socket(socket.AF_UNIX);s.bind(sys.argv[1]);s.listen();s.accept()' ${own} & sleep 1; cd "$TMPDIR"; ${client(own)}; ${client("/var/run/mDNSResponder")}`;
    try {
      await inSeat(workRepo(), [], async (wall, run) => {
        const reach = async (own: string, under = wall) =>
          (await run(probes(own), under)).split("\n").slice(0, 3);
        expect(await reach("o")).toEqual(["refused", "reached", "reached"]);
        const offline = { ...wall, base: { ...wall.base, network: false } };
        expect(await reach("p", offline)).toEqual(["refused", "reached", "refused"]);
      });
      await Bun.sleep(200);
      expect(heard).toBe(0);
    } finally {
      listener.stop(true);
    }
  }, 60_000);

  it("does not run launchctl, whose requests launchd takes from a walled process too", async () => {
    await inSeat(workRepo(), [], async (_wall, run) => {
      const output = await run(
        `id -un >/dev/null && echo id; launchctl print "gui/$(id -u)" >/dev/null 2>&1; echo "launchctl=$?"`,
      );
      expect(output.split("\n").slice(0, 2)).toEqual(["id", "launchctl=126"]);
    });
  }, 60_000);

  it("keeps another process's command line out of reach", async () => {
    const marker = `ARGV-CANARY-${String(runtimeProcess.pid)}`;
    const other = Bun.spawn(["/bin/sh", "-c", `sleep 30; : ${marker}`]);
    try {
      await inSeat(workRepo(), [], async (_wall, run) => {
        const output = await run(`echo started; pgrep -lf ${marker} 2>/dev/null; true`);
        expect(output).toStartWith("started\n");
        expect(output).not.toContain(`: ${marker}`);
      });
    } finally {
      other.kill();
    }
  }, 60_000);

  it("runs a process substitution and writes to its own standard streams, while /tmp stays closed", async () => {
    await inSeat(workRepo(), [], async (_wall, run) => {
      const output = await run(
        `diff <(echo a) <(echo a) && echo same; echo out > /dev/stdout; python3 -I -c 'open("/dev/stderr","w").write("err\\n")' 2>&1; (echo x > /tmp/wall-probe) 2>/dev/null || echo closed`,
      );
      expect(output.split("\n").slice(0, 4)).toEqual(["same", "out", "err", "closed"]);
    });
  }, 60_000);
});

describe("explicit readAllowRoots inside tmpdir", () => {
  it("reopens an explicitly granted readAllowRoot under tmpdir while keeping sibling tmpdir paths closed", async () => {
    const allowed = mkdtempSync(join(tmpdir(), "ana-allowed-tmp-"));
    const sibling = mkdtempSync(join(tmpdir(), "ana-denied-tmp-"));
    made.push(allowed, sibling);
    writeFileSync(join(allowed, "ok.txt"), "ALLOWED_OK\n");
    writeFileSync(join(sibling, "secret.txt"), "SIBLING_SECRET\n");
    const base = solveIsolationPolicy({ repoRoot: workRepo(), readAllowRoots: [allowed] });
    if ("unsupported" in base) throw new Error(base.unsupported);
    const dirs = solveDirs(`allow-tmp-${String(runtimeProcess.pid)}-${String(Date.now())}`);
    makeSeatDirs(dirs);
    try {
      const chunks: string[] = [];
      const res = await runWalled(
        { base, dirs, toolTree: null, limits: { shellDefaultSeconds: 30, shellMaxSeconds: 30 } },
        `cat ${join(allowed, "ok.txt")}; cat ${join(sibling, "secret.txt")} 2>/dev/null || echo sibling-denied`,
        { timeout: 15, onData: (b) => chunks.push(b.toString()) },
      );
      expect(res.exitCode).toBe(0);
      expect(chunks.join("").trim().split("\n")).toEqual(["ALLOWED_OK", "sibling-denied"]);
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  }, 60_000);
});
