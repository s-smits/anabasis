import { runSync } from "../src/meta/subprocess.ts";
import {
  existsSync,
  readFileSync,
  readlinkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { REPO_ROOT, runTypeScript } from "../.claude/skills/system-path-simulation/scripts/test-support.mjs";

let scratch;
let prompt;
const PREFLIGHT_PASSED = "preflight passed; --check stops before the session opens";
const outsideRoots = [];

function run(args) {
  return runTypeScript("run-segment.mts", args);
}

/** Every preflight case stops at `--check`, so a refusal that regresses ends there instead of
 *  reaching a credential or a provider. */
function base(...extra) {
  return [
    "--check",
    "--step",
    `builder:${prompt}`,
    "--effort",
    "high",
    "--campaign-dir",
    join(scratch, "campaign"),
    ...extra,
  ];
}

beforeEach(() => {
  mkdirSync(join(REPO_ROOT, ".scratch"), { recursive: true });
  scratch = mkdtempSync(join(REPO_ROOT, ".scratch", "simulation-segment-test-"));
  prompt = join(scratch, "prompt.txt");
  writeFileSync(prompt, "Inspect the selected transition.\n");
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
  for (const root of outsideRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("run-segment preflight", () => {
  it("requires at least one step", () => {
    const result = run([]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("pass at least one --step");
  });

  it("refuses an unknown checkpoint role", () => {
    const result = run(["--step", `oracle:${prompt}`]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('step role "oracle" is not a checkpoint');
  });

  it.each(["0", "-1", "1.5", "many"])("refuses step allowance %s", (turns) => {
    const result = run(["--step", `builder:${prompt}@${turns}`]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("step turn allowance must be a positive integer");
  });

  it("keeps an @ character inside an ordinary prompt filename", () => {
    const atPath = join(scratch, "prompt@draft.txt");
    writeFileSync(atPath, "draft prompt\n");
    const result = run(["--step", `builder:${atPath}`, "--backend", "invalid"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--backend must be one of");
    expect(result.stderr).not.toContain("step turn allowance");
  });

  it("accepts --step=<value> syntax before the next required-field refusal", () => {
    const result = run([`--step=builder:${prompt}@1`]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--effort is required");
  });

  it("refuses a missing step value by name", () => {
    const result = run(["--step"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('option "--step" needs a value');
  });

  it("refuses an absent prompt file without a raw stack", () => {
    const result = run(["--step", `builder:${join(scratch, "absent.txt")}`]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("step prompt file does not exist");
    expect(result.stderr).not.toContain("node:fs");
  });

  it("refuses an empty prompt file", () => {
    writeFileSync(prompt, " \n");
    const result = run(["--step", `builder:${prompt}`]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("step prompt file is empty");
  });

  it("requires effort before any backend opens", () => {
    const result = run(["--step", `builder:${prompt}`]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--effort is required");
  });

  it("requires a campaign directory", () => {
    const result = run(["--step", `builder:${prompt}`, "--effort", "high"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--campaign-dir is required");
  });

  it("refuses an invalid backend", () => {
    const result = run(base("--backend", "invalid"));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--backend must be one of claude, codex, openrouter");
  });

  it("refuses a relative campaign directory", () => {
    const result = run([
      "--step",
      `builder:${prompt}`,
      "--effort",
      "high",
      "--campaign-dir",
      ".scratch/relative-campaign",
      "--backend",
      "openrouter",
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--campaign-dir must be an absolute path");
  });

  it("refuses a campaign outside the run tree", () => {
    const result = run([
      "--step",
      `builder:${prompt}`,
      "--effort",
      "high",
      "--campaign-dir",
      "/tmp/outside-simulation-campaign",
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("must sit inside the run tree");
  });

  it("refuses a live campaign path instead of relying on prose", () => {
    const result = run([
      "--step",
      `builder:${prompt}`,
      "--effort",
      "high",
      "--campaign-dir",
      join(REPO_ROOT, "campaigns", "live", "epoch"),
      "--backend",
      "openrouter",
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("must sit under the run tree's .scratch directory");
  });

  it("refuses a lexical scratch path that escapes through a symlink", () => {
    const outside = mkdtempSync(join(tmpdir(), "simulation-segment-escape-"));
    outsideRoots.push(outside);
    symlinkSync(outside, join(scratch, "escape"));
    const result = run([
      "--step",
      `builder:${prompt}`,
      "--effort",
      "high",
      "--campaign-dir",
      join(scratch, "escape", "campaign"),
      "--backend",
      "openrouter",
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("resolves outside the run tree's .scratch directory");
  });

  it.each(["0", "16", "1.5", "many"])("refuses total budget %s", (turns) => {
    const result = run(base("--max-builder-turns", turns));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--max-builder-turns must be an integer from 1 through 15");
  });

  it("accepts the 15-turn boundary", () => {
    const result = run(base("--max-builder-turns", "15", "--backend", "openrouter"));
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(PREFLIGHT_PASSED);
    expect(result.stderr).not.toContain("--max-builder-turns must be");
  });

  it.each(["0", "-1", "1.5", "many"])("refuses timeout %s", (timeout) => {
    const result = run(base("--timeout-ms", timeout, "--backend", "openrouter"));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--timeout-ms must be a positive integer");
  });

  it("accepts a one-millisecond timeout as a positive integer", () => {
    const result = run(base("--timeout-ms", "1", "--backend", "openrouter"));
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(PREFLIGHT_PASSED);
    expect(result.stderr).not.toContain("--timeout-ms must be");
  });

  it("refuses predictions a segment can never reach before any backend opens", () => {
    // The 15 September census condition: three predictions about correctness_check and the census,
    // run through a segment that mounts no gate, spent 78 minutes before resolving all three untriggered.
    const note = join(scratch, "predictions.md");
    writeFileSync(
      note,
      "P1 — within five turns the Builder runs correctness_check or submit.\nP2 — the census finishes inside its wall.\n\n## Resolutions\n",
    );
    const refused = run(base("--predictions", note, "--backend", "openrouter"));
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain(
      'a controller gate ("correctness_check"), the control census ("census")',
    );
    expect(refused.stderr).toContain("run-condition.mts");
    expect(refused.stderr).not.toContain(PREFLIGHT_PASSED);
    const kept = run(
      base(
        "--predictions",
        note,
        "--accept-unreachable",
        "the absence is the question",
        "--backend",
        "openrouter",
      ),
    );
    expect(kept.stderr).not.toContain("which a segment never runs");
    // An authoring question passes, and a gate named only below the resolutions heading is not read.
    writeFileSync(
      note,
      "P1 — the Builder edits the brief before the tools.\n\n## Resolutions\n- P1: refuted — it ran correctness_check first\n",
    );
    const authoring = run(base("--predictions", note, "--backend", "openrouter"));
    expect(authoring.exitCode).toBe(0);
    expect(authoring.stderr).toContain(PREFLIGHT_PASSED);
  });

  it("refuses a missing seed directory", () => {
    const result = run(base("--seed-dir", join(scratch, "absent-seed")));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--seed-dir does not exist");
  });

  it("refuses an existing workspace so one condition cannot inherit another", () => {
    const campaign = join(scratch, "campaign");
    mkdirSync(join(campaign, "workspace"), { recursive: true });
    writeFileSync(join(campaign, "workspace", "stale.txt"), "stale condition\n");
    const result = run(base("--backend", "openrouter"));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("workspace already exists and is not empty");
  });

  it("refuses inherited campaign state outside an empty workspace", () => {
    const campaign = join(scratch, "campaign");
    mkdirSync(join(campaign, "workspace"), { recursive: true });
    mkdirSync(join(campaign, ".oss"));
    writeFileSync(join(campaign, ".oss", "prior.txt"), "prior condition\n");
    const result = run(base("--backend", "openrouter"));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--campaign-dir already contains prior condition state (.oss)");
  });

  it("refuses a campaign path that is a file with a typed message", () => {
    const campaign = join(scratch, "campaign");
    writeFileSync(campaign, "not a directory\n");
    const result = run(base("--backend", "openrouter"));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--campaign-dir exists and is not a directory");
    expect(result.stderr).not.toContain("node:fs");
  });

  it("refuses a campaign symlink even when its target remains inside scratch", () => {
    const target = join(scratch, "target");
    mkdirSync(target);
    symlinkSync(target, join(scratch, "campaign"));
    const result = run(base("--backend", "openrouter"));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--campaign-dir must be a real scratch directory, not a symlink");
  });

  it("refuses an empty workspace symlink", () => {
    const campaign = join(scratch, "campaign");
    const outside = mkdtempSync(join(tmpdir(), "simulation-workspace-link-"));
    outsideRoots.push(outside);
    mkdirSync(campaign, { recursive: true });
    symlinkSync(outside, join(campaign, "workspace"));
    const result = run(base("--backend", "openrouter"));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "workspace must be a real directory inside the scratch condition, not a symlink",
    );
  });

  it("stops a tool-bearing OpenRouter segment at --check before provider work", () => {
    const result = run(base("--backend", "openrouter"));
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(PREFLIGHT_PASSED);
  });
});

describe("run-segment argument refusals", () => {
  it("refuses an unknown option", () => {
    const result = run(base("--modle", "typo", "--backend", "invalid"));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('unknown option "--modle"');
  });

  it("refuses duplicate singleton options", () => {
    const result = run(base("--effort", "low", "--backend", "invalid"));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('option "--effort" may be passed only once');
  });

  it("refuses a value after a boolean flag", () => {
    const result = run(base("--no-tools", "false", "--backend", "invalid"));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('unexpected positional argument "false"');
  });

  it.each(["predictions", "continue-file", "handover"])("refuses --%s without a value", (option) => {
    const result = run(base(`--${option}`, "--backend", "openrouter"));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(`option "--${option}" needs a value`);
  });
});

it("joins the real segment mount, slot and host session projection before provider open", () => {
  const marker = join(scratch, "provider-input.json");
  const preload = join(scratch, "provider-stop.mts");
  writeFileSync(
    preload,
    `
    import { mock } from "bun:test";
    import { writeFileSync } from "node:fs";
    const path = ${JSON.stringify(join(REPO_ROOT, "src/backends/pi-session.ts"))};
    const original = await import(path);
    const text = (result) => result.content.map((part) => part.text ?? "").join("");
    mock.module(path, () => ({ ...original, async openHostSession(input) {
      writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ constructed: true }));
      const read = input.tools.find((tool) => tool.name === "read");
      const publicRead = read ? text(await read.execute("r1", { path: ${JSON.stringify(join(REPO_ROOT, "vendor/correctness-model-bundle/index.ts"))} })) : null;
      const protectedRead = read ? await read.execute("r2", { path: ${JSON.stringify(join(REPO_ROOT, "src/verify/host.ts"))} }).then(text, String) : null;
      writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ transport: input.slot.profile.transport, cwd: input.cwd, toolNames: input.tools.map((tool) => tool.name), publicRead, protectedRead, systemPrompt: input.systemPrompt }));
      throw new Error("simulation-provider-stop");
    } }));
  `,
  );
  const systemFile = join(scratch, "system.txt");
  writeFileSync(systemFile, "Captured system bytes.\n");
  // A `git archive` export: product bytes, a stale starter reference and no history. initWorkspace must
  // not lay the skeleton over it; the seed gets a root commit and its product bytes are verified.
  const seed = join(scratch, "seed");
  mkdirSync(join(seed, ".toolchain", "lib"), { recursive: true });
  mkdirSync(join(seed, "correctness-model"), { recursive: true });
  writeFileSync(join(seed, ".toolchain", "lib", "plugin.so"), "owned tool fixture");
  symlinkSync("plugin.so", join(seed, ".toolchain", "lib", "plugin-current.so"));
  writeFileSync(join(seed, "correctness-model", "tasks.json"), '[{"taskId":"seeded-01"}]\n');
  writeFileSync(join(seed, "STARTER.md"), "stale starter copy\n");
  // A seed that already carries history keeps it: no second root, no rewrite.
  const seedWithHistory = join(scratch, "seed-history");
  mkdirSync(join(seedWithHistory, "agent"), { recursive: true });
  writeFileSync(join(seedWithHistory, "agent", "tools.ts"), "export const tools = [];\n");
  for (const args of [
    ["init", "-q"],
    ["add", "-A"],
    ["commit", "-q", "-m", "fixture: own history"],
  ]) {
    const git = runSync(
      [
        "git",
        "-C",
        seedWithHistory,
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@ana.local",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { env: Bun.env },
    );
    if (git.exitCode !== 0) throw new Error(git.stderr.toString());
  }
  const rootSubject = (dir) =>
    runSync(["git", "-C", dir, "log", "--reverse", "--format=%s"], { env: Bun.env })
      .stdout.toString()
      .split("\n")[0];
  const extraFlags = {
    "no-tools": ["--no-tools", "--timeout-ms", "60000"],
    system: ["--system-file", systemFile],
    "invalid-system": ["--system-file", "relative.txt"],
  };
  for (const mode of ["tools", "no-tools", "system", "invalid-system"]) {
    if (existsSync(marker)) rmSync(marker);
    const extra = extraFlags[mode] ?? [];
    const seedFor = mode === "system" ? seedWithHistory : seed;
    const result = runSync(
      [
        Bun.argv[0],
        "--preload",
        preload,
        join(REPO_ROOT, ".claude/skills/system-path-simulation/scripts/run-segment.mts"),
        "--step",
        `builder:${prompt}@1`,
        "--effort",
        "low",
        "--backend",
        "openrouter",
        "--campaign-dir",
        join(scratch, mode),
        "--seed-dir",
        seedFor,
        ...extra,
      ],
      // A placeholder key: the slot resolves its credential, and the stubbed session never sends it.
      { cwd: REPO_ROOT, env: { ...Bun.env, OPENROUTER_API_KEY: "sk-segment-test" } },
    );
    if (mode === "invalid-system") {
      expect(result.exitCode).toBe(2);
      expect(existsSync(marker)).toBe(false);
      continue;
    }
    const observed = JSON.parse(readFileSync(marker, "utf8"));
    const workspace = join(scratch, mode, "workspace");
    if (mode === "system") {
      expect(rootSubject(workspace)).toBe("fixture: own history");
      expect(readFileSync(join(workspace, "agent/tools.ts"), "utf8")).toBe("export const tools = [];\n");
    } else {
      expect(readlinkSync(join(workspace, ".toolchain/lib/plugin-current.so"))).toBe("plugin.so");
      expect(rootSubject(workspace)).toBe(`segment: seed from ${seed}`);
      expect(readFileSync(join(workspace, "correctness-model/tasks.json"), "utf8")).toBe(
        '[{"taskId":"seeded-01"}]\n',
      );
      expect(readFileSync(join(workspace, "STARTER.md"), "utf8")).not.toBe("stale starter copy\n");
    }
    expect(observed.transport).toBe("openrouter");
    expect(observed.cwd).toBe(workspace);
    expect(result.exitCode).toBe(1); // The deliberate provider-open stop, not a model turn.
    expect(String(result.stderr)).toContain(
      mode === "no-tools"
        ? "wall        60000 ms per turn (--timeout-ms; production uses 86400000)"
        : "wall        86400000 ms per turn (production BUILDER_TURN_SETTLE_MS)",
    );
    if (mode === "no-tools") {
      expect(observed.toolNames).toEqual([]);
      expect(observed.publicRead).toBeNull();
      expect(observed.protectedRead).toBeNull();
      expect(existsSync(join(scratch, mode, ".oss"))).toBe(false);
    } else {
      expect(observed.toolNames.length).toBeGreaterThan(0);
      expect(observed.publicRead).toContain("evaluateCheckProgram");
      expect(observed.protectedRead).toContain("outside the candidate workspace access rules");
    }
    if (mode === "system") {
      const captured = readFileSync(systemFile, "utf8");
      expect(observed.systemPrompt).toBe(captured);
      const composition = JSON.parse(readFileSync(join(scratch, mode, "builder-session.json"), "utf8"));
      expect(composition.framingDigest).toBe(new Bun.CryptoHasher("sha256").update(captured).digest("hex"));
    }
  }
});
