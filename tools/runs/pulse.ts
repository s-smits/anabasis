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
 * Since 5 November a look also says what the deterministic readers found in each run whose log moved
 * (`pulse-readers.ts`), which `--no-readers` leaves out, and the triggers come from their `rows`.
 * `--no-embed` keeps them and leaves out only those that load the local embedding model.
 * Until then a look took 2.1 s at the median and read the investigation only after an event that can
 * move a trigger (27% of the looks where a log grew, over 57 recorded logs): a pass now shares that
 * read between observers and bounds it, so the two of 358 alarms it said up to 29 minutes late are said
 * at the next look.
 *
 * Nothing a look read is lost to a kill, and the hook's `timeout 40` kills it whole. A look remembers
 * only after it has printed, so a kill before that says the same events again, and a look over ssh
 * cannot know its caller read it: a peer holds what it would remember in `<state>.pending` until the
 * caller's next look returns the token it printed last (`--ack`), and looks again from the old cursor
 * if it does not. A host that has not answered within `PEERS_MS` is said to have left its lines for the
 * next look, on stdout, where the hook's filter keeps them.
 */
import { comparisonFloor } from "#src/campaign/admission.ts";
import { BARS } from "#src/campaign/climb.ts";
import { readsStepEitherWay, scoresIn, testOf } from "#src/kernel/compare.ts";
import type { EventKind, LogEvent } from "#src/kernel/log.ts";
import { degradations, traceKind, tracesIn } from "#src/kernel/trace.ts";
import { billedAll } from "#src/kernel/meter.ts";
import { solvesIn } from "#src/kernel/solves.ts";
import { existsSync, readFileSync, rmSync, statfsSync, statSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { availableParallelism, loadavg } from "#src/meta/os.ts";
import { basename, join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { sha256 } from "#src/meta/digest.ts";
import { mainTree } from "#src/meta/git.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import { asked, hosts } from "./hosts.ts";
import { hostsOf } from "./host-config.ts";
import { lastLaunch, unlaunchedSeed } from "./receipt.ts";
import { launchedIn, runReason, runState, stateOf } from "./state.ts";
import {
  type Alarm,
  alarmsMoved,
  PER_LOOK,
  pastMilestone,
  pruneObservers,
  readersSaid,
  remember,
  resultOf,
  type SaidOf,
  startPass,
  storeOf,
  triggerNameOf,
  withinDeadline,
} from "./pulse-readers.ts";
import {
  ARCHIVE,
  archived,
  HERE,
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
  /** The log's bytes at the last look, and at the last look that saw a milestone in its events. */
  readonly size?: number;
  readonly milestoneAt?: number;
  /** What this observer has compared of each reader. */
  readonly readers?: Readonly<Record<string, SaidOf>>;
  /** Readers behind the log, which keep a closed run in the looks until they have read it. */
  readonly owed?: boolean;
}

/** One look at one run: its status line, what it says of the events since the last look, and what
 *  to remember of it. */
interface Look {
  readonly status: string;
  readonly said: readonly string[];
  readonly seen: Seen;
}

/** Where the process that writes a log stands now. */
type Standing = ReturnType<typeof standing>;

/** The state file: the free disk at the last look, what it saw of each log by its path, and the token
 *  each host printed last, which the next look returns to it. */
interface Memory {
  readonly freeGiB: number | null;
  readonly logs: Record<string, Seen>;
  readonly acks?: Readonly<Record<string, string>>;
}

/** A closed run `status` shows without `--all`: one whose log changed this recently. */
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const RECENT_MS = DAY_MS;
/** How many of the archive's newest campaigns `status` names under its rows. */
const NEWEST = 3;
const GIB = 2 ** 30;
const REPORTED = "comparison.reported";
const PROMOTED = "harness.promoted";
const ENDED = "campaign.ended";
/** The events that start something a run then has to finish. */
const STARTS: ReadonlySet<string> = new Set(["build.started", "exam.started", "comparison.started"]);

/**
 * The investigation's triggers a watch says, by the factor each bears on (`AGENTS.md`, section 1).
 * An alarm is read at every look where the `rows` reader moved and said where it fired or its key
 * moved (`keyOf`); a reading moves with each solve, so it is said only after a milestone. On
 * 1 November an unconfirmed promotion in a live buffer campaign was found only by running `wri.ts
 * read` on it by hand. A trigger the pulse reads itself is left out (a model served, an unfinished
 * session), and so is one every promotion fires until its starter comparison reports. A trigger left
 * out here is said once by the `rows` reader's own lines (`readersSaid`).
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
  ["PROMOTION UNCONFIRMED", ["climb", "reading"]],
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
  ["CHECKER READ WITH FAULTS", ["verdicts", "alarm"]],
  ["FROZEN DESPITE FAULTS", ["verdicts", "alarm"]],
  ["SESSION CRASHED", ["economy", "alarm"]],
]);
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

const isMilestone = ({ kind }: LogEvent) => MILESTONES.has(kind);

const minutes = (ms: number) => `${String(Math.round(ms / 60_000))}m`;
const dollars = (value: number) => `$${value.toFixed(2)}`;
const short = (value: unknown) => (isString(value) ? value.replaceAll(/\s+/g, " ").slice(0, 160) : "");
const count = (log: readonly LogEvent[], kind: EventKind) =>
  log.filter((event) => event.kind === kind).length;
/** A string or number field as written, and "?" for a field the event does not hold. */
const word = (value: unknown) => (isString(value) || isNumber(value) ? String(value) : "?");

/** How long a session or a solve took, and what it billed, as its `.finished` event says. */
const cost = (data: JsonObject) =>
  `${isNumber(data.seconds) ? ` in ${minutes(data.seconds * 1000)}` : ""}${isNumber(data.billed) ? `, ${dollars(data.billed)}` : ""}`;

/**
 * A report in the four factors and supply (`AGENTS.md`, section 1), from the event alone: the tasks
 * the reference left room on against the admission floor, the reference against itself, and the
 * attempt this epoch against the economy's bar. Until 1 November the line said only the reading,
 * and a watch learned that buffer's promoted harness left 0 of 8 tasks informative by reading the
 * log by hand. An A/A that clears the level, a floor not met or a bar passed is one to look at.
 */
function factorsOf(data: JsonObject): { said: string; look: boolean } {
  const informative = asRecord(asRecord(data.valid)?.informative)?.old;
  const level = isNumber(data.level) ? data.level : 0.02;
  const floor = comparisonFloor(level);
  // The A/A is read as a step is, either way, on the scores the step is read on (`scoresIn`).
  const noise = asRecord(data.noise);
  const scores = Array.isArray(noise?.differences) ? scoresIn(noise) : undefined;
  const aa = scores === undefined ? null : testOf(scores);
  const clears = scores !== undefined && readsStepEitherWay(scores, level);
  const worth = asRecord(data.worth);
  const spent = asRecord(worth?.cost);
  const attempts = spent?.attempts;
  const scant = isNumber(informative) && informative < floor;
  // Past the bar as the report reads it (`met`, `costOf`, `climb.ts`): set-up's epoch never is.
  const dear = spent?.met === false;
  const parts = [
    isNumber(informative)
      ? `supply ${String(informative)} of ${word(data.tasks)} informative, floor ${String(floor)}`
      : "",
    aa === null
      ? ""
      : `A/A ${String(aa.wins)}-${String(aa.losses)}-${String(aa.ties)}${clears ? " cleared the level" : ""}`,
    isNumber(attempts) ? `attempt ${String(attempts)} of ${String(BARS.cost)} this epoch` : "",
  ].filter((part) => part !== "");
  return { said: parts.map((part) => ` · ${part}`).join(""), look: clears || dear || scant };
}

/** What a comparison's report earns: one that scored nothing, one its cap cut, or one with tasks set
 *  aside on rejections nobody has settled is one to look at before it is believed
 *  (`src/campaign/round.ts`), and so is one whose factors say so (`factorsOf`). */
function reportLine(data: JsonObject): string {
  const head = reportHead(data);
  const { said, look: flagged } = factorsOf(data);
  return `${flagged ? head.replace(/^◆/, "⚠") : head}${said}`;
}

function reportHead(data: JsonObject): string {
  const settled = asRecord(data.settled);
  if (settled !== null) {
    return `◆ settled by hand as ${word(data.reading)}: ${word(settled.labelled)} labelled, ${word(settled.defects)} a check defect`;
  }
  if (data.capped === true) {
    return `⚠ reported ${word(data.reading)}: its dollar cap cut ${asRecord(data.scored) === null ? "it short" : "the starter's solves short, and its test stands"}`;
  }
  const aside = Array.isArray(data.aside) ? data.aside.length : 0;
  if (aside > 0) {
    return `⚠ reported ${word(data.reading)}, with ${String(aside)} task(s) set aside on rejections no person has settled`;
  }
  return `${data.reading === "not-scored" ? "⚠" : "◆"} reported ${word(data.reading)}`;
}

/** The line each event a reader wants earns; a kind not here is a trace, and null is one of its
 *  kind left unsaid. */
const SAID: Partial<Record<EventKind, (data: JsonObject) => string | null>> = {
  "build.started": (data) => `· build ${word(data.session)} started on ${word(data.model)}`,
  "exam.started": (data) => `· exam ${word(data.session)} started on ${word(data.model)}`,
  "build.finished": (data) =>
    `◆ build ended at ${word(data.ended)} and ${data.changed === true ? "changed the harness" : "left the harness as it was"}` +
    `${data.broken === null ? "" : `, broken: ${short(data.broken)}`}${cost(data)}`,
  "exam.finished": (data) => `◆ exam ${word(data.session)} ended${cost(data)}`,
  "harness.version": (data) =>
    `· harness ${word(data.version).slice(0, 8)}${short(data.note) === "" ? "" : `: ${short(data.note)}`}`,
  // A solve is counted in the status line, and only a non-result has a line of its own, by its kind
  // and reason: over 57 recorded logs, a line a solve started or passed was 74% of everything the
  // pulse said, and no person acts on one. A line a look counting its solves, replayed on those
  // logs, became the most said line, and printed the row the status line already counts.
  "solve.finished": (data) => {
    const ending = asRecord(data.ending);
    // The gate cut a room solve once another settled the task's room, from 31 October until it
    // stopped solving on 1 November; until 31 October each cut warned as a solve with no result.
    if (ending?.outcome !== "non-result" || ending.cancelledBy === "admission") return null;
    return `⚠ a solve ended without a result, ${word(ending.kind)}: ${short(ending.reason)}`;
  },
  // A campaign's ending, and a wait for the provider or the network: until 15 October the pulse
  // said neither, and a run waiting out a limit read as quiet. A wait on the load is one a solve.
  [ENDED]: (data) => `◆ the campaign ended ${word(data.ending)}: ${short(data.why)}`,
  // Until 27 October a promotion had no line, and an hourly watch over the pulse missed one by 4.5 h.
  [PROMOTED]: (data) => `◆ promoted ${word(data.harness).slice(0, 8)} to the reference`,
  "campaign.waited": (data) =>
    isString(data.for)
      ? `⚠ waited ${isNumber(data.ms) ? minutes(data.ms) : "?"} for the ${data.for}${isString(data.until) ? ` until ${data.until}` : ""}`
      : null,
  "referee.finding": (data) => `· the Referee on ${word(data.task)}: ${short(data.reason)}`,
  [REPORTED]: reportLine,
};

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
  if (promoted > 0) said.push(`${String(promoted)} promoted`);
  return [
    // A seed's counts and dollars are its source's up to the cut, and a script's or a run's after it.
    `${run.name}${run.seed === true ? " (a seed)" : ""}  ${stage(log, stand, open)}`,
    `solves ${said.join(", ") || "none"}`,
    dollars(billedAll(log)),
    last === undefined ? "no events" : `${minutes(now - Date.parse(last.at))} since the last event`,
  ].join(" · ");
}

/** One look at one run: its status line, what happened since `before`, and what to remember. A
 *  first look says only the status and a quiet already under way. `milestone` says that the triggers
 *  read past one, where they lag the events; by itself a milestone in the events says so. */
export function pulse(
  run: Run,
  log: readonly LogEvent[],
  process: "open" | "closed",
  before: Seen | undefined,
  {
    now,
    alarms,
    milestone,
  }: { readonly now: number; readonly alarms: () => readonly Alarm[] | null; readonly milestone?: boolean },
): Look {
  const open = process === "open";
  const stand = standing(run, log);
  const fresh = log.slice(before?.lines ?? log.length);
  const lines = fresh.flatMap(({ kind, data }) => SAID[kind]?.(data) ?? []);
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
  const others = degradations(log, before?.lines ?? log.length);
  if (others.length > 0) {
    const served = others.reduce((sum, row) => sum + row.turns, 0);
    const which = [...new Set(others.map((row) => `${row.served} for ${row.asked}`))];
    lines.push(`⚠ ${plural(served, "turn")} served by another model: ${which.join("; ")}`);
  }
  const state = stateOf(log, { writing: open, kept: false }, now, stand.begun);
  const quiet = log.length > 0 && state.kind === "quiet";
  if (quiet && before?.quiet !== true) lines.push(`⚠ quiet for ${minutes(now - state.since)}`);
  if (!quiet && before?.quiet === true) lines.push("· not quiet any more");
  if (before?.open === true && !open && !stand.ended) lines.push(`⚠ the process is gone before ${stand.end}`);
  const triggers = triggersSaid(before, { milestone: milestone ?? fresh.some(isMilestone), found: alarms() });
  lines.push(...triggers.said);
  // A comparison starts each task under two harnesses, so a line may come twice.
  const said = Object.entries(countBy(lines, (line) => line)).map(([line, n]) =>
    n === 1 ? line : `${line} (×${String(n)})`,
  );
  return {
    status: status(run, log, stand, open, now),
    said,
    seen: {
      ...before,
      lines: log.length,
      open,
      quiet,
      ...keyIfDefined("triggers", triggers.now),
    },
  };
}

/** One run's look, with what the readers add to it where `store` is given. */
function runLook(
  { run, open, before }: { run: Run; open: boolean; before: Seen | undefined },
  { now, store, state, spare }: { now: number; store: string | null; state: string; spare: number },
) {
  const size = statSync(run.path).size;
  const events = logEvents(run.path);
  const fresh = events.slice(before?.lines ?? events.length);
  const milestoneAt = fresh.some(isMilestone) ? size : before?.milestoneAt;
  const rows = before?.readers?.rows;
  const seen = pulse(run, events, open ? "open" : "closed", before, {
    now,
    ...(store === null
      ? { alarms: () => null }
      : {
          alarms: () => alarmsMoved(store, run.path, rows),
          milestone: pastMilestone(milestoneAt, rows?.size, resultOf(store, run.path, "rows")?.size ?? -1),
        }),
  });
  if (store === null) return { events, seen: seen.seen, status: seen.status, said: seen.said, readers: 0 };
  const read = readersSaid({
    store,
    log: run.path,
    size,
    lastSize: before?.size,
    before: before?.readers,
    milestoneAt,
    files: join(`${state}.d`, run.name),
    spare,
    // A watched trigger's own lines say it, and repeat it only as its key moves (`keyOf`).
    saidElsewhere: (reader, line) => reader === "rows" && WATCHED.has(triggerNameOf(line)),
  });
  return {
    events,
    status: seen.status,
    said: [...seen.said, ...read.said],
    readers: read.said.length,
    seen: {
      ...seen.seen,
      size,
      ...keyIfDefined("milestoneAt", milestoneAt),
      readers: read.seen,
      owed: read.owed,
    } satisfies Seen,
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
  { store, noEmbed }: { readonly store: string | null; readonly noEmbed: boolean },
): Promise<{ lines: string[]; memory: Memory }> {
  const running = processes();
  const all = runs().map((run) => ({
    run,
    open: writers(run, running).length > 0,
    before: memory.logs[run.path],
  }));
  // Only a log the look reports is read: until 2 November every look parsed every run's whole log,
  // closed ones included, which was 0.55 s of a 2.5 s look on the Linux runner.
  const chosen = all.filter(({ run, open, before }) =>
    names.length > 0
      ? names.some((name) => run.name.includes(name))
      : open ||
        before?.open === true ||
        before?.owed === true ||
        (before === undefined &&
          !unlaunchedSeed(run) &&
          Date.now() - statSync(run.path).mtimeMs < RECENT_MS &&
          logEvents(run.path).at(-1)?.kind !== ENDED),
  );
  if (store !== null) {
    const tree = resolve(import.meta.dir, "..", "..");
    await startPass(
      store,
      chosen.map(({ run }) => run.path),
      { tree, noEmbed },
    );
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
    const one = runLook(each, { now, store, state, spare });
    spare -= one.readers;
    if (before === undefined || one.said.length > 0) {
      const reasons = await runReason(run, runState(run, one.events, running, now));
      said.push(one.status, ...[...one.said, ...reasons].map((line) => `  ${line}`));
    }
    logs[run.path] = one.seen;
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

/** What a look says of each peer, in the order they are listed, and the token each printed last. A late
 *  answer's token is never returned, so its host says those lines again at the next look. */
async function saidOfPeers(
  away: readonly { name: string; ask: ReturnType<typeof asked> }[],
  started: number,
  acks: Readonly<Record<string, string>>,
): Promise<{ acks: Record<string, string>; unanswered: boolean }> {
  const tokens = { ...acks };
  let unanswered = false;
  for (const { name, ask } of away) {
    const [answer] = (await withinDeadline(ask, PEERS_MS - (performance.now() - started))) ?? [];
    const elapsed = ((answer?.elapsedMs ?? performance.now() - started) / 1000).toFixed(1);
    const lines = answer?.lines ?? null;
    if (lines === null) {
      unanswered = answer === undefined || unanswered;
      console.log(
        `── ${name} (${elapsed} s)\npulse unavailable\n  ⚠ no answer: its lines carry to the next look`,
      );
      runtimeProcess.exitCode = 1;
      continue;
    }
    const token = ACK_LINE.exec(lines.at(-1) ?? "")?.[1];
    const said = token === undefined ? lines : lines.slice(0, -1);
    if (token === undefined) delete tokens[name];
    else tokens[name] = token;
    if (said.some((line) => line.trim() !== "")) console.log(`── ${name} (${elapsed} s)\n${said.join("\n")}`);
  }
  return { acks: tokens, unanswered };
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
      "no-embed": { type: "boolean", default: false },
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
          ...(values["no-embed"] ? ["--no-embed"] : []),
        ],
        [host],
      ),
    }));
    const here = await look(state, names, memory, { store, noEmbed: values["no-embed"] });
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
    const { acks, unanswered } = await saidOfPeers(away, started, memory.acks ?? {});
    if (away.length > 0) remember(state, capturedJsonStringify({ ...here.memory, acks }));
    // A host still preparing holds this process for up to five minutes, and the hook's limit is 40 s.
    if (values.every === undefined && unanswered) runtimeProcess.exit(1);
    if (values.every === undefined) break;
    await Bun.sleep(Number(values.every) * 1000);
  }
}

/** Whether `status` shows a run without `--all`, whose log last changed `age` ago. */
export const onStatus = (run: Run, open: boolean, age: number): boolean =>
  open || (!unlaunchedSeed(run) && age <= RECENT_MS);

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
    if (!values.all && !onStatus(run, open, age)) {
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
