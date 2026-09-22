import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { REPO_ROOT, runTypeScript } from "../.claude/skills/system-path-simulation/scripts/test-support.mjs";

const SCRIPT = "../../model-condition-comparison/scripts/compare-conditions.mts";
const TASK_SET = "2eef7876b51eacf50ae96ec245ef217cbfeb61547419f0f51d98cd2d9bbc0a2a";
const GRADER = "5904ef8011351a3eeacef38cb39c71243cb1cd0834b6c62336693b09f15812ff";
const AGENT = "a5307d5be7ff5fd92e00f5c19e2e62e279686ab271326c3aa8aec1617553c9ae";

let scratch;

function run(...args) {
  return runTypeScript(SCRIPT, args);
}

function caseRow(taskId, family, outcome, solver = { turns: 2, toolCalls: 7, errors: [] }) {
  const outcomes = {
    pass: {
      acceptedSubmit: true,
      truthOk: true,
      pass: true,
      runtimeNonResult: null,
      runtimeNonResultKind: null,
    },
    fail: {
      acceptedSubmit: true,
      truthOk: false,
      pass: false,
      runtimeNonResult: null,
      runtimeNonResultKind: null,
    },
    unaccepted: {
      acceptedSubmit: false,
      truthOk: null,
      pass: null,
      runtimeNonResult: null,
      runtimeNonResultKind: null,
    },
    "non-result": {
      acceptedSubmit: false,
      truthOk: null,
      pass: null,
      runtimeNonResult: "provider: rate limited",
      runtimeNonResultKind: "provider",
    },
  };
  return { taskId, family, ...outcomes[outcome], solver };
}

function battery(runId, backendPin, cases, overrides = {}) {
  return {
    runId,
    slug: "demo",
    backendPin,
    thresholdManifestDigest: "0f0f0f0f0f0f0f0f",
    terminalReason: "complete",
    condition: { variant: "shipping", advisorsRemoved: [], toolInterfaceHash: null },
    bundleSnapshot: { agentHash: AGENT, graderHash: GRADER, taskSetHash: TASK_SET, ...overrides },
    cases,
  };
}

function writeBattery(relative, value) {
  const path = join(scratch, relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
  return path;
}

const OPUS_CASES = [
  caseRow("alpha-01", "alpha", "pass"),
  caseRow("alpha-02", "alpha", "fail"),
  caseRow("beta-01", "beta", "pass"),
  caseRow("beta-02", "beta", "unaccepted"),
  caseRow("gamma-01", "gamma", "non-result", { turns: null, toolCalls: null, errors: [] }),
];

const FABLE_CASES = [
  caseRow("alpha-01", "alpha", "pass"),
  caseRow("alpha-02", "alpha", "pass"),
  caseRow("beta-01", "beta", "fail"),
  caseRow("beta-02", "beta", "fail"),
  caseRow("gamma-01", "gamma", "pass"),
];

beforeEach(() => {
  mkdirSync(join(REPO_ROOT, ".scratch"), { recursive: true });
  scratch = mkdtempSync(join(REPO_ROOT, ".scratch", "compare-conditions-test-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("compare-conditions", () => {
  it("joins two conditions on one recorded battery and reports the three denominators", () => {
    const opus = writeBattery("opus/battery.json", battery("run-a", "claude/claude-opus-5", OPUS_CASES));
    // The fable condition is looked up by campaignDir::runId under the candidates root.
    const campaign = join(scratch, "fable", "campaigns", "demo");
    writeBattery(
      "fable/campaigns/demo/candidates/i01/runs/run-b/battery.json",
      battery("run-b", "claude/claude-fable-5-1", FABLE_CASES),
    );
    const result = run("--condition", `opus=${opus}`, "--condition", `fable=${campaign}::run-b`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Comparability: paired-same-harness");
    // opus: 3 verified (2 pass, 1 fail), 1 unaccepted, 1 non-result.
    expect(result.stdout).toContain("| opus | 3 | 2 | 66.7% |");
    expect(result.stdout).toContain("| 1 | 1 | 2.0 | 7.0 | 0 |");
    expect(result.stdout).toContain("opus: non-result kinds provider ×1");
    // fable: 5 verified (3 pass), no unaccepted, no non-result.
    expect(result.stdout).toContain("| fable | 5 | 3 | 60.0% |");
    expect(result.stdout).toContain("| beta | 1/1 (1, 0) | 0/2 (0, 0) |");
    // Buckets are read against the first condition; gamma-01 is unresolved because opus has a non-result there.
    expect(result.stdout).toContain("only fable passes (1): alpha-02");
    expect(result.stdout).toContain("only opus passes (1): beta-01");
    expect(result.stdout).toContain("both pass (1), both fail (1): beta-02");
    expect(result.stdout).toContain(
      "unresolved, a non-result or an absent task on either side (1): gamma-01",
    );
    expect(result.stdout).toContain("sign test z = 0.00; does not clear 1.96");
    const json = run("--condition", `opus=${opus}`, "--condition", `fable=${campaign}::run-b`, "--json");
    expect(json.exitCode).toBe(0);
    const parsed = JSON.parse(json.stdout);
    expect(parsed.schema).toBe("model-condition-comparison/v1");
    expect(parsed.conditions[0].census).toMatchObject({
      verified: 3,
      passed: 2,
      unaccepted: 1,
      nonResult: 1,
    });
    expect(parsed.pairs[0]).toMatchObject({
      otherPasses: ["alpha-02"],
      referencePasses: ["beta-01"],
      signZ: 0,
    });
  });

  it("withholds task buckets when the task sets differ, and refuses a repeated label", () => {
    const opus = writeBattery("opus/battery.json", battery("run-a", "claude/claude-opus-5", OPUS_CASES));
    const other = writeBattery(
      "other/battery.json",
      battery("run-c", "codex/gpt-5.6-sol", FABLE_CASES, { taskSetHash: "ffff".repeat(16) }),
    );
    const result = run("--condition", `opus=${opus}`, "--condition", `sol=${other}`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Comparability: not-comparable");
    expect(result.stdout).toContain("task-set hashes differ");
    expect(result.stdout).not.toContain("only sol passes");
    expect(result.stdout).toContain("Task-level buckets are withheld");
    const repeated = run("--condition", `opus=${opus}`, "--condition", `opus=${other}`);
    expect(repeated.exitCode).toBe(2);
    expect(repeated.stderr).toContain("label opus is used twice");
    const missing = run(
      "--condition",
      `opus=${opus}`,
      "--condition",
      `sol=${join(scratch, "nowhere")}::run-z`,
    );
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain("no battery.json under candidates, contest or domains");
  });
});
