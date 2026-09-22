import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { spawnTextSync as spawnSync } from "./helpers/bun-spawn-sync.ts";

const repoRoot = resolve(import.meta.dirname, "..");
const reviewScript = join(repoRoot, ".claude/skills/whole-run-investigation/scripts/trace-review.mjs");
const bunExecutable = Bun.argv[0];
const dirs: string[] = [];

if (bunExecutable === undefined) throw new Error("Bun executable is unavailable");
function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function sourceDigest(repo: string): string {
  const listed = spawnSync(
    "git",
    [
      "-C",
      repo,
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "src",
      "starters",
      "tools",
      "vendor",
      "package.json",
      "bun.lock",
      ".bun-version",
      "thresholds.frozen.yaml",
      "tsconfig.json",
    ],
    {},
  ).stdout;
  const paths = [...new Set(listed.split("\0").filter(Boolean))].sort();
  const hash = new Bun.CryptoHasher("sha256");
  for (const path of paths) {
    hash.update(`\0${path}\0`);
    try {
      hash.update(readFileSync(join(repo, path)));
    } catch {
      hash.update("<absent>");
    }
  }
  return hash.digest("hex");
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function fakeOutcomeRepo(source: string) {
  const root = temp("ana-review-");
  const repo = join(root, "repo");
  const campaign = join(root, "campaign");
  mkdirSync(join(repo, "tools/outcome"), { recursive: true });
  mkdirSync(join(campaign, "controller/44"), { recursive: true });
  writeFileSync(join(repo, "tools/outcome/cli.ts"), source);
  writeFileSync(join(repo, "package.json"), JSON.stringify({ engines: { bun: Bun.version } }));
  for (const args of [
    ["init", "-q"],
    ["config", "user.email", "test@example.com"],
    ["config", "user.name", "Test"],
  ]) {
    const result = spawnSync("git", ["-C", repo, ...args], {});
    if (result.status !== 0) throw new Error(result.stderr);
  }
  for (const args of [
    ["add", "."],
    ["commit", "-qm", "fixture"],
  ]) {
    const result = spawnSync("git", ["-C", repo, ...args], {});
    if (result.status !== 0) throw new Error(result.stderr);
  }
  const head = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], {}).stdout.trim();
  const digest = sourceDigest(repo);
  writeFileSync(
    join(campaign, "controller/44/opening.json"),
    JSON.stringify({ runId: "44", source: { commit: head, dirty: false, sourceDigest: digest } }),
  );
  return { repo, campaign, head };
}

describe("trace-review snapshot integrity", () => {
  it.concurrent("returns non-zero, records failed and empty views, and still samples task dossiers", () => {
    const { repo, campaign } = fakeOutcomeRepo(`
const args = process.argv.slice(2);
if (args.includes("--builder")) console.log(JSON.stringify({ schema: "builder" }));
else if (args.includes("--scan") || (args.length === 2 && args[1] === "44")) process.exit(7);
else if (args.includes("--scorecard")) process.exit(0);
else if (args.includes("--cases")) console.log(JSON.stringify({ cases: [{ taskId: "task-1" }] }));
else console.log(JSON.stringify({ taskId: "task-1" }));
`);
    const out = join(temp("ana-snapshot-"), "snapshot");
    const result = spawnSync(
      bunExecutable,
      [reviewScript, "--campaign", campaign, "--run", "44", "--repo", repo, "--out", out],
      {},
    );
    const manifest = parseJsonAs<{
      complete: boolean;
      views: { label: string; status: string; required?: boolean }[];
    }>(readFileSync(join(out, "snapshot-status.json"), "utf8"));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SNAPSHOT INCOMPLETE");
    expect(manifest.complete).toBe(false);
    expect(manifest.views).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "digest", status: "ok", runner: "in-process" }),
        expect.objectContaining({ label: "harness-evolution", status: "ok", runner: "in-process" }),
        expect.objectContaining({
          label: "review-yield",
          status: "ok",
          runner: "in-process",
          required: true,
        }),
        expect.objectContaining({ label: "44-default", status: "failed" }),
        expect.objectContaining({ label: "44-scorecard", status: "empty" }),
        expect.objectContaining({ label: "timeline", status: "unsupported" }),
        expect.objectContaining({ label: "44-case-task-1", status: "ok" }),
      ]),
    );
  }, 30_000);

  it.concurrent("collects through the one-line CLI and uses the direct Bun runner for every view", () => {
    const { repo, campaign } = fakeOutcomeRepo('console.log(JSON.stringify({ taskId: "task-1" }));\n');
    const opening = JSON.parse(readFileSync(join(campaign, "controller/44/opening.json"), "utf8"));
    writeFileSync(
      join(campaign, "controller/44/terminal.json"),
      JSON.stringify({ openingDigest: hashJsonValue(opening), iterations: [] }),
    );
    mkdirSync(join(campaign, "observability"));
    writeFileSync(
      join(campaign, "observability/44.jsonl"),
      JSON.stringify({
        schema: "ana-observation/v2",
        runId: "44",
        id: "44:1",
        seq: 1,
        type: "prompt-ingested",
        at: "2026-09-19T10:00:00.000Z",
        phase: "build",
        contract: "builder",
        role: "builder",
        chars: 12,
      }),
    );
    const out = join(temp("ana-snapshot-"), "snapshot");
    const result = spawnSync(
      Bun.argv[0]!,
      [
        "run",
        "review:collect",
        "--",
        "--campaign",
        campaign,
        "--run",
        "44",
        "--repo",
        repo,
        "--out",
        out,
        "--all",
        "--diagnostics",
      ],
      { cwd: repoRoot },
    );
    const manifest = parseJsonAs<{
      complete: boolean;
      views: { runner: string }[];
    }>(readFileSync(join(out, "snapshot-status.json"), "utf8"));
    expect(result.status).toBe(0);
    expect(manifest.complete).toBe(true);
    expect(
      JSON.parse(readFileSync(join(out, "diagnostic-lanes/tasks.json"), "utf8")).map(
        (task: { name: string }) => task.name,
      ),
    ).toEqual(["category_and_hook_yield", "diagnostic_follow_through"]);
    expect(
      readFileSync(join(out, "diagnostic-lanes/prompts/diagnostic_follow_through.md"), "utf8"),
    ).toContain("assignedDiagnosticInputs: scan,builder,review-yield");
    expect(
      parseJsonAs<{ state: string; phases: { phase: string }[] }>(
        readFileSync(join(out, "timeline.json"), "utf8"),
      ),
    ).toMatchObject({ state: "recorded", rows: 1, phases: [expect.objectContaining({ phase: "build" })] });
    expect(
      manifest.views
        .filter((view) => view.runner !== "in-process")
        .every((view) => view.runner === `${bunExecutable} --no-env-file`),
    ).toBe(true);
  }, 30_000);

  /** The parents block of the snapshot manifest, which the WRI prompt renders with `String()`. */
  function parentsOf(out: string) {
    return parseJsonAs<{
      facts: {
        terminalAccounting: {
          parents: {
            lastCandidate: string | null;
            adopted: string | null;
            accepted: string | null;
            source: string;
          };
        };
      };
    }>(readFileSync(join(out, "snapshot-status.json"), "utf8")).facts.terminalAccounting.parents;
  }

  it("reads the parent identities from the run's own scorecard", () => {
    // Four recorded runs published nulls here while their execution records held five to forty-nine
    // real submits. The scorecard resolves both parents; this manifest reads them.
    const { repo, campaign } = fakeOutcomeRepo(`
const args = process.argv.slice(2);
if (args.includes("--scorecard")) console.log(JSON.stringify({ reach: { parents: {
  lastCandidate: { commit: "cccccccccccccccc", epoch: "epoch-aa", ordinal: 7, writtenAt: "2026-08-25T02:00:00.000Z" },
  accepted: { commit: "aaaaaaaaaaaaaaaa", epoch: "epoch-aa", ordinal: 4, writtenAt: "2026-08-25T01:00:00.000Z" },
} } }));
else console.log(JSON.stringify({ taskId: "task-1" }));
`);
    const out = join(temp("ana-snapshot-"), "snapshot");
    const result = spawnSync(
      bunExecutable,
      [reviewScript, "--campaign", campaign, "--run", "44", "--repo", repo, "--out", out],
      {},
    );
    expect(result.status).toBe(0);
    const parents = parentsOf(out);
    expect(parents.lastCandidate).toBe(
      "cccccccccccc (epoch epoch-aa, submit #7, written 2026-08-25T02:00:00.000Z)",
    );
    expect(parents.accepted).toBe(
      "aaaaaaaaaaaa (epoch epoch-aa, submit #4, written 2026-08-25T01:00:00.000Z)",
    );
    // Adoption is not a submit row, so no reader supplies it. It stays absent rather than
    // borrowing the last candidate, which is a different identity.
    expect(parents.adopted).toBeNull();
    expect(parents.source).toContain("reach.parents");
  }, 30_000);

  it("states the parents unavailable when the run source's scorecard carries none", () => {
    // The hostile direction: an older run source whose scorecard has no reach.parents must read as
    // unavailable, not as a run that had no candidate.
    const { repo, campaign } = fakeOutcomeRepo(
      'console.log(JSON.stringify({ taskId: "task-1", reach: {} }));\n',
    );
    const out = join(temp("ana-snapshot-"), "snapshot");
    const result = spawnSync(
      bunExecutable,
      [reviewScript, "--campaign", campaign, "--run", "44", "--repo", repo, "--out", out],
      {},
    );
    expect(result.status).toBe(0);
    const parents = parentsOf(out);
    expect(parents.lastCandidate).toBeNull();
    expect(parents.accepted).toBeNull();
    expect(parents.source).toContain("unavailable");
  }, 30_000);
});
