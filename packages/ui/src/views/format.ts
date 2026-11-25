import type { CampaignRow } from "../models.ts";

// Values that may not exist read as "not recorded", never a dash or `0`, so a missing fact reads apart
// from a measured zero.

const UNRECORDED = "not recorded";

export function time(value: string | null): string {
  if (value === null) return UNRECORDED;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(date);
}

/** Money to the cent; an unrecorded cost stays unrecorded, never free. */
export function money(value: number | null): string {
  return value === null ? UNRECORDED : `$${value.toFixed(2)}`;
}

export function bytes(value: number): string {
  if (value < 1000) return `${value} B`;
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)} kB`;
  return `${(value / 1_000_000).toFixed(1)} MB`;
}

export function seconds(value: number | null): string {
  if (value === null) return UNRECORDED;
  if (value < 60) return `${String(Math.round(value))} s`;
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${String(minutes)} min`;
  const rest = minutes % 60;
  return rest === 0
    ? `${String(Math.floor(minutes / 60))} h`
    : `${String(Math.floor(minutes / 60))} h ${String(rest)} min`;
}

export function duration(startedAt: string, endedAt: string | null): string {
  if (endedAt === null) return "no end";
  return seconds((Date.parse(endedAt) - Date.parse(startedAt)) / 1000);
}

/** A chance or a share in whole percent, below ten to a tenth: a false-promotion rate of 0.4% is not none. */
export function percent(value: number | null): string {
  if (value === null) return UNRECORDED;
  const shown = value * 100;
  return `${shown < 10 ? shown.toFixed(1) : String(Math.round(shown))}%`;
}

export function ago(value: string | null, now: number): string {
  if (value === null) return UNRECORDED;
  const at = Date.parse(value);
  return Number.isNaN(at) ? value : `${seconds(Math.max(0, now - at) / 1000)} ago`;
}

/** A campaign's state as the sidebar and its line say it. An open one says when it last wrote,
 *  since the log cannot say whether a process elsewhere still writes it: most have no process on
 *  this host, and some are copies of a peer's live campaign the gather job refreshes. */
export function standing(row: Pick<CampaignRow, "status" | "ending" | "lastEventAt">, now: number): string {
  if (row.ending !== null) return `ended: ${row.ending.ending}`;
  return row.status === "running" ? "running" : `open, wrote ${ago(row.lastEventAt, now)}`;
}
