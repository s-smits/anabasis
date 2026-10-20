// Which run a name is, which process writes it, and what each of its launches kept beside its log.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { nextRun, receipts } from "../tools/runs/receipt.ts";
import { type Run, runNamed, writers } from "../tools/runs/registry.ts";

const root = mkdtempSync(join(tmpdir(), "ana-runs-registry-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const campaign = (name: string, tree: string): Run => ({
  name,
  tree,
  path: join(tree, ".ana", "d2", name, "log.jsonl"),
  end: "comparison.reported",
});
const round = campaign("r1", "/wt");

describe("a run's name", () => {
  it("names one campaign, whole, and refuses none or two", () => {
    const listed = [
      round,
      // A live solve of the same name is no campaign, and a campaign of the name in another
      // worktree is a second one: two buffer campaigns ran under one name on 13 October.
      { ...round, path: "/wt/.ana/live/r1.jsonl", end: "solve.finished" as const },
      campaign("r2", "/wt"),
      campaign("r2", "/other"),
    ];
    expect(runNamed("r1", listed)).toBe(round);
    expect(() => runNamed("r", listed)).toThrow("no campaign log is named r in");
    expect(() => runNamed("r2", listed)).toThrow("r2 names a campaign in /wt and in /other");
  });
});

describe("a run's writers", () => {
  it("knows a campaign's log is written by its campaign command, a round, an Examiner session or a drafting session of its name, in its worktree", () => {
    const running = [
      { pid: 1, cwd: "/wt", args: ["bun", "tools/d2/round.ts", "--name", "r1", "--session", "b-1"] },
      { pid: 2, cwd: "/wt", args: ["bun", "tools/d1b/examine.ts", "--name", "r1", "--session", "x-1"] },
      { pid: 3, cwd: "/wt", args: ["bun", "tools/d2/round.ts", "--name", "r10"] },
      { pid: 4, cwd: "/other", args: ["bun", "tools/d2/round.ts", "--name", "r1"] },
      { pid: 5, cwd: "/wt", args: ["bun", "tools/m0/live-solve.ts", "--task", "r1", "--cycle", "c01"] },
      // A rehearsal is a round on a seed. The script runner that started it holds no log open.
      { pid: 6, cwd: "/wt", args: ["bun", "tools/runs/cli.ts", "rehearse", "--name", "r1"] },
      { pid: 7, cwd: "/wt", args: ["bun", "run", "runs", "rehearse", "--name", "r1"] },
      { pid: 8, cwd: "/wt", args: ["bun", "tools/runs/cli.ts", "pulse", "--name", "r1"] },
      // A launch names the command it starts and holds no log open: on 10 October a launch of a
      // round into the tree that held the campaign's log was refused by itself, and by its package
      // script too. The verbs that start and pause a campaign are the same kind.
      { pid: 9, cwd: "/wt", args: ["bun", "tools/runs/cli.ts", "launch", "r1", "--", "--project", "p"] },
      { pid: 10, cwd: "/wt", args: ["bun", "run", "runs", "continue", "r1", "--login", "4"] },
      { pid: 11, cwd: "/wt", args: ["bun", "tools/runs/cli.ts", "pause", "r1", "--after", "promoted"] },
      // A campaign command runs every move in its own process: the campaigns on record have no
      // other, and read as closed while they ran (2026-10-10).
      { pid: 12, cwd: "/wt", args: ["bun", "tools/d2/harness-builder.ts", "--name", "r1", "--unattended"] },
      { pid: 13, cwd: "/wt", args: ["bun", "tools/d2/harness-builder.ts", "--name", "r10"] },
      // The session that drafts an exam, run by itself, holds a capped root: read as closed, a stop
      // would have released that root under it (11 October).
      { pid: 14, cwd: "/wt", args: ["bun", "tools/d1b/draft.ts", "--name", "r1", "--session", "d-1"] },
      // Started niced, the command is nice's until nice execs it, and the name is the same.
      {
        pid: 15,
        cwd: "/wt",
        args: ["nice", "-n", "19", "bun", "tools/d2/harness-builder.ts", "--name", "r1"],
      },
      // Started by hand with the name joined to its flag, as `parseArgs` takes it.
      { pid: 16, cwd: "/wt", args: ["bun", "tools/d2/harness-builder.ts", "--name=r1"] },
      { pid: 17, cwd: "/wt", args: ["bun", "tools/d2/harness-builder.ts", "--name=r10"] },
    ];
    expect(writers(round, running).map(({ pid }) => pid)).toEqual([1, 2, 6, 12, 14, 15, 16]);
    const solve: Run = { ...round, name: "r1-c01-opus-1234", end: "solve.finished" };
    expect(writers(solve, running).map(({ pid }) => pid)).toEqual([5]);
  });
});

describe("a run's receipts", () => {
  const log = join(root, "buffer", "log.jsonl");
  mkdirSync(join(root, "buffer"));
  const kept = (session: string, at: string, flags: string[]) =>
    writeFileSync(
      join(root, "buffer", `launch-${session}.json`),
      JSON.stringify({ at, pid: 1, flags, envFile: null, commit: "c", dirty: false, load: 1, cores: 8 }),
    );

  it("reads none for a campaign started by hand or not yet started, and numbers the first run", () => {
    expect(receipts(join(root, "none", "log.jsonl"))).toEqual([]);
    expect(nextRun(join(root, "none", "log.jsonl"))).toBe("run-1");
  });

  it("reads each receipt oldest first, with its flags, and numbers the next run past the campaign command's own", () => {
    kept("run-2", "2026-10-15T11:00:00.000Z", ["--project", "p", "--budget", "800"]);
    kept("run-1", "2026-10-14T09:00:00.000Z", ["--project", "p"]);
    // A round that `bun run runs launch` started until 11 October kept one under its session.
    kept("b-1", "2026-10-09T13:00:00.000Z", ["--session", "b-1"]);
    writeFileSync(join(root, "buffer", "launch-run-2.out"), "");
    const read = receipts(log);
    expect(read.map(({ session }) => session)).toEqual(["b-1", "run-1", "run-2"]);
    expect(read.at(-1)?.flags).toEqual(["--project", "p", "--budget", "800"]);
    expect(nextRun(log)).toBe("run-3");
  });
});
