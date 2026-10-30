/** Bounded stderr and the current wait, shared by view, pulse and remote record snapshots. */
import type { LogEvent } from "#src/kernel/log.ts";
import { existsSync, lstatSync, readdirSync, renameSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { boundText } from "#src/meta/bounded-text.ts";
import { HERE, type Run } from "./registry.ts";

interface Observation {
  readonly open: boolean;
  readonly stderr: string | null;
}
const OBSERVATION = "observation.json";
const QUIET_MS = 20 * 60_000;

/**
 * The provider wait `events` still stand in, or null. A seat that runs on after the wait is
 * recorded writes its own failed turn and the call it had in flight, so a wait stands through
 * calls and failed turns, and any other event ends it. Until 29 October the
 * keeper and this reader read a wait only as the log's last event: buffer-fresh-opus-forkedPR506
 * logged one at 14:31 until 31 October, then an Examiner call and its failed turn, and sat 4.5
 * hours with its keeper watching instead of moving it.
 */
export function providerWait(events: readonly LogEvent[]): LogEvent | null {
  const at = events.findLastIndex(
    ({ kind, data }) => !kind.endsWith(".call") && !(kind.endsWith(".turn") && data.stopReason === "error"),
  );
  const wait = events[at];
  return wait?.kind === "campaign.waited" && wait.data.for === "provider" ? wait : null;
}

/** Read only the tail of the newest regular launch stderr, never a link or a whole growing file. */
export async function stderrTail(log: string): Promise<string | null> {
  const folder = dirname(log);
  const newest = readdirSync(folder)
    .filter((file) => /^launch-.*\.err$/.test(file))
    .map((file) => ({ path: join(folder, file), stat: lstatSync(join(folder, file)) }))
    .filter((file) => file.stat.isFile())
    .toSorted((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0];
  if (newest === undefined) return null;
  const tail = await Bun.file(newest.path)
    .slice(Math.max(0, newest.stat.size - 8192), newest.stat.size)
    .text();
  return boundText(tail, 2048, "tail", 20).shown;
}

/** Publish observation metadata with a new inode, preserving any previous hardlinked snapshot. */
export async function keepObservation(folder: string, observation: Observation): Promise<void> {
  const temporary = join(folder, `${OBSERVATION}.tmp`);
  await Bun.write(temporary, capturedJsonStringify(observation));
  renameSync(temporary, join(folder, OBSERVATION));
}

/** A snapshot carries remote liveness; local pids never decide whether a remote campaign lives. */
export async function runReason(
  run: Run,
  events: readonly LogEvent[],
  state: "open" | "closed",
): Promise<string[]> {
  const stored = join(dirname(run.path), OBSERVATION);
  const remote = run.archived !== undefined && run.archived !== HERE;
  const observation =
    remote && existsSync(stored) ? parseJsonAs<Observation>(await Bun.file(stored).text()) : null;
  const alive = observation?.open ?? state === "open";
  const last = events.at(-1);
  if (last?.kind === "campaign.ended") return [];
  const lines: string[] = [];
  const wait = last?.kind === "campaign.waited" ? last : providerWait(events);
  if (wait !== null) {
    const data = wait.data;
    const load = isNumber(data.load)
      ? `load ${String(data.load)} on ${isNumber(data.cores) ? String(data.cores) : "?"} cores`
      : null;
    lines.push(
      `waiting for ${load ?? (isString(data.for) ? data.for : "the host")}${isString(data.until) ? ` until ${data.until}` : ""}${isNumber(data.ms) ? `; recorded wait ${String(Math.round(data.ms / 60_000))}m` : ""}`,
    );
  }
  if (!alive) lines.push("process gone without a campaign ending");
  const quiet = last !== undefined && Date.now() - Date.parse(last.at) >= QUIET_MS;
  if (!alive || quiet) {
    const stderr = remote ? observation?.stderr : await stderrTail(run.path);
    if (stderr !== null && stderr !== undefined && stderr !== "") lines.push(`newest stderr:\n${stderr}`);
  }
  return lines;
}
