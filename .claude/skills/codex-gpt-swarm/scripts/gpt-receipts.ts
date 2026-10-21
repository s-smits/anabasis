/**
 * What a launch of Codex sessions records, and how its reports are read back: the launch record,
 * one result a session, `reports.md`, the summary, and the drain. A session's outcome is decided
 * here once, from its last attempt, and every reader takes that decision. `gpt-sessions.ts` runs
 * the sessions and hands each one's last attempt here.
 *
 * Two records of v1's launcher decide what is kept. On 2026-09-25 lanes ended by SIGTERM were all
 * labelled rate limited from what their commands printed, so only what Codex itself said counts
 * towards a failure's kind. On 2026-09-29 sixty lanes of one batch sat unread because nothing
 * drained them, so every settled report is appended to `reports.md` as it settles and the drain
 * prints what that file gained since it last ran.
 */
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "#src/meta/filesystem.ts";
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
  type: typeof LAUNCH_TYPE;
  model: string;
  reasoningEffort: string;
  serviceTier: string;
  runtime: { bunVersion: string; bunExecutable: string };
  maxActive: number;
  startIntervalMs: number;
  retries: number;
  outputDir: string;
  startedAt: string;
  sessions: SessionRecord[];
}

/** How one attempt ended, as the launcher saw the process, and where its own output begins: every
 *  attempt of a session appends to the same event log and stderr. */
export interface AttemptEnd {
  exitCode: number | null;
  signal: string | null;
  spawnError: string | null;
  from: { events: number; stderr: number };
}

/** One settled session, as `<name>.result.json` records it. The failure kind says why a failed
 *  session failed where the launcher can tell: Codex never started, or Codex said it was limited. */
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
type Summary = Omit<LaunchRecord, "sessions" | "type"> & {
  type: typeof SUMMARY_TYPE;
  finishedAt: string;
  reportsPath: string;
  sessions: SessionResult[];
};

/** How far `reports.md` has been drained, as `.drained.json` records it. */
interface Drained {
  bytes: number;
  updatedAt: string;
}

type SessionPaths = ReturnType<typeof sessionPaths>;

export const LAUNCH_TYPE = "gpt_sessions.launch";
export const SUMMARY_TYPE = "gpt_sessions.completed";
export const SUMMARY_FILE = "summary.json";
const LAUNCH_FILE = "launch.json";
/** The first event of a Codex thread, which names it: `{"type":"thread.started","thread_id":…}`. */
const THREAD_STARTED = /^\{"type":"thread\.started","thread_id":"([\w-]{8,128})"/m;
const RATE_LIMIT = /(?:\b429\b|too many requests|rate.?limit)/i;

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

/** Write a file whole, so a reader that opens it mid-launch sees the old bytes or the new. */
export function writeWhole(path: string, text: string): void {
  writeFileSync(`${path}.tmp`, text, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

function writeRecord(path: string, value: LaunchRecord | SessionResult | Summary | Drained): void {
  writeWhole(path, `${capturedJsonStringify(value, null, 2)}\n`);
}

export function recordLaunch(launch: LaunchRecord): void {
  writeRecord(join(launch.outputDir, LAUNCH_FILE), launch);
}

export function readLaunch(outputDir: string): LaunchRecord {
  const path = join(outputDir, LAUNCH_FILE);
  const launch = existsSync(path) ? parseJsonAs<LaunchRecord | null>(readFileSync(path, "utf8")) : null;
  if (launch?.type !== LAUNCH_TYPE || !Array.isArray(launch.sessions)) {
    throw new Error(`not a launch directory of gpt-sessions: ${outputDir}`);
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
    if (code === 9 || code === 10) return true;
    return (
      code >= 0x20 &&
      !(code >= 0x7f && code <= 0x9f) &&
      !(code >= 0x202a && code <= 0x202e) &&
      !(code >= 0x2066 && code <= 0x2069)
    );
  };
  return Array.from(Bun.stripANSI(text).replaceAll("\r\n", "\n").replaceAll("\r", "\n"))
    .filter(shown)
    .join("");
}

/** Why a failed attempt failed, where the launcher can tell: Codex never started, or Codex said in
 *  this attempt, on stderr or in its own `error` and `turn.failed` events, that it was rate limited.
 *  What a command printed is what the session read, not what Codex said. */
function failureKindOf(paths: SessionPaths, end: AttemptEnd): SessionResult["failureKind"] {
  if (end.spawnError !== null) return "spawn";
  const events = textOf(paths.eventPath, end.from.events)
    .split("\n")
    .filter((line) => line.startsWith('{"type":"error"') || line.startsWith('{"type":"turn.failed"'));
  const said = [textOf(paths.stderrPath, end.from.stderr), ...events].join("\n");
  return RATE_LIMIT.test(said) ? "rate-limit" : null;
}

function errorOf(
  end: AttemptEnd,
  reported: boolean,
  failureKind: SessionResult["failureKind"],
): string | null {
  if (end.spawnError !== null) return printable(end.spawnError);
  if (failureKind === "rate-limit") return "Codex session was rate limited";
  if (end.exitCode === 0 && !reported) return "Codex exited successfully without writing a report";
  return null;
}

/** The session's outcome from its last attempt: completed when Codex exited 0 and that attempt wrote
 *  the report, and otherwise failed, for the reason the failure kind names where it has one. */
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
  const finishedAt = new Date();
  return {
    name,
    status: completed ? "completed" : "failed",
    exitCode: end.exitCode,
    signal: end.signal,
    error: errorOf(end, reported, failureKind),
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
    : "(No report file was produced. Read the stderr and JSONL paths above.)";
  return [
    `## ${result.name}`,
    "",
    `Status: ${result.status}`,
    `Thread: ${result.threadId ?? "none"}`,
    `Duration: ${String(result.durationMs)} ms`,
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
export function writeSummary(launch: LaunchRecord): Summary {
  const sessions = launch.sessions.map(({ name }) => {
    const result = readResult(launch.outputDir, name);
    if (result === null) throw new Error(`session ${name} has no result in ${launch.outputDir}`);
    return result;
  });
  const summary: Summary = {
    ...launch,
    type: SUMMARY_TYPE,
    finishedAt: new Date().toISOString(),
    reportsPath: reportsPathOf(launch.outputDir),
    sessions,
  };
  writeRecord(join(launch.outputDir, SUMMARY_FILE), summary);
  return summary;
}

/** Print what `reports.md` gained since the last drain, and remember how far it has been read. */
export async function drain(outputDir: string): Promise<void> {
  readLaunch(outputDir);
  const drainedPath = join(outputDir, ".drained.json");
  const drained = existsSync(drainedPath)
    ? asRecord(parseJsonAs<Drained>(readFileSync(drainedPath, "utf8")))?.bytes
    : undefined;
  const bytes = bytesOf(reportsPathOf(outputDir));
  const from = isNumber(drained) ? drained : 0;
  if (bytes.length <= from) return;
  await Bun.write(Bun.stdout, `${new TextDecoder().decode(bytes.subarray(from)).trimEnd()}\n`);
  writeRecord(drainedPath, { bytes: bytes.length, updatedAt: new Date().toISOString() });
}
