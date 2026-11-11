/**
 * The runs pulse: v1's `bun run runs pulse`, on v2's log. One look reads the run logs of the
 * repository's worktrees (`registry.ts`) and says one status line for each and what happened since
 * the last look: `◆` a milestone, `⚠` something to look at, `·` the rest. Each log is the run's
 * whole record, so the pulse keeps only how far it read and what it last said, in `--state`.
 *
 *   bun run runs pulse [<part of a name> ...] [--every 290] [--state .ana/runs-pulse.json]
 *   bun run runs status [--all]
 *
 * One look and out, unless `--every <seconds>` asks it to keep looking. Until 5 November a bare pulse
 * watched for ever, so a session reading one run through a pipe waited 80 minutes for an end that never
 * came.
 *
 * With no names a look covers the open runs and those open at the last look, so a run's ending is
 * said once; an observer's first look of a run also covers one stopped in the last day without an
 * ending (until 29 October every look did, and an hourly look repeated each stopped run's "process
 * gone" and its stderr for a day). A name matches every run whose name holds it. Quiet, no event for 20 minutes in an
 * open run, counted from a named reset it waits out where that is later, is said when it starts and
 * when it ends. Since 22 October each look also polls every configured host once, with a cursor for
 * this observer, unless --here is named. A missing peer is a warning and exit 1. No local state path is sent to another machine.
 *
 * What an event says is `said.ts`'s, which the alerts and the iteration's script read too. A look also
 * says, under each moment among its new events (an opening, the contract's freeze, a comparison's
 * start, a report, a promotion, a session's or a campaign's end), what the deterministic readers that
 * name it found (`at`, `tools/wri/derive.ts`; `pulse-readers.ts`), which `--no-readers` leaves out, and
 * the triggers come from their `rows`. No reader of a moment loads the embedding model, so the look
 * has no flag for it.
 *
 * Nothing a look read is lost to a kill, and the hook's `timeout 40` kills it whole. A look remembers
 * only after it has printed, so a kill before that says the same events again, and a look over ssh
 * cannot know its caller read it: a peer holds what it would remember in `<state>.pending` until the
 * caller's next look returns the token it printed last (`--ack`), and looks again from the old cursor
 * if it does not. A host that has not answered within `PEERS_MS` is said to have left its lines for the
 * next look, on stdout, where the hook's filter keeps them.
 */
import type { EventKind, LogEvent } from "#src/kernel/log.ts";
import { degradations, traceKind, tracesIn } from "#src/kernel/trace.ts";
import { billedAll } from "#src/kernel/meter.ts";
import { solvesIn } from "#src/kernel/solves.ts";
import { existsSync, readFileSync, rmSync, statfsSync, statSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { availableParallelism, loadavg } from "#src/meta/os.ts";
import { basename, join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { sha256 } from "#src/meta/digest.ts";
import { mainTree } from "#src/meta/git.ts";
import { plural } from "#src/meta/text.ts";
import { stillRunning } from "./diagnosis.ts";
import { asked, hosts } from "./hosts.ts";
import { hostsOf } from "./host-config.ts";
import { lastLaunch, unlaunchedSeed } from "./receipt.ts";
import {
  climbAt,
  dollars,
  ENDED,
  minutes,
  openingCommand,
  progressOf,
  PROMOTED,
  promotionsOf,
  REPORTED,
  SAID,
  short,
  triggerOf,
  word,
} from "./said.ts";
import { launchedIn, runReason, runState, stateOf } from "./state.ts";
import {
  alarmsMoved,
  type Moment,
  PER_LOOK,
  pruneObservers,
  readersSaid,
  remember,
  startPass,
  storeOf,
  withinDeadline,
} from "./pulse-readers.ts";
import {
  ARCHIVE,
  archived,
  HERE,
  isCampaign,
  logEvents,
  openComparisons,
  processes,
  type Run,
  runs,
  writers,
} from "./registry.ts";

/** What the last look saw of one log. */
interface Seen {
  readonly lines: number;
  readonly open: boolean;
  readonly quiet: boolean;
  /** Each watched investigation trigger's detail at the last look that read them. */
  readonly triggers?: Readonly<Record<string, string>>;
  /** The log's bytes the `rows` reader had read at the last look that read its triggers. */
  readonly rowsAt?: number;
  /** The moments its readers have not read, which keep a closed run in the looks until they have. */
  readonly moments?: readonly Moment[];
  /** The hashes of the readers' lines this observer has said. */
  readonly said?: readonly string[];
  /** Whether an investigation was due at the last look, so that it is said at the look that finds
   *  it so; a state from before 10 November holds none, and its first look only remembers. */
  readonly due?: boolean;
  /** The run's state at the last look (`RunState`), whose reason is said when it changes. */
  readonly state?: string;
}

/** One of the investigation's triggers of a log. */
type Alarm = NonNullable<ReturnType<typeof alarmsMoved>>["alarms"][number];

/** One look at one run: its status line, what it says of the events since the last look, and what
 *  to remember of it. */
interface Look {
  readonly status: string;
  readonly said: readonly string[];
  readonly seen: Seen;
}

/** Where the process that writes a log stands now. */
type Standing = ReturnType<typeof standing>;

/** The readers' lines of a look's new events, by each event's place among them. */
type Under = ReadonlyMap<number, readonly string[]>;

/** The state file: the free disk at the last look, what it saw of each log by its path, the token
 *  each host printed last, which the next look returns to it, and the hosts that gave no answer. */
interface Memory {
  readonly freeGiB: number | null;
  readonly logs: Record<string, Seen>;
  readonly acks?: Readonly<Record<string, string>>;
  readonly down?: readonly string[];
}

/** A run a look reports, its events and its log's bytes once they were read. */
interface Chosen {
  readonly run: Run;
  readonly open: boolean;
  readonly before: Seen | undefined;
  readonly events: readonly LogEvent[];
  readonly size: number;
}

/** A closed run `status` shows without `--all`: one whose log changed this recently. */
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const RECENT_MS = DAY_MS;
/** How many of the archive's newest campaigns `status` names under its rows. */
const NEWEST = 3;
const GIB = 2 ** 30;
/** The events that start something a run then has to finish. */
const STARTS: ReadonlySet<string> = new Set(["build.started", "exam.started", "comparison.started"]);

/**
 * The investigation's triggers a watch says, by the factor each bears on (`AGENTS.md`, section 1).
 * An alarm is read at every look where the `rows` reader moved and said where it fired or its key
 * moved (`keyOf`); a reading moves with each solve, so it is said only after a milestone. On
 * 1 November an unconfirmed promotion in a live buffer campaign was found only by running `wri.ts
 * read` on it by hand. A trigger the pulse reads itself is left out (a model served, an unfinished
 * session), and one left out is said once by the `rows` reader's own lines (`readersSaid`), unless
 * the look says it in its event's own line (`OWN`).
 */
const WATCHED = new Map<string, readonly [string, "alarm" | "reading"]>([
  ["SUPPLY THIN", ["supply", "alarm"]],
  ["NOTHING SCORED", ["supply", "alarm"]],
  ["SET SHORT", ["supply", "alarm"]],
  ["NO TASK HELD OUT", ["supply", "alarm"]],
  ["NO VALID ANSWER", ["supply", "alarm"]],
  ["AWAITING A LABEL", ["supply", "alarm"]],
  ["GATE REFUSED", ["supply", "reading"]],
  ["OUTCOMES BY SESSION", ["supply", "reading"]],
  ["CHAIN AGAINST THE STARTER", ["climb", "reading"]],
  ["MARGINS INSIDE THE NOISE", ["honesty", "reading"]],
  ["BROKEN AT END", ["climb", "alarm"]],
  ["STEP CARRIERS", ["climb", "reading"]],
  ["CHAIN", ["climb", "reading"]],
  ["SCORED SET MOVED", ["honesty", "alarm"]],
  ["HOST CODE MOVED", ["honesty", "alarm"]],
  ["PRACTISED TASK MEASURED", ["honesty", "alarm"]],
  ["MEASURED AN EARLIER STATE", ["honesty", "alarm"]],
  ["STARTS OUT OF TURN", ["honesty", "alarm"]],
  ["LOG OUT OF ORDER", ["honesty", "alarm"]],
  ["SAFEGUARD-8 PROMOTION ON AUTHOR ROOM", ["honesty", "alarm"]],
  ["SAFEGUARD-9 PROMOTION BEYOND VALIDITY", ["honesty", "alarm"]],
  ["CHECK DEFECT RULED", ["verdicts", "alarm"]],
  ["RULED UNCLEAR", ["verdicts", "alarm"]],
  ["RULINGS REFUSED", ["verdicts", "alarm"]],
  ["EARNED WITHOUT A PROBE", ["verdicts", "alarm"]],
  ["REVIEW FAULTS", ["verdicts", "alarm"]],
  ["SET ASIDE AND UNSETTLED", ["verdicts", "alarm"]],
  ["REPLAY MOVED THE VERDICT", ["verdicts", "alarm"]],
  ["SESSION CRASHED", ["economy", "alarm"]],
]);
/** The triggers a look says in the line of the event that fires them (`said.ts`): a promotion until
 *  its starter comparison reads, a checker read with a fault and a freeze despite one. They came a
 *  reader pass after their event, and the first again at every milestone until that comparison. */
const OWN = ["PROMOTION UNCONFIRMED", "CHECKER READ WITH FAULTS", "FROZEN DESPITE FAULTS"];
/** The events after which a reading is said again. */
const MILESTONES: ReadonlySet<string> = new Set([
  REPORTED,
  PROMOTED,
  "exam.finished",
  "build.finished",
  ENDED,
]);
/** The comparisons and sessions a trigger's detail names (`g-2`, `b-3`, `x-1`), not a task (`x-1-3`). */
const NAMED = /\b[bgx]-\d+(?![-\d])/g;
/** A load wait a person moves a run for (`AGENTS.md`, section 10, condition 4). */
const LOAD_WAIT_MS = 15 * 60_000;
/** How long a look waits for its peers, from its start. The hook kills a look at 40 s, and a peer has
 *  `HOST_MS`, 30 s, once its controller is ready, which may take far longer when it is cold. */
const PEERS_MS = 33_000;
/** The last line a peer prints, with the token that the next look returns. */
const ACK_LINE = /^ack ([0-9a-f]+)$/;

const count = (log: readonly LogEvent[], kind: EventKind) =>
  log.filter((event) => event.kind === kind).length;

/**
 * What a trigger's detail is about: the comparisons and sessions it names, else its first count,
 * so a detail is said again when it names another or its count moves, and not when only its
 * wording does. Until 1 November a whole detail was compared, and over 57 recorded logs 757 of 784
 * lines of `SUPPLY THIN`, whose detail moves with each solve, said again what had been said; it is
 * now said once.
 */
function keyOf(name: string, detail: string): string {
  if (name === "SUPPLY THIN") return "";
  const ids = detail.match(NAMED);
  return ids === null ? (/\d+/.exec(detail)?.[0] ?? detail) : [...new Set(ids)].join(",");
}

/** The watched triggers as they read now, and a line for each detail whose key (`keyOf`) is new; the
 *  first reading of a run only remembers them, and `null` is no newer reading than the last. A trigger
 *  fires once for each comparison or session it names, so each name keeps every key: until a fix of
 *  1 November it kept one, and gate-free-r2's two comparisons with a task set aside said the first
 *  again at every look. */
function triggersSaid(
  before: Seen | undefined,
  { milestone, found }: { readonly milestone: boolean; readonly found: readonly Alarm[] | null },
): { now: Seen["triggers"]; said: string[] } {
  const kept = before?.triggers;
  if (found === null) return { now: kept, said: [] };
  const first = kept === undefined;
  const read = new Map<string, { lane: number; details: string[] }>();
  for (const { name, lane, detail } of found) {
    const watched = WATCHED.get(name);
    if (watched === undefined || (watched[1] === "reading" && !milestone && !first)) continue;
    read.set(name, { lane, details: [...(read.get(name)?.details ?? []), detail] });
  }
  const said = first
    ? []
    : [...read].flatMap(([name, { lane, details }]) => {
        const [factor, kind] = WATCHED.get(name) ?? ["", "alarm"];
        const known = new Set((kept[name] ?? "").split("\n"));
        return details
          .filter((detail) => !known.has(keyOf(name, detail)))
          .map(
            (detail) =>
              `${kind === "alarm" ? "⚠" : "◆"} ${factor}: ${name} (lane ${String(lane)}): ${short(detail)}`,
          );
      });
  const now = {
    ...kept,
    ...Object.fromEntries(
      [...read].map(([name, { details }]) => [name, details.map((detail) => keyOf(name, detail)).join("\n")]),
    ),
  };
  return { now, said };
}

/**
 * Where the process that writes `log` stands now, read once for the status line and the look.
 *
 * Its launch begins at the first event at or after its launch receipt, or the start where none is
 * kept, and a solve or a wait before it belongs to a process that is gone. On 29 October the Linux
 * runner's truss campaign was continued after a provider wait until 1 November, and the pulse read
 * its two cut solves as running and its new invocation as waiting out that reset, so a stall after
 * it would not have read quiet until the reset.
 *
 * A run stands where the last thing it started does (a Builder session, an Examiner session or a
 * comparison), or at its last solve where that is later: a comparison gone on from its log writes no
 * second start, so the solves it makes after another comparison's report say it has not reported.
 * That work ends in its run's end, or `exam.finished` after an Examiner session: an Examiner session
 * writes no report, and the second on exam-1 (8 October) ended whole and was said to be gone before
 * one. A campaign that wrote its ending is done whatever it was doing: until 27 October one that
 * ended while drafting its exam, which none of these starts covers, was said to be gone before a
 * report.
 *
 * A run waiting out a named reset is silent by design, so its quiet is counted from the reset: until
 * 23 October such a run was called quiet, and until 25 October it was again for the minute between
 * the reset and its next event, or while other seats wrote after the wait.
 */
function standing(run: Run, log: readonly LogEvent[]) {
  const solves = solvesIn(log);
  const begun = launchedIn(run, log);
  const opened = log.findLastIndex(({ kind }) => STARTS.has(kind));
  const solved = log.findLastIndex(({ kind }) => kind === "solve.started");
  const start = Math.max(0, opened);
  const work = log.slice(Math.max(start, solved));
  // A campaign the Builder leads ends only in its ending: until 1 November one whose process died
  // after an Examiner session or a report was taken as done, 4 of the 42 closes on record.
  const led = log.some(({ kind }) => kind === "campaign.opened");
  const end: EventKind = led ? ENDED : log[start]?.kind === "exam.started" ? "exam.finished" : run.end;
  const running = solves.filter(({ finished, started }) => finished === null && started >= begun).length;
  const ended = log.at(-1)?.kind === ENDED || (running === 0 && count(work, end) > 0);
  return { solves, start, work, end, running, begun, ended };
}

/** Where a run stands: reported, closed, inside a Builder or Examiner session, or solving. A report
 *  counts when it follows the last work: a standalone comparison solving after an earlier
 *  comparison's report has not reported. Closed is said first: until 20 October a run whose process
 *  died after a report read as that report for hours, with its unfinished solves called running. */
function stage(log: readonly LogEvent[], { start, work, running }: Standing, open: boolean): string {
  const report = work.findLast(({ kind }) => kind === REPORTED);
  if (report !== undefined) return `${open ? "" : "closed, "}reported ${word(report.data.reading)}`;
  if (!open) return "closed";
  const since = log.slice(start);
  const session = (["build", "exam"] as const).find(
    (role) => log[start]?.kind === `${role}.started` && count(since, `${role}.finished`) === 0,
  );
  if (session !== undefined) return `${session} turn ${String(count(since, traceKind(session, "turn")))}`;
  return running > 0 ? "solving" : "working";
}

/** The status line of `run`, whose log is `log`. */
function status(run: Run, log: readonly LogEvent[], stand: Standing, open: boolean, now: number) {
  const { solves } = stand;
  const said = ["pass", "fail", "flagged", "non-result"].flatMap((outcome) => {
    const n = solves.filter(({ ending }) => ending?.outcome === outcome).length;
    return n === 0 ? [] : [`${String(n)} ${outcome}`];
  });
  const unfinished = solves.filter(({ finished }) => finished === null).length;
  const running = open ? stand.running : 0;
  if (running > 0) said.push(`${String(running)} running`);
  if (unfinished > running) said.push(`${String(unfinished - running)} unfinished`);
  const last = log.at(-1);
  const promoted = count(log, PROMOTED);
  if (promoted > 0) {
    const confirmed = promotionsOf(log).filter(({ read }) => read?.confirmed === true).length;
    said.push(`${String(promoted)} promoted, ${String(confirmed)} confirmed`);
  }
  return [
    // A seed's counts and dollars are its source's up to the cut, and a script's or a run's after it.
    `${run.name}${run.seed === true ? " (a seed)" : ""}  ${stage(log, stand, open)}`,
    `solves ${said.join(", ") || "none"}`,
    dollars(billedAll(log)),
    last === undefined ? "no events" : `${minutes(now - Date.parse(last.at))} since the last event`,
  ].join(" · ");
}

/** The line of each event of `log` from `from` on, in the log's order, with what stands under it:
 *  a starter comparison and the pause it makes ready under their report (`climbAt`), and the readers'
 *  lines of that event (`under`, by its place among those events). A promotion's line is the climb's. */
function eventsSaid(name: string, log: readonly LogEvent[], from: number, under: Under | undefined) {
  const climb = climbAt(name, log, from);
  return log.slice(from).map(({ kind, data }, nth) => {
    const climbed = climb.get(from + nth) ?? [];
    const promoted = kind === PROMOTED;
    return {
      line: promoted ? (climbed[0] ?? null) : (SAID[kind]?.(data) ?? null),
      below: [...(promoted ? climbed.slice(1) : climbed), ...(under?.get(nth) ?? [])],
    };
  });
}

/** What to look at among the events of `log` from `from` on: solves that waited long for the load,
 *  failed turns, and turns another model served. */
function troubles(log: readonly LogEvent[], from: number): string[] {
  const fresh = log.slice(from);
  const lines: string[] = [];
  const loaded = fresh.flatMap(({ kind, data }) =>
    kind === "campaign.waited" && !isString(data.for) && isNumber(data.ms) && data.ms > LOAD_WAIT_MS
      ? [data]
      : [],
  );
  const longest = loaded.toSorted((a, b) => Number(b.ms) - Number(a.ms))[0];
  if (longest !== undefined) {
    lines.push(
      `⚠ ${plural(loaded.length, "solve")} waited over ${minutes(LOAD_WAIT_MS)} for the load, the longest ${minutes(Number(longest.ms))} at load ${isNumber(longest.load) ? longest.load.toFixed(1) : "?"} on ${word(longest.cores)} cores`,
    );
  }
  const turns = tracesIn(fresh).flatMap((each) => (each.part === "turn" ? [each] : []));
  const errors = turns.flatMap(({ error }) => (error === null ? [] : [error]));
  if (errors.length > 0) {
    lines.push(`⚠ ${plural(errors.length, "failed turn")}: ${[...new Set(errors)].map(short).join("; ")}`);
  }
  const others = degradations(log, from);
  if (others.length > 0) {
    const served = others.reduce((sum, row) => sum + row.turns, 0);
    const which = [...new Set(others.map((row) => `${row.served} for ${row.asked}`))];
    lines.push(`⚠ ${plural(served, "turn")} served by another model: ${which.join("; ")}`);
  }
  return lines;
}

/** The look's lines, those of its events first. A comparison starts each task under two harnesses,
 *  so a line may come twice and is said once with its count. One with lines of its own below it
 *  stays where it is: two reports can read alike, and each starter comparison belongs under its own. */
function folded(events: ReturnType<typeof eventsSaid>, lines: readonly string[]): string[] {
  const heads = [
    ...events.flatMap(({ line, below }) => (line === null ? [] : [{ line, below }])),
    ...lines.map((line) => ({ line, below: [] })),
  ];
  const alike = Map.groupBy(heads, ({ line, below }, at) => (below.length === 0 ? line : at));
  return [...alike.values()].flatMap((same) =>
    same
      .slice(0, 1)
      .flatMap(({ line, below }) => [
        same.length === 1 ? line : `${line} (×${String(same.length)})`,
        ...below.map((one) => `  ${one}`),
      ]),
  );
}

/**
 * One look at one run: its status line, what happened since `before`, and what to remember. A
 * first look says only the status and a quiet already under way. `milestone` says that the triggers
 * read past one, where they lag the events; by itself a milestone in the events says so. `live`
 * says that the run may still write its log, which a keeper makes true of one no process writes.
 *
 * A campaign's look also says the step it has come to owe, once, at the look that finds it so: an
 * investigation at its trigger (`triggerOf`), with the command that opens one. Until 10 November
 * only the loop's driver read the trigger, so a session that watched the pulse alone ran a
 * campaign past twelve hours unread.
 */
export function pulse(
  run: Run,
  log: readonly LogEvent[],
  process: "open" | "closed",
  before: Seen | undefined,
  {
    now,
    alarms,
    milestone,
    live,
    under,
  }: {
    readonly now: number;
    readonly alarms: () => readonly Alarm[] | null;
    readonly milestone?: boolean;
    readonly live?: boolean;
    readonly under?: Under;
  },
): Look {
  const open = process === "open";
  const stand = standing(run, log);
  const from = before?.lines ?? log.length;
  const fresh = log.slice(from);
  const events = eventsSaid(run.name, log, from, under);
  const lines = troubles(log, from);
  const state = stateOf(log, { writing: open, kept: false }, now, stand.begun);
  const quiet = log.length > 0 && state.kind === "quiet";
  if (quiet && before?.quiet !== true) lines.push(`⚠ quiet for ${minutes(now - state.since)}`);
  if (!quiet && before?.quiet === true) lines.push("· not quiet any more");
  if (before?.open === true && !open && !stand.ended) lines.push(`⚠ the process is gone before ${stand.end}`);
  const triggers = triggersSaid(before, {
    milestone: milestone ?? fresh.some(({ kind }) => MILESTONES.has(kind)),
    found: alarms(),
  });
  lines.push(...triggers.said);
  // The trigger is a campaign's: a round or a seed measures no climb an investigation could read.
  const read = isCampaign(run) && run.seed !== true;
  const due = read ? triggerOf(progressOf({ live: live ?? open }, log, now)) : null;
  if (due !== null && before?.due === false) {
    lines.push(`⚠ investigation due, ${due}: ${openingCommand(run.name, live ?? open)}`);
  }
  return {
    status: status(run, log, stand, open, now),
    // What belongs to an event the look says nothing of comes after the rest.
    said: [...folded(events, lines), ...events.flatMap(({ line, below }) => (line === null ? below : []))],
    seen: {
      ...before,
      lines: log.length,
      open,
      quiet,
      ...keyIfDefined("due", read ? due !== null : undefined),
      ...keyIfDefined("triggers", triggers.now),
    },
  };
}

/** One run's look, with what the readers add to it where `store` is given. */
function runLook(
  { run, open, before, events, size }: Chosen,
  options: { now: number; store: string | null; state: string; spare: number; live: boolean },
) {
  const { now, store, live } = options;
  const process = open ? "open" : "closed";
  if (store === null) {
    const seen = pulse(run, events, process, before, { now, live, alarms: () => null });
    return { events, seen: seen.seen, status: seen.status, said: seen.said, readers: 0 };
  }
  const moved = alarmsMoved(store, run.path, before?.rowsAt);
  const read = readersSaid({
    store,
    log: run.path,
    size,
    fresh: events.slice(before?.lines ?? events.length),
    owed: before?.moments,
    said: before?.said,
    files: join(`${options.state}.d`, run.name),
    spare: options.spare,
    watched: new Set([...WATCHED.keys(), ...OWN]),
  });
  // The rows read again only past a moment, so a move of theirs is a milestone.
  const seen = pulse(run, events, process, before, {
    now,
    live,
    alarms: () => moved?.alarms ?? null,
    milestone: moved !== null,
    under: new Map(read.placed.map(({ at, lines }) => [at, lines])),
  });
  // Only these are kept, so a state from before 10 November drops what its readers compared.
  const { lines, open: wasOpen, quiet, triggers, due } = seen.seen;
  const rowsAt = moved?.size ?? before?.rowsAt;
  const kept: Seen = {
    lines,
    open: wasOpen,
    quiet,
    ...keyIfDefined("triggers", triggers),
    ...keyIfDefined("due", due),
  };
  return {
    events,
    status: seen.status,
    said: [...seen.said, ...read.lines],
    readers: read.lines.length + read.placed.flatMap((one) => one.lines).length,
    seen: { ...kept, ...keyIfDefined("rowsAt", rowsAt), moments: read.owed, said: read.said },
  };
}

/**
 * One look over the chosen runs: the lines it says, none where nothing moved, and what to remember once
 * they are said. A run's row is said on its first look and with something new, and the host's line
 * above any row. Until 1 November every look said every row and each closed run's reason again, so a
 * watch of three hosts printed some twenty lines every five minutes with nothing in them a reader had
 * not seen.
 */
async function look(
  state: string,
  names: readonly string[],
  memory: Memory,
  { store }: { readonly store: string | null },
): Promise<{ lines: string[]; memory: Memory }> {
  const running = processes();
  const all = runs().map((run) => ({
    run,
    open: writers(run, running).length > 0,
    before: memory.logs[run.path],
  }));
  // Only a log the look reports is read: until 2 November every look parsed every run's whole log,
  // closed ones included, which was 0.55 s of a 2.5 s look on the Linux runner.
  const chosen: Chosen[] = all
    .filter(({ run, open, before }) =>
      names.length > 0
        ? names.some((name) => run.name.includes(name))
        : open ||
          before?.open === true ||
          (before?.moments?.length ?? 0) > 0 ||
          (before === undefined &&
            !unlaunchedSeed(run) &&
            Date.now() - statSync(run.path).mtimeMs < RECENT_MS &&
            logEvents(run.path).at(-1)?.kind !== ENDED),
    )
    // The bytes are read after the events, so a moment's size covers it.
    .map((each) => ({ ...each, events: logEvents(each.run.path), size: statSync(each.run.path).size }));
  if (store !== null) {
    const tree = resolve(import.meta.dir, "..", "..");
    const asks = chosen.map(({ run, before, events, size }) => ({
      log: run.path,
      size,
      fresh: events.slice(before?.lines ?? events.length),
      owed: before?.moments,
    }));
    await startPass(store, asks, { tree });
  }
  const now = Date.now();
  const disk = statfsSync(".");
  const free = Math.round((disk.bavail * disk.bsize) / GIB);
  const gained = memory.freeGiB === null ? 0 : free - memory.freeGiB;
  const since =
    memory.freeGiB === null ? "" : ` (${gained >= 0 ? "+" : ""}${String(gained)} since the last look)`;
  const head = `${new Date(now).toISOString().slice(11, 16)}Z ${String(all.filter(({ open }) => open).length)} open · load ${(loadavg()[0] ?? 0).toFixed(1)} of ${String(availableParallelism())} cores · ${String(free)} GiB free${since}`;
  // A run this look left out keeps what the last look saw of it.
  const logs: Record<string, Seen> = { ...memory.logs };
  const said: string[] = [];
  let spare = PER_LOOK;
  for (const each of chosen) {
    const { run, before } = each;
    const one = runLook(each, { now, store, state, spare, live: stillRunning(run, running) });
    spare -= one.readers;
    // A state's reason is said when the run comes to stand so, and not again under each later line.
    const stands = runState(run, one.events, running, now);
    const reasons = before?.state === stands.kind ? [] : await runReason(run, stands);
    if (before === undefined || one.said.length + reasons.length > 0) {
      said.push(one.status, ...[...one.said, ...reasons].map((line) => `  ${line}`));
    }
    logs[run.path] = { ...one.seen, state: stands.kind };
  }
  return {
    lines: said.length === 0 ? [] : [head, ...said],
    memory: { ...memory, freeGiB: free, logs },
  };
}

/** A peer's first step on its caller's word: what it said last is read if the caller returned its
 *  token, so it is remembered; otherwise it is dropped, and this look says it again. */
function settle(state: string, ack: string): void {
  const pending = `${state}.pending`;
  if (!existsSync(pending)) return;
  try {
    const { token, memory } = parseJsonAs<{ token: string; memory: Memory }>(readFileSync(pending, "utf8"));
    if (token === ack) remember(state, capturedJsonStringify(memory));
  } catch {
    // One a kill cut part way, as the write in place before 9 November could leave, is not read.
  }
  rmSync(pending, { force: true });
}

/**
 * What a look says of each peer, in the order they are listed, the token each printed last, and
 * the hosts that gave no answer. A late answer's token is never returned, so its host says those
 * lines again at the next look. A silent host is a warning and exit 1 at the look that finds it so,
 * and is said again when it answers: until 10 November every look at a host that stayed down
 * failed and said so, which was a line and a woken session every five minutes of an outage.
 */
async function saidOfPeers(
  away: readonly { name: string; ask: ReturnType<typeof asked> }[],
  started: number,
  { acks = {}, down = [] }: Pick<Memory, "acks" | "down">,
): Promise<{ acks: Record<string, string>; down: string[]; unanswered: boolean }> {
  const tokens = { ...acks };
  const silent: string[] = [];
  let unanswered = false;
  for (const { name, ask } of away) {
    const [answer] = (await withinDeadline(ask, PEERS_MS - (performance.now() - started))) ?? [];
    const elapsed = ((answer?.elapsedMs ?? performance.now() - started) / 1000).toFixed(1);
    const lines = answer?.lines ?? null;
    if (lines === null) {
      unanswered = answer === undefined || unanswered;
      silent.push(name);
      if (down.includes(name)) continue;
      console.log(
        `── ${name} (${elapsed} s)\npulse unavailable\n  ⚠ no answer: its lines carry to the next look`,
      );
      runtimeProcess.exitCode = 1;
      continue;
    }
    const token = ACK_LINE.exec(lines.at(-1) ?? "")?.[1];
    const said = [
      ...(down.includes(name) ? ["· answers again"] : []),
      ...(token === undefined ? lines : lines.slice(0, -1)),
    ];
    if (token === undefined) delete tokens[name];
    else tokens[name] = token;
    if (said.some((line) => line.trim() !== "")) console.log(`── ${name} (${elapsed} s)\n${said.join("\n")}`);
  }
  return { acks: tokens, down: silent, unanswered };
}

/** `bun run runs pulse`. */
export async function watch(args: readonly string[]): Promise<void> {
  const { values, positionals: names } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      every: { type: "string" },
      state: { type: "string", default: join(".ana", "runs-pulse.json") },
      here: { type: "boolean", default: false },
      ack: { type: "string" },
      "no-readers": { type: "boolean", default: false },
    },
  });
  const cwd = runtimeProcess.cwd();
  const readers = !values["no-readers"];
  const store = readers ? storeOf(cwd) : null;
  const state = values.here ? resolve(mainTree(cwd), values.state) : values.state;
  // Each observer has its own cursor on each host. A local --state is never a remote path.
  const cursor = sha256(`${cwd}\n${values.state}`).slice(0, 24);
  for (;;) {
    const started = performance.now();
    if (values.ack !== undefined) settle(state, values.ack);
    if (values.here) pruneObservers(state);
    const memory: Memory = existsSync(state)
      ? parseJsonAs<Memory>(readFileSync(state, "utf8"))
      : { freeGiB: null, logs: {} };
    const away = (values.here ? [] : hostsOf()).map((host) => ({
      name: host.name,
      ask: asked(
        [
          "pulse",
          ...names,
          "--here",
          "--state",
          `.ana/pulse/${cursor}.json`,
          "--ack",
          memory.acks?.[host.name] ?? "none",
          ...(readers ? [] : ["--no-readers"]),
        ],
        [host],
      ),
    }));
    const here = await look(state, names, memory, { store });
    if (values.ack !== undefined && here.lines.length > 0) {
      // A peer's answer: what it would remember waits for its caller to return the last line.
      const token = sha256(`${String(Date.now())}\n${String(runtimeProcess.pid)}`).slice(0, 16);
      remember(`${state}.pending`, capturedJsonStringify({ token, memory: here.memory }));
      console.log([...here.lines, `ack ${token}`].join("\n"));
    } else {
      if (here.lines.length > 0) {
        console.log(
          [...(values.here || hostsOf().length === 0 ? [] : ["── here"]), ...here.lines].join("\n"),
        );
      }
      remember(state, capturedJsonStringify(here.memory));
    }
    const { unanswered, ...peers } = await saidOfPeers(away, started, memory);
    if (away.length > 0) remember(state, capturedJsonStringify({ ...here.memory, ...peers }));
    // A host still preparing holds this process for up to five minutes, and the hook's limit is 40 s;
    // the exit carries the code a host newly silent set.
    if (values.every === undefined && unanswered) runtimeProcess.exit();
    if (values.every === undefined) break;
    await Bun.sleep(Number(values.every) * 1000);
  }
}

/** Whether `status` shows a run without `--all`, whose log last changed `age` ago. */
export const onStatus = (run: Run, writing: "open" | "closed", age: number): boolean =>
  writing === "open" || (!unlaunchedSeed(run) && age <= RECENT_MS);

/**
 * `bun run runs status`: one row a run, open or written in the last day, or every one with `--all`;
 * a closed row says when it leaves, and the lines under the rows what they leave out (`leftOut`);
 * then the same on each host `ANA_HOSTS` lists (`hosts.ts`), so one command shows every machine's.
 */
export async function runsStatus(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({ args: [...args], options: { all: { type: "boolean", default: false } } });
  const running = processes();
  const now = Date.now();
  // Every host is asked first, and its rows print once this machine's have.
  const away = hostsOf().length > 0 ? hosts(args) : undefined;
  let [promoted, compared, quiet] = [0, 0, 0];
  for (const run of runs()) {
    const open = writers(run, running).length > 0;
    const age = now - statSync(run.path).mtimeMs;
    // A seed no launch went on from is a rehearsal's copy, and its promotions are its source's, shown
    // while a process writes it (16 October: fork-ladder-buffer-opus was not shown).
    if (!values.all && !onStatus(run, open ? "open" : "closed", age)) {
      if (!unlaunchedSeed(run)) quiet += 1;
      continue;
    }
    const log = logEvents(run.path);
    const kept = lastLaunch(run.path);
    const ended = log.at(-1)?.kind === ENDED ? `ended ${word(log.at(-1)?.data.ending)}` : "";
    const comparing = openComparisons(log);
    const [steps, reads] = [count(log, PROMOTED), count(log, REPORTED)];
    [promoted, compared] = [promoted + steps, compared + reads];
    const where = [
      basename(run.tree),
      kept?.commit.slice(0, 9) ?? "",
      kept?.login === undefined ? "" : `login ${kept.login}`,
      comparing.length > 0 ? `comparing ${comparing.join(", ")}` : "",
      `${String(reads)} compared`,
      steps > 0 ? `* ${String(steps)}x promotion *` : "",
      open ? "" : ended,
      open || age > RECENT_MS ? "" : `off status in ${String(Math.ceil((RECENT_MS - age) / HOUR_MS))}h`,
    ];
    console.log(
      `${status(run, log, standing(run, log), open, now)}\n  ${where.filter((part) => part !== "").join(" · ")}`,
    );
  }
  console.log(`${plural(promoted, "promotion")} in ${plural(compared, "comparison")} over the runs shown`);
  // This machine's own: a host's copy is said by that host's `status`, as its rows are.
  const archive = archived().filter((run) => run.archived === HERE && !unlaunchedSeed(run));
  const newest = archive
    .map((run) => ({ run, at: statSync(run.path).mtimeMs }))
    .toSorted((one, other) => other.at - one.at)
    .slice(0, NEWEST)
    .map(({ run, at }) => ({
      name: run.name,
      days: (now - at) / DAY_MS,
      promoted: count(logEvents(run.path), PROMOTED),
    }));
  for (const line of leftOut(quiet, archive.length, newest)) console.log(line);
  await away;
}

/**
 * What `status` leaves out, said under its rows, so that a reader who sees only the rows still knows
 * what ran: the closed runs quiet for over a day, still in their worktrees and continued from there,
 * and the archive `runs retire` moves them to after a day, with its newest campaigns. Until
 * 22 October a run fell off the rows after a day without a word, and an agent reading `status`
 * alone took the campaigns it had stopped for gone (operator, 22 October).
 */
export function leftOut(
  quiet: number,
  archive: number,
  newest: readonly { readonly name: string; readonly days: number; readonly promoted: number }[],
): string[] {
  const lines =
    quiet > 0 ? [`${plural(quiet, "closed run")} quiet over a day not shown: \`status --all\``] : [];
  if (archive === 0) return lines;
  const named = newest.map(({ name, days, promoted }) =>
    [name, `${String(Math.floor(days))}d`, promoted > 0 ? `${String(promoted)}x promotion` : ""]
      .filter((part) => part !== "")
      .join(" · "),
  );
  return [
    ...lines,
    `${plural(archive, "campaign")} in the archive (${ARCHIVE}), newest: ${named.join("; ")}`,
    "  `runs view <name>` reads one; `runs copy <name> --to <worktree>` brings one back to continue",
  ];
}
