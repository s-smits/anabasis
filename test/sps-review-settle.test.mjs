import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { REPO_ROOT, runTypeScript } from "../.claude/skills/system-path-simulation/scripts/test-support.mjs";

let scratch;
beforeEach(() => {
  mkdirSync(join(REPO_ROOT, ".scratch"), { recursive: true });
  scratch = mkdtempSync(join(REPO_ROOT, ".scratch", "review-settle-test-"));
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe("review-settle", () => {
  it("refuses a relative scratch root and a missing vetoed file", () => {
    const vetoed = join(scratch, "vetoed.json");
    writeFileSync(vetoed, "[]");
    const base = ["--repo", scratch, "--slug", "s", "--run", "r", "--vetoed", vetoed];
    expect(runTypeScript("review-settle.mts", [...base, "--scratch", "relative"]).stderr).toContain(
      "--scratch must be an absolute path",
    );
    const result = runTypeScript("review-settle.mts", [
      "--repo",
      scratch,
      "--slug",
      "s",
      "--run",
      "r",
      "--vetoed",
      join(scratch, "none.json"),
      "--scratch",
      join(scratch, "sim"),
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("none.json: missing");
  });

  it("runs without a vetoed file, and still refuses a relative one", () => {
    const sim = join(scratch, "sim");
    const base = ["--repo", scratch, "--slug", "s", "--run", "r", "--scratch", sim];
    // A battery with nothing contested is the ordinary replay, so the absent argument must reach
    // staging rather than being refused as missing.
    expect(runTypeScript("review-settle.mts", base).stderr).toContain("versions/r: missing");
    expect(runTypeScript("review-settle.mts", [...base, "--vetoed", "vetoed.json"]).stderr).toContain(
      "--vetoed must be an absolute path",
    );
  });

  it("stages the version tree with its symlinks, then names the first missing campaign file", () => {
    const campaign = join(scratch, "campaigns", "s");
    mkdirSync(join(campaign, "versions", "r", "runs", "r", "judge"), { recursive: true });
    writeFileSync(join(campaign, "versions", "r", "marker.txt"), "bytes");
    symlinkSync("/nonexistent/toolchain", join(campaign, "versions", "r", ".toolchain"));
    writeFileSync(join(campaign, "case-record.jsonl"), "");
    const vetoed = join(scratch, "vetoed.json");
    writeFileSync(vetoed, "[]");
    const sim = join(scratch, "sim");
    const result = runTypeScript("review-settle.mts", [
      "--repo",
      scratch,
      "--slug",
      "s",
      "--run",
      "r",
      "--vetoed",
      vetoed,
      "--scratch",
      sim,
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("claims/r.json: missing; the analysis reader needs it");
    expect(readFileSync(join(sim, "campaigns", "s", "versions", "r", "marker.txt"), "utf8")).toBe("bytes");
    expect(existsSync(join(sim, "campaigns", "s", "case-record.jsonl"))).toBe(true);
    const link = Bun.spawnSync(["readlink", join(sim, "campaigns", "s", "versions", "r", ".toolchain")]);
    expect(new TextDecoder().decode(link.stdout).trim()).toBe("/nonexistent/toolchain");
  });

  it("stages a campaign that ended before its analyse step", () => {
    // A run cut short holds a claim and no `analysis/`; that absence is the ordinary replay
    // condition, not a refusal, and the standing ledger then reads as empty.
    const campaign = join(scratch, "campaigns", "s");
    mkdirSync(join(campaign, "versions", "r"), { recursive: true });
    mkdirSync(join(campaign, "claims"), { recursive: true });
    writeFileSync(join(campaign, "case-record.jsonl"), "");
    writeFileSync(join(campaign, "claims", "r.json"), "{}");
    writeFileSync(join(campaign, "isolation-probe-r.json"), "{}");
    const sim = join(scratch, "sim");
    const result = runTypeScript("review-settle.mts", [
      "--repo",
      scratch,
      "--slug",
      "s",
      "--run",
      "r",
      "--scratch",
      sim,
    ]);
    expect(result.stderr).not.toContain("analysis: missing");
    expect(existsSync(join(sim, "campaigns", "s", "claims", "r.json"))).toBe(true);
    expect(existsSync(join(sim, "campaigns", "s", "analysis"))).toBe(false);
  });
});
