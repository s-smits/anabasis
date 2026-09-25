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
const count = ["0", "-1", "1.5", "many"];

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

/** `--step builder:<prompt>` with the options after it, for rows that stop before `--check` matters. */
function step(...extra) {
  return ["--step", `builder:${prompt}`, ...extra];
}

function outsideDir(prefix) {
  const outside = mkdtempSync(join(tmpdir(), prefix));
  outsideRoots.push(outside);
  return outside;
}

const campaignDir = () => join(scratch, "campaign");

/** Each refusal is one stderr line and exit 2, before a credential or a provider is reached. */
const REFUSALS = [
  { name: "no step", args: () => [], message: "pass at least one --step" },
  {
    name: "a role that is not a checkpoint",
    args: () => ["--step", `oracle:${prompt}`],
    message: 'step role "oracle" is not a checkpoint',
  },
  ...count.map((turns) => ({
    name: `step allowance ${turns}`,
    args: () => ["--step", `builder:${prompt}@${turns}`],
    message: "step turn allowance must be a positive integer",
  })),
  {
    // The @ inside an ordinary filename is not an allowance, so the next refusal is the backend's.
    name: "an @ inside a prompt filename, read as part of the name",
    setup: () => writeFileSync(join(scratch, "prompt@draft.txt"), "draft prompt\n"),
    args: () => ["--step", `builder:${join(scratch, "prompt@draft.txt")}`, "--backend", "invalid"],
    message: "--backend must be one of",
  },
  {
    name: "an absent prompt file",
    args: () => ["--step", `builder:${join(scratch, "absent.txt")}`],
    message: "step prompt file does not exist",
  },
  {
    name: "an empty prompt file",
    setup: () => writeFileSync(prompt, " \n"),
    args: () => step(),
    message: "step prompt file is empty",
  },
  { name: "no effort", args: () => step(), message: "--effort is required" },
  {
    name: "no campaign directory",
    args: () => step("--effort", "high"),
    message: "--campaign-dir is required",
  },
  {
    name: "an invalid backend",
    args: () => base("--backend", "invalid"),
    message: "--backend must be one of claude, codex, openrouter",
  },
  {
    name: "a campaign outside the run tree",
    args: () => step("--effort", "high", "--campaign-dir", "/tmp/outside-simulation-campaign"),
    message: "must sit inside the run tree",
  },
  {
    name: "a live campaign path",
    args: () => step("--effort", "high", "--campaign-dir", join(REPO_ROOT, "campaigns", "live", "epoch")),
    message: "must sit under the run tree's .scratch directory",
  },
  {
    name: "a scratch path that escapes through a symlink",
    setup: () => symlinkSync(outsideDir("simulation-segment-escape-"), join(scratch, "escape")),
    args: () => step("--effort", "high", "--campaign-dir", join(scratch, "escape", "campaign")),
    message: "resolves outside the run tree's .scratch directory",
  },
  ...["0", "16", "1.5", "many"].map((turns) => ({
    name: `total budget ${turns}`,
    args: () => base("--max-builder-turns", turns),
    message: "--max-builder-turns must be an integer from 1 through 15",
  })),
  ...count.map((timeout) => ({
    name: `timeout ${timeout}`,
    args: () => base("--timeout-ms", timeout, "--backend", "openrouter"),
    message: "--timeout-ms must be a positive integer",
  })),
  {
    name: "a missing seed directory",
    args: () => base("--seed-dir", join(scratch, "absent-seed")),
    message: "--seed-dir does not exist",
  },
  {
    name: "an existing workspace, so one condition cannot inherit another",
    setup: () => {
      mkdirSync(join(campaignDir(), "workspace"), { recursive: true });
      writeFileSync(join(campaignDir(), "workspace", "stale.txt"), "stale condition\n");
    },
    args: () => base("--backend", "openrouter"),
    message: "workspace already exists and is not empty",
  },
  {
    name: "inherited campaign state beside an empty workspace",
    setup: () => {
      mkdirSync(join(campaignDir(), "workspace"), { recursive: true });
      mkdirSync(join(campaignDir(), ".oss"));
      writeFileSync(join(campaignDir(), ".oss", "prior.txt"), "prior condition\n");
    },
    args: () => base("--backend", "openrouter"),
    message: "--campaign-dir already contains prior condition state (.oss)",
  },
  {
    name: "a campaign path that is a file",
    setup: () => writeFileSync(campaignDir(), "not a directory\n"),
    args: () => base("--backend", "openrouter"),
    message: "--campaign-dir exists and is not a directory",
  },
  {
    name: "a campaign symlink whose target stays inside scratch",
    setup: () => {
      mkdirSync(join(scratch, "target"));
      symlinkSync(join(scratch, "target"), campaignDir());
    },
    args: () => base("--backend", "openrouter"),
    message: "--campaign-dir must be a real scratch directory, not a symlink",
  },
  {
    name: "an empty workspace symlink",
    setup: () => {
      mkdirSync(campaignDir(), { recursive: true });
      symlinkSync(outsideDir("simulation-workspace-link-"), join(campaignDir(), "workspace"));
    },
    args: () => base("--backend", "openrouter"),
    message: "workspace must be a real directory inside the scratch condition, not a symlink",
  },
];

describe("run-segment preflight", () => {
  it.each(REFUSALS)("refuses $name", ({ setup, args, message }) => {
    setup?.();
    const result = run(args());
    expect(result.exitCode).toBe(2);
    expect(result.stderr.trimEnd().split("\n")).toEqual([expect.stringContaining(message)]);
  });

  it.each([
    ["a tool-bearing OpenRouter segment", []],
    ["the 15-turn boundary", ["--max-builder-turns", "15"]],
    ["a one-millisecond timeout", ["--timeout-ms", "1"]],
  ])("stops %s at --check before provider work", (_name, extra) => {
    const result = run(base(...extra, "--backend", "openrouter"));
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(PREFLIGHT_PASSED);
  });

  it("refuses predictions a segment can never reach before any backend opens", () => {
    // A segment mounts no gate, so a prediction about correctness_check or the census could only
    // ever resolve untriggered after the whole segment had been paid for.
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
