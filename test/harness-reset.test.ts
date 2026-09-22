import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAll, initWorkspace } from "../src/author/domain-repo.ts";
import { createHarnessResetTool } from "../src/builder/harness-reset.ts";
import { execTextSync } from "./helpers/bun-spawn-sync.ts";

const scratch: string[] = [];
const workspaceWithDesign = () => {
  const dir = mkdtempSync(join(tmpdir(), "ana-harness-reset-"));
  scratch.push(dir);
  initWorkspace(dir);
  writeFileSync(join(dir, "agent/design.ts"), "export const design = 1;\n");
  writeFileSync(join(dir, "correctness-model/checks-notes.json"), '{"kept":true}\n');
  commitAll(dir, "01-t: previous harness");
  return dir;
};
const run = async (
  tool: ReturnType<typeof createHarnessResetTool>,
  scope: "agent" | "correctness-model" | "all",
) => {
  const result = await tool.execute("call", { scope });
  // SAFETY: the tool writes exactly these detail fields; the test reads two optional fields of it.
  return result.details as { applied?: boolean; receipt?: { outcome?: string } } | undefined;
};

describe("harness_reset", () => {
  it("refuses outside a reopen rebuild and leaves the workspace alone", async () => {
    const dir = workspaceWithDesign();
    const result = await run(createHarnessResetTool({ workspace: dir }), "all");
    expect(result?.receipt?.outcome).toBe("refused");
    expect(existsSync(join(dir, "agent/design.ts"))).toBe(true);
  });

  it("returns only the chosen directory to the starter, once per reopen key", async () => {
    const dir = workspaceWithDesign();
    const pristine = mkdtempSync(join(tmpdir(), "ana-harness-reset-starter-"));
    scratch.push(pristine);
    initWorkspace(pristine);
    const tool = createHarnessResetTool({ workspace: dir, resetKey: "evidence-a" });
    const first = await run(tool, "agent");
    expect(first).toMatchObject({ applied: true, receipt: { outcome: "completed" } });
    expect(existsSync(join(dir, "agent/design.ts"))).toBe(false);
    expect(readFileSync(join(dir, "agent/tools.ts"), "utf8")).toBe(
      readFileSync(join(pristine, "agent/tools.ts"), "utf8"),
    );
    expect(readFileSync(join(dir, "correctness-model/checks-notes.json"), "utf8")).toContain("kept");
    // History keeps the replaced bytes, and the commit names the scope so a resume finds it.
    const log = execTextSync("git", ["-C", dir, "log", "--format=%s"]);
    expect(log).toContain("rebuild: agent reset to starter (reset-key evidence-a scope agent)");
    expect(execTextSync("git", ["-C", dir, "show", "HEAD~1:agent/design.ts"])).toContain("design = 1");
    // The same key and scope again is a no-op that keeps later edits.
    writeFileSync(join(dir, "agent/later.ts"), "export const later = 1;\n");
    commitAll(dir, "02-t: later");
    const again = await run(tool, "agent");
    expect(again?.applied).toBe(false);
    expect(existsSync(join(dir, "agent/later.ts"))).toBe(true);
    // A different scope under the same key still applies.
    const evaluation = await run(tool, "correctness-model");
    expect(evaluation?.applied).toBe(true);
    expect(existsSync(join(dir, "correctness-model/checks-notes.json"))).toBe(false);
    expect(existsSync(join(dir, "agent/later.ts"))).toBe(true);
  });
});

process.on("exit", () => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
