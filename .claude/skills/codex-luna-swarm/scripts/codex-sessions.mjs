#!/usr/bin/env bun
// Launch independent Codex sessions from Claude Code through the Codex plugin's companion script,
// detached from the Bash tool that started them, and read their reports back once.
//
//   bun codex-sessions.mjs launch --tasks-file /abs/tasks.json --out-dir /private/tmp/... [--workdir /abs]
//        [--model gpt-5.6-sol] [--effort medium] [--write] [--companion /abs/codex-companion.mjs] [--plan-only]
//   bun codex-sessions.mjs status --out-dir /private/tmp/...
//   bun codex-sessions.mjs drain  --out-dir /private/tmp/...
//
// tasks.json is an array of { name, task, model?, effort?, write? }. Without an explicit model and
// effort the operator's batch policy of 2026-09-04 applies: up to five sessions run gpt-5.6-sol at
// medium, six or more run gpt-5.6-luna at xhigh, all started together.
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { homedir } from "#src/meta/os.ts";
import { isAbsolute, join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { isString } from "#src/meta/json-shape.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";

const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const NAME = /^[a-z][a-z0-9_]{0,63}$/;
const DEFAULT_COMPANION = join(
  homedir(),
  ".claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs",
);
const SCRIPT = Bun.fileURLToPath(import.meta.url);

export function usage() {
  return [
    "codex-sessions.mjs launch --tasks-file <abs json> --out-dir <abs dir> [--workdir <abs dir>]",
    "    [--model <model>] [--effort <" +
      EFFORTS.join("|") +
      ">] [--write] [--companion <abs path>] [--plan-only]",
    "codex-sessions.mjs status --out-dir <abs dir>",
    "codex-sessions.mjs drain --out-dir <abs dir>",
    "Batch policy when model and effort are not given: 1-5 sessions gpt-5.6-sol/medium, 6+ gpt-5.6-luna/xhigh.",
  ].join("\n");
}

export function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }
    const key = arg.slice(2).replace(/-/g, "_");
    if (key === "write" || key === "plan_only" || key === "help") {
      options[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
    options[key] = value;
    index += 1;
  }
  return options;
}

export function batchPolicy(count) {
  if (!Number.isInteger(count) || count < 1) throw new Error("a batch needs at least one session");
  return count <= 5
    ? { model: "gpt-5.6-sol", effort: "medium", rule: "1-5 sessions: gpt-5.6-sol medium" }
    : { model: "gpt-5.6-luna", effort: "xhigh", rule: "6+ sessions: gpt-5.6-luna xhigh" };
}

function requireAbsolute(value, flag) {
  if (!isString(value) || !isAbsolute(value)) throw new Error(`${flag} must be an absolute path`);
  return value;
}

function requireEffort(value, where) {
  if (!EFFORTS.includes(value)) {
    throw new Error(`${where}: effort ${JSON.stringify(value)} is not one of ${EFFORTS.join(", ")}`);
  }
  return value;
}

/** Turn the task file plus flags into one fully resolved session list. */
export function planSessions(tasks, options) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error("--tasks-file must hold a non-empty array");
  }
  const policy = batchPolicy(tasks.length);
  const explicit = Boolean(options.model || options.effort);
  const seen = new Set();
  const sessions = tasks.map((task, index) => {
    if (!isString(task?.name) || !NAME.test(task.name)) {
      throw new Error(`task ${index}: name must match ${NAME}`);
    }
    if (seen.has(task.name)) throw new Error(`task ${index}: duplicate name ${task.name}`);
    seen.add(task.name);
    if (!isString(task.task) || task.task.trim() === "") {
      throw new Error(`task ${task.name}: empty task text`);
    }
    const model = task.model ?? options.model ?? policy.model;
    const effort = requireEffort(task.effort ?? options.effort ?? policy.effort, `task ${task.name}`);
    return { name: task.name, task: task.task, model, effort, write: Boolean(task.write ?? options.write) };
  });
  return { sessions, policy: explicit ? "explicit flags" : policy.rule };
}

function openLog(path) {
  return openSync(path, "a", 0o600);
}

function spawnDetached(cmd, logPath, cwd) {
  const fd = openLog(logPath);
  try {
    const child = Bun.spawn({ cmd, cwd, stdin: "ignore", stdout: fd, stderr: fd, env: runtimeProcess.env });
    child.unref();
    return child.pid;
  } finally {
    closeSync(fd);
  }
}

function launch(options) {
  const outDir = requireAbsolute(options.out_dir, "--out-dir");
  const tasksFile = requireAbsolute(options.tasks_file, "--tasks-file");
  const workdir = options.workdir ? requireAbsolute(options.workdir, "--workdir") : undefined;
  const companion = options.companion ? requireAbsolute(options.companion, "--companion") : DEFAULT_COMPANION;
  if (options.effort) requireEffort(options.effort, "--effort");
  const plan = planSessions(readJsonFile(tasksFile), options);
  if (options.plan_only) {
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

function describe(session) {
  return { name: session.name, model: session.model, effort: session.effort, write: session.write };
}

function companionArgs(spec) {
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
  if (spec.workdir) args.push("--cwd", spec.workdir);
  return args;
}

async function runOne(options) {
  const spec = readJsonFile(requireAbsolute(options.spec, "--spec"));
  runtimeProcess.on("SIGHUP", () => {});
  const logPath = join(spec.outDir, `${spec.name}.log`);
  const fd = openLog(logPath);
  const began = Date.now();
  let exitCode = null;
  let signal = null;
  let error = null;
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

function pidAlive(pid) {
  try {
    runtimeProcess.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function sessionStates(outDir) {
  const launchPath = join(outDir, "launch.json");
  if (!existsSync(launchPath)) throw new Error(`no launch.json under ${outDir}`);
  const launchRow = readJsonFile(launchPath);
  return launchRow.sessions.map((session) => {
    const exitFile = join(outDir, `${session.name}.exit.json`);
    if (existsSync(exitFile)) {
      const exit = readJsonFile(exitFile);
      return { ...session, state: exit.exitCode === 0 && !exit.error ? "finished" : "failed", exit };
    }
    return { ...session, state: pidAlive(session.pid) ? "running" : "missing", exit: null };
  });
}

function status(options) {
  const states = sessionStates(requireAbsolute(options.out_dir, "--out-dir"));
  for (const row of states) {
    console.log(
      `${row.name}\t${row.state}\t${row.model}/${row.effort}${row.exit ? `\texit ${row.exit.exitCode ?? row.exit.signal ?? row.exit.error}` : ""}`,
    );
  }
  return 0;
}

function drain(options) {
  const outDir = requireAbsolute(options.out_dir, "--out-dir");
  const counts = { finished: 0, failed: 0, running: 0, missing: 0, printed: 0 };
  for (const row of sessionStates(outDir)) {
    counts[row.state] += 1;
    if (row.exit === null) continue;
    const marker = join(outDir, `${row.name}.drained`);
    if (existsSync(marker)) continue;
    const logPath = join(outDir, `${row.name}.log`);
    const body = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    console.log(
      `===== ${row.name} (${row.model}/${row.effort}, ${row.state}, exit ${row.exit.exitCode ?? row.exit.signal ?? row.exit.error}, ${row.exit.durationMs} ms)`,
    );
    console.log(body.trimEnd());
    writeFileSync(marker, row.exit.finishedAt);
    counts.printed += 1;
  }
  console.log(JSON.stringify({ event: "codex_sessions.drained", outDir, ...counts }));
  return counts.missing > 0 ? 2 : 0;
}

async function main(argv) {
  const options = parseArgs(argv);
  const command = options._[0];
  if (options.help || command === undefined) {
    console.log(usage());
    return command === undefined ? 1 : 0;
  }
  switch (command) {
    case "launch":
      return launch(options);
    case "run-one":
      return runOne(options);
    case "status":
      return status(options);
    case "drain":
      return drain(options);
    default:
      throw new Error(`unknown command ${command}\n${usage()}`);
  }
}

if (import.meta.main) {
  main(runtimeProcess.argv.slice(2)).then(
    (code) => {
      runtimeProcess.exitCode = code;
    },
    (error) => {
      console.error(errorMessage(error));
      runtimeProcess.exitCode = 1;
    },
  );
}
