import { sha256 } from "#src/meta/digest.ts";
import { capturedExecPath, runtimeProcess } from "#src/meta/process.ts";
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { tmpdir } from "#src/meta/os.ts";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "#src/meta/path.ts";
import {
  MODEL,
  SERVICE_TIER,
  BUNDLED_CODEX,
  HOMEBREW_CODEX,
  LAUNCH_SCHEMA_VERSION,
  SEEN_SCHEMA_VERSION,
  MAX_EVENT_PREFIX_BYTES,
  normalizeManifest,
  normalizeReasoningEffort,
  launchPolicy,
  absoluteExistingDirectory,
  type LaunchPolicy,
  type LunaSession,
} from "./luna-sessions-manifest.ts";
import { asError, errorCode } from "#src/meta/runtime-values.ts";
import { asRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { processExists } from "#skills/main/session.ts";
import { hasText } from "#src/meta/text.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";

type SessionEnvironment = {
  env: Record<string, string | undefined>;
  record: { bunVersion: string; bunExecutable: string };
};
type SessionArtifacts = { eventPath: string; stderrPath: string; reportPath: string; resultPath: string };
type SessionRunOptions = {
  codexBin: string;
  outputDir: string;
  env: Record<string, string | undefined>;
  ephemeral: boolean;
  reasoningEffort: string;
};
/** One finished session, as `<name>.result.json` records it. */
export type SessionResult = {
  name: string;
  status: "completed" | "failed" | "spawn-error";
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  failureKind: "spawn" | "rate-limit" | null;
  threadId: string | null;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  reportPath: string;
  eventPath: string;
  stderrPath: string;
};
/** The fields one report section prints, from a live result or a recorded one. */
type ReportRow = {
  name: string;
  status: string;
  threadId: string | null;
  durationMs: number | string;
  failureKind: string | null;
  error: string | null;
  reportPath: string;
  eventPath: string;
  stderrPath: string;
};
/** The launch record written to `launch.json` and handed to `onStart`. */
export type LaunchRecord = {
  schemaVersion: number;
  type: "luna_sessions.launch";
  model: string;
  reasoningEffort: string;
  serviceTier: string;
  runtime: SessionEnvironment["record"];
  maxActive: number;
  startIntervalMs: number;
  launchOnly: boolean;
  stress: boolean;
  outputDir: string;
  startedAt: string;
  sessions: { name: string; workdir: string; sandbox: string; ownedPaths: string[]; promptSha256: string }[];
};
/** The event handed to `onSessionFinish` as each session ends. */
export type SessionFinishedEvent = {
  type: "luna_session.finished";
  name: string;
  status: SessionResult["status"];
  failureKind: SessionResult["failureKind"];
  completedCount: number;
  remainingCount: number;
};
export type RunLunaOptions = {
  outputDir?: string | undefined;
  codexBin?: string | undefined;
  ephemeral?: boolean;
  launchOnly?: boolean;
  reasoningEffort?: string | undefined;
  onStart?: (launch: LaunchRecord) => void;
  onSessionFinish?: (event: SessionFinishedEvent) => void;
};
/** The summary written to `summary.json` once every session has ended. */
export type LunaSummary = Omit<LaunchRecord, "type" | "sessions"> & {
  type: "luna_sessions.completed";
  finishedAt: string;
  reportsPath: string;
  sessions: SessionResult[];
};
export type DrainResult = { outputDir: string; count: number; names: string[] };
type DrainLock = { fd: number; path: string };
type ReadLaunch = { sessionNames: string[]; outputDir: string; names: Set<string> };
type SeenReports = { path: string; names: Set<string> };
type Completion = { exitCode: number; signal: string | null; error: string | null };
type RegistryRecord = { threadId: string | undefined; pid: number; outputDir: string };
type SeenState = { schemaVersion: number; shown: string[]; updatedAt: string };
/** Every record this launcher writes through `atomicJson`. */
type RecordedJson = LaunchRecord | LunaSummary | SessionResult | RegistryRecord | SeenState;
type HookDecision = { decision?: "block"; reason?: string };

const RESULT_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "spawn-error"]);

/** A recorded value as a template literal spells it, with JSON for a nested value. */
function shown(value: unknown): string {
  if (isString(value)) return value;
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}

/** A recorded field read for a report: text kept, absent or null read as null. */
function shownOrNull(value: JsonValue | undefined): string | null {
  return value === undefined || value === null ? null : shown(value);
}

function resolveCodexBinary(override: string | undefined): string {
  const candidate = override ?? [BUNDLED_CODEX, HOMEBREW_CODEX].find(existsSync) ?? "codex";
  if (candidate.includes("/")) {
    if (!isAbsolute(candidate)) throw new Error("--codex-bin must be absolute");
    accessSync(candidate, constants.X_OK);
  }
  return candidate;
}

function createOutputDirectory(explicit: string | undefined): string {
  // The product prefix puts an abandoned output directory under the temp-root census and the
  // launch-time cleaner, which move only `ana-` directories untouched for two days.
  if (!hasText(explicit)) return realpathSync(mkdtempSync(join(tmpdir(), "ana-luna-sessions-")));
  if (!isAbsolute(explicit)) throw new Error("--output-dir must be absolute");
  const target = resolve(explicit);
  if (existsSync(target)) throw new Error("--output-dir must not already exist");
  const parent = realpathSync(dirname(target));
  const output = join(parent, basename(target));
  mkdirSync(output, { mode: 0o700 });
  return output;
}

function createSessionEnvironment(outputDir: string): SessionEnvironment {
  const executable = realpathSync(capturedExecPath);
  const runtimeDirectory = dirname(executable);
  const shellDirectory = join(outputDir, "shell-env");
  mkdirSync(shellDirectory, { mode: 0o700 });
  writeFileSync(join(shellDirectory, ".zshenv"), 'export PATH="$CODEX_LUNA_BUN_DIR:$PATH"\n', {
    mode: 0o600,
  });
  return {
    env: {
      ...Bun.env,
      PATH: [runtimeDirectory, Bun.env.PATH].filter(Boolean).join(delimiter),
      ZDOTDIR: shellDirectory,
      CODEX_LUNA_BUN_DIR: runtimeDirectory,
      CODEX_LUNA_SESSION: "1",
    },
    record: {
      bunVersion: Bun.version,
      bunExecutable: executable,
    },
  };
}

function sessionPrompt(session: LunaSession): string {
  if (session.sandbox === "read-only") {
    return `${session.prompt}\n\nAuthority: read-only. Do not edit files or change external state.`;
  }
  return [
    session.prompt,
    "",
    `Authority: workspace-write. You own only: ${session.ownedPaths.join(", ")}.`,
    "Other agents may be editing the repository. Preserve their work and do not revert it.",
  ].join("\n");
}

function sessionArtifacts(outputDir: string, name: string): SessionArtifacts {
  return {
    eventPath: join(outputDir, `${name}.jsonl`),
    stderrPath: join(outputDir, `${name}.stderr.log`),
    reportPath: join(outputDir, `${name}.md`),
    resultPath: join(outputDir, `${name}.result.json`),
  };
}

function atomicJson(path: string, value: RecordedJson, replace = false): void {
  if (!replace && existsSync(path)) throw new Error(`refusing to overwrite ${path}`);
  const temporary = `${path}.tmp-${runtimeProcess.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    if (replace) {
      renameSync(temporary, path);
    } else {
      linkSync(temporary, path);
      unlinkSync(temporary);
    }
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function launchRegistryPath(threadId: unknown = Bun.env.CODEX_THREAD_ID): string | null {
  if (!isString(threadId) || !/^[a-zA-Z0-9_-]{8,128}$/.test(threadId)) return null;
  const directory = join(tmpdir(), "codex-luna-swarm");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return join(directory, `${threadId}.json`);
}

function registerParentLaunch(launch: Pick<LaunchRecord, "outputDir">): string | null {
  const path = launchRegistryPath();
  if (!hasText(path)) return null;
  if (regularFileExists(path)) {
    const previous = asRecord(readJsonFile(path));
    if (processExists(previous?.pid)) {
      throw new Error(
        `another Luna launcher is already active for this Codex task: ${shown(previous?.outputDir)}`,
      );
    }
  }
  atomicJson(
    path,
    {
      threadId: Bun.env.CODEX_THREAD_ID,
      pid: runtimeProcess.pid,
      outputDir: launch.outputDir,
    },
    true,
  );
  return path;
}

function regularFileExists(path: string): boolean {
  return existsSync(path) && lstatSync(path).isFile();
}

function threadIdFromEvents(path: string): string | null {
  if (!regularFileExists(path)) return null;
  const length = Math.min(statSync(path).size, MAX_EVENT_PREFIX_BYTES);
  if (length === 0) return null;
  const buffer = new Uint8Array(length);
  const fd = openSync(path, "r");
  let bytesRead: number;
  try {
    bytesRead = readSync(fd, buffer, 0, length, 0);
  } finally {
    closeSync(fd);
  }
  for (const line of new TextDecoder().decode(buffer.subarray(0, bytesRead)).split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const event = asRecord(capturedJsonParse(line));
      const threadId = event?.thread_id;
      if (event?.type === "thread.started" && isString(threadId) && /^[a-zA-Z0-9_-]{8,128}$/.test(threadId)) {
        return threadId;
      }
    } catch {
      // A malformed diagnostic line is preserved in the event log and ignored here.
    }
  }
  return null;
}

async function runSession(session: LunaSession, options: SessionRunOptions): Promise<SessionResult> {
  const { eventPath, stderrPath, reportPath } = sessionArtifacts(options.outputDir, session.name);
  const eventFd = openSync(eventPath, "wx", 0o600);
  const stderrFd = openSync(stderrPath, "wx", 0o600);
  const args: string[] = [
    "exec",
    "--model",
    MODEL,
    "--config",
    `model_reasoning_effort="${options.reasoningEffort}"`,
    "--config",
    `service_tier="${SERVICE_TIER}"`,
    "--sandbox",
    session.sandbox,
    "--json",
    "--output-last-message",
    reportPath,
  ];
  if (options.ephemeral) args.push("--ephemeral");
  args.push("-");

  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  let child;
  try {
    child = Bun.spawn({
      cmd: [options.codexBin, ...args],
      cwd: session.workdir,
      env: options.env,
      stdin: "pipe",
      stdout: eventFd,
      stderr: stderrFd,
    });
  } catch (error) {
    closeSync(eventFd);
    closeSync(stderrFd);
    return {
      name: session.name,
      status: "spawn-error",
      exitCode: null,
      signal: null,
      error: sanitizeTerminalText(String(error)),
      failureKind: "spawn",
      threadId: threadIdFromEvents(eventPath),
      durationMs: Date.now() - startedAt,
      startedAt: startedAtIso,
      finishedAt: new Date().toISOString(),
      reportPath,
      eventPath,
      stderrPath,
    };
  }
  closeSync(eventFd);
  closeSync(stderrFd);
  try {
    await child.stdin.write(sessionPrompt(session));
    await child.stdin.end();
  } catch {
    // The child may close stdin before consuming a prompt; its exit receipt remains authoritative.
  }
  const exitCode = await child.exited;
  const completion: Completion = {
    exitCode,
    signal: child.signalCode ?? null,
    error: null,
  };
  const reportExists = regularFileExists(reportPath);
  const completed = completion.exitCode === 0 && reportExists;
  const classifiedFailure =
    !completed &&
    /(?:\b429\b|too many requests|rate.?limit)/i.test(
      [stderrPath, eventPath]
        .flatMap((path) => (regularFileExists(path) ? [readFileSync(path, "utf8")] : []))
        .join("\n"),
    )
      ? "rate-limit"
      : null;
  return {
    name: session.name,
    status: completed ? "completed" : "failed",
    exitCode: completion.exitCode,
    signal: completion.signal,
    error:
      completion.error ??
      (classifiedFailure === "rate-limit" ? "Codex session was rate limited" : null) ??
      (completion.exitCode === 0 && !reportExists
        ? "Codex exited successfully without writing a report"
        : null),
    failureKind: classifiedFailure,
    threadId: threadIdFromEvents(eventPath),
    durationMs: Date.now() - startedAt,
    startedAt: startedAtIso,
    finishedAt: new Date().toISOString(),
    reportPath,
    eventPath,
    stderrPath,
  };
}

async function runSessionQueue(
  sessions: readonly LunaSession[],
  policy: LaunchPolicy,
  run: (session: LunaSession, index: number) => Promise<SessionResult>,
): Promise<SessionResult[]> {
  const results: SessionResult[] = [];
  const active = new Set<Promise<void>>();
  let previousStart = 0;
  for (const [index, session] of sessions.entries()) {
    while (active.size >= policy.maxActive) await Promise.race(active);
    const remainingDelay = previousStart + policy.startIntervalMs - Date.now();
    if (remainingDelay > 0) await Bun.sleep(remainingDelay);
    previousStart = Date.now();
    const pending: Promise<void> = run(session, index)
      .then((result) => {
        results[index] = result;
      })
      .finally(() => active.delete(pending));
    active.add(pending);
  }
  await Promise.all(active);
  return results;
}

function reportSection(result: ReportRow): string {
  const report = regularFileExists(result.reportPath)
    ? sanitizeTerminalText(readFileSync(result.reportPath, "utf8")).trimEnd()
    : "(No report file was produced. Inspect the stderr and JSONL paths below.)";
  return [
    `## ${result.name}`,
    "",
    `Status: ${result.status}`,
    `Thread: ${result.threadId ?? "none"}`,
    `Duration: ${result.durationMs} ms`,
    `JSONL: ${result.eventPath}`,
    `Stderr: ${result.stderrPath}`,
    hasText(result.failureKind) ? `Failure kind: ${result.failureKind}` : null,
    hasText(result.error) ? `Error: ${result.error}` : null,
    "",
    report,
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function sanitizeTerminalText(value: string): string {
  // Each directive sits on the declaration it excuses, so a reflow cannot separate them.
  // eslint-disable-next-line no-control-regex -- the control characters are what this strips.
  const escapes = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\)?)/g;
  // eslint-disable-next-line no-control-regex -- the control characters are what this strips.
  const control = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;
  return value.replace(escapes, "").replace(/\r\n?/g, "\n").replace(control, "");
}
async function runLunaSessions(rawManifest: unknown, options: RunLunaOptions = {}): Promise<LunaSummary> {
  const sessions = normalizeManifest(rawManifest);
  const policy = launchPolicy(rawManifest, sessions.length);
  const reasoningEffort = normalizeReasoningEffort(options.reasoningEffort);
  const stress = !Array.isArray(rawManifest) && asRecord(rawManifest)?.stress === true;
  const outputDir = createOutputDirectory(options.outputDir);
  const codexBin = resolveCodexBinary(options.codexBin);
  const sessionEnvironment = createSessionEnvironment(outputDir);
  const startedAt = new Date().toISOString();
  const launch: LaunchRecord = {
    schemaVersion: LAUNCH_SCHEMA_VERSION,
    type: "luna_sessions.launch",
    model: MODEL,
    reasoningEffort,
    serviceTier: SERVICE_TIER,
    runtime: sessionEnvironment.record,
    maxActive: policy.maxActive,
    startIntervalMs: policy.startIntervalMs,
    launchOnly: options.launchOnly === true,
    stress,
    outputDir,
    startedAt,
    sessions: sessions.map((session) => ({
      name: session.name,
      workdir: session.workdir,
      sandbox: session.sandbox,
      ownedPaths: session.ownedPaths,
      promptSha256: sha256(sessionPrompt(session)),
    })),
  };
  atomicJson(join(outputDir, "launch.json"), launch);
  if (options.onStart !== undefined) options.onStart(launch);
  let completedCount = 0;
  const results = await runSessionQueue(sessions, policy, async (session) => {
    const result = await runSession(session, {
      codexBin,
      outputDir,
      env: sessionEnvironment.env,
      ephemeral: options.ephemeral === true,
      reasoningEffort,
    });
    atomicJson(sessionArtifacts(outputDir, session.name).resultPath, result);
    completedCount += 1;
    if (options.onSessionFinish !== undefined) {
      options.onSessionFinish({
        type: "luna_session.finished",
        name: result.name,
        status: result.status,
        failureKind: result.failureKind,
        completedCount,
        remainingCount: sessions.length - completedCount,
      });
    }
    return result;
  });
  const reportsPath = join(outputDir, "reports.md");
  const reports = ["# Luna session reports", "", ...results.map(reportSection)].join("\n");
  writeFileSync(reportsPath, `${reports.trimEnd()}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const summary: LunaSummary = {
    schemaVersion: LAUNCH_SCHEMA_VERSION,
    type: "luna_sessions.completed",
    model: MODEL,
    reasoningEffort,
    serviceTier: SERVICE_TIER,
    runtime: sessionEnvironment.record,
    maxActive: policy.maxActive,
    startIntervalMs: policy.startIntervalMs,
    launchOnly: options.launchOnly === true,
    stress,
    outputDir,
    startedAt,
    finishedAt: new Date().toISOString(),
    reportsPath,
    sessions: results,
  };
  atomicJson(join(outputDir, "summary.json"), summary);
  return summary;
}

function readLaunch(outputDirectory: string): ReadLaunch {
  const outputDir = absoluteExistingDirectory(outputDirectory, "--drain");
  const path = join(outputDir, "launch.json");
  if (!regularFileExists(path)) throw new Error(`not a Luna session output directory: ${outputDir}`);
  const launch = asRecord(readJsonFile(path));
  let recordedOutputDir: string | null = null;
  try {
    if (isString(launch?.outputDir)) {
      recordedOutputDir = absoluteExistingDirectory(launch.outputDir, "launch.outputDir");
    }
  } catch {
    // The structural check below reports one stable invalid-record error.
  }
  if (
    launch?.schemaVersion !== LAUNCH_SCHEMA_VERSION ||
    launch?.type !== "luna_sessions.launch" ||
    recordedOutputDir !== outputDir ||
    !Array.isArray(launch?.sessions)
  ) {
    throw new Error(`invalid Luna launch record: ${path}`);
  }
  const names = new Set<string>();
  const sessionNames: string[] = [];
  for (const session of launch.sessions) {
    const name = asRecord(session)?.name;
    if (!isString(name) || !/^[a-z][a-z0-9_]{0,47}$/.test(name)) {
      throw new Error(`invalid session in Luna launch record: ${path}`);
    }
    if (names.has(name)) throw new Error(`duplicate session in Luna launch record: ${name}`);
    names.add(name);
    sessionNames.push(name);
  }
  return { sessionNames, outputDir, names };
}

function stopHook(): HookDecision {
  if (Bun.env.CODEX_LUNA_SESSION === "1") return {};
  const block = (reason: string): HookDecision => ({ decision: "block", reason });
  let parsed: JsonValue;
  try {
    parsed = capturedJsonParse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
  const input = asRecord(parsed);
  const path = launchRegistryPath(input?.session_id);
  if (!hasText(path) || !regularFileExists(path) || lstatSync(path).isSymbolicLink()) return {};
  let recorded: JsonValue;
  try {
    recorded = readJsonFile(path);
  } catch {
    unlinkSync(path);
    return block("The Luna launcher registry is unreadable. Inspect its terminal.");
  }
  // A null hook input or registry record has always ended the hook with a TypeError here.
  if (parsed === null || recorded === null) throw new TypeError("stop hook input or launch registry is null");
  const record = asRecord(recorded);
  const outputDir = record?.outputDir;
  if (record?.threadId !== input?.session_id || !isString(outputDir)) return {};
  const terminal = regularFileExists(join(outputDir, "summary.json"));
  if (!terminal && processExists(record?.pid)) {
    return block(
      `The Luna launcher is active at ${outputDir}. Poll it, follow luna_session.finished events, and drain reports before ending.`,
    );
  }
  unlinkSync(path);
  return block(
    terminal
      ? `The Luna launcher finished at ${outputDir}. Drain and settle it.`
      : `The Luna launcher stopped unexpectedly at ${outputDir}. Inspect its terminal and missing sessions.`,
  );
}

function acquireDrainLock(outputDir: string): DrainLock {
  const path = join(outputDir, ".drain.lock");
  const create = (): DrainLock => {
    const fd = openSync(path, "wx", 0o600);
    try {
      writeFileSync(
        fd,
        `${JSON.stringify({ pid: runtimeProcess.pid, createdAt: new Date().toISOString() })}\n`,
      );
      return { fd, path };
    } catch (error) {
      closeSync(fd);
      try {
        unlinkSync(path);
      } catch (unlinkError) {
        if (errorCode(unlinkError) !== "ENOENT") throw unlinkError;
      }
      throw error;
    }
  };
  try {
    return create();
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    let owner: JsonValue;
    try {
      owner = readJsonFile(path);
    } catch {
      throw new Error(`another drain owns ${path}; its lock record is unreadable`);
    }
    if (processExists(asRecord(owner)?.pid)) {
      throw new Error(`another drain is active for ${outputDir}`, { cause: error });
    }
    try {
      unlinkSync(path);
    } catch (unlinkError) {
      if (errorCode(unlinkError) !== "ENOENT") throw unlinkError;
    }
    return create();
  }
}

function releaseDrainLock(lock: DrainLock): void {
  // Both failures are worth reporting, and a throw inside `finally` would drop the first one.
  // The unlink runs either way and wins, because a lock file left behind blocks the next drain.
  let closeFailure: Error | null = null;
  try {
    closeSync(lock.fd);
  } catch (error) {
    closeFailure = asError(error);
  }
  try {
    unlinkSync(lock.path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  if (closeFailure !== null) throw closeFailure;
}

function readSeen(outputDir: string, validNames: ReadonlySet<string>): SeenReports {
  const path = join(outputDir, ".seen-reports.json");
  if (!existsSync(path)) return { path, names: new Set() };
  if (!regularFileExists(path)) throw new Error(`invalid seen-report state: ${path}`);
  const state = asRecord(readJsonFile(path));
  const shownNames = state?.shown;
  if (state?.schemaVersion !== SEEN_SCHEMA_VERSION || !Array.isArray(shownNames)) {
    throw new Error(`invalid seen-report state: ${path}`);
  }
  const names = new Set<string>();
  for (const name of shownNames) {
    if (!isString(name) || !validNames.has(name)) {
      throw new Error(`seen-report state contains an unknown session: ${shown(name)}`);
    }
    names.add(name);
  }
  return { path, names };
}

async function drainReports(
  outputDirectory: string,
  emit: (value: string) => Promise<void> = writeStdout,
): Promise<DrainResult> {
  const { sessionNames, outputDir, names: validNames } = readLaunch(outputDirectory);
  const lock = acquireDrainLock(outputDir);
  try {
    const seen = readSeen(outputDir, validNames);
    const unseen: ReportRow[] = [];
    for (const name of sessionNames) {
      if (seen.names.has(name)) continue;
      const artifacts = sessionArtifacts(outputDir, name);
      if (!regularFileExists(artifacts.resultPath)) continue;
      const result = asRecord(readJsonFile(artifacts.resultPath));
      const status = result?.status;
      if (result?.name !== name || !isString(status) || !RESULT_STATUSES.has(status)) {
        throw new Error(`invalid Luna session result: ${artifacts.resultPath}`);
      }
      unseen.push({
        name,
        status,
        threadId: shownOrNull(result.threadId),
        durationMs: shown(result.durationMs),
        failureKind: shownOrNull(result.failureKind),
        error: shownOrNull(result.error),
        reportPath: artifacts.reportPath,
        eventPath: artifacts.eventPath,
        stderrPath: artifacts.stderrPath,
      });
    }
    if (unseen.length === 0) return { outputDir, count: 0, names: [] };

    const output = `${unseen.map(reportSection).join("\n").trimEnd()}\n`;
    await emit(output);
    for (const result of unseen) seen.names.add(result.name);
    atomicJson(
      seen.path,
      {
        schemaVersion: SEEN_SCHEMA_VERSION,
        shown: sessionNames.filter((name) => seen.names.has(name)),
        updatedAt: new Date().toISOString(),
      },
      true,
    );
    return { outputDir, count: unseen.length, names: unseen.map((result) => result.name) };
  } finally {
    releaseDrainLock(lock);
  }
}

async function writeStdout(value: string): Promise<void> {
  if (value) await Bun.write(Bun.stdout, value);
}

export { drainReports, registerParentLaunch, runLunaSessions, sanitizeTerminalText, stopHook, writeStdout };
