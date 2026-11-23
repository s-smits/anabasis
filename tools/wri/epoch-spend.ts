/**
 * Each epoch's billed dollars by role, active vs wall hours, comparison spend share, billing
 * residual (`costLine`), unpriced compactions, and average cost per promotion (lane 19):
 *
 *   bun tools/wri/wri.ts reader epoch-spend --log <log>
 */
import { epochsOf } from "#src/campaign/climb.ts";
import { short } from "#src/campaign/move.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { billedAll, billedBetween, billedFor, costLine, spendOf } from "#src/kernel/meter.ts";
import { tracesIn } from "#src/kernel/trace.ts";
import { HOUR_MS } from "#src/meta/clock.ts";
import { plural } from "#src/meta/text.ts";
import { clockOf } from "./trajectory.ts";

/** Per-epoch billed spend and active hours, plus billing residual and $/promotion summary. */
export function epochSpendLines(events: readonly LogEvent[]): string[] {
  const epochs = epochsOf(events);
  const clock = clockOf(events);
  const roles = (upTo: number) => new Map(spendOf(events.slice(0, upTo)));
  const rows = epochs.map((epoch) => {
    const to = epoch.to ?? events.length;
    const [before, after] = [roles(epoch.from), roles(to)];
    const parts = [...after].map(
      ([role, dollars]) => `${role} ${(dollars - (before.get(role) ?? 0)).toFixed(2)}`,
    );
    const compared = epoch.comparisons.reduce((sum, { id }) => sum + billedFor(events, id), 0);
    const [fromAt, endAt] = [events[epoch.from]?.at ?? "", events[to - 1]?.at ?? ""];
    const wallH = ((Date.parse(endAt) - Date.parse(fromAt)) / HOUR_MS).toFixed(2);
    const activeH = Math.max(0, clock(endAt) - clock(fromAt)).toFixed(2);
    const reference = epoch.reference === "starter" ? "starter" : short(epoch.reference);
    const closed = epoch.promoted === null ? "open at the log's end" : `promoted ${short(epoch.promoted)}`;
    return [
      `epoch ${String(epoch.nth)}  reference ${reference}  lines ${String(epoch.from + 1)} to ${String(to)}  wall ${wallH} h / active ${activeH} h  ${closed}`,
      `  billed ${billedBetween(events, epoch.from, to).toFixed(2)}: ${parts.join(", ") || "nothing"}`,
      `  its ${plural(epoch.comparisons.length, "reported comparison")} billed ${compared.toFixed(2)}`,
    ].join("\n");
  });
  const total = billedAll(events);
  const promoted = epochs.filter(({ promoted: harness }) => harness !== null).length;
  const confirmed = epochs.filter(({ confirmed: ok }) => ok === true).length;
  const unpriced = tracesIn(events).filter((each) => each.part === "compacted" && each.billed === 0).length;
  const perProm = promoted === 0 ? "none" : `$${(total / promoted).toFixed(2)}`;
  const perConf = confirmed === 0 ? "none" : `$${(total / confirmed).toFixed(2)}`;
  return [
    ...rows,
    `economy summary: total $${total.toFixed(2)} · ${String(promoted)} promoted (${perProm}/prom), ${String(confirmed)} confirmed (${perConf}/confirmed) · ${String(unpriced)} unpriced compactions · ${costLine(events)}`,
  ];
}
