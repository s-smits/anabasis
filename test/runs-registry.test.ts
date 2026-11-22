// Which run a name is, which process writes it, and what each of its launches kept beside its log.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { capturedSpawn, runtimeProcess } from "../src/meta/process.ts";
import { join } from "../src/meta/path.ts";
import { BUILDER, campaignsIn, processes, readLog, type Run, writers } from "../tools/runs/registry.ts";

const root = mkdtempSync(join(tmpdir(), "ana-runs-registry-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const campaign = (name: string, tree: string): Run => ({
  name,
  tree,
  path: join(tree, ".ana", "d2", name, "log.jsonl"),
  end: "comparison.reported",
});
const round = campaign("r1", "/wt");

describe("a run's writers", () => {
  it("knows a campaign's log is written by its campaign command, a round, an Examiner session or a drafting session of its name, in its worktree", () => {
    const rows: [string, string[]][] = [
      ["/wt", ["bun", "tools/d2/round.ts", "--name", "r1", "--session", "b-1"]],
      ["/wt", ["bun", "tools/d1b/examine.ts", "--name", "r1", "--session", "x-1"]],
      ["/wt", ["bun", "tools/d2/round.ts", "--name", "r10"]],
      ["/other", ["bun", "tools/d2/round.ts", "--name", "r1"]],
      ["/wt", ["bun", "tools/m0/live-solve.ts", "--task", "r1", "--cycle", "c01"]],
      ["/wt", ["bun", "tools/runs/cli.ts", "rehearse", "--name", "r1"]],
      ["/wt", ["bun", "run", "runs", "rehearse", "--name", "r1"]],
      ["/wt", ["bun", "tools/runs/cli.ts", "pulse", "--name", "r1"]],
      ["/wt", ["bun", "tools/runs/cli.ts", "launch", "r1", "--", "--project", "p"]],
      ["/wt", ["bun", "run", "runs", "continue", "r1", "--login", "4"]],
      ["/wt", ["bun", "tools/runs/cli.ts", "pause", "r1", "--after", "reported"]],
      ["/wt", ["bun", "tools/d2/harness-builder.ts", "--name", "r1", "--unattended"]],
      ["/wt", ["bun", "tools/d2/harness-builder.ts", "--name", "r10"]],
      ["/wt", ["bun", "tools/d1b/draft.ts", "--name", "r1", "--session", "d-1"]],
      ["/wt", ["nice", "-n", "19", "bun", "tools/d2/harness-builder.ts", "--name", "r1"]],
      ["/wt", ["bun", "tools/d2/harness-builder.ts", "--name=r1"]],
      ["/wt", ["bun", "tools/d2/harness-builder.ts", "--name=r10"]],
      ["/wt", ["zsh", "-c", "bun tools/d2/harness-builder.ts --name r1"]],
      ["/elsewhere", ["/bin/bun", "/wt/tools/d2/harness-builder.ts", "--name", "r1"]],
      ["/wt", ["bun", "/other/tools/d2/harness-builder.ts", "--name", "r1"]],
    ];
    const running = rows.map(([cwd, args], index) => ({ pid: index + 1, cwd, args }));
    expect(writers(round, running).map(({ pid }) => pid)).toEqual([1, 2, 6, 12, 14, 15, 16, 19]);
    const solve: Run = { ...round, name: "r1-c01-opus-1234", end: "solve.finished" };
    expect(writers(solve, running).map(({ pid }) => pid)).toEqual([5]);
  });
});

describe("the processes that may write a log", () => {
  it("finds a campaign command with the worktree it runs in, and leaves another process out", async () => {
    const tree = mkdtempSync(join(root, "tree-"));
    // Bun running a script at the campaign command's path, as `ps` lists a launch, beside another.
    mkdirSync(join(tree, "tools", "d2"), { recursive: true });
    for (const script of [BUILDER, "tools/d2/unrelated.ts"]) {
      writeFileSync(join(tree, script), "await Bun.sleep(30_000);\n");
    }
    const writer = capturedSpawn([runtimeProcess.execPath, BUILDER, "--name", "r1"], {
      cwd: tree,
      stdout: "ignore",
      stderr: "ignore",
    });
    const other = capturedSpawn([runtimeProcess.execPath, "tools/d2/unrelated.ts"], {
      cwd: tree,
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      await Bun.sleep(300);
      const found = processes();
      expect(found.find(({ pid }) => pid === writer.pid)?.cwd).toBe(realpathSync(tree));
      expect(found.some(({ pid }) => pid === other.pid)).toBe(false);
    } finally {
      writer.kill();
      other.kill();
    }
  });

  it("ignores plain files beside campaign directories and handles vanished logs without ENOTDIR or ENOENT", () => {
    const dir = mkdtempSync(join(root, "plain-"));
    writeFileSync(join(dir, "README.md"), "not a directory\n");
    expect(campaignsIn(join(dir, "README.md"), dir)).toEqual([]);
    const log = join(dir, "c1", "log.jsonl");
    mkdirSync(join(dir, "c1"), { recursive: true });
    writeFileSync(log, '{"at":"2026-10-15T12:00:00.000Z","kind":"campaign.opened","data":{}}\n');
    expect(campaignsIn(dir, dir).map(({ name }) => name)).toEqual(["c1"]);
    const present = readLog(log);
    expect(present?.events).toHaveLength(1);
    expect(present?.size).toBeGreaterThan(0);
    expect(readLog(join(dir, "vanished", "log.jsonl"))).toBeNull();
  });
});
