import { sha256 } from "#src/meta/digest.ts";
import { runtimeProcess } from "#src/meta/process.ts";
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
} from "./luna-sessions-manifest.mjs";
import { asError } from "#src/meta/runtime-values.ts";
import { isFunction, isString } from "#src/meta/json-shape.ts";
import { hasText } from "#src/meta/text.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";

function resolveCodexBinary(override) {
  const candidate = override ?? [BUNDLED_CODEX, HOMEBREW_CODEX].find(existsSync) ?? "codex";
  if (candidate.includes("/")) {
    if (!isAbsolute(candidate)) throw new Error("--codex-bin must be absolute");
    accessSync(candidate, constants.X_OK);
  }
  return candidate;
}

function createOutputDirectory(explicit) {
  // The product prefix puts an abandoned output directory under the temp-root census and the
  // launch-time cleaner, which move only `ana-` directories untouched for two days.
  if (!explicit) return realpathSync(mkdtempSync(join(tmpdir(), "ana-luna-sessions-")));
  if (!isAbsolute(explicit)) throw new Error("--output-dir must be absolute");
  const target = resolve(explicit);
  if (existsSync(target)) throw new Error("--output-dir must not already exist");
  const parent = realpathSync(dirname(target));
  const output = join(parent, basename(target));
  mkdirSync(output, { mode: 0o700 });
  return output;
}

function createSessionEnvironment(outputDir) {
  const executable = realpathSync(Bun.argv[0]);
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

function sessionPrompt(session) {
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

function sessionArtifacts(outputDir, name) {
  return {
    eventPath: join(outputDir, `${name}.jsonl`),
    stderrPath: join(outputDir, `${name}.stderr.log`),
    reportPath: join(outputDir, `${name}.md`),
    resultPath: join(outputDir, `${name}.result.json`),
  };
}

function atomicJson(path, value, replace = false) {
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

function launchRegistryPath(threadId = Bun.env.CODEX_THREAD_ID) {
  if (!isString(threadId) || !/^[a-zA-Z0-9_-]{8,128}$/.test(threadId)) return null;
  const directory = join(tmpdir(), "codex-luna-swarm");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return join(directory, `${threadId}.json`);
}

function registerParentLaunch(launch) {
  const path = launchRegistryPath();
  if (!hasText(path)) return null;
  if (regularFileExists(path)) {
    const previous = readJsonFile(path);
    if (processIsAlive(previous?.pid)) {
      throw new Error(`another Luna launcher is already active for this Codex task: ${previous.outputDir}`);
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

function regularFileExists(path) {
  return existsSync(path) && lstatSync(path).isFile();
}

function threadIdFromEvents(path) {
  if (!regularFileExists(path)) return null;
  const length = Math.min(statSync(path).size, MAX_EVENT_PREFIX_BYTES);
  if (length === 0) return null;
  const buffer = new Uint8Array(length);
  const fd = openSync(path, "r");
  let bytesRead;
  try {
    bytesRead = readSync(fd, buffer, 0, length, 0);
  } finally {
    closeSync(fd);
  }
  for (const line of new TextDecoder().decode(buffer.subarray(0, bytesRead)).split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const event = JSON.parse(line);
      if (
        event.type === "thread.started" &&
        isString(event.thread_id) &&
        /^[a-zA-Z0-9_-]{8,128}$/.test(event.thread_id)
      ) {
        return event.thread_id;
      }
    } catch {
      // A malformed diagnostic line is preserved in the event log and ignored here.
    }
  }
  return null;
}

async function runSession(session, options) {
  const { eventPath, stderrPath, reportPath } = sessionArtifacts(options.outputDir, session.name);
  const eventFd = openSync(eventPath, "wx", 0o600);
  const stderrFd = openSync(stderrPath, "wx", 0o600);
  const args = [
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
      error: sanitizeTerminalText(error),
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
    child.stdin.write(sessionPrompt(session));
    child.stdin.end();
  } catch {
    // The child may close stdin before consuming a prompt; its exit receipt remains authoritative.
  }
  const exitCode = await child.exited;
  const completion = { exitCode, signal: child.signalCode ?? null, error: null };
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

async function runSessionQueue(sessions, policy, run) {
  const results = Array(sessions.length);
  const active = new Set();
  let previousStart = 0;
  for (let index = 0; index < sessions.length; index += 1) {
    while (active.size >= policy.maxActive) await Promise.race(active);
    const remainingDelay = previousStart + policy.startIntervalMs - Date.now();
    if (remainingDelay > 0) await Bun.sleep(remainingDelay);
    previousStart = Date.now();
    let pending;
    pending = run(sessions[index], index)
      .then((result) => {
        results[index] = result;
      })
      .finally(() => active.delete(pending));
    active.add(pending);
  }
  await Promise.all(active);
  return results;
}

function reportSection(result) {
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
    result.failureKind ? `Failure kind: ${result.failureKind}` : null,
    result.error ? `Error: ${result.error}` : null,
    "",
    report,
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function sanitizeTerminalText(value) {
  // Each directive sits on the declaration it excuses, so a reflow cannot separate them.
  // eslint-disable-next-line no-control-regex -- the control characters are what this strips.
  const escapes = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\)?)/g;
  // eslint-disable-next-line no-control-regex -- the control characters are what this strips.
  const control = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;
  return String(value).replace(escapes, "").replace(/\r\n?/g, "\n").replace(control, "");
}
async function runLunaSessions(rawManifest, options = {}) {
  const sessions = normalizeManifest(rawManifest);
  const policy = launchPolicy(rawManifest, sessions.length);
  const reasoningEffort = normalizeReasoningEffort(options.reasoningEffort);
  const stress = !Array.isArray(rawManifest) && rawManifest?.stress === true;
  const outputDir = createOutputDirectory(options.outputDir);
  const codexBin = resolveCodexBinary(options.codexBin);
  const sessionEnvironment = createSessionEnvironment(outputDir);
  const startedAt = new Date().toISOString();
  const launch = {
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
  if (isFunction(options.onStart)) options.onStart(launch);
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
    if (isFunction(options.onSessionFinish)) {
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
  const summary = {
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

function readLaunch(outputDirectory) {
  const outputDir = absoluteExistingDirectory(outputDirectory, "--drain");
  const path = join(outputDir, "launch.json");
  if (!regularFileExists(path)) throw new Error(`not a Luna session output directory: ${outputDir}`);
  const launch = readJsonFile(path);
  let recordedOutputDir = null;
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
  const names = new Set();
  for (const session of launch.sessions) {
    if (!session || !isString(session.name) || !/^[a-z][a-z0-9_]{0,47}$/.test(session.name)) {
      throw new Error(`invalid session in Luna launch record: ${path}`);
    }
    if (names.has(session.name)) throw new Error(`duplicate session in Luna launch record: ${session.name}`);
    names.add(session.name);
  }
  return { launch, outputDir, names };
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    runtimeProcess.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function stopHook() {
  if (Bun.env.CODEX_LUNA_SESSION === "1") return {};
  const block = (reason) => ({ decision: "block", reason });
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
  const path = launchRegistryPath(input?.session_id);
  if (!hasText(path) || !regularFileExists(path) || lstatSync(path).isSymbolicLink()) return {};
  let record;
  try {
    record = readJsonFile(path);
  } catch {
    unlinkSync(path);
    return block("The Luna launcher registry is unreadable. Inspect its terminal.");
  }
  if (record.threadId !== input.session_id || !isString(record.outputDir)) return {};
  const terminal = regularFileExists(join(record.outputDir, "summary.json"));
  if (!terminal && processIsAlive(record.pid)) {
    return block(
      `The Luna launcher is active at ${record.outputDir}. Poll it, follow luna_session.finished events, and drain reports before ending.`,
    );
  }
  unlinkSync(path);
  return block(
    terminal
      ? `The Luna launcher finished at ${record.outputDir}. Drain and settle it.`
      : `The Luna launcher stopped unexpectedly at ${record.outputDir}. Inspect its terminal and missing sessions.`,
  );
}

function acquireDrainLock(outputDir) {
  const path = join(outputDir, ".drain.lock");
  const create = () => {
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
        if (unlinkError?.code !== "ENOENT") throw unlinkError;
      }
      throw error;
    }
  };
  try {
    return create();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let owner;
    try {
      owner = readJsonFile(path);
    } catch {
      throw new Error(`another drain owns ${path}; its lock record is unreadable`);
    }
    if (processIsAlive(owner?.pid)) {
      throw new Error(`another drain is active for ${outputDir}`, { cause: error });
    }
    try {
      unlinkSync(path);
    } catch (unlinkError) {
      if (unlinkError?.code !== "ENOENT") throw unlinkError;
    }
    return create();
  }
}

function releaseDrainLock(lock) {
  // Both failures are worth reporting, and a throw inside `finally` would drop the first one.
  // The unlink runs either way and wins, because a lock file left behind blocks the next drain.
  let closeFailure = null;
  try {
    closeSync(lock.fd);
  } catch (error) {
    closeFailure = asError(error);
  }
  try {
    unlinkSync(lock.path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (closeFailure !== null) throw closeFailure;
}

function readSeen(outputDir, validNames) {
  const path = join(outputDir, ".seen-reports.json");
  if (!existsSync(path)) return { path, names: new Set() };
  if (!regularFileExists(path)) throw new Error(`invalid seen-report state: ${path}`);
  const state = readJsonFile(path);
  if (state?.schemaVersion !== SEEN_SCHEMA_VERSION || !Array.isArray(state?.shown)) {
    throw new Error(`invalid seen-report state: ${path}`);
  }
  const names = new Set();
  for (const name of state.shown) {
    if (!isString(name) || !validNames.has(name)) {
      throw new Error(`seen-report state contains an unknown session: ${String(name)}`);
    }
    names.add(name);
  }
  return { path, names };
}

async function drainReports(outputDirectory, emit = writeStdout) {
  const { launch, outputDir, names: validNames } = readLaunch(outputDirectory);
  const lock = acquireDrainLock(outputDir);
  try {
    const seen = readSeen(outputDir, validNames);
    const unseen = [];
    for (const session of launch.sessions) {
      if (seen.names.has(session.name)) continue;
      const artifacts = sessionArtifacts(outputDir, session.name);
      if (!regularFileExists(artifacts.resultPath)) continue;
      const result = readJsonFile(artifacts.resultPath);
      if (
        result?.name !== session.name ||
        !new Set(["completed", "failed", "spawn-error"]).has(result?.status)
      ) {
        throw new Error(`invalid Luna session result: ${artifacts.resultPath}`);
      }
      unseen.push({
        ...result,
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
        shown: launch.sessions.map((session) => session.name).filter((name) => seen.names.has(name)),
        updatedAt: new Date().toISOString(),
      },
      true,
    );
    return { outputDir, count: unseen.length, names: unseen.map((result) => result.name) };
  } finally {
    releaseDrainLock(lock);
  }
}

async function writeStdout(value) {
  if (value) await Bun.write(Bun.stdout, value);
}

export { drainReports, registerParentLaunch, runLunaSessions, sanitizeTerminalText, stopHook, writeStdout };
