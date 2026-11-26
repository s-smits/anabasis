/**
 * Whether a login is open or closed, from one reading of `readLogins`. Closed means a window is
 * used up or refused until its reset (the later of two); a login that could not be read is neither.
 * Readers record closures in this host's disposable cache (`noteReadings`), so pickers (`keep`,
 * `fresh`) skip logins read closed within 45 minutes until their reset without fanning out `usage`.
 */
import { MINUTE_MS } from "#src/meta/clock.ts";
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { mainTree } from "#src/meta/git.ts";
import { capturedJsonParse, capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import type { Reading, Window } from "./logins.ts";
import { remember } from "./pulse-readers.ts";
import type { Snapshot } from "./usage-model.ts";

// Leave time for the keeper's ten-minute retry and its next poll within the hour.
const CLOSED_CACHE_MS = 45 * MINUTE_MS;

type Closures = Readonly<Record<string, { readonly at: number; readonly until: number }>>;

export const resetOf = (iso: string | null): number | null => {
  const at = iso === null ? Number.NaN : new Date(iso).getTime();
  return Number.isNaN(at) ? null : at;
};

export const windowOpen = (window: Window): boolean =>
  (window.status ?? "allowed").startsWith("allowed") && (window.pct ?? 0) < 100;

/** Until when `reading` is closed, `until: null` where its closed window names no reset, or null
 *  for a login that is open or could not be read. */
export function closedOf(reading: Reading): { until: number | null } | null {
  if ("error" in reading) return null;
  const closed = [reading.fiveHour ?? [], reading.sevenDay].flat().filter((window) => !windowOpen(window));
  if (closed.length === 0) return null;
  const resets = closed.map(({ resetsAt }) => resetOf(resetsAt));
  return { until: resets.includes(null) ? null : Math.max(...resets.flatMap((at) => at ?? [])) };
}

/** The `readings` a filter of `usage` lists: all with neither flag, and one that could not be read
 *  under neither flag's name, since it is neither open nor closed. */
export function listedBy(
  readings: readonly Reading[],
  { open, closed }: { readonly open: boolean; readonly closed: boolean },
): readonly Reading[] {
  if (!open && !closed) return readings;
  return readings.filter((reading) => !("error" in reading) && (closedOf(reading) === null ? open : closed));
}

export function stateWords(
  reading: Reading,
  allowed: readonly string[],
  clockOf: (at: number) => string,
): string {
  if ("error" in reading) return "";
  const closed = closedOf(reading);
  const state =
    closed === null ? "open" : `closed${closed.until === null ? "" : ` until ${clockOf(closed.until)}`}`;
  return ` · ${state}${allowed.includes(reading.login) ? "" : " · not in the pool"}`;
}

/** `wanted`, less each login recorded closed within the cache window whose reset has not arrived. */
export function notClosed(wanted: readonly string[], kept: Closures, now: number): string[] {
  return wanted.filter((login) => {
    const closed = kept[login];
    return closed === undefined || now - closed.at >= CLOSED_CACHE_MS || closed.until <= now;
  });
}

export function noted(kept: Closures, readings: readonly Reading[], now: number): Closures {
  const next = { ...kept };
  for (const reading of readings) {
    if ("error" in reading) continue;
    const until = closedOf(reading)?.until ?? null;
    if (until === null) delete next[reading.login];
    else next[reading.login] = { at: now, until };
  }
  return Object.fromEntries(Object.entries(next).filter(([, { until }]) => until > now));
}

const closuresFile = (): string => join(mainTree(runtimeProcess.cwd()), ".ana", "logins-closed.json");

export function closures(file = closuresFile()): Closures {
  if (!existsSync(file)) return {};
  try {
    const parsed = asRecord(capturedJsonParse(readFileSync(file, "utf8")));
    if (parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([login, entry]) => {
        const record = asRecord(entry);
        return record !== null && isNumber(record.at) && isNumber(record.until)
          ? [[login, { at: record.at, until: record.until }]]
          : [];
      }),
    );
  } catch {
    return {};
  }
}

export function noteReadings(readings: readonly Reading[], now = Date.now(), file = closuresFile()): void {
  remember(file, capturedJsonStringify(noted(closures(file), readings, now)));
}

export const historyFile = (): string => join(mainTree(runtimeProcess.cwd()), ".ana", "logins-history.jsonl");

export function cachedUsageHistory(history: string): Snapshot[] {
  return existsSync(history)
    ? readFileSync(history, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => parseJsonAs<Snapshot>(line))
    : [];
}
