/**
 * The record of every campaign a model served other than the one its seats asked for, kept in
 * `data/runs/degradations/<campaign>.tsv` under the main worktree: one row a session or solve and
 * model served, with its turns and the first and last of them. The gather (`runs fetch` with no
 * name, every ten minutes) writes it for each log it brought from another host and each campaign
 * of this machine's worktrees written in the last hour, and says a campaign's line whenever its
 * record changes.
 *
 * Seats that asked for claude-opus-5-5 were answered by another model on 7,542 recorded turns from
 * 20 to 31 October, nearly all of them recode's. An investigation named it on 23 October, but only
 * an investigation compared the two, so the campaigns went on and their readings were set beside
 * other domains' as Opus 5.5's. The operator asked on 31 October for a record kept without anyone
 * watching. A file per campaign holds no log in a folder of its own, so the archive's readers
 * (`campaignsIn`) never take the folder for a host's campaigns.
 *
 *   bun tools/runs/degradations.ts <log or campaign name>...
 *
 * prints the reading a whole-run investigation derives for each campaign (`READERS`,
 * `tools/wri/derive.ts`): the share of each seat's turns another model answered, the comparisons
 * whose solves it answered, and a line a session or solve.
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

/** The models that served `rows`, each against the one asked for. */
const which = (rows: readonly Degradation[]) =>
  [...new Set(rows.map(({ asked, served }) => `${served} for ${asked}`))].join("; ");

/** The record's text for `rows`, a header and a line a row; empty where no row is. */
export function recordOf(rows: readonly Degradation[]): string {
  if (rows.length === 0) return "";
  return [COLUMNS.join("\t"), ...rows.map((row) => COLUMNS.map((column) => String(row[column])).join("\t"))]
    .map((line) => `${line}\n`)
    .join("");
}

/** Writes the record of each log in `brought` and of this machine's campaigns written in the last
 *  hour, where it changed, and returns a line for each record written. */
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

/** The investigation's reading of one campaign's log: every turn that names the model that answered
 *  it, read against the model its seat asked for. */
export function degradationLines(events: readonly LogEvent[]): string[] {
  const rows = degradations(events);
  // The Referee's turns are left out: no start names the model they asked for (`degradations`).
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
