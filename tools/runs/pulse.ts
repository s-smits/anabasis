/**
 * Campaign status and incremental event pulse (`bun run runs pulse` and `bun run runs status`):
 *
 *   bun run runs pulse [<part of a name> ...] [--every 290] [--state .ana/runs-pulse.json]
 *     [--here] [--no-readers] [--ack <token>]
 *   bun run runs status [--all]
 *
 * Polls local and remote (`ANA_HOSTS`, unless `--here`) campaign logs, printing a status line and
 * new milestones (`◆`), warnings (`⚠`), routine events (`·`), 20-minute quiet intervals, and
 * deterministic moment-reader findings (`tools/wri/derive.ts`, `pulse-readers.ts`, unless
 * `--no-readers`). Persists cursor state in `--state` only after printing, using `<state>.pending`
 * and `--ack <token>` over SSH so interrupted polls never drop events.
 */
import { type EventKind, type LogEvent, read as readEvents } from "#src/kernel/log.ts";
import { endingOf } from "#src/kernel/reports.ts";
import { degradations, traceKind } from "#src/kernel/trace.ts";
import { billedAll } from "#src/kernel/meter.ts";
import { solvesIn } from "#src/kernel/solves.ts";
import { DAY_MS, HOUR_MS } from "#src/meta/clock.ts";
import { existsSync, readFileSync, rmSync, statfsSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { availableParallelism, loadavg } from "#src/meta/os.ts";
import { basename, join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { sha256 } from "#src/meta/digest.ts";
import { mainTree } from "#src/meta/git.ts";
import { plural } from "#src/meta/text.ts";
import { firstComparisonDelay } from "./view.ts";
import { type Life, lifeOf } from "./diagnosis.ts";
import { asked, hosts } from "./hosts.ts";
import { hostsOf } from "./host-config.ts";
import { lastLaunch, unlaunchedSeed } from "./receipt.ts";
import {
  climbAt,
  dollars,
  DRIVER,
  ENDED,
  EVENT_FORMATTERS,
  minutes,
  openingCommand,
  progressOf,
  PROMOTED,
  promotionsOf,
  REPORTED,
  short,
  TRIGGER_AT,
  triggerOf,
  word,
} from "./said.ts";
import { launchedIn, runReason, type RunState, stateOf } from "./state.ts";
import {
  alarmsMoved,
  formatReaderLines,
  type Moment,
  PER_LOOK,
  pruneObservers,
  remember,
  startPass,
  storeOf,
  withinDeadline,
} from "./pulse-readers.ts";
import {
  ARCHIVE,
  archived,
  fileStat,
  HERE,
  isCampaign,
  logEvents,
  Misused,
  openComparisons,
  processes,
  readLog,
  type Run,
  runs,
  writers,
} from "./registry.ts";

interface Seen {
  readonly lines: number;
  readonly open: boolean;
  readonly quiet: boolean;
  readonly heldOff?: boolean;
  readonly triggers?: Readonly<Record<string, string>>;
  readonly rowsAt?: number;
  readonly moments?: readonly Moment[];
  readonly said?: readonly string[];
  /** The last due trigger key, so each promotion checkpoint surfaces once without re-firing on
   *  clock ticks. */
  readonly due?: boolean | string;
  readonly state?: string;
}

type Alarm = NonNullable<ReturnType<typeof alarmsMoved>>["alarms"][number];

interface Look {
  readonly state: RunState;
  readonly status: string;
  readonly said: readonly string[];
  readonly seen: Seen;
}

type Standing = ReturnType<typeof standing>;

type Under = ReadonlyMap<number, readonly string[]>;

interface Memory {
  readonly freeGiB: number | null;
  readonly logs: Record<string, Seen>;
  readonly acks?: Readonly<Record<string, string>>;
  readonly down?: readonly string[];
}

interface Chosen {
  readonly run: Run;
  readonly life: Life;
  readonly before: Seen | undefined;
  readonly events: readonly LogEvent[];
  readonly size: number;
}

const RECENT_MS = DAY_MS;
const NEWEST = 3;
const GIB = 2 ** 30;
const BEGAN = "comparison.started";
const STARTS: ReadonlySet<string> = new Set(["build.started", "exam.started", BEGAN]);

const WATCHED = new Map<string, readonly [string, "alarm" | "reading"]>([
  ["SUPPLY THIN", ["supply", "alarm"]],
  ["NOTHING SCORED", ["supply", "alarm"]],
  ["SET SHORT", ["supply", "alarm"]],
  ["NO TASK HELD OUT", ["supply", "alarm"]],
  ["NO VALID ANSWER", ["supply", "alarm"]],
  ["AWAITING A LABEL", ["supply", "alarm"]],
  ["GATE REFUSED", ["supply", "reading"]],
  ["OUTCOMES BY SESSION", ["supply", "reading"]],
  ["EXAMINER ZERO YIELD", ["supply", "alarm"]],
  ["FAMILY CONCENTRATION", ["supply", "reading"]],
  ["EXAMINER NEVER FINISHED", ["supply", "alarm"]],
  ["CHAIN AGAINST THE STARTER", ["climb", "reading"]],
  ["MARGINS INSIDE THE NOISE", ["honesty", "reading"]],
  ["BROKEN AT END", ["climb", "alarm"]],
  ["STEP CARRIERS", ["climb", "reading"]],
  ["CHAIN", ["climb", "reading"]],
  ["PRACTICE CONCENTRATION", ["climb", "reading"]],
  ["INTERRUPTED HANDOVER", ["climb", "alarm"]],
  ["UNDERPOWERED NO-STEPS", ["climb", "alarm"]],
  ["SCORED SET MOVED", ["honesty", "alarm"]],
  ["HOST CODE MOVED", ["honesty", "alarm"]],
  ["VERIFIER TOOLS MOVED", ["honesty", "alarm"]],
  ["PRACTISED TASK MEASURED", ["honesty", "alarm"]],
  ["SCORED AFTER RELEASE", ["honesty", "alarm"]],
  ["PRE-PROMOTION PRACTICE RELEASED", ["honesty", "alarm"]],
  ["SHARED TEMPORARY FOLDER", ["honesty", "alarm"]],
  ["MEASURED AN EARLIER STATE", ["honesty", "alarm"]],
  ["STARTS OUT OF TURN", ["honesty", "alarm"]],
  ["LOG OUT OF ORDER", ["honesty", "alarm"]],
  ["ENDED AND WENT ON", ["honesty", "alarm"]],
  ["SAFEGUARD-9 PROMOTION BEYOND VALIDITY", ["honesty", "reading"]],
  ["NO DELIVERABLES CAPTURED", ["verdicts", "alarm"]],
  ["PASSES LABELLED", ["verdicts", "reading"]],
  ["CHECK DEFECT RULED", ["verdicts", "alarm"]],
  ["RULED UNCLEAR", ["verdicts", "alarm"]],
  ["RULINGS REFUSED", ["verdicts", "alarm"]],
  ["EARNED WITHOUT A PROBE", ["verdicts", "alarm"]],
  ["REVIEW FAULTS", ["verdicts", "alarm"]],
  ["SET ASIDE AND UNSETTLED", ["verdicts", "alarm"]],
  ["REPLAY MOVED THE VERDICT", ["verdicts", "alarm"]],
  ["SESSION CRASHED", ["economy", "alarm"]],
  ["EXAMINER COMPACTED", ["economy", "reading"]],
  ["SOLVER COMPACTED", ["economy", "reading"]],
  ["HIGH TOOL ERROR RATE", ["economy", "alarm"]],
  ["BILLING RESIDUAL", ["economy", "alarm"]],
  ["LONG SILENCES", ["economy", "reading"]],
]);
const ONCE_TRIGGERS: ReadonlySet<string> = new Set([
  "SUPPLY THIN",
  "FAMILY CONCENTRATION",
  "BILLING RESIDUAL",
]);
/** The triggers a look says in the line of the event that fires them (`said.ts`). */
const OWN = ["PROMOTION UNCONFIRMED", "CHECKER READ WITH FAULTS", "FROZEN DESPITE FAULTS"];
const NAMED = /\b[bgx]-\d+(?![-\d])/g;
const LOAD_WAIT_MS = 15 * 60_000;
/** The hook kills a look at 40 s, and a peer has `HOST_MS` (30 s) once its controller is ready. */
const PEERS_MS = 33_000;
const ACK_LINE = /^ack ([0-9a-f]+)$/;

const count = (log: readonly LogEvent[], kind: EventKind) =>
  log.filter((event) => event.kind === kind).length;

function keyOf(name: string, detail: string): string {
  if (ONCE_TRIGGERS.has(name)) return "once";
  const ids = detail.match(NAMED);
  return ids === null ? (/\d+/.exec(detail)?.[0] ?? detail) : [...new Set(ids)].join(",");
}

function formatTriggeredAlarms(
  kept: Seen["triggers"],
  found: readonly Alarm[] | null,
): { now: Seen["triggers"]; lines: string[] } {
  if (found === null) return { now: kept, lines: [] };
  const first = kept === undefined;
  const read = new Map<string, { lane: number; details: string[] }>();
  for (const { name, lane, detail } of found) {
    if (!WATCHED.has(name)) continue;
    read.set(name, { lane, details: [...(read.get(name)?.details ?? []), detail] });
  }
  const lines = first
    ? []
    : [...read].flatMap(([name, { lane, details }]) => {
        const [factor, kind] = WATCHED.get(name) ?? ["", "alarm"];
        const prior = kept[name];
        const known = new Set(prior === undefined ? [] : prior.split("\n"));
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
  return { now, lines };
}

function standing(run: Run, log: readonly LogEvent[]) {
  const solves = solvesIn(log);
  const begun = launchedIn(run, log);
  const opened = log.findLastIndex(({ kind }) => STARTS.has(kind));
  const solved = log.findLastIndex(({ kind }) => kind === "solve.started");
  const start = Math.max(0, opened);
  const work = log.slice(Math.max(start, solved));
  const led = log.some(({ kind }) => kind === "campaign.opened");
  const end: EventKind = led ? ENDED : log[start]?.kind === "exam.started" ? "exam.finished" : run.end;
  const running = solves.filter(({ finished, started }) => finished === null && started >= begun).length;
  const ended = log.at(-1)?.kind === ENDED || (running === 0 && count(work, end) > 0);
  return { solves, start, work, end, running, begun, ended };
}

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
    `${run.name}${run.seed === true ? " (a seed)" : ""}  ${stage(log, stand, open)}`,
    `solves ${said.join(", ") || "none"}`,
    dollars(billedAll(log)),
    last === undefined ? "no events" : `${minutes(now - Date.parse(last.at))} since the last event`,
  ].join(" · ");
}

function formatEventLines(name: string, log: readonly LogEvent[], from: number, under: Under | undefined) {
  const climb = climbAt(name, log, from);
  return log.slice(from).map(({ kind, data }, nth) => {
    const climbed = climb.get(from + nth) ?? [];
    const promoted = kind === PROMOTED;
    return {
      line: promoted ? (climbed[0] ?? null) : (EVENT_FORMATTERS[kind]?.(data) ?? null),
      below: [...(promoted ? climbed.slice(1) : climbed), ...(under?.get(nth) ?? [])],
    };
  });
}

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
  const errors = fresh.flatMap((e) =>
    e.kind.endsWith(".turn") && isString(e.data.error) ? [e.data.error] : [],
  );
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

function folded(events: ReturnType<typeof formatEventLines>, lines: readonly string[]): string[] {
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

function formatStateChanges(
  before: Seen | undefined,
  state: RunState,
  stand: Standing,
  open: boolean,
  now: number,
): string[] {
  const lines: string[] = [];
  if (state.kind === "quiet" && before?.quiet !== true) {
    lines.push(`⚠ quiet for ${minutes(now - state.since)}`);
  }
  if (state.kind !== "quiet" && before?.quiet === true) lines.push("· not quiet any more");
  if (before?.open === true && !open && !stand.ended) {
    lines.push(
      state.kind === "stopped" && state.pause !== undefined
        ? `· stopped by a pause left at ${state.pause.at} (${state.pause.why}) before ${stand.end}`
        : `⚠ the process is gone before ${stand.end}`,
    );
  }
  return lines;
}

export function pulse(
  run: Run,
  log: readonly LogEvent[],
  life: Life,
  before: Seen | undefined,
  {
    now,
    alarms = null,
    under,
  }: { readonly now: number; readonly alarms?: readonly Alarm[] | null; readonly under?: Under },
): Look {
  const stand = standing(run, log);
  const state = stateOf(log, life, now, stand.begun);
  const open = life.writing;
  const from = before?.lines ?? log.length;
  const events = formatEventLines(run.name, log, from, under);
  const lines = [...troubles(log, from), ...formatStateChanges(before, state, stand, open, now)];
  const triggers = formatTriggeredAlarms(before?.triggers, alarms);
  lines.push(...triggers.lines);
  const read = isCampaign(run) && run.seed !== true;
  const live = open || life.kept;
  const progress = read ? progressOf({ live }, log, now) : null;
  const due = progress === null ? null : triggerOf(progress);
  let dueKey: boolean | string = false;
  if (due !== null && progress !== null) {
    if (progress.promotions > 0) dueKey = due;
    else if (progress.allTied) dueKey = "tied";
    else dueKey = live ? "hours" : "closed";
  }
  if (
    due !== null &&
    progress !== null &&
    before?.due !== undefined &&
    before.due !== dueKey &&
    !(before.due === true && progress.promotions === 0)
  ) {
    // A live run's step has one reader, the driver's `due`, which alone reads the deviation that keeps
    // a run past its trigger.
    const step = live ? `bun ${DRIVER} due` : openingCommand({ name: run.name, live });
    const label =
      live && progress.promotions > 0 && progress.promotions < TRIGGER_AT.ceilingPromotions
        ? "decision point"
        : "investigation due";
    lines.push(`⚠ ${label}, ${due}: ${step}`);
  }
  // Said once where a look finds it long: otherwise a first comparison can stand admissible for hours
  // and no look says it.
  const waits = read && open && before?.heldOff !== true && !log.some(({ kind }) => kind === BEGAN);
  const delay = waits ? firstComparisonDelay(log) : null;
  if (delay?.long === true) {
    lines.push(`⚠ first comparison admissible for ${delay.hours.toFixed(2)} h without starting`);
  }
  return {
    state,
    status: status(run, log, stand, open, now),
    said: [...folded(events, lines), ...events.flatMap(({ line, below }) => (line === null ? below : []))],
    seen: {
      ...before,
      lines: log.length,
      open,
      quiet: state.kind === "quiet",
      state: state.kind,
      ...keyIfDefined("due", read ? dueKey : undefined),
      ...keyIfDefined("heldOff", delay?.long === true ? true : undefined),
      ...keyIfDefined("triggers", triggers.now),
    },
  };
}

function readersOf(
  store: string | null,
  { run, before, events, size }: Chosen,
  files: string,
  spare: number,
): {
  alarms: readonly Alarm[] | null;
  under: Under;
  lines: readonly string[];
  spent: number;
  seen: Partial<Seen>;
} {
  if (store === null) return { alarms: null, under: new Map(), lines: [], spent: 0, seen: {} };
  const moved = alarmsMoved(store, run.path, before?.rowsAt);
  const read = formatReaderLines({
    store,
    log: run.path,
    size,
    fresh: events.slice(before?.lines ?? events.length),
    owed: before?.moments,
    said: before?.said,
    files,
    spare,
    watched: new Set([...WATCHED.keys(), ...OWN]),
  });
  return {
    alarms: moved?.alarms ?? null,
    under: new Map(read.placed.map(({ at, lines }) => [at, lines])),
    lines: read.lines,
    spent: read.lines.length + read.placed.flatMap(({ lines }) => lines).length,
    seen: { ...keyIfDefined("rowsAt", moved?.size ?? before?.rowsAt), moments: read.owed, said: read.said },
  };
}

async function look(
  state: string,
  names: readonly string[],
  memory: Memory,
  { store }: { readonly store: string | null },
): Promise<{ lines: string[]; memory: Memory }> {
  const running = processes();
  const all = runs().map((run) => ({ run, life: lifeOf(run, running), before: memory.logs[run.path] }));
  // Only a log the look reports is read, since parsing every run's whole log costs a fifth of a look.
  const chosen: Chosen[] = all
    .filter(({ run, life, before }) =>
      names.length > 0
        ? names.some((name) => run.name.includes(name))
        : life.writing ||
          life.kept ||
          before?.open === true ||
          (before?.moments?.length ?? 0) > 0 ||
          (before === undefined &&
            !unlaunchedSeed(run) &&
            Date.now() - (fileStat(run.path)?.mtimeMs ?? 0) < RECENT_MS &&
            readEvents(run.path, (k) => k.endsWith(".call") || k === "verdict").at(-1)?.kind !== ENDED),
    )
    .flatMap((each) => {
      const read = readLog(each.run.path);
      return read === null ? [] : [{ ...each, ...read }];
    });
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
  const head = `${new Date(now).toISOString().slice(11, 16)}Z ${String(all.filter(({ life }) => life.writing).length)} open · load ${(loadavg()[0] ?? 0).toFixed(1)} of ${String(availableParallelism())} cores · ${String(free)} GiB free${since}`;
  const logs: Record<string, Seen> = { ...memory.logs };
  const said: string[] = [];
  let spare = PER_LOOK;
  for (const each of chosen) {
    const { run, life, before, events } = each;
    const readers = readersOf(store, each, join(`${state}.d`, run.name), spare);
    const one = pulse(run, events, life, before, { now, alarms: readers.alarms, under: readers.under });
    spare -= readers.spent;
    const reasons = before?.state === one.state.kind ? [] : await runReason(run, one.state);
    const lines = [...one.said, ...readers.lines, ...reasons];
    if (before === undefined || lines.length > 0) said.push(one.status, ...lines.map((line) => `  ${line}`));
    logs[run.path] = { ...one.seen, ...readers.seen };
  }
  return {
    lines: said.length === 0 ? [] : [head, ...said],
    memory: { ...memory, freeGiB: free, logs },
  };
}

function settle(state: string, ack: string): void {
  const pending = `${state}.pending`;
  if (!existsSync(pending)) return;
  try {
    const { token, memory } = parseJsonAs<{ token: string; memory: Memory }>(readFileSync(pending, "utf8"));
    if (token === ack) remember(state, capturedJsonStringify(memory));
  } catch {
    // One a kill cut part way, as an older write in place could leave, is not read.
  }
  rmSync(pending, { force: true });
}

/** A late answer's token is never returned, so its host says those lines again at the next look. A host
 *  going down or coming back is a warning, the one mark the anti-stall hook shows, never a failed look. */
async function pollPeerHosts(
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
      console.log(`⚠ ${name} is offline: no answer in ${elapsed} s, said again once it answers`);
      continue;
    }
    if (down.includes(name)) console.log(`⚠ ${name} is online again`);
    const token = ACK_LINE.exec(lines.at(-1) ?? "")?.[1];
    const said = token === undefined ? lines : lines.slice(0, -1);
    if (token === undefined) delete tokens[name];
    else tokens[name] = token;
    if (said.some((line) => line.trim() !== "")) console.log(`── ${name} (${elapsed} s)\n${said.join("\n")}`);
  }
  return { acks: tokens, down: silent, unanswered };
}

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
  // A wait that is not a number above 0 is none, or the loop would look as fast as it could.
  const every = values.every === undefined ? null : Number(values.every);
  if (every !== null && !(every > 0)) {
    throw new Misused(`--every takes a number of seconds above 0, not ${String(values.every)}`);
  }
  const cwd = runtimeProcess.cwd();
  const readers = !values["no-readers"];
  const store = readers ? storeOf(cwd) : null;
  const state = values.here ? resolve(mainTree(cwd), values.state) : values.state;
  // Each observer has its own cursor on each host; a local `--state` is never a remote path.
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
    const { unanswered, ...peers } = await pollPeerHosts(away, started, memory);
    if (away.length > 0) remember(state, capturedJsonStringify({ ...here.memory, ...peers }));
    // A host still preparing holds this process for up to five minutes and the hook's limit is 40 s, so
    // a look a peer left unanswered ends here.
    if (every === null && unanswered) runtimeProcess.exit(0);
    if (every === null) break;
    await Bun.sleep(every * 1000);
  }
}

export const onStatus = (run: Run, writing: "open" | "closed", age: number): boolean =>
  writing === "open" || (!unlaunchedSeed(run) && age <= RECENT_MS);

export async function runsStatus(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({ args: [...args], options: { all: { type: "boolean", default: false } } });
  const running = processes();
  const now = Date.now();
  const away = hostsOf().length > 0 ? hosts(args) : undefined;
  let [promoted, compared, quiet] = [0, 0, 0];
  for (const run of runs()) {
    const open = writers(run, running).length > 0;
    const at = fileStat(run.path)?.mtimeMs;
    if (at === undefined) continue;
    const age = now - at;
    // A seed no launch went on from is a rehearsal's copy, and its promotions are its source's, shown
    // while a process writes it.
    if (!values.all && !onStatus(run, open ? "open" : "closed", age)) {
      if (!unlaunchedSeed(run)) quiet += 1;
      continue;
    }
    const log = logEvents(run.path);
    const kept = lastLaunch(run.path);
    const ending = endingOf(log);
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
      open || ending === null ? "" : `ended ${ending}`,
      open || age > RECENT_MS ? "" : `off status in ${String(Math.ceil((RECENT_MS - age) / HOUR_MS))}h`,
    ];
    console.log(`${status(run, log, standing(run, log), open, now)}\n  ${where.filter(Boolean).join(" · ")}`);
  }
  console.log(`${plural(promoted, "promotion")} in ${plural(compared, "comparison")} over the runs shown`);
  const archive = archived().filter((run) => run.archived === HERE && !unlaunchedSeed(run));
  const newest = archive
    .map((run) => ({ run, at: fileStat(run.path)?.mtimeMs }))
    .filter((each): each is { run: Run; at: number } => each.at !== undefined)
    .toSorted((one, other) => other.at - one.at)
    .slice(0, NEWEST)
    .map(({ run, at }) => ({
      name: run.name,
      days: (now - at) / DAY_MS,
      promoted: readEvents(run.path, (kind) => kind !== PROMOTED).length,
    }));
  for (const line of leftOut(quiet, archive.length, newest)) console.log(line);
  await away;
}

function leftOut(
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
