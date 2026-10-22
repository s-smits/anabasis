// A solve's commands, executed under the real command wall in a claimed root: the home survives
// between commands, the folder a command that brings files starts in does not, staged input
// reaches it, neither the host-only folder, the repository, its other worktrees, a stored pack nor
// a reviewer's Claude home can be read, the host's folder in the seat cannot be written, and no
// command outlives the shell limits.
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
} from "../src/tools/command.ts";
import { claimRoot } from "../src/wall/seat-root.ts";
import { toolchainTemp } from "./helpers/toolchain-temp.ts";
import { solveIsolationPolicy } from "../src/wall/base.ts";
import { hostScratch } from "../src/wall/policy.ts";
import { commandSearchPath } from "../src/wall/isolation.ts";
import { osIsolationSupport } from "../src/wall/os-isolation.ts";
import { CLOSED } from "./helpers/wall.ts";

/** A wall over a claimed seat, with no tool tree and 30 seconds a command. */
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
    // A named timeout, floored and at least a second, only raises the default, up to the maximum.
    const named: [number | undefined, number, number][] = [
      [undefined, 300, 300],
      [120, 120, 300],
      [0, 1, 300],
      [-5, 1, 300],
      [450.9, 450, 450],
      [900, 900, 900],
      [880, 880, 880],
      [5000, 5000, 900],
    ];
    for (const [timeout, asked, seconds] of named) {
      expect(heldSeconds(timeout, { limits })).toEqual({ asked, seconds, nearEnd: false });
    }
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
    // With less than a whole second before the reserve, or inside it, the limits stand: the wall cuts.
    expect(heldSeconds(undefined, ...at(480, 419.5))).toEqual({ asked: 300, seconds: 300, nearEnd: false });
    expect(heldSeconds(undefined, ...at(480, 420))).toEqual({ asked: 300, seconds: 300, nearEnd: false });
    expect(heldSeconds(900, ...at(480, 421))).toEqual({ asked: 900, seconds: 900, nearEnd: false });
    expect(heldSeconds(undefined, ...at(480, 470))).toEqual({ asked: 300, seconds: 300, nearEnd: false });
  });
});

/** A shell loop that counts into `$HOME/<name>` twenty times a second, for as long as it runs. */
const beating = (name: string) =>
  `sh -c 'i=0; while :; do i=$((i+1)); echo $i > "$HOME/${name}"; sleep 0.05; done'`;

/** Whether the loop `beating` started still runs, read from the host: its count moves. A pid is no
 *  witness here, since Bubblewrap numbers a command's processes in a namespace of their own, and the
 *  pid a command prints names another process on the host or none (18 October). */
async function stillBeats(beat: string): Promise<boolean> {
  const count = () => (existsSync(beat) ? readFileSync(beat, "utf8") : "");
  await Bun.sleep(100);
  const before = count();
  await Bun.sleep(400);
  return count() !== before;
}

describe("a solve's walled commands", () => {
  it.skipIf(!osIsolationSupport().ok)(
    "keep the home, drop each command's folder, and read neither the host folder, the repository nor a reader's home",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-repo-")));
      writeFileSync(join(repoRoot, "secret"), "repo-canary");
      // Where a reader or the Examiner keeps its Claude Code session, as `readOnce` makes it.
      const reader = realpathSync.native(hostScratch("claude-cli-reader-"));
      writeFileSync(join(reader, "session"), "reader-canary");
      const dirs = solveDirs(`test-${String(runtimeProcess.pid)}-${String(Date.now())}`);
      const release = claimRoot(dirs.root);
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
        expect(read.output).toContain(CLOSED);

        // A command that backgrounds work and returns has left nothing running. The shell around the
        // wall leads the command's group, not the shell that reaps it: read by its own pid, the group
        // was empty and a solver's loop ran on for over 20 minutes after its command (2026-10-09).
        const left = await run(wall, `nohup ${beating("left")} >/dev/null 2>&1 &`);
        expect(left.exitCode).toBe(0);
        expect(await stillBeats(join(dirs.home, "left"))).toBe(false);
        // The leader was spared: the command's exit code reported after the reaping.
        // A job in a process group of its own is out of that trap's reach once the shell that started
        // it has gone, and GNU `timeout` makes one: a solver's three searches under it ran on after
        // their command returned (2026-10-09). It still works in the solve's root.
        await run(wall, `set -m; ${beating("apart")} >/dev/null 2>&1 &`);
        expect(await stillBeats(join(dirs.home, "apart"))).toBe(false);
        // Work that leaves the root is out of reach of what ends the root's holders, so the command's
        // group and every descendant of it are ended by pid: a job left in the group, and one in a
        // group of its own under a parent that waits in it.
        await run(wall, `cd / && nohup ${beating("away")} >/dev/null 2>&1 &`);
        expect(await stillBeats(join(dirs.home, "away"))).toBe(false);
        await run(wall, `cd / && (set -m; ${beating("below")} >/dev/null 2>&1 & wait) >/dev/null 2>&1 &`);
        expect(await stillBeats(join(dirs.home, "below"))).toBe(false);

        // Every command is held to the condition's shell limits here, whoever launched it: one that
        // names no timeout runs for the default, and one that names too long a timeout for the maximum.
        await expect(run(wall, "sleep 5")).rejects.toThrow("timeout:1");
        await expect(run(wall, "sleep 5", undefined, 60)).rejects.toThrow("timeout:2");
        // A command the wall cuts is killed by its group and never runs its trap, so a child in a
        // group of its own outlived that too: five of the nine commands one run's wall cut sat under
        // an inner `timeout` (2026-10-09).
        await expect(run(wall, `set -m; ${beating("cut")} & wait`)).rejects.toThrow("timeout:1");
        expect(await stillBeats(join(dirs.home, "cut"))).toBe(false);
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
    const release = claimRoot(dirs.root);
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

  it("refuse a command a signal to a process outside its wall, and let it signal its own", async () => {
    // Under Seatbelt's `(allow default)` a command could `kill` any process of the operator's, the
    // campaign that runs it among them (probe, 20 October); Linux gives it a pid namespace.
    const outside = Bun.spawn(["sleep", "60"], { stdout: "ignore", stderr: "ignore" });
    const dirs = solveDirs(`signal-${String(runtimeProcess.pid)}-${String(Date.now())}`);
    const release = claimRoot(dirs.root);
    try {
      makeSeatDirs(dirs);
      const base = solveIsolationPolicy({ repoRoot: toolchainTemp("ana-command-signal-repo") });
      if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
      const sent = await run(
        walled(base, dirs),
        [
          `kill -0 ${String(outside.pid)} 2>/dev/null && echo outside-reached || echo outside-refused`,
          "sleep 5 & kill $! && echo own-signalled",
        ].join("; "),
      );
      expect(sent.output).toBe("outside-refused\nown-signalled\n");
      expect(outside.exitCode).toBeNull();
    } finally {
      outside.kill();
      await release();
      rmSync(dirs.host, { recursive: true, force: true });
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
    const release = claimRoot(dirs.root);
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
    "give a seat a temporary directory of its own under its root, and each command a /tmp that shows nothing another left in the host's",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-private-tmp-")));
      const dirs = solveDirs(`tmp-${String(runtimeProcess.pid)}-${String(Date.now())}`);
      const release = claimRoot(dirs.root);
      // A canary another solve, a verification cell or the host itself might have left in /tmp.
      const canary = join("/tmp", `ana-h1-canary-${String(runtimeProcess.pid)}`);
      writeFileSync(canary, "left by the host");
      try {
        makeSeatDirs(dirs);
        const base = solveIsolationPolicy({ repoRoot });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        const wall = walled(base, dirs);
        // The seat's TMPDIR is its own folder in its root, removed with it, and the host's
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
      const release = claimRoot(dirs.root);
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

  it.skipIf(!osIsolationSupport().ok)(
    "keep what Python and make write as temporary in the seat's own folder, in its root",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-temp-")));
      const dirs = solveDirs(`temp-${String(runtimeProcess.pid)}-${String(Date.now())}`);
      const release = claimRoot(dirs.root);
      try {
        makeSeatDirs(dirs);
        const base = solveIsolationPolicy({ repoRoot });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        const wall = walled(base, dirs);
        const own = join(basename(dirs.root), "tmp");
        // `/usr/bin/python3` and `/usr/bin/make` are xcrun shims, which start their tool with TMPDIR
        // reset to the user temporary directory: three days of campaigns left 1.56 million Python
        // temp folders there, outside every solve's root and its command's end (2026-10-10).
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

  it.skipIf(!osIsolationSupport().ok)(
    "give the seat's TMPDIR to every Bun a command starts, by script, by -e, from a shell and from another Bun, and let each write there",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-bun-temp-")));
      const dirs = solveDirs(`bun-temp-${String(runtimeProcess.pid)}-${String(Date.now())}`);
      const release = claimRoot(dirs.root);
      try {
        makeSeatDirs(dirs);
        const base = solveIsolationPolicy({ repoRoot });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        const wall = walled(base, dirs);
        const own = join(basename(dirs.root), "tmp");
        // A lead from the truss campaign's whole-run reading (12 October): a Bun child of a solver's
        // command might not see the seat's TMPDIR, fall back to a temporary folder the wall closes,
        // and end a solve on the environment's fault. Each Bun below says what TMPDIR and
        // `os.tmpdir()` name and makes a folder there as a tool would. On a macOS runner whose
        // `/opt/homebrew/bin` held Bun 1.1.34 the command's `bun` was that one until 19 October, and
        // started in the seat it read no environment: `/tmp`, refused, and no `bun` on its PATH.
        const probe = String.raw`const os = require("os"); const fs = require("fs"); const path = require("path");
const made = fs.mkdtempSync(path.join(os.tmpdir(), "p-")); fs.writeFileSync(path.join(made, "f"), "x");
console.log(JSON.stringify({ probe: process.argv.at(-1), said: process.env.TMPDIR, taken: os.tmpdir(), made }));`;
        // One JSON value a row, so a path with a space in it reads whole; any other line is an error.
        const probed = (output: string) =>
          output
            .split("\n")
            .filter((row) => row.startsWith('{"probe":'))
            .map(
              (row) =>
                /* SAFETY: the filter keeps only the rows the probe printed, each one object of four strings. */ JSON.parse(
                  row,
                ) as { probe: string; said: string; taken: string; made: string },
            );
        const written = await run(
          wall,
          [
            `cat > probe.js <<'EOF'\n${probe}\nEOF`,
            "bun probe.js script",
            `bun -e "$(cat probe.js)" eval`,
            "sh -c 'bun probe.js shell'",
            `bun -e 'console.log(Bun.spawnSync(["bun", "probe.js", "spawned"]).stdout.toString().trim()); console.log(require("child_process").execFileSync("bun", ["probe.js", "exec"]).toString().trim())'`,
          ].join("\n"),
        );
        const rows = probed(written.output);
        expect(rows.map((row) => row.probe)).toEqual(["script", "eval", "shell", "spawned", "exec"]);
        for (const { said, taken, made } of rows) {
          expect(said).toContain(own);
          expect(taken).toContain(own);
          expect(made).toContain(own);
          expect(readFileSync(join(made, "f"), "utf8")).toBe("x");
        }
        // The `bun` a command names is the executable the host runs on.
        const named = (await run(wall, "command -v bun")).output.trim();
        expect(realpathSync.native(named)).toBe(realpathSync.native(runtimeProcess.execPath));
      } finally {
        await release();
        rmSync(dirs.host, { recursive: true, force: true });
        rmSync(repoRoot, { recursive: true, force: true });
      }
    },
    60_000,
  );
});

describe("the search path a walled command is given", () => {
  it("names the executable the host runs on before any other bun the host's fixed list holds", () => {
    // Until 19 October the runtime's folder came from the read grants, which leave out a prefix
    // under /usr or /opt, so a host Bun there lost to an older one earlier on the fixed list.
    const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-search-")));
    try {
      const stub = (folder: string) => {
        mkdirSync(join(scratch, folder), { recursive: true });
        writeFileSync(join(scratch, folder, "bun"), "#!/bin/sh\necho stub\n", { mode: 0o755 });
        return join(scratch, folder, "bun");
      };
      const older = dirname(stub("older"));
      const runtime = stub("runtime");
      const PATH = commandSearchPath(null, runtime, [older, "/usr/bin", "/bin"]);
      expect(realpathSync.native(Bun.which("bun", { PATH }) ?? "")).toBe(runtime);
      // A tool tree's own bun still goes first.
      const treeBun = stub("tree/bin");
      expect(Bun.which("bun", { PATH: commandSearchPath(join(scratch, "tree"), runtime, [older]) })).toBe(
        treeBun,
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
