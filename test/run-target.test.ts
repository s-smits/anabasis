import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { resolveSourceCheckout } from "../.claude/skills/main/run.ts";
import { resolveRunSelector } from "../tools/runs/discover.ts";

const dirs: string[] = [];
const COMMIT = "511312ce8f2926355a957f90dd33fb010078bb8b";

type Head = { head: string; dirty?: boolean };
type Heads = Map<string, Head>;

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function campaignWith(runs: Record<string, string | null>): string {
  const campaign = mkdtempSync(join(tmpdir(), "hb4-run-target-"));
  dirs.push(campaign);
  for (const [runId, writtenAt] of Object.entries(runs)) {
    mkdirSync(join(campaign, "controller", runId), { recursive: true });
    if (writtenAt !== null) {
      writeFileSync(
        join(campaign, "controller", runId, "opening.json"),
        JSON.stringify({ runId, writtenAt }),
      );
    }
  }
  return campaign;
}

/** A scripted git: HEAD and status per directory, plus a log of every command. */
function fakeGit(heads: Heads, worktrees: string[]) {
  const calls: string[] = [];
  const git = (cmd: readonly string[], cwd: string): string => {
    calls.push(`${cwd}: ${cmd.join(" ")}`);
    const state = heads.get(cwd);
    if (cmd[1] === "rev-parse") {
      if (state === undefined) throw new Error("not a git repository");
      return state.head;
    }
    if (cmd[1] === "status") return state?.dirty === true ? " M src/x.ts" : "";
    if (cmd[1] === "worktree" && cmd[2] === "list") {
      return worktrees.map((dir) => `worktree ${dir}\nHEAD x\n`).join("\n");
    }
    return "";
  };
  return { git, calls };
}

describe("run target resolution", () => {
  it("names the latest run of a campaign folder and accepts the run folder itself", () => {
    const campaign = campaignWith({
      "run-a": "2026-09-10T10:00:00.000Z",
      "run-b": "2026-09-12T10:00:00.000Z",
      "run-c": null,
    });
    expect(resolveRunSelector(campaign)).toEqual({
      campaign,
      runId: "run-b",
      chosen: "latest of 2 runs by opening writtenAt",
    });
    expect(resolveRunSelector(join(campaign, "controller"))).toMatchObject({ runId: "run-b" });
    expect(resolveRunSelector(join(campaign, "controller", "run-a"))).toEqual({
      campaign,
      runId: "run-a",
      chosen: "folder",
    });
    expect(resolveRunSelector(campaign, "run-a")).toEqual({ campaign, runId: "run-a", chosen: "--run" });
    expect(() => resolveRunSelector(join(campaign, "controller", "run-a"), "run-b")).toThrow(
      "folder names run run-a but --run says run-b",
    );
  });

  it("refuses a folder without any opened run", () => {
    const campaign = campaignWith({ "run-c": null });
    expect(() => resolveRunSelector(campaign)).toThrow("no run with a dated opening.json");
    expect(() => resolveRunSelector(join(campaign, "missing"))).toThrow("no such folder");
  });

  it("prefers the current directory, then an existing clean worktree at the commit", () => {
    const here = fakeGit(new Map([["/cwd", { head: COMMIT }]]), []);
    expect(resolveSourceCheckout(COMMIT, { cwd: "/cwd", skillRepo: "/skill", git: here.git })).toEqual({
      repo: "/cwd",
      chosen: "current directory",
    });
    const elsewhere = fakeGit(
      new Map<string, Head>([
        ["/cwd", { head: COMMIT, dirty: true }],
        ["/wt/dirty", { head: COMMIT, dirty: true }],
        ["/wt/clean", { head: COMMIT }],
      ]),
      ["/wt/dirty", "/wt/clean"],
    );
    expect(resolveSourceCheckout(COMMIT, { cwd: "/cwd", skillRepo: "/skill", git: elsewhere.git })).toEqual({
      repo: "/wt/clean",
      chosen: "existing worktree",
    });
    // A found worktree is prepared by the one dependency owner, never by a second install here.
    expect(elsewhere.calls.filter((line) => line.includes("worktree.sh"))).toEqual([
      "/skill: /skill/scripts/worktree.sh setup /wt/clean",
    ]);
    expect(resolveSourceCheckout(COMMIT, { repo: "/given", git: here.git })).toEqual({
      repo: "/given",
      chosen: "--repo",
    });
    expect(() => resolveSourceCheckout("abc", { git: here.git })).toThrow("not a full sha");
  });

  it("creates and prepares a detached worktree when no checkout matches", () => {
    const cache = mkdtempSync(join(tmpdir(), "hb4-wri-source-"));
    dirs.push(cache);
    const dir = join(cache, COMMIT.slice(0, 12));
    const heads: Heads = new Map([["/cwd", { head: "0000000000000000000000000000000000000000" }]]);
    const { git, calls } = fakeGit(heads, ["/skill"]);
    const creating = (cmd: readonly string[], cwd: string): string => {
      if (cmd[1] === "cat-file") throw new Error("missing object");
      if (cmd[1] === "worktree" && cmd[2] === "add") {
        mkdirSync(dir, { recursive: true });
        heads.set(dir, { head: COMMIT });
      }
      return git(cmd, cwd);
    };
    expect(resolveSourceCheckout(COMMIT, { cwd: "/cwd", skillRepo: "/skill", cache, git: creating })).toEqual(
      { repo: dir, chosen: "new detached worktree" },
    );
    expect(
      calls.filter(
        (line) => line.includes("fetch") || line.includes("worktree add") || line.includes("worktree.sh"),
      ),
    ).toEqual([
      `/skill: git fetch --quiet origin ${COMMIT}`,
      `/skill: git worktree add --detach ${dir} ${COMMIT}`,
      `/skill: /skill/scripts/worktree.sh setup ${dir}`,
    ]);
  });
});
