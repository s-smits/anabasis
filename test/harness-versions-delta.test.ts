// What moved between kept harnesses, file by file and line by line, and the chain of every version
// against its parent, blind: over a campaign written here with the log's own `append`. The third
// version is a led session's checkpoint with no `harness.version`, so its parent is read from the
// session's earlier checkpoint (`madeOf`), and its tool tree holds a bytecode cache and an installed
// package that no file line may name.
import { afterAll, describe, expect, it } from "bun:test";
import { append } from "../src/kernel/log.ts";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import { openHarness } from "../src/harness/open.ts";
import { EXAMPLE, writeStarter } from "../src/harness/starter.ts";
import { diffOf } from "../tools/wri/trajectory.ts";
import { writeHarness } from "./helpers/write-harness.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-harness-delta-test-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const camp = join(root, "camp");
const log = join(camp, "log.jsonl");
const states = join(camp, "states");
mkdirSync(states, { recursive: true });
const script = join(import.meta.dir, "../.claude/skills/harness-audit/scripts/harness-versions.ts");

async function keep(write: (dir: string) => void): Promise<string> {
  const dir = join(root, "scratch");
  write(dir);
  const { digest } = await openHarness(dir);
  renameSync(dir, join(states, digest));
  return digest;
}

const starter = await keep(writeStarter);
const child = await keep((dir) =>
  writeHarness(dir, { ...EXAMPLE, guide: "Use the checker.\nRead the task.\n" }),
);
const grand = await keep((dir) => {
  writeHarness(dir, {
    ...EXAMPLE,
    guide: "Use the checker.\nRead the task twice.\n",
    programs: { ...EXAMPLE.programs, "plan-shifts": "#!/bin/sh\necho planned\n" },
  });
  mkdirSync(join(dir, ".toolchain", "bin", "__pycache__"), { recursive: true });
  writeFileSync(join(dir, ".toolchain", "bin", "__pycache__", "cache.pyc"), "bytes");
  mkdirSync(join(dir, ".toolchain", "lib", "python", "site-packages", "pkg"), { recursive: true });
  writeFileSync(join(dir, ".toolchain", "lib", "python", "site-packages", "pkg", "mod.py"), "x = 1\n");
});

append(log, "build.started", { session: "b-1", parent: starter });
for (const turn of [1, 2, 3]) append(log, "build.turn", { session: "b-1", turn, text: "" });
append(log, "build.checkpoint", { session: "b-1", harness: child });
for (const turn of [4, 5]) append(log, "build.turn", { session: "b-1", turn, text: "" });
append(log, "build.checkpoint", { session: "b-1", harness: grand });
append(log, "comparison.started", { session: "g-1", old: starter, fresh: grand, starter, solves: 2 });
append(log, "comparison.reported", {
  session: "g-1",
  old: starter,
  fresh: grand,
  reading: "step",
  scored: { wins: 6, losses: 0, ties: 1 },
});
append(log, "harness.promoted", { harness: grand, from: starter, rests: ["g-1"] });

const run = (...args: string[]) => {
  const result = runSync([capturedExecPath, script, log, ...args]);
  return { code: result.exitCode, stdout: decodeOutput(result.stdout), stderr: decodeOutput(result.stderr) };
};
const short = (digest: string) => digest.slice(0, 8);

describe("what moved between kept harnesses", () => {
  it("walks the chain blind: no reading, tally, comparison or promotion", () => {
    for (const depth of [[], ["--lines"]]) {
      const { code, stdout } = run("--chain", ...depth);
      expect(code).toBe(0);
      expect(stdout).toContain(`${short(grand)}  made: checkpoint of session b-1 from ${short(child)}`);
      expect(stdout).toContain(`${short(child)}  made: checkpoint of session b-1 from ${short(starter)}`);
      for (const result of ["step", "g-1", "won", "wins", "tally", "6 to 0", "promoted", "reference"]) {
        expect(stdout.replaceAll(/[0-9a-f]{8}/g, "")).not.toContain(result);
      }
    }
  });
});

describe("what an installer wrote, beside what the harness wrote", () => {
  const state = join(root, "installed");
  const tree = join(state, ".toolchain");
  const put = (path: string, text: string) => {
    mkdirSync(join(tree, path, ".."), { recursive: true });
    writeFileSync(join(tree, path), text);
  };
  put(
    "pylib/numpy-2.0.dist-info/RECORD",
    "numpy/__init__.py,sha256=a,1\nnumpy/core.py,,\nsix.py,,\n../bin/f2py,,\n",
  );
  for (const path of ["pylib/numpy/__init__.py", "pylib/numpy/core.py", "pylib/six.py", "bin/f2py"]) {
    put(path, "installed\n");
  }
  put("pylib/scipy-1.0.dist-info/top_level.txt", "scipy\n");
  put("pylib/scipy/fit.py", "installed\n");
  put("pylib/scipy.libs/libz.so", "installed\n");
  put("pylib/statkit.py", "def own(): pass\n");
  put("bin/check-answer", "#!/bin/sh\necho checked\n");
  put("bin/open-task", "#!/bin/sh\necho opened\n");
  symlinkSync("check-answer", join(tree, "bin", "pack-answer"));
  symlinkSync("/etc/hosts", join(tree, "bin", "outside"));

  it("diffs a link as the name it points to, never its target's text", () => {
    const moved = join(root, "relinked");
    cpSync(state, moved, { recursive: true, verbatimSymlinks: true });
    rmSync(join(moved, ".toolchain", "bin", "pack-answer"));
    symlinkSync("open-task", join(moved, ".toolchain", "bin", "pack-answer"));
    const lines = diffOf(state, moved);
    expect(lines).toEqual([
      "--- parent/bin/pack-answer",
      "+++ version/bin/pack-answer",
      "--> check-answer",
      "+-> open-task",
    ]);
  });
});
