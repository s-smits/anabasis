import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { REPO_ROOT, runTypeScript } from "../.claude/skills/system-path-simulation/scripts/test-support.mjs";

let scratch;
beforeEach(() => {
  mkdirSync(join(REPO_ROOT, ".scratch"), { recursive: true });
  scratch = mkdtempSync(join(REPO_ROOT, ".scratch", "judge-replay-test-"));
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe("judge-replay", () => {
  it("refuses a relative report path, an unknown option and a missing task before any model opens", () => {
    const base = ["--repo", scratch, "--slug", "s", "--run", "r", "--task", "t"];
    expect(runTypeScript("judge-replay.mts", [...base, "--out", "relative"]).stderr).toContain(
      "--out must be an absolute path",
    );
    expect(runTypeScript("judge-replay.mts", [...base, "--out", scratch, "--bogus"]).stderr).toContain(
      'unknown option "--bogus"',
    );
    const result = runTypeScript("judge-replay.mts", [
      "--repo",
      scratch,
      "--slug",
      "s",
      "--run",
      "r",
      "--out",
      scratch,
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--task is required");
  });

  it("refuses a run whose brief the current reader cannot validate", () => {
    const version = join(scratch, "campaigns", "s", "versions", "r");
    mkdirSync(join(version, "correctness-model"), { recursive: true });
    writeFileSync(join(version, "correctness-model", "brief.json"), "{}");
    const result = runTypeScript("judge-replay.mts", [
      "--repo",
      scratch,
      "--slug",
      "s",
      "--run",
      "r",
      "--task",
      "t",
      "--out",
      join(scratch, "out"),
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("brief missing or invalid");
  });
});
