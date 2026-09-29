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
import { REPO_ROOT, runTypeScript } from "../.claude/skills/system-path-simulation/scripts/test-support.ts";

let scratch = "";
beforeEach(() => {
  mkdirSync(join(REPO_ROOT, ".scratch"), { recursive: true });
  scratch = mkdtempSync(join(REPO_ROOT, ".scratch", "review-settle-test-"));
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe("review-settle", () => {
  it("stages the version tree with its symlinks, then names the first missing campaign file", () => {
    const campaign = join(scratch, "campaigns", "s");
    mkdirSync(join(campaign, "versions", "r", "runs", "r", "judge"), { recursive: true });
    writeFileSync(join(campaign, "versions", "r", "marker.txt"), "bytes");
    symlinkSync("/nonexistent/toolchain", join(campaign, "versions", "r", ".toolchain"));
    writeFileSync(join(campaign, "case-record.jsonl"), "");
    // Where the Judge phase records the operator's one-liner: under the context's public domain.
    writeFileSync(
      join(campaign, "versions", "r", "runs", "r", "judge", "public-context.json"),
      JSON.stringify({
        schema: "judge-public-context/v1",
        publicDomain: { publicRequest: "Build a harness." },
      }),
    );
    const contested = join(scratch, "contested.json");
    writeFileSync(contested, "[]");
    const sim = join(scratch, "sim");
    const result = runTypeScript("review-settle.mts", [
      "--repo",
      scratch,
      "--slug",
      "s",
      "--run",
      "r",
      "--contested",
      contested,
      "--scratch",
      sim,
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('{"request":"recorded"}');
    expect(result.stderr).toContain("claims/r.json: missing; the analysis reader needs it");
    expect(readFileSync(join(sim, "campaigns", "s", "versions", "r", "marker.txt"), "utf8")).toBe("bytes");
    expect(existsSync(join(sim, "campaigns", "s", "case-record.jsonl"))).toBe(true);
    const link = Bun.spawnSync(["readlink", join(sim, "campaigns", "s", "versions", "r", ".toolchain")]);
    expect(new TextDecoder().decode(link.stdout).trim()).toBe("/nonexistent/toolchain");
  });

  it("stages the campaign's analysis without the probe lifetimes an earlier review left in it", () => {
    // A lifetime receipt names the directory it was written in, so a copied one reads as unsettled
    // at its new path, and the replayed review's probes share the `<runId>-probe-lifetime` root.
    const campaign = join(scratch, "campaigns", "s");
    mkdirSync(join(campaign, "versions", "r"), { recursive: true });
    mkdirSync(join(campaign, "claims"), { recursive: true });
    mkdirSync(join(campaign, "analysis", "r-probe-lifetime", "receipt"), { recursive: true });
    writeFileSync(join(campaign, "case-record.jsonl"), "");
    writeFileSync(join(campaign, "claims", "r.json"), "{}");
    writeFileSync(join(campaign, "isolation-probe-r.json"), "{}");
    writeFileSync(join(campaign, "analysis", "r-epoch-review.json"), "{}");
    writeFileSync(join(campaign, "analysis", "r-probe-lifetime", "receipt", "intent.json"), "{}");
    const sim = join(scratch, "sim");
    runTypeScript("review-settle.mts", ["--repo", scratch, "--slug", "s", "--run", "r", "--scratch", sim]);
    const staged = join(sim, "campaigns", "s", "analysis");
    expect(existsSync(join(staged, "r-epoch-review.json"))).toBe(true);
    expect(existsSync(join(staged, "r-probe-lifetime"))).toBe(false);
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
    // A request at the context's top level is not where any Judge phase wrote it, so it is not read.
    mkdirSync(join(campaign, "versions", "r", "runs", "r", "judge"), { recursive: true });
    writeFileSync(
      join(campaign, "versions", "r", "runs", "r", "judge", "public-context.json"),
      JSON.stringify({
        schema: "judge-public-context/v1",
        publicRequest: "Build a harness.",
        publicDomain: {},
      }),
    );
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
    expect(result.stdout).toContain('{"request":"unavailable"}');
    expect(result.stderr).not.toContain("analysis: missing");
    expect(existsSync(join(sim, "campaigns", "s", "claims", "r.json"))).toBe(true);
    expect(existsSync(join(sim, "campaigns", "s", "analysis"))).toBe(false);
  });
});
