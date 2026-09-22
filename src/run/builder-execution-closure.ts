/**
 * Controller closure for Builder execution records.
 *
 * The author writes each record, but only the controller knows when its invocation closed, so it
 * closes records left `in-flight` and names writes that landed after the terminal.
 *
 * It changes no submit row, aggregate or outcome a session settled itself: closing rewrites one
 * field of an open record, and the post-terminal witness only names the invocation already closed.
 */
import { existsSync, readdirSync } from "../meta/filesystem.ts";
import { dirname, join } from "../meta/path.ts";
import { readJsonFile, writeCompleted } from "../meta/completed-json.ts";
import { isRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { controllerEvidenceDir, OPENING_FILE, TERMINAL_FILE } from "./controller-lineage.ts";

/** One controller invocation, by run id and the moment its terminal was recorded. */
export interface BuilderExecutionInvocation {
  runId: string;
  closedAt: string;
}

const EXECUTION_FILE = /^builder-execution(-\d+)?\.json$/;

function readJsonRecord(path: string): Record<string, JsonValue> | null {
  try {
    const parsed = readJsonFile(path);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Controller-written timestamps are ordering identities. Damaged values cannot safely prove
 *  that one invocation closed before another opened, so the closure refuses them. */
function timestampMs(value: JsonValue | undefined): number | null {
  if (!isString(value) || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Every directory that holds execution records: one per keyed epoch, under the campaign root. */
function epochDirs(campaignRoot: string): string[] {
  try {
    return readdirSync(campaignRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("epoch-"))
      .map((entry) => join(campaignRoot, entry.name));
  } catch {
    return [];
  }
}

function executionFiles(epochDir: string): string[] {
  try {
    return readdirSync(epochDir)
      .filter((name) => EXECUTION_FILE.test(name))
      .sort()
      .map((name) => join(epochDir, name));
  } catch {
    return [];
  }
}

/**
 * The newest closed invocation of this campaign, or null while an invocation is still open.
 *
 * "Open" is an opening with no terminal beside it: exactly the state every legitimate Builder write
 * happens in, because the controller driving the session has not closed yet. Only an opening newer
 * than the latest terminal blocks this lookup; an older orphan counts as past, so it cannot disable
 * closure forever. An opening with an unreadable timestamp still blocks because its order is
 * unknown. A campaign with no controller directory is never post-terminal.
 */
export function latestClosedInvocation(campaignRoot: string): BuilderExecutionInvocation | null {
  const controllerDir = join(campaignRoot, "controller");
  let runIds: string[];
  try {
    runIds = readdirSync(controllerDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return null;
  }
  let latest: (BuilderExecutionInvocation & { closedAtMs: number }) | null = null;
  let newestOpenOpeningMs: number | null = null;
  for (const runId of runIds) {
    const dir = controllerEvidenceDir(campaignRoot, runId);
    const terminalPath = join(dir, TERMINAL_FILE);
    if (!existsSync(terminalPath)) {
      const openingPath = join(dir, OPENING_FILE);
      if (!existsSync(openingPath)) continue;
      const openedAt = timestampMs(readJsonRecord(openingPath)?.writtenAt);
      if (openedAt === null) return null;
      if (newestOpenOpeningMs === null || openedAt > newestOpenOpeningMs) newestOpenOpeningMs = openedAt;
      continue;
    }
    const terminal = readJsonRecord(terminalPath);
    const closedAt = terminal?.writtenAt;
    const closedAtMs = timestampMs(closedAt);
    if (closedAtMs === null || !isString(closedAt)) return null;
    if (latest === null || closedAtMs > latest.closedAtMs) latest = { runId, closedAt, closedAtMs };
  }
  if (latest === null) return null;
  if (newestOpenOpeningMs !== null && newestOpenOpeningMs > latest.closedAtMs) return null;
  return { runId: latest.runId, closedAt: latest.closedAt };
}

/**
 * The closed invocation preceding a write into this epoch, or null while one remains open.
 * Keep controller-directory knowledge here so the authoring writer needs only this lookup.
 */
export function postTerminalInvocation(epochDir: string): BuilderExecutionInvocation | null {
  return latestClosedInvocation(dirname(epochDir));
}

/**
 * Close every execution record this campaign left in flight, naming the terminal that closed it.
 * Called once from the controller's own terminal write, after the terminal exists, so a record and its
 * invocation cannot disagree about whether the run ended.
 *
 * Returns the paths it rewrote. Best effort by construction: an unreadable or already-settled
 * record is left exactly as it is, and a failed rewrite cannot fail the terminal that is closing.
 */
export function closeOpenBuilderExecutionRecords(
  campaignRoot: string,
  invocation: BuilderExecutionInvocation,
): string[] {
  const recorded: string[] = [];
  for (const epochDir of epochDirs(campaignRoot)) {
    for (const path of executionFiles(epochDir)) {
      const record = readJsonRecord(path);
      if (record === null || record.outcome !== "in-flight") continue;
      try {
        writeCompleted(path, {
          ...record,
          outcome: "recorded-at-terminal",
          closure: { ...invocation },
        });
        recorded.push(path);
      } catch {
        // A record that cannot be rewritten stays in flight; the reader reports it as an integrity
        // gap rather than the controller failing its own terminal write over another owner's file.
      }
    }
  }
  return recorded;
}
