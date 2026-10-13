/**
 * The rule that sends a git subprocess to its tree's owner: `.claude/skills/main/git.ts` for a skill
 * script. `src` has no owner yet, since production code cannot import a skill module and spawns
 * no git on 10 October, so a site there is told where the owner belongs instead of which one to
 * ask.
 *
 * The admitted side pins what is not a subprocess — a guard building the command it refuses as a
 * string, and `"git"` as ordinary data — and the scope pins who owns the answer.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines, reportedMessages } from "./helpers/oxlint-rule-fixture.ts";

const SCRIPT = `
import { spawnSync } from "node:child_process";
import { $ } from "bun";
import { hostTool } from "#src/meta/host-tool.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { gitText } from "#skills/main/git.ts";
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

const SKILL_OWNER = ".claude/skills/main/git.ts";
const SKILL_SCRIPT = ".claude/skills/launch-run/scripts/example.mjs";
const SRC_FILE = "src/kernel/example.ts";

describe("ana/no-hand-spelled-git", () => {
  const reports = (at: string): Promise<number[]> => reportedLines("ana", "no-hand-spelled-git", SCRIPT, at);
  const messages = (at: string): Promise<string[]> =>
    reportedMessages("ana", "no-hand-spelled-git", SCRIPT, at);

  it("reports every spelling of a git subprocess and admits the owner's call and git as data", async () => {
    const expected = expectedLines(SCRIPT);
    expect(expected).toHaveLength(6);
    expect(await reports(SKILL_SCRIPT)).toStrictEqual(expected);
  });

  it("sends a skill script to the skills' owner by its three names", async () => {
    const reported = await messages(SKILL_SCRIPT);
    expect(reported).toHaveLength(6);
    for (const message of reported) {
      expect(message).toContain(`Ask gitOutput, gitText or gitMaybe from ${SKILL_OWNER}`);
      expect(message).not.toContain("src/meta");
    }
  });

  it("reports the same sites in src, and says that the owner belongs in src/meta beside host-tool.ts", async () => {
    expect(await reports(SRC_FILE)).toStrictEqual(expectedLines(SCRIPT));
    const reported = await messages(SRC_FILE);
    expect(reported).toHaveLength(6);
    for (const message of reported) {
      expect(message).toContain("src has no git owner yet");
      expect(message).toContain("src/meta beside host-tool.ts");
      expect(message).not.toContain("Ask gitOutput");
    }
  });

  it("leaves the skills' owner, tests and the tools tree alone", async () => {
    expect(await reports(SKILL_OWNER)).toStrictEqual([]);
    expect(await reports(".claude/skills/launch-run/scripts/example.test.ts")).toStrictEqual([]);
    expect(await reports("test/example.test.ts")).toStrictEqual([]);
    expect(await reports("tools/runs/example.ts")).toStrictEqual([]);
  });
});
