#!/usr/bin/env bun
/**
 * The Codex launcher: one `codex exec` a session, queued under `--max-active` and paced by
 * `--start-interval-ms`, with one session-level retry.
 *
 * Codex owns resilience inside a session: it retries a request, reconnects a stream and falls back
 * from WebSocket to HTTPS. What it cannot do is start a session that stopped, so that is the part
 * this launcher owns. A session that ends without a report is tried again (`--retries`, once by
 * default): resumed with `codex exec resume` where Codex named its thread, started again from its
 * prompt where it did not. `--retry <outputDir>` does the same later for the sessions an earlier
 * launch left incomplete, from that launch's own record. What each session leaves behind, and how
 * it is read back, is `gpt-receipts.ts`'s.
 *
 * Each session runs with Codex's live web search (`codex --search`) unless its manifest says
 * `"search": false`, as a whole-run investigation's does: until 27 October no session could search,
 * and a literature question was answered from memory.
 *
 * v1's launcher also held a parent Codex task open through a stop hook, and took a bare task list
 * beside a manifest. v2 registers no Codex hook and a manifest holds a task list whole, so both
 * went when the skill came over on 11 October.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { sha256 } from "#src/meta/digest.ts";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
} from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isBoolean, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "#src/meta/path.ts";
import { capturedExecPath, capturedSpawn, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { processGroupExists } from "#src/meta/subprocess.ts";
import {
  type AttemptEnd,
  drain,
  LAUNCH_TYPE,
  type LaunchRecord,
  readLaunch,
  readResult,
  recordLaunch,
  recordResult,
  type SessionRecord,
  type SessionResult,
  SUMMARY_FILE,
  SUMMARY_TYPE,
  sessionPaths,
  settle,
  threadIdOf,
  writeSummary,
  writeWhole,
} from "./gpt-receipts.ts";

/** One checked session, ready to launch. */
export interface Session {
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
}

const USAGE = `Usage: gpt-sessions.ts --manifest <absolute json> --output-dir <absolute new dir> [launch options]
       gpt-sessions.ts --retry <absolute output dir> [--codex-bin …] [--max-active …] [--start-interval-ms …] [--retries …]
       gpt-sessions.ts --drain <absolute output dir>

Launch options:
  --codex-bin <absolute executable>
  --model <gpt-6-luna|gpt-6.1-sol>  Default: gpt-6-luna
  --reasoning-effort <effort>       Luna: high, xhigh or max (default max). Sol: low, medium, high or xhigh (default medium)
  --max-active <n>                  Sessions running at once. Default: all of them
  --start-interval-ms <0-60000>     Least time between two starts. Default: 1000 when there are several sessions
  --retries <0-5>                   Further attempts for a session that ends without a report. Default: 1`;

const OPTIONS = {
  manifest: "abs",
  retry: "abs",
  drain: "abs",
  "output-dir": "abs",
  "codex-bin": "abs",
  model: "text",
  "reasoning-effort": "text",
  "max-active": "int",
  "start-interval-ms": "int",
  retries: "int",
} as const;
/** Each mode, and the options it takes besides its own. A retry keeps its launch's condition. */
const MODE_OPTIONS: ReadonlyMap<string, readonly string[]> = new Map([
  [
    "manifest",
    ["output-dir", "codex-bin", "model", "reasoning-effort", "max-active", "start-interval-ms", "retries"],
  ],
  ["retry", ["codex-bin", "max-active", "start-interval-ms", "retries"]],
  ["drain", []],
]);
/** Each model the launcher runs, the efforts it accepts, and the one it runs without a choice. */
const MODELS: ReadonlyMap<string, { efforts: readonly string[]; effort: string }> = new Map([
  ["gpt-6-luna", { efforts: ["high", "xhigh", "max"], effort: "max" }],
  ["gpt-6.1-sol", { efforts: ["low", "medium", "high", "xhigh"], effort: "medium" }],
]);
const DEFAULT_MODEL = "gpt-6-luna";
const SERVICE_TIER = "priority";
const READ_ONLY = "read-only";
const SANDBOXES: ReadonlySet<string> = new Set([READ_ONLY, "workspace-write"]);
const MANIFEST_FIELDS: ReadonlySet<string> = new Set([
  "workdir",
  "instructionsFile",
  "instructions",
  "sandbox",
  "search",
  "sessions",
]);
const SESSION_FIELDS: ReadonlySet<string> = new Set(["name", "task", "workdir", "sandbox", "ownedPaths"]);
const NAME = /^[a-z][a-z0-9_]{0,47}$/;
const CODEX_CANDIDATES = ["/Applications/ChatGPT.app/Contents/Resources/codex", "/opt/homebrew/bin/codex"];
const DEFAULT_START_INTERVAL_MS = 1_000;
const MAX_START_INTERVAL_MS = 60_000;
const MAX_RETRIES = 5;
/** What a resumed session is told. Its thread already holds the task, so this is the whole turn. */
const RESUME_PROMPT =
  "This session stopped before it ended. Continue the task from where it stopped, and end with the complete report the task asks for, repeating any part of it you already gave.";

/** "a or b", or "a, b, or c". */
function oneOf(values: readonly string[]): string {
  if (values.length < 3) return values.join(" or ");
  return `${values.slice(0, -1).join(", ")}, or ${values.at(-1) ?? ""}`;
}

/** Remove a file the launcher wrote, where it is there. */
async function removeFile(path: string): Promise<void> {
  if (existsSync(path)) await Bun.file(path).delete();
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

/** The prompt one session receives on stdin: the shared instructions, its task, then its authority. */
function promptOf(
  instructions: string,
  task: string,
  sandbox: string,
  ownedPaths: readonly string[],
): string {
  const authority =
    sandbox === READ_ONLY
      ? "Authority: read-only. Do not edit files or change external state."
      : `Authority: workspace-write. You own only: ${ownedPaths.join(", ")}.\nOther agents may be editing the repository. Preserve their work and do not revert it.`;
  return [instructions, task.trim(), authority].filter((part) => part !== "").join("\n\n");
}

/** One session row, checked against the names and tasks already taken. */
function sessionOf(manifest: JsonObject, raw: JsonValue, at: string, instructions: string): Session {
  const row = asRecord(raw);
  if (row === null) throw new Error(`${at} must be an object`);
  const unsupported = Object.keys(row).filter((key) => !SESSION_FIELDS.has(key));
  if (unsupported.length > 0) throw new Error(`${at} has unsupported fields: ${unsupported.join(", ")}`);
  const { name, task, sandbox = manifest.sandbox ?? READ_ONLY, ownedPaths = [] } = row;
  if (!isString(name) || !NAME.test(name)) throw new Error(`${at}.name must match ${NAME.source}`);
  if (!isString(task) || task.trim() === "") throw new Error(`${at}.task must be non-empty text`);
  if (!isString(sandbox) || !SANDBOXES.has(sandbox)) {
    throw new Error(`${at}.sandbox must be read-only or workspace-write`);
  }
  const singleLine = (path: JsonValue): boolean =>
    isString(path) && path.trim() !== "" && !/[\0\r\n]/.test(path);
  if (!Array.isArray(ownedPaths) || !ownedPaths.every(singleLine)) {
    throw new Error(`${at}.ownedPaths must list non-empty single-line paths`);
  }
  const paths = ownedPaths.filter(isString);
  // A workdir must exist; one that is a file fails the session's first start, typed `spawn`.
  const workdir = row.workdir ?? manifest.workdir;
  if (!isString(workdir) || !isAbsolute(workdir)) throw new Error(`${at}.workdir must be an absolute path`);
  if (sandbox !== READ_ONLY && paths.length === 0) {
    throw new Error(`write session ${name} must declare ownedPaths`);
  }
  return {
    name,
    prompt: promptOf(instructions, task, sandbox, paths),
    workdir: realpathSync(workdir),
    sandbox,
    ownedPaths: paths,
  };
}

/** Every session of a manifest, checked before anything is written or started. */
export function sessionsOf(manifest: JsonObject): Session[] {
  const extra = Object.keys(manifest).filter((key) => !MANIFEST_FIELDS.has(key));
  if (extra.length > 0) throw new Error(`manifest has unsupported fields: ${extra.join(", ")}`);
  const { sessions: rows } = manifest;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("manifest must contain at least one session");
  }
  const instructions = sharedInstructions(manifest);
  const names = new Set<string>();
  const tasks = new Set<string>();
  return rows.map((raw, index) => {
    const session = sessionOf(manifest, raw, `sessions[${String(index)}]`, instructions);
    const { task } = asRecord(raw) ?? {};
    if (!isString(task)) throw new Error(`session ${session.name} has no task`);
    if (names.has(session.name)) throw new Error(`duplicate session name: ${session.name}`);
    if (tasks.has(task.trim())) throw new Error(`session ${session.name} repeats an earlier session's task`);
    names.add(session.name);
    tasks.add(task.trim());
    return session;
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
    throw new Error(`--start-interval-ms must be an integer from 0 to ${String(MAX_START_INTERVAL_MS)}`);
  }
  if (retries < 0 || retries > MAX_RETRIES) {
    throw new Error(`--retries must be an integer from 0 to ${String(MAX_RETRIES)}`);
  }
  return { maxActive: Math.min(maxActive, count), startIntervalMs, retries };
}

function codexBinary(explicit: string | null): string {
  const wanted = explicit ?? CODEX_CANDIDATES.find((path) => Bun.which(path) !== null) ?? "codex";
  const found = Bun.which(wanted);
  if (found === null) throw new Error(`no executable Codex at ${wanted}`);
  return found;
}

/** The output directory, new and the caller's. v1 defaulted to one under the temporary root, which
 *  the host may clean before a long session's report is drained. */
function createOutputDir(explicit: string): string {
  if (existsSync(explicit)) throw new Error("--output-dir must not already exist");
  const output = join(realpathSync(dirname(explicit)), basename(explicit));
  mkdirSync(output, { mode: 0o700 });
  return output;
}

/** Hold the output directory for this process, refusing while another launcher still holds it. */
function holdOutput(outputDir: string): () => Promise<void> {
  const path = join(outputDir, "launcher.pid");
  const holder = existsSync(path) ? Number(readFileSync(path, "utf8").trim()) : 0;
  if (processGroupExists(holder)) {
    throw new Error(`the launcher for ${outputDir} is still running as pid ${String(holder)}`);
  }
  writeWhole(path, `${String(runtimeProcess.pid)}\n`);
  return () => removeFile(path);
}

/** The environment every session runs in: this Bun first on PATH, in the shell Codex opens too, and
 *  no `.env` loaded by a Bun a session starts, since v2 keeps no `bunfig.toml` that turns it off. */
function sessionEnvironment(outputDir: string): SessionEnvironment {
  const bunExecutable = realpathSync(capturedExecPath);
  const bunDirectory = dirname(bunExecutable);
  const shellDirectory = join(outputDir, "shell-env");
  mkdirSync(shellDirectory, { recursive: true, mode: 0o700 });
  writeWhole(join(shellDirectory, ".zshenv"), 'export PATH="$CODEX_GPT_BUN_DIR:$PATH"\n');
  return {
    env: {
      ...Bun.env,
      PATH: [bunDirectory, Bun.env.PATH].filter(Boolean).join(delimiter),
      ZDOTDIR: shellDirectory,
      CODEX_GPT_BUN_DIR: bunDirectory,
      CODEX_GPT_SESSION: "1",
    },
    runtime: { bunVersion: Bun.version, bunExecutable },
  };
}

/** Whether a session can write only what it owns: it is read-only, or an owned path is its workdir.
 *  Codex starts only inside a Git work tree, where Git can undo what a session wrote, and such a
 *  session has nothing of anyone else's to undo. A lane run in a scratch folder outside every work
 *  tree died in 38 ms on 2026-09-30, "Not inside a trusted directory". */
function ownsAllItCanWrite({ sandbox, workdir, ownedPaths }: Session): boolean {
  if (sandbox === READ_ONLY) return true;
  return ownedPaths.some((path) => {
    const owned = resolve(workdir, path);
    return existsSync(owned) && realpathSync(owned) === workdir;
  });
}

/** The Codex call for one attempt: a fresh `exec` from the prompt, or `exec resume` of the thread
 *  Codex named. `exec resume` takes no `--sandbox`, so the sandbox travels as configuration. */
function codexArgs(
  session: Session,
  launch: LaunchRecord,
  reportPath: string,
  threadId: string | null,
): string[] {
  const search = launch.search ? ["--search"] : [];
  const shared = [
    "--model",
    launch.model,
    "--config",
    `model_reasoning_effort="${launch.reasoningEffort}"`,
    "--config",
    `service_tier="${launch.serviceTier}"`,
    ...(ownsAllItCanWrite(session) ? ["--skip-git-repo-check"] : []),
  ];
  const output = ["--json", "--output-last-message", reportPath];
  if (threadId === null) return [...search, "exec", ...shared, "--sandbox", session.sandbox, ...output, "-"];
  return [
    ...search,
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
  await removeFile(paths.reportPath);
  const eventFd = openSync(paths.eventPath, "a", 0o600);
  const stderrFd = openSync(paths.stderrPath, "a", 0o600);
  // Every attempt appends to the same logs; its outcome is read from where its own output begins.
  const from = { events: Bun.file(paths.eventPath).size, stderr: Bun.file(paths.stderrPath).size };
  try {
    const child = capturedSpawn({
      cmd: [run.codex, ...codexArgs(session, run.launch, paths.reportPath, threadId)],
      cwd: session.workdir,
      env: run.environment.env,
      stdin: new Blob([threadId === null ? session.prompt : RESUME_PROMPT]),
      stdout: eventFd,
      stderr: stderrFd,
    });
    await child.exited;
    return {
      exitCode: child.exitCode,
      signal: child.signalCode == null ? null : String(child.signalCode),
      spawnError: null,
      from,
    };
  } catch (error) {
    return { exitCode: null, signal: null, spawnError: errorMessage(error), from };
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
      recordResult(run.launch.outputDir, result);
      onSettled(result);
    }
  };
  await Promise.all(Array.from({ length: run.policy.maxActive }, worker));
}

async function execute(run: Execution): Promise<number> {
  const { outputDir, model, reasoningEffort, serviceTier } = run.launch;
  const { maxActive, startIntervalMs, retries } = run.policy;
  const sessionCount = run.sessions.length;
  console.log(
    capturedJsonStringify({
      type: "gpt_sessions.started",
      outputDir,
      sessionCount,
      model,
      reasoningEffort,
      serviceTier,
      runtime: run.environment.runtime,
      maxActive,
      startIntervalMs,
      retries,
    }),
  );
  let settled = 0;
  await runQueue(run, ({ name, status, failureKind, attempts }) => {
    settled += 1;
    const remainingCount = sessionCount - settled;
    console.log(
      capturedJsonStringify({
        type: "gpt_session.finished",
        name,
        status,
        failureKind,
        attempts,
        remainingCount,
      }),
    );
  });
  const summary = writeSummary(run.launch);
  const completedCount = summary.sessions.filter((row) => row.status === "completed").length;
  const failedCount = summary.sessions.length - completedCount;
  const rateLimitedCount = summary.sessions.filter((row) => row.failureKind === "rate-limit").length;
  const summaryPath = join(outputDir, SUMMARY_FILE);
  console.log(
    capturedJsonStringify({
      type: SUMMARY_TYPE,
      outputDir,
      summaryPath,
      completedCount,
      failedCount,
      rateLimitedCount,
    }),
  );
  return failedCount === 0 ? 0 : 1;
}

async function launchSessions(source: string, args: CommandArgs): Promise<number> {
  const condition = conditionOf(args.value("model"), args.value("reasoning-effort"));
  const manifest = asRecord(parseJsonAs<JsonValue>(readFileSync(source, "utf8")));
  if (manifest === null) throw new Error("--manifest must hold a JSON object");
  const sessions = sessionsOf(manifest);
  const { search = true } = manifest;
  if (!isBoolean(search)) throw new Error("search must be true or false");
  const policy = policyOf(args, sessions.length);
  const codex = codexBinary(args.value("codex-bin"));
  const outputDir = createOutputDir(args.required("output-dir"));
  const release = holdOutput(outputDir);
  try {
    const environment = sessionEnvironment(outputDir);
    const launch: LaunchRecord = {
      type: LAUNCH_TYPE,
      ...condition,
      search,
      runtime: environment.runtime,
      ...policy,
      outputDir,
      startedAt: new Date().toISOString(),
      sessions: sessions.map(
        ({ prompt, ...row }): SessionRecord => ({ ...row, promptSha256: sha256(prompt) }),
      ),
    };
    for (const { name, prompt } of sessions) writeWhole(sessionPaths(outputDir, name).promptPath, prompt);
    recordLaunch(launch);
    return await execute({ launch, sessions, policy, codex, environment });
  } finally {
    await release();
  }
}

/** A recorded session's prompt, from the bytes its launch sent. */
function recordedSession(outputDir: string, row: SessionRecord): Session {
  const { promptPath } = sessionPaths(outputDir, row.name);
  const prompt = existsSync(promptPath) ? readFileSync(promptPath, "utf8") : "";
  if (sha256(prompt) !== row.promptSha256) {
    throw new Error(`${promptPath} is absent or differs from the prompt launch.json records`);
  }
  return { name: row.name, prompt, workdir: row.workdir, sandbox: row.sandbox, ownedPaths: row.ownedPaths };
}

/** Run again only the sessions an earlier launch left without a completed result, under the model,
 *  effort and prompts it recorded, then write its summary over every session. */
async function retry(outputDir: string, args: CommandArgs): Promise<number> {
  const launch = readLaunch(outputDir);
  const release = holdOutput(outputDir);
  try {
    const sessions = launch.sessions
      .filter(({ name }) => readResult(outputDir, name)?.status !== "completed")
      .map((row) => recordedSession(outputDir, row));
    const policy = policyOf(args, sessions.length);
    const codex = codexBinary(args.value("codex-bin"));
    await removeFile(join(outputDir, SUMMARY_FILE));
    return await execute({ launch, sessions, policy, codex, environment: sessionEnvironment(outputDir) });
  } finally {
    await release();
  }
}

async function main(args: CommandArgs): Promise<number> {
  const modes = [...MODE_OPTIONS.keys()].filter((mode) => args.value(mode) !== null);
  const [mode] = modes;
  if (modes.length !== 1 || mode === undefined) {
    throw new Error("choose exactly one of --manifest, --retry or --drain");
  }
  const allowed = MODE_OPTIONS.get(mode) ?? [];
  const stray = Object.keys(OPTIONS).flatMap((name) =>
    name !== mode && !allowed.includes(name) && args.value(name) !== null ? [`--${name}`] : [],
  );
  if (stray.length > 0) throw new Error(`--${mode} does not take ${stray.join(" or ")}`);
  const target = args.required(mode);
  if (mode === "drain") {
    await drain(target);
    return 0;
  }
  return mode === "retry" ? retry(target, args) : launchSessions(target, args);
}

if (import.meta.main) await runCommand({ name: "gpt-sessions", usage: USAGE, options: OPTIONS }, main);
