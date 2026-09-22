import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { runSync } from "../src/meta/subprocess.ts";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { REPO_ROOT, runTypeScript } from "../.claude/skills/system-path-simulation/scripts/test-support.mjs";

let scratch;
let prompt;
let env;
let worktrees;

function run(...args) {
  return runTypeScript("stage-run.mts", args);
}

/** The standard arguments; an override replaces the value of an option already present. */
function base(dir, ...extra) {
  const args = [
    "--source",
    "HEAD",
    "--dir",
    dir,
    "--modules-from",
    REPO_ROOT,
    "--env-from",
    env,
    "--condition",
    "sol",
    "--project",
    "stage-test",
    "--run",
    "stage-run",
    "--expected-tasks",
    "25",
    "--provider-turn-budget",
    "120",
    "--prompt-file",
    prompt,
  ];
  for (let i = 0; i < extra.length; i += 2) {
    const at = args.indexOf(extra[i]);
    if (extra[i + 1] === null) {
      if (at !== -1) args.splice(at, 2);
      continue;
    }
    if (at === -1) args.push(extra[i], extra[i + 1]);
    else args[at + 1] = extra[i + 1];
  }
  return args;
}

beforeEach(() => {
  mkdirSync(join(REPO_ROOT, ".scratch"), { recursive: true });
  scratch = mkdtempSync(join(REPO_ROOT, ".scratch", "stage-run-test-"));
  prompt = join(scratch, "one-liner.txt");
  writeFileSync(prompt, "Build a harness that writes firmware, where the code must compile.\n\n");
  env = join(scratch, "dot-env");
  writeFileSync(env, "EXAMPLE=1\n");
  worktrees = [];
});

afterEach(() => {
  for (const dir of worktrees) {
    runSync(["git", "-C", REPO_ROOT, "worktree", "remove", "--force", dir], { env: Bun.env });
  }
  runSync(["git", "-C", REPO_ROOT, "worktree", "prune"], { env: Bun.env });
  rmSync(scratch, { recursive: true, force: true });
});

describe("stage-run", () => {
  it("stages a detached worktree with a real node_modules, .env, backends and a pinned launcher", () => {
    const dir = join(scratch, "condition");
    worktrees.push(dir);
    const result = run(
      ...base(dir, "--max-iterations", "1", "--expected-tasks", "25", "--session-cap-ms", "600000"),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(lstatSync(join(dir, "node_modules")).isSymbolicLink()).toBe(false);
    expect(existsSync(join(dir, "node_modules", "@ana"))).toBe(true);
    expect(realpathSync(join(dir, "node_modules", "@ana", "agent-bundle")).startsWith(`${dir}/`)).toBe(true);
    expect(lstatSync(join(dir, ".env")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(dir, "domains"))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, ".harness", "backends", "stage-test.json"), "utf8"))).toEqual({
      builder: { kind: "codex" },
      built: { kind: "codex" },
      review: { kind: "codex" },
    });
    const launch = readFileSync(join(dir, "launch.sh"), "utf8");
    expect(launch).toContain("export CODEX_BUILDER_MODEL='gpt-5.6-sol'");
    expect(launch).toContain("export CODEX_REVIEW_REASONING_EFFORT='medium'");
    expect(launch).toContain("export HARNESS_BUILDER_SESSION_CAP_MS='600000'");
    expect(launch.split("\n").filter((line) => line.startsWith("unset "))).toEqual([]);
    expect(launch).toContain("exec bun src/run/full-run.ts");
    expect(launch).toContain("--project 'stage-test'");
    expect(launch).toContain("--run 'stage-run'");
    expect(launch).toContain("--expected-tasks '25'");
    expect(launch).toContain("--provider-turn-budget '120'");
    expect(launch).toContain("IFS= read -r -d '' __ana_prompt <");
    expect(launch).toContain(' --prompt "$__ana_prompt"');
    expect(launch).not.toContain("$(");
    expect(launch).not.toContain("--iteration-budget");
    expect(launch).not.toContain("--verifier-registry");
    expect(launch).not.toMatch(/^export .*luna/m);
    const condition = JSON.parse(readFileSync(join(dir, "condition.json"), "utf8"));
    expect(condition.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(condition.dependencyDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(condition.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(launch).toContain(`--expected-source '${condition.sourceCommit}:${condition.sourceDigest}'`);
    expect(condition.pins.CODEX_BUILT_REASONING_EFFORT).toBe("high");
    expect(condition.runId).toBe("stage-run");
    expect(condition.expectedTasks).toBe(25);
    expect(condition.providerTurnBudget).toBe(120);
    expect(condition.requestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(condition.commandDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(condition.pid).toBeNull();
    expect(condition.verifierRegistry).toBeUndefined();
    expect(condition.verifierRegistryDigest).toBeUndefined();
    expect(readFileSync(condition.promptFile)).toEqual(readFileSync(prompt));
    expect(existsSync(join(dir, "condition-manifest.json"))).toBe(false);
    const fakeBin = join(scratch, "fake-bin");
    const captured = join(scratch, "captured-argv");
    mkdirSync(fakeBin);
    const fakeBun = join(fakeBin, "bun");
    writeFileSync(fakeBun, `#!/bin/zsh\nprintf '%s\\0' "$@" > '${captured}'\n`, { mode: 0o755 });
    writeFileSync(join(dir, "launch.sh"), launch.replace("\nexec bun ", `\nexec '${fakeBun}' `), {
      mode: 0o755,
    });
    const launchResult = runSync(["zsh", join(dir, "launch.sh")], {
      cwd: dir,
      env: Bun.env,
    });
    expect(new TextDecoder().decode(launchResult.stderr)).toBe("");
    expect(launchResult.exitCode).toBe(0);
    const capturedArgs = new TextDecoder().decode(readFileSync(captured)).split("\0");
    capturedArgs.pop();
    expect(capturedArgs.at(-1)).toBe(new TextDecoder().decode(readFileSync(prompt)));
    expect(run("--opening", "--dir", dir).stderr).toContain("no controller directory yet");
  });

  it("checks a later opening against the staged condition", () => {
    const dir = join(scratch, "condition");
    worktrees.push(dir);
    expect(run(...base(dir)).exitCode).toBe(0);
    const condition = JSON.parse(readFileSync(join(dir, "condition.json"), "utf8"));
    const controller = join(dir, "campaigns", "stage-test", "controller", "stage-run");
    mkdirSync(controller, { recursive: true });
    const slots = (effort) => ({ kind: "codex", model: "gpt-5.6-sol", reasoningEffort: effort });
    writeFileSync(
      join(controller, "opening.json"),
      JSON.stringify({
        source: { commit: condition.sourceCommit, sourceDigest: condition.sourceDigest, dirty: false },
        runId: "stage-run",
        project: { id: "stage-test", requestDigest: condition.requestDigest },
        command: { name: "fullrun", digest: condition.commandDigest },
        epoch: { key: "epoch-1", supersedes: null },
        modelSlots: { builder: slots("high"), built: slots("high"), review: slots("medium") },
      }),
    );
    const ok = run("--opening", "--dir", dir);
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toContain("opening matches the staged condition");
    writeFileSync(
      join(controller, "opening.json"),
      JSON.stringify({
        source: { commit: condition.sourceCommit, sourceDigest: condition.sourceDigest },
        runId: "stage-run",
        project: { id: "stage-test", requestDigest: condition.requestDigest },
        command: { name: "fullrun", digest: condition.commandDigest },
        epoch: { key: "epoch-1", supersedes: null },
        modelSlots: { builder: slots("high"), built: slots("high"), review: slots("medium") },
      }),
    );
    const missingDirty = run("--opening", "--dir", dir);
    expect(missingDirty.exitCode).toBe(1);
    expect(missingDirty.stderr).toContain("source dirty must be false");
    writeFileSync(
      join(controller, "opening.json"),
      JSON.stringify({
        source: { commit: condition.sourceCommit, sourceDigest: condition.sourceDigest, dirty: null },
        runId: "stage-run",
        project: { id: "stage-test", requestDigest: condition.requestDigest },
        command: { name: "fullrun", digest: condition.commandDigest },
        epoch: { key: "epoch-1", supersedes: null },
        modelSlots: { builder: slots("high"), built: slots("high"), review: slots("medium") },
      }),
    );
    const nullDirty = run("--opening", "--dir", dir);
    expect(nullDirty.exitCode).toBe(1);
    expect(nullDirty.stderr).toContain("source dirty must be false");
    writeFileSync(
      join(controller, "opening.json"),
      JSON.stringify({
        source: { commit: condition.sourceCommit, sourceDigest: condition.sourceDigest, dirty: false },
        runId: "stage-run",
        project: { id: "stage-test", requestDigest: condition.requestDigest },
        command: { name: "fullrun", digest: condition.commandDigest },
        epoch: { key: "epoch-2", supersedes: "epoch-1" },
        modelSlots: { builder: slots("high"), built: slots("xhigh"), review: slots("medium") },
      }),
    );
    const drift = run("--opening", "--dir", dir);
    expect(drift.exitCode).toBe(1);
    expect(drift.stderr).toContain("built slot");
    expect(drift.stderr).toContain("xhigh");
  });

  it("passes an explicit fresh none budget but omits an absent budget", () => {
    const dir = join(scratch, "condition");
    worktrees.push(dir);
    expect(run(...base(dir, "--iteration-budget", "none")).exitCode).toBe(0);
    const launch = readFileSync(join(dir, "launch.sh"), "utf8");
    expect(launch).toContain("--iteration-budget 'none'");
    expect(JSON.parse(readFileSync(join(dir, "condition.json"), "utf8")).flags).toContain(
      "--iteration-budget 'none'",
    );
    const continuation = join(scratch, "continuation-condition");
    expect(
      run(
        ...base(
          continuation,
          "--seed-campaign",
          scratch,
          "--slug",
          "stage-test",
          "--iteration-budget",
          "none",
        ),
      ).stderr,
    ).toContain("valid only for a fresh condition");
  });

  it("checks the named run and request rather than the newest opening directory", () => {
    const dir = join(scratch, "condition");
    worktrees.push(dir);
    expect(run(...base(dir)).exitCode).toBe(0);
    const condition = JSON.parse(readFileSync(join(dir, "condition.json"), "utf8"));
    const controller = join(dir, "campaigns", "stage-test", "controller");
    const opening = (runId, requestDigest = condition.requestDigest) => ({
      source: { commit: condition.sourceCommit, sourceDigest: condition.sourceDigest, dirty: false },
      runId,
      project: { id: "stage-test", requestDigest },
      command: { name: "fullrun", digest: condition.commandDigest },
      epoch: { key: "epoch-1", supersedes: null },
      modelSlots: {
        builder: { kind: "codex", model: "gpt-5.6-sol", reasoningEffort: "high" },
        built: { kind: "codex", model: "gpt-5.6-sol", reasoningEffort: "high" },
        review: { kind: "codex", model: "gpt-5.6-sol", reasoningEffort: "medium" },
      },
    });
    mkdirSync(join(controller, "stage-run"), { recursive: true });
    mkdirSync(join(controller, "stage-runb"), { recursive: true });
    writeFileSync(join(controller, "stage-run", "opening.json"), JSON.stringify(opening("stage-run")));
    writeFileSync(
      join(controller, "stage-runb", "opening.json"),
      JSON.stringify(opening("stage-runb", "drifted")),
    );
    expect(run("--opening", "--dir", dir).exitCode).toBe(0);
    writeFileSync(
      join(controller, "stage-run", "opening.json"),
      JSON.stringify(opening("stage-run", "drifted")),
    );
    const drift = run("--opening", "--dir", dir);
    expect(drift.exitCode).toBe(1);
    expect(drift.stderr).toContain("request digest");
  });

  it("refuses the staging faults that broke earlier conditions before creating anything", () => {
    const dir = join(scratch, "condition");
    const fake = join(scratch, "fake-tree");
    mkdirSync(fake);
    symlinkSync(join(REPO_ROOT, "node_modules"), join(fake, "node_modules"));
    expect(run(...base(dir).map((arg) => (arg === REPO_ROOT ? fake : arg))).stderr).toContain("is a symlink");
    const mismatched = join(scratch, "mismatched-tree");
    mkdirSync(join(mismatched, "node_modules", "@ana"), { recursive: true });
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    manifest.dependencies = { ...manifest.dependencies, "not-installed": "1.0.0" };
    writeFileSync(join(mismatched, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(mismatched, "bun.lock"), readFileSync(join(REPO_ROOT, "bun.lock")));
    expect(run(...base(dir, "--modules-from", mismatched)).stderr).toContain("dependency identity");
    expect(run(...base(dir, "--env-from", join(scratch, "absent-env"))).stderr).toContain("does not exist");
    expect(run(...base(dir, "--condition", "luna")).stderr).toContain(
      "--condition must be one of sol, opus, fable",
    );
    expect(run(...base(dir, "--project", "Truss Sol")).stderr).toContain("lowercase slug");
    expect(run(...base(dir, "--max-iterations", "one")).stderr).toContain("canonical positive integer");
    const missingProviderBudget = base(dir);
    missingProviderBudget.splice(missingProviderBudget.indexOf("--provider-turn-budget"), 2);
    expect(run(...missingProviderBudget).stderr).toContain("--provider-turn-budget is required");
    expect(run(...base(dir, "--provider-turn-budget", "0")).stderr).toContain("canonical positive integer");
    expect(run(...base(dir, "--seed-campaign", scratch)).stderr).toContain("go together");
    expect(run(...base(dir, "--source", "no-such-revision-xyz")).stderr).toContain("cannot resolve");
    expect(existsSync(dir)).toBe(false);
    mkdirSync(dir);
    expect(run(...base(dir)).stderr).toContain("already exists");
  });

  it("never launches a prepared condition outside the SuperLoop authority envelope", () => {
    const dir = join(scratch, "paid-condition");
    const refused = run(...base(dir), "--launch");
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain("--launch is disabled");
    expect(refused.stderr).toContain("SuperLoop launch envelope");
    expect(existsSync(dir)).toBe(false);
  });
});
