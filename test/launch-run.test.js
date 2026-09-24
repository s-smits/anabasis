import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { tmpdir } from "../src/meta/os.ts";
import { parseFullRunArgs } from "../src/run/launch-arguments.ts";
import { hashJsonBytes } from "../src/meta/json-runtime.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import {
  CONDITIONS,
  PRESETS,
  fullrunArgs,
  openingProblems,
  parseOptions,
  planRuns,
  slotEnvironment,
} from "../.claude/skills/launch-run/scripts/options.ts";
import {
  checkOpening,
  launchBatch,
  prepareEnvironment,
  readCredentials,
} from "../.claude/skills/launch-run/scripts/launch.ts";
import { ownedService, stopRun, validateStopPlan } from "../.claude/skills/launch-run/scripts/stop.ts";
import { serviceManager } from "../.claude/skills/launch-run/scripts/service.ts";
import { solveIsolationPolicy, spawnUnderSolveIsolation } from "../src/verify/solve-sandbox.ts";

// A custom one-liner beside the truss preset gives a batch two distinct presets and projects.
const CUSTOM = ["custom", "--prompt", "Design steel roof trusses to Eurocode 3."];
const dirs = [];
const preparedPlans = [];
function temp() {
  const dir = mkdtempSync(join(tmpdir(), "ana-quick-run-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const plan of preparedPlans.splice(0)) if (plan.runtimeTemp) dirs.push(plan.runtimeTemp);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const source = { commit: "a".repeat(40), sourceDigest: "b".repeat(64), dirty: false };
const manager = serviceManager();
/** What each manager prints for a loaded, running service owned by `dir`. */
const liveState = (dir, label) =>
  manager.name === "launchd"
    ? `path = ${join(dir, ".launchd", `${label}.plist`)}\nstate = running`
    : `LoadState=loaded\nActiveState=active\nMainPID=4242\nWorkingDirectory=${dir}`;
function requestIdentity(argv) {
  const args = parseFullRunArgs(argv);
  const contextDigest = new Bun.CryptoHasher("sha256").update("[]").digest("hex");
  const requestDigest = hashJsonBytes({ prompt: args.prompt, contextDigest });
  return {
    requestDigest,
    commandDigest: hashJsonValue({ ...args, prompt: null, contextPaths: null, requestDigest }),
  };
}

function openingFor(plan) {
  const condition = CONDITIONS[plan.condition];
  const modelSlots = Object.fromEntries(
    ["builder", "built", "review"].map((slot, i) => [
      slot,
      {
        kind: condition.kind,
        model: condition.model,
        reasoningEffort: condition.efforts[i],
      },
    ]),
  );
  modelSlots.review.enabled = true;
  return {
    runId: plan.runId,
    source,
    project: { id: `${plan.preset}-project`, origin: "created", requestDigest: plan.requestDigest },
    command: { digest: plan.commandDigest },
    providerResourceBudget: { cap: 1320 },
    modelSlots,
  };
}

function batchFixture({
  failGate = false,
  failLaunch = false,
  failWorker = false,
  refuseAllowance = false,
  args = [...CUSTOM, "truss"],
} = {}) {
  const options = parseOptions(args);
  const plans = planRuns(options, temp(), "fixture");
  const calls = [];
  let gateOptions;
  const context = {
    commit: source.commit,
    uid: 501,
    sharedRoot: temp(),
    manager,
    credentials: {
      claude: {
        kind: "claude",
        origin: "/fixture/.env",
        bytes: "CLAUDE_CODE_OAUTH_TOKEN=fixture-only-token\n",
      },
      codex: {
        kind: "codex",
        origin: "/fixture/auth.json",
        bytes: '{"tokens":{"access_token":"fixture-codex-token"}}',
      },
    },
  };
  const command = async (argv, commandOptions) => {
    calls.push(argv);
    if (argv.at(-1) === "gate") gateOptions = commandOptions;
    if (argv[0].endsWith(manager.launcher) && argv.includes("--deadline")) {
      const dir = argv[argv.indexOf("--worktree") + 1];
      writeFileSync(join(dir, ".scratch/quick-run/stop.json.ready"), "fixture-ready");
      return { code: 0, out: "", err: "" };
    }
    if (argv[1] === "new") mkdirSync(argv[3], { recursive: true });
    if (argv.some((arg) => arg.endsWith("/probe.ts"))) {
      if (failWorker) throw new Error("fixture worker could not load");
      const plan = plans.find((item) => item.dir === argv[2]);
      const condition = CONDITIONS[plan.condition];
      return {
        code: 0,
        out: JSON.stringify({
          source,
          ...requestIdentity(fullrunArgs(plan, options, source)),
          worker: {
            role: "built",
            model: condition.model,
            reasoningEffort: condition.efforts[1],
            confinedPid: 123,
          },
          allowance: refuseAllowance
            ? {
                checked: true,
                ok: false,
                message: "Claude AI usage limit reached; session limit resets 2:20pm",
              }
            : { checked: condition.kind === "claude", ok: true, message: null },
        }),
        err: "",
      };
    }
    if (argv.at(-1) === "gate" && failGate) throw new Error("fixture gate refused");
    if (argv[0].endsWith(manager.launcher)) {
      if (failLaunch) throw new Error("fixture launcher returned an uncertain start");
      const plan = plans.find((item) => item.dir === argv[argv.indexOf("--worktree") + 1]);
      const path = join(plan.dir, "campaigns", `${plan.preset}-project`, "controller", plan.runId);
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, "opening.json"), JSON.stringify(openingFor(plan)));
    }
    return { code: 0, out: argv[0] === manager.query("")[0] ? liveState("/fixture", "") : "", err: "" };
  };
  preparedPlans.push(...plans);
  return { options, plans, context, calls, command, gateOptions: () => gateOptions };
}

describe("one-command run launcher", () => {
  it("starts a separate operator timer before the controller launch without forwarding a retired wall", async () => {
    const fixture = batchFixture({ args: ["truss", "--kill-after-ms", "180000"] });
    const [result] = await launchBatch(fixture.plans, fixture.options, fixture.context, fixture.command);
    expect(result.running).toBe(true);
    const timer = fixture.calls.find((args) => args.includes("--deadline"));
    const launch = fixture.calls.find(
      (args) => args[0].endsWith(manager.launcher) && !args.includes("--deadline"),
    );
    expect(timer[0]).toEndWith(manager.launcher);
    expect(fixture.calls.indexOf(timer)).toBeLessThan(fixture.calls.indexOf(launch));
    expect(launch).not.toContain("--kill-after-ms");
    expect(launch).not.toContain("--wall-deadline-ms");
    expect(Number(timer[timer.indexOf("--deadline") + 1])).toBeGreaterThan(Date.now());
    // The timer runs a copy inside the run worktree, so removing the launcher's tree cannot break it.
    // The copy keeps the skills layout, so the parser it imports is the launcher's own.
    const staged = join(fixture.plans[0].dir, ".scratch/quick-run/stop-timer");
    const script = timer[timer.indexOf("--no-env-file") + 1];
    expect(script).toBe(join(staged, "launch-run/scripts/stop.ts"));
    for (const name of ["launch-run/scripts/stop.ts", "launch-run/scripts/service.ts", "main/cli.ts"]) {
      expect(readFileSync(join(staged, name), "utf8")).toBe(
        readFileSync(join(import.meta.dir, "../.claude/skills", name), "utf8"),
      );
    }
  });

  it("refuses a misspelled or relative stop-timer argument with exit 2 before scheduling anything", () => {
    const stop = join(import.meta.dir, "../.claude/skills/launch-run/scripts/stop.ts");
    const dir = temp();
    const run = (...args) => Bun.spawnSync([process.execPath, "--no-env-file", stop, ...args], { cwd: dir });
    const misspelled = run(
      "--worktree",
      dir,
      "--run",
      "r",
      "--servcie",
      "s",
      "--deadline",
      "1",
      "--grace",
      "1",
    );
    expect(misspelled.exitCode).toBe(2);
    expect(misspelled.stderr.toString()).toContain('unknown option "--servcie"');
    expect(run("--worktree", "relative", "--run", "r").exitCode).toBe(2);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("refuses a misspelled launch option with exit 2 and plans nothing", () => {
    const launch = join(import.meta.dir, "../.claude/skills/launch-run/scripts/launch.ts");
    const result = Bun.spawnSync([process.execPath, "--no-env-file", launch, "truss", "--dry-rnu"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toBe('launch-run: unknown option "--dry-rnu"\n');
    expect(result.stdout.toString()).toBe("");
  });

  it.each([
    [
      "launchd",
      {
        service: "gui/501/ana.fullrun.test-run",
        running: "path = /tmp/owned-run/.launchd/ana.fullrun.test-run.plist\nstate = running",
        notRunning: "path = /tmp/owned-run/.launchd/ana.fullrun.test-run.plist\nstate = not running",
        absent: { code: 1, out: "Could not find service" },
        foreign: "path = /tmp/foreign.plist",
      },
    ],
    [
      "linux",
      {
        service: "ana.fullrun.test-run.service",
        running: "LoadState=loaded\nActiveState=active\nMainPID=4242\nWorkingDirectory=/tmp/owned-run",
        notRunning: "LoadState=loaded\nActiveState=inactive\nMainPID=0\nWorkingDirectory=/tmp/owned-run",
        absent: { code: 0, out: "LoadState=not-found\nActiveState=inactive\nMainPID=0\nWorkingDirectory=" },
        foreign: "LoadState=loaded\nActiveState=active\nMainPID=7\nWorkingDirectory=/tmp/foreign",
      },
    ],
  ])(
    "stops only the exact loaded run service under %s and checks absence after removal",
    async (platform, fixture) => {
      const { service, running, notRunning, absent, foreign } = fixture;
      const own = serviceManager(platform === "launchd" ? "darwin" : "linux");
      const plan = { dir: "/tmp/owned-run", runId: "test-run", service, deadline: 180000, grace: 30 };
      const state = { code: 0, out: running };
      const calls = [];
      let removed = false;
      const command = async (args) => {
        calls.push(args);
        if (args.join(" ") === own.remove(service).join(" ")) removed = true;
        const queried = removed ? absent : state;
        return args.join(" ") === own.query(service).join(" ") ? queried : { code: 0, out: "" };
      };
      expect(await stopRun(plan, command, async () => {}, own)).toMatchObject({ outcome: "service-absent" });
      expect(calls).toContainEqual(own.terminate(service));
      expect(calls).toContainEqual(own.remove(service));
      removed = false;
      calls.length = 0;
      state.out = notRunning;
      expect(await stopRun(plan, command, async () => {}, own)).toMatchObject({ outcome: "service-absent" });
      expect(calls).not.toContainEqual(own.terminate(service));
      expect(() => ownedService({ code: 0, out: foreign }, plan, own)).toThrow("stop refused");
      expect(() => ownedService({ code: 1, out: "permission denied" }, plan, own)).toThrow("stop refused");
      expect(() =>
        validateStopPlan({ ...plan, service: service.replace("test-run", "another-run") }, own),
      ).toThrow("stop requires an absolute worktree, exact run service, and positive deadline/grace");
      expect(
        await stopRun(
          plan,
          async () => absent,
          async () => {},
          own,
        ),
      ).toMatchObject({ outcome: "already-absent" });
    },
  );

  it.each([
    [
      "launchd",
      "darwin",
      "path = /tmp/owned-run/.launchd/ana.fullrun.test-run.plist\n\tpid = 4242\n\tstate = running",
      "path = /tmp/owned-run/.launchd/ana.fullrun.test-run.plist\n\tstate = not running",
    ],
    [
      "systemd",
      "linux",
      "LoadState=loaded\nActiveState=active\nMainPID=4242\nWorkingDirectory=/tmp/owned-run",
      "LoadState=loaded\nActiveState=inactive\nMainPID=0\nWorkingDirectory=/tmp/owned-run",
    ],
  ])(
    "reports the %s process of a running service and none for a stopped one",
    (_name, platform, running, notRunning) => {
      const own = serviceManager(platform);
      expect(own.pid(running)).toBe(4242);
      // systemd prints MainPID=0 for a unit with no main process, and launchd prints no pid line.
      expect(own.pid(notRunning)).toBeNull();
    },
  );

  it("keeps every preset to one or two non-empty lines and plans each by name", () => {
    const names = Object.keys(PRESETS);
    for (const name of names) {
      expect(
        PRESETS[name].split("\n").every((line) => line.trim()),
        name,
      ).toBe(true);
    }
    for (const name of names) expect(PRESETS[name].split("\n").length, name).toBeLessThanOrEqual(2);
    const plans = planRuns(parseOptions(names), "/tmp/launch", "unique");
    expect(plans.map((plan) => plan.prompt)).toEqual(names.map((name) => PRESETS[name]));
  });

  it("uses the exact presets and lets the product parse their full launch arguments", () => {
    const options = parseOptions([...CUSTOM, "truss"]);
    const plans = planRuns(options, "/tmp/launch", "unique");
    expect(options).toMatchObject({ source: "origin/main", condition: "opus", tasks: "25", budget: "1320" });
    expect(plans.map((plan) => plan.prompt)).toEqual([CUSTOM[2], PRESETS.truss]);
    expect(new Set(plans.map((plan) => plan.dir)).size).toBe(2);
    for (const plan of plans) {
      const parsed = parseFullRunArgs(fullrunArgs(plan, options, source));
      expect(parsed).toMatchObject({
        prompt: plan.prompt,
        runId: plan.runId,
        providerTurnBudget: 1320,
        expectedTasks: 25,
      });
      expect(parsed.project).toBeUndefined();
      expect(parsed.backendSelections).toEqual({ builder: "claude", built: "claude", review: "claude" });
    }
    expect(slotEnvironment("sol")).toMatchObject({
      CODEX_BUILDER_MODEL: "gpt-5.6-sol",
      CODEX_BUILT_REASONING_EFFORT: "high",
      CODEX_REVIEW_REASONING_EFFORT: "medium",
    });
    expect(slotEnvironment("luna")).toMatchObject({
      CODEX_BUILDER_MODEL: "gpt-5.6-luna",
      CODEX_BUILT_MODEL: "gpt-5.6-luna",
      CODEX_BUILDER_REASONING_EFFORT: "max",
      CODEX_BUILT_REASONING_EFFORT: "max",
      CODEX_REVIEW_REASONING_EFFORT: "max",
    });
    expect(slotEnvironment("fable")).toEqual({
      CLAUDE_BUILDER_MODEL: "claude-fable-5-1",
      CLAUDE_BUILT_MODEL: "claude-fable-5-1",
      CLAUDE_REVIEW_MODEL: "claude-fable-5-1",
      CLAUDE_BUILDER_REASONING_EFFORT: "medium",
      CLAUDE_BUILT_REASONING_EFFORT: "medium",
      CLAUDE_REVIEW_REASONING_EFFORT: "medium",
    });
  });

  it("preserves custom prompt punctuation as one argument and forwards a time cap", () => {
    const prompt =
      "Build $(touch /tmp/never) with `literal` and 'quotes'.\nPreserve the second line verbatim.";
    const options = parseOptions(["custom", "--prompt", prompt, "--run", "one-run"]);
    const [plan] = planRuns(options, "/tmp/launch", "unused");
    expect(parseFullRunArgs(fullrunArgs(plan, options, source)).prompt).toBe(prompt);
    // A time cap ends a run at a round boundary instead of a kill; the launched tree's own parser
    // reads the forwarded flag, so it is only forwarded here.
    const bounded = parseOptions([
      "custom",
      "--prompt",
      prompt,
      "--run",
      "one-run",
      "--stop-after-ms",
      "14400000",
    ]);
    expect(fullrunArgs(plan, bounded, source).join(" ")).toContain("--stop-after-ms 14400000");
  });

  const PROMPT_REFUSAL = "--prompt must be one or two non-empty lines without CR or NUL";
  const RUN_REFUSAL = "--run requires one preset, one condition and a safe id of at most 86 characters";
  const PROJECT_REFUSAL = "--project requires one preset, one condition and an existing project id";
  it.each([
    [["truss", "--budget", "0"], "--budget must be a positive integer"],
    [["truss", "--budget", "5", "--budget", "7"], 'option "--budget" may be passed only once'],
    [["truss", "--stop-after-ms", "4h"], "--stop-after-ms must be a positive integer"],
    [[...CUSTOM, "truss", "--run", "same"], RUN_REFUSAL],
    [["truss", "truss", "--run", "same"], RUN_REFUSAL],
    [["truss", "--run", "../old"], RUN_REFUSAL],
    [["truss", "--condition", "sol,opus", "--run", "one-id"], RUN_REFUSAL],
    [["unknown"], "unknown preset unknown; use --list"],
    [["truss", "--prompt", "replacement"], "custom and --prompt must be supplied together"],
    [["custom", "--prompt", "three\nprompt\nlines"], PROMPT_REFUSAL],
    [["custom", "--prompt", "\nblank"], PROMPT_REFUSAL],
    [["custom", "--prompt", "text\0"], PROMPT_REFUSAL],
    [["custom", "--prompt", "text\r"], PROMPT_REFUSAL],
    [["truss", "--env-file", "relative"], "--env-file must be absolute"],
    [["truss", "--claim", "unsupported"], 'unknown option "--claim"'],
    [["truss", "truss", "--project", "old-project"], PROJECT_REFUSAL],
    [["truss", "--project", "../old"], PROJECT_REFUSAL],
    [["truss", "--model", "sol,opus", "--project", "old-project"], PROJECT_REFUSAL],
    [["truss", "--condition", "sol,sol"], "name each condition once"],
    [["truss", "--condition", "sol,unknown"], "unknown condition unknown; choose"],
    [["truss", "--model", "unknown"], "unknown condition unknown; choose"],
    [["truss", "--model", "astra", "--condition", "sol"], "--model and --condition are one option"],
    [["truss", "--model", "astra", "--model", "sol"], 'option "--model" may be passed only once'],
  ])("refuses the launch options %j with %s", (args, refusal) => {
    expect(() => parseOptions(args)).toThrow(refusal);
  });

  // "Continue from the truss run above" names the stopped run's project; the controller continues
  // it from recorded evidence under the same prompt, and the opening must say it did.
  it("forwards a continued project and refuses an opening that created a fresh one instead", () => {
    const options = parseOptions(["truss", "--project", "design-trusses-24"]);
    const [plan] = planRuns(options, "/tmp/launch", "continue");
    const argv = fullrunArgs(plan, options, source);
    expect(parseFullRunArgs(argv)).toMatchObject({ project: "design-trusses-24", prompt: PRESETS.truss });
    Object.assign(plan, { source, budget: "1320", ...requestIdentity(argv) });
    const opening = openingFor(plan);
    opening.project = { id: "design-trusses-24", origin: "operator", requestDigest: plan.requestDigest };
    expect(openingProblems(opening, plan)).toEqual([]);
    opening.project = { id: "design-trusses-25", origin: "created", requestDigest: plan.requestDigest };
    expect(openingProblems(opening, plan)).toContain("continued project");
  });

  it("captures the Claude token and nothing else, without shell, API-key or custom-route leakage", () => {
    const root = temp();
    writeFileSync(
      join(root, ".env"),
      'CLAUDE_CODE_OAUTH_TOKEN="fixture-current"\nCLAUDE_CODE_OAUTH_TOKEN3=fixture-other\nANTHROPIC_API_KEY=fixture-api\nCUSTOM_ADDRESS=https://invalid.test\n',
    );
    const credentials = readCredentials(parseOptions(["truss"]), root, {
      CLAUDE_CODE_OAUTH_TOKEN: "fixture-stale",
    });
    const [plan] = planRuns(parseOptions(["truss"]), root, "credential");
    mkdirSync(plan.dir);
    const environment = prepareEnvironment(plan, credentials, "/usr/bin:/bin:/usr/bin:relative");
    dirs.push(environment.TMPDIR);
    // Only the one token the run reads is carried; a numbered look-alike stays behind.
    expect(readFileSync(join(plan.dir, ".env"), "utf8")).toBe("CLAUDE_CODE_OAUTH_TOKEN=fixture-current\n");
    expect(statSync(join(plan.dir, ".env")).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(environment)).not.toMatch(
      /fixture-current|fixture-other|fixture-api|CUSTOM_ADDRESS/,
    );
    expect(environment.CLAUDE_BUILT_MODEL).toBe("claude-opus-5");
    expect(environment.PATH.split(":").filter((part) => part === "/usr/bin")).toHaveLength(1);
    expect(() => prepareEnvironment(plan, credentials)).toThrow("credential snapshot already exists");
    // A numbered token alone is not the one the run reads.
    writeFileSync(join(root, ".env"), "CLAUDE_CODE_OAUTH_TOKEN3=fixture-other\n");
    expect(() => readCredentials(parseOptions(["truss"]), root, {})).toThrow("no API-key or shell fallback");
    writeFileSync(join(root, ".env"), "ANTHROPIC_API_KEY=fixture-api\n");
    expect(() =>
      readCredentials(parseOptions(["truss"]), root, { CLAUDE_CODE_OAUTH_TOKEN: "fixture-stale" }),
    ).toThrow("no API-key or shell fallback");
  });

  it("captures Sol auth in its private home and refuses a missing or malformed credential", () => {
    const root = temp();
    const auth = JSON.stringify({
      tokens: { access_token: "fixture-access", refresh_token: "fixture-refresh" },
    });
    writeFileSync(join(root, "auth.json"), auth);
    const options = parseOptions(["truss", "--condition", "sol", "--codex-home", root]);
    const credentials = readCredentials(options, root);
    const [plan] = planRuns(options, root, "codex");
    mkdirSync(plan.dir);
    const environment = prepareEnvironment(plan, credentials);
    dirs.push(environment.TMPDIR);
    expect(readFileSync(join(environment.CODEX_HOME, "auth.json"), "utf8")).toBe(auth);
    expect(statSync(join(environment.CODEX_HOME, "auth.json")).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(environment)).not.toContain("fixture-access");
    writeFileSync(join(root, "auth.json"), "{}");
    expect(() => readCredentials(options, root)).toThrow("access token is required");
  });

  it("prepares and probes both runs, gates the source once, and verifies both openings", async () => {
    const fixture = batchFixture();
    const result = await launchBatch(fixture.plans, fixture.options, fixture.context, fixture.command);
    expect(result).toHaveLength(2);
    expect(result.map((row) => row.project)).toEqual(["custom-project", "truss-project"]);
    expect(result.every((row) => !row.error)).toBe(true);
    const gates = fixture.calls.filter((args) => args.at(-1) === "gate");
    const launches = fixture.calls.filter((args) => args[0].endsWith(manager.launcher));
    expect(gates).toHaveLength(1);
    expect(launches).toHaveLength(2);
    expect(fixture.calls.indexOf(gates[0])).toBeLessThan(fixture.calls.indexOf(launches[0]));
    expect(fixture.gateOptions().env.ANA_UI_REPO_ROOT).toBe(fixture.context.sharedRoot);
    expect(fixture.gateOptions().env.ANA_TESTED_COMMIT).toBeUndefined();
    expect(JSON.stringify(launches)).not.toContain("fixture-only-token");
    for (const plan of fixture.plans) {
      const report = JSON.parse(readFileSync(join(plan.dir, ".scratch/quick-run/launch.json"), "utf8"));
      expect(report).toMatchObject({
        status: "running",
        running: true,
        source,
        project: `${plan.preset}-project`,
      });
      expect(lstatSync(join(plan.dir, "campaigns")).isSymbolicLink()).toBe(true);
      expect(
        existsSync(
          join(
            fixture.context.sharedRoot,
            "campaigns",
            report.project,
            "controller",
            plan.runId,
            "opening.json",
          ),
        ),
      ).toBe(true);
      expect(report.gateLog).toBeString();
      expect(report.environment).toBeUndefined();
    }
  });

  it("refuses deadline flags before fresh-launch setup, including a complete valid pair", () => {
    for (const flags of [
      ["--wall-deadline-ms", "14100000", "--termination-grace-ms", "120000"],
      ["--wall-deadline-ms", "10"],
      ["--termination-grace-ms", "10"],
    ]) {
      expect(() => parseOptions(["truss", "--condition", "sol,opus", ...flags])).toThrow("unknown option");
    }
  });

  it("launches Sol, Astra and Opus on one source gate with separate credential snapshots", async () => {
    const fixture = batchFixture({ args: ["truss", "--model", "sol,astra,opus"] });
    const result = await launchBatch(fixture.plans, fixture.options, fixture.context, fixture.command);
    expect(result.map((row) => row.condition)).toEqual(["sol", "astra", "opus"]);
    expect(result.every((row) => row.running && row.source === source.commit)).toBe(true);
    expect(fixture.calls.filter((args) => args.at(-1) === "gate")).toHaveLength(1);
    const [sol, astra, opus] = fixture.plans;
    expect(readFileSync(join(sol.environment.CODEX_HOME, "auth.json"), "utf8")).toContain(
      "fixture-codex-token",
    );
    expect(readFileSync(join(sol.dir, ".env"), "utf8")).toBe("");
    expect(readFileSync(join(astra.environment.CODEX_HOME, "auth.json"), "utf8")).toContain(
      "fixture-codex-token",
    );
    expect(astra.environment).toMatchObject({
      CODEX_BUILDER_MODEL: "gpt-6-astra",
      CODEX_BUILT_MODEL: "gpt-6-astra",
      CODEX_REVIEW_MODEL: "gpt-6-astra",
      CODEX_BUILDER_REASONING_EFFORT: "medium",
      CODEX_BUILT_REASONING_EFFORT: "low",
      CODEX_REVIEW_REASONING_EFFORT: "low",
    });
    expect(readFileSync(join(opus.dir, ".env"), "utf8")).toContain("fixture-only-token");
    expect(existsSync(join(opus.environment.CODEX_HOME, "auth.json"))).toBe(false);
    // Each run is probed by its own tree's probe, never the launcher's.
    const probes = fixture.calls.filter((args) => args.some((arg) => arg.endsWith("/probe.ts")));
    expect(probes).toHaveLength(3);
    for (const args of probes) {
      expect(args).toContain(join(args[2], ".claude/skills/launch-run/scripts/probe.ts"));
    }
  });

  it("launches two truss replicas and one custom prompt per Codex model with six distinct identities", async () => {
    const fixture = batchFixture({
      args: ["truss", "truss", ...CUSTOM, "--condition", "sol,astra", "--stop-after-ms", "14400000"],
    });
    expect(fixture.plans.map((plan) => plan.runId)).toEqual([
      "truss-sol-r1-fixture",
      "truss-astra-r1-fixture",
      "truss-sol-r2-fixture",
      "truss-astra-r2-fixture",
      "custom-sol-fixture",
      "custom-astra-fixture",
    ]);
    const result = await launchBatch(fixture.plans, fixture.options, fixture.context, fixture.command);
    expect(result).toHaveLength(6);
    expect(result.every((row) => row.running && row.source === source.commit)).toBe(true);
    expect(new Set(fixture.plans.map((plan) => plan.dir)).size).toBe(6);
    expect(fixture.calls.filter((args) => args.at(-1) === "gate")).toHaveLength(1);
    for (const plan of fixture.plans) {
      expect(parseFullRunArgs(plan.argv).stopAfterMs).toBe(14400000);
      expect(plan.environment.CODEX_BUILT_MODEL).toBe(
        plan.condition === "astra" ? "gpt-6-astra" : "gpt-5.6-sol",
      );
      const wrong = openingFor(plan);
      wrong.modelSlots.built.model = "unrequested-model";
      expect(openingProblems(wrong, plan)).toContain("built model slot");
    }
  });

  it("loads the temporary worker through the real sandbox while keeping checkout files closed", async () => {
    const [plan] = planRuns(parseOptions(["truss"]), temp(), "wall");
    mkdirSync(plan.dir);
    const environment = prepareEnvironment(plan, {
      kind: "claude",
      bytes: "CLAUDE_CODE_OAUTH_TOKEN=fixture\n",
    });
    dirs.push(environment.TMPDIR);
    expect(environment.TMPDIR.startsWith(plan.dir)).toBe(false);
    expect(statSync(environment.TMPDIR).mode & 0o777).toBe(0o700);
    const policy = solveIsolationPolicy({ repoRoot: plan.dir });
    if ("unsupported" in policy) throw new Error(policy.unsupported);
    const worker = join(environment.TMPDIR, "worker.mjs");
    const blocked = join(plan.dir, "worker.mjs");
    for (const path of [worker, blocked]) writeFileSync(path, 'console.log("worker-loaded")');
    const execute = async (file) => {
      const child = spawnUnderSolveIsolation(policy, {
        command: Bun.argv[0],
        args: [file],
        cwd: environment.TMPDIR,
        env: {},
      });
      child.stdin.end();
      const [code, out] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { code, out };
    };
    expect(await execute(worker)).toEqual({ code: 0, out: "worker-loaded\n" });
    expect((await execute(blocked)).code).not.toBe(0);
  });

  it("starts no provider after a failed gate and does not retry an uncertain launch or start the remaining sibling", async () => {
    const failed = batchFixture({ failGate: true });
    await expect(launchBatch(failed.plans, failed.options, failed.context, failed.command)).rejects.toThrow(
      "gate refused",
    );
    expect(failed.calls.some((args) => args[0].endsWith(manager.launcher))).toBe(false);
    const badWorker = batchFixture({ failWorker: true });
    await expect(
      launchBatch(badWorker.plans, badWorker.options, badWorker.context, badWorker.command),
    ).rejects.toThrow("worker could not load");
    expect(badWorker.calls.some((args) => args.at(-1) === "gate" || args[0].endsWith(manager.launcher))).toBe(
      false,
    );
    const refused = batchFixture({ refuseAllowance: true, args: ["truss", "--model", "opus"] });
    await expect(
      launchBatch(refused.plans, refused.options, refused.context, refused.command),
    ).rejects.toThrow("allowance probe: Claude AI usage limit reached; session limit resets 2:20pm");
    expect(refused.calls.some((args) => args.at(-1) === "gate" || args[0].endsWith(manager.launcher))).toBe(
      false,
    );
    const uncertain = batchFixture({ failLaunch: true });
    const result = await launchBatch(
      uncertain.plans,
      uncertain.options,
      uncertain.context,
      uncertain.command,
    );
    expect(result).toHaveLength(1);
    expect(result[0].error).toContain("uncertain start");
    expect(uncertain.calls.filter((args) => args[0].endsWith(manager.launcher))).toHaveLength(1);
    expect(uncertain.calls.some((args) => args.includes("kill") || args.includes("bootout"))).toBe(false);
  });

  // The terminal is read only through the controller's strict reader, so one it refuses still ends
  // the startup, naming the refusal rather than a reason read leniently from the file.
  it("reports a terminal written just after the opening as a startup the reader refuses", async () => {
    const options = parseOptions(["truss"]);
    const [plan] = planRuns(options, temp(), "early-abort");
    Object.assign(plan, { source, budget: "1320", ...requestIdentity(fullrunArgs(plan, options, source)) });
    const controller = join(plan.dir, "campaigns", "truss-project", "controller", plan.runId);
    mkdirSync(controller, { recursive: true });
    writeFileSync(join(controller, "opening.json"), JSON.stringify(openingFor(plan)));
    await expect(
      checkOpening(plan, async () => ({ code: 0, out: liveState("/fixture", "") }), {
        sleep: async () =>
          writeFileSync(
            join(controller, "terminal.json"),
            JSON.stringify({ terminalReason: "worker could not load" }),
          ),
      }),
    ).rejects.toThrow(
      `${plan.runId}: startup not confirmed; the controller's reader refuses this run's evidence`,
    );
  });

  it("refuses a changed source, prompt, budget or slot and reports absent openings as uncertain", async () => {
    const options = parseOptions(["truss"]);
    const [plan] = planRuns(options, temp(), "opening");
    Object.assign(plan, { source, budget: "1320", ...requestIdentity(fullrunArgs(plan, options, source)) });
    const valid = openingFor(plan);
    expect(openingProblems(valid, plan)).toEqual([]);
    for (const [changed, problem] of [
      [{ ...valid, source: { ...source, dirty: true } }, "dirty source"],
      [{ ...valid, project: { ...valid.project, requestDigest: "wrong" } }, "prompt/request digest"],
      [{ ...valid, providerResourceBudget: { cap: 25 } }, "provider budget"],
      [
        { ...valid, modelSlots: { ...valid.modelSlots, built: { kind: "codex", model: "gpt-5.6-sol" } } },
        "built model slot",
      ],
    ]) {
      expect(openingProblems(changed, plan)).toContain(problem);
    }
    // An opening whose source is not a concrete identity is refused by the reader before any field.
    const controller = join(plan.dir, "campaigns", "truss-project", "controller", plan.runId);
    mkdirSync(controller, { recursive: true });
    writeFileSync(join(controller, "opening.json"), JSON.stringify({ ...valid, source: { commit: "a" } }));
    const live = async () => ({ code: 0, out: liveState("/fixture", "") });
    await expect(checkOpening(plan, live, { attempts: 1, sleep: async () => {} })).rejects.toThrow(
      "opening mismatch: opening source identity is not concrete",
    );
    rmSync(join(plan.dir, "campaigns"), { recursive: true });
    mkdirSync(join(plan.dir, "campaigns"), { recursive: true });
    await expect(
      checkOpening(plan, async () => ({ code: 0, out: liveState("/fixture", "") }), {
        attempts: 1,
        sleep: async () => {},
      }),
    ).rejects.toThrow("start is uncertain");
    expect(readdirSync(join(plan.dir, "campaigns"))).toEqual([]);
    expect(existsSync(join(plan.dir, "domains"))).toBe(false);
  });
});
