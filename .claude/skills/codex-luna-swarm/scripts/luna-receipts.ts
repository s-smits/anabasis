/**
 * What a Luna launch records, and how its reports are read back: the launch record, one result per
 * session, `reports.md`, the summary every WRI reader joins by session name, and the drain. A
 * session's outcome is decided here once, from its last attempt, and every reader takes that
 * decision. `luna-sessions.ts` runs the sessions and hands each one's last attempt here.
 */
import { readJsonFileOrNull, writeAtomic } from "#src/meta/completed-json.ts";
import { appendFileSync, existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";

/** One session as `launch.json` records it. The prompt's bytes sit beside it in `<name>.prompt.md`. */
export interface SessionRecord {
  name: string;
  workdir: string;
  sandbox: string;
  ownedPaths: string[];
  promptSha256: string;
}

/** The launch record, written once as `launch.json` and never rewritten, not even by `--retry`. */
export interface LaunchRecord {
  schemaVersion: number;
  type: string;
  model: string;
  reasoningEffort: string;
  serviceTier: string;
  runtime: { bunVersion: string; bunExecutable: string };
  maxActive: number;
  startIntervalMs: number;
  retries: number;
  launchOnly: boolean;
  outputDir: string;
  startedAt: string;
  sessions: SessionRecord[];
}

/** How one attempt ended, as the launcher saw the process, and where its own output begins: the
 *  session's event log and stderr are appended to by every attempt. */
export interface AttemptEnd {
  exitCode: number | null;
  signal: string | null;
  spawnError: string | null;
  from: { events: number; stderr: number };
}

/** One settled session, as `<name>.result.json` records it. The failure kind says why a failed
 *  session failed when the launcher can tell: Codex never started, or Codex said it was limited. */
export interface SessionResult {
  name: string;
  status: "completed" | "failed";
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  failureKind: "spawn" | "rate-limit" | null;
  threadId: string | null;
  attempts: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  reportPath: string;
  eventPath: string;
  stderrPath: string;
}

/** The summary written once every session of a launch, or of a retry, has settled. */
export type LunaSummary = Omit<LaunchRecord, "sessions"> & {
  finishedAt: string;
  reportsPath: string;
  sessions: SessionResult[];
};

type SessionPaths = ReturnType<typeof sessionPaths>;

export const LAUNCH_TYPE = "luna_sessions.launch";
export const SUMMARY_TYPE = "luna_sessions.completed";
export const LAUNCH_FILE = "launch.json";
export const SUMMARY_FILE = "summary.json";
/** The first event of a Codex thread, which names it: `{"type":"thread.started","thread_id":…}`. */
const THREAD_STARTED = /^\{"type":"thread\.started","thread_id":"([\w-]{8,128})"/m;
const RATE_LIMIT = /(?:\b429\b|too many requests|rate.?limit)/i;
const DRAIN_SCHEMA_VERSION = 1;

/** Where a session's prompt, event log, stderr, report and result live. */
export function sessionPaths(outputDir: string, name: string) {
  return {
    promptPath: join(outputDir, `${name}.prompt.md`),
    eventPath: join(outputDir, `${name}.jsonl`),
    stderrPath: join(outputDir, `${name}.stderr.log`),
    reportPath: join(outputDir, `${name}.md`),
    resultPath: join(outputDir, `${name}.result.json`),
  };
}

function bytesOf(path: string): Uint8Array {
  return existsSync(path) ? readFileSync(path) : new Uint8Array();
}

function textOf(path: string, from = 0): string {
  return new TextDecoder().decode(bytesOf(path).subarray(from));
}

export function writeRecord<T>(path: string, value: T): void {
  writeAtomic(path, `${capturedJsonStringify(value, null, 2)}\n`);
}

export function readLaunch(outputDir: string): LaunchRecord {
  const path = join(outputDir, LAUNCH_FILE);
  const launch = existsSync(path) ? parseJsonAs<LaunchRecord | null>(readFileSync(path, "utf8")) : null;
  if (launch?.type !== LAUNCH_TYPE || !Array.isArray(launch.sessions)) {
    throw new Error(`not a Luna launch directory: ${outputDir}`);
  }
  return launch;
}

export function readResult(outputDir: string, name: string): SessionResult | null {
  const path = sessionPaths(outputDir, name).resultPath;
  return existsSync(path) ? parseJsonAs<SessionResult>(readFileSync(path, "utf8")) : null;
}

/** The thread Codex named in this session's event log, which `codex exec resume` continues. */
export function threadIdOf(eventPath: string): string | null {
  return THREAD_STARTED.exec(textOf(eventPath))?.[1] ?? null;
}

/** Text safe to print into a terminal: escape sequences, control characters and the bidirectional
 *  overrides that make a line read differently from its bytes are dropped. */
function printable(text: string): string {
  const shown = (char: string): boolean => {
    const code = char.codePointAt(0) ?? 0;
    return (
      code === 9 ||
      code === 10 ||
      (code >= 0x20 &&
        !(code >= 0x7f && code <= 0x9f) &&
        !(code >= 0x202a && code <= 0x202e) &&
        !(code >= 0x2066 && code <= 0x2069))
    );
  };
  return Array.from(Bun.stripANSI(text).replaceAll("\r\n", "\n").replaceAll("\r", "\n"))
    .filter(shown)
    .join("");
}

/** Why a failed attempt failed, when the launcher can tell: Codex never started, or Codex itself
 *  said in this attempt, on stderr or in its own `error` and `turn.failed` events, that it was rate
 *  limited. A command's output is what the session read, not what Codex said: the 2026-09-25 lanes
 *  stopped by SIGTERM were all labelled rate limited from their command output, with nothing in
 *  stderr. */
function failureKindOf(paths: SessionPaths, end: AttemptEnd): SessionResult["failureKind"] {
  if (end.spawnError !== null) return "spawn";
  const events = textOf(paths.eventPath, end.from.events)
    .split("\n")
    .filter((line) => line.startsWith('{"type":"error"') || line.startsWith('{"type":"turn.failed"'));
  const said = [textOf(paths.stderrPath, end.from.stderr), ...events].join("\n");
  return RATE_LIMIT.test(said) ? "rate-limit" : null;
}

/** The session's outcome from its last attempt: completed when Codex exited 0 and that attempt
 *  wrote the report, and otherwise failed, for the reason the failure kind names when it has one. */
export function settle(
  name: string,
  outputDir: string,
  end: AttemptEnd,
  run: { attempts: number; startedAt: Date },
): SessionResult {
  const paths = sessionPaths(outputDir, name);
  const reported = existsSync(paths.reportPath);
  const completed = end.exitCode === 0 && reported;
  const failureKind = completed ? null : failureKindOf(paths, end);
  let error: string | null = null;
  if (end.exitCode === 0 && !reported) error = "Codex exited successfully without writing a report";
  if (failureKind === "rate-limit") error = "Codex session was rate limited";
  if (end.spawnError !== null) error = printable(end.spawnError);
  const finishedAt = new Date();
  return {
    name,
    status: completed ? "completed" : "failed",
    exitCode: end.exitCode,
    signal: end.signal,
    error,
    failureKind,
    threadId: threadIdOf(paths.eventPath),
    attempts: run.attempts,
    durationMs: finishedAt.getTime() - run.startedAt.getTime(),
    startedAt: run.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    reportPath: paths.reportPath,
    eventPath: paths.eventPath,
    stderrPath: paths.stderrPath,
  };
}

function reportsPathOf(outputDir: string): string {
  return join(outputDir, "reports.md");
}

function reportSection(result: SessionResult): string {
  const report = existsSync(result.reportPath)
    ? printable(readFileSync(result.reportPath, "utf8")).trimEnd()
    : "(No report file was produced. Inspect the stderr and JSONL paths below.)";
  return [
    `## ${result.name}`,
    "",
    `Status: ${result.status}`,
    `Thread: ${result.threadId ?? "none"}`,
    `Duration: ${result.durationMs} ms`,
    `JSONL: ${result.eventPath}`,
    `Stderr: ${result.stderrPath}`,
    ...(result.failureKind === null ? [] : [`Failure kind: ${result.failureKind}`]),
    ...(result.error === null ? [] : [`Error: ${result.error}`]),
    "",
    report,
    "",
    "",
  ].join("\n");
}

/** Record a settled session: its section is appended to `reports.md` first, so a reader that sees
 *  `<name>.result.json` also finds the report there, and a retried session gains a second one. */
export function recordResult(outputDir: string, result: SessionResult): void {
  appendFileSync(reportsPathOf(outputDir), reportSection(result), { mode: 0o600 });
  writeRecord(sessionPaths(outputDir, result.name).resultPath, result);
}

/** Every session's result in launch order, written as `summary.json` beside `reports.md`. */
export function writeSummary(launch: LaunchRecord): LunaSummary {
  const sessions = launch.sessions.map(({ name }) => {
    const result = readResult(launch.outputDir, name);
    if (result === null) throw new Error(`session ${name} has no result in ${launch.outputDir}`);
    return result;
  });
  const summary: LunaSummary = {
    ...launch,
    type: SUMMARY_TYPE,
    finishedAt: new Date().toISOString(),
    reportsPath: reportsPathOf(launch.outputDir),
    sessions,
  };
  writeRecord(join(launch.outputDir, SUMMARY_FILE), summary);
  return summary;
}

/** Print what `reports.md` gained since the last drain. */
export async function drain(outputDir: string): Promise<void> {
  readLaunch(outputDir);
  const drainedPath = join(outputDir, ".drained.json");
  const drained = asRecord(readJsonFileOrNull(drainedPath))?.bytes;
  const bytes = bytesOf(reportsPathOf(outputDir));
  const from = isNumber(drained) ? drained : 0;
  if (bytes.length <= from) return;
  await Bun.write(Bun.stdout, `${new TextDecoder().decode(bytes.subarray(from)).trimEnd()}\n`);
  writeRecord(drainedPath, {
    schemaVersion: DRAIN_SCHEMA_VERSION,
    bytes: bytes.length,
    updatedAt: new Date().toISOString(),
  });
}
