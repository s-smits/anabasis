/**
 * How a skill script prints a table and its cells, so that every table over the record reads
 * alike and a spreadsheet takes any of them (`--format tsv`).
 */
import type { CommandArgs } from "./cli.ts";

/** A cell with nothing to show: a count that does not apply, or a rate with no denominator. */
export const MISSING = "-";

export const money = (value: number | null): string => (value === null ? MISSING : value.toFixed(0));

/** A table as GitHub markdown, or tab-separated lines for a spreadsheet. */
export function printed(
  head: readonly string[],
  rows: readonly (readonly string[])[],
  format: "md" | "tsv",
): string {
  if (format === "tsv") return [head, ...rows].map((row) => row.join("\t")).join("\n");
  const line = (row: readonly string[]) => `| ${row.join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...rows.map(line)].join("\n");
}

/** `--format` as a script takes it, or a refusal naming the two. */
export function formatOf(args: CommandArgs): "md" | "tsv" {
  const format = args.value("format") ?? "md";
  return format === "md" || format === "tsv" ? format : args.die(`--format takes md or tsv; got ${format}`);
}
