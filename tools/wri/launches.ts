/**
 * Each launch of a campaign beside the stretch of its log it wrote, one row a launch receipt
 * (`receipts`, `tools/runs/receipt.ts`): its commit, whether its login was the one before it, the
 * events from its start to the next launch, the last of them, the endings on record there, the steps
 * open where the stretch ends, the sessions and solves that ended `killed`, the size of its `.out`
 * and `.err`, and the hours from its last event to the next launch.
 *
 *   bun tools/wri/wri.ts reader launches --log <log>
 *
 * For lanes 23 and 26, and 22 where a run stopped after a promotion. A stop by hand writes no
 * `campaign.ended` and no `campaign.word`, only `killed` endings, so between 3 and 10 November 4 of
 * 6 lane-23 sessions searched session transcripts and 5 read the receipts and their output by hand
 * to see how each launch ended. This prints what the stretch holds and does not say who ended it.
 *
 * A stretch runs from the receipt's time to the next receipt's, so two launches a minute apart
 * each keep their own events; a launch writes its `campaign.opened` a few milliseconds before its
 * receipt, so an opening within a second before it is the launch's own. A session a stop left open
 * is closed `killed` by the launch after it, so its ending is counted in the next stretch. Events
 * before the first receipt are counted apart: a seed's, or a fork's parent's. It names no login,
 * path or env file, only whether the login changed, and it reads no line of the output files, only
 * counts them.
 */
import { campaignOf, openSteps } from "#src/campaign/handover.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { type Solve, solvesIn } from "#src/kernel/solves.ts";
import { HOUR_MS } from "#src/meta/clock.ts";
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { isString } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { plural } from "#src/meta/text.ts";
import { type Receipt, receipts } from "#tools/runs/receipt.ts";
import { openComparisons } from "#tools/runs/registry.ts";

type Launch = Receipt & { readonly session: string };

/** The session endings a stretch can hold, by the event that carries them. */
const SESSION_ENDS = new Set(["build.finished", "exam.finished", "draft.finished"]);
const KILLED = "killed";
/** How long before its receipt a launch writes its `campaign.opened`: a few milliseconds. */
const OPENED_MS = 1000;

/** How many lines a launch's output file holds, or that it has none. */
function linesIn(log: string, launch: Launch, extension: "out" | "err"): string {
  const file = join(dirname(log), `launch-${launch.session}.${extension}`);
  if (!existsSync(file)) return `no .${extension}`;
  const text = readFileSync(file, "utf8");
  const count = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  return `.${extension} ${plural(count, "line")}`;
}

/** Whether a launch ran as the login before it, saying neither. */
function loginOf(launch: Launch, before: Launch | undefined): string {
  if (before === undefined) return launch.login === undefined ? "login not named" : "login named";
  return launch.login === before.login ? "login same" : "login changed";
}

/** Where a launch's stretch begins: its first event at or after `at`, from `from` on, or the
 *  opening the launch wrote just before its receipt. */
function startOf(events: readonly LogEvent[], at: string, from: number): number {
  const time = Date.parse(at);
  const found = events.findIndex((event, index) => index >= from && Date.parse(event.at) >= time);
  const start = found === -1 ? events.length : found;
  const before = events[start - 1];
  const opened =
    start - 1 >= from && before?.kind === "campaign.opened" && time - Date.parse(before.at) <= OPENED_MS;
  return opened ? start - 1 : start;
}

/** The steps open where `events` end: each session with no end that the campaign did not go past
 *  (`openSteps`), and each comparison with no report however the campaign stood, since a resumed
 *  one reads as gone past until it reports (`openComparisons`). */
export function openAt(events: readonly LogEvent[]): string[] {
  const sessions = campaignOf(events).steps.filter(({ step }) => step !== "comparison");
  return [...openSteps(sessions), ...openComparisons(events)];
}

/** What one launch's stretch of the log, events `[from, to)`, holds. */
function stretchLines(
  events: readonly LogEvent[],
  every: readonly Solve[],
  from: number,
  to: number,
): string[] {
  const stretch = events.slice(from, to);
  const last = stretch.at(-1);
  const endings = stretch.flatMap(({ kind, data }) =>
    kind === "campaign.ended" ? [isString(data.ending) ? data.ending : "unnamed"] : [],
  );
  const killed = stretch.flatMap(({ kind, data }) =>
    SESSION_ENDS.has(kind) && data.ended === KILLED
      ? [isString(data.session) ? data.session : "unnamed"]
      : [],
  );
  const solves = every.filter(({ started }) => started >= from && started < to);
  const solvesKilled = solves.filter(({ ending }) => ending?.kind === KILLED).length;
  const unended = solves.filter(({ finished }) => finished === null || finished >= to).length;
  const open = openAt(events.slice(0, to));
  return [
    last === undefined
      ? "  no event in its stretch"
      : `  ${plural(stretch.length, "event")}, lines ${String(from + 1)} to ${String(to)}; the last ${last.kind} at ${last.at}`,
    `  campaign.ended: ${endings.length === 0 ? "none" : endings.join(", ")}`,
    `  open where the stretch ends: ${open.length === 0 ? "nothing" : open.join(", ")}`,
    `  ended killed: ${plural(killed.length, "session")}${killed.length === 0 ? "" : ` (${killed.join(", ")})`}, ${plural(solvesKilled, "solve")} of ${String(solves.length)} begun; ${String(unended)} begun with no end in it`,
  ];
}

/** One block a launch receipt beside `log`, oldest first. */
export function launchLines(log: string, events: readonly LogEvent[]): string[] {
  const launches = receipts(log);
  if (launches.length === 0) return ["launches: no launch receipt beside the log"];
  const starts: number[] = [];
  for (const launch of launches) starts.push(startOf(events, launch.at, starts.at(-1) ?? 0));
  const first = starts[0] ?? events.length;
  const solves = solvesIn(events);
  return [
    `launches: ${plural(launches.length, "launch receipt")} beside the log, each beside the events from its time to the next one's`,
    `before the first receipt: ${plural(first, "event")}`,
    ...launches.flatMap((launch, index) => {
      const [from, to] = [starts[index] ?? events.length, starts[index + 1] ?? events.length];
      const next = launches[index + 1];
      const lastAt = events[to - 1]?.at;
      const quiet = to > from && lastAt !== undefined ? lastAt : launch.at;
      return [
        `${launch.session}  ${launch.at}  commit ${launch.commit.slice(0, 8)}${launch.dirty ? " with uncommitted changes" : ""}  ${loginOf(launch, launches[index - 1])}  ${linesIn(log, launch, "out")}, ${linesIn(log, launch, "err")}`,
        ...stretchLines(events, solves, from, to),
        next === undefined
          ? "  the last launch"
          : `  from its last event to the next launch: ${((Date.parse(next.at) - Date.parse(quiet)) / HOUR_MS).toFixed(2)} h`,
      ];
    }),
  ];
}
