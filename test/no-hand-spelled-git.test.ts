/**
 * The rule that sends a git subprocess to its owner, `src/meta/git.ts`, from a skill script, from
 * `src`, and from the run and campaign commands of `tools/runs` and `tools/d2`.
 *
 * The admitted side pins what is not a subprocess — a guard building the command it refuses as a
 * string, and `"git"` as ordinary data — and the scope pins where the owner is asked.
 */
import { describe, it } from "bun:test";
import { lintRules } from "./helpers/lint-rule.ts";

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

describe("ana/no-hand-spelled-git", () => {
  it("reports only the marked lines in every fixture and scope", async () => {
    await lintRules("ana", [
      ["no-hand-spelled-git", SCRIPT, 6, ".claude/skills/run-management/scripts/example.mjs"],
      ["no-hand-spelled-git", SCRIPT, 6, "src/kernel/example.ts"],
      ["no-hand-spelled-git", SCRIPT, 6, "tools/runs/example.ts"],
      ["no-hand-spelled-git", SCRIPT, 6, "tools/d2/example.ts"],
      ["no-hand-spelled-git", SCRIPT, 0, "src/meta/git.ts"],
      ["no-hand-spelled-git", SCRIPT, 0, ".claude/skills/run-management/scripts/example.test.ts"],
      ["no-hand-spelled-git", SCRIPT, 0, "test/example.test.ts"],
      ["no-hand-spelled-git", SCRIPT, 0, "tools/runtime/example.ts"],
    ]);
  });
});
