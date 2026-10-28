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
      ["/wt", ["bun", "tools/runs/cli.ts", "pause", "r1", "--after", "promoted"]],
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

describe("a run's receipts", () => {
  const log = join(root, "buffer", "log.jsonl");
  mkdirSync(join(root, "buffer"));
  it("reads receipts chronologically with flags and numbers the next campaign run", () => {
    expect(receipts(log)).toEqual([]);
    expect(nextRun(log)).toBe("run-1");
    for (const [session, at, flags] of [
      ["run-2", "2026-10-15T11:00:00.000Z", ["--project", "p", "--budget", "800"]],
      ["run-1", "2026-10-14T09:00:00.000Z", ["--project", "p"]],
      ["b-1", "2026-10-09T13:00:00.000Z", ["--session", "b-1"]],
    ] as const) {
      writeFileSync(
        join(root, "buffer", `launch-${session}.json`),
        JSON.stringify({
          at,
          pid: 1,
          flags,
          envFile: null,
          commit: "c",
          dirty: false,
          load: 1,
          cores: 8,
        }),
      );
    }
    writeFileSync(join(root, "buffer", "launch-run-2.out"), "");
    const read = receipts(log);
    expect(read.map(({ session }) => session)).toEqual(["b-1", "run-1", "run-2"]);
    expect(read.at(-1)?.flags).toEqual(["--project", "p", "--budget", "800"]);
    expect(nextRun(log)).toBe("run-3");
  });
});
