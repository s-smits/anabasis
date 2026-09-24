/**
 * Where a report goes, decided once. `--out` records the report as JSON evidence, whatever the
 * console shows, so a later reader reconciles against the same bytes every time; the console shows
 * the rendered view, or the JSON itself under `--json` or when the script has no rendering.
 *
 * Scripts had three conventions: one wrote the rendered text to `--out` and printed the path, one
 * wrote JSON there and printed the rendering, one printed JSON only when `--out` was absent. A
 * caller had to know which script it was talking to before it knew what `--out` would hold.
 */
import { writeJsonFile } from "#src/meta/completed-json.ts";
import { runtimeProcess } from "#src/meta/process.ts";

export interface ReportTarget<T> {
  json: boolean;
  out: string | null;
  render?: (report: T) => string;
}

export function emitReport<T>(report: T, { json, out, render }: ReportTarget<T>): void {
  if (out !== null) writeJsonFile(out, report);
  const text = json || render === undefined ? JSON.stringify(report, null, 2) : render(report);
  runtimeProcess.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}
