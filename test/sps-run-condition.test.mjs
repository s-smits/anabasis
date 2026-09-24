import {
  copyFileSync,
  existsSync,
  symlinkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  descendantsOf,
  parseProcessTable,
} from "../.claude/skills/system-path-simulation/scripts/process-census.mts";
import { REPO_ROOT, runTypeScript } from "../.claude/skills/system-path-simulation/scripts/test-support.mjs";

/** The controller needs the frozen thresholds beside its campaigns; the fixture battery sits at the
 *  selector's floor, `max(policy floor, minLevelN)`, which is six on the repository manifest. */
const TASKS = 6;
const SLUG = "sim-run-condition";

let scratch;
let out;
let turnModule;
let solverModule;
let promptFile;

function run(args) {
  return runTypeScript("run-condition.mts", args);
}

/** The strict parser admits each option once, so overrides replace the default value. */
function base(overrides = {}) {
  const options = {
    "--root": scratch,
    "--project": SLUG,
    "--prompt-file": promptFile,
    "--run": "c1",
    "--expected-tasks": String(TASKS),
    "--provider-turn-budget": "15",
    "--max-iterations": "1",
    "--out": out,
    "--builder": turnModule,
    "--built": solverModule,
    "--review": "off",
    ...overrides,
  };
  return [...Object.entries(options).flat(), "--allow-dirty"];
}

beforeEach(() => {
  mkdirSync(join(REPO_ROOT, ".scratch"), { recursive: true });
  scratch = mkdtempSync(join(REPO_ROOT, ".scratch", "run-condition-test-"));
  copyFileSync(join(REPO_ROOT, "thresholds.frozen.yaml"), join(scratch, "thresholds.frozen.yaml"));
  mkdirSync(join(scratch, "campaigns", SLUG), { recursive: true });
  out = join(scratch, "report");
  promptFile = join(scratch, "one-liner.txt");
  writeFileSync(promptFile, "Build a harness that uppercases letters.\n");
  turnModule = join(scratch, "turn.mts");
  writeFileSync(
    turnModule,
    `import { uppercaseFixture } from ${JSON.stringify(join(REPO_ROOT, "test/helpers/uppercase-fixture.ts"))};
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export async function turn(ctx) {
  uppercaseFixture(ctx.workspace);
  const inputs = ["a", "ab", "c", "cd", "e", "ef"];
  writeFileSync(join(ctx.workspace, "correctness-model/tasks.json"), JSON.stringify(inputs.map((input, index) => ({
    taskId: "t" + index, family: index < 3 ? "first" : "second", intendedFeatures: { hiddenChecks: { min: 0, max: 0 } },
    publicInput: { input, length: input.length }, difficultyAxisPath: "$.length", hidden: [] }))));
  writeFileSync(join(ctx.workspace, "correctness-model/controls.json"), JSON.stringify({
    accept: Array.from({ length: 25 }, (_, i) => ({ id: "accept-" + i, taskId: "t" + (i % inputs.length), artifact: { answer: inputs[i % inputs.length].toUpperCase() } })),
    reject: Array.from({ length: 25 }, (_, i) => ({ id: "reject-" + i, taskId: "t" + (i % inputs.length), artifact: { answer: "" }, mutationClass: "hollow", expectedCheckId: "answer" })),
  }));
  await ctx.call("submit", {});
  return "submitted";
}
`,
  );
  solverModule = join(scratch, "solver.mts");
  writeFileSync(
    solverModule,
    `import { scriptedUppercaseSolver } from ${JSON.stringify(join(REPO_ROOT, "test/helpers/uppercase-fixture.ts"))};
export const solver = scriptedUppercaseSolver();
`,
  );
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("run-condition preflight", () => {
  it("refuses an unknown option before any write", () => {
    const result = run([...base(), "--effort", "high"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('unknown option "--effort"');
    expect(existsSync(out)).toBe(false);
  });

  it("refuses a campaign nobody seeded", () => {
    const result = run(base({ "--project": "sim-nobody-seeded" }));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("seed the campaign first");
    expect(existsSync(out)).toBe(false);
  });

  it("refuses a builder module without a turn export", () => {
    writeFileSync(turnModule, "export const notATurn = 1;\n");
    const result = run(base());
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('must export "turn"');
    expect(existsSync(join(scratch, "campaigns", SLUG, ".controller.lock"))).toBe(false);
    expect(existsSync(join(scratch, "campaigns", "projects.json"))).toBe(false);
  });

  it("refuses an existing report and a live actor without a wall", () => {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "report.json"), "{}");
    expect(run(base()).stderr).toContain("already exists");
    rmSync(out, { recursive: true, force: true });
    const live = run(base({ "--builder": "live" }));
    expect(live.exitCode).toBe(2);
    expect(live.stderr).toContain("--builder live needs --wall-ms");
  });

  it("refuses a relative report path", () => {
    const result = run(base({ "--out": "relative/report" }));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--out must be an absolute path");
  });
});

describe("run-condition through the real controller", () => {
  it("runs one scripted build, measure and analyse round and records it", () => {
    const result = run([...base(), "--json"]);
    expect(result.exitCode).toBe(3);
    const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    expect(report.schema).toBe("simulation-condition-report/v1");
    expect(report.result).toBe("completed");
    expect(report.slots).toEqual({
      builder: { mode: "scripted", module: turnModule },
      built: { mode: "scripted", module: solverModule, isolation: "scripted" },
      review: "off",
    });
    expect(report.outcome.rounds).toHaveLength(1);
    const [round] = report.outcome.rounds;
    expect(round.move).toBe("build");
    expect(round.build).toBe("adopted");
    expect(round.measured).toBe(true);
    expect(round.terminal).toContain("operator-interrupted: round cap 1");
    expect(report.firstBuilderPrompt.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.firstBuilderPrompt.turn).toBe(1);
    expect(report.controller.state).toBe("recorded");
    expect(report.sampledDescendants.sampled).toBe(true);
    expect(report.wall).toEqual({ ms: null, reached: false });
    const battery = join(
      scratch,
      "campaigns",
      SLUG,
      "versions",
      round.runId,
      "runs",
      round.runId,
      "battery.json",
    );
    expect(existsSync(battery)).toBe(true);
    const cases = JSON.parse(readFileSync(battery, "utf8")).cases;
    expect(cases).toHaveLength(TASKS);
    expect(cases.every((row) => row.pass === true)).toBe(true);
    expect(JSON.parse(result.stdout).result).toBe("completed");
  });

  it("captures the production first prompt and stops before any provider turn", () => {
    // Production composition derives the Builder's read contract from the source tree's vendor
    // barrels, so the scratch root carries the tree's own source beside its campaigns.
    for (const dir of ["vendor", "src"]) symlinkSync(join(REPO_ROOT, dir), join(scratch, dir));
    const result = run(base({ "--builder": "capture" }));
    expect(result.exitCode).toBe(0);
    const capture = JSON.parse(readFileSync(join(out, "capture.json"), "utf8"));
    expect(capture.toolNames).toContain("submit");
    expect(capture.toolNames).toContain("correctness_check");
    // The production mount, not a substitute roster: the research and workshop tools and the
    // backend's own search capability are part of the captured condition.
    expect(capture.toolNames).toEqual(expect.arrayContaining(["public_source", "verifier_workshop"]));
    // The Builder searches wherever its transport can; the openrouter route carries no search tool.
    expect(capture.webSearch).toBe(capture.backend !== "openrouter");
    expect(capture.firstPromptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(capture.systemPromptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(out, "captured-first-prompt.txt"), "utf8")).toContain("USER REQUEST");
    const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    expect(report.result).toBe("captured");
    expect(report.firstBuilderPrompt.sha256).toBe(capture.firstPromptSha256);
    expect(report.outcome).toBeNull();
    expect(result.stderr).toContain("result      captured");
    expect(existsSync(join(scratch, "campaigns", SLUG, "versions"))).toBe(false);
  });
});

describe("process census", () => {
  it("parses ps rows and walks descendants transitively", () => {
    const rows = parseProcessTable(
      [
        "  PID  PPID                  STARTED COMMAND",
        "    1     0 Thu Sep 11 00:00:00 2026 /sbin/launchd",
        "  100     1 Thu Sep 11 00:00:01 2026 bun runner",
        "  101   100 Thu Sep 11 00:00:02 2026 bun child",
        "  102   101 Thu Sep 11 00:00:03 2026 cc grandchild",
        "  200     1 Thu Sep 11 00:00:04 2026 unrelated",
        "garbage line",
      ].join("\n"),
    );
    expect(rows).toHaveLength(5);
    expect(descendantsOf(rows, 100).map((row) => row.pid)).toEqual([101, 102]);
    expect(descendantsOf(rows, 200)).toEqual([]);
  });
});
