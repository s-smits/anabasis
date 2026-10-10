/**
 * The runs pulse: v1's `bun run runs pulse`, on v2's log. One look reads every run log in this
 * repository's worktrees, a round's `.ana/d2/<name>/log.jsonl` and a live solve's
 * `.ana/live/<name>.jsonl`, and says one status line for each and what happened since the last look:
 * `◆` a milestone, `⚠` something to look at, `·` the rest. Each log is the run's whole record, so the
 * pulse keeps only how far it read and what it last said, in `--state`.
 *
 *   bun run runs pulse [<name> ...] [--once] [--every 290] [--state .ana/runs-pulse.json]
 *
 * A run is open while its process is: a `tools/d2/round.ts --name <name>`, or a
 * `tools/m0/live-solve.ts` of the log's task and cycle, started in the log's worktree. With no names,
 * a look covers the open runs and those open at the last look, so a run's ending is said once.
 * Quiet, no event for 20 minutes in an open run, is said when it starts and when it ends.
 */
import { EXAMINE } from "#src/builder/admission.ts";
import { type EventKind, LOG_FILE, type LogEvent } from "#src/kernel/log.ts";
import { type Solve, solvesIn } from "#src/kernel/solves.ts";
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statfsSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { availableParallelism, loadavg } from "#src/meta/os.ts";
import { basename, join } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { decodeOutput, runSync, runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";

/** What the last look saw of one log. */
interface Seen {
  readonly lines: number;
  readonly open: boolean;
  readonly quiet: boolean;
}

/** A run's log, and the event that says the run is done: a round reports, a live solve finishes. */
/** Whether a run's process is still there: open while it writes the log, closed once it is gone. */
type Process = "open" | "closed";

export interface Run {
  readonly name: string;
  readonly tree: string;
  readonly path: string;
  readonly end: "comparison.reported" | "solve.finished";
  /** A copy of another campaign, made to rehearse on (`seed.ts`). */
  readonly seed?: boolean;
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

/** The command a round runs as: what a launch starts and what a running round is known by. */
export const ROUND = "tools/d2/round.ts";
// An Examiner session's command (`EXAMINE`) is with a round's what writes a campaign's log for
// hours, each naming it with `--name`: an Examiner session was read as closed while it ran, the
// first time one did (exam-1, 2026-10-08).
/** The command a comparison with no Builder session runs as. */
export const CHECKPOINT = "tools/d2/checkpoint.ts";
/** The command a Builder session with no comparison after it runs as. */
export const SESSION = "tools/d2/session.ts";
/** The command a whole campaign runs as, which runs each of the above in its own process. */
const BUILDER = "tools/d2/harness-builder.ts";
const CAMPAIGN = [ROUND, EXAMINE, CHECKPOINT, SESSION, BUILDER];
/** This CLI's own command, whose verbs start, read and stop runs; `rehearse` alone writes a log. */
const CLI = "tools/runs/cli.ts";
/** The file beside a log that says its campaign is a seed, and of what. */
export const SEED_FILE = "seed.json";
const LIVE = "tools/m0/live-solve.ts";
const QUIET_MS = 20 * 60_000;
const REPORTED = "comparison.reported";
/** The events that start something a run then has to finish. */
const STARTS: ReadonlySet<string> = new Set(["build.started", "exam.started", "comparison.started"]);
const GIB = 2 ** 30;

const runsAs = (args: readonly string[], tools: readonly string[]) =>
  args.some((arg) => tools.some((tool) => arg.endsWith(tool)));
/** Whether a process writes a campaign's log: a campaign command, a round, an Examiner session, or
 *  a rehearsal (`rehearse.ts`), which is a round on a seed run as a verb of this CLI. A stop
 *  releases what a run that is not being written left mounted, so a writer missed here would lose
 *  its roots.
 *
 *  A campaign command runs every move in its own process, so it is the only process a campaign of
 *  record has. Unlisted, two running campaigns read as closed, `runs stop` answered "none of these
 *  is running" and counted a live session's root as left behind, and both had to be ended by
 *  signalling their process tree by hand (2026-10-10).
 *
 *  A launch is none, and its command line carries the command it launches: on 10 October
 *  `runs launch tools/d2/round.ts --name t-10` into the tree that held t-10's log was refused as
 *  "already being written here" by the one process that matched, the launcher itself, and by two
 *  when run as the package script (`bun run runs launch …`). Both are read as no writer here. */
const campaigns = (args: readonly string[]) => {
  if (runsAs(args, [CLI])) return args.includes("rehearse");
  // The package script `bun run runs <verb> …`, which holds no log open whatever the verb.
  if (args[1] === "run" && args[2] === "runs") return false;
  return runsAs(args, CAMPAIGN);
};

const minutes = (ms: number) => `${String(Math.round(ms / 60_000))}m`;
const dollars = (value: number) => `$${value.toFixed(2)}`;
const short = (value: unknown) => (isString(value) ? value.replace(/\s+/g, " ").slice(0, 160) : "");
const count = (log: readonly LogEvent[], kind: EventKind) =>
  log.filter((event) => event.kind === kind).length;
/** A string or number field as written, and "?" for a field the event does not hold. */
export const word = (value: unknown) => (isString(value) || isNumber(value) ? String(value) : "?");

/** The dollars a turn or a compaction spent, by the usage its event records. */
function spent({ kind, data }: LogEvent): number {
  const usages = kind.endsWith(".turn") ? [data.usage] : kind.endsWith(".compacted") ? data.usages : [];
  let sum = 0;
  for (const usage of Array.isArray(usages) ? usages : []) {
    const total = asRecord(asRecord(usage)?.cost)?.total;
    if (isNumber(total)) sum += total;
  }
  return sum;
}

/** How long a session or a solve took, and what it billed, as its `.finished` event says. */
const cost = (data: JsonObject) =>
  `${isNumber(data.seconds) ? ` in ${minutes(data.seconds * 1000)}` : ""}${isNumber(data.billed) ? `, ${dollars(data.billed)}` : ""}`;

/** The line each event a reader wants earns; a kind not here is a trace. `task` names a solve's task. */
const SAID: Partial<
  Record<EventKind, (data: JsonObject, task: (solve: JsonValue | undefined) => string) => string>
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
    return `⚠ ${task(data.solve)} ended without a result, ${word(ending?.kind)}: ${short(ending?.reason)}${cost(data)}`;
  },
  "referee.finding": (data) => `· the Referee on ${word(data.task)}: ${short(data.reason)}`,
  // A report that scored nothing, one its cap cut, or one with tasks set aside on rejections nobody
  // has settled, is one to look at before it is believed (`src/builder/round.ts`).
  "comparison.reported": (data) => {
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
  },
};

/** Where the last thing a log started begins: a Builder session, an Examiner session or a
 *  comparison. A campaign's log holds many, and a run stands where its last one does. */
function lastStart(log: readonly LogEvent[]): number {
  return log.findLastIndex(({ kind }) => STARTS.has(kind));
}

/** Where the last work of a log begins: the last thing it started, or its last solve where that
 *  is later. A comparison gone on from its log writes no second start, so the solves it makes
 *  after another comparison's report are what says it has not reported. */
function lastWork(log: readonly LogEvent[]): number {
  return Math.max(
    lastStart(log),
    log.findLastIndex(({ kind }) => kind === "solve.started"),
  );
}

/** Where a run stands: reported, closed, inside a Builder or Examiner session, or solving. A
 *  report counts when it follows the last work: a checkpoint solving after an earlier
 *  comparison's report has not reported. */
function stage(log: readonly LogEvent[], running: number, process: Process): string {
  const from = Math.max(lastStart(log), 0);
  const since = log.slice(from);
  const report = log.slice(Math.max(lastWork(log), 0)).findLast(({ kind }) => kind === REPORTED);
  if (report !== undefined) return `reported ${word(report.data.reading)}`;
  if (process === "closed") return "closed";
  // Inside a session when the last thing started is one, and it has not finished.
  const session = (["build", "exam"] as const).find(
    (role) => log[from]?.kind === `${role}.started` && count(since, `${role}.finished`) === 0,
  );
  if (session !== undefined) return `${session} turn ${String(count(since, `${session}.turn`))}`;
  return running > 0 ? "solving" : "working";
}

/** The status line of a run whose log holds `log`, of which `solves` are the solves. */
function status(
  run: Run,
  { log, solves }: { readonly log: readonly LogEvent[]; readonly solves: readonly Solve[] },
  process: Process,
  now: number,
): string {
  const said = ["pass", "fail", "non-result"].flatMap((outcome) => {
    const n = solves.filter(({ ending }) => ending?.outcome === outcome).length;
    return n === 0 ? [] : [`${String(n)} ${outcome}`];
  });
  const running = solves.filter(({ finished }) => finished === null).length;
  if (running > 0) said.push(`${String(running)} running`);
  const total = log.reduce((sum, event) => sum + spent(event), 0);
  const last = log.at(-1);
  const age = last === undefined ? "no events" : `${minutes(now - Date.parse(last.at))} since the last event`;
  return [
    // A seed's counts and dollars are its source's up to the cut, and a script's after it.
    `${run.name}${run.seed === true ? " (a seed)" : ""}  ${stage(log, running, process)}`,
    `solves ${said.join(", ") || "none"}`,
    dollars(total),
    age,
  ].join(" · ");
}

/**
 * One look at one run: its status line, what happened since `before`, and what to remember. A first
 * look says only the status and a quiet already under way.
 */
export function pulse(
  run: Run,
  log: readonly LogEvent[],
  process: Process,
  before: Seen | undefined,
  now: number,
): Look {
  const open = process === "open";
  const solves = solvesIn(log);
  const tasks = new Map(solves.map(({ id, start }) => [id, word(start.task)]));
  const task = (solve: JsonValue | undefined) => tasks.get(word(solve)) ?? word(solve);
  const fresh = log.slice(before?.lines ?? log.length);
  const lines = fresh.flatMap(({ kind, data }) => SAID[kind]?.(data, task) ?? []);
  const errors = fresh.flatMap(({ kind, data }) =>
    kind.endsWith(".turn") && isString(data.error) ? [data.error] : [],
  );
  if (errors.length > 0) {
    lines.push(`⚠ ${plural(errors.length, "failed turn")}: ${[...new Set(errors)].map(short).join("; ")}`);
  }
  const last = log.at(-1);
  const quiet = open && last !== undefined && now - Date.parse(last.at) > QUIET_MS;
  if (quiet && before?.quiet !== true) lines.push(`⚠ quiet for ${minutes(now - Date.parse(last.at))}`);
  if (!quiet && before?.quiet === true) lines.push("· not quiet any more");
  // A run's end is that of the last thing it started: an Examiner session writes no report, and
  // the second on exam-1 (2026-10-08) ended whole and was said to be gone before one. A checkpoint
  // starts no session, so its own start is where its report is looked for.
  const end = log[lastStart(log)]?.kind === "exam.started" ? "exam.finished" : run.end;
  const ended =
    count(log.slice(Math.max(lastWork(log), 0)), end) > 0 &&
    solves.every(({ finished }) => finished !== null);
  if (before?.open === true && !open && !ended) lines.push(`⚠ the process is gone before ${end}`);
  // A comparison starts each task under two harnesses, so a line may come twice.
  const told = Object.entries(countBy(lines, (line) => line)).map(([line, n]) =>
    n === 1 ? line : `${line} (×${String(n)})`,
  );
  return {
    status: status(run, { log, solves }, process, now),
    said: told,
    seen: { lines: log.length, open, quiet },
  };
}

/** The whole lines of a log an append may be writing to: a torn last line is an append in flight. */
export function logEvents(path: string): LogEvent[] {
  const text = readFileSync(path, "utf8");
  return text
    .slice(0, text.lastIndexOf("\n") + 1)
    .split("\n")
    .slice(0, -1)
    .map((line) => parseJsonAs<LogEvent>(line));
}

/** Every run log in the repository's worktrees. */
export function runs(): Run[] {
  const porcelain = runTextSyncOrThrow(["git", "worktree", "list", "--porcelain"]);
  const trees = porcelain
    .split("\n")
    .flatMap((line) => (line.startsWith("worktree ") ? [line.slice(9)] : []));
  const listed = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);
  return trees.flatMap((tree) => [
    ...listed(join(tree, ".ana", "d2"))
      .map((name) => ({
        name,
        tree,
        path: join(tree, ".ana", "d2", name, LOG_FILE),
        end: "comparison.reported" as const,
        seed: existsSync(join(tree, ".ana", "d2", name, SEED_FILE)),
      }))
      .filter(({ path }) => existsSync(path)),
    ...listed(join(tree, ".ana", "live"))
      .filter((file) => file.endsWith(".jsonl"))
      .map((file) => ({
        name: basename(file, ".jsonl"),
        tree,
        path: join(tree, ".ana", "live", file),
        end: "solve.finished" as const,
      })),
  ]);
}

/** Where a worktree stands: its commit, and whether it holds a change no commit names. */
export function standing(tree: string) {
  const git = (...args: string[]) => runTextSyncOrThrow(["git", "-C", tree, ...args]).trim();
  return { commit: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain") !== "" };
}

/** Each running round, Examiner session and live solve: its process, its arguments and the worktree
 *  it runs in. */
export function processes(): {
  readonly pid: number;
  readonly cwd: string;
  readonly args: readonly string[];
}[] {
  const table = runTextSyncOrThrow(["ps", "-axo", "pid=,args="]).split("\n");
  const found = table.flatMap((row) => {
    const [pid = "", ...args] = row.trim().split(/\s+/);
    return campaigns(args) || runsAs(args, [LIVE]) ? [{ pid, args }] : [];
  });
  if (found.length === 0) return [];
  // lsof exits 1 when a process left between the two reads, so its answer is read as given.
  const cwds = new Map<string, string>();
  let pid = "";
  const listing = runSync(["lsof", "-a", "-d", "cwd", "-Fpn", "-p", found.map((row) => row.pid).join(",")]);
  for (const line of decodeOutput(listing.stdout).split("\n")) {
    if (line.startsWith("p")) pid = line.slice(1);
    if (line.startsWith("n")) cwds.set(pid, line.slice(1));
  }
  return found.map(({ pid: id, args }) => ({ pid: Number(id), cwd: cwds.get(id) ?? "", args }));
}

/** The processes in `running` that write `run`'s log. */
export function writers(run: Run, running: ReturnType<typeof processes>) {
  const flag = (args: readonly string[], name: string) => args[args.indexOf(name) + 1];
  const writes = (args: readonly string[]) =>
    run.end === "comparison.reported"
      ? campaigns(args) && flag(args, "--name") === run.name
      : runsAs(args, [LIVE]) &&
        run.name.startsWith(`${String(flag(args, "--task"))}-${String(flag(args, "--cycle"))}-`);
  return running.filter(({ cwd, args }) => cwd === run.tree && writes(args));
}

function look(state: string, names: readonly string[]): void {
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
  const chosen = all.filter(({ run, open, before }) =>
    names.length > 0 ? names.some((name) => run.name.includes(name)) : open || before?.open === true,
  );
  const disk = statfsSync(".");
  const free = Math.round((disk.bavail * disk.bsize) / GIB);
  const since =
    memory.freeGiB === null
      ? ""
      : ` (${free - memory.freeGiB >= 0 ? "+" : ""}${String(free - memory.freeGiB)} since the last look)`;
  const clock = new Date(now).toISOString().slice(11, 16);
  const load = loadavg()[0] ?? 0;
  const open = all.filter((entry) => entry.open).length;
  console.log(
    `${clock}Z ${String(open)} open · load ${load.toFixed(1)} of ${String(availableParallelism())} cores · ${String(free)} GiB free${since}`,
  );
  // A run this look left out keeps what the last look saw of it.
  const logs: Record<string, Seen> = { ...memory.logs };
  for (const { run, open: isRunning, before } of chosen) {
    const seen = pulse(run, logEvents(run.path), isRunning ? "open" : "closed", before, now);
    console.log(seen.status);
    for (const line of seen.said) console.log(`  ${line}`);
    logs[run.path] = seen.seen;
  }
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
    },
  });
  for (;;) {
    look(values.state, names);
    if (values.once) break;
    await Bun.sleep(Number(values.every) * 1000);
  }
}
