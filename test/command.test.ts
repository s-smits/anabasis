// A solve's commands, executed under the real command wall on a mounted cap: the home survives
// between commands, the folder a command that brings files starts in does not, staged input
// reaches it, neither the host-only folder, the repository, its other worktrees, a stored pack nor
// a reviewer's Claude home can be read, the host's folder in the seat cannot be written, and no
// command outlives the shell limits. And a command still starts on a full volume, where it is the
// one that can empty it.
import { describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { basename, dirname, join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import {
  type CommandWall,
  heldSeconds,
  makeSeatDirs,
  reserveSeconds,
  runWalled,
  solveDirs,
} from "../src/solve/command.ts";
import { mountDiskCap } from "../src/verify/disk-cap.ts";
import { toolchainTemp } from "./helpers/toolchain-temp.ts";
import { solveIsolationPolicy } from "../src/verify/solve-sandbox.ts";
import { hostScratch } from "../src/verify/wall-policy.ts";

const CAP_BYTES = 16 * 1024 * 1024;

/** A wall over a mounted seat, with no tool tree and 30 seconds a command. */
const walled = (base: CommandWall["base"], dirs: CommandWall["dirs"]): CommandWall => ({
  base,
  dirs,
  toolTree: null,
  limits: { shellDefaultSeconds: 30, shellMaxSeconds: 30 },
});

async function run(wall: CommandWall, command: string, stage?: (into: string) => void, timeout?: number) {
  let output = "";
  const onData = (data: Buffer) => {
    output += data.toString("utf8");
  };
  const result = await runWalled(wall, command, { onData, timeout, stage });
  return { exitCode: result.exitCode, output };
}

describe("how long a command may run", () => {
  const limits = { shellDefaultSeconds: 300, shellMaxSeconds: 900 };
  /** A solve of `seconds` that has used `used` of them, read at time 1,000,000. */
  const at = (seconds: number, used: number) =>
    [{ limits, clock: { started: 1_000_000 - used * 1000, seconds } }, 1_000_000] as const;

  it("is its own limit, and near the solve's end what is left before the reserve", () => {
    // The reserve: a minute, and an eighth of a solve shorter than eight.
    expect([7200, 480, 300, 60].map(reserveSeconds)).toEqual([60, 60, 37, 7]);
    // Early in a solve a command has its own limits, as on a wall with no clock.
    expect(heldSeconds(undefined, ...at(7200, 100))).toEqual({ asked: 300, seconds: 300, nearEnd: false });
    expect(heldSeconds(900, { limits })).toEqual({ asked: 900, seconds: 900, nearEnd: false });
    expect(heldSeconds(900, { limits, clock: { started: null, seconds: 480 } })).toEqual({
      asked: 900,
      seconds: 900,
      nearEnd: false,
    });
    // Eight minutes, three used: 300 left, 60 kept back, so 240 for a command that asked for more.
    expect(heldSeconds(undefined, ...at(480, 180))).toEqual({ asked: 300, seconds: 240, nearEnd: true });
    expect(heldSeconds(900, ...at(480, 180))).toEqual({ asked: 900, seconds: 240, nearEnd: true });
    expect(heldSeconds(100, ...at(480, 180))).toEqual({ asked: 100, seconds: 240, nearEnd: true });
    // A named timeout below the default is raised to it, and the solve's end still comes first.
    expect(heldSeconds(undefined, ...at(480, 400))).toEqual({ asked: 300, seconds: 20, nearEnd: true });
    // Three seconds before the reserve the command is cut there, as the solver is told.
    expect(heldSeconds(undefined, ...at(480, 417))).toEqual({ asked: 300, seconds: 3, nearEnd: true });
    expect(heldSeconds(undefined, ...at(3, 0))).toEqual({ asked: 300, seconds: 3, nearEnd: true });
    // Inside the reserve the limits stand: the wall cuts.
    expect(heldSeconds(undefined, ...at(480, 420))).toEqual({ asked: 300, seconds: 300, nearEnd: false });
    expect(heldSeconds(undefined, ...at(480, 470))).toEqual({ asked: 300, seconds: 300, nearEnd: false });
  });
});

describe("a solve's walled commands", () => {
  it.skipIf(runtimeProcess.platform !== "darwin")(
    "still start on a volume a solver has filled, so that it can empty it",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-full-")));
      const dirs = solveDirs(`full-${String(runtimeProcess.pid)}-${String(Date.now())}`);
      const release = await mountDiskCap({ root: dirs.root, bytes: CAP_BYTES });
      try {
        makeSeatDirs(dirs);
        const base = solveIsolationPolicy({ repoRoot });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        const wall = walled(base, dirs);
        // Four times the cap, so the volume is full whatever the filesystem keeps back.
        const filled = await run(wall, "dd if=/dev/zero of=fill bs=1048576 count=64 2>&1; echo dd:$?");
        expect(filled.output).not.toContain("dd:0");
        // One that brings files has nowhere to stage them, and fails as the full volume it is.
        await expect(
          run(wall, "true", (into) => writeFileSync(join(into, "big"), "x".repeat(1 << 20))),
        ).rejects.toThrow("ENOSPC");
        // On 2026-10-09 a solve in this state was refused `rm -rf ~/w` fourteen times running.
        expect((await run(wall, "rm -f fill && echo freed")).output).toContain("freed");
        expect((await run(wall, "echo again > note && cat note")).output).toBe("again\n");
      } finally {
        await release();
        rmSync(dirs.host, { recursive: true, force: true });
        rmSync(repoRoot, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it.skipIf(runtimeProcess.platform !== "darwin")(
    "keep the home, drop each command's folder, and read neither the host folder, the repository nor a reader's home",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-repo-")));
      writeFileSync(join(repoRoot, "secret"), "repo-canary");
      // Where a reader or the Examiner keeps its Claude Code session, as `readOnce` makes it.
      const reader = realpathSync.native(hostScratch("claude-cli-reader-"));
      writeFileSync(join(reader, "session"), "reader-canary");
      const dirs = solveDirs(`test-${String(runtimeProcess.pid)}-${String(Date.now())}`);
      const release = await mountDiskCap({ root: dirs.root, bytes: CAP_BYTES });
      try {
        makeSeatDirs(dirs);
        writeFileSync(join(dirs.host, "config"), "host-canary");
        const base = solveIsolationPolicy({ repoRoot });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        const wall: CommandWall = {
          base,
          dirs,
          toolTree: null,
          limits: { shellDefaultSeconds: 1, shellMaxSeconds: 2 },
        };

        const first = await run(wall, 'echo kept > "$HOME/note" && pwd && cat staged', (into) =>
          writeFileSync(join(into, "staged"), "staged-input"),
        );
        expect(first.exitCode).toBe(0);
        expect(first.output).toContain("staged-input");
        const firstFolder = first.output.split("\n")[0] ?? "";

        const second = await run(wall, `cat "$HOME/note"; ls ${JSON.stringify(firstFolder)} 2>&1; true`);
        expect(second.output).toContain("kept");
        expect(second.output).toContain("No such file");

        const host = await run(wall, `cat ${JSON.stringify(join(dirs.host, "config"))} 2>&1; true`);
        expect(host.output).not.toContain("host-canary");
        const repo = await run(wall, `cat ${JSON.stringify(join(repoRoot, "secret"))} 2>&1; true`);
        expect(repo.output).not.toContain("repo-canary");
        const read = await run(wall, `cat ${JSON.stringify(join(reader, "session"))} 2>&1; true`);
        expect(read.output).toContain("Operation not permitted");

        // A command that backgrounds work and returns has left nothing running. The shell around the
        // wall leads the command's group, not the shell that reaps it: read by its own pid, the group
        // was empty and a solver's loop ran on for over 20 minutes after its command (2026-10-09).
        const left = await run(wall, "nohup sleep 30 >/dev/null 2>&1 & echo $!");
        expect(left.exitCode).toBe(0);
        await Bun.sleep(100);
        expect(() => runtimeProcess.kill(Number(left.output), 0)).toThrow("ESRCH");
        // The leader was spared: the command's exit code reported after the reaping.
        // A job in a process group of its own is out of that trap's reach once the shell that started
        // it has gone, and GNU `timeout` makes one: a solver's three searches under it ran on after
        // their command returned (2026-10-09). It still works on the solve's volume.
        const apart = await run(wall, "set -m; sleep 30 >/dev/null 2>&1 & echo $!");
        await Bun.sleep(100);
        expect(() => runtimeProcess.kill(Number(apart.output), 0)).toThrow("ESRCH");

        // Every command is held to the condition's shell limits here, whoever launched it: one that
        // names no timeout runs for the default, and one that names too long a timeout for the maximum.
        await expect(run(wall, "sleep 5")).rejects.toThrow("timeout:1");
        await expect(run(wall, "sleep 5", undefined, 60)).rejects.toThrow("timeout:2");
        // A command the wall cuts is killed by its group and never runs its trap, so a child in a
        // group of its own outlived that too: five of the nine commands one run's wall cut sat under
        // an inner `timeout` (2026-10-09).
        await expect(run(wall, 'set -m; sleep 30 & echo $! > "$HOME/cut"; wait')).rejects.toThrow(
          "timeout:1",
        );
        await Bun.sleep(100);
        expect(() => runtimeProcess.kill(Number(readFileSync(join(dirs.home, "cut"), "utf8")), 0)).toThrow(
          "ESRCH",
        );
      } finally {
        await release();
        rmSync(dirs.host, { recursive: true, force: true });
        rmSync(repoRoot, { recursive: true, force: true });
        rmSync(reader, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it("refuse a command the repository, its other worktree and the host's folder in the seat, and let it write and read its own", async () => {
    // The four steps the wall's probe takes before a seat's first command (`walledBase`), here as a
    // solver's command would spell them.
    const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-reads-")));
    writeFileSync(join(repoRoot, "secret"), "repo-canary");
    const sibling = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-sibling-")));
    writeFileSync(join(sibling, "package.json"), '{ "name": "sibling-canary" }');
    const dirs = solveDirs(`reads-${String(runtimeProcess.pid)}-${String(Date.now())}`);
    const release = await mountDiskCap({ root: dirs.root, bytes: CAP_BYTES });
    try {
      makeSeatDirs(dirs);
      const base = solveIsolationPolicy({ repoRoot, otherTrees: [sibling] });
      if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
      const wall = walled(base, dirs);
      const read = await run(
        wall,
        [
          `cat ${join(repoRoot, "secret")} 2>/dev/null || echo repo-refused`,
          `cat ${join(sibling, "package.json")} 2>/dev/null || echo sibling-refused`,
          `echo x 2>/dev/null > ${join(dirs.kept, "made")} || echo kept-refused`,
          `ln -s / ${join(dirs.kept, "link")} 2>/dev/null || echo link-refused`,
          `rmdir ${dirs.kept} 2>/dev/null || echo removal-refused`,
          "echo own-canary > own && cat own",
        ].join("; "),
      );
      expect(read.output).toBe(
        "repo-refused\nsibling-refused\nkept-refused\nlink-refused\nremoval-refused\nown-canary\n",
      );
    } finally {
      await release();
      rmSync(dirs.host, { recursive: true, force: true });
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(sibling, { recursive: true, force: true });
    }
  }, 60_000);

  it("refuse a command a stored pack by the pack's path, which no folder's name stands in for", async () => {
    // A pack laid out as the buffer pack is, its hidden values under `correctness-model`.
    const repoRoot = toolchainTemp("ana-command-pack-repo");
    const pack = toolchainTemp("ana-command-pack");
    const bundle = join(pack, "fixture", "workspace");
    const hidden = join(bundle, "correctness-model", "expected.json");
    mkdirSync(dirname(hidden), { recursive: true });
    writeFileSync(hidden, "pack-canary\n");
    const dirs = solveDirs(`pack-${String(runtimeProcess.pid)}-${String(Date.now())}`);
    const release = await mountDiskCap({ root: dirs.root, bytes: CAP_BYTES });
    try {
      makeSeatDirs(dirs);
      const readUnder = async (packRoots: string[]) => {
        const base = solveIsolationPolicy({ repoRoot, packRoots });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        return (await run(walled(base, dirs), `cat ${hidden} 2>/dev/null || echo pack-refused`)).output;
      };
      expect(await readUnder([pack, bundle])).toBe("pack-refused\n");
      // Left out of the policy, the same file is read on Darwin in a folder named as `mktemp` names
      // one, which the wall grants a toolchain: its folder's name closes nothing. Linux hides the
      // whole temporary directory.
      if (runtimeProcess.platform === "darwin") expect(await readUnder([])).toBe("pack-canary\n");
    } finally {
      await release();
      rmSync(dirs.host, { recursive: true, force: true });
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(pack, { recursive: true, force: true });
    }
  }, 60_000);

  it.skipIf(runtimeProcess.platform !== "linux")(
    "give a seat a temporary directory of its own under its volume, and each command a /tmp that shows nothing another left in the host's",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-private-tmp-")));
      const dirs = solveDirs(`tmp-${String(runtimeProcess.pid)}-${String(Date.now())}`);
      const release = await mountDiskCap({ root: dirs.root, bytes: CAP_BYTES });
      // A canary another solve, a verification cell or the host itself might have left in /tmp.
      const canary = join("/tmp", `ana-h1-canary-${String(runtimeProcess.pid)}`);
      writeFileSync(canary, "left by the host");
      try {
        makeSeatDirs(dirs);
        const base = solveIsolationPolicy({ repoRoot });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        const wall = walled(base, dirs);
        // The seat's TMPDIR is its own folder on its volume, where the cap counts it, and the host's
        // /tmp with the canary in it is hidden behind an empty private one.
        const first = await run(
          wall,
          `echo "$TMPDIR"; ls /tmp; cat ${canary} 2>&1 || echo unseen; echo first > /tmp/left; echo second > "$TMPDIR/left"`,
        );
        expect(first.output).toContain(join(basename(dirs.root), "tmp"));
        expect(first.output).not.toContain("left by the host");
        expect(first.output).toContain("unseen");
        // What the first command wrote under /tmp is gone with it: the next command starts in a
        // fresh private /tmp, and the host's /tmp never saw it. The seat's TMPDIR keeps what it was
        // given, as the home does.
        const second = await run(wall, 'ls /tmp; cat /tmp/left 2>/dev/null || echo gone; cat "$TMPDIR/left"');
        expect(second.output).toContain("gone");
        expect(second.output).toMatch(/^second$/m);
        expect(existsSync("/tmp/left")).toBe(false);
        expect(readFileSync(canary, "utf8")).toBe("left by the host");
      } finally {
        await release();
        rmSync(canary, { force: true });
        rmSync(dirs.host, { recursive: true, force: true });
        rmSync(repoRoot, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it.skipIf(runtimeProcess.platform !== "darwin")(
    "close the host's /tmp and /var/tmp to a command: what another seat left there is neither read nor run, and a command leaves nothing there",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-closed-tmp-")));
      const dirs = solveDirs(`closed-tmp-${String(runtimeProcess.pid)}-${String(Date.now())}`);
      const release = await mountDiskCap({ root: dirs.root, bytes: CAP_BYTES });
      // What another campaign's Builder left in /tmp on 10 October: a file, and a program a later
      // solve of a third campaign ran.
      const canary = join("/tmp", `ana-h1-canary-${String(runtimeProcess.pid)}`);
      const program = join("/tmp", `ana-h1-program-${String(runtimeProcess.pid)}`);
      const left = join("/tmp", `ana-h1-left-${String(runtimeProcess.pid)}`);
      // And what a v1 run left in /var/tmp on 12 October: a folder an Examiner listed and read.
      const kept = join("/private/var/tmp", `ana-h1-canary-${String(runtimeProcess.pid)}`);
      writeFileSync(canary, "left by the host");
      writeFileSync(program, "#!/bin/sh\necho ran\n", { mode: 0o755 });
      writeFileSync(kept, "left in var tmp");
      try {
        makeSeatDirs(dirs);
        const base = solveIsolationPolicy({ repoRoot });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        const wall = walled(base, dirs);
        const closed = await run(
          wall,
          [
            `cat ${canary} 2>/dev/null || echo unseen`,
            `${program} 2>/dev/null || echo unrun`,
            `echo x > ${left} 2>/dev/null || echo unwritten`,
            `mkdir ${left}.d 2>/dev/null || echo unmade`,
            `cat ${kept} 2>/dev/null || echo unkept`,
            `cat /var/tmp/${basename(kept)} 2>/dev/null || echo unkept`,
            `ls /private/var/tmp 2>/dev/null || echo unlisted`,
            `ls /var/tmp/ 2>/dev/null || echo unlisted`,
          ].join("; "),
        );
        expect(closed.output).not.toContain("left by the host");
        expect(closed.output).not.toContain("left in var tmp");
        expect(closed.output).not.toContain(basename(kept));
        expect(closed.output.match(/^unkept$/gm)).toHaveLength(2);
        expect(closed.output.match(/^unlisted$/gm)).toHaveLength(2);
        expect(closed.output).not.toMatch(/^ran$/m);
        for (const word of ["unseen", "unrun", "unwritten", "unmade"]) expect(closed.output).toContain(word);
        expect(existsSync(left)).toBe(false);
        expect(existsSync(`${left}.d`)).toBe(false);
        // The temporary files a tool takes without naming /tmp still work: the shell's here-document,
        // Python's tempfile in the command's own folder, and `mktemp`, which on Darwin takes the user
        // temporary directory the wall still grants, under a name of its own choosing.
        const followed = await run(
          wall,
          "cat <<'EOF'\nheredoc\nEOF\nmktemp -d\npython3 -c 'import tempfile; print(tempfile.mkdtemp())'",
        );
        const [said, made, python] = followed.output.trim().split("\n");
        expect(said).toBe("heredoc");
        expect(made).toMatch(/^\/(?!tmp\/|private\/tmp\/)/);
        expect(python).toContain(join(basename(dirs.root), "tmp"));
      } finally {
        await release();
        rmSync(canary, { force: true });
        rmSync(program, { force: true });
        rmSync(kept, { force: true });
        rmSync(dirs.host, { recursive: true, force: true });
        rmSync(repoRoot, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it.skipIf(runtimeProcess.platform !== "darwin")(
    "keep what Python and make write as temporary in the seat's own folder, on its volume",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-temp-")));
      const dirs = solveDirs(`temp-${String(runtimeProcess.pid)}-${String(Date.now())}`);
      const release = await mountDiskCap({ root: dirs.root, bytes: CAP_BYTES });
      try {
        makeSeatDirs(dirs);
        const base = solveIsolationPolicy({ repoRoot });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        const wall = walled(base, dirs);
        const own = join(basename(dirs.root), "tmp");
        // `/usr/bin/python3` and `/usr/bin/make` are xcrun shims, which start their tool with TMPDIR
        // reset to the user temporary directory: three days of campaigns left 1.56 million Python
        // temp folders there, outside every solve's cap and its command's end (2026-10-10).
        const made = await run(wall, "python3 -c 'import tempfile; print(tempfile.mkdtemp())'");
        expect(made.output).toContain(own);
        expect(existsSync(made.output.trim())).toBe(true);
        const recipe = await run(wall, String.raw`printf 'all:\n\t@echo $$TMPDIR\n' > Makefile && make`);
        expect(recipe.output).toContain(own);
        // A compiler started by its own path is given the SDK the shim named for it.
        const built = await run(
          wall,
          String.raw`printf '#include <stdio.h>\nint main(void){puts("built");return 0;}\n' > h.c && cc h.c -o h && ./h`,
        );
        expect(built.output).toBe("built\n");
      } finally {
        await release();
        rmSync(dirs.host, { recursive: true, force: true });
        rmSync(repoRoot, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
