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
import { commandDigest, parseFullRunArgs } from "../src/run/launch-arguments.ts";
import { hashJsonBytes } from "../src/meta/json-runtime.ts";
import {
  CONDITIONS,
  type OpeningPlan,
  PRESETS,
  type RunPlan,
  SLOTS,
  fullrunArgs,
  openingProblems,
  parseOptions,
  planRuns,
  probeArgs,
  slotEnvironment,
} from "../.claude/skills/launch-run/scripts/options.ts";
import {
  type Command,
  checkOpening,
  launchBatch,
  prepareEnvironment,
  readCredentials,
} from "../.claude/skills/launch-run/scripts/launch.ts";
import { ownedService, stopRun, validateStopPlan } from "../.claude/skills/launch-run/scripts/stop.ts";
import { serviceManager } from "../.claude/skills/launch-run/scripts/service.ts";
import { solveIsolationPolicy, spawnUnderSolveIsolation } from "../src/verify/solve-sandbox.ts";
import { sha256 } from "../src/meta/digest.ts";
import { hasText } from "../src/meta/text.ts";
import { double, rejectionOf, required } from "./helpers/doubles.ts";
import { gitOutput } from "../.claude/skills/main/git.ts";

type Context = Parameters<typeof launchBatch>[2];
type LaunchRow = Awaited<ReturnType<typeof launchBatch>>[number];
type Environment = Record<string, string | undefined>;
interface BatchFixtureOptions {
  failGate?: boolean;
  failLaunch?: boolean;
  failWorker?: boolean;
  refuseAllowance?: boolean;
  args?: string[];
  host?: Context["host"];
}
interface ModelSlot {
  kind: string;
  model: string;
  reasoningEffort?: string | undefined;
  enabled?: boolean;
}

// A standard one-liner beside the truss preset gives a batch two distinct presets and projects.
const CUSTOM = ["standard", "--prompt", "Design steel roof trusses to Eurocode 3."] as const;
const dirs: string[] = [];
const source = { commit: "a".repeat(40), sourceDigest: "b".repeat(64), dirty: false };
const manager = serviceManager();

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "ana-quick-run-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** One launched row's fields, read the same way whichever branch of the result it took. */
function launched(result: LaunchRow | undefined) {
  const value = required(result, "launch row");
  return {
    started: !("error" in value),
    project: "project" in value ? value.project : undefined,
    source: "source" in value ? value.source : undefined,
    condition: "condition" in value ? value.condition : undefined,
    error: "error" in value ? value.error : undefined,
  };
}
/** Whether a recorded command runs the service manager's launcher script. */
const isLauncher = (argv: string[]): boolean => argv[0]?.endsWith(manager.launcher) === true;
/** The frozen environment and controller arguments the service launch of `plan` carried. */
function launchOf(calls: string[][], plan: RunPlan | undefined) {
  const dir = required(plan, "plan").dir;
  const call = required(
    calls.find(
      (args) =>
        isLauncher(args) && !args.includes("--deadline") && args[args.indexOf("--worktree") + 1] === dir,
    ),
    "launch call",
  );
  const pairs = call
    .slice(0, call.indexOf("--"))
    .flatMap((arg, i, all) => (all[i - 1] === "--env" ? [arg] : []));
  const environment: Environment = Object.fromEntries(
    pairs.map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]),
  );
  return { environment, argv: call.slice(call.indexOf("fullrun") + 2) };
}
const readReport = (plan: RunPlan) =>
  JSON.parse(readFileSync(join(plan.dir, ".scratch/quick-run/launch.json"), "utf8"));
const envPath = (environment: Environment, key: string): string => required(environment[key], key);
/** A planned run carrying the identities `openingProblems` and `checkOpening` compare against. */
function opened(plan: RunPlan | undefined, argv: string[]): OpeningPlan {
  return { ...required(plan, "plan"), source, budget: "1320", service: "", ...requestIdentity(argv) };
}

/** What each manager prints for a loaded, running service owned by `dir`. */
const liveState = (dir: string, label: string) =>
  manager.name === "launchd"
    ? `path = ${join(dir, ".launchd", `${label}.plist`)}\nstate = running`
    : `LoadState=loaded\nActiveState=active\nMainPID=4242\nWorkingDirectory=${dir}`;
function requestIdentity(argv: string[]) {
  const args = parseFullRunArgs(argv);
  const contextDigest = new Bun.CryptoHasher("sha256").update("[]").digest("hex");
  const requestDigest = hashJsonBytes({ prompt: args.prompt, contextDigest });
  return {
    requestDigest,
    commandDigest: commandDigest(args, requestDigest),
  };
}

function openingFor(plan: RunPlan & { requestDigest?: string; commandDigest?: string }) {
  const condition = CONDITIONS[plan.condition];
  const slot = (i: number): ModelSlot => ({
    kind: condition.kind,
    model: condition.model,
    reasoningEffort: condition.efforts[i],
  });
  const modelSlots: Record<(typeof SLOTS)[number], ModelSlot> = {
    builder: slot(0),
    built: slot(1),
    review: { ...slot(2), enabled: true },
  };
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
  host = { load: 1.5, live: [] },
}: BatchFixtureOptions = {}) {
  const options = parseOptions(args);
  const plans = planRuns(options, temp(), "fixture");
  const calls: string[][] = [];
  let gateOptions: Parameters<Command>[1];
  const context: Context = {
    commit: source.commit,
    launcher: "c".repeat(40),
    passRecord: join(temp(), "ana-gate-passed"),
    uid: 501,
    sharedRoot: temp(),
    manager,
    host,
    credentials: {
      claude: {
        kind: "claude",
        origin: "/fixture/.env",
        bytes: "CLAUDE_CODE_OAUTH_TOKEN=fixture-only-token\n",
        account: "claude-acct",
      },
      codex: {
        kind: "codex",
        origin: "/fixture/auth.json",
        bytes: '{"tokens":{"access_token":"fixture-codex-token"}}',
        account: "codex-acct",
      },
    },
  };
  const command: Command = async (argv, commandOptions) => {
    calls.push(argv);
    if (argv.at(-1) === "gate") gateOptions = commandOptions;
    if (isLauncher(argv) && argv.includes("--deadline")) {
      const dir = argv[argv.indexOf("--worktree") + 1];
      writeFileSync(join(required(dir, "worktree"), ".scratch/quick-run/stop.json.ready"), "fixture-ready");
      return { code: 0, out: "", err: "" };
    }
    if (argv[1] === "new") {
      // A checkout of its own, as `worktree.sh new` makes, ignoring everything the launch writes.
      const dir = required(argv[3], "new worktree");
      mkdirSync(dir, { recursive: true });
      gitOutput(dir, "init", "-q");
      writeFileSync(join(dir, ".gitignore"), "*\n!/dirty\n");
    }
    if (argv.some((arg) => arg.endsWith("/probe.ts"))) {
      // The probe runs under the run's frozen environment, whose worker temp root sits outside it.
      dirs.push(required(commandOptions?.env?.TMPDIR, "probe TMPDIR"));
      if (failWorker) throw new Error("fixture worker could not load");
      const plan = required(
        plans.find((item) => item.dir === argv[2]),
        "probed plan",
      );
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
    if (isLauncher(argv)) {
      if (failLaunch) throw new Error("fixture launcher returned an uncertain start");
      const plan = required(
        plans.find((item) => item.dir === argv[argv.indexOf("--worktree") + 1]),
        "launched plan",
      );
      const path = join(plan.dir, "campaigns", `${plan.preset}-project`, "controller", plan.runId);
      mkdirSync(path, { recursive: true });
      // The opening records the digests of the arguments the controller was actually started with.
      const identity = requestIdentity(argv.slice(argv.indexOf("fullrun") + 2));
      writeFileSync(join(path, "opening.json"), JSON.stringify(openingFor({ ...plan, ...identity })));
    }
    return { code: 0, out: argv[0] === manager.query("")[0] ? liveState("/fixture", "") : "", err: "" };
  };
  return { options, plans, context, calls, command, gateOptions: () => gateOptions };
}

describe("one-command run launcher", () => {
  it("starts a separate operator timer before the controller launch without forwarding a retired wall", async () => {
    const fixture = batchFixture({ args: ["truss", "--kill-after-ms", "180000"] });
    const [result] = await launchBatch(fixture.plans, fixture.options, fixture.context, fixture.command);
    expect(launched(result).started).toBe(true);
    const timer = required(
      fixture.calls.find((args) => args.includes("--deadline")),
      "timer call",
    );
    const launch = required(
      fixture.calls.find((args) => isLauncher(args) && !args.includes("--deadline")),
      "launch call",
    );
    expect(timer[0]).toEndWith(manager.launcher);
    expect(fixture.calls.indexOf(timer)).toBeLessThan(fixture.calls.indexOf(launch));
    expect(launch).not.toContain("--kill-after-ms");
    expect(launch).not.toContain("--wall-deadline-ms");
    expect(Number(timer[timer.indexOf("--deadline") + 1])).toBeGreaterThan(Date.now());
    // The timer runs a copy inside the run worktree, so removing the launcher's tree cannot break it.
    // The copy keeps the skills layout, so the parser it imports is the launcher's own.
    const staged = join(required(fixture.plans[0], "plan").dir, ".scratch/quick-run/stop-timer");
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
    const run = (...args: string[]) =>
      Bun.spawnSync([process.execPath, "--no-env-file", stop, ...args], { cwd: dir });
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
        running: "path = /tmp/owned-run/.launchd/ana.fullrun.test-run.plist\n\tpid = {pid}\nstate = running",
        notRunning: "path = /tmp/owned-run/.launchd/ana.fullrun.test-run.plist\nstate = not running",
        absent: { code: 1, out: "Could not find service" },
        foreign: "path = /tmp/foreign.plist",
      },
    ],
    [
      "linux",
      {
        service: "ana.fullrun.test-run.service",
        running: "LoadState=loaded\nActiveState=active\nMainPID={pid}\nWorkingDirectory=/tmp/owned-run",
        notRunning: "LoadState=loaded\nActiveState=inactive\nMainPID=0\nWorkingDirectory=/tmp/owned-run",
        absent: { code: 0, out: "LoadState=not-found\nActiveState=inactive\nMainPID=0\nWorkingDirectory=" },
        foreign: "LoadState=loaded\nActiveState=active\nMainPID=7\nWorkingDirectory=/tmp/foreign",
      },
    ],
  ])(
    "stops only the exact loaded run service under %s and kills the group that outlives its removal",
    async (platform, fixture) => {
      const { service, running, notRunning, absent, foreign } = fixture;
      const own = serviceManager(platform === "launchd" ? "darwin" : "linux");
      const plan = { dir: "/tmp/owned-run", runId: "test-run", service, deadline: 180000, grace: 30 };
      // On 2026-09-30 bootout ended the launchd job's `bun run` wrapper and left the controller in
      // its process group, alive under launchd; the stop printed `service-absent` regardless.
      const controller = Bun.spawn(["sleep", "30"], {
        detached: true,
        stdio: ["ignore", "ignore", "ignore"],
      });
      const state = { code: 0, out: running.replace("{pid}", String(controller.pid)) };
      const calls: string[][] = [];
      let removed = false;
      const command = async (args: string[]) => {
        calls.push(args);
        if (args.join(" ") === own.remove(service).join(" ")) removed = true;
        const queried = removed ? absent : state;
        return args.join(" ") === own.query(service).join(" ") ? queried : { code: 0, out: "" };
      };
      try {
        expect(await stopRun(plan, command, Bun.sleep, own)).toMatchObject({
          outcome: "controller-killed",
          group: controller.pid,
        });
        expect(await controller.exited).not.toBe(0);
        expect(controller.signalCode).toBe("SIGKILL");
      } finally {
        controller.kill("SIGKILL");
      }
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
    const names = Object.keys(PRESETS).filter((name): name is keyof typeof PRESETS => name in PRESETS);
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
    const options = parseOptions([...CUSTOM, "truss", "buffer"]);
    const plans = planRuns(options, "/tmp/launch", "unique");
    expect(options).toMatchObject({ source: "origin/main", condition: "opus", tasks: "25", budget: "1320" });
    expect(plans.map((plan) => plan.prompt)).toEqual([CUSTOM[2], PRESETS.truss, PRESETS.buffer]);
    expect(new Set(plans.map((plan) => plan.dir)).size).toBe(3);
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
      CODEX_BUILDER_MODEL: "gpt-6.1-sol",
      CODEX_BUILT_REASONING_EFFORT: "high",
      CODEX_REVIEW_REASONING_EFFORT: "medium",
    });
    expect(slotEnvironment("solhmm")).toMatchObject({
      CODEX_BUILDER_MODEL: "gpt-6.1-sol",
      CODEX_BUILT_MODEL: "gpt-6.1-sol",
      CODEX_REVIEW_MODEL: "gpt-6.1-sol",
      CODEX_BUILDER_REASONING_EFFORT: "high",
      CODEX_BUILT_REASONING_EFFORT: "medium",
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
    expect(slotEnvironment("opushmm")).toMatchObject({
      CLAUDE_BUILDER_MODEL: "claude-opus-5-5",
      CLAUDE_BUILDER_REASONING_EFFORT: "high",
      CLAUDE_BUILT_REASONING_EFFORT: "medium",
      CLAUDE_REVIEW_REASONING_EFFORT: "medium",
    });
    expect(slotEnvironment("sonnetxhh")).toMatchObject({
      CLAUDE_BUILDER_MODEL: "claude-sonnet-5-5",
      CLAUDE_BUILT_MODEL: "claude-sonnet-5-5",
      CLAUDE_REVIEW_MODEL: "claude-sonnet-5-5",
      CLAUDE_BUILDER_REASONING_EFFORT: "xhigh",
      CLAUDE_BUILT_REASONING_EFFORT: "high",
      CLAUDE_REVIEW_REASONING_EFFORT: "high",
    });
    expect(slotEnvironment("haiku")).toMatchObject({
      CLAUDE_BUILDER_MODEL: "claude-haiku-4-5-20251001",
      CLAUDE_BUILT_MODEL: "claude-haiku-4-5-20251001",
      CLAUDE_REVIEW_MODEL: "claude-haiku-4-5-20251001",
      CLAUDE_BUILDER_REASONING_EFFORT: "medium",
    });
    expect(slotEnvironment("opus47")).toMatchObject({
      CLAUDE_BUILDER_MODEL: "claude-opus-4-7",
      CLAUDE_BUILT_MODEL: "claude-opus-4-7",
      CLAUDE_REVIEW_MODEL: "claude-opus-4-7",
    });
    expect(slotEnvironment("gpt55")).toMatchObject({
      CODEX_BUILDER_MODEL: "gpt-5.5",
      CODEX_BUILT_MODEL: "gpt-5.5",
      CODEX_BUILDER_REASONING_EFFORT: "high",
      CODEX_REVIEW_REASONING_EFFORT: "medium",
    });
  });

  it("names an effort variant in its run id and probes it as its model's standard row", () => {
    const options = parseOptions(["--prompt", "Write a CLI.", "--model", "opushmm"]);
    const [plan] = planRuns(options, "/tmp/launch", "at");
    expect(plan?.runId).toBe("standard-opushmm-at");
    const args = plan === undefined ? [] : probeArgs(plan, options);
    expect(args[args.indexOf("--condition") + 1]).toBe("opus");
  });

  it("probes the Sol effort variant as the standard sol row", () => {
    const options = parseOptions(["--prompt", "Write a CLI.", "--model", "solhmm"]);
    const [plan] = planRuns(options, "/tmp/launch", "at");
    expect(plan?.runId).toBe("standard-solhmm-at");
    const args = plan === undefined ? [] : probeArgs(plan, options);
    expect(args[args.indexOf("--condition") + 1]).toBe("sol");
  });

  it("probes the Sonnet effort variant as the standard sonnet row", () => {
    const options = parseOptions(["--prompt", "Write a CLI.", "--model", "sonnetxhh"]);
    const [plan] = planRuns(options, "/tmp/launch", "at");
    expect(plan?.runId).toBe("standard-sonnetxhh-at");
    const args = plan === undefined ? [] : probeArgs(plan, options);
    expect(args[args.indexOf("--condition") + 1]).toBe("sonnet");
  });

  it("probes an older model as its own row, not as the newer model its name starts with", () => {
    const options = parseOptions(["--prompt", "Write a CLI.", "--model", "opus47"]);
    const [plan] = planRuns(options, "/tmp/launch", "at");
    const args = plan === undefined ? [] : probeArgs(plan, options);
    expect(args[args.indexOf("--condition") + 1]).toBe("opus47");
  });

  it("names a --prompt run standard, whether it is named standard, custom or not at all", () => {
    for (const names of [[], ["standard"], ["custom"]]) {
      const plans = planRuns(parseOptions([...names, "--prompt", "Write a CLI."]), "/tmp/launch", "at");
      expect(plans.map((plan) => [plan.preset, plan.runId, plan.prompt])).toEqual([
        ["standard", "standard-opus-at", "Write a CLI."],
      ]);
    }
    const replicas = planRuns(parseOptions(["standard", "custom", "--prompt", "Write a CLI."]), "/tmp", "at");
    expect(replicas.map((plan) => plan.runId)).toEqual(["standard-opus-r1-at", "standard-opus-r2-at"]);
  });

  it("preserves prompt punctuation as one argument and forwards a time cap", () => {
    const prompt =
      "Build $(touch /tmp/never) with `literal` and 'quotes'.\nPreserve the second line verbatim.";
    const options = parseOptions(["--prompt", prompt, "--run", "one-run"]);
    const plan = required(planRuns(options, "/tmp/launch", "unused")[0], "plan");
    expect(parseFullRunArgs(fullrunArgs(plan, options, source)).prompt).toBe(prompt);
    // A time cap ends a run at a round boundary instead of a kill; the launched tree's own parser
    // reads the forwarded flag, so it is only forwarded here.
    const bounded = parseOptions(["--prompt", prompt, "--run", "one-run", "--stop-after-ms", "14400000"]);
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
    [["truss", "--prompt", "replacement"], "standard runs the --prompt text, so each needs the other"],
    [["standard"], "standard runs the --prompt text, so each needs the other"],
    [[], "give --prompt or name a preset: truss, buffer, recode, standard"],
    [["--prompt", "three\nprompt\nlines"], PROMPT_REFUSAL],
    [["--prompt", "\nblank"], PROMPT_REFUSAL],
    [["--prompt", "text\0"], PROMPT_REFUSAL],
    [["--prompt", "text\r"], PROMPT_REFUSAL],
    [["truss", "--env-file", "relative"], "--env-file must be absolute"],
    [["truss", "--over-capacity", " "], "--over-capacity needs the reason, in words"],
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
    const planned = required(planRuns(options, "/tmp/launch", "continue")[0], "plan");
    const argv = fullrunArgs(planned, options, source);
    expect(parseFullRunArgs(argv)).toMatchObject({ project: "design-trusses-24", prompt: PRESETS.truss });
    const plan = opened(planned, argv);
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
    const credentials = readCredentials("claude", parseOptions(["truss"]), root, {
      CLAUDE_CODE_OAUTH_TOKEN: "fixture-stale",
    });
    // The account is named by a digest of the token, never the token.
    expect(credentials.account).toMatch(/^[0-9a-f]{12}$/);
    const plan = required(planRuns(parseOptions(["truss"]), root, "credential")[0], "plan");
    mkdirSync(plan.dir);
    const environment = prepareEnvironment(plan, credentials, "/usr/bin:/bin:/usr/bin:relative");
    dirs.push(envPath(environment, "TMPDIR"));
    // Only the one token the run reads is carried; a numbered look-alike stays behind.
    expect(readFileSync(join(plan.dir, ".env"), "utf8")).toBe("CLAUDE_CODE_OAUTH_TOKEN=fixture-current\n");
    expect(statSync(join(plan.dir, ".env")).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(environment)).not.toMatch(
      /fixture-current|fixture-other|fixture-api|CUSTOM_ADDRESS/,
    );
    expect(environment.CLAUDE_BUILT_MODEL).toBe("claude-opus-5-5");
    expect(
      envPath(environment, "PATH")
        .split(":")
        .filter((part) => part === "/usr/bin"),
    ).toHaveLength(1);
    expect(() => prepareEnvironment(plan, credentials)).toThrow("credential snapshot already exists");
    // A numbered token alone is not the one the run reads.
    writeFileSync(join(root, ".env"), "CLAUDE_CODE_OAUTH_TOKEN3=fixture-other\n");
    expect(() => readCredentials("claude", parseOptions(["truss"]), root, {})).toThrow(
      "no API-key or shell fallback",
    );
    writeFileSync(join(root, ".env"), "ANTHROPIC_API_KEY=fixture-api\n");
    expect(() =>
      readCredentials("claude", parseOptions(["truss"]), root, { CLAUDE_CODE_OAUTH_TOKEN: "fixture-stale" }),
    ).toThrow("no API-key or shell fallback");
  });

  it("captures Sol auth in its private home and refuses a missing or malformed credential", () => {
    const root = temp();
    const auth = JSON.stringify({
      tokens: {
        access_token: "fixture-access",
        refresh_token: "fixture-refresh",
        account_id: "fixture-account",
      },
    });
    writeFileSync(join(root, "auth.json"), auth);
    const options = parseOptions(["truss", "--condition", "sol", "--codex-home", root]);
    const credentials = readCredentials("codex", options, root);
    // The access token rotates on refresh, so the account id is what names the account.
    expect(credentials.account).toBe(sha256("fixture-account").slice(0, 12));
    const plan = required(planRuns(options, root, "codex")[0], "plan");
    mkdirSync(plan.dir);
    const environment = prepareEnvironment(plan, credentials);
    dirs.push(envPath(environment, "TMPDIR"));
    expect(readFileSync(join(envPath(environment, "CODEX_HOME"), "auth.json"), "utf8")).toBe(auth);
    expect(statSync(join(envPath(environment, "CODEX_HOME"), "auth.json")).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(environment)).not.toContain("fixture-access");
    writeFileSync(join(root, "auth.json"), "{}");
    expect(() => readCredentials("codex", options, root)).toThrow("access token is required");
  });

  it("prepares and probes both runs, gates the source once, and verifies both openings", async () => {
    const fixture = batchFixture();
    const result = await launchBatch(fixture.plans, fixture.options, fixture.context, fixture.command);
    expect(result).toHaveLength(2);
    expect(result.map((item) => launched(item).project)).toEqual(["standard-project", "truss-project"]);
    expect(result.every((item) => !hasText(launched(item).error))).toBe(true);
    const gates = fixture.calls.filter((args) => args.at(-1) === "gate");
    const launches = fixture.calls.filter((args) => isLauncher(args));
    expect(gates).toHaveLength(1);
    expect(launches).toHaveLength(2);
    expect(fixture.calls.indexOf(required(gates[0], "gate"))).toBeLessThan(
      fixture.calls.indexOf(required(launches[0], "launch")),
    );
    const gateEnv = required(fixture.gateOptions()?.env, "gate environment");
    expect(gateEnv.ANA_UI_REPO_ROOT).toBe(fixture.context.sharedRoot);
    expect(gateEnv.ANA_TESTED_COMMIT).toBeUndefined();
    expect(JSON.stringify(launches)).not.toContain("fixture-only-token");
    for (const plan of fixture.plans) {
      const report = readReport(plan);
      expect(report).toMatchObject({
        status: "started",
        source,
        project: `${plan.preset}-project`,
        launcher: fixture.context.launcher,
        gate: { policy: "auto", decision: "ran" },
      });
      // The receipt says the run started; whether it is still running is the controller's to say.
      expect(report.running).toBeUndefined();
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
      expect(report.gate.evidence).toBe(
        join(required(fixture.plans[0], "plan").dir, ".scratch/quick-run/gate.log"),
      );
      expect(report.environment).toBeUndefined();
    }
    // A pass on the clean run tree is recorded as the hook records one, so the commit is gated once.
    expect(readFileSync(fixture.context.passRecord, "utf8")).toBe(`${source.commit} --at\n`);
  });

  it.each([
    ["auto", [`${"b".repeat(40)} --at`, `${source.commit} --at`], "recorded-pass"],
    ["auto", [`${source.commit} --static`, `${"b".repeat(40)} --at`], "ran"],
    ["run", [`${source.commit} --at`], "ran"],
    ["skip", [], "operator-skip"],
  ] as const)("settles --gate %s over the pass record %j as %s", async (policy, lines, decision) => {
    const fixture = batchFixture({ args: [...CUSTOM, "truss", "--gate", policy] });
    writeFileSync(fixture.context.passRecord, lines.map((line) => `${line}\n`).join(""));
    const result = await launchBatch(fixture.plans, fixture.options, fixture.context, fixture.command);
    expect(result.map((item) => launched(item).project)).toEqual(["standard-project", "truss-project"]);
    // Only a whole-gate pass of this exact commit stands in for the gate; a static pass does not.
    expect(fixture.calls.filter((args) => args.at(-1) === "gate")).toHaveLength(decision === "ran" ? 1 : 0);
    for (const plan of fixture.plans) {
      const { gate } = readReport(plan);
      expect(gate).toMatchObject({ policy, decision });
      expect(gate.evidence).toBe(
        decision === "ran"
          ? join(required(fixture.plans[0], "plan").dir, ".scratch/quick-run/gate.log")
          : decision === "recorded-pass"
            ? fixture.context.passRecord
            : null,
      );
    }
  });

  it("records a pass only from a clean run tree, and the next batch on that commit skips the gate", async () => {
    const dirty = batchFixture();
    // A gate that leaves a file behind has passed on bytes the commit does not hold.
    const command: Command = async (argv, commandOptions) => {
      if (argv.at(-1) === "gate") writeFileSync(join(required(argv[2], "gated tree"), "dirty"), "");
      return dirty.command(argv, commandOptions);
    };
    await launchBatch(dirty.plans, dirty.options, dirty.context, command);
    expect(existsSync(dirty.context.passRecord)).toBe(false);
    const first = batchFixture();
    await launchBatch(first.plans, first.options, first.context, first.command);
    const second = batchFixture();
    await launchBatch(
      second.plans,
      second.options,
      { ...second.context, passRecord: first.context.passRecord },
      second.command,
    );
    expect(second.calls.filter((args) => args.at(-1) === "gate")).toHaveLength(0);
    expect(readReport(required(second.plans[0], "plan")).gate).toMatchObject({ decision: "recorded-pass" });
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
    expect(result.map((item) => launched(item).condition)).toEqual(["sol", "astra", "opus"]);
    expect(result.every((item) => launched(item).started && launched(item).source === source.commit)).toBe(
      true,
    );
    expect(fixture.calls.filter((args) => args.at(-1) === "gate")).toHaveLength(1);
    const [sol, astra, opus] = fixture.plans.map((plan) => ({ ...plan, ...launchOf(fixture.calls, plan) }));
    expect(
      readFileSync(join(envPath(required(sol, "sol").environment, "CODEX_HOME"), "auth.json"), "utf8"),
    ).toContain("fixture-codex-token");
    expect(readFileSync(join(required(sol, "sol").dir, ".env"), "utf8")).toBe("");
    expect(
      readFileSync(join(envPath(required(astra, "astra").environment, "CODEX_HOME"), "auth.json"), "utf8"),
    ).toContain("fixture-codex-token");
    expect(astra?.environment).toMatchObject({
      CODEX_BUILDER_MODEL: "gpt-6-astra",
      CODEX_BUILT_MODEL: "gpt-6-astra",
      CODEX_REVIEW_MODEL: "gpt-6-astra",
      CODEX_BUILDER_REASONING_EFFORT: "medium",
      CODEX_BUILT_REASONING_EFFORT: "low",
      CODEX_REVIEW_REASONING_EFFORT: "low",
    });
    const opusPlan = required(opus, "opus");
    expect(readFileSync(join(opusPlan.dir, ".env"), "utf8")).toContain("fixture-only-token");
    expect(existsSync(join(envPath(opusPlan.environment, "CODEX_HOME"), "auth.json"))).toBe(false);
    // Each run is probed by its own tree's probe, never the launcher's.
    const probes = fixture.calls.filter((args) => args.some((arg) => arg.endsWith("/probe.ts")));
    expect(probes).toHaveLength(3);
    for (const args of probes) {
      expect(args).toContain(
        join(required(args[2], "worktree"), ".claude/skills/launch-run/scripts/probe.ts"),
      );
    }
  });

  it("launches two truss replicas and one standard prompt per Codex model with six distinct identities", async () => {
    const fixture = batchFixture({
      args: ["truss", "truss", ...CUSTOM, "--condition", "sol,astra", "--stop-after-ms", "14400000"],
    });
    expect(fixture.plans.map((plan) => plan.runId)).toEqual([
      "truss-sol-r1-fixture",
      "truss-astra-r1-fixture",
      "truss-sol-r2-fixture",
      "truss-astra-r2-fixture",
      "standard-sol-fixture",
      "standard-astra-fixture",
    ]);
    const result = await launchBatch(fixture.plans, fixture.options, fixture.context, fixture.command);
    expect(result).toHaveLength(6);
    expect(result.every((item) => launched(item).started && launched(item).source === source.commit)).toBe(
      true,
    );
    expect(new Set(fixture.plans.map((plan) => plan.dir)).size).toBe(6);
    expect(fixture.calls.filter((args) => args.at(-1) === "gate")).toHaveLength(1);
    for (const planned of fixture.plans) {
      const { environment, argv } = launchOf(fixture.calls, planned);
      expect(parseFullRunArgs(argv).stopAfterMs).toBe(14400000);
      expect(environment.CODEX_BUILT_MODEL).toBe(
        planned.condition === "astra" ? "gpt-6-astra" : "gpt-6.1-sol",
      );
      const plan = opened(planned, argv);
      const wrong = openingFor(plan);
      wrong.modelSlots.built.model = "unrequested-model";
      expect(openingProblems(wrong, plan)).toContain("built model slot");
    }
  });

  it("loads the temporary worker through the real sandbox while keeping checkout files closed", async () => {
    const plan = required(planRuns(parseOptions(["truss"]), temp(), "wall")[0], "plan");
    mkdirSync(plan.dir);
    const environment = prepareEnvironment(
      plan,
      double<Parameters<typeof prepareEnvironment>[1]>({
        kind: "claude",
        bytes: "CLAUDE_CODE_OAUTH_TOKEN=fixture\n",
      }),
    );
    dirs.push(envPath(environment, "TMPDIR"));
    expect(envPath(environment, "TMPDIR").startsWith(plan.dir)).toBe(false);
    expect(statSync(envPath(environment, "TMPDIR")).mode & 0o777).toBe(0o700);
    const policy = solveIsolationPolicy({ repoRoot: plan.dir });
    if ("unsupported" in policy) throw new Error(policy.unsupported);
    const worker = join(envPath(environment, "TMPDIR"), "worker.mjs");
    const blocked = join(plan.dir, "worker.mjs");
    for (const path of [worker, blocked]) writeFileSync(path, 'console.log("worker-loaded")');
    const execute = async (file: string) => {
      const child = spawnUnderSolveIsolation(policy, {
        command: required(Bun.argv[0], "bun executable"),
        args: [file],
        cwd: envPath(environment, "TMPDIR"),
        env: {},
      });
      await child.stdin.end();
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
    expect(failed.calls.some((args) => isLauncher(args))).toBe(false);
    // Every tree the refused batch created says which stage stopped it, and a failed gate records no pass.
    for (const plan of failed.plans) {
      expect(readReport(plan)).toMatchObject({
        status: "refused",
        stage: "gate",
        error: "fixture gate refused",
      });
    }
    expect(existsSync(failed.context.passRecord)).toBe(false);
    const badWorker = batchFixture({ failWorker: true });
    await expect(
      launchBatch(badWorker.plans, badWorker.options, badWorker.context, badWorker.command),
    ).rejects.toThrow("worker could not load");
    expect(badWorker.calls.some((args) => args.at(-1) === "gate" || isLauncher(args))).toBe(false);
    const [probed, unstarted] = badWorker.plans;
    expect(readReport(required(probed, "probed plan"))).toMatchObject({
      status: "refused",
      stage: "prepare",
    });
    expect(existsSync(required(unstarted, "second plan").dir)).toBe(false);
    const refused = batchFixture({ refuseAllowance: true, args: ["truss", "--model", "opus"] });
    await expect(
      launchBatch(refused.plans, refused.options, refused.context, refused.command),
    ).rejects.toThrow("allowance probe: Claude AI usage limit reached; session limit resets 2:20pm");
    expect(refused.calls.some((args) => args.at(-1) === "gate" || isLauncher(args))).toBe(false);
    const uncertain = batchFixture({ failLaunch: true });
    const result = await launchBatch(
      uncertain.plans,
      uncertain.options,
      uncertain.context,
      uncertain.command,
    );
    expect(result).toHaveLength(1);
    expect(launched(result[0]).error).toContain("uncertain start");
    expect(uncertain.calls.filter((args) => isLauncher(args))).toHaveLength(1);
    expect(uncertain.calls.some((args) => args.includes("kill") || args.includes("bootout"))).toBe(false);
  });

  // The operator's pace (AGENTS.md "Open gaps", blocker 4): a batch past either limit starts nothing.
  const FIVE_LIVE = ["run-a", "run-b", "run-c", "run-d", "run-e"];
  it.each([
    [
      "a load above 25",
      { load: 31.2, live: ["run-a", "run-b"] },
      'refused before preparing any tree: one-minute load 31.2 (limit 25); 4 runs live with this batch (limit 6), live now: run-a, run-b\nEach run added slows every run already there. Wait for the load to fall or a run to close, or pass --over-capacity "<reason>" to launch anyway.',
    ],
    [
      "a batch that takes the live runs past six",
      { load: 8, live: FIVE_LIVE },
      "one-minute load 8 (limit 25); 7 runs live with this batch (limit 6), live now: run-a, run-b, run-c, run-d, run-e\n",
    ],
    [
      "a load above 25 when the live runs could not be read",
      { load: 25.1, live: "fixture reader failed" },
      "one-minute load 25.1 (limit 25); live runs unread (fixture reader failed), so the load alone decides\n",
    ],
  ])("refuses %s before preparing any tree or asking any provider", async (_case, host, refusal) => {
    const { plans, options, context, command, calls } = batchFixture({ host });
    expect((await rejectionOf(launchBatch(plans, options, context, command))).message).toContain(refusal);
    expect(calls).toEqual([]);
    for (const plan of plans) expect(existsSync(plan.dir)).toBe(false);
  });

  it("launches at the limits, or past them, keeping the reading and the operator's reason in each receipt", async () => {
    const reason = "operator: one arm replaces a stopped one";
    for (const [args, host, overCapacity] of [
      [["truss"], { load: 25, live: FIVE_LIVE }, null],
      [["truss"], { load: 12, live: "fixture reader failed" }, null],
      [["truss", "--over-capacity", reason], { load: 31.2, live: [...FIVE_LIVE, "run-f"] }, reason],
    ] as const) {
      const { plans, options, context, command } = batchFixture({ args: [...args], host });
      expect(launched((await launchBatch(plans, options, context, command))[0]).started).toBe(true);
      expect(readReport(required(plans[0], "plan")).pace).toEqual({ ...host, overCapacity });
    }
  });

  // The terminal is read only through the controller's strict reader, so one it refuses still ends
  // the startup, naming the refusal rather than a reason read leniently from the file.
  it("reports a terminal written just after the opening as a startup the reader refuses", async () => {
    const options = parseOptions(["truss"]);
    const planned = required(planRuns(options, temp(), "early-abort")[0], "plan");
    const plan = opened(planned, fullrunArgs(planned, options, source));
    const controller = join(plan.dir, "campaigns", "truss-project", "controller", plan.runId);
    mkdirSync(controller, { recursive: true });
    writeFileSync(join(controller, "opening.json"), JSON.stringify(openingFor(plan)));
    await expect(
      checkOpening(plan, async () => ({ code: 0, out: liveState("/fixture", ""), err: "" }), {
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
    const planned = required(planRuns(options, temp(), "opening")[0], "plan");
    const plan = opened(planned, fullrunArgs(planned, options, source));
    const valid = openingFor(plan);
    expect(openingProblems(valid, plan)).toEqual([]);
    const changes: [unknown, string][] = [
      [{ ...valid, source: { ...source, dirty: true } }, "dirty source"],
      [{ ...valid, project: { ...valid.project, requestDigest: "wrong" } }, "prompt/request digest"],
      [{ ...valid, providerResourceBudget: { cap: 25 } }, "provider budget"],
      [
        { ...valid, modelSlots: { ...valid.modelSlots, built: { kind: "codex", model: "gpt-6.1-sol" } } },
        "built model slot",
      ],
    ];
    for (const [changed, problem] of changes) {
      expect(openingProblems(changed, plan)).toContain(problem);
    }
    // An opening whose source is not a concrete identity is refused by the reader before any field.
    const controller = join(plan.dir, "campaigns", "truss-project", "controller", plan.runId);
    mkdirSync(controller, { recursive: true });
    writeFileSync(join(controller, "opening.json"), JSON.stringify({ ...valid, source: { commit: "a" } }));
    const live = async () => ({ code: 0, out: liveState("/fixture", ""), err: "" });
    await expect(checkOpening(plan, live, { attempts: 1, sleep: async () => {} })).rejects.toThrow(
      "opening mismatch: opening source identity is not concrete",
    );
    rmSync(join(plan.dir, "campaigns"), { recursive: true });
    mkdirSync(join(plan.dir, "campaigns"), { recursive: true });
    await expect(
      checkOpening(plan, async () => ({ code: 0, out: liveState("/fixture", ""), err: "" }), {
        attempts: 1,
        sleep: async () => {},
      }),
    ).rejects.toThrow("start is uncertain");
    expect(readdirSync(join(plan.dir, "campaigns"))).toEqual([]);
    expect(existsSync(join(plan.dir, "domains"))).toBe(false);
  });
});
