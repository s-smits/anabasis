// A look's readers, by moment: what a reader says of the event it answers and when, what a look says
// it has not read, what a pass runs and costs a host, what a kill leaves, and that no seat can read
// what they wrote.
import { afterAll, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { hostname, tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { capturedExecPath, capturedSpawn } from "../src/meta/process.ts";
import { type CommandWall, solveDirs, walledBase } from "../src/tools/command.ts";
import { walledEnv } from "../src/tools/env.ts";
import { osIsolationSupport } from "../src/wall/os-isolation.ts";
import { claimRoot } from "../src/wall/seat-root.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { pruneObservers, underLock } from "../tools/runs/pulse-readers.ts";

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

function scratch(): string {
  const folder = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-pulse-readers-")));
  folders.push(folder);
  return folder;
}

describe("what a pass costs a host", () => {
  it("lets one pass hold a host however long it reads, and frees the lock of one that died", async () => {
    const store = join(scratch(), "store");
    const inner = await underLock(store, async () => await underLock(store, async () => "second"));
    expect(inner).toBeNull();
    expect(await underLock(store, async () => "after")).toBe("after");
    const gone = capturedSpawn(["true"]);
    await gone.exited;
    symlinkSync(`${String(gone.pid)} ${hostname()} Thu Jan  1 00:00:00 1970`, join(store, "pass.lock"));
    expect(await underLock(store, async () => "taken")).toBe("taken");
  });

  it("keeps the state whole while several looks remember it at once", async () => {
    const state = join(scratch(), "runs-pulse.json");
    const pulse = JSON.stringify(join(import.meta.dir, "..", "tools", "runs", "pulse-readers.ts"));
    const writers = Array.from({ length: 4 }, (_, one) =>
      capturedSpawn(
        [
          capturedExecPath,
          "-e",
          `import { remember } from ${pulse}; const text = JSON.stringify({ writer: ${String(one)}, pad: "x".repeat(200_000) }); for (let i = 0; i < 100; i++) remember(${JSON.stringify(state)}, text);`,
        ],
        { stdout: "ignore", stderr: "ignore" },
      ),
    );
    expect(await Promise.all(writers.map(async (one) => await one.exited))).toEqual([0, 0, 0, 0]);
    expect(parseJsonAs<{ pad: string }>(readFileSync(state, "utf8")).pad).toHaveLength(200_000);
  }, 60_000);

  it("drops a gone observer's files, and the half-written ones of a dead writer at any age", async () => {
    const folder = scratch();
    const dead = capturedSpawn(["true"]);
    await dead.exited;
    const live = String(process.pid);
    const cut = [`gone.json.pending.${String(dead.pid)}.tmp`, `gone.json.${String(dead.pid)}.tmp`];
    for (const file of ["gone.json", ...cut, `slow.json.${live}.tmp`, "notes.txt"]) {
      writeFileSync(join(folder, file), "{}");
    }
    pruneObservers(join(folder, "observer.json"));
    expect(readdirSync(folder).toSorted()).toEqual(["gone.json", "notes.txt", `slow.json.${live}.tmp`]);
    pruneObservers(join(folder, "observer.json"), Date.now() + 8 * 24 * 60 * 60_000);
    expect(readdirSync(folder).toSorted()).toEqual(["notes.txt", `slow.json.${live}.tmp`]);
  });
});

describe.skipIf(!osIsolationSupport().ok)("what a look wrote, through a seat's wall", () => {
  const SECRET = "reader-output-must-stay-hidden";
  const context = BACKGROUND_CONTEXT;

  /** Whether a seat can read `path`, in a shell and by its file tools. */
  async function readable(env: ExecutionEnv, path: string): Promise<boolean> {
    let output = "";
    const shell = await env.exec(
      ["cat", path],
      {
        onOutput: (text) => {
          output += text;
        },
      },
      context,
    );
    const file = await env.readTextFile(path, context);
    return (shell.ok && shell.value.exitCode === 0) || output.includes(SECRET) || file.ok;
  }

  it("closes the store and an observer's files, under the main tree and the host's temporary folder", async () => {
    const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-pulse-wall-")));
    const elsewhere = join(realpathSync.native(tmpdir()), `claude-anti-stall-${crypto.randomUUID()}`);
    folders.push(repoRoot, elsewhere);
    const files = [
      join(repoRoot, ".ana", "pulse", "moments", "0123456789abcdef", "rows.txt"),
      join(repoRoot, ".ana", "pulse", "observer.json"),
      join(repoRoot, ".ana", "pulse", "observer.json.pending"),
      join(repoRoot, ".ana", "pulse", "observer.json.d", "the-run", "rows.txt"),
      join(elsewhere, "session.pulse.json"),
      join(elsewhere, "session.pulse.json.d", "the-run", "rows.txt"),
    ];
    for (const file of files) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, SECRET);
    }
    const dirs = solveDirs(`pulse-wall-${crypto.randomUUID()}`);
    const release = await claimRoot(dirs.root);
    let env: ExecutionEnv | undefined;
    try {
      const base = await walledBase(dirs, { repoRoot }, "the pulse's wall test");
      const wall: CommandWall = {
        base,
        dirs,
        toolTree: null,
        limits: { shellDefaultSeconds: 1, shellMaxSeconds: 2 },
      };
      env = walledEnv(wall);
      for (const file of files) expect(await readable(env, file)).toBe(false);
      // The nearest hostile case: the wall's own check of a path it leaves open.
      const open = join(wall.dirs.home, "own.txt");
      writeFileSync(open, SECRET);
      expect(await readable(env, open)).toBe(true);
    } finally {
      await env?.cleanup(context);
      await release();
      rmSync(dirs.host, { recursive: true, force: true });
    }
    expect(statSync(files[0] ?? "").size).toBe(SECRET.length);
  });
});
