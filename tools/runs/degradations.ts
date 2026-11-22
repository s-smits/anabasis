/**
 * Tracks silent model-routing degradations across campaigns, writing one TSV file per affected
 * campaign to `data/runs/degradations/<campaign>.tsv` under the main worktree (one row per session
 * or solve and served model, with turn counts and first/last timestamps). The periodic gather
 * (`runs fetch` without a name) updates these files for every fetched log and every local campaign
 * modified in the last hour, printing a summary line whenever a campaign's record changes.
 *
 * A provider may silently serve a different model than the one requested for thousands of turns;
 * recording this continuously prevents degraded runs from being pooled unknowingly with clean runs.
 * Storing flat TSV files rather than campaign subdirectories ensures archive readers (`campaignsIn`)
 * never mistake `degradations/` for a host directory.
 *
 *   bun tools/runs/degradations.ts <log or campaign name>...
 *
 * Prints the per-campaign summary used by whole-run investigations (`READERS`, `tools/wri/derive.ts`):
 * the fraction of each seat's turns served by a different model, the comparisons affected, and a
 * per-session or per-solve breakdown.
 */
import type { LogEvent } from "#src/kernel/log.ts";
import { type Degradation, degradations, SEATS, tracesIn } from "#src/kernel/trace.ts";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "#src/meta/filesystem.ts";
import { basename, dirname } from "#src/meta/path.ts";
import { isString } from "#src/meta/json-shape.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { countBy } from "#src/meta/tally.ts";
import { archiveOf, isCampaign, logEvents, runs } from "./registry.ts";
import { logAcross } from "./snapshots.ts";

const RECENT_MS = 60 * 60_000;
const COLUMNS = [
  "seat",
  "id",
  "asked",
  "served",
  "turns",
  "first",
  "last",
] as const satisfies readonly (keyof Degradation)[];

/** Summarises the distinct `(served, asked)` model substitutions present in `rows`. */
const which = (rows: readonly Degradation[]) =>
  [...new Set(rows.map(({ asked, served }) => `${served} for ${asked}`))].join("; ");

/** Formats `rows` as a tab-separated table with a header line, or returns an empty string if none exist. */
function recordOf(rows: readonly Degradation[]): string {
  if (rows.length === 0) return "";
  return [COLUMNS.join("\t"), ...rows.map((row) => COLUMNS.map((column) => String(row[column])).join("\t"))]
    .map((line) => `${line}\n`)
    .join("");
}

/** Updates degradation TSV records for `brought` logs and recently modified local campaigns,
 *  returning one notification line for each record that changed. */
export function recordDegradations(brought: readonly string[], repo: string, now = Date.now()): string[] {
  const own = runs(repo)
    .filter(isCampaign)
    .filter((run) => existsSync(run.path) && now - statSync(run.path).mtimeMs < RECENT_MS)
    .map((run) => run.path);
  return [...new Set([...brought, ...own])].flatMap((path) => {
    const rows = degradations(logEvents(path));
    const text = recordOf(rows);
    const name = basename(dirname(path));
    const file = archiveOf(repo, "degradations", `${name}.tsv`);
    if (text === "" || (existsSync(file) && readFileSync(file, "utf8") === text)) return [];
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    const turns = rows.reduce((sum, row) => sum + row.turns, 0);
    return [`degraded: ${name}: ${String(turns)} turns served by another model (${which(rows)}), in ${file}`];
  });
}

/** Formats the investigation summary of model-routing degradations across all turns in `events`
 *  that record a served model. */
export function degradationLines(events: readonly LogEvent[]): string[] {
  const rows = degradations(events);
  // Exclude Referee turns because their start events do not record a requested model (`degradations`).
  const named = tracesIn(events).flatMap((each) =>
    each.part === "turn" && each.model !== null && each.seat !== "referee" ? [each] : [],
  );
  const total = rows.reduce((sum, row) => sum + row.turns, 0);
  const all = `all ${String(named.length)} turns naming a model were served as their seat asked`;
  if (rows.length === 0) return [all];
  const comparisonOf = new Map(
    events.flatMap(({ kind, data }) =>
      kind === "solve.started" && isString(data.solve) && isString(data.comparison)
        ? [[data.solve, data.comparison] as const]
        : [],
    ),
  );
  const seats = SEATS.flatMap((seat) => {
    const own = rows.filter((row) => row.seat === seat);
    const turns = own.reduce((sum, row) => sum + row.turns, 0);
    const of = named.filter((each) => each.seat === seat).length;
    return own.length === 0 ? [] : [`  ${seat}: ${String(turns)} of ${String(of)} turns; ${which(own)}`];
  });
  const solves = [...new Set(rows.flatMap((row) => (row.seat === "solve" ? [row.id] : [])))];
  const compared = Object.entries(
    countBy(solves, (solve) => comparisonOf.get(solve) ?? "no comparison or Examiner"),
  ).map(([under, count]) => `  solves under ${under}: ${String(count)} served another model`);
  return [
    `${String(total)} of ${String(named.length)} turns naming a model were served by another than their seat asked for`,
    ...seats,
    ...compared,
    ...rows.map(
      (row) =>
        `  ${row.seat} ${row.id}: ${String(row.turns)} turns, ${row.served} for ${row.asked}, ${row.first} to ${row.last}`,
    ),
  ];
}

if (import.meta.main) {
  const named = runtimeProcess.argv.slice(2);
  if (named.length === 0) throw new Error("usage: bun tools/runs/degradations.ts <log or campaign name>...");
  for (const one of named) {
    const path = await logAcross(one);
    console.log(`${basename(dirname(path))}: ${degradationLines(logEvents(path)).join("\n")}`);
  }
}
