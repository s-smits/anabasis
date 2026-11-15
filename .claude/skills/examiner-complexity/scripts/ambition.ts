/**
 * How ambitious a campaign's exam is, one line an Examiner session, and how far the campaign got:
 *
 *   bun .claude/skills/examiner-complexity/scripts/ambition.ts <log or campaign folder>...
 *
 * Each session's line is its live-seat reading (`readingOf`) under the reference in force, with what
 * a writing session asked for, its writing hours and its proposals by family and turn; the campaign's
 * line gives what it spent to its first comparison and promotion. One block a log, naming no task.
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
import { familySizes } from "#skills/main/families.ts";
import { ownedBy } from "#src/kernel/trace.ts";
import { validityOf } from "#tools/d2/close.ts";
import { logAcross } from "#tools/runs/snapshots.ts";
import { waitedMs, waitsOf } from "#tools/wri/time.ts";
import { readingOf } from "#skills/system-path-simulation/scripts/live-seat.ts";

export const STARTS = new Set<string>(["exam.started", "draft.started"]);

/** The reference harness in force at `index`: the last promoted harness's short digest, or the
 *  starter, which is the first reference and stays the lower one (`AGENTS.md`, section 3). Read by
 *  the session lines here and by `exams.ts` for each draft, so an exam's drafts are read against
 *  the harness they had to leave room for. */
export function referenceAt(events: readonly LogEvent[], index: number): string {
  return promoted(events.slice(0, index))?.slice(0, 8) ?? "starter";
}

/** The tasks a writing session's start asked for (no fold reads them), its ending, turns and hours. */
function askedOf(start: LogEvent, step: Extract<Handover, { step: "examiner" }>, hours: number): string {
  const limits = asRecord(start.data.limits);
  const ask = isNumber(limits?.tasks) ? `asked ${String(limits.tasks)}, ` : "";
  const limit = isNumber(limits?.turns) ? ` of ${String(limits.turns)}` : "";
  return `${ask}${step.ended ?? (step.cut ? "cut" : "open")} at ${String(step.turns)}${limit} turns in ${hours.toFixed(1)} h`;
}

/** The hours `session` spent writing: from its start to the last event it wrote, less the provider
 *  and network waits between (a load wait is some solve's, and stays in). */
function wroteHours(events: readonly LogEvent[], start: number, end: number, session: string): number {
  const mine = ({ kind, data }: LogEvent) => data.session === session && kind.startsWith("exam.");
  const closed = events.findIndex((event, at) => at > start && mine(event) && event.kind === "exam.finished");
  const wrote = events.slice(start, closed === -1 ? end : closed).findLast(mine) ?? events[start];
  const [from, until] = [Date.parse(events[start]?.at ?? ""), Date.parse(wrote?.at ?? "")];
  const rests = waitsOf(events).filter(({ kind }) => kind !== "load");
  return (until - from - waitedMs(rests, from, until)) / HOUR_MS;
}

/** A session's proposals: how many, their families and the largest, and the session's own turn at
 *  each (an event's `turn` numbers the whole conversation); null where it proposed none. */
export function proposedOf(events: readonly LogEvent[], session: string) {
  const proposals = proposalsOf(events).filter((each) => each.session === session);
  if (proposals.length === 0) return null;
  const versions = proposals.map(({ version }) => version);
  const { sizes } = familySizes(events, versions);
  const mine = events.filter(({ data }) => data.session === session);
  const at = mine.flatMap(({ kind }, index) =>
    kind === "task.proposed"
      ? [mine.slice(0, index).filter((event) => event.kind === "exam.turn").length]
      : [],
  );
  return { proposed: proposals.length, families: sizes.length, largest: sizes[0] ?? 0, at };
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
    // The window to the next start also holds the comparisons and Builder sessions between.
    const own = isString(session) ? events.slice(start, end).filter(ownedBy(events, session)) : [];
    const words = Object.entries(reading.gates)
      .map(([word, count]) => `${word} ${String(count)}`)
      .join(", ");
    const gated = Object.values(reading.gates).reduce((sum, count) => sum + count, 0);
    const turns = reading.turns === null ? "no valid room solve" : `median turns ${String(reading.turns[1])}`;
    const from = events[start];
    const step = from?.kind === "exam.started" ? written.find(({ id }) => id === session) : undefined;
    const asked =
      from === undefined || step === undefined
        ? ""
        : ` · ${askedOf(from, step, wroteHours(events, start, end, step.id))}`;
    const of = isString(session) ? proposedOf(events, session) : null;
    const families =
      of === null
        ? ""
        : ` · ${String(of.proposed)} proposed in ${String(of.families)} families, largest ${String(of.largest)}${of.at.at(-1) === 0 ? "" : `, at turns ${of.at.join(", ")}`}`;
    return `${isString(session) ? session : "?"} · reference ${reference} · held ${String(reading.held)} of ${String(gated)} (${words || "no task admission"})${asked}${families} · ${turns} · $${billedAll(own).toFixed(2)}`;
  });
}

/** What a campaign had spent by its first event of `kind`: the hours, and beside them the solves and
 *  dollars, which the host's load does not move, so two arms read against each other by them. */
function reachedBy(events: readonly LogEvent[], kind: string, from: string | undefined): string {
  const at = events.findIndex((event) => event.kind === kind);
  const reached = events[at]?.at;
  if (reached === undefined || from === undefined) return "none yet";
  const upto = events.slice(0, at + 1);
  const solves = upto.filter((event) => event.kind === "solve.finished").length;
  const hours = (Date.parse(reached) - Date.parse(from)) / 3_600_000;
  return `${hours.toFixed(1)} h / ${String(solves)} solves / $${billedAll(upto).toFixed(0)}`;
}

/** The campaign's line: what it had spent by its first comparison and promotion, their counts, the
 *  scored tasks on which the reference was valid in every solve, and the steps won by validity. */
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
