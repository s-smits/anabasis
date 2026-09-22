/**
 * Focused check for the zip-run skill script: the three levels select and exclude the named
 * groups on a synthetic run tree, launch.json's runId picks the campaign among copied ones,
 * and --light reports its 2 MB cap.
 */
import { spawnTextSync as spawnSync } from "./helpers/bun-spawn-sync.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { parseJsonAs } from "../src/meta/json-runtime.ts";

const repoRoot = resolve(import.meta.dirname, "..");
const script = join(repoRoot, ".claude/skills/zip-run/scripts/zip-run.mjs");
const RUN_ID = "custom-sol-20260101T000000000Z-abc123";
const OTHER_RUN_ID = "truss-sol-20250101T000000000Z-000000";

interface Manifest {
  level: string;
  runId: string;
  sourceCommit: string | null;
  files: { path: string; group: string }[];
  excluded: Record<string, string>;
}

function put(root: string, rel: string, content = "{}"): void {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function syntheticRun(runDir: string): string {
  const campaign = join(runDir, "campaigns", "slug-a1b2c3d4");
  put(runDir, ".scratch/quick-run/launch.json", JSON.stringify({ runId: RUN_ID }));
  put(runDir, ".scratch/quick-run/fullrun.log", "log\n");
  put(runDir, ".scratch/quick-run/codex/auth.json", "secret");
  put(runDir, `.scratch/quick-run/codex/sessions/rollout-1.jsonl`, "{}\n");
  // A copied campaign from another run, listed first, must not be selected.
  put(runDir, `campaigns/copied-000000/controller/${OTHER_RUN_ID}/opening.json`);
  put(campaign, `controller/${RUN_ID}/opening.json`, JSON.stringify({ source: { commit: "deadbeef" } }));
  put(campaign, `controller/${RUN_ID}/terminal.json`);
  put(campaign, `controller/${RUN_ID}/verifier-lifetime/p1/intent.json`);
  put(campaign, "epochs.json");
  put(campaign, "case-record.jsonl");
  put(campaign, "controller.sqlite");
  put(campaign, "claims/run-i02.json");
  put(campaign, "analysis/run-rebuild-advice.json");
  put(campaign, `observability/${RUN_ID}.jsonl`, "{}\n");
  put(campaign, "epoch-aaaa/builder-prose.jsonl");
  put(campaign, "epoch-aaaa/builder-path-record.jsonl");
  put(campaign, "epoch-aaaa/trials/t1/census.json");
  put(campaign, "epoch-aaaa/workspace/STARTER.md", "# starter");
  put(campaign, "epoch-aaaa/workspace/.toolchain/bin/solver", "binary");
  put(campaign, "epoch-aaaa/workspace/.bundle-snapshots/s1/tasks.json");
  put(campaign, "epoch-aaaa/.oss/downloads/big.tar", "binary");
  const version = `versions/${RUN_ID}-i02`;
  put(campaign, `${version}/version.json`);
  put(campaign, `${version}/agent/tools.ts`, "export {};");
  put(campaign, `${version}/correctness-model/evaluator.ts`, "export {};");
  put(campaign, `${version}/correctness-model/tasks.json`);
  put(campaign, `${version}/runs/${RUN_ID}-i02/battery.json`);
  put(campaign, `${version}/runs/${RUN_ID}-i02/judge/review-standing.json`);
  put(campaign, `${version}/runs/${RUN_ID}-i02/cases/task-01/case-result.json`);
  put(campaign, `${version}/runs/${RUN_ID}-i02/cases/task-01/trace.json`);
  put(campaign, `${version}/runs/${RUN_ID}-i02/cases/task-01/built-runtime.json`);
  return campaign;
}

function zipAt(runDir: string, level: string, out: string) {
  const result = spawnSync("bun", ["--no-env-file", script, runDir, `--${level}`, "--out", out], {
    cwd: repoRoot,
  });
  const listing = existsSync(out) ? spawnSync("unzip", ["-l", out], { cwd: repoRoot }).stdout : "";
  const paths = listing
    .split("\n")
    .map((line) => line.trim().split(/\s+/).at(-1) ?? "")
    .filter((p) => p.includes("/"))
    .map((p) => p.split("/").slice(1).join("/"));
  const extract = mkdtempSync(join(tmpdir(), "zip-run-extract-"));
  if (existsSync(out)) spawnSync("unzip", ["-q", out, "-d", extract], { cwd: repoRoot });
  const manifestPath = join(extract, `${RUN_ID}-${level}`, "MANIFEST.json");
  const manifest = existsSync(manifestPath)
    ? parseJsonAs<Manifest>(readFileSync(manifestPath, "utf8"))
    : null;
  const readmePath = join(extract, `${RUN_ID}-${level}`, "README.md");
  const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";
  return { code: result.status, stderr: result.stderr, paths, manifest, readme };
}

describe("the zip-run skill script", () => {
  const temps: string[] = [];
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function fresh(): string {
    const dir = mkdtempSync(join(tmpdir(), "zip-run-"));
    temps.push(dir);
    return dir;
  }

  it("selects the launched campaign by runId and keeps light to ledgers, reasoning and verdicts", () => {
    const runDir = fresh();
    syntheticRun(runDir);
    const { code, paths, readme } = zipAt(runDir, "light", join(runDir, "light.zip"));
    expect(code).toBe(0);
    expect(paths).toContain("controller/opening.json");
    expect(paths).toContain("launch/fullrun.log");
    expect(paths).toContain("epochs/epoch-aaaa/builder-prose.jsonl");
    expect(paths).toContain(`versions/${RUN_ID}-i02/correctness-model/evaluator.ts`);
    expect(paths).toContain(`versions/${RUN_ID}-i02/runs/${RUN_ID}-i02/cases/task-01/case-result.json`);
    expect(paths).toContain("README.md");
    expect(paths).toContain("MANIFEST.json");
    expect(readme).toContain("## Guidelines for this bundle (light)");
    expect(paths.some((p) => p.includes(OTHER_RUN_ID))).toBe(false);
    for (const absent of [
      "epochs/epoch-aaaa/builder-path-record.jsonl",
      `versions/${RUN_ID}-i02/correctness-model/tasks.json`,
      `versions/${RUN_ID}-i02/runs/${RUN_ID}-i02/cases/task-01/trace.json`,
      `versions/${RUN_ID}-i02/runs/${RUN_ID}-i02/judge/review-standing.json`,
      `observability/${RUN_ID}.jsonl`,
    ]) {
      expect(paths).not.toContain(absent);
    }
  });

  it("adds traces, the whole correctness model and Judge files at medium, and everything but binaries at verbose", () => {
    const runDir = fresh();
    syntheticRun(runDir);
    const medium = zipAt(runDir, "medium", join(runDir, "medium.zip"));
    expect(medium.code).toBe(0);
    expect(medium.paths).toContain("epochs/epoch-aaaa/builder-path-record.jsonl");
    expect(medium.paths).toContain("epochs/epoch-aaaa/trials/t1/census.json");
    expect(medium.paths).toContain(`versions/${RUN_ID}-i02/correctness-model/tasks.json`);
    expect(medium.paths).toContain(`versions/${RUN_ID}-i02/runs/${RUN_ID}-i02/cases/task-01/trace.json`);
    expect(medium.paths).toContain(`versions/${RUN_ID}-i02/runs/${RUN_ID}-i02/judge/review-standing.json`);
    expect(medium.paths).not.toContain(`observability/${RUN_ID}.jsonl`);
    expect(medium.paths).not.toContain(
      `versions/${RUN_ID}-i02/runs/${RUN_ID}-i02/cases/task-01/built-runtime.json`,
    );
    expect(medium.paths).not.toContain("epochs/epoch-aaaa/workspace/STARTER.md");

    const verbose = zipAt(runDir, "verbose", join(runDir, "verbose.zip"));
    expect(verbose.code).toBe(0);
    expect(verbose.paths).toContain(`observability/${RUN_ID}.jsonl`);
    expect(verbose.paths).toContain("controller/verifier-lifetime/p1/intent.json");
    expect(verbose.paths).toContain(
      `versions/${RUN_ID}-i02/runs/${RUN_ID}-i02/cases/task-01/built-runtime.json`,
    );
    expect(verbose.paths).toContain("epochs/epoch-aaaa/workspace/STARTER.md");
    expect(verbose.paths).toContain("transcripts/codex-sessions/rollout-1.jsonl");
    expect(verbose.paths).toContain("controller.sqlite");
    for (const absent of [
      "epochs/epoch-aaaa/workspace/.toolchain/bin/solver",
      "epochs/epoch-aaaa/workspace/.bundle-snapshots/s1/tasks.json",
      "epochs/epoch-aaaa/.oss/downloads/big.tar",
    ]) {
      expect(verbose.paths).not.toContain(absent);
    }
    expect(verbose.paths.some((p) => p.endsWith("auth.json"))).toBe(false);
    expect(verbose.manifest?.sourceCommit).toBe("deadbeef");
    expect(verbose.readme).toContain("## Guidelines for this bundle (verbose)");
    expect(verbose.readme).toContain("- observability:");
    expect(medium.readme).toContain("## Guidelines for this bundle (medium)");
    expect(verbose.manifest?.runId).toBe(RUN_ID);
    expect(Object.keys(verbose.manifest?.excluded ?? {}).some((k) => k.endsWith(":.toolchain"))).toBe(true);
  });

  it("fails a light bundle over its 2 MB cap and an explicit --max-mb cap, keeping the zip for inspection", () => {
    const runDir = fresh();
    const campaign = syntheticRun(runDir);
    // Incompressible bytes so the zip stays above 2 MB.
    const big = new Uint8Array(3 * 1024 * 1024);
    for (let offset = 0; offset < big.length; offset += 65536) {
      crypto.getRandomValues(big.subarray(offset, offset + 65536));
    }
    writeFileSync(join(campaign, "claims", "huge.json"), big);
    const light = zipAt(runDir, "light", join(runDir, "light.zip"));
    expect(light.code).toBe(1);
    expect(light.stderr).toContain("over the 2 MB cap");
    expect(existsSync(join(runDir, "light.zip"))).toBe(true);
    const capped = spawnSync(
      "bun",
      ["--no-env-file", script, runDir, "--medium", "--max-mb", "1", "--out", join(runDir, "m.zip")],
      { cwd: repoRoot },
    );
    expect(capped.status).toBe(1);
    expect(capped.stderr).toContain("over the 1 MB cap");
  });
});
