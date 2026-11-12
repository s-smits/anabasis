/**
 * Whether a login is open or closed, read from one reading of `readLogins`. Closed means a window is
 * used up or refused, until that window's reset; two closed windows mean the later reset. A login
 * that could not be read is neither, since a read that failed says nothing of its limits.
 *
 * Each full `usage` keeps who it found closed and until when in its snapshot, and a picker (`keep`,
 * `fresh`) asks the provider only of the rest, since a reading may cost a one-token request a login
 * and a keeper with nowhere to go reads every ten minutes through a wait that can last days
 * (operator, 5 November 2026). A closed login opens by the clock at its reset, so nothing has to
 * reopen it. Only the last snapshot counts, so the next `usage` overrules what was kept, as after
 * credit added early. An open login is never trusted from a snapshot: a move spends on the login it
 * takes, so a picker reads it afresh. A snapshot with no `closed`, or no snapshot, leaves every
 * login to be read. `--open` and `--closed` narrow what `usage` lists, and what it keeps and
 * forecasts still covers every login.
 */
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { mainTree } from "#src/meta/git.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import type { Reading, Window } from "./logins.ts";
import type { Snapshot } from "./usage-model.ts";

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

/** The logins of `readings` closed until a known reset, as a snapshot keeps them. */
export function closedResets(readings: readonly Reading[]): Record<string, number> {
  return Object.fromEntries(
    readings.flatMap((reading) => {
      const until = closedOf(reading)?.until ?? null;
      return until === null ? [] : [[reading.login, until]];
    }),
  );
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

/** What a head line of `usage` says of `reading`, in `clockOf`'s words. */
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

/** `wanted`, less each login the last of `kept` found closed whose reset has not come by `now`. */
export function notClosed(wanted: readonly string[], kept: readonly Snapshot[], now: number): string[] {
  // A stable sort keeps the later of two snapshots taken at one time last, as the record wrote them.
  const last = kept.toSorted((one, other) => one.at - other.at).at(-1);
  return wanted.filter((login) => (last?.closed?.[login] ?? 0) <= now);
}

export const historyFile = (): string => join(mainTree(runtimeProcess.cwd()), ".ana", "logins-history.jsonl");

export function keptReadings(history: string): Snapshot[] {
  return existsSync(history)
    ? readFileSync(history, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => parseJsonAs<Snapshot>(line))
    : [];
}
