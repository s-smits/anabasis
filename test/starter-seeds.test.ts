/**
 * The starter's seed suite, checked against the documented worked harness rather than a stub,
 * because a seed that only passes on a placeholder has not been shown to survive the thing it is
 * seeding. The placeholder starter is where the seeds skip, and `test/starter-pack.test.ts` pins
 * that side.
 *
 * Two things have to hold and they are easy to confuse. The first is that the seeds pass on a
 * fully authored harness while every repository file the run opens stays inside
 * `deriveBundleContract`, which is the read set the Builder's bash sandbox allows — a seed that
 * passes by reading outside that set would pass here and fail in a real session. The second is
 * that the authoring session can reach the two test files at all: see them, edit them like any
 * other candidate file, and run them through `createBuilderTools` under the real `author`
 * isolation rather than a permissive stub. That roster is the Builder's whole file surface,
 * whichever backend it is running on, since `src/run/builder-runtime.ts` mounts it with no
 * per-backend branch.
 *
 * The cases run in sequence against one workspace on purpose, so reordering them breaks them: they
 * follow an authoring pass, and a later case reads what an earlier one wrote.
 */
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { dirname, isAbsolute, join, relative, resolve } from "../src/meta/path.ts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { afterAll, describe, expect, it } from "bun:test";
import { execTextSync } from "./helpers/bun-spawn-sync.ts";
import { WORKSPACE_BUN_LINK, initWorkspace } from "../src/author/domain-repo.ts";
import { openPathRecord } from "../src/builder/candidate-isolation-runtime.ts";
import { deriveBundleContract, deriveCandidateIsolation } from "../src/builder/candidate-isolation.ts";
import { type BuilderIsolation, createBuilderTools } from "../src/builder/tools.ts";
import { isRecord, type JsonValue } from "../src/meta/json-shape.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { osIsolationSupport } from "../src/verify/os-isolation.ts";
import { fingerprintSlug } from "../src/claim/fingerprint.ts";
import { brief as workedBrief, fence } from "./helpers/starter-contracts.ts";
import { evaluateCheckProgram } from "../vendor/correctness-model-bundle/evaluate.ts";
import type { BuildTask } from "../src/truth/tasks.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const STARTER_ROOT = join(REPO_ROOT, "starters", "pi-built-harness");

const SEED_COMMAND = `${WORKSPACE_BUN_LINK} --preserve-symlinks --no-env-file test correctness-model/harness.test.ts correctness-model/evaluator.test.ts`;
// Under the repository root on purpose: @ana/* resolve by walking up to the root node_modules, so
// a workspace outside the tree cannot load the bundles at all (src/truth/solvability.ts makes the
// same choice for the reference-solve scratch).
mkdirSync(join(REPO_ROOT, ".scratch"), { recursive: true });
const SCRATCH = mkdtempSync(join(REPO_ROOT, ".scratch", "starter-seed-"));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

async function runSeedTests(workspace: string) {
  const child = Bun.spawn(
    [
      Bun.argv[0]!,
      "--no-env-file",
      "test",
      "correctness-model/harness.test.ts",
      "correctness-model/evaluator.test.ts",
    ],
    {
      cwd: workspace,
      env: Bun.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (status !== 0) throw Object.assign(new Error(`seed tests exited ${status}`), { stdout, stderr });
  return { stdout, stderr };
}

/**
 * A workspace holding the STARTER.md worked harness: documented verifier, tasks, controls and tools.
 * Each call owns a fresh directory. One shared path would be a race rather than a saving: the copy
 * restores the placeholder verifier before the worked one lands, and the placeholder's imports are
 * type-only, so a reader arriving inside that window sees a harness that loads no bundle at all.
 */
function authoredWorkspace(): string {
  const workspace = join(mkdtempSync(join(SCRATCH, "authored-")), "workspace");
  cpSync(STARTER_ROOT, workspace, { recursive: true });
  writeFileSync(join(workspace, "correctness-model", "brief.json"), fence("## The worked domain", "json"));
  writeFileSync(join(workspace, "correctness-model", "evaluator.ts"), fence("## Worked evaluator", "ts"));
  writeFileSync(
    join(workspace, "correctness-model", "tasks.json"),
    fence("## Task battery contract", "json"),
  );
  writeFileSync(
    join(workspace, "correctness-model", "controls.json"),
    fence("## Control corpus contract", "json"),
  );
  writeFileSync(join(workspace, "agent", "tools.ts"), fence("## Agent tool code contract", "ts"));
  writeFileSync(join(workspace, "agent", "tools-spec.json"), fence("## Agent tool list contract", "json"));
  writeFileSync(join(workspace, "correctness-model/reference/index.ts"), fence("## Worked reference", "ts"));
  return workspace;
}

describe("starter seed tests on the documented worked harness", () => {
  it.concurrent("checks the public roster relation independently of a stored answer", async () => {
    const workspace = authoredWorkspace();
    const { checks } = await import(join(workspace, "correctness-model/evaluator.ts"));
    const { solve } = await import(join(workspace, "correctness-model/reference/index.ts"));
    const task = parseJsonAs<BuildTask[]>(fence("## Task battery contract", "json"))[2]!;
    const publicTask = { taskId: task.taskId, family: task.family, publicInput: task.publicInput };
    const valid = await solve(publicTask);
    const evaluate = evaluateCheckProgram(workedBrief("## The worked domain"), (id, request) =>
      checks[id](request),
    );
    const verdict = (artifact: JsonValue) => evaluate({ publicTask, artifact, hidden: task.hidden });
    expect((await verdict(valid)).ok).toBe(true);
    expect((await verdict({ assignments: valid.assignments.toReversed() })).ok).toBe(true);
    const otherQualified = structuredClone(task);
    // The public rule permits another qualified staff member; a hidden answer cannot forbid it.
    const input = otherQualified.publicInput;
    if (!isRecord(input) || !Array.isArray(input.staff)) throw new Error("worked task has no staff array");
    input.staff = [...input.staff, { id: "alternate", qualification: "night" }];
    expect(
      (
        await evaluate({
          publicTask: { ...publicTask, publicInput: input },
          hidden: otherQualified.hidden,
          artifact: {
            assignments: valid.assignments.map((row: { staffId: string; shiftId: string }) =>
              row.shiftId === "sh-1" ? { ...row, staffId: "alternate" } : row,
            ),
          },
        })
      ).ok,
    ).toBe(true);
    for (const assignments of [
      valid.assignments.slice(1),
      [...valid.assignments, valid.assignments[0]],
      valid.assignments.map((row: { staffId: string; shiftId: string }) => ({ ...row, staffId: "st-1" })),
      valid.assignments.map((row: { staffId: string; shiftId: string }) => ({
        ...row,
        shiftId: "undeclared",
      })),
    ]) {
      expect((await verdict({ assignments })).ok).toBe(false);
    }
    const repeatedQualification = {
      ...publicTask,
      publicInput: {
        staff: [
          { id: "one", qualification: "night" },
          { id: "two", qualification: "night" },
        ],
        shifts: [
          { id: "first", qualification: "night" },
          { id: "second", qualification: "night" },
        ],
      },
    };
    expect(
      (
        await evaluate({
          publicTask: repeatedQualification,
          artifact: await solve(repeatedQualification),
          hidden: [],
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await evaluate({
          publicTask: repeatedQualification,
          artifact: {
            assignments: [
              { staffId: "one", shiftId: "first" },
              { staffId: "one", shiftId: "second" },
            ],
          },
          hidden: [],
        })
      ).ok,
    ).toBe(false);
  });

  /** The command the contract tells the Builder to run. */
  const run = runSeedTests;
  /** Run the production tests, then take a conservative Bun module-graph upper bound over both entries. */
  const traced = async (workspace: string) => {
    await run(workspace);
    const result = await Bun.build({
      entrypoints: [
        join(workspace, "correctness-model", "harness.test.ts"),
        join(workspace, "correctness-model", "evaluator.test.ts"),
      ],
      target: "bun",
      format: "esm",
      metafile: true,
    });
    if (!result.success || result.metafile === undefined) {
      throw new Error(result.logs.map((log) => log.message).join("\n") || "Bun module graph unavailable");
    }
    return Object.keys(result.metafile.inputs)
      .map((path) => (isAbsolute(path) ? path : resolve(path)))
      .map((path) => `LOADED file://${path}\n`)
      .join("");
  };

  it.concurrent("all eight seed cases pass once the harness is authored", async () => {
    const workspace = authoredWorkspace();
    const { stdout, stderr } = await run(workspace);
    const output = `${stdout}${stderr}`;
    const seeded = fingerprintSlug(workspace, { slug: "starter-seed" });
    expect(
      seeded.ok &&
        ["harness.test.ts", "evaluator.test.ts"].every((path) =>
          seeded.correctnessModelFiles.some((file) => file.path === path),
        ),
    ).toBe(true);
    expect(output).toContain("8 pass");
    expect(output).toContain("0 fail");
    expect(output).not.toContain("(skip)");
  }, 60_000);

  it.concurrent("runs under Bun and resolves only derived repository files including the Correctness Model barrels", async () => {
    const workspace = authoredWorkspace();
    const trace = await traced(workspace);
    const contract = new Set(deriveBundleContract(REPO_ROOT));
    const opened = [...trace.matchAll(/^LOADED (file:\S+)$/gm)].map((match) =>
      Bun.fileURLToPath(
        /* SAFETY: the pattern captures a file: URL emitted by the tracer. */ match[1] as string,
      ),
    );
    for (const barrel of [
      "vendor/correctness-model-bundle/index.ts",
      "vendor/correctness-model-bundle/evaluate.ts",
      "vendor/correctness-model-bundle/evaluation-public-task.ts",
    ]) {
      expect(opened).toContain(join(REPO_ROOT, barrel));
    }
    // The workspace itself, the tracer and installed packages are separately readable; what this
    // asserts is the repository source the bundles pull in behind them.
    const repoSource = opened.filter(
      (path) =>
        path.startsWith(REPO_ROOT) &&
        !path.startsWith(SCRATCH) &&
        !path.startsWith(join(REPO_ROOT, "node_modules")),
    );
    const denied = repoSource
      .values()
      .filter((path) => !contract.has(path))
      .map((path) => relative(REPO_ROOT, path))
      .toArray();
    expect(denied).toEqual([]);
  }, 60_000);
});

describe("the seed suite catches the defects it exists for", () => {
  const runSeeds = async (mutate: (workspace: string) => void) => {
    const workspace = authoredWorkspace();
    mutate(workspace);
    try {
      await runSeedTests(workspace);
      return "passed";
    } catch (error) {
      return error instanceof Error && "stdout" in error && "stderr" in error
        ? `${String(error.stdout)}${String(error.stderr)}`
        : "";
    }
  };

  it.concurrent("fails when agent/tools.ts stops implementing a declared tool", async () => {
    const output = await runSeeds((workspace) => {
      const file = join(workspace, "agent", "tools.ts");
      const source = readFileSync(file, "utf8");
      writeFileSync(file, source.replace('name: "list_staff"', 'name: "list_people"'));
    });
    expect(output).toContain("implemented tool names equal");
    expect(output).not.toBe("passed");
  }, 60_000);

  it.concurrent("fails when an authored check no longer reads the rejected artifact", async () => {
    const output = await runSeeds((workspace) => {
      const brief = workedBrief("## The worked domain");
      for (const check of brief.truthChecks) check.execution.artifactPaths = ["$.unused"];
      writeFileSync(join(workspace, "correctness-model", "brief.json"), JSON.stringify(brief));
    });
    expect(output).not.toBe("passed");
    expect(output).toContain("an accept control must pass");
  }, 60_000);

  it.concurrent("keeps the worked harness readable from one directory above the workspace", () => {
    // correctness-model/*.test.ts reaches the harness as ../agent/tools.ts; if that boundary ever moves, the
    // seeds must move with it rather than silently importing nothing.
    const seed = readFileSync(join(STARTER_ROOT, "correctness-model", "harness.test.ts"), "utf8");
    expect(seed).toContain('from "../agent/tools.ts"');
    expect(dirname(join(STARTER_ROOT, "correctness-model"))).toBe(STARTER_ROOT);
  });
});

describe("starter checks use host-owned Boolean aggregation", () => {
  it("rejects an evaluator returning an aggregate object instead of a Boolean", async () => {
    const workspace = authoredWorkspace();
    writeFileSync(
      join(workspace, "correctness-model/evaluator.ts"),
      'export const checks = {"assignments-match": () => ({ok:true,issues:[]})};',
    );
    await expect(runSeedTests(workspace)).rejects.toThrow("seed tests exited 1");
  }, 60_000);

  it("passes a reject that fails on its expected check and on another check too", async () => {
    const workspace = authoredWorkspace();
    const model = join(workspace, "correctness-model");
    const brief = workedBrief("## The worked domain");
    brief.truthChecks.push({ ...brief.truthChecks[0]!, id: "assignments-shadow" });
    writeFileSync(join(model, "brief.json"), JSON.stringify(brief));
    const evaluator = readFileSync(join(model, "evaluator.ts"), "utf8").replace(
      "export const checks =",
      "const originalChecks =",
    );
    writeFileSync(
      join(model, "evaluator.ts"),
      `${evaluator}
export const checks = { ...originalChecks, "assignments-shadow": originalChecks["assignments-match"] };
`,
    );
    const { stdout, stderr } = await runSeedTests(workspace);
    expect(`${stdout}${stderr}`).toContain("0 fail");
  }, 60_000);
});

describe("starter evaluation uses the production public-input contract", () => {
  it.each([
    { name: "excluded selector", declared: false, required: false, passes: true },
    { name: "declared selector", declared: true, required: true, passes: true },
    { name: "repair depending on an excluded selector", declared: false, required: true, passes: false },
  ])(
    "$name",
    async ({ declared, required, passes }) => {
      const workspace = authoredWorkspace();
      const model = join(workspace, "correctness-model");
      const tasks = parseJsonAs<Array<{ publicInput: { profile?: string } }>>(
        readFileSync(join(model, "tasks.json"), "utf8"),
      );
      for (const task of tasks) task.publicInput.profile = "hold";
      writeFileSync(join(model, "tasks.json"), JSON.stringify(tasks));
      const brief = workedBrief("## The worked domain");
      for (const check of brief.truthChecks) if (declared) check.execution.publicInputPaths.push("$.profile");
      writeFileSync(join(model, "brief.json"), JSON.stringify(brief));
      const evaluator = readFileSync(join(model, "evaluator.ts"), "utf8").replace(
        "export const checks =",
        "const originalChecks =",
      );
      writeFileSync(
        join(model, "evaluator.ts"),
        `${evaluator}
export const checks = {"assignments-match": (request: Request) => {
  const input = request.publicTask.publicInput as {profile?: string; optional?: string};
  if(input.profile !== ${required ? '"hold"' : "undefined"}) throw new Error("evaluation selector differs from the production contract");
  if(input.optional !== undefined) throw new Error("absent optional input was invented");
  return originalChecks["assignments-match"](request);
}};
`,
      );
      let output: string;
      try {
        const result = await runSeedTests(workspace);
        output = `${result.stdout}${result.stderr}`;
      } catch (error) {
        if (!(error instanceof Error) || !("stderr" in error)) throw error;
        output = String(error.stderr);
      }
      expect(output).toContain(
        passes ? "8 pass" : "evaluation selector differs from the production contract",
      );
      expect(output).toContain(passes ? "0 fail" : "3 fail");
    },
    60_000,
  );
});

// Under the repository root, as production is: @ana/* resolve by walking up to the root
// node_modules, so a campaign dir outside the tree cannot load the bundles at all.
// Realpath'd: @ana/* resolve by walking up to the root node_modules, so the loop workspace must
// sit inside the true repository root rather than a symlinked path to it.
const LOOP_REPO_ROOT = realpathSync.native(new URL("..", import.meta.url).pathname);
mkdirSync(join(LOOP_REPO_ROOT, ".scratch"), { recursive: true });
const EPOCH_DIR = realpathSync.native(mkdtempSync(join(LOOP_REPO_ROOT, ".scratch", "builder-seed-")));
afterAll(() => rmSync(EPOCH_DIR, { recursive: true, force: true }));

const WORKSPACE = join(EPOCH_DIR, "workspace");
const OSS_ROOT = join(EPOCH_DIR, ".oss");
mkdirSync(OSS_ROOT, { recursive: true });
// The controller's own seeding path: starter pack copied in, git init, exclude whitelist derived
// from CANDIDATE_INTERFACE, starter commit. Nothing about the workspace is hand-built here.
initWorkspace(WORKSPACE);

const git = (...args: string[]) => execTextSync("git", ["-C", WORKSPACE, ...args]);

describe.if(osIsolationSupport().ok)("the Builder's toolkit on the starter's seed suite", () => {
  const isolation: BuilderIsolation = {
    policy: deriveCandidateIsolation(
      {
        repoRoot: LOOP_REPO_ROOT,
        slug: "seed",
        epochDir: EPOCH_DIR,
        iterationDir: WORKSPACE,
        ossRoot: OSS_ROOT,
      },
      "author",
    ),
    record: openPathRecord(EPOCH_DIR, "seed-loop"),
    workDir: WORKSPACE,
  };
  const byName = new Map<string, AgentTool>(createBuilderTools(isolation).map((tool) => [tool.name, tool]));
  const run = async (name: string, params: Record<string, JsonValue>): Promise<string> => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`${name} tool not found`);
    const outcome = await tool.execute("t", params);
    const first = outcome.content[0];
    if (first?.type !== "text") throw new Error(`${name} returned non-text content`);
    return first.text;
  };
  /** bash throws on a non-zero exit, and a failing suite is the outcome half of these cases. */
  const bash = async (command: string): Promise<string> => {
    try {
      return await run("bash", { command });
    } catch (error) {
      return String(error);
    }
  };

  it("lists the seed suite beside the files it tests, and states how to run it", async () => {
    const correctnessModel = await run("ls", { path: "correctness-model" });
    expect(correctnessModel).toContain("harness.test.ts");
    expect(correctnessModel).toContain("evaluator.test.ts");
    expect(await run("ls", { path: "agent" })).toContain("tools.ts");
    expect(await run("read", { path: "STARTER.md" })).toContain(SEED_COMMAND);
    expect(await run("read", { path: "starter-pack/contract.md" })).toContain("# Authoring reference");
    expect(await run("read", { path: "starter-pack/examples.md" })).toContain("# Optional worked examples");
    writeFileSync(join(WORKSPACE, "starter-pack/examples.md"), "stale reference");
    initWorkspace(WORKSPACE);
    expect(await run("read", { path: "starter-pack/examples.md" })).toContain("# Optional worked examples");
    // The seed's own header names the file it reaches for, so a search for the harness finds it.
    expect(await run("grep", { pattern: "createDomainHarness" })).toContain(
      "correctness-model/harness.test.ts",
    );
  });

  it("runs the seeds on the pristine starter: they skip rather than report a pass", async () => {
    const output = await bash(SEED_COMMAND);
    expect(output).toContain("4 pass");
    expect(output).toContain("0 fail");
    expect(output).toContain("4 skip");
  });

  it("authors the harness through write, and the same command then goes green", async () => {
    for (const [path, heading, language] of [
      ["correctness-model/brief.json", "## The worked domain", "json"],
      ["correctness-model/evaluator.ts", "## Worked evaluator", "ts"],
      ["correctness-model/reference/index.ts", "## Worked reference", "ts"],
      ["correctness-model/tasks.json", "## Task battery contract", "json"],
      ["correctness-model/controls.json", "## Control corpus contract", "json"],
      ["agent/tools.ts", "## Agent tool code contract", "ts"],
      ["agent/tools-spec.json", "## Agent tool list contract", "json"],
    ] as const) {
      await run("write", { path, content: fence(heading, language) });
    }
    const output = await bash(SEED_COMMAND);
    expect(output).toContain("8 pass");
    expect(output).toContain("0 fail");
    expect(output).not.toContain("(skip)");
  });

  it("extends the suite through edit, and the added case runs with the seeded ones", async () => {
    await run("edit", {
      path: "correctness-model/harness.test.ts",
      edits: [
        {
          oldText: 'test("createDomainHarness returns a tool array for every task", () => {',
          newText: `test("every declared tool carries a description", () => {
  for (const tool of spec.tools) expect(tool.description.length, tool.name).toBeGreaterThan(0);
});

test("createDomainHarness returns a tool array for every task", () => {`,
        },
      ],
    });
    const output = await bash(SEED_COMMAND);
    expect(output).toContain("9 pass");
    expect(output).toContain("0 fail");
  });

  it("catches a main-file edit that breaks the tool contract", async () => {
    // SAFETY: the fence is the worked tool list STARTER.md publishes; test/starter-pack.test.ts
    // validates it against the real tool-spec schema, so a shape change fails there first.
    const spec = JSON.parse(fence("## Agent tool list contract", "json")) as {
      tools: Array<{ name: string }>;
    };
    const declared = spec.tools[0]?.name;
    if (declared === undefined) throw new Error("STARTER.md's worked tool list is empty");
    await run("edit", {
      path: "agent/tools.ts",
      edits: [{ oldText: `name: "${declared}"`, newText: `name: "${declared}_renamed"` }],
    });
    const output = await bash(SEED_COMMAND);
    expect(output).toContain("implemented tool names equal");
    expect(output).toContain("Command exited with code");
    // Restore, so the workspace this file leaves behind is the authored one.
    await run("edit", {
      path: "agent/tools.ts",
      edits: [{ oldText: `name: "${declared}_renamed"`, newText: `name: "${declared}"` }],
    });
  });

  it("keeps both edited seeds inside the tracked candidate interface", () => {
    // The exclude whitelist is derived from CANDIDATE_INTERFACE's directory prefixes, so a file
    // the Builder adds under correctness-model/ is candidate content without anyone widening a list.
    const tracked = git("ls-files").split("\n");
    expect(tracked).toContain("correctness-model/harness.test.ts");
    expect(tracked).toContain("correctness-model/evaluator.test.ts");
    const dirty = git("status", "--porcelain");
    expect(dirty).toContain("correctness-model/harness.test.ts");
    expect(dirty).not.toContain(".bundle-snapshots");
    git("add", "-A");
    expect(git("diff", "--cached", "--name-only")).toContain("correctness-model/harness.test.ts");
  });

  it("reaches the pinned runtime through a profile that denies the home directory", async () => {
    // The link is what makes the documented command host-independent: it resolves to the
    // controller's own interpreter, wherever a version manager put it, while the home directory
    // around it stays refused.
    expect(await bash(`${WORKSPACE_BUN_LINK} --version`)).toContain(Bun.version);
    expect(await bash("cat ~/.zshrc")).toMatch(/not permitted|No such file|exited with code/);
    // And it is scratch, not candidate content.
    expect(git("ls-files")).not.toContain(".toolchain");
  });
});
