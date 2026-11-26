// A solve's commands under the real wall in a claimed root: the home persists, host-only trees stay
// unreadable, and no command outlives the shell limits.
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
  type CommandSandbox,
  makeSeatDirs,
  type NetworkReach,
  networkReach,
  runSandboxed,
  solveDirs,
  UNREACHED_MS,
} from "../src/tools/command.ts";
import { claimRoot, releaseRoot } from "../src/sandbox/sandbox-root.ts";
import { toolchainTemp } from "./helpers/toolchain-temp.ts";
import { solveIsolationPolicy } from "../src/sandbox/base.ts";
import { hostScratch } from "../src/sandbox/policy.ts";
import { osIsolationSupport } from "../src/sandbox/os-isolation.ts";
import { CLOSED } from "./helpers/wall.ts";

async function inSeat(
  repoRoot: string,
  use: (wall: CommandSandbox) => Promise<void>,
  options: { otherTrees?: string[]; limits?: CommandSandbox["limits"] } = {},
) {
  const dirs = solveDirs(`command-${crypto.randomUUID()}`);
  const release = await claimRoot(dirs.root);
  try {
    makeSeatDirs(dirs);
    const base = solveIsolationPolicy({ repoRoot, otherTrees: options.otherTrees ?? [] });
    if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
    await use({
      base,
      dirs,
      toolTree: null,
      limits: options.limits ?? { shellDefaultSeconds: 30, shellMaxSeconds: 30 },
    });
  } finally {
    await release();
  }
}

async function run(wall: CommandSandbox, command: string, stage?: (into: string) => void, timeout?: number) {
  let output = "";
  const onData = (data: Buffer) => {
    output += data.toString("utf8");
  };
  const result = await runSandboxed(wall, command, { onData, timeout, stage });
  return { exitCode: result.exitCode, output };
}

const beating = (name: string) =>
  `sh -c 'i=0; while :; do i=$((i+1)); echo $i > "$HOME/${name}"; sleep 0.05; done'`;

/** Whether the loop `beating` started still runs, read from the host by its count: Bubblewrap
 *  numbers a command's processes in a namespace of their own, so a printed pid is no evidence. */
async function stillBeats(beat: string): Promise<boolean> {
  const count = () => (existsSync(beat) ? readFileSync(beat, "utf8") : "");
  await Bun.sleep(100);
  const before = count();
  await Bun.sleep(400);
  return count() !== before;
}

describe.concurrent("a solve's walled commands", () => {
  it.skipIf(!osIsolationSupport().ok)(
    "keep the home, drop each command's folder, and read neither the host folder, the repository nor a reader's home",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-repo-")));
      writeFileSync(join(repoRoot, "secret"), "repo-canary");
      const reader = realpathSync.native(hostScratch("claude-cli-reader-"));
      writeFileSync(join(reader, "session"), "reader-canary");
      try {
        await inSeat(
          repoRoot,
          async (wall) => {
            const { dirs } = wall;
            writeFileSync(join(dirs.host, "config"), "host-canary");

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

            // The shell around the wall leads the command's group; read by its own pid, the group would
            // be empty and a solver's loop would outlive its command.
            for (const [name, command] of [
              ["left", `nohup ${beating("left")} >/dev/null 2>&1 &`],
              ["apart", `set -m; ${beating("apart")} >/dev/null 2>&1 &`],
              ["away", `cd / && nohup ${beating("away")} >/dev/null 2>&1 &`],
              ["below", `cd / && (set -m; ${beating("below")} >/dev/null 2>&1 & wait) >/dev/null 2>&1 &`],
            ] as const) {
              const left = await run(wall, command);
              expect(left.exitCode).toBe(0);
              expect(await stillBeats(join(dirs.home, name))).toBe(false);
            }

            await expect(run(wall, "sleep 5")).rejects.toThrow("timeout:1");
            await expect(run(wall, "sleep 5", undefined, 60)).rejects.toThrow("timeout:2");
            // A command the wall cuts is killed by its group, so a child in a group of its own, as
            // under an inner `timeout`, would outlive it too.
            await expect(run(wall, `set -m; ${beating("cut")} & wait`)).rejects.toThrow("timeout:1");
            expect(await stillBeats(join(dirs.home, "cut"))).toBe(false);
          },
          { limits: { shellDefaultSeconds: 1, shellMaxSeconds: 2 } },
        );
      } finally {
        rmSync(repoRoot, { recursive: true, force: true });
        await releaseRoot(reader);
      }
    },
    60_000,
  );

  // Two campaigns on one host: every wall closes the two parents seats lie in and opens the running
  // seat's root alone, so no name has to be guessed right.
  it.skipIf(!osIsolationSupport().ok)(
    "read, list and write nothing of another campaign's seat running beside them, nor a verifier's cell",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-two-")));
      const cell = hostScratch("cell-");
      writeFileSync(join(cell, "hidden.json"), "cell-canary");
      const tries = (theirs: CommandSandbox["dirs"]) =>
        [
          `cat ${JSON.stringify(join(theirs.home, "note"))} 2>/dev/null || echo home-refused`,
          `cat ${JSON.stringify(join(theirs.host, "config"))} 2>/dev/null || echo host-refused`,
          `ls ${JSON.stringify(dirname(theirs.root))} 2>/dev/null | grep -F ${JSON.stringify(basename(theirs.root))} || echo listing-refused`,
          `readlink ${JSON.stringify(`${theirs.root}.owner`)} 2>/dev/null || echo claim-refused`,
          `touch ${JSON.stringify(join(theirs.home, "planted"))} 2>/dev/null || echo write-refused`,
          `cat ${JSON.stringify(join(cell, "hidden.json"))} 2>/dev/null || echo cell-refused`,
          'cat "$HOME/note"',
        ].join("; ");
      const refused =
        "home-refused\nhost-refused\nlisting-refused\nclaim-refused\nwrite-refused\ncell-refused\n";
      try {
        await inSeat(repoRoot, async (first) => {
          await inSeat(repoRoot, async (second) => {
            for (const [wall, canary] of [
              [first, "first-canary"],
              [second, "second-canary"],
            ] as const) {
              writeFileSync(join(wall.dirs.home, "note"), `${canary}\n`);
              writeFileSync(join(wall.dirs.host, "config"), canary);
            }
            const [one, other] = await Promise.all([
              run(first, tries(second.dirs)),
              run(second, tries(first.dirs)),
            ]);
            expect(one.output).toBe(`${refused}first-canary\n`);
            expect(other.output).toBe(`${refused}second-canary\n`);
            expect(existsSync(join(first.dirs.home, "planted"))).toBe(false);
            expect(existsSync(join(second.dirs.home, "planted"))).toBe(false);
          });
        });
      } finally {
        await releaseRoot(cell);
        rmSync(repoRoot, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it("refuse a command the repository, its other worktree and the host's folder in the seat, and let it write and read its own", async () => {
    const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-reads-")));
    writeFileSync(join(repoRoot, "secret"), "repo-canary");
    const sibling = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-sibling-")));
    writeFileSync(join(sibling, "package.json"), '{ "name": "sibling-canary" }');
    try {
      await inSeat(
        repoRoot,
        async (wall) => {
          const { dirs } = wall;
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
        },
        { otherTrees: [sibling] },
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(sibling, { recursive: true, force: true });
    }
  }, 60_000);

  it("refuse a command a signal to a process outside its wall, and let it signal its own", async () => {
    // Under Seatbelt's `(allow default)` a command could `kill` any of the operator's processes; Linux
    // gives it a pid namespace.
    const repoRoot = toolchainTemp("ana-command-signal-repo");
    const outside = Bun.spawn(["sleep", "60"], { stdout: "ignore", stderr: "ignore" });
    try {
      await inSeat(repoRoot, async (wall) => {
        const sent = await run(
          wall,
          [
            `kill -0 ${String(outside.pid)} 2>/dev/null && echo outside-reached || echo outside-refused`,
            "sleep 5 & kill $! && echo own-signalled",
          ].join("; "),
        );
        expect(sent.output).toBe("outside-refused\nown-signalled\n");
        expect(outside.exitCode).toBeNull();
      });
    } finally {
      outside.kill();
      await outside.exited;
      rmSync(repoRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it("refuse a command a stored pack by the pack's path, which no folder's name stands in for", async () => {
    const repoRoot = toolchainTemp("ana-command-pack-repo");
    const pack = toolchainTemp("ana-command-pack");
    const bundle = join(pack, "fixture", "workspace");
    const hidden = join(bundle, "correctness-model", "expected.json");
    mkdirSync(dirname(hidden), { recursive: true });
    writeFileSync(hidden, "pack-canary\n");
    try {
      await inSeat(repoRoot, async (wall) => {
        const readUnder = async (packRoots: string[]) => {
          const base = solveIsolationPolicy({ repoRoot, packRoots });
          if ("unsupported" in base) {
            throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
          }
          return (await run({ ...wall, base }, `cat ${hidden} 2>/dev/null || echo pack-refused`)).output;
        };
        expect(await readUnder([pack, bundle])).toBe("pack-refused\n");
        // Left out of the policy, the file is read on Darwin in a folder named as `mktemp` names one,
        // which the wall grants a toolchain; Linux hides the whole temporary directory.
        if (runtimeProcess.platform === "darwin") expect(await readUnder([])).toBe("pack-canary\n");
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(pack, { recursive: true, force: true });
    }
  }, 60_000);

  it.skipIf(runtimeProcess.platform !== "linux")(
    "give a seat a temporary directory of its own under its root, and each command a /tmp that shows nothing another left in the host's",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-private-tmp-")));
      const canary = join("/tmp", `ana-h1-canary-${String(runtimeProcess.pid)}`);
      writeFileSync(canary, "left by the host");
      try {
        await inSeat(repoRoot, async (wall) => {
          const { dirs } = wall;
          const first = await run(
            wall,
            `echo "$TMPDIR"; ls /tmp; cat ${canary} 2>&1 || echo unseen; echo first > /tmp/left; echo second > "$TMPDIR/left"`,
          );
          expect(first.output).toContain(join(basename(dirs.root), "tmp"));
          expect(first.output).not.toContain("left by the host");
          expect(first.output).toContain("unseen");
          const second = await run(
            wall,
            'ls /tmp; cat /tmp/left 2>/dev/null || echo gone; cat "$TMPDIR/left"',
          );
          expect(second.output).toContain("gone");
          expect(second.output).toMatch(/^second$/m);
          expect(existsSync("/tmp/left")).toBe(false);
          expect(readFileSync(canary, "utf8")).toBe("left by the host");
        });
      } finally {
        rmSync(canary, { force: true });
        rmSync(repoRoot, { recursive: true, force: true });
      }
    },
    60_000,
  );

  // Linux hides the seats' parent under an empty tmpfs; Seatbelt closes it by rule
  // (`darwinCommandProfile`). Either closure alone passes this.
  it.skipIf(!osIsolationSupport().ok)(
    "keep a seat's temporary directory across its commands, and close it to every other seat",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-seat-tmp-")));
      try {
        await inSeat(repoRoot, async (own) => {
          await inSeat(repoRoot, async (other) => {
            const left = join(own.dirs.temp, "left");
            const planted = join(own.dirs.temp, "planted");
            const first = await run(own, 'echo "$TMPDIR"; echo own-canary > "$TMPDIR/left"');
            expect(first.output).toBe(`${own.dirs.temp}\n`);
            expect(own.dirs.temp.startsWith(`${own.dirs.root}/`)).toBe(true);
            expect((await run(own, 'cat "$TMPDIR/left"')).output).toBe("own-canary\n");
            // The other seat finds nothing of the first's by its path, and no name of it in the seats'
            // parent.
            const refused = await run(
              other,
              [
                'echo "$TMPDIR"',
                `cat ${left} 2>/dev/null || echo unread`,
                `ls ${own.dirs.temp} >/dev/null 2>&1 && echo listed || echo unlisted`,
                `test -e ${left} && echo seen || echo unseen`,
                `{ echo x > ${planted}; } 2>/dev/null || echo unwritten`,
                `mkdir ${join(own.dirs.temp, "made")} 2>/dev/null || echo unmade`,
                `rm ${left} 2>/dev/null || echo unremoved`,
                `ls ${dirname(own.dirs.root)} 2>/dev/null`,
              ].join("; "),
            );
            const [said, ...rest] = refused.output.split("\n");
            expect(said).toBe(other.dirs.temp);
            expect(rest.slice(0, 6)).toEqual([
              "unread",
              "unlisted",
              "unseen",
              "unwritten",
              "unmade",
              "unremoved",
            ]);
            expect(refused.output).not.toContain(basename(own.dirs.root));
            expect(existsSync(planted)).toBe(false);
            expect(readFileSync(left, "utf8")).toBe("own-canary\n");
          });
        });
      } finally {
        rmSync(repoRoot, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it.skipIf(runtimeProcess.platform !== "darwin")(
    "close the host's /tmp and /var/tmp to a command: what another seat left there is neither read nor run, and a command leaves nothing there",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-closed-tmp-")));
      // What another campaign's Builder might leave in /tmp: a file, and a program a later solve of
      // a third campaign could run.
      const canary = join("/tmp", `ana-h1-canary-${String(runtimeProcess.pid)}`);
      const program = join("/tmp", `ana-h1-program-${String(runtimeProcess.pid)}`);
      const left = join("/tmp", `ana-h1-left-${String(runtimeProcess.pid)}`);
      const kept = join("/private/var/tmp", `ana-h1-canary-${String(runtimeProcess.pid)}`);
      writeFileSync(canary, "left by the host");
      writeFileSync(program, "#!/bin/sh\necho ran\n", { mode: 0o755 });
      writeFileSync(kept, "left in var tmp");
      try {
        await inSeat(repoRoot, async (wall) => {
          const { dirs } = wall;
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
          for (const word of ["unseen", "unrun", "unwritten", "unmade"]) {
            expect(closed.output).toContain(word);
          }
          expect(existsSync(left)).toBe(false);
          expect(existsSync(`${left}.d`)).toBe(false);
          const followed = await run(
            wall,
            "cat <<'EOF'\nheredoc\nEOF\nmktemp -d\npython3 -c 'import tempfile; print(tempfile.mkdtemp())'",
          );
          const [said, made, python] = followed.output.trim().split("\n");
          expect(said).toBe("heredoc");
          expect(made).toMatch(/^\/(?!tmp\/|private\/tmp\/)/);
          expect(python).toContain(join(basename(dirs.root), "tmp"));
        });
      } finally {
        rmSync(canary, { force: true });
        rmSync(program, { force: true });
        rmSync(kept, { force: true });
        rmSync(repoRoot, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it.skipIf(!osIsolationSupport().ok)(
    "keeps Python, make and every Bun launch in the seat's own temporary directory",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-temp-")));
      try {
        await inSeat(repoRoot, async (wall) => {
          const { dirs } = wall;
          const own = join(basename(dirs.root), "tmp");
          // `/usr/bin/python3` and `/usr/bin/make` are xcrun shims that reset TMPDIR to the user
          // temporary directory, outside every solve's root.
          const pythonTemp = await run(wall, "python3 -c 'import tempfile; print(tempfile.mkdtemp())'");
          expect(pythonTemp.output).toContain(own);
          expect(existsSync(pythonTemp.output.trim())).toBe(true);
          const recipe = await run(wall, String.raw`printf 'all:\n\t@echo $$TMPDIR\n' > Makefile && make`);
          expect(recipe.output).toContain(own);
          const built = await run(
            wall,
            String.raw`printf '#include <stdio.h>\nint main(void){puts("built");return 0;}\n' > h.c && cc h.c -o h && ./h`,
          );
          expect(built.output).toBe("built\n");
          // A Bun child might fall back from the seat's TMPDIR to a folder the wall closes; the
          // command's `bun` is the host's own, which reads the environment.
          const probe = String.raw`const os = require("os"); const fs = require("fs"); const path = require("path");
const made = fs.mkdtempSync(path.join(os.tmpdir(), "p-")); fs.writeFileSync(path.join(made, "f"), "x");
console.log(JSON.stringify({ probe: process.argv.at(-1), said: process.env.TMPDIR, taken: os.tmpdir(), made }));`;
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
          const rows = written.output
            .split("\n")
            .filter((row) => row.startsWith('{"probe":'))
            .map(
              (row) =>
                /* SAFETY: the filter keeps only the rows the probe printed, each one object of four strings. */ JSON.parse(
                  row,
                ) as { probe: string; said: string; taken: string; made: string },
            );
          expect(rows.map((row) => row.probe)).toEqual(["script", "eval", "shell", "spawned", "exec"]);
          for (const { said, taken, made } of rows) {
            expect(said).toContain(own);
            expect(taken).toContain(own);
            expect(made).toContain(own);
            expect(readFileSync(join(made, "f"), "utf8")).toBe("x");
          }
          const named = (await run(wall, "command -v bun")).output.trim();
          expect(realpathSync.native(named)).toBe(realpathSync.native(runtimeProcess.execPath));
        });
      } finally {
        rmSync(repoRoot, { recursive: true, force: true });
      }
    },
    60_000,
  );
});

describe.concurrent("a wall's network reach", () => {
  it.skipIf(!osIsolationSupport().ok)(
    "probes again once an unreached reading is ten minutes old, and keeps a reached one",
    async () => {
      // One unreached probe does not stand for the process's life: a provider's blip at an opening
      // would tell a 24-hour session it had no network.
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-reach-")));
      try {
        await inSeat(repoRoot, async (wall) => {
          const readings: NetworkReach[] = ["unreached", "uv", "unreached"];
          let probes = 0;
          const probe = async (): Promise<NetworkReach> => readings[probes++] ?? "unreached";
          const at = (now: number) => networkReach(wall, { now, probe });
          expect(await at(0)).toBe("unreached");
          expect(await at(UNREACHED_MS - 1)).toBe("unreached");
          expect(probes).toBe(1);
          expect(await at(UNREACHED_MS)).toBe("uv");
          expect(await at(10 * UNREACHED_MS)).toBe("uv");
          expect(probes).toBe(2);
        });
      } finally {
        rmSync(repoRoot, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!osIsolationSupport().ok)(
    "starts one probe for callers that find the same unreached reading stale at once",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-reach-")));
      try {
        await inSeat(repoRoot, async (wall) => {
          let probes = 0;
          const probe = async (): Promise<NetworkReach> => (probes++ === 0 ? "unreached" : "pip");
          expect(await networkReach(wall, { now: 0, probe })).toBe("unreached");
          const batch = await Promise.all(
            [1, 2, 3, 4].map(() => networkReach(wall, { now: UNREACHED_MS, probe })),
          );
          expect(batch).toEqual(["pip", "pip", "pip", "pip"]);
          expect(probes).toBe(2);
        });
      } finally {
        rmSync(repoRoot, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!osIsolationSupport().ok)(
    "pins one network reach reading across a named comparison even past UNREACHED_MS, while a later comparison probes fresh",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-command-comp-reach-")));
      try {
        await inSeat(repoRoot, async (wall) => {
          let probes = 0;
          const probe = async (): Promise<NetworkReach> => (probes++ === 0 ? "unreached" : "uv");
          expect(await networkReach(wall, { now: 0, probe, comparison: "g-1" })).toBe("unreached");
          expect(await networkReach(wall, { now: UNREACHED_MS + 1, probe, comparison: "g-1" })).toBe(
            "unreached",
          );
          expect(probes).toBe(1);
          expect(await networkReach(wall, { now: UNREACHED_MS + 1, probe, comparison: "g-2" })).toBe("uv");
          expect(probes).toBe(2);
        });
      } finally {
        rmSync(repoRoot, { recursive: true, force: true });
      }
    },
  );
});
