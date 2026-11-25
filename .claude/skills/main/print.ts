/** Shared table and cell formatting for skill scripts (`--format md` or `--format tsv`). */
import type { CommandArgs } from "./cli.ts";

/** Placeholder for inapplicable counts or rates with a zero denominator. */
export const MISSING = "-";

export const money = (value: number | null): string => (value === null ? MISSING : value.toFixed(0));

export function printed(
  head: readonly string[],
  rows: readonly (readonly string[])[],
  format: "md" | "tsv",
): string {
  if (format === "tsv") return [head, ...rows].map((row) => row.join("\t")).join("\n");
  const line = (row: readonly string[]) => `| ${row.join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...rows.map(line)].join("\n");
}

export function formatOf(args: CommandArgs): "md" | "tsv" {
  const format = args.value("format") ?? "md";
  return format === "md" || format === "tsv" ? format : args.die(`--format takes md or tsv; got ${format}`);
}
