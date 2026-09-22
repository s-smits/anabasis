import type { RunView } from "../models.js";
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

export function evidenceLabel(path: string): string {
  return path.replace(/^campaigns\/[^/]+\//, "");
}

export function runLabel(run: Pick<RunView, "startedAt">): string {
  if (run.startedAt === null) return "Undated run";
  const date = new Date(run.startedAt);
  if (Number.isNaN(date.getTime())) return "Undated run";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function evaluationLabel(id: string, ids: readonly string[]): string {
  if (id === "all") return "All evaluations";
  const index = ids.indexOf(id);
  return index === -1 ? "Evaluation" : `Evaluation ${index + 1}`;
}
