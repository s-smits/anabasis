/**
 * What a Luna launch records, and how its reports are read back: the launch record, one result per
 * session, the summary every WRI reader joins by session name, `reports.md`, and the drain that
 * prints each finished report once. `luna-sessions.ts` runs the sessions and hands each one's last
 * attempt here to be settled.
 */
import { readJsonFileOrNull, writeAtomic } from "#src/meta/completed-json.ts";
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord } from "#src/meta/json-shape.ts";
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

/** How one attempt ended, as the launcher saw the process. */
export interface AttemptEnd {
  exitCode: number | null;
  signal: string | null;
  spawnError: string | null;
}

/** One settled session, as `<name>.result.json` records it. */
export interface SessionResult {
  name: string;
  status: "completed" | "failed" | "spawn-error";
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
/** The first event of a Codex thread, which names it: `{"type":"thread.started","thread_id":…}`. */
const THREAD_STARTED = /^\{"type":"thread\.started","thread_id":"([\w-]{8,128})"/m;
const RATE_LIMIT = /(?:\b429\b|too many requests|rate.?limit)/i;
const SEEN_SCHEMA_VERSION = 1;

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

function textOf(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function writeRecord<T>(path: string, value: T): void {
  writeAtomic(path, `${capturedJsonStringify(value, null, 2)}\n`);
}

export function readLaunch(outputDir: string): LaunchRecord {
  const path = join(outputDir, "launch.json");
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

/** What Codex itself reported going wrong: its stderr and the event log's own `error` and
 *  `turn.failed` events. A command's output is what the session read, not what Codex said, so a
 *  lane that opened a file about rate limits is not rate limited: the 2026-09-25 lanes stopped by
 *  SIGTERM were all labelled so from their command output, with nothing in stderr. */
function codexWords(paths: SessionPaths): string {
  const events = textOf(paths.eventPath)
    .split("\n")
    .filter((line) => line.startsWith('{"type":"error"') || line.startsWith('{"type":"turn.failed"'));
  return [textOf(paths.stderrPath), ...events].join("\n");
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

/** The session's outcome from its last attempt: completed when Codex exited 0 and wrote the report,
 *  rate limited when Codex said so, and a spawn error when no process started. */
export function settle(
  name: string,
  outputDir: string,
  end: AttemptEnd,
  run: { attempts: number; startedAt: Date },
): SessionResult {
  const paths = sessionPaths(outputDir, name);
  const reported = existsSync(paths.reportPath);
  const completed = end.exitCode === 0 && reported;
  const rateLimited = !completed && RATE_LIMIT.test(codexWords(paths));
  const spawned = end.spawnError === null;
  const outcome = completed ? "completed" : "failed";
  const rateLimitKind = rateLimited ? "rate-limit" : null;
  let error: string | null = null;
  if (end.exitCode === 0 && !reported) error = "Codex exited successfully without writing a report";
  if (rateLimited) error = "Codex session was rate limited";
  if (end.spawnError !== null) error = printable(end.spawnError);
  const finishedAt = new Date();
  return {
    name,
    status: spawned ? outcome : "spawn-error",
    exitCode: end.exitCode,
    signal: end.signal,
    error,
    failureKind: spawned ? rateLimitKind : "spawn",
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
  ].join("\n");
}

/** Every session's result in launch order, written as `summary.json` beside `reports.md`. */
export function writeSummary(launch: LaunchRecord): LunaSummary {
  const sessions = launch.sessions.map(({ name }) => {
    const result = readResult(launch.outputDir, name);
    if (result === null) throw new Error(`session ${name} has no result in ${launch.outputDir}`);
    return result;
  });
  const reportsPath = join(launch.outputDir, "reports.md");
  const reports = ["# Luna session reports", "", ...sessions.map(reportSection)].join("\n");
  writeAtomic(reportsPath, `${reports.trimEnd()}\n`);
  const summary: LunaSummary = {
    ...launch,
    type: "luna_sessions.completed",
    finishedAt: new Date().toISOString(),
    reportsPath,
    sessions,
  };
  writeRecord(join(launch.outputDir, "summary.json"), summary);
  return summary;
}

/** Print each settled session's report that no earlier drain printed, in launch order. */
export async function drain(outputDir: string): Promise<void> {
  const launch = readLaunch(outputDir);
  const seenPath = join(outputDir, ".seen-reports.json");
  const shown = asRecord(readJsonFileOrNull(seenPath))?.shown;
  const seen = new Set(Array.isArray(shown) ? shown : []);
  const fresh = launch.sessions.flatMap(({ name }) => {
    const result = seen.has(name) ? null : readResult(outputDir, name);
    return result === null ? [] : [result];
  });
  if (fresh.length === 0) return;
  await Bun.write(Bun.stdout, `${fresh.map(reportSection).join("\n").trimEnd()}\n`);
  for (const result of fresh) seen.add(result.name);
  writeRecord(seenPath, {
    schemaVersion: SEEN_SCHEMA_VERSION,
    shown: launch.sessions.flatMap(({ name }) => (seen.has(name) ? [name] : [])),
    updatedAt: new Date().toISOString(),
  });
}
