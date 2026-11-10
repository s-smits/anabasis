/**
 * Each epoch's billed dollars by role, and its comparisons' share: one row an epoch (`epochsOf`,
 * `src/campaign/climb.ts`), from the event that opened it to the promotion that closed it.
 *
 *   bun tools/wri/epoch-spend.ts <log>
 *
 * For lane 22, whose question is what the climb after a promotion cost. Between 3 and 10 November
 * 7 of 14 lane-22 sessions summed `solve.finished` and `exam.finished` bills after the promotion by
 * hand (`after.py`), since `view` gives each epoch's total and `cost` each campaign's roles, but
 * nothing gives an epoch's roles. A sum over the epoch's events alone bills a session open across a
 * bound at its whole sum where it ends, so each figure here is what the log had billed by the
 * epoch's end less what it had by its start, as `billedBetween` reads a stretch: the roles are
 * `spendOf` on the two prefixes, and the comparisons are `billedFor` each comparison the epoch
 * reported, which counts its solves and their reviews wherever in the log they ran.
 */
import { epochsOf } from "#src/campaign/climb.ts";
import { short } from "#src/campaign/move.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { billedBetween, billedFor, spendOf } from "#src/kernel/meter.ts";
import { plural } from "#src/meta/text.ts";
import { printRows } from "./folds.ts";
import { logEvents } from "#tools/runs/registry.ts";

const HOUR_MS = 3_600_000;

/** One line an epoch of `events`. */
export function epochSpendLines(events: readonly LogEvent[]): string[] {
  const roles = (upTo: number) => new Map(spendOf(events.slice(0, upTo)));
  return epochsOf(events).map((epoch) => {
    const to = epoch.to ?? events.length;
    const [before, after] = [roles(epoch.from), roles(to)];
    const parts = [...after].map(
      ([role, dollars]) => `${role} ${(dollars - (before.get(role) ?? 0)).toFixed(2)}`,
    );
    const compared = epoch.comparisons.reduce((sum, { id }) => sum + billedFor(events, id), 0);
    const [from, end] = [events[epoch.from]?.at ?? "", events[to - 1]?.at ?? ""];
    const hours = ((Date.parse(end) - Date.parse(from)) / HOUR_MS).toFixed(2);
    const reference = epoch.reference === "starter" ? "starter" : short(epoch.reference);
    const closed = epoch.promoted === null ? "open at the log's end" : `promoted ${short(epoch.promoted)}`;
    return [
      `epoch ${String(epoch.nth)}  reference ${reference}  lines ${String(epoch.from + 1)} to ${String(to)}  ${hours} h  ${closed}`,
      `  billed ${billedBetween(events, epoch.from, to).toFixed(2)}: ${parts.join(", ") || "nothing"}`,
      `  its ${plural(epoch.comparisons.length, "reported comparison")} billed ${compared.toFixed(2)}`,
    ].join("\n");
  });
}

if (import.meta.main) printRows("epoch-spend", (log) => epochSpendLines(logEvents(log)));
