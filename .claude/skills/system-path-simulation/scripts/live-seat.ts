#!/usr/bin/env bun
/**
 * One live seat on a seed, and the reading of what it wrote. `start` runs a campaign command on a
 * seed in a worktree, on one login, niced and in a process group of its own; it watches the dollars
 * the log bills from where the seat began, ends the group at the seat's cap or its minutes, and
 * prints the reading once the group is gone. `read` is that reading of any stretch of a log.
 *
 *   bun .claude/skills/system-path-simulation/scripts/live-seat.ts start --tree <worktree> --name sim-<what>
 *     --out <prefix> --cap <dollars> --minutes <n> [--login N] [--mention <text>]... -- <command> <its flags>
 *   bun .claude/skills/system-path-simulation/scripts/live-seat.ts read --seat <prefix>
 *     | --log <path> --from <event> [--mention <text>]... [--json]
 *
 * Run `start` under `bun --env-file=<file>` and as one background command: it ends when the seat
 * does, so its end is the one notice to wait for, and the 30-minute monitor a watcher re-arms is not
 * needed. `<prefix>.json` keeps where the seat began, `<prefix>.out` and `.err` its command's output.
 * `--mention` counts the Examiner's calls whose arguments name the text, such as a folder of its home.
 *
 * The supply ablation of 18 October ran its two arms on a Python reader, a shell watcher and a
 * spawner copied for the second arm by sed: the event where each arm began was typed by hand
 * (10757), the watcher summed `billed` by kinds of its own, the reader named one domain's programs,
 * and the second arm's spawner had to name Bun by its path and set `RUN_REMOTE=0`, since the `bun`
 * on the PATH sends a command to a remote host. Each fact here has one owner already: the login
 * (`loginEnv`), the dollars (`billedBetween`), a gate that read its draft (`measuredGate`) and held
 * it (`heldAtGate`), and the turns of the reference's valid answers at a gate (`gateAnswers`).
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { gateAnswers, measuredGate } from "#src/examiner/record.ts";
import { LOG_FILE, type LogEvent, read } from "#src/kernel/log.ts";
import { billedBetween } from "#src/kernel/reports.ts";
import { heldAtGate } from "#src/kernel/task.ts";
import { existsSync, openSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { gitText } from "#src/meta/git.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { type JsonObject, asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { capturedExecPath, capturedSpawn, runtimeProcess } from "#src/meta/process.ts";
import { processGroupExists, terminateAndReapProcessGroupId } from "#src/meta/subprocess.ts";
import { SEED_FILE } from "#tools/runs/registry.ts";
import { loginEnv } from "#tools/runs/manage.ts";

const USAGE = `usage:
  live-seat.ts start --tree <worktree> --name sim-<what> --out <prefix> --cap <dollars> --minutes <n>
    [--login N] [--mention <text>]... -- <command> <its flags>
  live-seat.ts read --seat <prefix> | --log <path> --from <event> [--mention <text>]... [--json]

start runs <command> with --name in <tree>, on a seed only, and prints the reading when it ends.`;
const OPTIONS = {
  tree: "abs",
  name: "text",
  out: "abs",
  cap: "text",
  minutes: "int",
  login: "text",
  seat: "abs",
  log: "abs",
  from: "int",
  mention: "list",
  json: "flag",
} as const;
/** How often the watch reads the log, and how often it says so when nothing new was gated. */
const TICK_MS = 30_000;
const QUIET_TICKS = 10;

/** A log, and the event a seat began at in it. */
interface Stretch {
  readonly log: string;
  readonly from: number;
}

interface Reading {
  readonly events: readonly [number, number];
  readonly minutes: number;
  readonly billed: number;
  readonly sessions: readonly string[];
  readonly ended: readonly string[];
  readonly proposed: number;
  /** Each gate by what the reference's solves of its draft did, `every`, `some`, `none`, `none,
   *  proved` (its author's answer passes), `package` (refused on its package before a solve) or `unread`. */
  readonly gates: Readonly<Record<string, number>>;
  readonly held: number;
  /** The solver's own turns of each valid gate answer, least, median and most. */
  readonly turns: readonly [number, number, number] | null;
  readonly calls: Readonly<Record<string, number>>;
  readonly mentions: Readonly<Record<string, number>>;
}

/** What one gate's reading of its draft comes to, as one word. */
function gateWord(data: JsonObject): string {
  if (!measuredGate(data)) return "unread";
  const reference = asRecord(data.reference);
  const valid = reference?.valid;
  const solves = reference?.solves;
  if (!isNumber(valid) || !isNumber(solves)) return "package";
  if (valid === solves) return "every";
  if (valid > 0) return "some";
  return data.proved === true ? "none, proved" : "none";
}

const counted = (words: readonly string[]) =>
  words.reduce<Record<string, number>>((into, word) => ({ ...into, [word]: (into[word] ?? 0) + 1 }), {});

function spread(values: readonly number[]): readonly [number, number, number] | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return [sorted[0] ?? 0, sorted[Math.floor((sorted.length - 1) / 2)] ?? 0, sorted.at(-1) ?? 0];
}

/** What the log holds from event `from` on: the stretch one seat wrote, read by the owners above. */
export function readingOf(events: readonly LogEvent[], from: number, mentions: readonly string[]): Reading {
  const stretch = events.slice(from);
  const of = (kind: string) => stretch.flatMap((event) => (event.kind === kind ? [event.data] : []));
  const gates = of("task.gate");
  const calls = of("exam.call");
  const first = stretch[0]?.at;
  const last = stretch.at(-1)?.at;
  const turns = [...gateAnswers(events, from - 1).values()].flatMap((answers) =>
    answers.flatMap(({ turns: used }) => (used === null ? [] : [used])),
  );
  return {
    events: [from, events.length],
    minutes: first === undefined || last === undefined ? 0 : (Date.parse(last) - Date.parse(first)) / 60_000,
    billed: billedBetween(events, from),
    sessions: of("exam.started").flatMap(({ session }) => (isString(session) ? [session] : [])),
    ended: of("exam.finished").flatMap(({ ended }) => (isString(ended) ? [ended] : [])),
    proposed: of("task.proposed").length,
    gates: counted(gates.map(gateWord)),
    held: gates.filter(({ outcome }) => heldAtGate(outcome)).length,
    turns: spread(turns),
    calls: counted(calls.flatMap(({ tool }) => (isString(tool) ? [tool] : []))),
    mentions: Object.fromEntries(
      mentions.map((text) => [
        text,
        calls.filter(({ args }) => capturedJsonStringify(args ?? null).includes(text)).length,
      ]),
    ),
  };
}

const listed = (counts: Readonly<Record<string, number>>) =>
  Object.entries(counts)
    .map(([word, count]) => `${word} ${String(count)}`)
    .join(", ") || "none";

/** The reading as the lines a person reads. */
export function told(reading: Reading): string[] {
  const { turns } = reading;
  return [
    `events ${String(reading.events[0])} to ${String(reading.events[1])}, ${reading.minutes.toFixed(0)} min, $${reading.billed.toFixed(2)} billed`,
    `sessions ${reading.sessions.join(", ") || "none"}; ended ${reading.ended.join(", ") || "none yet"}`,
    `drafts proposed ${String(reading.proposed)}, gated ${listed(reading.gates)}; held ${String(reading.held)}`,
    `the reference's valid gate answers took ${turns === null ? "no turns on record" : `${String(turns[0])} to ${String(turns[2])} turns, median ${String(turns[1])}`}`,
    `calls ${listed(reading.calls)}`,
    ...Object.entries(reading.mentions).map(([text, count]) => `calls naming ${text}: ${String(count)}`),
  ];
}

/** The events of a log as far as they read: a line torn while the seat writes waits a tick. */
function eventsNow(log: string): LogEvent[] | null {
  try {
    return read(log);
  } catch {
    return null;
  }
}

async function start(args: CommandArgs, command: readonly string[]): Promise<number> {
  const tree = args.required("tree");
  const name = args.required("name");
  const out = args.required("out");
  const cap = Number(args.required("cap"));
  const minutes = args.int("minutes") ?? args.die("--minutes is required");
  if (!Number.isFinite(cap) || cap <= 0) args.die("--cap is a number of dollars above 0");
  if (command.length === 0) args.die("name the command after --");
  const folder = join(tree, ".ana", "d2", name);
  // Rule 4 of the skill: a seat writes only to a seed, and the name and seed.json are the guard.
  if (!name.startsWith("sim-") || !existsSync(join(folder, SEED_FILE))) {
    args.die(`${folder} is no seed: a seat runs on sim-<what> with ${SEED_FILE} beside its log`);
  }
  const log = join(folder, LOG_FILE);
  const from = read(log).length;
  const env = { ...loginEnv(runtimeProcess.env, args.value("login") ?? undefined), RUN_REMOTE: "0" };
  const child = capturedSpawn(["nice", "-n", "10", capturedExecPath, ...command, "--name", name], {
    cwd: tree,
    env,
    detached: true,
    stdin: "ignore",
    stdout: openSync(`${out}.out`, "a"),
    stderr: openSync(`${out}.err`, "a"),
  });
  child.unref();
  const commit = gitText(tree, "rev-parse", "--short=9", "HEAD");
  writeFileSync(
    `${out}.json`,
    `${capturedJsonStringify({ tree, name, commit, command, from, pid: child.pid, at: new Date().toISOString() }, null, 2)}\n`,
  );
  console.log(`${name} at ${commit}: pid ${String(child.pid)}, from event ${String(from)}; ${out}.err`);
  const began = Date.now();
  let gated = 0;
  let quiet = 0;
  let stopped: string | null = null;
  while (processGroupExists(child.pid)) {
    await Bun.sleep(TICK_MS);
    const events = eventsNow(log);
    if (events === null) continue;
    const billed = billedBetween(events, from);
    const elapsed = (Date.now() - began) / 60_000;
    const gates = events.slice(from).filter(({ kind }) => kind === "task.gate");
    for (const { data } of gates.slice(gated)) console.log(`gate ${gateWord(data)}, $${billed.toFixed(2)}`);
    quiet = gates.length > gated ? 0 : quiet + 1;
    gated = gates.length;
    if (quiet >= QUIET_TICKS) {
      console.log(`${elapsed.toFixed(0)} min, $${billed.toFixed(2)}`);
      quiet = 0;
    }
    if (billed > cap || elapsed > minutes) {
      stopped =
        billed > cap ? `its cap, $${billed.toFixed(2)} of $${String(cap)}` : `its ${String(minutes)} minutes`;
      await terminateAndReapProcessGroupId(child.pid);
    }
  }
  console.log(stopped === null ? `${name} ended by itself` : `${name} stopped at ${stopped}`);
  console.log(told(readingOf(read(log), from, args.list("mention"))).join("\n"));
  return stopped === null ? 0 : 1;
}

/** The log and the event a reading starts at: as `start` kept them beside a seat's output, or named. */
function stretchOf(args: CommandArgs): Stretch {
  const seat = args.value("seat");
  if (seat === null) {
    const from = args.int("from") ?? args.die("--from is required with --log: the event the seat began at");
    return { log: args.required("log"), from };
  }
  if (args.value("log") !== null || args.int("from") !== null) {
    args.die("name a seat, or a log and an event, not both");
  }
  const kept = asRecord(capturedJsonParse(readFileSync(`${seat}.json`, "utf8")));
  const { tree, name, from } = kept ?? {};
  if (!isString(tree) || !isString(name) || !isNumber(from)) args.die(`${seat}.json is no seat start kept`);
  return { log: join(tree, ".ana", "d2", name, LOG_FILE), from };
}

function readCommand(args: CommandArgs): number {
  const { log, from } = stretchOf(args);
  if (!existsSync(log)) args.die(`${log} does not exist`);
  const result = readingOf(read(log), from, args.list("mention"));
  console.log(args.flag("json") ? capturedJsonStringify(result, null, 2) : told(result).join("\n"));
  return 0;
}

async function main(args: CommandArgs): Promise<number> {
  const [verb, ...command] = args.positionals;
  if (verb === "start") return start(args, command);
  if (verb === "read") {
    if (command.length > 0) args.die("read takes no command");
    return readCommand(args);
  }
  return args.die(`the verb is start or read, not ${verb ?? "none"}`);
}

if (import.meta.main) {
  await runCommand({ name: "live-seat", usage: USAGE, options: OPTIONS, positionals: [1, 200] }, main);
}
