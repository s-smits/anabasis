/**
 * Focused check for the zip-run skill script: the three levels select and exclude the named
 * groups on a synthetic run tree, launch.json's runId picks the campaign among copied ones, a
 * sibling run whose id starts with this one's contributes nothing, and --light reports its 2 MB cap.
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
const script = join(repoRoot, ".claude/skills/zip-run/scripts/zip-run.ts");
const RUN_ID = "custom-sol-20260101T000000000Z-abc123";
const SIBLING = `${RUN_ID}b`;
const OTHER_RUN_ID = "truss-sol-20250101T000000000Z-000000";
const COMMIT = "deadbeef".repeat(5);
const VERSION = `versions/${RUN_ID}-i02`;
const BATTERY = `${VERSION}/runs/${RUN_ID}-i02`;

interface Manifest {
  runId: string;
  sourceCommit: string | null;
  controllerError: string | null;
  batteries: string[];
  excluded: Record<string, string>;
}

function put(root: string, rel: string, content = "{}"): void {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function opening(runId: string, writtenAt: string): string {
  const source = { commit: COMMIT, dirty: false, sourceDigest: "0".repeat(64) };
  return JSON.stringify({ runId, writtenAt, source });
}

function syntheticRun(runDir: string): string {
  const campaign = join(runDir, "campaigns", "slug-a1b2c3d4");
  put(runDir, ".scratch/quick-run/launch.json", JSON.stringify({ runId: RUN_ID }));
  put(runDir, ".scratch/quick-run/fullrun.log", "log\n");
  put(runDir, ".scratch/quick-run/codex/auth.json", "secret");
  put(runDir, ".scratch/quick-run/codex/sessions/rollout-1.jsonl", "{}\n");
  // A copied campaign from another run must not be selected.
  put(
    runDir,
    `campaigns/copied-000000/controller/${OTHER_RUN_ID}/opening.json`,
    opening(OTHER_RUN_ID, "2025"),
  );
  put(campaign, `controller/${RUN_ID}/opening.json`, opening(RUN_ID, "2026-01-01T00:00:00.000Z"));
  put(campaign, `controller/${RUN_ID}/terminal.json`);
  put(campaign, `controller/${RUN_ID}/verifier-lifetime/p1/intent.json`);
  put(
    campaign,
    "epochs.json",
    JSON.stringify({ schema: "campaign-epochs/v1", epochs: [{ key: "epoch-aaaa" }] }),
  );
  put(campaign, "case-record.jsonl");
  put(campaign, "controller.sqlite");
  put(campaign, "claims/run-i02.json");
  put(campaign, "analysis/run-rebuild-advice.json");
  put(campaign, `safeguards/${RUN_ID}/SAFEGUARDS_LOG.txt`, "line\n");
  put(campaign, `observability/${RUN_ID}.jsonl`, "{}\n");
  put(campaign, "epoch-aaaa/builder-prose.jsonl");
  put(campaign, "epoch-aaaa/builder-path-record.jsonl");
  put(campaign, "epoch-aaaa/01-slug/iteration.json");
  put(campaign, "epoch-aaaa/trials/t1/census.json");
  put(campaign, "epoch-aaaa/workspace/STARTER.md", "# starter");
  put(campaign, "epoch-aaaa/workspace/.toolchain/bin/solver", "binary");
  put(campaign, "epoch-aaaa/workspace/.bundle-snapshots/s1/tasks.json");
  put(campaign, "epoch-aaaa/.oss/downloads/big.tar", "binary");
  put(campaign, `${VERSION}/version.json`);
  put(campaign, `${VERSION}/agent/tools.ts`, "export {};");
  put(campaign, `${VERSION}/correctness-model/evaluator.ts`, "export {};");
  put(campaign, `${VERSION}/correctness-model/tasks.json`);
  put(campaign, `${BATTERY}/battery.json`);
  put(campaign, `${BATTERY}/judge/review-standing.json`);
  put(campaign, `${BATTERY}/cases/task-01/case-result.json`);
  put(campaign, `${BATTERY}/cases/task-01/trace.json`);
  put(campaign, `${BATTERY}/cases/task-01/built-runtime.json`);
  // A sibling run sharing this id as a prefix: its version, its battery measured under this run's
  // version, and its safeguard log all stay out.
  put(campaign, `controller/${SIBLING}/opening.json`, opening(SIBLING, "2026-02-01T00:00:00.000Z"));
  put(campaign, `versions/${SIBLING}-i02/version.json`);
  put(campaign, `versions/${SIBLING}-i02/runs/${SIBLING}-i02/cases/task-01/case-result.json`);
  put(campaign, `${VERSION}/runs/${SIBLING}-i03/cases/task-01/case-result.json`);
  put(campaign, `safeguards/${SIBLING}/SAFEGUARDS_LOG.txt`, "line\n");
  return campaign;
}

function zipAt(target: string, level: string, out: string, ...extra: string[]) {
  const argv = ["--no-env-file", script, target, `--${level}`, "--out", out, ...extra];
  const result = spawnSync("bun", argv, { cwd: repoRoot });
  const extract = mkdtempSync(join(tmpdir(), "zip-run-extract-"));
  if (existsSync(out)) spawnSync("unzip", ["-q", out, "-d", extract], { cwd: repoRoot });
  const listing = existsSync(out) ? spawnSync("unzip", ["-Z1", out], { cwd: repoRoot }).stdout : "";
  const paths = listing
    .split("\n")
    .filter((line) => line !== "" && !line.endsWith("/"))
    .map((line) => line.split("/").slice(1).join("/"));
  const read = (name: string): string => {
    const path = join(extract, `${RUN_ID}-${level}`, name);
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  };
  const manifestText = read("MANIFEST.json");
  const manifest = manifestText === "" ? null : parseJsonAs<Manifest>(manifestText);
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    paths,
    manifest,
    readme: read("README.md"),
  };
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
    const { code, stderr, paths, readme, manifest } = zipAt(runDir, "light", join(runDir, "light.zip"));
    expect(stderr).toBe("");
    expect(code).toBe(0);
    for (const present of [
      `controller/${RUN_ID}/opening.json`,
      "launch/fullrun.log",
      `safeguards/${RUN_ID}/SAFEGUARDS_LOG.txt`,
      "epoch-aaaa/builder-prose.jsonl",
      `${VERSION}/correctness-model/evaluator.ts`,
      `${BATTERY}/cases/task-01/case-result.json`,
      "README.md",
      "MANIFEST.json",
    ]) {
      expect(paths).toContain(present);
    }
    expect(readme).toContain("## Guidelines for this bundle (light)");
    expect(manifest?.sourceCommit).toBe(COMMIT);
    // The strict reader refuses this synthetic terminal; the zip still ships and says why.
    expect(manifest?.controllerError).not.toBeNull();
    expect(paths.some((p) => p.includes(OTHER_RUN_ID))).toBe(false);
    for (const absent of [
      "epoch-aaaa/builder-path-record.jsonl",
      "epoch-aaaa/01-slug/iteration.json",
      `${VERSION}/correctness-model/tasks.json`,
      `${BATTERY}/cases/task-01/trace.json`,
      `${BATTERY}/judge/review-standing.json`,
      `observability/${RUN_ID}.jsonl`,
    ]) {
      expect(paths).not.toContain(absent);
    }
  });

  it("carries only this run's batteries, products and safeguard log, not a sibling's sharing its prefix", () => {
    const runDir = fresh();
    const campaign = syntheticRun(runDir);
    const { code, paths, manifest } = zipAt(campaign, "verbose", join(runDir, "v.zip"), "--run", RUN_ID);
    expect(code).toBe(0);
    expect(manifest?.runId).toBe(RUN_ID);
    expect(manifest?.batteries).toStrictEqual([BATTERY]);
    expect(paths).toContain(`${BATTERY}/cases/task-01/case-result.json`);
    expect(paths.some((p) => p.includes(SIBLING))).toBe(false);
    // Named by the campaign alone, the latest opening is the sibling's, which is what --run overrides.
    const latest = zipAt(campaign, "light", join(runDir, "s.zip"));
    expect(latest.stdout).toContain(`run ${SIBLING}`);
  });

  it("adds traces, the whole correctness model and Judge files at medium, and everything but binaries at verbose", () => {
    const runDir = fresh();
    syntheticRun(runDir);
    const medium = zipAt(runDir, "medium", join(runDir, "medium.zip"));
    expect(medium.code).toBe(0);
    for (const present of [
      "epoch-aaaa/builder-path-record.jsonl",
      "epoch-aaaa/01-slug/iteration.json",
      "epoch-aaaa/trials/t1/census.json",
      `${VERSION}/correctness-model/tasks.json`,
      `${BATTERY}/cases/task-01/trace.json`,
      `${BATTERY}/judge/review-standing.json`,
    ]) {
      expect(medium.paths).toContain(present);
    }
    expect(medium.paths).not.toContain(`observability/${RUN_ID}.jsonl`);
    expect(medium.paths).not.toContain(`${BATTERY}/cases/task-01/built-runtime.json`);
    expect(medium.paths).not.toContain("epoch-aaaa/workspace/STARTER.md");
    expect(medium.readme).toContain("## Guidelines for this bundle (medium)");

    const verbose = zipAt(runDir, "verbose", join(runDir, "verbose.zip"));
    expect(verbose.code).toBe(0);
    for (const present of [
      `observability/${RUN_ID}.jsonl`,
      `controller/${RUN_ID}/verifier-lifetime/p1/intent.json`,
      `${BATTERY}/cases/task-01/built-runtime.json`,
      "epoch-aaaa/workspace/STARTER.md",
      "transcripts/codex-sessions/rollout-1.jsonl",
      "controller.sqlite",
    ]) {
      expect(verbose.paths).toContain(present);
    }
    for (const absent of [
      "epoch-aaaa/workspace/.toolchain/bin/solver",
      "epoch-aaaa/workspace/.bundle-snapshots/s1/tasks.json",
      "epoch-aaaa/.oss/downloads/big.tar",
    ]) {
      expect(verbose.paths).not.toContain(absent);
    }
    expect(verbose.paths.some((p) => p.endsWith("auth.json"))).toBe(false);
    expect(verbose.readme).toContain("## Guidelines for this bundle (verbose)");
    expect(verbose.readme).toContain("- observability:");
    expect(Object.keys(verbose.manifest?.excluded ?? {}).some((k) => k.endsWith(":.toolchain"))).toBe(true);
  });

  it("refuses two levels at once, before anything is zipped", () => {
    const runDir = fresh();
    syntheticRun(runDir);
    const both = zipAt(runDir, "light", join(runDir, "x.zip"), "--medium");
    expect(both.code).toBe(2);
    expect(both.stderr).toContain("choose one of --light, --medium or --verbose");
    expect(existsSync(join(runDir, "x.zip"))).toBe(false);
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
    const capped = zipAt(runDir, "medium", join(runDir, "m.zip"), "--max-mb", "1");
    expect(capped.code).toBe(1);
    expect(capped.stderr).toContain("over the 1 MB cap");
  });
});
