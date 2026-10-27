#!/usr/bin/env bun
/**
 * One live seat on a seed, and the reading of what it wrote. `start` runs a campaign command on a
 * seed in a worktree, on one login, niced and in a process group of its own; it watches the dollars
 * the log bills from where the seat began, ends the group at the seat's cap or its minutes, and
 * prints the reading once the group is gone. `read` is that reading of any stretch of a log. `watch`
 * and `due` tell an agent what a seat wrote as it lands (`newsOf`): `watch` one line an event for a
 * line reader such as Claude Code's Monitor, `due` what is unread since it last looked, and with
 * `--hook` an exit of 2 that a Claude Code Stop hook turns into a turn the agent must take. `stop`
 * ends a seat whose question is answered, and `start` says so in its reading. `compare` sets the
 * readings of several seats side by side, each cut at the same count of gates where `--gates` names
 * one, since two arms gate at different paces. `pairs` reads several pairs of seats, a control and an
 * arm each, each pair at the shorter arm's count of gates, and counts over the pairs of one Examiner
 * model which way the arm moved. `calls` counts the Examiner's tool calls and their failures over any
 * logs, each call once however many seeds copied it. `prompt` prints what an Examiner session would
 * be told, composed by a tree's own code with no model, so two arms' prompts are diffed before either
 * is paid.
 *
 *   bun .claude/skills/system-path-simulation/scripts/live-seat.ts start --tree <worktree> --name sim-<what>
 *     --out <prefix> --cap <dollars> --minutes <n> [--login N] [--mention <text>]... -- <command> <its flags>
 *   bun .claude/skills/system-path-simulation/scripts/live-seat.ts read --seat <prefix>
 *     | --log <path> --from <event> [--mention <text>]... [--json]
 *   bun .claude/skills/system-path-simulation/scripts/live-seat.ts watch --seat <prefix>
 *   bun .claude/skills/system-path-simulation/scripts/live-seat.ts due <prefix>... [--hook]
 *   bun .claude/skills/system-path-simulation/scripts/live-seat.ts stop --seat <prefix>
 *   bun .claude/skills/system-path-simulation/scripts/live-seat.ts compare <prefix>... [--gates N]
 *   bun .claude/skills/system-path-simulation/scripts/live-seat.ts pairs <control>,<arm>... [--gates N]
 *   bun .claude/skills/system-path-simulation/scripts/live-seat.ts calls <log or campaign folder>...
 *   bun .claude/skills/system-path-simulation/scripts/live-seat.ts prompt --tree <worktree> --name sim-<what>
 *     -- tools/d1b/examine.ts <its flags>
 *
 * Run `start` under `bun --env-file=<file>` and as one background command: it ends when the seat
 * does, so its end is the one notice to wait for, and the 30-minute monitor a watcher re-arms is not
 * needed. `<prefix>.json` keeps where the seat began, `<prefix>.out` and `.err` its command's output,
 * each emptied at a start: on 22 October a relaunch under one prefix wrote nothing to stderr, and
 * its `.err` still held the error that ended the launch before it.
 * `--mention` counts the Examiner's calls whose arguments name the text, such as a folder of its home.
 *
 * The supply ablation of 18 October ran its two arms on a Python reader, a shell watcher and a
 * spawner copied for the second arm by sed: the event where each arm began was typed by hand
 * (10757), the watcher summed `billed` by kinds of its own, the reader named one domain's programs,
 * and the second arm's spawner had to name Bun by its path and set `RUN_REMOTE=0`, since the `bun`
 * on the PATH sends a command to a remote host. Each fact here has one owner already: the login
 * (`loginEnv`), the dollars (`billedBetween`), a gate that read its draft (`measuredGate`) and held
 * it (`heldAtGate`), and the turns of the reference's valid answers at a gate (`gateAnswers`).
 *
 * The prompt rewrite of 27 October (#471) ran two rounds of before-and-after arms and improvised the
 * rest: a scratch script composed each arm's prompt, a second watcher counted both arms, a seat was
 * ended by killing its group by hand, and the arms read at different paces were compared by eye.
 *
 * Eight rounds of Examiner tuning (26 to 28 October) read their pairs by hand: round 8's table of
 * five pairs was set together from one `compare` a pair, the sign over pairs counted by eye, and GPT
 * kept apart from Opus by memory. The census of tool calls that found the failed `read_example`
 * calls and the declined first `finish` was a scratch script. A one-off read of a seed's log counted
 * its source campaign's gates as the seat's, and a seed copied to another host with its links
 * unresolved crashed its seat twice on a missing file. `pairs`, `calls`, `read --log` on a seed
 * from its cut, and `start`'s refusal of a seed with a broken link answer those four.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { EXAMINE } from "#src/campaign/admission.ts";
import { gateAnswers, measuredGate } from "#src/examiner/record.ts";
import type { writing as Writing } from "#src/examiner/write.ts";
import type { examineCommand as ExamineCommand } from "#tools/d1b/examine.ts";
import { LOG_FILE, type LogEvent, read } from "#src/kernel/log.ts";
import { ROOM } from "#src/kernel/compare.ts";
import { type Call, billedBetween, tracesIn } from "#src/kernel/trace.ts";
import { heldAtGate } from "#src/kernel/task.ts";
import { existsSync, openSync, readFileSync, readdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import { gitText } from "#src/meta/git.ts";
import { capturedJsonParse, capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { type JsonObject, asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import { capturedExecPath, capturedSpawn, runtimeProcess } from "#src/meta/process.ts";
import { processGroupExists, terminateAndReapProcessGroupId } from "#src/meta/subprocess.ts";
import { SEED_FILE } from "#tools/runs/registry.ts";
import { seedCut } from "#tools/runs/seed.ts";
import { loginEnv } from "#tools/runs/manage.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

const USAGE = `usage:
  live-seat.ts start --tree <worktree> --name sim-<what> --out <prefix> --cap <dollars> --minutes <n>
    [--login N] [--mention <text>]... -- <command> <its flags>
  live-seat.ts read --seat <prefix> | --log <path> --from <event> [--mention <text>]... [--json]
  live-seat.ts watch --seat <prefix>
  live-seat.ts due <prefix>... [--hook]
  live-seat.ts stop --seat <prefix>
  live-seat.ts compare <prefix>... [--gates N]
  live-seat.ts pairs <control>,<arm>... [--gates N]
  live-seat.ts calls <log or campaign folder>...
  live-seat.ts prompt --tree <worktree> --name sim-<what> -- tools/d1b/examine.ts <its flags>

start runs <command> with --name in <tree>, on a seed only, and prints the reading when it ends.
watch prints one line for each event worth reading as it lands, until the seat's process is gone.
due prints what landed in each seat since due last looked; with --hook it writes that to stderr and
exits 2 when there is any, as a Claude Code Stop hook keeps the session from stopping.
stop ends a running seat's process group; its start then prints the reading.
compare prints each seat's counts in a column, each cut after its first N gates with --gates.
pairs reads each pair of seats, a control and an arm on the same seed cut under the same models, at
the shorter arm's count of gates (or N), and counts for each Examiner model in how many pairs the arm
did more, fewer or as many.
calls counts the Examiner's tool calls, failed calls by tool and kind, and finishes the session
went on after, over every log named, each call once however many seeds copied it.
prompt prints the system prompt, opening, tools and nudges the Examiner command would seat, and
seats nothing.`;
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
  hook: "flag",
  gates: "int",
} as const;
/** How often the watch reads the log, and how often it says so when nothing new was gated. */
const TICK_MS = 30_000;
const QUIET_TICKS = 10;
/** The gates where the author's answer beat the reference's best by at least the room floor. */
const GAP = `gap >= ${String(ROOM * 100)}%`;
/** A line of a failed call's text that names its error. */
const ERROR_LINE = /error|denied|not found|no such|not permitted|timed out|refused|invalid|cannot|failed/iu;
/** The flags that say who sits in an Examiner seat: a pair is read only within one of them. */
const SEATED = ["--examiner", "--examiner-effort", "--reviewer", "--reviewer-effort"] as const;

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
  /** The solves the reference ran at each gate that solved its draft: `ran`, or the solves it read
   *  where a gate from before one solve at a time (#280) did not say. */
  readonly ran: readonly number[];
  /** The author's gain by the objective over the reference's best valid answer at each gate that
   *  measured both (`reference.gap`): a graded loss where held drafts are too few to read. */
  readonly gaps: readonly number[];
  /** The solver's own turns of each valid gate answer, least, median and most. */
  readonly turns: readonly [number, number, number] | null;
  readonly calls: Readonly<Record<string, number>>;
  readonly mentions: Readonly<Record<string, number>>;
}

/** How many of a reading's gates measured the author's answer at least the room floor ahead. */
const beyondRoom = (gaps: readonly number[]) => gaps.filter((gap) => gap >= ROOM).length;

/** What a pair is read on, each a count where the arm doing more is the Examiner doing better: drafts
 *  held, gates whose draft the reference answered in some solves or in none while its author's answer
 *  passed, the author ahead of the reference's best by the room floor, and the median turns of the
 *  reference's valid gate answers. Round 8 of 27 October read all four by hand. */
const MEASURES: readonly (readonly [string, (reading: Reading) => number | null])[] = [
  ["held", ({ held }) => held],
  ["room on validity", ({ gates }) => (gates.some ?? 0) + (gates["none, proved"] ?? 0)],
  [GAP, ({ gaps }) => beyondRoom(gaps)],
  ["median turns", ({ turns }) => turns?.[1] ?? null],
];

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

function spread(values: readonly number[]): readonly [number, number, number] | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return [sorted[0] ?? 0, sorted[Math.floor((sorted.length - 1) / 2)] ?? 0, sorted.at(-1) ?? 0];
}

/** The Examiner's tool calls among `events`, as the trace reader reads them. */
const examCalls = (events: readonly LogEvent[]) =>
  tracesIn(events).filter((each): each is Call => each.seat === "exam" && each.part === "call");

/** What the log holds from event `from` on: the stretch one seat wrote, read by the owners above. */
export function readingOf(events: readonly LogEvent[], from: number, mentions: readonly string[]): Reading {
  const stretch = events.slice(from);
  const of = (kind: string) => stretch.flatMap((event) => (event.kind === kind ? [event.data] : []));
  const gates = of("task.gate");
  const calls = examCalls(stretch);
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
    gates: countBy(gates, gateWord),
    held: gates.filter(({ outcome }) => heldAtGate(outcome)).length,
    ran: gates.flatMap(({ reference }) => {
      const { ran, solves } = asRecord(reference) ?? {};
      const count = ran ?? solves;
      return isNumber(count) && count > 0 ? [count] : [];
    }),
    turns: spread(turns),
    gaps: gates.flatMap(({ reference }) => {
      const { gap } = asRecord(reference) ?? {};
      return isNumber(gap) ? [gap] : [];
    }),
    calls: countBy(calls, ({ tool }) => tool),
    mentions: Object.fromEntries(
      mentions.map((text) => [
        text,
        calls.filter(({ args }) => capturedJsonStringify(args).includes(text)).length,
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
    `the gate ran ${String(reading.ran.reduce((sum, count) => sum + count, 0))} solves over ${String(reading.ran.length)} drafts${reading.ran.length === 0 ? "" : `: ${reading.ran.join(", ")}`}`,
    `the reference's valid gate answers took ${turns === null ? "no turns on record" : `${String(turns[0])} to ${String(turns[2])} turns, median ${String(turns[1])}`}`,
    `calls ${listed(reading.calls)}`,
    ...Object.entries(reading.mentions).map(([text, count]) => `calls naming ${text}: ${String(count)}`),
  ];
}

/** The events of a stretch an agent should read as they land, one line each: a gate's word with the
 *  solves it ran, a Referee's ruling or refusal, and a session's end. */
export function newsOf(events: readonly LogEvent[], from: number): string[] {
  const text = (value: unknown) => (isString(value) ? value : JSON.stringify(value));
  return events.slice(from).flatMap(({ kind, data }) => {
    if (kind === "task.gate") {
      const ran = asRecord(data.reference)?.ran;
      return [
        `gate ${text(data.outcome)}, ${gateWord(data)}${isNumber(ran) ? `, ${plural(ran, "solve")} ran` : ""}`,
      ];
    }
    if (kind === "referee.finding") return [`ruling ${text(data.ruling)} on ${text(data.solve)}`];
    if (kind === "referee.refused") return [`ruling refused on ${text(data.solve)}`];
    if (kind === "exam.finished" || kind === "build.finished") {
      return [`${text(data.session)} ended ${text(data.ended)}`];
    }
    return [];
  });
}

/** Every Examiner call in `logs`, once each: a seed copies its source's events as they stand, so one
 *  call is one time at one place in a log however many copies hold it. A `finish` the session went
 *  on after was declined by the host, refused, or left drafts at the gate. */
export function censusOf(logs: readonly (readonly LogEvent[])[]) {
  const calls = new Map<string, Call>();
  const wentOn = new Set<string>();
  const sessions = new Set<string>();
  const key = ({ at, index }: { at: string; index: number }) => `${at} ${String(index)}`;
  for (const events of logs) {
    const own = examCalls(events);
    for (const [at, call] of own.entries()) {
      calls.set(key(call), call);
      if (call.tool === "finish" && own.slice(at + 1).some(({ id }) => id === call.id)) wentOn.add(key(call));
    }
    for (const [index, event] of events.entries()) {
      if (event.kind === "exam.started") sessions.add(key({ at: event.at, index }));
    }
  }
  const all = [...calls.values()];
  const failed = all.filter(({ isError }) => isError);
  // The last line that reads as an error, above the turn and exit lines the host appends, or else the
  // first, with its numbers and digests as N so that one error is one kind.
  const kindOf = (text: string) => {
    const lines = text.split("\n").filter((line) => line.trim() !== "");
    return (lines.findLast((line) => ERROR_LINE.test(line)) ?? lines[0] ?? "").trim();
  };
  return {
    logs: logs.length,
    sessions: sessions.size,
    calls: countBy(all, ({ tool }) => tool),
    failed: countBy(failed, ({ tool }) => tool),
    kinds: countBy(
      failed,
      ({ tool, text }) =>
        `${tool}: ${kindOf(text)
          .replaceAll(/[\da-f]{12,}|\d+/gu, "N")
          .slice(0, 100)}`,
    ),
    finishes: [all.filter(({ tool }) => tool === "finish").length, wentOn.size] as const,
  };
}

/** The events of a log as far as they read: a line torn while the seat writes waits a tick. */
function eventsNow(log: string): LogEvent[] | null {
  try {
    return read(log);
  } catch {
    return null;
  }
}

/** The log of a seed: rule 4 of the skill, a seat writes only to a seed, and the name and seed.json
 *  are the guard. */
function seedLog(tree: string, name: string, die: CommandArgs["die"]): string {
  const folder = join(tree, ".ana", "d2", name);
  if (!name.startsWith("sim-") || !existsSync(join(folder, SEED_FILE))) {
    die(`${folder} is no seed: a seat runs on sim-<what> with ${SEED_FILE} beside its log`);
  }
  // A seed's exam and its kept harnesses' tool trees hold links; copied to another host as links,
  // they point at nothing, and on 27 October two seats there crashed on the missing file.
  const broken = ["checks", "exams", "states"].flatMap((part) =>
    existsSync(join(folder, part))
      ? readdirSync(join(folder, part), { recursive: true, withFileTypes: true }).flatMap((entry) => {
          const path = join(entry.parentPath, entry.name);
          return entry.isSymbolicLink() && !existsSync(path) ? [path] : [];
        })
      : [],
  );
  if (broken.length > 0) {
    die(
      `${folder} holds ${plural(broken.length, "link")} to nothing, ${broken[0] ?? ""} first: seed it on this host, or copy it with rsync -aL`,
    );
  }
  return join(folder, LOG_FILE);
}

async function start(args: CommandArgs, command: readonly string[]): Promise<number> {
  const tree = args.required("tree");
  const name = args.required("name");
  const out = args.required("out");
  const cap = Number(args.required("cap"));
  const minutes = args.int("minutes") ?? args.die("--minutes is required");
  if (!Number.isFinite(cap) || cap <= 0) args.die("--cap is a number of dollars above 0");
  if (command.length === 0) args.die("name the command after --");
  const log = seedLog(tree, name, args.die);
  const from = read(log).length;
  const env = {
    ...loginEnv(runtimeProcess.env, args.value("login") ?? undefined),
    RUN_REMOTE: "0",
  };
  const child = capturedSpawn(["nice", "-n", "10", capturedExecPath, ...command, "--name", name], {
    cwd: tree,
    env,
    detached: true,
    stdin: "ignore",
    stdout: openSync(`${out}.out`, "w"),
    stderr: openSync(`${out}.err`, "w"),
  });
  writeFileSync(`${out}.stopped`, "");
  child.unref();
  const commit = gitText(tree, "rev-parse", "--short=9", "HEAD");
  writeFileSync(
    `${out}.json`,
    `${capturedJsonStringify({ tree, name, commit, command, from, pid: child.pid, at: new Date().toISOString() }, null, 2)}\n`,
  );
  console.log(`${name} at ${commit}: pid ${String(child.pid)}, from event ${String(from)}; ${out}.err`);
  const began = Date.now();
  let seen = from;
  let quiet = 0;
  let stopped: string | null = null;
  while (processGroupExists(child.pid)) {
    await Bun.sleep(TICK_MS);
    const events = eventsNow(log);
    if (events === null) continue;
    const billed = billedBetween(events, from);
    const elapsed = (Date.now() - began) / 60_000;
    const news = newsOf(events, seen);
    for (const line of news) console.log(`${line}, $${billed.toFixed(2)}`);
    quiet = news.length > 0 ? 0 : quiet + 1;
    seen = events.length;
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
  stopped ??= readFileSync(`${out}.stopped`, "utf8") || null;
  console.log(stopped === null ? `${name} ended by itself` : `${name} stopped at ${stopped}`);
  console.log(told(readingOf(read(log), from, args.list("mention"))).join("\n"));
  return stopped === null ? 0 : 1;
}

/** The log and the event a reading starts at: as `start` kept them beside a seat's output, or named. */
function stretchOf(args: CommandArgs): Stretch {
  const seat = args.value("seat");
  if (seat === null) {
    const log = args.required("log");
    // A seed's log begins with its source's events, whose gates are no seat's: read from its cut.
    const from =
      args.int("from") ??
      (existsSync(join(dirname(log), SEED_FILE))
        ? seedCut(dirname(log))
        : args.die("--from is required with --log outside a seed: the event the seat began at"));
    return { log, from };
  }
  if (args.value("log") !== null || args.int("from") !== null) {
    args.die("name a seat, or a log and an event, not both");
  }
  return keptSeat(seat, args.die);
}

/** What `start` kept of a seat: its log and first event, the process that leads its group, the
 *  tree's commit and the command it seated. */
function keptSeat(seat: string, die: CommandArgs["die"]) {
  const kept = asRecord(capturedJsonParse(readFileSync(`${seat}.json`, "utf8")));
  const { tree, name, from, pid, commit, command } = kept ?? {};
  if (!isString(tree) || !isString(name) || !isNumber(from)) die(`${seat}.json is no seat start kept`);
  return {
    log: join(tree, ".ana", "d2", name, LOG_FILE),
    from,
    pid: isNumber(pid) ? pid : null,
    commit: isString(commit) ? commit : "?",
    command: Array.isArray(command) ? command.filter(isString) : [],
  };
}

/** Each line worth reading as the seat writes it, then its reading once its process is gone: what a
 *  Monitor in Claude Code, or any agent reading a command's lines, waits on. */
async function watch(args: CommandArgs): Promise<number> {
  const { log, from, pid } = keptSeat(args.required("seat"), args.die);
  let upTo = from;
  for (;;) {
    const events = eventsNow(log);
    if (events !== null) {
      for (const line of newsOf(events, upTo)) console.log(line);
      upTo = events.length;
    }
    if (pid === null || !processGroupExists(pid)) break;
    await Bun.sleep(TICK_MS);
  }
  console.log(told(readingOf(read(log), from, [])).join("\n"));
  return 0;
}

/** What landed in each seat since `due` last looked, kept as an event count in `<prefix>.seen`. An
 *  agent's hook runs it between turns, so what a seat wrote is read before the agent stops waiting. */
function due(args: CommandArgs, seats: readonly string[]): number {
  if (seats.length === 0) args.die("name the seats' prefixes");
  const lines = seats.flatMap((seat) => {
    const { log, from } = keptSeat(seat, args.die);
    const seen = existsSync(`${seat}.seen`) ? Number(readFileSync(`${seat}.seen`, "utf8")) : from;
    const events = eventsNow(log);
    if (events === null) return [];
    writeFileSync(`${seat}.seen`, `${String(events.length)}\n`);
    return newsOf(events, seen).map((line) => `${basename(seat)}: ${line}`);
  });
  if (lines.length === 0) return 0;
  if (!args.flag("hook")) {
    console.log(lines.join("\n"));
    return 0;
  }
  console.error([...lines, "Read them against the simulation's predictions before going on."].join("\n"));
  return 2;
}

/** Ends a seat this host started, as its cap would, and leaves `start` the word that it was stopped. */
async function stop(args: CommandArgs): Promise<number> {
  const seat = args.required("seat");
  const { pid } = keptSeat(seat, args.die);
  if (pid === null || !processGroupExists(pid)) args.die(`${seat} has no process group running on this host`);
  writeFileSync(`${seat}.stopped`, "live-seat stop");
  await terminateAndReapProcessGroupId(pid);
  console.log(`${basename(seat)} stopped`);
  return 0;
}

/** Where each gate from event `from` on stands in the log. */
const gatesFrom = (events: readonly LogEvent[], from: number) =>
  events.flatMap((event, index) => (index >= from && event.kind === "task.gate" ? [index] : []));

/** A log's events up to its `gates`th gate from event `from` on, or all of them where it has fewer. */
function cutAt(events: readonly LogEvent[], from: number, gates: number | null): readonly LogEvent[] {
  const last = gates === null ? undefined : gatesFrom(events, from)[gates - 1];
  return last === undefined ? events : events.slice(0, last + 1);
}

/** Rows of cells as lines, each column as wide as its widest cell. */
function columns(rows: readonly (readonly string[])[]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    for (const [at, cell] of row.entries()) widths[at] = Math.max(widths[at] ?? 0, cell.length);
  }
  return rows.map((row) =>
    row
      .map((cell, at) => cell.padEnd((widths[at] ?? 0) + 2))
      .join("")
      .trimEnd(),
  );
}

/** Each seat's counts in a column of its own: the arms of one round, read at one count of gates. */
function compare(args: CommandArgs, seats: readonly string[]): number {
  if (seats.length < 2) args.die("name two seats' prefixes or more");
  const gates = args.int("gates");
  const readings = seats.map((seat) => {
    const { log, from, commit } = keptSeat(seat, args.die);
    return { seat, commit, reading: readingOf(cutAt(read(log), from, gates), from, []) };
  });
  const words = [...new Set(readings.flatMap(({ reading }) => Object.keys(reading.gates)))].toSorted();
  const each = (row: (reading: Reading) => number | string) =>
    readings.map(({ reading }) => String(row(reading)));
  const perHeld = (reading: Reading) =>
    reading.held === 0 ? "none held" : `$${(reading.billed / reading.held).toFixed(2)}`;
  const rows: [string, readonly string[]][] = [
    ["seat", readings.map(({ seat }) => basename(seat))],
    ["commit", readings.map(({ commit }) => commit)],
    ["minutes", each((reading) => reading.minutes.toFixed(0))],
    ["billed", each((reading) => `$${reading.billed.toFixed(2)}`)],
    ["proposed", each((reading) => reading.proposed)],
    ["gated", each((reading) => reading.ran.length)],
    ...words.map((word): [string, readonly string[]] => [
      `  ${word}`,
      each((reading) => reading.gates[word] ?? 0),
    ]),
    ["held", each((reading) => reading.held)],
    ["per held", each(perHeld)],
    ["gate solves", each((reading) => reading.ran.reduce((sum, count) => sum + count, 0))],
    ["median turns", each((reading) => reading.turns?.[1] ?? "none")],
    [GAP, each(({ gaps }) => `${String(beyondRoom(gaps))} of ${String(gaps.length)}`)],
    [
      "median gap",
      each(({ gaps }) => {
        const mid = spread(gaps)?.[1];
        return mid === undefined ? "none" : `${(mid * 100).toFixed(2)}%`;
      }),
    ],
  ];
  if (gates !== null) console.log(`each cut after its first ${plural(gates, "gate")}`);
  console.log(columns(rows.map(([label, cells]) => [label, ...cells])).join("\n"));
  return 0;
}

/** The pair `spec` names, `<control>,<arm>`, each read at the shorter one's count of gates or at
 *  `gates`. The two must be one seat on one position: the same Examiner and Referee at the same
 *  efforts, from seeds cut at the same event of the same campaign, so the trees are the one variable. */
function pairOf(spec: string, gates: number | null, die: CommandArgs["die"]) {
  const [first, second, ...rest] = spec.split(",");
  if (first === undefined || second === undefined || rest.length > 0) die(`${spec} is no <control>,<arm>`);
  const seatAt = (seat: string) => {
    const kept = keptSeat(seat, die);
    const folder = dirname(kept.log);
    const seed = existsSync(join(folder, SEED_FILE))
      ? parseJsonAs<{ from: string; events: number }>(readFileSync(join(folder, SEED_FILE), "utf8"))
      : null;
    return {
      ...kept,
      seat: basename(seat),
      events: read(kept.log),
      who: SEATED.map((flag) => {
        const at = kept.command.indexOf(flag);
        return at === -1 ? "default" : (kept.command[at + 1] ?? "default");
      }).join(" "),
      cut: seed === null ? "no seed" : `${basename(seed.from)} at event ${String(seed.events)}`,
    };
  };
  const control = seatAt(first);
  const arm = seatAt(second);
  if (control.who !== arm.who) die(`${spec}: the two seats differ in who sits (${control.who}; ${arm.who})`);
  if (control.cut !== arm.cut) die(`${spec}: the two seeds differ (${control.cut}; ${arm.cut})`);
  const gated = ({ events, from }: typeof arm) => gatesFrom(events, from).length;
  const cut = Math.min(gates ?? Infinity, gated(control), gated(arm));
  const readAt = ({ events, from }: typeof arm) => readingOf(cutAt(events, from, cut), from, []);
  return {
    name: `${control.seat},${arm.seat}`,
    model: arm.who.split(" ").slice(0, 2).join(" "),
    cut,
    before: readAt(control),
    after: readAt(arm),
  };
}

/** Each pair at equal gates in a row, then for each Examiner model the sign over its pairs on each
 *  measure, and what a gated draft cost each side: GPT is read only against GPT, Opus against Opus. */
function pairs(args: CommandArgs, specs: readonly string[]): number {
  if (specs.length === 0) args.die("name each pair as <control>,<arm>");
  const readPairs = specs.map((spec) => pairOf(spec, args.int("gates"), args.die));
  const shown = (value: number | null) => (value === null ? "none" : String(value));
  const perGate = (billed: number, gates: number) =>
    gates === 0 ? "none" : `$${(billed / gates).toFixed(2)}`;
  const rows = readPairs.map(({ name, model, cut, before, after }) => [
    name,
    model,
    String(cut),
    ...MEASURES.map(([, of]) => `${shown(of(before))} / ${shown(of(after))}`),
    `${perGate(before.billed, cut)} / ${perGate(after.billed, cut)}`,
  ]);
  console.log(
    columns([["pair", "examiner", "gates", ...MEASURES.map(([label]) => label), "$ per gate"], ...rows]).join(
      "\n",
    ),
  );
  for (const model of new Set(readPairs.map((pair) => pair.model))) {
    const own = readPairs.filter((pair) => pair.model === model && pair.cut > 0);
    const signs = MEASURES.map(([label, of]) => {
      const moved = own.flatMap(({ before, after }) => {
        const [was, is] = [of(before), of(after)];
        return was === null || is === null ? [] : [Math.sign(is - was)];
      });
      const count = (sign: number) => String(moved.filter((each) => each === sign).length);
      return [`  ${label}`, `more in ${count(1)}, fewer in ${count(-1)}, the same in ${count(0)}`];
    });
    const sum = (side: "before" | "after") => own.reduce((total, pair) => total + pair[side].billed, 0);
    const gated = own.reduce((total, { cut }) => total + cut, 0);
    console.log(`\n${model}, the arm against its control over ${plural(own.length, "pair")} with a gate:`);
    const dollars = `${perGate(sum("before"), gated)} against ${perGate(sum("after"), gated)}`;
    console.log(columns([...signs, ["  $ per gate", dollars]]).join("\n"));
  }
  return 0;
}

/** What the Examiner session of `command` would be told, composed by `tree`'s own code: the session
 *  stands in for `examine`, prints its mode, and exits before any turn, gate or event. A gate is
 *  composed as `try_task` whatever the seed's host may seat; the engines in its shell are left out. */
async function prompt(args: CommandArgs, command: readonly string[]): Promise<number> {
  const tree = args.required("tree");
  const name = args.required("name");
  const [script, ...flags] = command;
  if (script !== EXAMINE) {
    args.die(`prompt composes an Examiner session: -- ${EXAMINE}`);
  }
  const log = seedLog(tree, name, args.die);
  const before = read(log).length;
  // The tree's own modules, so a tree at another commit composes its own prompt.
  // SAFETY: both paths are modules of an Anabasis tree, which export these two functions; a tree whose
  // signatures differ fails the call below with the tree's own error.
  const { examineCommand } = (await import(join(tree, script))) as { examineCommand: typeof ExamineCommand };
  // SAFETY: as above.
  const { writing } = (await import(join(tree, "src/examiner/write.ts"))) as { writing: typeof Writing };
  runtimeProcess.chdir(tree);
  await examineCommand([...flags, "--name", name], (request, wall) => {
    const probe = () => Promise.reject(new Error("a composed prompt seats no gate"));
    const mode = writing(
      { ...request, probe },
      undefined,
      wall?.reference === undefined ? "unseen" : "in-home",
    );
    console.log(`=== SYSTEM\n${mode.system}\n\n=== OPENING\n${mode.opening}`);
    for (const tool of mode.tools) console.log(`\n=== TOOL ${tool.name}\n${tool.description}`);
    console.log(`\n=== NUDGE ${mode.nudge}\n=== FINISH ${mode.finish}\n=== DECLINED ${mode.declined}`);
    if (read(log).length !== before) {
      console.error(`${name}: composing wrote ${String(read(log).length - before)} events`);
    }
    return runtimeProcess.exit(0);
  });
  return 0;
}

/** The census of the logs or campaign folders named, each read where `logAcross` finds it. */
async function census(args: CommandArgs, named: readonly string[]): Promise<number> {
  if (named.length === 0) args.die("name the logs or campaign folders to count");
  const logs: LogEvent[][] = [];
  for (const each of named) {
    const log = existsSync(join(each, LOG_FILE)) ? join(each, LOG_FILE) : await logAcross(each);
    if (!existsSync(log)) args.die(`${log} does not exist`);
    logs.push(read(log));
  }
  const found = censusOf(logs);
  const most = (counts: Readonly<Record<string, number>>) =>
    Object.entries(counts).toSorted(([, a], [, b]) => b - a);
  const total = Object.values(found.calls).reduce((sum, count) => sum + count, 0);
  const lines = [
    `${plural(total, "Examiner call")} in ${plural(found.sessions, "session")} over ${plural(found.logs, "log")}, each call once`,
    ...most(found.calls).map(
      ([tool, count]) => `  ${tool} ${String(count)}, failed ${String(found.failed[tool] ?? 0)}`,
    ),
    "failed calls by kind, the commonest first:",
    ...most(found.kinds)
      .slice(0, 30)
      .map(([kind, count]) => `  ${String(count).padStart(4)}  ${kind}`),
    `finish ${String(found.finishes[0])}, the session went on after ${String(found.finishes[1])}`,
  ];
  console.log(lines.join("\n"));
  return 0;
}

async function readCommand(args: CommandArgs): Promise<number> {
  const stretch = stretchOf(args);
  const log = await logAcross(stretch.log);
  const { from } = stretch;
  if (!existsSync(log)) args.die(`${log} does not exist`);
  const result = readingOf(read(log), from, args.list("mention"));
  console.log(args.flag("json") ? capturedJsonStringify(result, null, 2) : told(result).join("\n"));
  return 0;
}

async function main(args: CommandArgs): Promise<number> {
  const [verb, ...command] = args.positionals;
  if (verb === "start") return start(args, command);
  if (verb === "watch") return watch(args);
  if (verb === "due") return due(args, command);
  if (verb === "stop") return stop(args);
  if (verb === "compare") return compare(args, command);
  if (verb === "pairs") return pairs(args, command);
  if (verb === "calls") return census(args, command);
  if (verb === "prompt") return prompt(args, command);
  if (verb === "read") {
    if (command.length > 0) args.die("read takes no command");
    return readCommand(args);
  }
  return args.die(
    `the verb is start, read, watch, due, stop, compare, pairs, calls or prompt, not ${verb ?? "none"}`,
  );
}

if (import.meta.main) {
  await runCommand({ name: "live-seat", usage: USAGE, options: OPTIONS, positionals: [1, 1000] }, main);
}
