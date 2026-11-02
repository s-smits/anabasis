/**
 * The runs pulse: v1's `bun run runs pulse`, on v2's log. One look reads the run logs of the
 * repository's worktrees (`registry.ts`) and says one status line for each and what happened since
 * the last look: `◆` a milestone, `⚠` something to look at, `·` the rest. Each log is the run's
 * whole record, so the pulse keeps only how far it read and what it last said, in `--state`.
 *
 *   bun run runs pulse [<part of a name> ...] [--once] [--every 290] [--state .ana/runs-pulse.json]
 *   bun run runs status [--all]
 *
 * With no names a look covers the open runs and those open at the last look, so a run's ending is
 * said once; an observer's first look of a run also covers one stopped in the last day without an
 * ending (until 29 October every look did, and an hourly look repeated each stopped run's "process
 * gone" and its stderr for a day). A name matches every run whose name holds it. Quiet, no event for 20 minutes in an
 * open run, counted from a named reset it waits out where that is later, is said when it starts and
 * when it ends. Since 22 October each look also polls every configured host once, with a cursor for
 * this observer, unless --here is named. A missing peer is a warning and exit 1. No local state path is sent to another machine.
 */
import { comparisonFloor } from "#src/campaign/admission.ts";
import { readsStepEitherWay, scoresIn, testOf } from "#src/kernel/compare.ts";
import type { EventKind, LogEvent } from "#src/kernel/log.ts";
import { degradations, traceKind, tracesIn } from "#src/kernel/trace.ts";
import { billedAll } from "#src/kernel/meter.ts";
import { solvesIn } from "#src/kernel/solves.ts";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statfsSync,
  statSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { availableParallelism, loadavg } from "#src/meta/os.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { capturedExecPath, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { sha256 } from "#src/meta/digest.ts";
import { mainTree } from "#src/meta/git.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import { asked, hosts } from "./hosts.ts";
import { hostsOf } from "./host-config.ts";
import { lastLaunch } from "./receipt.ts";
import { runReason } from "./diagnosis.ts";
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

/** One of the investigation's triggers of a log, as `wri.ts read` prints it. */
interface Alarm {
  readonly name: string;
  readonly lane: number;
  readonly detail: string;
}

/** What the last look saw of one log. */
interface Seen {
  readonly lines: number;
  readonly open: boolean;
  readonly quiet: boolean;
  /** Each watched investigation trigger's detail at the last look that read them. */
  readonly triggers?: Readonly<Record<string, string>>;
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

/** The state file: the free disk at the last look, and what it saw of each log by its path. */
interface Memory {
  readonly freeGiB: number | null;
  readonly logs: Record<string, Seen>;
}

const QUIET_MS = 20 * 60_000;
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
 * An alarm is read again at every look where the log gained an event that can move one
 * (`MOVES_A_TRIGGER`) and said where it fired or its key moved (`keyOf`); a reading moves with each
 * solve, so it is said only after a milestone. On 1 November an unconfirmed promotion and two
 * unbilled compactions in a live buffer campaign were found only by running `wri.ts read` on it by
 * hand. A trigger the pulse reads itself is left out (a model served, an unfinished session), and so
 * is one every promotion fires until its starter comparison reports.
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
  ["BROKEN AT END", ["climb", "alarm"]],
  ["STEP CARRIERS", ["climb", "reading"]],
  ["CHAIN", ["climb", "reading"]],
  ["MOVES ASKED", ["honesty", "reading"]],
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
  ["UNBILLED COMPACTIONS", ["economy", "alarm"]],
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
/**
 * The events that can move a watched trigger, so a look reads the investigation only after one.
 * Over 57 recorded logs, 27% of the looks where a log grew held one; the investigation takes about
 * 3 s to read a log of 46,000 events, and until 1 November read one at every such look. Replayed on those logs, 2 of
 * 358 alarms were said later than before, the later by 29 minutes: a host's code that moved is said
 * at the next of these events.
 */
const MOVES_A_TRIGGER: ReadonlySet<string> = new Set([
  ...MILESTONES,
  "referee.finding",
  "referee.refused",
  "task.gate",
  "checker.read",
  "contract.frozen",
  "comparison.started",
  "campaign.word",
  "build.checkpoint",
  "harness.version",
]);
/** The comparisons and sessions a trigger's detail names (`g-2`, `b-3`, `x-1`), not a task (`x-1-3`). */
const NAMED = /\b[bgx]-\d+(?![-\d])/g;
/** One of the investigation's triggers as its command prints it: `NAME (lane N): detail`. */
const TRIGGER_LINE = /^([A-Z][A-Z0-9 -]*[A-Z0-9]) \(lane (\d+)\): (.*)$/;
/** A load wait a person moves a run for (`AGENTS.md`, section 10, condition 4). */
const LOAD_WAIT_MS = 15 * 60_000;

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
  const bar = asRecord(worth?.bars)?.cost;
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
    isNumber(attempts) ? `attempt ${String(attempts)} of ${word(bar)} this epoch` : "",
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
 * The investigation's triggers of `run`'s log, from its own command, as `tools/runs/replay.ts`
 * leaves it: production imports no helper (`AGENTS.md`, section 12), and until a review of
 * 1 November the pulse imported the investigation's folds. A read that fails throws, and the look
 * says so.
 */
function investigated(run: Run): Alarm[] {
  const tree = resolve(import.meta.dir, "..", "..");
  const read = runSync([capturedExecPath, join(tree, "tools", "wri", "wri.ts"), "read", "--log", run.path], {
    cwd: tree,
    timeout: 120_000,
  });
  if (read.exitCode !== 0) throw new Error(decodeOutput(read.stderr).trim().split("\n").at(-1));
  return decodeOutput(read.stdout)
    .split("\n")
    .flatMap((line) => {
      const [, name = "", lane = "", detail = ""] = TRIGGER_LINE.exec(line) ?? [];
      return name === "" ? [] : [{ name, lane: Number(lane), detail }];
    });
}

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

/** The watched triggers of `log` as they read now, and a line for each detail whose key (`keyOf`)
 *  is new since `before`; the first look of a run only remembers them. A trigger fires once for each
 *  comparison or session it names, so each name keeps every key: until a fix of 1 November it kept
 *  one, and gate-free-r2's two comparisons with a task set aside said the first again at every look. */
function triggersSaid(fresh: readonly LogEvent[], before: Seen | undefined, alarms: () => readonly Alarm[]) {
  const kept = before?.triggers ?? {};
  const moves = fresh.some(({ kind }) => MOVES_A_TRIGGER.has(kind) || kind.endsWith(".compacted"));
  if (before !== undefined && !moves) return { now: kept, said: [] };
  const milestone = fresh.some(({ kind }) => MILESTONES.has(kind));
  const read = new Map<string, { lane: number; details: string[] }>();
  let found: readonly Alarm[];
  try {
    found = alarms();
  } catch (error) {
    return { now: kept, said: [`⚠ the investigation could not read the log: ${short(String(error))}`] };
  }
  for (const { name, lane, detail } of found) {
    const watched = WATCHED.get(name);
    if (watched === undefined || (watched[1] === "reading" && !milestone && before !== undefined)) continue;
    read.set(name, { lane, details: [...(read.get(name)?.details ?? []), detail] });
  }
  const said = [...read].flatMap(([name, { lane, details }]) => {
    const [factor, kind] = WATCHED.get(name) ?? ["", "alarm"];
    const known = new Set((kept[name] ?? "").split("\n"));
    return before === undefined
      ? []
      : details
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
  const kept = lastLaunch(run.path);
  const launched =
    kept === undefined ? 0 : log.findIndex((event) => Date.parse(event.at) >= Date.parse(kept.at));
  const begun = launched === -1 ? log.length : launched;
  const opened = log.findLastIndex(({ kind }) => STARTS.has(kind));
  const solved = log.findLastIndex(({ kind }) => kind === "solve.started");
  const start = Math.max(0, opened);
  const work = log.slice(Math.max(start, solved));
  // A campaign the Builder leads ends only in its ending: until 1 November one whose process died
  // after an Examiner session or a report was taken as done, 4 of the 42 closes on record.
  const led = log.some(({ kind }) => kind === "campaign.opened");
  const end: EventKind = led ? ENDED : log[start]?.kind === "exam.started" ? "exam.finished" : run.end;
  const running = solves.filter(({ finished, started }) => finished === null && started >= begun).length;
  const until = log
    .slice(begun)
    .findLast(({ kind, data }) => kind === "campaign.waited" && isString(data.until))?.data.until;
  const last = log.at(-1);
  const since = Math.max(Date.parse(last?.at ?? ""), isString(until) ? Date.parse(until) : 0);
  const ended = last?.kind === ENDED || (running === 0 && count(work, end) > 0);
  return { solves, start, work, end, running, since, ended };
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
 *  first look says only the status and a quiet already under way. */
export function pulse(
  run: Run,
  log: readonly LogEvent[],
  process: "open" | "closed",
  before: Seen | undefined,
  { now, alarms }: { readonly now: number; readonly alarms: () => readonly Alarm[] },
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
  const quiet = open && log.length > 0 && now - stand.since > QUIET_MS;
  if (quiet && before?.quiet !== true) lines.push(`⚠ quiet for ${minutes(now - stand.since)}`);
  if (!quiet && before?.quiet === true) lines.push("· not quiet any more");
  if (before?.open === true && !open && !stand.ended) lines.push(`⚠ the process is gone before ${stand.end}`);
  const triggers = triggersSaid(fresh, before, alarms);
  lines.push(...triggers.said);
  // A comparison starts each task under two harnesses, so a line may come twice.
  const said = Object.entries(countBy(lines, (line) => line)).map(([line, n]) =>
    n === 1 ? line : `${line} (×${String(n)})`,
  );
  return {
    status: status(run, log, stand, open, now),
    said,
    seen: { lines: log.length, open, quiet, triggers: triggers.now },
  };
}

/**
 * One look over the chosen runs, remembered in `state`: the lines it says, none where nothing moved.
 * A run's row is said on its first look and with something new, and the host's line above any row.
 * Until 1 November every look said every row and each closed run's reason again, so a watch of
 * three hosts printed some twenty lines every five minutes with nothing in them a reader had not seen.
 */
async function look(state: string, names: readonly string[]): Promise<string[]> {
  const memory: Memory = existsSync(state)
    ? parseJsonAs<Memory>(readFileSync(state, "utf8"))
    : { freeGiB: null, logs: {} };
  const running = processes();
  const now = Date.now();
  const all = runs().map((run) => ({
    run,
    open: writers(run, running).length > 0,
    before: memory.logs[run.path],
  }));
  // Only a log the look reports is read: until 2 November every look parsed every run's whole log,
  // closed ones included, which was 0.55 s of a 2.5 s look on the Linux runner.
  const chosen = all
    .filter(({ run, open, before }) =>
      names.length > 0
        ? names.some((name) => run.name.includes(name))
        : open ||
          before?.open === true ||
          (before === undefined &&
            run.seed !== true &&
            Date.now() - statSync(run.path).mtimeMs < RECENT_MS &&
            logEvents(run.path).at(-1)?.kind !== ENDED),
    )
    .map((each) => ({ ...each, events: logEvents(each.run.path) }));
  const disk = statfsSync(".");
  const free = Math.round((disk.bavail * disk.bsize) / GIB);
  const gained = memory.freeGiB === null ? 0 : free - memory.freeGiB;
  const since =
    memory.freeGiB === null ? "" : ` (${gained >= 0 ? "+" : ""}${String(gained)} since the last look)`;
  const head = `${new Date(now).toISOString().slice(11, 16)}Z ${String(all.filter(({ open }) => open).length)} open · load ${(loadavg()[0] ?? 0).toFixed(1)} of ${String(availableParallelism())} cores · ${String(free)} GiB free${since}`;
  // A run this look left out keeps what the last look saw of it.
  const logs: Record<string, Seen> = { ...memory.logs };
  const said: string[] = [];
  for (const { run, open, before, events } of chosen) {
    const seen = pulse(run, events, open ? "open" : "closed", before, {
      now,
      alarms: () => investigated(run),
    });
    if (before === undefined || seen.said.length > 0) {
      const reasons = await runReason(run, events, open ? "open" : "closed");
      said.push(seen.status, ...[...seen.said, ...reasons].map((line) => `  ${line}`));
    }
    logs[run.path] = seen.seen;
  }
  // A checkout no campaign ran in has no `.ana/`, as the Linux runner's had none on 20 October.
  mkdirSync(dirname(state), { recursive: true });
  writeFileSync(`${state}.tmp`, capturedJsonStringify({ freeGiB: free, logs } satisfies Memory));
  renameSync(`${state}.tmp`, state);
  return said.length === 0 ? [] : [head, ...said];
}

/** `bun run runs pulse`. */
export async function watch(args: readonly string[]): Promise<void> {
  const { values, positionals: names } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      once: { type: "boolean", default: false },
      every: { type: "string", default: "290" },
      state: { type: "string", default: join(".ana", "runs-pulse.json") },
      here: { type: "boolean", default: false },
    },
  });
  for (;;) {
    // Each observer has its own cursor on each host. A local --state is never a remote path.
    const cursor = sha256(`${runtimeProcess.cwd()}\n${values.state}`).slice(0, 24);
    const away = values.here
      ? []
      : asked(["pulse", ...names, "--once", "--here", "--state", `.ana/pulse/${cursor}.json`]);
    const here = await look(
      values.here ? resolve(mainTree(runtimeProcess.cwd()), values.state) : values.state,
      names,
    );
    if (here.length > 0) {
      console.log([...(values.here || hostsOf().length === 0 ? [] : ["── here"]), ...here].join("\n"));
    }
    for (const { host, lines, elapsedMs } of await away) {
      if (lines === null) {
        console.error(`⚠ ${host.name}: pulse unavailable`);
        runtimeProcess.exitCode = 1;
      } else if (lines.some((line) => line.trim() !== "")) {
        console.log(`── ${host.name} (${(elapsedMs / 1000).toFixed(1)} s)\n${lines.join("\n")}`);
      }
    }
    if (values.once) break;
    await Bun.sleep(Number(values.every) * 1000);
  }
}

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
    // A seed no process writes is a rehearsal's copy, and its promotions are its source's; one a
    // process writes was continued as a run (16 October: fork-ladder-buffer-opus was not shown).
    if (!values.all && !open && (run.seed === true || age > RECENT_MS)) {
      if (run.seed !== true) quiet += 1;
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
  const archive = archived().filter((run) => run.archived === HERE && run.seed !== true);
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
