#!/usr/bin/env bun
/**
 * The Luna launcher: one `codex exec` per session, queued under `--max-active` and paced by
 * `--start-interval-ms`, with one session-level retry.
 *
 * Codex owns resilience inside a session: it retries a request, reconnects a stream and falls back
 * from WebSocket to HTTPS. What it cannot do is start a session that stopped, so that is the part
 * this launcher owns. A session that ends without a report is tried again (`--retries`, once by
 * default): resumed with `codex exec resume` when Codex named its thread, started again from its
 * prompt when it did not. `--retry <outputDir>` does the same later for the sessions an earlier
 * launch left incomplete, from that launch's own record. What each session leaves behind, and how
 * it is read back, is `luna-receipts.ts`'s.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { processExists } from "#skills/main/session.ts";
import { readJsonFile, readJsonFileOrNull, writeAtomic } from "#src/meta/completed-json.ts";
import { sha256 } from "#src/meta/digest.ts";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { asRecord, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { tmpdir } from "#src/meta/os.ts";
import { basename, delimiter, dirname, isAbsolute, join } from "#src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import {
  type AttemptEnd,
  drain,
  LAUNCH_TYPE,
  type LaunchRecord,
  readLaunch,
  readResult,
  type SessionRecord,
  type SessionResult,
  sessionPaths,
  settle,
  threadIdOf,
  writeRecord,
  writeSummary,
} from "./luna-receipts.ts";

/** One checked session, ready to launch. */
interface Session {
  name: string;
  prompt: string;
  workdir: string;
  sandbox: string;
  ownedPaths: string[];
}

interface Policy {
  maxActive: number;
  startIntervalMs: number;
  retries: number;
}

interface SessionEnvironment {
  env: Record<string, string | undefined>;
  runtime: LaunchRecord["runtime"];
}

/** One run of the queue: a new launch, or a `--retry` of an earlier one. */
interface Execution {
  launch: LaunchRecord;
  sessions: Session[];
  policy: Policy;
  codex: string;
  environment: SessionEnvironment;
  launchOnly: boolean;
}

type HookDecision = { decision?: "block"; reason?: string };

const USAGE = `Usage: luna-sessions --manifest <absolute json> [launch options]
       luna-sessions --tasks-file <absolute json> --workdir <absolute dir> [--instructions-file <absolute file>] [launch options]
       luna-sessions --retry <absolute output dir> [--codex-bin …] [--max-active …] [--start-interval-ms …] [--retries …] [--launch-only]
       luna-sessions --drain <absolute output dir>
       luna-sessions --stop-hook

Launch options:
  --output-dir <absolute new dir>   Default: a new ana-luna-sessions-* directory under the temp root
  --codex-bin <absolute executable>
  --model <gpt-6-luna|gpt-5.6-sol>  Default: gpt-6-luna
  --reasoning-effort <effort>       Luna: high, xhigh or max (default max). Sol: low, medium, high or xhigh (default medium)
  --max-active <n>                  Sessions running at once. Default: all of them
  --start-interval-ms <0-60000>     Least time between two starts. Default: 1000 when there are several sessions
  --retries <0-5>                   Further attempts for a session that ends without a report. Default: 1
  --launch-only                     Do not hold the parent Codex task for report collection`;

const OPTIONS = {
  manifest: "abs",
  "tasks-file": "abs",
  retry: "abs",
  drain: "abs",
  workdir: "abs",
  "instructions-file": "abs",
  "output-dir": "text",
  "codex-bin": "abs",
  model: "text",
  "reasoning-effort": "text",
  "max-active": "int",
  "start-interval-ms": "int",
  retries: "int",
  "launch-only": "flag",
  "stop-hook": "flag",
} as const;
const LAUNCH_OPTIONS = [
  "output-dir",
  "codex-bin",
  "model",
  "reasoning-effort",
  "max-active",
  "start-interval-ms",
  "retries",
  "launch-only",
];
/** Each mode, and the options it takes besides its own. A retry keeps its launch's condition. */
const MODE_OPTIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ["manifest", LAUNCH_OPTIONS],
  ["tasks-file", [...LAUNCH_OPTIONS, "workdir", "instructions-file"]],
  ["retry", ["codex-bin", "max-active", "start-interval-ms", "retries", "launch-only"]],
  ["drain", []],
]);
/** Each model the launcher runs, the efforts it accepts, and the one it runs without a choice. */
const MODELS: ReadonlyMap<string, { efforts: readonly string[]; effort: string }> = new Map([
  ["gpt-6-luna", { efforts: ["high", "xhigh", "max"], effort: "max" }],
  ["gpt-5.6-sol", { efforts: ["low", "medium", "high", "xhigh"], effort: "medium" }],
]);
const DEFAULT_MODEL = "gpt-6-luna";
const SERVICE_TIER = "priority";
const SANDBOXES: ReadonlySet<string> = new Set(["read-only", "workspace-write"]);
const MANIFEST_FIELDS: ReadonlySet<string> = new Set([
  "workdir",
  "instructionsFile",
  "instructions",
  "sandbox",
  "sessions",
]);
const SESSION_FIELDS: ReadonlySet<string> = new Set(["name", "task", "workdir", "sandbox", "ownedPaths"]);
const NAME = /^[a-z][a-z0-9_]{0,47}$/;
const THREAD_ID = /^[\w-]{8,128}$/;
const CODEX_CANDIDATES = ["/Applications/ChatGPT.app/Contents/Resources/codex", "/opt/homebrew/bin/codex"];
const DEFAULT_START_INTERVAL_MS = 1_000;
const MAX_START_INTERVAL_MS = 60_000;
const MAX_RETRIES = 5;
const LAUNCH_SCHEMA_VERSION = 1;
/** What a resumed session is told. Its thread already holds the task, so this is the whole turn. */
const RESUME_PROMPT =
  "This session stopped before it ended. Continue the task from where it stopped, and end with the complete report the task asks for, repeating any part of it you already gave.";

/** "a or b", or "a, b, or c". */
function oneOf(values: readonly string[]): string {
  if (values.length < 3) return values.join(" or ");
  return `${values.slice(0, -1).join(", ")}, or ${values.at(-1) ?? ""}`;
}

function directory(value: JsonValue | undefined, field: string): string {
  if (!isString(value) || !isAbsolute(value)) throw new Error(`${field} must be an absolute path`);
  const actual = realpathSync(value);
  if (!statSync(actual).isDirectory()) throw new Error(`${field} must be a directory`);
  return actual;
}

/** The instructions every session shares: the file's, then the manifest's own. */
function sharedInstructions({ instructions = "", instructionsFile = null }: JsonObject): string {
  if (!isString(instructions)) throw new Error("instructions must be text");
  if (instructionsFile !== null && (!isString(instructionsFile) || !isAbsolute(instructionsFile))) {
    throw new Error("instructionsFile must be an absolute path");
  }
  const fromFile = instructionsFile === null ? "" : readFileSync(instructionsFile, "utf8");
  return [fromFile.trim(), instructions.trim()].filter((part) => part !== "").join("\n\n");
}

/** The prompt one session receives on stdin: the shared instructions, its task, then its authority,
 *  byte for byte as WRI's `leafPrompt` composes it. */
function promptOf(
  instructions: string,
  task: string,
  sandbox: string,
  ownedPaths: readonly string[],
): string {
  const authority =
    sandbox === "read-only"
      ? "Authority: read-only. Do not edit files or change external state."
      : `Authority: workspace-write. You own only: ${ownedPaths.join(", ")}.\nOther agents may be editing the repository. Preserve their work and do not revert it.`;
  return [instructions, task.trim(), authority].filter((part) => part !== "").join("\n\n");
}

/** Every session of a manifest, checked before anything is written or started. `label` names the
 *  rows as the caller wrote them: `sessions` in a manifest, `tasks` in a tasks file. */
function sessionsOf(manifest: JsonObject, label: string): Session[] {
  const extra = Object.keys(manifest).filter((key) => !MANIFEST_FIELDS.has(key));
  if (extra.length > 0) throw new Error(`manifest has unsupported fields: ${extra.join(", ")}`);
  const { sessions: rows } = manifest;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("manifest must contain at least one session");
  }
  const instructions = sharedInstructions(manifest);
  const names = new Set<string>();
  const tasks = new Set<string>();
  return rows.map((raw, index): Session => {
    const at = `${label}[${index}]`;
    const row = asRecord(raw);
    if (row === null) throw new Error(`${at} must be an object`);
    const unsupported = Object.keys(row).filter((key) => !SESSION_FIELDS.has(key));
    if (unsupported.length > 0) throw new Error(`${at} has unsupported fields: ${unsupported.join(", ")}`);
    const { name, task, sandbox = manifest.sandbox ?? "read-only", ownedPaths = [] } = row;
    if (!isString(name) || !NAME.test(name)) throw new Error(`${at}.name must match ${NAME.source}`);
    if (names.has(name)) throw new Error(`duplicate session name: ${name}`);
    if (!isString(task) || task.trim() === "") throw new Error(`${at}.task must be non-empty text`);
    if (tasks.has(task.trim())) throw new Error(`${at}.task repeats an earlier session's task`);
    names.add(name);
    tasks.add(task.trim());
    if (!isString(sandbox) || !SANDBOXES.has(sandbox)) {
      throw new Error(`${at}.sandbox must be read-only or workspace-write`);
    }
    const singleLine = (path: JsonValue): boolean =>
      isString(path) && path.trim() !== "" && !/[\0\r\n]/.test(path);
    if (!Array.isArray(ownedPaths) || !ownedPaths.every(singleLine)) {
      throw new Error(`${at}.ownedPaths must list non-empty single-line paths`);
    }
    const paths = ownedPaths.filter(isString);
    if (sandbox === "workspace-write" && paths.length === 0) {
      throw new Error(`write session ${name} must declare ownedPaths`);
    }
    return {
      name,
      prompt: promptOf(instructions, task, sandbox, paths),
      workdir: directory(row.workdir ?? manifest.workdir, `${at}.workdir`),
      sandbox,
      ownedPaths: paths,
    };
  });
}

function conditionOf(model: string | null, effort: string | null) {
  const chosen = model ?? DEFAULT_MODEL;
  const spec = MODELS.get(chosen);
  if (spec === undefined) throw new Error(`--model must be one of ${oneOf([...MODELS.keys()])}`);
  const reasoningEffort = effort ?? spec.effort;
  if (!spec.efforts.includes(reasoningEffort)) {
    throw new Error(`--reasoning-effort must be one of ${oneOf(spec.efforts)}`);
  }
  return { model: chosen, reasoningEffort, serviceTier: SERVICE_TIER };
}

function policyOf(args: CommandArgs, count: number): Policy {
  const maxActive = args.int("max-active") ?? Math.max(count, 1);
  const startIntervalMs = args.int("start-interval-ms") ?? (count > 1 ? DEFAULT_START_INTERVAL_MS : 0);
  const retries = args.int("retries") ?? 1;
  if (maxActive < 1) throw new Error("--max-active must be a positive integer");
  if (startIntervalMs < 0 || startIntervalMs > MAX_START_INTERVAL_MS) {
    throw new Error(`--start-interval-ms must be an integer from 0 to ${MAX_START_INTERVAL_MS}`);
  }
  if (retries < 0 || retries > MAX_RETRIES) {
    throw new Error(`--retries must be an integer from 0 to ${MAX_RETRIES}`);
  }
  return { maxActive: Math.min(maxActive, count), startIntervalMs, retries };
}

function codexBinary(explicit: string | null): string {
  const wanted = explicit ?? CODEX_CANDIDATES.find((path) => Bun.which(path) !== null) ?? "codex";
  const found = Bun.which(wanted);
  if (found === null) throw new Error(`no executable Codex at ${wanted}`);
  return found;
}

function createOutputDir(explicit: string | null): string {
  // The product prefix puts an abandoned output directory under the temp-root census and the
  // launch-time cleaner, which move only `ana-` directories untouched for two days.
  if (explicit === null) return realpathSync(mkdtempSync(join(tmpdir(), "ana-luna-sessions-")));
  if (!isAbsolute(explicit)) throw new Error("--output-dir must be absolute");
  if (existsSync(explicit)) throw new Error("--output-dir must not already exist");
  const output = join(realpathSync(dirname(explicit)), basename(explicit));
  mkdirSync(output, { mode: 0o700 });
  return output;
}

/** Hold the output directory for this process, refusing while another launcher still holds it. */
function holdOutput(outputDir: string): () => void {
  const path = join(outputDir, "launcher.pid");
  const holder = readJsonFileOrNull(path);
  if (processExists(holder)) {
    throw new Error(`the launcher for ${outputDir} is still running as pid ${capturedJsonStringify(holder)}`);
  }
  writeAtomic(path, `${runtimeProcess.pid}\n`);
  return () => rmSync(path, { force: true });
}

/** The environment every session runs in: this Bun first on PATH, in the shell Codex opens too. */
function sessionEnvironment(outputDir: string): SessionEnvironment {
  const bunExecutable = realpathSync(capturedExecPath);
  const bunDirectory = dirname(bunExecutable);
  const shellDirectory = join(outputDir, "shell-env");
  mkdirSync(shellDirectory, { recursive: true, mode: 0o700 });
  writeAtomic(join(shellDirectory, ".zshenv"), 'export PATH="$CODEX_LUNA_BUN_DIR:$PATH"\n');
  return {
    env: {
      ...Bun.env,
      PATH: [bunDirectory, Bun.env.PATH].filter(Boolean).join(delimiter),
      ZDOTDIR: shellDirectory,
      CODEX_LUNA_BUN_DIR: bunDirectory,
      CODEX_LUNA_SESSION: "1",
    },
    runtime: { bunVersion: Bun.version, bunExecutable },
  };
}

function registryPath(threadId: JsonValue | undefined): string | null {
  return isString(threadId) && THREAD_ID.test(threadId)
    ? join(tmpdir(), "codex-luna-swarm", `${threadId}.json`)
    : null;
}

/** Record this launcher against the Codex task that started it, so its stop hook holds that task
 *  until the reports are drained. */
function holdParent(outputDir: string): void {
  const threadId = Bun.env.CODEX_THREAD_ID;
  const path = registryPath(threadId);
  if (path === null) return;
  const previous = asRecord(readJsonFileOrNull(path));
  if (previous !== null && processExists(previous.pid)) {
    throw new Error(
      `another Luna launcher is already active for this Codex task: ${capturedJsonStringify(previous.outputDir)}`,
    );
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeAtomic(path, `${capturedJsonStringify({ threadId, pid: runtimeProcess.pid, outputDir })}\n`);
}

async function stopHook(): Promise<HookDecision> {
  if (Bun.env.CODEX_LUNA_SESSION === "1") return {};
  let input: JsonValue;
  try {
    input = capturedJsonParse(await Bun.stdin.text());
  } catch {
    return {};
  }
  const path = registryPath(asRecord(input)?.session_id);
  const record = path === null ? null : asRecord(readJsonFileOrNull(path));
  const outputDir = record?.outputDir;
  if (path === null || !isString(outputDir)) return {};
  const finished = existsSync(join(outputDir, "summary.json"));
  if (!finished && processExists(record?.pid)) {
    return {
      decision: "block",
      reason: `The Luna launcher is active at ${outputDir}. Poll it, follow luna_session.finished events, and drain reports before ending.`,
    };
  }
  rmSync(path, { force: true });
  return {
    decision: "block",
    reason: finished
      ? `The Luna launcher finished at ${outputDir}. Drain and settle it.`
      : `The Luna launcher stopped unexpectedly at ${outputDir}. Inspect its terminal and missing sessions.`,
  };
}

/** The Codex call for one attempt: a fresh `exec` from the prompt, or `exec resume` of the thread
 *  Codex named. `exec resume` takes no `--sandbox`, so the sandbox travels as configuration. */
function codexArgs(
  session: Session,
  launch: LaunchRecord,
  reportPath: string,
  threadId: string | null,
): string[] {
  const shared = [
    "--model",
    launch.model,
    "--config",
    `model_reasoning_effort="${launch.reasoningEffort}"`,
    "--config",
    `service_tier="${launch.serviceTier}"`,
  ];
  const output = ["--json", "--output-last-message", reportPath];
  return threadId === null
    ? ["exec", ...shared, "--sandbox", session.sandbox, ...output, "-"]
    : [
        "exec",
        "resume",
        ...shared,
        "--config",
        `sandbox_mode="${session.sandbox}"`,
        ...output,
        threadId,
        "-",
      ];
}

async function attempt(session: Session, run: Execution, threadId: string | null): Promise<AttemptEnd> {
  const paths = sessionPaths(run.launch.outputDir, session.name);
  // The report must come from this attempt: an earlier one's stays readable in the event log.
  rmSync(paths.reportPath, { force: true });
  const eventFd = openSync(paths.eventPath, "a", 0o600);
  const stderrFd = openSync(paths.stderrPath, "a", 0o600);
  try {
    const child = Bun.spawn({
      cmd: [run.codex, ...codexArgs(session, run.launch, paths.reportPath, threadId)],
      cwd: session.workdir,
      env: run.environment.env,
      stdin: new Blob([threadId === null ? session.prompt : RESUME_PROMPT]),
      stdout: eventFd,
      stderr: stderrFd,
    });
    await child.exited;
    return { exitCode: child.exitCode, signal: child.signalCode ?? null, spawnError: null };
  } catch (error) {
    return { exitCode: null, signal: null, spawnError: errorMessage(error) };
  } finally {
    closeSync(eventFd);
    closeSync(stderrFd);
  }
}

/** Run every session, each in the first free slot and no sooner than the interval after the last
 *  start. A session's retry takes a start of its own, so a burst of failures is paced too. */
async function runQueue(run: Execution, onSettled: (result: SessionResult) => void): Promise<void> {
  const queue = run.sessions.values();
  let nextStart = 0;
  const startSlot = async (): Promise<void> => {
    const at = Math.max(Date.now(), nextStart);
    nextStart = at + run.policy.startIntervalMs;
    if (at > Date.now()) await Bun.sleep(at - Date.now());
  };
  const worker = async (): Promise<void> => {
    for (const session of queue) {
      let startedAt: Date | null = null;
      let result: SessionResult;
      let attempts = 0;
      do {
        await startSlot();
        startedAt ??= new Date();
        attempts += 1;
        const threadId = threadIdOf(sessionPaths(run.launch.outputDir, session.name).eventPath);
        const end = await attempt(session, run, threadId);
        result = settle(session.name, run.launch.outputDir, end, { attempts, startedAt });
      } while (result.status !== "completed" && attempts <= run.policy.retries);
      writeRecord(sessionPaths(run.launch.outputDir, session.name).resultPath, result);
      onSettled(result);
    }
  };
  await Promise.all(Array.from({ length: run.policy.maxActive }, worker));
}

async function execute(run: Execution): Promise<number> {
  const { outputDir } = run.launch;
  if (!run.launchOnly) holdParent(outputDir);
  console.log(
    capturedJsonStringify({
      type: "luna_sessions.started",
      outputDir,
      sessionCount: run.sessions.length,
      model: run.launch.model,
      reasoningEffort: run.launch.reasoningEffort,
      serviceTier: run.launch.serviceTier,
      runtime: run.environment.runtime,
      maxActive: run.policy.maxActive,
      startIntervalMs: run.policy.startIntervalMs,
      retries: run.policy.retries,
      launchOnly: run.launchOnly,
    }),
  );
  let settled = 0;
  await runQueue(run, (result) => {
    settled += 1;
    console.log(
      capturedJsonStringify({
        type: "luna_session.finished",
        name: result.name,
        status: result.status,
        failureKind: result.failureKind,
        attempts: result.attempts,
        completedCount: settled,
        remainingCount: run.sessions.length - settled,
      }),
    );
  });
  const summary = writeSummary(run.launch);
  const completedCount = summary.sessions.filter((row) => row.status === "completed").length;
  console.log(
    capturedJsonStringify({
      type: "luna_sessions.completed",
      outputDir,
      summaryPath: join(outputDir, "summary.json"),
      completedCount,
      failedCount: summary.sessions.length - completedCount,
      rateLimitedCount: summary.sessions.filter((row) => row.failureKind === "rate-limit").length,
    }),
  );
  return completedCount === summary.sessions.length ? 0 : 1;
}

async function launchSessions(mode: string, source: string, args: CommandArgs): Promise<number> {
  const condition = conditionOf(args.value("model"), args.value("reasoning-effort"));
  const manifest =
    mode === "manifest"
      ? asRecord(readJsonFile(source))
      : {
          workdir: args.required("workdir"),
          instructionsFile: args.value("instructions-file"),
          sessions: readJsonFile(source),
        };
  if (manifest === null) throw new Error("--manifest must hold a JSON object");
  const sessions = sessionsOf(manifest, mode === "manifest" ? "sessions" : "tasks");
  const policy = policyOf(args, sessions.length);
  const codex = codexBinary(args.value("codex-bin"));
  const outputDir = createOutputDir(args.value("output-dir"));
  const release = holdOutput(outputDir);
  try {
    const environment = sessionEnvironment(outputDir);
    const record: LaunchRecord = {
      schemaVersion: LAUNCH_SCHEMA_VERSION,
      type: LAUNCH_TYPE,
      ...condition,
      runtime: environment.runtime,
      ...policy,
      launchOnly: args.flag("launch-only"),
      outputDir,
      startedAt: new Date().toISOString(),
      sessions: sessions.map(
        ({ prompt, ...row }): SessionRecord => ({ ...row, promptSha256: sha256(prompt) }),
      ),
    };
    for (const { name, prompt } of sessions) {
      writeAtomic(sessionPaths(outputDir, name).promptPath, prompt);
    }
    writeRecord(join(outputDir, "launch.json"), record);
    return await execute({
      launch: record,
      sessions,
      policy,
      codex,
      environment,
      launchOnly: record.launchOnly,
    });
  } finally {
    release();
  }
}

/** A recorded session's prompt, from the bytes its launch sent. */
function recordedSession(outputDir: string, row: SessionRecord): Session {
  const { promptPath } = sessionPaths(outputDir, row.name);
  if (!existsSync(promptPath)) {
    throw new Error(`${promptPath} is absent: this launch predates --retry, so start a new launch instead`);
  }
  const prompt = readFileSync(promptPath, "utf8");
  if (sha256(prompt) !== row.promptSha256) {
    throw new Error(`${promptPath} differs from the prompt launch.json records`);
  }
  return { name: row.name, prompt, workdir: row.workdir, sandbox: row.sandbox, ownedPaths: row.ownedPaths };
}

/** Run again only the sessions an earlier launch left without a completed result, under the model,
 *  effort and prompts it recorded, then write its summary over every session. */
async function retry(outputDir: string, args: CommandArgs): Promise<number> {
  const record = readLaunch(outputDir);
  const release = holdOutput(outputDir);
  try {
    const sessions = record.sessions
      .filter(({ name }) => readResult(outputDir, name)?.status !== "completed")
      .map((row) => recordedSession(outputDir, row));
    const policy = policyOf(args, sessions.length);
    const codex = codexBinary(args.value("codex-bin"));
    rmSync(join(outputDir, "summary.json"), { force: true });
    return await execute({
      launch: record,
      sessions,
      policy,
      codex,
      environment: sessionEnvironment(outputDir),
      launchOnly: args.flag("launch-only"),
    });
  } finally {
    release();
  }
}

async function main(args: CommandArgs): Promise<number> {
  if (args.flag("stop-hook")) {
    console.log(capturedJsonStringify(await stopHook()));
    return 0;
  }
  const modes = [...MODE_OPTIONS.keys()].filter((mode) => args.value(mode) !== null);
  const [mode] = modes;
  if (modes.length !== 1 || mode === undefined) {
    throw new Error("choose exactly one of --manifest, --tasks-file, --retry or --drain");
  }
  const allowed = MODE_OPTIONS.get(mode) ?? [];
  const stray = Object.entries(OPTIONS).flatMap(([name, kind]) =>
    name !== mode &&
    !allowed.includes(name) &&
    (kind === "flag" ? args.flag(name) : args.value(name) !== null)
      ? [`--${name}`]
      : [],
  );
  if (stray.length > 0) throw new Error(`--${mode} does not take ${stray.join(" or ")}`);
  const target = args.required(mode);
  if (mode === "drain") {
    await drain(target);
    return 0;
  }
  return mode === "retry" ? retry(target, args) : launchSessions(mode, target, args);
}

if (import.meta.main) await runCommand({ name: "luna-sessions", usage: USAGE, options: OPTIONS }, main);
