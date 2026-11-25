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
  it("knows a campaign's log is written by its campaign command, a standalone comparison, an Examiner session or a drafting session of its name, in its worktree", () => {
    const rows: [string, string[]][] = [
      ["/wt", ["bun", "tools/campaign/checkpoint.ts", "--name", "r1", "--session", "b-1"]],
      ["/wt", ["bun", "tools/eval/examine.ts", "--name", "r1", "--session", "x-1"]],
      ["/wt", ["bun", "tools/campaign/checkpoint.ts", "--name", "r10"]],
      ["/other", ["bun", "tools/campaign/checkpoint.ts", "--name", "r1"]],
      ["/wt", ["bun", "tools/runs/cli.ts", "rehearse", "--name", "r1"]],
      ["/wt", ["bun", "run", "runs", "rehearse", "--name", "r1"]],
      ["/wt", ["bun", "tools/runs/cli.ts", "pulse", "--name", "r1"]],
      ["/wt", ["bun", "tools/runs/cli.ts", "launch", "r1", "--", "--project", "p"]],
      ["/wt", ["bun", "run", "runs", "continue", "r1", "--login", "4"]],
      ["/wt", ["bun", "tools/runs/cli.ts", "pause", "r1", "--after", "reported"]],
      ["/wt", ["bun", "tools/campaign/harness-builder.ts", "--name", "r1", "--unattended"]],
      ["/wt", ["bun", "tools/campaign/harness-builder.ts", "--name", "r10"]],
      ["/wt", ["bun", "tools/eval/draft.ts", "--name", "r1", "--session", "d-1"]],
      ["/wt", ["nice", "-n", "19", "bun", "tools/campaign/harness-builder.ts", "--name", "r1"]],
      ["/wt", ["bun", "tools/campaign/harness-builder.ts", "--name=r1"]],
      ["/wt", ["bun", "tools/campaign/harness-builder.ts", "--name=r10"]],
      ["/wt", ["zsh", "-c", "bun tools/campaign/harness-builder.ts --name r1"]],
      ["/elsewhere", ["/bin/bun", "/wt/tools/campaign/harness-builder.ts", "--name", "r1"]],
      ["/wt", ["bun", "/other/tools/campaign/harness-builder.ts", "--name", "r1"]],
      ["/wt", ["bun", "tools/d2/harness-builder.ts", "--name", "r1"]],
      ["/wt", ["bun", "tools/d1b/examine.ts", "--name", "r1", "--session", "x-1"]],
      ["/wt", ["bun", "not-tools/d2/harness-builder.ts", "--name", "r1"]],
    ];
    const running = rows.map(([cwd, args], index) => ({ pid: index + 1, cwd, args }));
    expect(writers(round, running).map(({ pid }) => pid)).toEqual([1, 2, 5, 11, 13, 14, 15, 18, 20, 21]);
    const solve: Run = { ...round, name: "r1-c01-opus-1234", end: "solve.finished" };
    expect(writers(solve, running)).toEqual([]);
  });
});

describe("the processes that may write a log", () => {
  it("finds a campaign command with the worktree it runs in, and leaves another process out", async () => {
    const tree = mkdtempSync(join(root, "tree-"));
    mkdirSync(join(tree, "tools", "campaign"), { recursive: true });
    for (const script of [BUILDER, "tools/campaign/unrelated.ts"]) {
      writeFileSync(join(tree, script), "await Bun.sleep(30_000);\n");
    }
    const writer = capturedSpawn([runtimeProcess.execPath, BUILDER, "--name", "r1"], {
      cwd: tree,
      stdout: "ignore",
      stderr: "ignore",
    });
    const other = capturedSpawn([runtimeProcess.execPath, "tools/campaign/unrelated.ts"], {
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
