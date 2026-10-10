// A solve's commands, executed under the real command wall on a mounted cap: the home survives
// between commands, each command's own folder does not, staged input reaches it, neither the
// host-only folder, the repository nor a reviewer's Claude home can be read, and no command outlives
// the shell limits. And a command's own folders: fresh for each, and done without on a full volume,
// where the command that starts is the one that can empty it.
import { describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { basename, join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import {
  commandDirs,
  type CommandWall,
  heldSeconds,
  reserveSeconds,
  runWalled,
  solveDirs,
} from "../src/solve/command.ts";
import { mountDiskCap } from "../src/verify/disk-cap.ts";
import { solveIsolationPolicy } from "../src/verify/solve-sandbox.ts";

const CAP_BYTES = 16 * 1024 * 1024;

async function run(wall: CommandWall, command: string, stage?: (work: string) => void, timeout?: number) {
  let output = "";
  const onData = (data: Buffer) => {
    output += data.toString("utf8");
  };
  const result = await runWalled(wall, command, {
    onData,
    timeout,
    stage: ({ work }) => stage?.(work),
  });
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
    // Inside the reserve, or with under five seconds before it, the limits stand: the wall cuts.
    expect(heldSeconds(undefined, ...at(480, 417))).toEqual({ asked: 300, seconds: 300, nearEnd: false });
    expect(heldSeconds(undefined, ...at(480, 470))).toEqual({ asked: 300, seconds: 300, nearEnd: false });
    expect(heldSeconds(undefined, ...at(3, 0))).toEqual({ asked: 300, seconds: 300, nearEnd: false });
  });
});

describe("a command's own folders", () => {
  const full = () => {
    throw Object.assign(new Error("ENOSPC: no space left on device, mkdtemp"), { code: "ENOSPC" });
  };

  it("are made fresh under the solve's runs, and are the home where the volume has no room for them", () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-dirs-")));
    const dirs = { root, home: join(root, "home"), runs: join(root, "runs"), host: join(root, "host") };
    try {
      mkdirSync(dirs.runs);
      const made = commandDirs(dirs, "nothing");
      expect(made.run).toStartWith(join(dirs.runs, "run-"));
      expect([made.work, made.temp]).toEqual([join(made.run ?? "", "work"), join(made.run ?? "", "tmp")]);
      expect(existsSync(made.work) && existsSync(made.temp)).toBe(true);
      expect(commandDirs(dirs, "nothing").run).not.toBe(made.run);
      // No room for the folders: a command that brings no files starts in the home without them.
      expect(commandDirs(dirs, "nothing", full)).toEqual({ run: null, work: dirs.home, temp: dirs.home });
      // One whose files have nowhere to go does not start, and says why.
      expect(() => commandDirs(dirs, "files", full)).toThrow("ENOSPC");
      // Room for the first folder and not for the two inside it: nothing half-made is left behind.
      const half = join(dirs.runs, "run-half");
      const first = () => {
        mkdirSync(join(half, "work", "tmp"), { recursive: true });
        return half;
      };
      expect(() => commandDirs(dirs, "nothing", first)).toThrow("EEXIST");
      expect(existsSync(half)).toBe(false);
      // Any other failure is the solve's own, not a full volume's.
      rmSync(dirs.runs, { recursive: true });
      expect(() => commandDirs(dirs, "nothing")).toThrow("ENOENT");
      expect(readdirSync(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
        for (const dir of [dirs.home, dirs.runs, dirs.host]) mkdirSync(dir, { recursive: true });
        const base = solveIsolationPolicy({ repoRoot, cap: { root: dirs.root, bytes: CAP_BYTES } });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        const wall: CommandWall = {
          base,
          dirs,
          toolTree: null,
          limits: { shellDefaultSeconds: 30, shellMaxSeconds: 30 },
          cpu: { seconds: 0, unmeasured: 0 },
        };
        const inHome = async (command: string) => {
          let output = "";
          const onData = (data: Buffer) => {
            output += data.toString("utf8");
          };
          await runWalled(wall, command, { onData, inHome: true });
          return output;
        };
        // Four times the cap, so the volume is full whatever the filesystem keeps back.
        const filled = await inHome("dd if=/dev/zero of=fill bs=1048576 count=64 2>&1; echo dd:$?");
        expect(filled).not.toContain("dd:0");
        // On 2026-10-09 a solve in this state was refused `rm -rf ~/w` fourteen times running.
        expect(await inHome("rm -f fill && echo freed")).toContain("freed");
        expect(await inHome("echo again > note && cat note")).toBe("again\n");
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
      // Where a reader or the Examiner keeps its Claude Code session, as `readOnce` names it.
      const reader = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-claude-cli-reader-")));
      writeFileSync(join(reader, "session"), "reader-canary");
      const dirs = solveDirs(`test-${String(runtimeProcess.pid)}-${String(Date.now())}`);
      const release = await mountDiskCap({ root: dirs.root, bytes: CAP_BYTES });
      try {
        for (const dir of [dirs.home, dirs.runs, dirs.host]) mkdirSync(dir, { recursive: true });
        writeFileSync(join(dirs.host, "config"), "host-canary");
        const base = solveIsolationPolicy({ repoRoot, cap: { root: dirs.root, bytes: CAP_BYTES } });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        const wall: CommandWall = {
          base,
          dirs,
          toolTree: null,
          limits: { shellDefaultSeconds: 1, shellMaxSeconds: 2 },
          cpu: { seconds: 0, unmeasured: 0 },
        };

        const first = await run(wall, 'echo kept > "$HOME/note" && pwd && cat staged', (work) =>
          writeFileSync(join(work, "staged"), "staged-input"),
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
        // The leader was spared: it wrote the command's CPU record after the reaping.
        expect(wall.cpu.unmeasured).toBe(0);
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

  it.skipIf(runtimeProcess.platform !== "darwin")(
    "keep what Python and make write as temporary in the command's own folder, which goes with it",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-temp-")));
      const dirs = solveDirs(`temp-${String(runtimeProcess.pid)}-${String(Date.now())}`);
      const release = await mountDiskCap({ root: dirs.root, bytes: CAP_BYTES });
      try {
        for (const dir of [dirs.home, dirs.runs, dirs.host]) mkdirSync(dir, { recursive: true });
        const base = solveIsolationPolicy({ repoRoot, cap: { root: dirs.root, bytes: CAP_BYTES } });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        const wall: CommandWall = {
          base,
          dirs,
          toolTree: null,
          limits: { shellDefaultSeconds: 30, shellMaxSeconds: 30 },
          cpu: { seconds: 0, unmeasured: 0 },
        };
        const own = join(basename(dirs.root), "runs", "run-");
        // `/usr/bin/python3` and `/usr/bin/make` are xcrun shims, which start their tool with TMPDIR
        // reset to the user temporary directory: three days of campaigns left 1.56 million Python
        // temp folders there, outside every solve's cap and its command's end (2026-10-10).
        const made = await run(wall, "python3 -c 'import tempfile; print(tempfile.mkdtemp())'");
        expect(made.output).toContain(own);
        expect(existsSync(made.output.trim())).toBe(false);
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
