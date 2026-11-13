/**
 * How ambitious a campaign's exam is, one line an Examiner session, and how far the campaign got:
 *
 *   bun .claude/skills/examiner-complexity/scripts/ambition.ts <log or campaign folder>...
 *
 * Each session's line is the live-seat reading of that session alone (`readingOf`): its task
 * admissions by word, the drafts held, the turns the reference's valid room-solve answers took and
 * the dollars billed, under the reference in force when it opened; a writing session's line also
 * names the tasks its start asked for and how it stands, since a count of drafts held says nothing
 * of the ask, and the families its proposals name, by count. The campaign's line gives the hours
 * from `campaign.opened` to its first `comparison.started` and its first `harness.promoted`,
 * which is where an exam's ambition shows as supply and climb. Several logs print side by side,
 * one block each, so the two arms of a paired launch read at a glance. Read-only.
 *
 * On 31 October the Examiner's ladder (`src/examiner/ladder.ts`) was calibrated by hand from the
 * record with one-off scripts, and the operator asked for the loop to be a skill with its own
 * scripts; this reader wraps the folds that the paired seats already read by.
 */
import { campaignOf, type Handover } from "#src/campaign/handover.ts";
import { proposalsOf } from "#src/kernel/history.ts";
import { promoted } from "#src/kernel/reports.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { billedAll } from "#src/kernel/meter.ts";
import { HOUR_MS } from "#src/meta/clock.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { basename, dirname } from "#src/meta/path.ts";
import { runCommand } from "#skills/main/cli.ts";
import { ownedBy } from "#src/kernel/trace.ts";
import { validityOf } from "#tools/d2/close.ts";
import { logAcross } from "#tools/runs/snapshots.ts";
import { readingOf } from "#skills/system-path-simulation/scripts/live-seat.ts";

export const STARTS = new Set<string>(["exam.started", "draft.started"]);

/** The reference harness in force at `index`: the last promoted harness's short digest, or the
 *  starter, which is the first reference and stays the lower one (`AGENTS.md`, section 3). Read by
 *  the session lines here and by `exams.ts` for each draft, so an exam's drafts are read against
 *  the harness they had to leave room for. */
export function referenceAt(events: readonly LogEvent[], index: number): string {
  return promoted(events.slice(0, index))?.slice(0, 8) ?? "starter";
}

/** What a writing session was asked for and how it stands: the tasks its start asked (`limits.tasks`,
 *  which no fold reads), then the ending, turns and last event of the campaign's own fold, the turns
 *  against the start's limit. On 13 November a row of a cycle's ledger gave five sessions' asks from
 *  memory, three of them wrong, where this line read "held 14 of 14" of a session asked for 17. */
function askedOf(start: LogEvent, step: Extract<Handover, { step: "examiner" }>): string {
  const limits = asRecord(start.data.limits);
  const ask = isNumber(limits?.tasks) ? `asked ${String(limits.tasks)}, ` : "";
  const limit = isNumber(limits?.turns) ? ` of ${String(limits.turns)}` : "";
  const hours = (Date.parse(step.last) - Date.parse(start.at)) / HOUR_MS;
  return `${ask}${step.ended ?? (step.cut ? "cut" : "open")} at ${String(step.turns)}${limit} turns in ${hours.toFixed(1)} h`;
}

/** How many families a session's proposals name and how many tasks the largest holds, naming none,
 *  through the fold that reads the label where each event keeps it (`proposalsOf`). A proposal the
 *  Examiner wrote holds its label on the task, and `data.family` is null there: a count by that
 *  field read "one family" of sessions that wrote two on 12 and again on 13 November, the second
 *  time into a ledger and to the operator. A comparison's tasks are independent draws only as far
 *  as their families differ, so the grain is read here beside the supply it belongs to. */
function familiesOf(events: readonly LogEvent[], session: string): string {
  const sizes = new Map<string, number>();
  for (const { family } of proposalsOf(events).filter((each) => each.session === session)) {
    const label = family ?? "";
    sizes.set(label, (sizes.get(label) ?? 0) + 1);
  }
  const proposed = [...sizes.values()].reduce((sum, size) => sum + size, 0);
  if (proposed === 0) return "";
  return ` · ${String(proposed)} proposed in ${String(sizes.size)} families, largest ${String(Math.max(...sizes.values()))}`;
}

/** One line an Examiner session: its id, the reference in force, and its reading. */
export function sessionLines(events: readonly LogEvent[]): string[] {
  const starts = events.flatMap((event, index) => (STARTS.has(event.kind) ? [index] : []));
  const written = campaignOf(events).steps.flatMap((step) => (step.step === "examiner" ? [step] : []));
  return starts.map((start, nth) => {
    const end = starts[nth + 1] ?? events.length;
    const reading = readingOf(events.slice(0, end), start, []);
    const reference = referenceAt(events, start);
    const session = events[start]?.data.session;
    // The window to the next start also holds the comparisons and Builder sessions between, so the
    // line bills only what this session owns: its own end and its tries (`ownedBy`). Over the stopped
    // esp32 run of 7 November the window gave its 9 empty sessions $45.18 where they billed $18.52.
    const own = isString(session) ? events.slice(start, end).filter(ownedBy(events, session)) : [];
    const words = Object.entries(reading.gates)
      .map(([word, count]) => `${word} ${String(count)}`)
      .join(", ");
    const gated = Object.values(reading.gates).reduce((sum, count) => sum + count, 0);
    const turns = reading.turns === null ? "no valid room solve" : `median turns ${String(reading.turns[1])}`;
    const from = events[start];
    const step = from?.kind === "exam.started" ? written.find(({ id }) => id === session) : undefined;
    const asked = from === undefined || step === undefined ? "" : ` · ${askedOf(from, step)}`;
    const families = isString(session) ? familiesOf(events, session) : "";
    return `${isString(session) ? session : "?"} · reference ${reference} · held ${String(reading.held)} of ${String(gated)} (${words || "no task admission"})${asked}${families} · ${turns} · $${billedAll(own).toFixed(2)}`;
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

/** The campaign's line: what it had spent by its first comparison and promotion, their counts, and
 *  how hard its scored tasks were for the reference: the scored tasks on which it was valid in every
 *  solve, and the steps that won any point by validity. An admission says only that a task left
 *  room; on 1 November buffer's reference was valid in every solve on 129 of 132 scored tasks across
 *  the gate ablation, and 1 of 6 steps won a validity point, which no admission line showed. */
export function campaignLine(events: readonly LogEvent[]): string {
  const opened = events.find((event) => event.kind === "campaign.opened")?.at;
  const count = (kind: string) => events.filter((event) => event.kind === kind).length;
  const { scored, room, onValidity, stepped } = validityOf(campaignOf(events).steps);
  return `first comparison ${reachedBy(events, "comparison.started", opened)}, first promotion ${reachedBy(events, "harness.promoted", opened)}; ${String(count("comparison.started"))} compared, ${String(count("harness.promoted"))} promoted; reference valid every solve on ${String(scored - room)} of ${String(scored)} scored tasks, ${String(onValidity)} of ${String(stepped)} steps won by validity`;
}

/** The campaign's line under its name, then each session's line indented. */
export function ambitionLines(name: string, events: readonly LogEvent[]): string[] {
  return [`${name}: ${campaignLine(events)}`, ...sessionLines(events).map((line) => `  ${line}`)];
}

if (import.meta.main) {
  const usage = "ambition.ts <log or campaign folder>...";
  await runCommand({ name: "ambition", usage, positionals: [1, 100] }, async ({ positionals }) => {
    for (const path of await Promise.all(positionals.map((named) => logAcross(named)))) {
      console.log(ambitionLines(basename(dirname(path)), read(path)).join("\n"));
    }
  });
}
