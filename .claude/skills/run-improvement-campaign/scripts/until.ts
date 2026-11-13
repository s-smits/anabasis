#!/usr/bin/env bun
/**
 * Wait for a run's event and end with one line, which wakes the session that started the wait.
 *
 *   bun .claude/skills/run-improvement-campaign/scripts/until.ts <log.jsonl | campaign folder | name>
 *     --at <kind>[:<count>] ... [--hours <n>] [--say <text>]
 *
 * Started as a background command of a session, it follows the log by event kind alone and exits 0
 * at the first of: a `--at` bound (the log holds that many events of the kind, 1 where no count is
 * given), the run's ending (a `campaign.ended` as the log's last event, whatever was asked, so a
 * wait never outlives its run), or `--hours` raw hours since `campaign.opened`. Its one line says
 * which came, each count asked for and the hours, and after them `--say`: the session's own words
 * for what to read next, which grant nothing. It reads no content and starts, pauses and stops
 * nothing.
 *
 * It waits on a log this machine holds: the name is resolved once, at the start. A kind outside
 * `KINDS` is refused, since a mistyped kind would wait for good.
 */
import { type CommandArgs, CommandFailure, runCommand } from "#skills/main/cli.ts";
import type { EventKind, LogEvent } from "#src/kernel/log.ts";
import { statSync } from "#src/meta/filesystem.ts";
import { basename, dirname } from "#src/meta/path.ts";
import { logEvents } from "#tools/runs/registry.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

const SCRIPT = ".claude/skills/run-improvement-campaign/scripts/until.ts";
/** The kinds a wait may name: a run's milestones, each written once as it lands. */
const KINDS: readonly EventKind[] = [
  "comparison.started",
  "comparison.reported",
  "harness.promoted",
  "exam.started",
  "exam.finished",
  "build.started",
  "build.finished",
  "contract.frozen",
];
const USAGE = `usage: bun ${SCRIPT} <log.jsonl | campaign folder | campaign name>
    --at <kind>[:<count>] ... [--hours <n>] [--say <text>]

--at     end once the log holds <count> events of <kind> (1 where none is given); one of
         ${KINDS.join(", ")}
--hours  end this many raw hours after campaign.opened
--say    words printed after the line, for the session the line wakes
The run's ending ends the wait whatever was asked.`;
const OPTIONS = { at: "list", hours: "text", say: "text" } as const;
const LOOK_MS = 30_000;
const HOUR_MS = 3_600_000;

/** A kind and how many events of it end the wait. */
interface Bound {
  readonly kind: EventKind;
  readonly count: number;
}

const isKind = (kind: string): kind is EventKind => KINDS.some((one) => one === kind);

/** The bound `text` names, as `<kind>` or `<kind>:<count>`. */
export function boundOf(text: string): Bound {
  const [kind = "", count = "1"] = text.split(":");
  if (!isKind(kind)) throw new Error(`--at ${text} names no kind a wait reads: ${KINDS.join(", ")}`);
  if (!/^[1-9]\d*$/.test(count)) throw new Error(`--at ${text}: the count is a whole number, at least 1`);
  return { kind, count: Number(count) };
}

const countOf = (events: readonly LogEvent[], kind: EventKind) =>
  events.filter((event) => event.kind === kind).length;

/** The raw hours from the opening of `events` to `now`, or null where the log holds no opening. */
function hoursOf(events: readonly LogEvent[], now: number): number | null {
  const opened = events.find(({ kind }) => kind === "campaign.opened")?.at;
  return opened === undefined ? null : (now - Date.parse(opened)) / HOUR_MS;
}

/** Why the wait on `events` is over at `now`, or null while it goes on. */
export function reachedOf(
  events: readonly LogEvent[],
  bounds: readonly Bound[],
  hours: number | null,
  now: number,
): string | null {
  const met = bounds.find(({ kind, count }) => countOf(events, kind) >= count);
  if (met !== undefined) return `${String(met.count)} ${met.kind}`;
  if (events.at(-1)?.kind === "campaign.ended") return "an ending before any bound";
  const since = hoursOf(events, now);
  return hours !== null && since !== null && since >= hours
    ? `${String(hours)} raw hours with no bound reached`
    : null;
}

/** The one line a wait ends with. */
export function untilLine(
  name: string,
  events: readonly LogEvent[],
  bounds: readonly Bound[],
  why: string,
  { now, say }: { readonly now: number; readonly say: string | null },
): string {
  const counts = bounds.map(({ kind }) => `${String(countOf(events, kind))} ${kind}`);
  const since = hoursOf(events, now);
  const hours = since === null ? "no opening in the log" : `${since.toFixed(1)} raw hours since it opened`;
  const at = `${new Date(now).toISOString().slice(0, 16)}Z`;
  const facts = [`${name} reached ${why}`, ...(counts.length === 0 ? [] : [counts.join(", ")]), hours];
  return `UNTIL (automated, not operator input) at ${at}: ${facts.join("; ")}.${say === null ? "" : ` ${say}`}`;
}

if (import.meta.main) {
  await runCommand(
    { name: "until", usage: USAGE, options: OPTIONS, positionals: 1 },
    async (args: CommandArgs) => {
      const asked = args.value("hours");
      const hours = asked === null ? null : Number(asked);
      if (hours !== null && !(hours > 0)) args.die("--hours must be a number above 0");
      const bounds = args.list("at").map(boundOf);
      if (bounds.length === 0 && hours === null) args.die("name at least one --at, or --hours");
      const log = await logAcross(args.positionals[0] ?? "");
      // A log runs to tens of megabytes, and one that did not grow holds what it held.
      let size = -1;
      let events: LogEvent[] = [];
      for (;;) {
        const grown = statSync(log).size;
        if (grown !== size) events = logEvents(log);
        size = grown;
        const why = reachedOf(events, bounds, hours, Date.now());
        if (why !== null) {
          const said = { now: Date.now(), say: args.value("say") };
          console.log(untilLine(basename(dirname(log)), events, bounds, why, said));
          return;
        }
        if (events.length === 0) throw new CommandFailure(`${log} holds no event`);
        await Bun.sleep(LOOK_MS);
      }
    },
  );
}
