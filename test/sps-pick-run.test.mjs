import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { runTextSyncOrThrow } from "../src/meta/subprocess.ts";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { REPO_ROOT, runTypeScript } from "../.claude/skills/system-path-simulation/scripts/test-support.mjs";

let scratch;
let notes;
let tree;
let head;
let parent;

function git(...args) {
  return runTextSyncOrThrow(["git", "-C", tree, ...args], { env: Bun.env }).trim();
}

function note(campaign, text, review) {
  mkdirSync(join(notes, campaign), { recursive: true });
  writeFileSync(join(notes, campaign, "main_synthesis.md"), text);
  writeFileSync(
    join(notes, campaign, "digest.md"),
    "# digest\n\nthe engine wall denied the compiler twice.\n",
  );
  if (review !== undefined) writeFileSync(join(notes, campaign, "review.json"), JSON.stringify(review));
}

beforeEach(() => {
  mkdirSync(join(REPO_ROOT, ".scratch"), { recursive: true });
  scratch = mkdtempSync(join(REPO_ROOT, ".scratch", "pick-run-test-"));
  notes = join(scratch, "runs");
  tree = join(scratch, "tree");
  mkdirSync(tree);
  git("init", "--quiet");
  git("config", "user.email", "simulation@example.invalid");
  git("config", "user.name", "Simulation Test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(tree, "a.txt"), "one\n");
  git("add", "a.txt");
  git("commit", "--quiet", "-m", "one");
  parent = git("rev-parse", "HEAD");
  writeFileSync(join(tree, "a.txt"), "two\n");
  git("commit", "--quiet", "-am", "two");
  head = git("rev-parse", "HEAD");

  note(
    "esp32-w41-opus",
    [
      "# Run w41 — esp32-w41-opus",
      "",
      `Reviewed 2026-08-20. Campaign \`esp32-w41-opus\`, runId \`run-w41\`, source`,
      `\`${parent}\` (clean), epoch \`epoch-ea77\`.`,
      "",
      "Opened 2026-08-19T23:07:13Z, terminal 2026-08-20T00:21:05Z, outcome `aborted`, terminalReason",
      "`aborted: fullrun received SIGTERM`. Sealed denominator `absent`: zero batteries, zero cases.",
      "",
      "## What stopped the run",
      "",
      "The engine wall denied the compiler its scratch directory.",
      "",
      "## Findings",
    ].join("\n"),
    { adjudication: "aborted-no-denominator", resultGroups: { kernelFixes: 1 } },
  );
  note(
    "truss-w30",
    [
      "# truss-w30",
      "",
      "## Identity",
      "",
      "| Field | Value |",
      "|---|---|",
      "| Source | `0123456789abcdef0123456789abcdef01234567`, clean |",
      "| Run | `fullrun-2026-08-17T01-44-30-740Z` |",
      "| Terminal | `candidate-held` |",
      "| Sealed denominator | 125 total, 125 verified, 0 unaccepted, 0 non-results |",
      "",
      "## Findings",
    ].join("\n"),
  );
  mkdirSync(join(notes, "no-synthesis"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("pick-run", () => {
  it("lists every reviewed run with source ancestry against the tree under test", () => {
    const result = runTypeScript("pick-run.mts", [
      "--tree",
      tree,
      "--notes",
      notes,
      "--component",
      "engine wall",
    ]);
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.split("\n");
    expect(lines[0]).toBe(`tree ${tree} (HEAD ${head.slice(0, 7)})`);
    expect(lines[1]).toBe(
      `2026-08-20 esp32-w41-opus: source ${parent.slice(0, 9)} ancestor, 1 commit(s) since; outcome aborted (aborted: fullrun received SIGTERM) hits(engine wall) 2`,
    );
    expect(lines[2]).toBe("  Sealed denominator `absent`: zero batteries, zero cases.");
    expect(lines[3]).toBe('  adjudication aborted-no-denominator {"kernelFixes":1}');
    expect(lines[4]).toBe(
      "2026-08-17 truss-w30: source 012345678 source unknown here; outcome candidate-held hits(engine wall) 1",
    );
    expect(lines[5]).toBe("  125 total, 125 verified, 0 unaccepted, 0 non-results");
    expect(result.stdout).not.toContain("no-synthesis");
  });

  it("separates an ancestor, a known non-ancestor and an unknown source", () => {
    note(
      "side-run",
      `# side\n\nReviewed 2026-08-21. Campaign \`side-run\`, runId \`run-side\`, source \`${head}\` (clean).\n`,
    );
    git("checkout", "--quiet", "-b", "other", parent);
    git("commit", "--quiet", "--allow-empty", "-m", "fork");
    const json = JSON.parse(
      runTypeScript("pick-run.mts", ["--tree", tree, "--notes", notes, "--json"]).stdout,
    );
    const byName = Object.fromEntries(json.runs.map((run) => [run.campaign, run]));
    expect(byName["esp32-w41-opus"].ancestor).toBe(true);
    expect(byName["esp32-w41-opus"].commitsSince).toBe(1);
    expect(byName["side-run"].ancestor).toBe(false);
    expect(byName["side-run"].commitsSince).toBeNull();
    expect(byName["side-run"].onMain).toBeNull();
    expect(byName["truss-w30"].ancestor).toBeNull();
    expect(json.runs.map((run) => run.campaign)).toEqual(["side-run", "esp32-w41-opus", "truss-w30"]);
  });

  it("reads the identity line in each shape the hand-written syntheses used", () => {
    note(
      "bullets",
      "# Whole-run synthesis: bullets\n\n- Campaign: `campaigns/bullets`\n- Run: `fullrun-2026-08-18T19-15-52-726Z`\n- Source: clean `3686037ee68f4a14ee9810385afcc449001a5e6a`, source digest `3abec4c7`\n- Terminal: completed operationally as `build-failed` / `environment-blocked`; no battery\n\n## Denominators\n\nVerified: absent. Unaccepted: absent.\n",
    );
    note(
      "prose",
      "# prose\n\nRun: `fullrun-2026-08-15T17-53-52-150Z`, campaign `prose`, source\n`ab9e782c` (clean). Terminal: `completed`. Denominators: 100 graded, 0 unaccepted, 0 non-results.\n",
    );
    note(
      "ended",
      "# ended\n\nRun `fullrun-2026-08-19T09-52-33-032Z`, source\n`61bb9a490`, ended on `candidate-held` with terminal `2026-08-19T11:10:00Z`.\n",
    );
    note(
      "review-only",
      "# review-only\n\nThe run completed, sealed 125 verified cases, and ended on `verifier-audit-required`.\n",
      { sourceRevision: "98d70d9f56dfb89e63a603d6c949595b00f71ddf" },
    );
    writeFileSync(
      join(notes, "review-only", "digest.md"),
      "# digest\n\nrun `fullrun-2026-08-18T05-36-03-591Z`\n",
    );
    const json = JSON.parse(
      runTypeScript("pick-run.mts", ["--tree", tree, "--notes", notes, "--json"]).stdout,
    );
    const byName = Object.fromEntries(json.runs.map((run) => [run.campaign, run]));
    expect([
      byName.bullets.reviewed,
      byName.bullets.source,
      byName.bullets.outcome,
      byName.bullets.denominator,
    ]).toEqual([
      "2026-08-18",
      "3686037ee68f4a14ee9810385afcc449001a5e6a",
      "build-failed",
      "Verified: absent",
    ]);
    expect([
      byName.prose.reviewed,
      byName.prose.source,
      byName.prose.outcome,
      byName.prose.denominator,
    ]).toEqual(["2026-08-15", "ab9e782c", "completed", "100 graded, 0 unaccepted, 0 non-results"]);
    expect([byName.ended.reviewed, byName.ended.source, byName.ended.outcome]).toEqual([
      "2026-08-19",
      "61bb9a490",
      "candidate-held",
    ]);
    expect([
      byName["review-only"].reviewed,
      byName["review-only"].source,
      byName["review-only"].outcome,
      byName["review-only"].denominator,
    ]).toEqual([
      "2026-08-18",
      "98d70d9f56dfb89e63a603d6c949595b00f71ddf",
      "verifier-audit-required",
      "125 verified cases",
    ]);
  });

  it("refuses a relative path, a missing notes directory and an unknown option", () => {
    expect(runTypeScript("pick-run.mts", ["--notes", "notes/runs"]).stderr).toContain("absolute");
    expect(runTypeScript("pick-run.mts", ["--notes", join(scratch, "absent")]).stderr).toContain(
      "does not exist",
    );
    expect(runTypeScript("pick-run.mts", ["--rank"]).stderr).toContain("unknown option");
  });
});
