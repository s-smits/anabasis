/**
 * The rule that sends a git subprocess to its owner, `src/meta/git.ts`, from a skill script, from
 * `src`, and from the run and campaign commands of `tools/runs` and `tools/d2`.
 *
 * The admitted side pins what is not a subprocess — a guard building the command it refuses as a
 * string, and `"git"` as ordinary data — and the scope pins where the owner is asked.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines, reportedMessages } from "./helpers/oxlint-rule-fixture.ts";

const SCRIPT = `
import { spawnSync } from "node:child_process";
import { $ } from "bun";
import { hostTool } from "#src/meta/host-tool.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { gitText } from "#src/meta/git.ts";
export const head = (repo) => gitText(repo, "rev-parse", "HEAD"); // ADMITTED the owner answers
export const bare = (repo) => runTextSyncOrThrow(["git", "-C", repo, "status"]); // REPORT bare git, unbounded
export const resolved = (repo) => runTextSyncOrThrow([hostTool("git"), "-C", repo, "log"]); // REPORT the owner's own first line
export const spawned = () => Bun.spawnSync({ cmd: ["git", "fetch"] }); // REPORT a command array in an options property
const LIST = ["git", "worktree", "list"]; // REPORT a command held in a binding before it is run
export const node = () => spawnSync("git", ["status"]); // REPORT the executable as a spawner's first argument
export const shell = () => $\`git status --porcelain\`; // REPORT Bun's shell reaches the same process
export const PROBE = ["git", "reset", "--hard"].join(" "); // ADMITTED a string a guard refuses, not a subprocess
export const tools = new Set(["git", "gh"]); // ADMITTED git as data, not first in a command
export const other = () => runTextSyncOrThrow(["gh", "pr", "view"]); // ADMITTED another executable
export { LIST };
`.trimStart();

const OWNER = "src/meta/git.ts";
const SKILL_SCRIPT = ".claude/skills/run-management/scripts/example.mjs";

describe("ana/no-hand-spelled-git", () => {
  const reports = (at: string): Promise<number[]> => reportedLines("ana", "no-hand-spelled-git", SCRIPT, at);

  it("reports every spelling of a git subprocess and admits the owner's call and git as data", async () => {
    const expected = expectedLines(SCRIPT);
    expect(expected).toHaveLength(6);
    for (const at of [
      SKILL_SCRIPT,
      "src/kernel/example.ts",
      "tools/runs/example.ts",
      "tools/d2/example.ts",
    ]) {
      expect(await reports(at)).toStrictEqual(expected);
    }
  });

  it("sends each site to the owner by its three names", async () => {
    const reported = await reportedMessages("ana", "no-hand-spelled-git", SCRIPT, SKILL_SCRIPT);
    expect(reported).toHaveLength(6);
    for (const message of reported) {
      expect(message).toContain(`Ask gitOutput, gitText or gitMaybe from ${OWNER}`);
    }
  });

  it("leaves the owner, tests and the landing commands alone", async () => {
    expect(await reports(OWNER)).toStrictEqual([]);
    expect(await reports(".claude/skills/run-management/scripts/example.test.ts")).toStrictEqual([]);
    expect(await reports("test/example.test.ts")).toStrictEqual([]);
    expect(await reports("tools/runtime/example.ts")).toStrictEqual([]);
  });
});
