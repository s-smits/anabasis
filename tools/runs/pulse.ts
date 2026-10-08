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
import type { EventKind, LogEvent } from "#src/kernel/log.ts";
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
export interface Seen {
  readonly lines: number;
  readonly open: boolean;
  readonly quiet: boolean;
}

/** A run's log, and the event that says the run is done: a round reports, a live solve finishes. */
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
export interface Look {
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
/** The command an Examiner session runs as. With a round's it is what writes a campaign's log for
 *  hours, each naming it with `--name`: an Examiner session was read as closed while it ran, the
 *  first time one did (exam-1, 2026-10-08). */
export const EXAMINE = "tools/d1b/examine.ts";
const CAMPAIGN = [ROUND, EXAMINE];
/** The file beside a log that says its campaign is a seed, and of what. */
export const SEED_FILE = "seed.json";
const LIVE = "tools/m0/live-solve.ts";
const QUIET_MS = 20 * 60_000;
const GIB = 2 ** 30;

const runsAs = (args: readonly string[], tools: readonly string[]) =>
  args.some((arg) => tools.some((tool) => arg.endsWith(tool)));

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
  "exam.word": (data) => `· ${word(data.taskId)} is told "${word(data.word)}"`,
  "anchor.scored": (data) =>
    `◆ anchor ${word(data.reading)}: ${word(data.wins)} won, ${word(data.losses)} lost, ${word(data.ties)} tied`,
  // A report that scored nothing, or whose reading does not stand without its flagged tasks, is one to
  // look at before it is believed (`src/builder/round.ts`).
  "comparison.reported": (data) => {
    const second = asRecord(data.unflagged)?.reading;
    if (second !== undefined && second !== data.reading) {
      return `⚠ reported ${word(data.reading)}, and ${word(second)} without its flagged tasks`;
    }
    return `${data.reading === "not-scored" ? "⚠" : "◆"} reported ${word(data.reading)}`;
  },
};

/** Where a run stands: reported, closed, inside a Builder or Examiner session, or solving. */
function stage(log: readonly LogEvent[], open: boolean): string {
  const report = log.findLast(({ kind }) => kind === "comparison.reported");
  if (report !== undefined) return `reported ${word(report.data.reading)}`;
  if (!open) return "closed";
  const session = (["build", "exam"] as const).find(
    (role) => count(log, `${role}.started`) > count(log, `${role}.finished`),
  );
  if (session !== undefined) return `${session} turn ${String(count(log, `${session}.turn`))}`;
  return count(log, "solve.started") > count(log, "solve.finished") ? "solving" : "working";
}

/** The status line of a run whose log holds `log`. */
function status(run: Run, log: readonly LogEvent[], open: boolean, now: number): string {
  const endings = log.flatMap(({ kind, data }) =>
    kind === "solve.finished" ? [asRecord(data.ending)?.outcome] : [],
  );
  const solves = ["pass", "fail", "non-result"].flatMap((outcome) => {
    const n = endings.filter((ending) => ending === outcome).length;
    return n === 0 ? [] : [`${String(n)} ${outcome}`];
  });
  const running = count(log, "solve.started") - endings.length;
  if (running > 0) solves.push(`${String(running)} running`);
  const total = log.reduce((sum, event) => sum + spent(event), 0);
  const last = log.at(-1);
  const age = last === undefined ? "no events" : `${minutes(now - Date.parse(last.at))} since the last event`;
  return [
    // A seed's counts and dollars are its source's up to the cut, and a script's after it.
    `${run.name}${run.seed === true ? " (a seed)" : ""}  ${stage(log, open)}`,
    `solves ${solves.join(", ") || "none"}`,
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
  open: boolean,
  before: Seen | undefined,
  now: number,
): Look {
  const tasks = new Map(
    log.flatMap(({ kind, data }) =>
      kind === "solve.started" ? [[word(data.solve), word(data.task)] as const] : [],
    ),
  );
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
  const ended = count(log, run.end) > 0 && count(log, "solve.started") === count(log, "solve.finished");
  if (before?.open === true && !open && !ended) lines.push(`⚠ the process is gone before ${run.end}`);
  // An anchor starts each task on the old harness and the fresh one, so a line may come twice.
  const told = Object.entries(countBy(lines, (line) => line)).map(([line, n]) =>
    n === 1 ? line : `${line} (×${String(n)})`,
  );
  return { status: status(run, log, open, now), said: told, seen: { lines: log.length, open, quiet } };
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
        path: join(tree, ".ana", "d2", name, "log.jsonl"),
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
    return runsAs(args, [...CAMPAIGN, LIVE]) ? [{ pid, args }] : [];
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
      ? runsAs(args, CAMPAIGN) && flag(args, "--name") === run.name
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
    const seen = pulse(run, logEvents(run.path), isRunning, before, now);
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
