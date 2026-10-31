/**
 * How ambitious a campaign's exam is, one line an Examiner session, and how far the campaign got:
 *
 *   bun .claude/skills/examiner-complexity/scripts/ambition.ts <log or campaign folder>...
 *
 * Each session's line is the live-seat reading of that session alone (`readingOf`): its task
 * admissions by word, the drafts held, the turns the reference's valid room-solve answers took and
 * the dollars billed, under the reference in force when it opened. The campaign's line gives the
 * hours from `campaign.opened` to its first `comparison.started` and its first `harness.promoted`,
 * which is where an exam's ambition shows as supply and climb. Several logs print side by side,
 * one block each, so the two arms of a paired launch read at a glance. Read-only.
 *
 * On 31 October the Examiner's ladder (`src/examiner/ladder.ts`) was calibrated by hand from the
 * record with one-off scripts, and the operator asked for the loop to be a skill with its own
 * scripts; this reader wraps the folds that the paired seats already read by.
 */
import { LOG_FILE, type LogEvent, read } from "#src/kernel/log.ts";
import { billedAll } from "#src/kernel/trace.ts";
import { existsSync, statSync } from "#src/meta/filesystem.ts";
import { isString } from "#src/meta/json-shape.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { runCommand } from "#skills/main/cli.ts";
import { readingOf } from "#skills/system-path-simulation/scripts/live-seat.ts";

const STARTS = new Set<string>(["exam.started", "draft.started"]);

/** One line an Examiner session: its id, the reference in force, and its reading. */
export function sessionLines(events: readonly LogEvent[]): string[] {
  const starts = events.flatMap((event, index) => (STARTS.has(event.kind) ? [index] : []));
  return starts.map((start, nth) => {
    const end = starts[nth + 1] ?? events.length;
    const reading = readingOf(events.slice(0, end), start, []);
    const promoted = events.slice(0, start).findLast((event) => event.kind === "harness.promoted")
      ?.data.harness;
    const reference = isString(promoted) ? promoted.slice(0, 8) : "starter";
    const session = events[start]?.data.session;
    const words = Object.entries(reading.gates)
      .map(([word, count]) => `${word} ${String(count)}`)
      .join(", ");
    const gated = Object.values(reading.gates).reduce((sum, count) => sum + count, 0);
    const turns = reading.turns === null ? "no valid room solve" : `median turns ${String(reading.turns[1])}`;
    return `${isString(session) ? session : "?"} · reference ${reference} · held ${String(reading.held)} of ${String(gated)} (${words || "no task admission"}) · ${turns} · $${reading.billed.toFixed(2)}`;
  });
}

/** What a campaign had spent by its first event of `kind`: the hours, and beside them the two units
 *  the host's load does not move, which is what lets two arms be read against each other. The
 *  solves run and the dollars billed at list price (`billedAll`) are the campaign's own steps; the
 *  hours are those steps plus whatever the machine was doing. Read over the record on 31 October,
 *  no campaign of 36 promoted inside 6 hours and esp32's median first promotion stood at 13.0
 *  hours against buffer's 9.8, so an arm read in hours alone mixes the exam's ambition with load. */
function reachedBy(events: readonly LogEvent[], kind: string, from: string | undefined): string {
  const at = events.findIndex((event) => event.kind === kind);
  const reached = events[at]?.at;
  if (reached === undefined || from === undefined) return "none yet";
  const upto = events.slice(0, at + 1);
  const solves = upto.filter((event) => event.kind === "solve.finished").length;
  const hours = (Date.parse(reached) - Date.parse(from)) / 3_600_000;
  return `${hours.toFixed(1)} h / ${String(solves)} solves / $${billedAll(upto).toFixed(0)}`;
}

/** The campaign's line: what it had spent by its first comparison and promotion, and their counts. */
export function campaignLine(events: readonly LogEvent[]): string {
  const opened = events.find((event) => event.kind === "campaign.opened")?.at;
  const count = (kind: string) => events.filter((event) => event.kind === kind).length;
  return `first comparison ${reachedBy(events, "comparison.started", opened)}, first promotion ${reachedBy(events, "harness.promoted", opened)}; ${String(count("comparison.started"))} compared, ${String(count("harness.promoted"))} promoted`;
}

/** A log's path from a log or its campaign folder. */
const logOf = (path: string) =>
  existsSync(path) && statSync(path).isDirectory() ? join(path, LOG_FILE) : path;

if (import.meta.main) {
  const usage = "ambition.ts <log or campaign folder>...";
  await runCommand({ name: "ambition", usage, positionals: [1, 100] }, ({ positionals }) => {
    for (const path of positionals.map(logOf)) {
      const events = read(path);
      console.log(`${basename(dirname(path))}: ${campaignLine(events)}`);
      for (const line of sessionLines(events)) console.log(`  ${line}`);
    }
  });
}
