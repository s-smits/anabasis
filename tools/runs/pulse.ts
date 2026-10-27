/**
 * The runs pulse: v1's `bun run runs pulse`, on v2's log. One look reads the run logs of the
 * repository's worktrees (`registry.ts`) and says one status line for each and what happened since
 * the last look: `◆` a milestone, `⚠` something to look at, `·` the rest. Each log is the run's
 * whole record, so the pulse keeps only how far it read and what it last said, in `--state`.
 *
 *   bun run runs pulse [<part of a name> ...] [--once] [--every 290] [--state .ana/runs-pulse.json]
 *
 * With no names a look covers the open runs and those open at the last look, so a run's ending is
 * said once; a name matches every run whose name holds it. Quiet, no event for 20 minutes in an
 * open run, counted from a named reset it waits out where that is later, is said when it starts and
 * when it ends. Since 22 October each look also polls every configured host once, with a cursor for
 * this observer, unless --here is named. A missing peer is a warning and exit 1. No local state path is sent to another machine.
 */
import { type EventKind, type LogEvent } from "#src/kernel/log.ts";
import { billedAll, traceKind, tracesIn } from "#src/kernel/trace.ts";
import { type Solve, solvesIn } from "#src/kernel/solves.ts";
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
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { availableParallelism, loadavg } from "#src/meta/os.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
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

/** What the last look saw of one log. */
interface Seen {
  readonly lines: number;
  readonly open: boolean;
  readonly quiet: boolean;
}

/** One look at one run: its status line, what it says of the events since the last look, and what
 *  to remember of it. */
interface Look {
  readonly status: string;
  readonly said: readonly string[];
  readonly seen: Seen;
}

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
/** The events that start something a run then has to finish. */
const STARTS: ReadonlySet<string> = new Set(["build.started", "exam.started", "comparison.started"]);

const minutes = (ms: number) => `${String(Math.round(ms / 60_000))}m`;
const dollars = (value: number) => `$${value.toFixed(2)}`;
const short = (value: unknown) => (isString(value) ? value.replace(/\s+/g, " ").slice(0, 160) : "");
const count = (log: readonly LogEvent[], kind: EventKind) =>
  log.filter((event) => event.kind === kind).length;
/** A string or number field as written, and "?" for a field the event does not hold. */
const word = (value: unknown) => (isString(value) || isNumber(value) ? String(value) : "?");

/** How long a session or a solve took, and what it billed, as its `.finished` event says. */
const cost = (data: JsonObject) =>
  `${isNumber(data.seconds) ? ` in ${minutes(data.seconds * 1000)}` : ""}${isNumber(data.billed) ? `, ${dollars(data.billed)}` : ""}`;

/** What a comparison's report earns: one that scored nothing, one its cap cut, or one with tasks set
 *  aside on rejections nobody has settled is one to look at before it is believed
 *  (`src/campaign/round.ts`). */
function reportLine(data: JsonObject): string {
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
 *  kind left unsaid. `task` names a solve's task. */
const SAID: Partial<
  Record<EventKind, (data: JsonObject, task: (solve: JsonValue | undefined) => string) => string | null>
> = {
  "build.started": (data) => `· build ${word(data.session)} started on ${word(data.model)}`,
  "exam.started": (data) => `· exam ${word(data.session)} started on ${word(data.model)}`,
  "build.finished": (data) =>
    `◆ build ended at ${word(data.ended)} and ${data.changed === true ? "changed the harness" : "left the harness as it was"}` +
    `${data.broken === null ? "" : `, broken: ${short(data.broken)}`}${cost(data)}`,
  "exam.finished": (data) => `◆ exam ${word(data.session)} ended${cost(data)}`,
  "harness.version": (data) =>
    `· harness ${word(data.version).slice(0, 8)}${short(data.note) === "" ? "" : `: ${short(data.note)}`}`,
  "solve.started": (data) => `· ${word(data.task)} started on ${word(data.model)}`,
  "solve.finished": (data, task) => {
    const ending = asRecord(data.ending);
    if (ending?.outcome === "pass") return `◆ ${task(data.solve)} passed${cost(data)}`;
    if (ending?.outcome === "fail") return `· ${task(data.solve)} failed${cost(data)}`;
    // A flag is its side's own fail (AGENTS.md rule 7): until 23 October it read as a non-result of kind "?".
    if (ending?.outcome === "flagged") {
      return `· ${task(data.solve)} flagged as malformed: ${short(ending.reason)}${cost(data)}`;
    }
    return `⚠ ${task(data.solve)} ended without a result, ${word(ending?.kind)}: ${short(ending?.reason)}${cost(data)}`;
  },
  // A campaign's ending, and a wait for the provider or the network: until 15 October the pulse
  // said neither, and a run waiting out a limit read as quiet. A wait on the load is one a solve.
  "campaign.ended": (data) => `◆ the campaign ended ${word(data.ending)}: ${short(data.why)}`,
  // Until 27 October a promotion had no line, and an hourly watch over the pulse missed one by 4.5 h.
  "harness.promoted": (data) => `◆ promoted ${word(data.harness).slice(0, 8)} to the reference`,
  "campaign.waited": (data) =>
    isString(data.for)
      ? `⚠ waited ${isNumber(data.ms) ? minutes(data.ms) : "?"} for the ${data.for}${isString(data.until) ? ` until ${data.until}` : ""}`
      : null,
  "referee.finding": (data) => `· the Referee on ${word(data.task)}: ${short(data.reason)}`,
  [REPORTED]: reportLine,
};

/** Where the last thing a log started begins: a Builder session, an Examiner session or a
 *  comparison. A campaign's log holds many, and a run stands where its last one does. */
const lastStart = (log: readonly LogEvent[]) => log.findLastIndex(({ kind }) => STARTS.has(kind));

/** Where the last work of a log begins: the last thing it started, or its last solve where that is
 *  later. A comparison gone on from its log writes no second start, so the solves it makes after
 *  another comparison's report are what says it has not reported. */
const lastWork = (log: readonly LogEvent[]) =>
  Math.max(
    lastStart(log),
    log.findLastIndex(({ kind }) => kind === "solve.started"),
  );

/** Where a run stands: reported, closed, inside a Builder or Examiner session, or solving. A report
 *  counts when it follows the last work: a checkpoint solving after an earlier comparison's report
 *  has not reported. */
function stage(log: readonly LogEvent[], running: number, open: boolean): string {
  const from = Math.max(lastStart(log), 0);
  const report = log.slice(Math.max(lastWork(log), 0)).findLast(({ kind }) => kind === REPORTED);
  // Closed is said first: until 20 October a run whose process died after a report read as that
  // report for hours, with its unfinished solves called running.
  if (report !== undefined) return `${open ? "" : "closed, "}reported ${word(report.data.reading)}`;
  if (!open) return "closed";
  const since = log.slice(from);
  const session = (["build", "exam"] as const).find(
    (role) => log[from]?.kind === `${role}.started` && count(since, `${role}.finished`) === 0,
  );
  if (session !== undefined) return `${session} turn ${String(count(since, traceKind(session, "turn")))}`;
  return running > 0 ? "solving" : "working";
}

/** The status line of `run`, whose log is `log` and whose solves are `solves`. */
function status(run: Run, log: readonly LogEvent[], solves: readonly Solve[], open: boolean, now: number) {
  const said = ["pass", "fail", "flagged", "non-result"].flatMap((outcome) => {
    const n = solves.filter(({ ending }) => ending?.outcome === outcome).length;
    return n === 0 ? [] : [`${String(n)} ${outcome}`];
  });
  const running = solves.filter(({ finished }) => finished === null).length;
  if (running > 0) said.push(`${String(running)} ${open ? "running" : "unfinished"}`);
  const last = log.at(-1);
  const promoted = count(log, "harness.promoted");
  if (promoted > 0) said.push(`${String(promoted)} promoted`);
  return [
    // A seed's counts and dollars are its source's up to the cut, and a script's or a run's after it.
    `${run.name}${run.seed === true ? " (a seed)" : ""}  ${stage(log, running, open)}`,
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
  now: number,
): Look {
  const open = process === "open";
  const solves = solvesIn(log);
  const tasks = new Map(solves.map(({ id, start }) => [id, word(start.task)]));
  const task = (solve: JsonValue | undefined) => tasks.get(word(solve)) ?? word(solve);
  const fresh = log.slice(before?.lines ?? log.length);
  const lines = fresh.flatMap(({ kind, data }) => SAID[kind]?.(data, task) ?? []);
  const errors = tracesIn(fresh).flatMap((each) =>
    each.part === "turn" && each.error !== null ? [each.error] : [],
  );
  if (errors.length > 0) {
    lines.push(`⚠ ${plural(errors.length, "failed turn")}: ${[...new Set(errors)].map(short).join("; ")}`);
  }
  const last = log.at(-1);
  // A run waiting out a named reset is silent by design, so its quiet is counted from the reset:
  // until 23 October such a run was called quiet, and until 25 October it was again for the minute
  // between the reset and its next event, or while other seats wrote after the wait.
  const waited = ({ kind, data }: LogEvent) => kind === "campaign.waited" && isString(data.until);
  const until = log.findLast(waited)?.data.until;
  const since = Math.max(Date.parse(last?.at ?? ""), isString(until) ? Date.parse(until) : 0);
  const quiet = open && last !== undefined && now - since > QUIET_MS;
  if (quiet && before?.quiet !== true) lines.push(`⚠ quiet for ${minutes(now - since)}`);
  if (!quiet && before?.quiet === true) lines.push("· not quiet any more");
  // A run's end is that of the last thing it started: an Examiner session writes no report, and
  // the second on exam-1 (2026-10-08) ended whole and was said to be gone before one. A checkpoint
  // starts no session, so its own start is where its report is looked for. A campaign that wrote
  // its ending is done whatever it was doing: until 27 October one that ended while drafting its
  // exam, which none of these starts covers, was said to be gone before a report.
  const end = log[lastStart(log)]?.kind === "exam.started" ? "exam.finished" : run.end;
  const ended =
    last?.kind === "campaign.ended" ||
    (count(log.slice(Math.max(lastWork(log), 0)), end) > 0 &&
      solves.every(({ finished }) => finished !== null));
  if (before?.open === true && !open && !ended) lines.push(`⚠ the process is gone before ${end}`);
  // A comparison starts each task under two harnesses, so a line may come twice.
  const said = Object.entries(countBy(lines, (line) => line)).map(([line, n]) =>
    n === 1 ? line : `${line} (×${String(n)})`,
  );
  return { status: status(run, log, solves, open, now), said, seen: { lines: log.length, open, quiet } };
}

/** One look over the chosen runs, said to the console and remembered in `state`. */
async function look(state: string, names: readonly string[]): Promise<void> {
  const memory: Memory = existsSync(state)
    ? parseJsonAs<Memory>(readFileSync(state, "utf8"))
    : { freeGiB: null, logs: {} };
  const running = processes();
  const now = Date.now();
  const all = runs().map((run) => ({
    run,
    open: writers(run, running).length > 0,
    before: memory.logs[run.path],
    events: logEvents(run.path),
  }));
  const chosen = all.filter(({ run, open, before, events }) =>
    names.length > 0
      ? names.some((name) => run.name.includes(name))
      : open ||
        before?.open === true ||
        (run.seed !== true &&
          Date.now() - statSync(run.path).mtimeMs < RECENT_MS &&
          events.at(-1)?.kind !== "campaign.ended"),
  );
  const disk = statfsSync(".");
  const free = Math.round((disk.bavail * disk.bsize) / GIB);
  const gained = memory.freeGiB === null ? 0 : free - memory.freeGiB;
  const since =
    memory.freeGiB === null ? "" : ` (${gained >= 0 ? "+" : ""}${String(gained)} since the last look)`;
  console.log(
    `${new Date(now).toISOString().slice(11, 16)}Z ${String(all.filter(({ open }) => open).length)} open · load ${(loadavg()[0] ?? 0).toFixed(1)} of ${String(availableParallelism())} cores · ${String(free)} GiB free${since}`,
  );
  // A run this look left out keeps what the last look saw of it.
  const logs: Record<string, Seen> = { ...memory.logs };
  for (const { run, open, before, events } of chosen) {
    const seen = pulse(run, events, open ? "open" : "closed", before, now);
    console.log(seen.status);
    for (const line of seen.said) console.log(`  ${line}`);
    for (const line of await runReason(run, events, open ? "open" : "closed")) console.log(`  ${line}`);
    logs[run.path] = seen.seen;
  }
  // A checkout no campaign ran in has no `.ana/`, as the Linux runner's had none on 20 October.
  mkdirSync(dirname(state), { recursive: true });
  writeFileSync(`${state}.tmp`, capturedJsonStringify({ freeGiB: free, logs } satisfies Memory));
  renameSync(`${state}.tmp`, state);
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
    if (!values.here && hostsOf().length > 0) console.log("── here");
    await look(values.here ? resolve(mainTree(runtimeProcess.cwd()), values.state) : values.state, names);
    for (const { host, lines, elapsedMs } of await away) {
      console.log(`── ${host.name} (${(elapsedMs / 1000).toFixed(1)} s)`);
      if (lines === null) {
        console.error(`⚠ ${host.name}: pulse unavailable`);
        runtimeProcess.exitCode = 1;
      } else {
        console.log(lines.join("\n"));
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
    const ended = log.at(-1)?.kind === "campaign.ended" ? `ended ${word(log.at(-1)?.data.ending)}` : "";
    const comparing = openComparisons(log);
    const [steps, reads] = [count(log, "harness.promoted"), count(log, REPORTED)];
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
      `${status(run, log, solvesIn(log), open, now)}\n  ${where.filter((part) => part !== "").join(" · ")}`,
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
      promoted: count(logEvents(run.path), "harness.promoted"),
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
