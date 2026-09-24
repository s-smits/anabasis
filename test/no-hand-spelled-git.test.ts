/**
 * The rule that sends a git subprocess to its tree's owner: `.claude/skills/main/git.ts` for a skill
 * script, and the two helpers `src` keeps for itself, since production code cannot import a skill.
 *
 * The admitted side pins what is not a subprocess — a guard building the command it refuses as a
 * string, and `"git"` as ordinary data — and the scope pins who owns the answer.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

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

describe("ana/no-hand-spelled-git", () => {
  const reports = (at: string): number[] => reportedLines("ana", "no-hand-spelled-git", SCRIPT, at);

  it("reports every spelling of a git subprocess and admits the owner's call and git as data", () => {
    const expected = expectedLines(SCRIPT);
    expect(expected).toHaveLength(6);
    expect(reports(".claude/skills/launch-run/scripts/example.mjs")).toStrictEqual(expected);
  });

  it("holds src to its own two owners, since it cannot import a skill module", () => {
    expect(reports("src/run/example.ts")).toStrictEqual(expectedLines(SCRIPT));
    expect(reports("src/run/source-identity.ts")).toStrictEqual([]);
    expect(reports("src/author/domain-repo.ts")).toStrictEqual([]);
  });

  it("leaves the skill owners, tests and the tools tree alone", () => {
    expect(reports(".claude/skills/main/git.ts")).toStrictEqual([]);
    expect(reports(".claude/skills/main/run.ts")).toStrictEqual([]);
    expect(reports(".claude/skills/launch-run/scripts/example.test.ts")).toStrictEqual([]);
    expect(reports("test/example.test.ts")).toStrictEqual([]);
    expect(reports("tools/runs/example.ts")).toStrictEqual([]);
  });
});
