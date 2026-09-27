#!/usr/bin/env bun
// Launch independent Codex sessions from Claude Code through the Codex plugin's companion script,
// detached from the Bash tool that started them, and read their reports back once.
//
//   bun codex-sessions.ts launch --tasks-file /abs/tasks.json --out-dir /private/tmp/... [--workdir /abs]
//        [--model gpt-5.6-sol] [--effort medium] [--write] [--companion /abs/codex-companion.mjs] [--plan-only]
//   bun codex-sessions.ts status --out-dir /private/tmp/...
//   bun codex-sessions.ts drain  --out-dir /private/tmp/...
//
// tasks.json is an array of { name, task, model?, effort?, write? }. Without an explicit model and
// effort the operator's batch policy of 2026-09-04 applies: up to five sessions run gpt-5.6-sol at
// medium, six or more run gpt-6-luna at xhigh, all started together.
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { homedir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import {
  type ExitWith,
  absoluteOption,
  exitWith,
  parseCommandOrDie,
  requiredOption,
} from "#skills/main/cli.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { type JsonObject, type JsonValue, asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";
import { hasText } from "#src/meta/text.ts";

const EFFORTS: readonly string[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const NAME = /^[a-z][a-z0-9_]{0,63}$/;
const DEFAULT_COMPANION = join(
  homedir(),
  ".claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs",
);
const SCRIPT = Bun.fileURLToPath(import.meta.url);

const COMMANDS = {
  launch: {
    values: ["tasks-file", "out-dir", "workdir", "model", "effort", "companion"],
    flags: ["write", "plan-only", "help"],
  },
  "run-one": { values: ["spec"], flags: ["help"] },
  status: { values: ["out-dir"], flags: ["help"] },
  drain: { values: ["out-dir"], flags: ["help"] },
};

/** The model and effort a batch runs when neither is given explicitly, and the rule that chose them. */
export type BatchPolicy = { model: string; effort: string; rule: string };
/** The launch flags that shape the plan; each one overrides the batch policy for every task. */
export type PlanOptions = { model?: string | undefined; effort?: string | undefined; write?: boolean };
/** One task resolved to the model, effort and write mode its session runs with. */
export type PlannedSession = { name: string; task: string; model: string; effort: string; write: boolean };
export type SessionPlan = { sessions: PlannedSession[]; policy: string };
type SessionSummary = { name: string; model: string; effort: string; write: boolean };
type LaunchOptions = {
  outDir: string;
  tasksFile: string;
  workdir: string | undefined;
  companion: string;
  model: string | undefined;
  effort: string | undefined;
  write: boolean;
  planOnly: boolean;
};
/** What `run-one` reads back from the spec file `launch` wrote for its session. */
type Spec = {
  name: string;
  outDir: string;
  companion: string;
  model: string;
  effort: string;
  promptFile: string;
  write: boolean;
  workdir: string | undefined;
};
export type SessionStateName = "finished" | "failed" | "running" | "missing";
/** One launched session as `launch.json` recorded it, with its observed state and exit record. */
export type SessionRow = JsonObject & { state: SessionStateName; exit: JsonObject | null };
type DrainCounts = Record<SessionStateName | "printed", number>;

export function usage(): string {
  return [
    "codex-sessions.ts launch --tasks-file <abs json> --out-dir <abs dir> [--workdir <abs dir>]",
    "    [--model <model>] [--effort <" +
      EFFORTS.join("|") +
      ">] [--write] [--companion <abs path>] [--plan-only]",
    "codex-sessions.ts status --out-dir <abs dir>",
    "codex-sessions.ts drain --out-dir <abs dir>",
    "Batch policy when model and effort are not given: 1-5 sessions gpt-5.6-sol/medium, 6+ gpt-6-luna/xhigh.",
  ].join("\n");
}

export function batchPolicy(count: number): BatchPolicy {
  if (!Number.isInteger(count) || count < 1) throw new Error("a batch needs at least one session");
  return count <= 5
    ? { model: "gpt-5.6-sol", effort: "medium", rule: "1-5 sessions: gpt-5.6-sol medium" }
    : { model: "gpt-6-luna", effort: "xhigh", rule: "6+ sessions: gpt-6-luna xhigh" };
}

function requireEffort(value: JsonValue | undefined, where: string): string {
  if (!isString(value) || !EFFORTS.includes(value)) {
    throw new Error(`${where}: effort ${JSON.stringify(value)} is not one of ${EFFORTS.join(", ")}`);
  }
  return value;
}

/** Turn the task file plus flags into one fully resolved session list. */
export function planSessions(tasks: JsonValue, options: PlanOptions): SessionPlan {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error("--tasks-file must hold a non-empty array");
  }
  const policy = batchPolicy(tasks.length);
  const explicit = hasText(options.model) || hasText(options.effort);
  const seen = new Set<string>();
  const sessions = tasks.map((entry, index): PlannedSession => {
    const task = asRecord(entry);
    const name = task?.name;
    if (task === null || !isString(name) || !NAME.test(name)) {
      throw new Error(`task ${index}: name must match ${NAME}`);
    }
    if (seen.has(name)) throw new Error(`task ${index}: duplicate name ${name}`);
    seen.add(name);
    const text = task.task;
    if (!isString(text) || text.trim() === "") {
      throw new Error(`task ${name}: empty task text`);
    }
    // A task file's non-string model has always reached the companion stringified by Bun.spawn;
    // it is stringified here instead, so a scalar arrives spelled the same.
    const model = shown(task.model ?? options.model ?? policy.model);
    const effort = requireEffort(task.effort ?? options.effort ?? policy.effort, `task ${name}`);
    return { name, task: text, model, effort, write: Boolean(task.write ?? options.write) };
  });
  return { sessions, policy: explicit ? "explicit flags" : policy.rule };
}

function openLog(path: string): number {
  return openSync(path, "a", 0o600);
}

function spawnDetached(cmd: string[], logPath: string, cwd: string): number {
  const fd = openLog(logPath);
  try {
    const child = Bun.spawn({ cmd, cwd, stdin: "ignore", stdout: fd, stderr: fd, env: runtimeProcess.env });
    child.unref();
    return child.pid;
  } finally {
    closeSync(fd);
  }
}

function launch(options: LaunchOptions): number {
  const { outDir, tasksFile, workdir, companion } = options;
  if (hasText(options.effort)) requireEffort(options.effort, "--effort");
  const plan = planSessions(readJsonFile(tasksFile), options);
  if (options.planOnly) {
    console.log(
      JSON.stringify({
        event: "codex_sessions.plan",
        policy: plan.policy,
        sessions: plan.sessions.map(describe),
      }),
    );
    return 0;
  }
  if (!existsSync(companion)) throw new Error(`companion script not found: ${companion}`);
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  if (existsSync(join(outDir, "launch.json"))) {
    throw new Error(`${outDir} already holds a launch; choose a new --out-dir`);
  }
  const startedAt = new Date().toISOString();
  const launched = plan.sessions.map((session) => {
    const promptFile = join(outDir, `${session.name}.prompt.md`);
    writeFileSync(promptFile, session.task, { mode: 0o600 });
    const spec = { ...session, outDir, companion, workdir, promptFile, startedAt };
    const specFile = join(outDir, `${session.name}.spec.json`);
    writeFileSync(specFile, JSON.stringify(spec, null, 2), { mode: 0o600 });
    const pid = spawnDetached(
      [runtimeProcess.execPath, SCRIPT, "run-one", "--spec", specFile],
      join(outDir, `${session.name}.launcher.log`),
      outDir,
    );
    return { ...describe(session), pid, promptFile };
  });
  writeFileSync(
    join(outDir, "launch.json"),
    JSON.stringify({ startedAt, policy: plan.policy, companion, workdir, sessions: launched }, null, 2),
  );
  console.log(
    JSON.stringify({
      event: "codex_sessions.launched",
      outDir,
      policy: plan.policy,
      count: launched.length,
      sessions: launched,
    }),
  );
  return 0;
}

function describe(session: PlannedSession): SessionSummary {
  return { name: session.name, model: session.model, effort: session.effort, write: session.write };
}

function companionArgs(spec: Spec): string[] {
  const args = [
    "task",
    "--fresh",
    "--model",
    spec.model,
    "--effort",
    spec.effort,
    "--prompt-file",
    spec.promptFile,
  ];
  if (spec.write) args.push("--write");
  if (hasText(spec.workdir)) args.push("--cwd", spec.workdir);
  return args;
}

function readSpec(specFile: string): Spec {
  const spec = asRecord(readJsonFile(specFile));
  const { name, outDir, companion, model, effort, promptFile, write, workdir } = spec ?? {};
  if (
    !isString(name) ||
    !isString(outDir) ||
    !isString(companion) ||
    !isString(effort) ||
    !isString(promptFile)
  ) {
    throw new Error(`invalid session spec: ${specFile}`);
  }
  return {
    name,
    outDir,
    companion,
    model: shown(model),
    effort,
    promptFile,
    write: write === true,
    workdir: isString(workdir) ? workdir : undefined,
  };
}

async function runOne(specFile: string): Promise<number> {
  const spec = readSpec(specFile);
  runtimeProcess.on("SIGHUP", () => {});
  const logPath = join(spec.outDir, `${spec.name}.log`);
  const fd = openLog(logPath);
  const began = Date.now();
  let exitCode: number | null = null;
  let signal: string | null = null;
  let error: string | null = null;
  try {
    const child = Bun.spawn({
      cmd: ["nohup", runtimeProcess.execPath, spec.companion, ...companionArgs(spec)],
      cwd: spec.workdir ?? spec.outDir,
      stdin: "ignore",
      stdout: fd,
      stderr: fd,
      env: runtimeProcess.env,
    });
    exitCode = await child.exited;
    signal = child.signalCode ?? null;
  } catch (cause) {
    error = errorMessage(cause);
  } finally {
    closeSync(fd);
  }
  const record = {
    name: spec.name,
    exitCode,
    signal,
    error,
    durationMs: Date.now() - began,
    finishedAt: new Date().toISOString(),
    log: logPath,
  };
  writeFileSync(join(spec.outDir, `${spec.name}.exit.json`), JSON.stringify(record, null, 2));
  return exitCode === 0 && error === null ? 0 : 1;
}

function pidAlive(pid: JsonValue | undefined): boolean {
  if (!isNumber(pid)) return false;
  try {
    runtimeProcess.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A recorded field as the status and drain lines print it. */
function shown(value: JsonValue | undefined): string {
  if (value === undefined) return "undefined";
  return isString(value) ? value : JSON.stringify(value);
}

export function sessionStates(outDir: string): SessionRow[] {
  const launchPath = join(outDir, "launch.json");
  if (!existsSync(launchPath)) throw new Error(`no launch.json under ${outDir}`);
  const sessions = asRecord(readJsonFile(launchPath))?.sessions;
  if (!Array.isArray(sessions)) throw new Error(`invalid launch.json under ${outDir}`);
  return sessions.map((entry): SessionRow => {
    const session = asRecord(entry);
    if (session === null) throw new Error(`invalid launch.json under ${outDir}`);
    const exitFile = join(outDir, `${shown(session.name)}.exit.json`);
    if (existsSync(exitFile)) {
      const exit = asRecord(readJsonFile(exitFile));
      if (exit === null) throw new Error(`invalid exit record: ${exitFile}`);
      // JavaScript falsiness over the recorded error, which is what the exit test has always read.
      const { error } = exit;
      const clean = error === undefined || error === null || error === false || error === 0 || error === "";
      return { ...session, state: exit.exitCode === 0 && clean ? "finished" : "failed", exit };
    }
    return { ...session, state: pidAlive(session.pid) ? "running" : "missing", exit: null };
  });
}

function exitOutcome(exit: JsonObject): string {
  return shown(exit.exitCode ?? exit.signal ?? exit.error);
}

function status(outDir: string): number {
  const states = sessionStates(outDir);
  for (const row of states) {
    console.log(
      `${shown(row.name)}\t${row.state}\t${shown(row.model)}/${shown(row.effort)}${row.exit === null ? "" : `\texit ${exitOutcome(row.exit)}`}`,
    );
  }
  return 0;
}

function drain(outDir: string): number {
  const counts: DrainCounts = { finished: 0, failed: 0, running: 0, missing: 0, printed: 0 };
  for (const row of sessionStates(outDir)) {
    counts[row.state] += 1;
    if (row.exit === null) continue;
    const name = shown(row.name);
    const marker = join(outDir, `${name}.drained`);
    if (existsSync(marker)) continue;
    const logPath = join(outDir, `${name}.log`);
    const body = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    console.log(
      `===== ${name} (${shown(row.model)}/${shown(row.effort)}, ${row.state}, exit ${exitOutcome(row.exit)}, ${shown(row.exit.durationMs)} ms)`,
    );
    console.log(body.trimEnd());
    writeFileSync(marker, shown(row.exit.finishedAt));
    counts.printed += 1;
  }
  console.log(JSON.stringify({ event: "codex_sessions.drained", outDir, ...counts }));
  return counts.missing > 0 ? 2 : 0;
}

async function main(): Promise<number> {
  const die: ExitWith = exitWith("codex-sessions.ts");
  const { command, single, flags } = parseCommandOrDie(die, COMMANDS);
  if (flags.has("help")) {
    console.log(usage());
    return 0;
  }
  const absolute = absoluteOption(die);
  const required = requiredOption(die, single);
  const path = (name: string): string => absolute(name, required(name));
  const optionalPath = (name: string): string | undefined => (single.has(name) ? path(name) : undefined);
  switch (command) {
    case "launch":
      return launch({
        outDir: path("out-dir"),
        tasksFile: path("tasks-file"),
        workdir: optionalPath("workdir"),
        companion: optionalPath("companion") ?? DEFAULT_COMPANION,
        model: single.get("model"),
        effort: single.get("effort"),
        write: flags.has("write"),
        planOnly: flags.has("plan-only"),
      });
    case "run-one":
      return runOne(path("spec"));
    case "status":
      return status(path("out-dir"));
    default:
      return drain(path("out-dir"));
  }
}

if (import.meta.main) {
  main().then(
    (code) => {
      runtimeProcess.exitCode = code;
    },
    (error) => {
      console.error(errorMessage(error));
      runtimeProcess.exitCode = 1;
    },
  );
}
