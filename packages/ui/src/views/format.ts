/*
 * Presentation of a value that may not exist.
 *
 * Optional values get an explicit absence label instead of a dash or `0`. A dashboard reader
 * needs to distinguish a missing or unmeasured fact from a measured zero. Values that exist
 * keep their ordinary date, amount or size formatting.
 */

export function time(value: string | null): string {
  if (value === null) return "not recorded";
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
  return value === null ? "not recorded" : `$${value.toFixed(2)}`;
}

export function bytes(value: number): string {
  if (value < 1_000) return `${value} B`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} kB`;
  return `${(value / 1_000_000).toFixed(1)} MB`;
}

/** A length of time in seconds, in the largest unit that keeps it readable. */
export function seconds(value: number | null): string {
  if (value === null) return "not recorded";
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
