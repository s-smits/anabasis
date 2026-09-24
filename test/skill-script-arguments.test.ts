/**
 * Skill scripts that used to read `Bun.argv` by hand, each refusing an argument its old reader
 * accepted in silence. Every case runs from an empty scratch directory, because the old readers
 * fell back to the working directory and would have written or scanned there instead.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const SKILLS = join(import.meta.dir, "../.claude/skills");
const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function run(script: string, ...args: string[]) {
  const cwd = mkdtempSync(join(tmpdir(), "ana-skill-args-"));
  scratch.push(cwd);
  const result = Bun.spawnSync([Bun.argv[0] ?? "bun", join(SKILLS, script), ...args], { cwd });
  return { exitCode: result.exitCode, stderr: result.stderr.toString(), written: readdirSync(cwd) };
}

describe("skill script arguments", () => {
  // `resolve("")` is the working directory, so the old `root === ""` usage check never fired and
  // a bare invocation seeded a fixture repository wherever it was run.
  it("emit-profiles refuses a missing fixture root instead of seeding the working directory", () => {
    const result = run("oss-verifier-grounding/scripts/install-probe/emit-profiles.mts");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("emit-profiles: expected 1 positional argument");
    expect(result.written).toStrictEqual([]);
  });

  it("extract-prompt-surface refuses a misspelled option instead of scanning with defaults", () => {
    const result = run("prompt-surface-census/scripts/extract-prompt-surface.mjs", "--jsno", "out.json");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('extract-prompt-surface: unknown option "--jsno"');
    expect(result.written).toStrictEqual([]);
  });

  it("impact-rank refuses a misspelled threshold instead of ranking at the default", () => {
    const result = run("test-impact-and-consolidation/scripts/impact-rank.mjs", "--contanment", "0.5");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('impact-rank: unknown option "--contanment"');
  });
});
