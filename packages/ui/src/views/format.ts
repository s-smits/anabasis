import type { CampaignRow } from "../models.ts";

/*
 * Presentation of a value that may not exist.
 *
 * Optional values get an explicit absence label instead of a dash or `0`. A dashboard reader
 * needs to distinguish a missing or unmeasured fact from a measured zero. Values that exist
 * keep their ordinary date, amount or size formatting.
 */

/** What a value the log does not hold reads as. */
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

/** Money to the cent. An unrecorded cost stays unrecorded: a run whose provider reported nothing
 *  must not read as a run that was free. */
export function money(value: number | null): string {
  return value === null ? UNRECORDED : `$${value.toFixed(2)}`;
}

export function bytes(value: number): string {
  if (value < 1_000) return `${value} B`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} kB`;
  return `${(value / 1_000_000).toFixed(1)} MB`;
}

/** A length of time in seconds, in the largest unit that keeps it readable. */
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

/** How long a step ran, from its start to its end; a step with no end is still open, or was cut. */
export function duration(startedAt: string, endedAt: string | null): string {
  if (endedAt === null) return "no end";
  return seconds((Date.parse(endedAt) - Date.parse(startedAt)) / 1000);
}

/** A chance or a share in whole percent, below ten to a tenth: a false-promotion rate of 0.4% is
 *  not none. */
export function percent(value: number | null): string {
  if (value === null) return UNRECORDED;
  const shown = value * 100;
  return `${shown < 10 ? shown.toFixed(1) : String(Math.round(shown))}%`;
}

/** How long ago `value` was, at `now` (milliseconds), in the largest unit that keeps it readable. */
export function ago(value: string | null, now: number): string {
  if (value === null) return UNRECORDED;
  const at = Date.parse(value);
  return Number.isNaN(at) ? value : `${seconds(Math.max(0, now - at) / 1000)} ago`;
}

/** A campaign's state as the sidebar and the campaign's line say it. An open campaign says when it
 *  last wrote, since the log cannot say whether a process on another host still writes it: on
 *  30 October 132 of 134 open campaigns had no process on the serving host, and some of those were
 *  copies of live campaigns on a peer that the gather job refreshes every ten minutes. */
export function standing(row: Pick<CampaignRow, "status" | "ending" | "lastEventAt">, now: number): string {
  if (row.ending !== null) return `ended: ${row.ending.ending}`;
  return row.status === "running" ? "running" : `open, wrote ${ago(row.lastEventAt, now)}`;
}
