/** Shared table and cell formatting for skill scripts (`--format md` or `--format tsv`). */
import type { Tally } from "#src/kernel/compare.ts";
import type { CommandArgs } from "./cli.ts";

/** Placeholder for inapplicable counts or rates with a zero denominator. */
export const MISSING = "-";

export const money = (value: number | null): string => (value === null ? MISSING : value.toFixed(0));

export const formatTally = ({ wins, losses, ties }: Tally): string =>
  `${String(wins)}-${String(losses)}-${String(ties)}`;

export function printed(
  head: readonly string[],
  rows: readonly (readonly string[])[],
  format: "md" | "tsv" = "md",
): string {
  if (format === "tsv") return [head, ...rows].map((row) => row.join("\t")).join("\n");
  const line = (row: readonly string[]) => `| ${row.join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...rows.map(line)].join("\n");
}

export function countsLine(counts: Readonly<Record<string, number>>, empty = "none"): string {
  return (
    Object.entries(counts)
      .map(([key, count]) => `${key} ${String(count)}`)
      .join(", ") || empty
  );
}

export function formatOf(args: CommandArgs): "md" | "tsv" {
  const format = args.value("format") ?? "md";
  return format === "md" || format === "tsv" ? format : args.die(`--format takes md or tsv; got ${format}`);
}
