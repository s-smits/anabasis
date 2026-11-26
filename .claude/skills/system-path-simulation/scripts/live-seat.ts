#!/usr/bin/env bun
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { EXAMINE } from "#src/campaign/admission.ts";
import { gateAnswers, measuredGate } from "#tools/wri/gate-era.ts";
import type { drafting as Drafting } from "#src/examiner/draft.ts";
import type { writing as Writing } from "#src/examiner/write.ts";
import type { draftCommand as DraftCommand } from "#tools/eval/draft.ts";
import type { examineCommand as ExamineCommand } from "#tools/eval/examine.ts";
import type { solved as Solved } from "#tools/campaign/round.ts";
import { LOG_FILE, type LogEvent, read } from "#src/kernel/log.ts";
import { GAP_FLOOR } from "#src/kernel/compare.ts";
import { type Call, callsOf, tracesIn } from "#src/kernel/trace.ts";
import { billedBetween } from "#src/kernel/meter.ts";
import { heldAtGate } from "#src/kernel/task.ts";
import { existsSync, openSync, readFileSync, readdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import { gitText } from "#src/meta/git.ts";
import { capturedJsonParse, capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { type JsonObject, asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import { capturedExecPath, capturedSpawn, runtimeProcess } from "#src/meta/process.ts";
import { processGroupExists } from "#src/meta/subprocess.ts";
import { BUILDER, DRAFT, processes, ROUND, SEED_FILE } from "#tools/runs/registry.ts";
import { codeLine, seedCut } from "#tools/runs/seed.ts";
import { seats as seatFlags } from "#tools/runs/fresh.ts";
import { loginEnv } from "#tools/runs/manage.ts";
import { logAcross } from "#tools/runs/snapshots.ts";
import { release, stopProcessTree } from "#tools/runs/stop.ts";

const USAGE = `usage:
  live-seat.ts start --tree <worktree> --name sim-<what> --out <prefix> --cap <dollars> --minutes <n>
    [--login N] [--model <one>|<b>,<e>,<r>,<s>] [--effort <lmhx x4>] [--mention <text>]... -- <command> <its flags>
  live-seat.ts read --seat <prefix> | --log <path> --from <event> [--mention <text>]... [--json]
  live-seat.ts watch --seat <prefix>
  live-seat.ts due <prefix>... [--hook]
  live-seat.ts stop <prefix>...
  live-seat.ts compare <prefix>... [--gates N]
  live-seat.ts pairs <control>,<arm>... [--gates N]
  live-seat.ts calls <log or campaign folder>...
  live-seat.ts prompt --tree <worktree> --name sim-<what> -- tools/eval/examine.ts|draft.ts <its flags>

start runs <command> with --name in <tree>, on a seed only, and prints the reading when it ends.
watch prints one line for each event worth reading as it lands, until the seat's process is gone.
due prints what landed in each seat since due last looked; with --hook it writes that to stderr and
exits 2 when there is any, as a Claude Code Stop hook keeps the session from stopping.
stop ends each running seat's process group, and its start then prints the reading; a prefix not
seated yet is closed, and start refuses it.
compare prints each seat's counts in a column, each cut after its first N task admissions with --gates.
pairs reads each pair of seats, a control and an arm on the same seed cut under the same models, at
the shorter arm's count of task admissions (or N), and counts for each Examiner model in how many pairs the arm
did more, fewer or as many; a pair under 6 task admissions is marked thin and left out of that count.
calls counts the Examiner's tool calls, failed calls by tool and kind, and finishes the session
went on after, over every log named, a seed's from its cut, each call once however many logs hold it.
prompt prints the system prompt, opening, tools and nudges the Examiner or draft command would seat, and
seats nothing.`;
const OPTIONS = {
  tree: "abs",
  name: "text",
  out: "abs",
  cap: "text",
  minutes: "int",
  login: "text",
  model: "text",
  effort: "text",
  seat: "abs",
  log: "abs",
  from: "int",
  mention: "list",
  json: "flag",
  hook: "flag",
  gates: "int",
} as const;
const TICK_MS = 30_000;
const QUIET_TICKS = 10;
const GAP = `gap >= ${String(GAP_FLOOR * 100)}%`;
const ERROR_LINE = /error|denied|not found|no such|not permitted|timed out|refused|invalid|cannot|failed/iu;
const SEATED = ["--examiner", "--examiner-effort", "--reviewer", "--reviewer-effort"] as const;
const THIN = 6;
const WRAPPER_GRACE_MS = 30_000;

interface Reading {
  readonly events: readonly [number, number];
  readonly minutes: number;
  readonly billed: number;
  readonly sessions: readonly string[];
  readonly ended: readonly string[];
  readonly drafted: number;
  readonly audits: Readonly<Record<string, number>>;
  readonly frozen: number;
  readonly comparisons: readonly string[];
  readonly reported: number;
  readonly solves: { readonly started: number; readonly finished: number };
  readonly rulings: Readonly<Record<string, number>>;
  readonly proposed: number;
  readonly gates: Readonly<Record<string, number>>;
  readonly held: number;
  readonly ran: readonly number[];
  readonly gaps: readonly number[];
  readonly turns: readonly [number, number, number] | null;
  readonly calls: Readonly<Record<string, number>>;
  readonly mentions: Readonly<Record<string, number>>;
}

const objectiveGaps = (gaps: readonly number[]) => gaps.filter((gap) => gap >= GAP_FLOOR).length;

const MEASURES: readonly (readonly [string, (reading: Reading) => number | null])[] = [
  ["held", ({ held }) => held],
  ["room on validity", ({ gates }) => (gates.some ?? 0) + (gates["none, proved"] ?? 0)],
  [GAP, ({ gaps }) => objectiveGaps(gaps)],
  ["median turns", ({ turns }) => turns?.[1] ?? null],
];

function admissionWord(data: JsonObject): string {
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

const hasDraftActivity = ({ drafted, audits, frozen }: Pick<Reading, "drafted" | "audits" | "frozen">) =>
  drafted > 0 || Object.keys(audits).length > 0 || frozen > 0;
const hasComparisonActivity = ({ comparisons, reported }: Pick<Reading, "comparisons" | "reported">) =>
  comparisons.length > 0 || reported > 0;

export function readingOf(events: readonly LogEvent[], from: number, mentions: readonly string[]): Reading {
  const stretch = events.slice(from);
  const kinds = (...names: string[]) => stretch.flatMap((e) => (names.includes(e.kind) ? [e.data] : []));
  const strings = (rows: readonly JsonObject[], key: string) =>
    rows.flatMap((row) => (isString(row[key]) ? [row[key]] : []));
  const byKey = (rows: readonly JsonObject[], key: string) =>
    countBy(rows, (row) => (isString(row[key]) ? row[key] : "unknown"));
  const admissions = kinds("task.gate");
  const traces = tracesIn(stretch);
  const calls = [...callsOf(traces, "exam"), ...callsOf(traces, "draft")];
  const [first, last] = [stretch[0]?.at, stretch.at(-1)?.at];
  const turns = [...gateAnswers(events, from - 1).values()].flatMap((answers) =>
    answers.flatMap(({ turns: used }) => (used === null ? [] : [used])),
  );
  const comparisons = strings(kinds("comparison.started"), "session");
  const compIds = new Set(comparisons);
  const compSolves = new Set(
    kinds("solve.started").flatMap(({ solve, comparison }) =>
      isString(solve) && isString(comparison) && compIds.has(comparison) ? [solve] : [],
    ),
  );
  return {
    events: [from, events.length],
    minutes: first === undefined || last === undefined ? 0 : (Date.parse(last) - Date.parse(first)) / 60_000,
    billed: billedBetween(events, from),
    sessions: strings(kinds("exam.started", "draft.started"), "session"),
    ended: strings(kinds("exam.finished", "draft.finished"), "ended"),
    drafted: kinds("exam.drafted").length,
    audits: byKey(kinds("referee.draft"), "verdict"),
    frozen: kinds("contract.frozen").length,
    comparisons,
    reported: kinds("comparison.reported").length,
    solves: {
      started: compSolves.size,
      finished: kinds("solve.finished").filter(({ solve }) => isString(solve) && compSolves.has(solve))
        .length,
    },
    rulings: byKey(kinds("referee.finding"), "ruling"),
    proposed: kinds("task.proposed").length,
    gates: countBy(admissions, admissionWord),
    held: admissions.filter(({ outcome }) => heldAtGate(outcome)).length,
    ran: admissions.flatMap(({ reference }) => {
      const { ran, solves } = asRecord(reference) ?? {};
      const count = ran ?? solves;
      return isNumber(count) && count > 0 ? [count] : [];
    }),
    turns: spread(turns),
    gaps: admissions.flatMap(({ reference }) => {
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

export function told(reading: Reading): string[] {
  const { turns, solves } = reading;
  return [
    `events ${String(reading.events[0])} to ${String(reading.events[1])}, ${reading.minutes.toFixed(0)} min, $${reading.billed.toFixed(2)} billed`,
    `sessions ${reading.sessions.join(", ") || "none"}; ended ${reading.ended.join(", ") || "none yet"}`,
    ...(hasDraftActivity(reading)
      ? [
          `exam drafted ${String(reading.drafted)}, audits ${listed(reading.audits)}, frozen ${String(reading.frozen)}`,
        ]
      : []),
    ...(hasComparisonActivity(reading)
      ? [
          `comparisons ${reading.comparisons.join(", ") || "none"} (reported ${String(reading.reported)}), solves ${String(solves.finished)}/${String(solves.started)}, rulings ${listed(reading.rulings)}`,
        ]
      : []),
    `drafts proposed ${String(reading.proposed)}, task admissions ${listed(reading.gates)}; held ${String(reading.held)}`,
    `task admission ran ${String(reading.ran.reduce((sum, count) => sum + count, 0))} solves over ${String(reading.ran.length)} drafts${reading.ran.length === 0 ? "" : `: ${reading.ran.join(", ")}`}`,
    `the reference's valid room-solve answers took ${turns === null ? "no turns on record" : `${String(turns[0])} to ${String(turns[2])} turns, median ${String(turns[1])}`}`,
    `calls ${listed(reading.calls)}`,
    ...Object.entries(reading.mentions).map(([text, count]) => `calls naming ${text}: ${String(count)}`),
  ];
}

const SIMPLE_NEWS = new Map<string, string>([
  ["exam.drafted", "exam drafted"],
  ["referee.draft.refused", "draft audit refused"],
  ["contract.frozen", "contract frozen"],
]);

export function newsOf(events: readonly LogEvent[], from: number): string[] {
  const text = (value: unknown) => (isString(value) ? value : JSON.stringify(value));
  return events.slice(from).flatMap(({ kind, data }) => {
    const simple = SIMPLE_NEWS.get(kind);
    if (simple !== undefined) return [simple];
    if (kind === "task.gate") {
      const ran = asRecord(data.reference)?.ran;
      return [
        `gate ${text(data.outcome)}, ${admissionWord(data)}${isNumber(ran) ? `, ${plural(ran, "solve")} ran` : ""}`,
      ];
    }
    if (kind === "referee.draft") {
      return [`draft audit ${text(data.verdict)}${isNumber(data.pass) ? ` pass ${String(data.pass)}` : ""}`];
    }
    if (kind === "referee.finding") return [`ruling ${text(data.ruling)} on ${text(data.solve)}`];
    if (kind === "referee.refused") return [`ruling refused on ${text(data.solve)}`];
    if (kind === "comparison.reported") return [`${text(data.session)} reported ${text(data.reading)}`];
    return kind.endsWith(".finished") && kind !== "solve.finished"
      ? [`${text(data.session)} ended ${text(data.ended)}`]
      : [];
  });
}

export function censusOf(logs: readonly (readonly LogEvent[])[]) {
  const calls = new Map<string, Call>();
  const wentOn = new Set<string>();
  const sessions = new Set<string>();
  const key = ({ at, index }: { at: string; index: number }) => `${at} ${String(index)}`;
  for (const events of logs) {
    const own = callsOf(tracesIn(events), "exam");
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

function seedLog(tree: string, name: string, die: CommandArgs["die"]): string {
  const folder = join(tree, ".ana", "d2", name);
  if (!name.startsWith("sim-") || !existsSync(join(folder, SEED_FILE))) {
    die(`${folder} is no seed: a seat runs on sim-<what> with ${SEED_FILE} beside its log`);
  }
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

interface SeatWatch {
  readonly pid: number;
  readonly log: string;
  readonly from: number;
  readonly cap: number;
  readonly minutes: number;
}

async function watchSeat({ pid, log, from, cap, minutes }: SeatWatch): Promise<string | null> {
  const began = Date.now();
  let [seen, quiet] = [from, 0];
  let stopped: string | null = null;
  while (processGroupExists(pid)) {
    for (let slept = 0; slept < TICK_MS && processGroupExists(pid); slept += 1000) await Bun.sleep(1000);
    const events = read(log);
    const [billed, elapsed, news] = [
      billedBetween(events, from),
      (Date.now() - began) / 60_000,
      newsOf(events, seen),
    ];
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
      await stopProcessTree(pid);
    }
  }
  return stopped;
}

async function start(args: CommandArgs, command: readonly string[]): Promise<number> {
  const [tree, name, out, cap] = [
    args.required("tree"),
    args.required("name"),
    args.required("out"),
    Number(args.required("cap")),
  ];
  const minutes = args.int("minutes") ?? args.die("--minutes is required");
  if (!Number.isFinite(cap) || cap <= 0) args.die("--cap is a number of dollars above 0");
  if (command.length === 0) args.die("name the command after --");
  const closed = existsSync(`${out}.stopped`) ? readFileSync(`${out}.stopped`, "utf8") : "";
  if (closed !== "") args.die(`${out} was stopped (${closed}): its round is read; seat under another --out`);
  const stretch = command[0]?.endsWith(BUILDER) === true;
  if (
    stretch &&
    command.some((one) => /^--(?:builder|examiner|reviewer|solver)(?:-effort)?(?:=|$)/u.test(one))
  ) {
    args.die("a stretch names its seats with --model and --effort alone, as runs fresh does");
  }
  const model = stretch
    ? (args.value("model") ??
      args.die("name --model: one model, or four (Builder, Examiner, Referee, solver)"))
    : null;
  const seated = model === null ? [] : seatFlags(model, args.value("effort") ?? undefined).seated;
  const log = seedLog(tree, name, args.die);
  console.log(codeLine(tree, dirname(log)));
  const from = read(log).length;
  const env = { ...loginEnv(runtimeProcess.env, args.value("login") ?? undefined), ANA_CHECK_HOST: "here" };
  const child = capturedSpawn(["nice", "-n", "10", capturedExecPath, ...command, ...seated, "--name", name], {
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
    `${capturedJsonStringify({ tree, name, commit, command, from, pid: child.pid, wrapper: runtimeProcess.pid, at: new Date().toISOString() }, null, 2)}\n`,
  );
  console.log(`${name} at ${commit}: pid ${String(child.pid)}, from event ${String(from)}; ${out}.err`);
  const stopped =
    (await watchSeat({ pid: child.pid, log, from, cap, minutes })) ??
    (readFileSync(`${out}.stopped`, "utf8") || null);
  if (stopped !== null) {
    await release({ name, tree, path: log, end: "comparison.reported", seed: true }, processes(), "release");
  }
  console.log(stopped === null ? `${name} ended by itself` : `${name} stopped at ${stopped}`);
  console.log(told(readingOf(read(log), from, args.list("mention"))).join("\n"));
  return stopped === null ? 0 : 1;
}

const cutOf = (log: string) => (existsSync(join(dirname(log), SEED_FILE)) ? seedCut(dirname(log)) : null);

function keptSeat(seat: string, die: CommandArgs["die"]) {
  const kept = asRecord(capturedJsonParse(readFileSync(`${seat}.json`, "utf8")));
  const { tree, name, from, pid, wrapper, commit, command } = kept ?? {};
  if (!isString(tree) || !isString(name) || !isNumber(from)) die(`${seat}.json is no seat start kept`);
  return {
    log: join(tree, ".ana", "d2", name, LOG_FILE),
    from,
    pid: isNumber(pid) ? pid : null,
    wrapper: isNumber(wrapper) ? wrapper : null,
    commit: isString(commit) ? commit : "?",
    command: Array.isArray(command) ? command.filter(isString) : [],
  };
}

async function watch(args: CommandArgs): Promise<number> {
  const { log, from, pid } = keptSeat(args.required("seat"), args.die);
  let upTo = from;
  for (;;) {
    const events = read(log);
    for (const line of newsOf(events, upTo)) console.log(line);
    upTo = events.length;
    if (pid === null || !processGroupExists(pid)) break;
    await Bun.sleep(TICK_MS);
  }
  console.log(told(readingOf(read(log), from, [])).join("\n"));
  return 0;
}

function due(args: CommandArgs, seats: readonly string[]): number {
  if (seats.length === 0) args.die("name the seats' prefixes");
  const lines = seats.flatMap((seat) => {
    const { log, from } = keptSeat(seat, args.die);
    const seen = existsSync(`${seat}.seen`) ? Number(readFileSync(`${seat}.seen`, "utf8")) : from;
    const events = read(log);
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

async function stop(args: CommandArgs, seats: readonly string[]): Promise<number> {
  if (seats.length === 0) args.die("name the seats' prefixes");
  let missed = 0;
  for (const seat of seats) {
    if (!existsSync(`${seat}.json`)) {
      writeFileSync(`${seat}.stopped`, "live-seat stop, before it was seated");
      console.log(`${basename(seat)} closed before it was seated: start refuses it`);
      continue;
    }
    const { pid, wrapper } = keptSeat(seat, args.die);
    if (pid === null || !processGroupExists(pid)) {
      console.error(
        `${basename(seat)} has no process group running on this host: it ended, or runs elsewhere`,
      );
      missed += 1;
      continue;
    }
    writeFileSync(`${seat}.stopped`, "live-seat stop");
    await stopProcessTree(pid);
    const starter = wrapper ?? 0;
    for (let waited = 0; waited < WRAPPER_GRACE_MS && processGroupExists(starter); waited += 1000) {
      await Bun.sleep(1000);
    }
    const lingered = processGroupExists(starter);
    if (lingered) runtimeProcess.kill(starter, "SIGTERM");
    console.log(
      `${basename(seat)} stopped${lingered ? `, and its start (pid ${String(starter)}) ended` : ""}`,
    );
  }
  return missed === 0 ? 0 : 1;
}

const admissionsFrom = (events: readonly LogEvent[], from: number) =>
  events.flatMap((event, index) => (index >= from && event.kind === "task.gate" ? [index] : []));

function cutAt(
  events: readonly LogEvent[],
  from: number,
  admissionLimit: number | null,
): readonly LogEvent[] {
  const last = admissionLimit === null ? undefined : admissionsFrom(events, from)[admissionLimit - 1];
  return last === undefined ? events : events.slice(0, last + 1);
}

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

function compare(args: CommandArgs, seats: readonly string[]): number {
  if (seats.length < 2) args.die("name two seats' prefixes or more");
  const admissionLimit = args.int("gates");
  const readings = seats.map((seat) => {
    const { log, from, commit } = keptSeat(seat, args.die);
    return { seat, commit, reading: readingOf(cutAt(read(log), from, admissionLimit), from, []) };
  });
  const each = (row: (reading: Reading) => number | string) =>
    readings.map(({ reading }) => String(row(reading)));
  const perHeld = (reading: Reading) =>
    reading.held === 0 ? "none held" : `$${(reading.billed / reading.held).toFixed(2)}`;
  const countRows = (prefix: string, pick: (reading: Reading) => Readonly<Record<string, number>>) =>
    [...new Set(readings.flatMap(({ reading }) => Object.keys(pick(reading))))]
      .toSorted()
      .map((key): [string, readonly string[]] => [`${prefix}${key}`, each((r) => pick(r)[key] ?? 0)]);
  const ifRows = (show: boolean, list: [string, readonly string[]][]) => (show ? list : []);
  const rows: [string, readonly string[]][] = [
    ["seat", readings.map(({ seat }) => basename(seat))],
    ["commit", readings.map(({ commit }) => commit)],
    ["minutes", each((r) => r.minutes.toFixed(0))],
    ["billed", each((r) => `$${r.billed.toFixed(2)}`)],
    ...ifRows(
      readings.some(({ reading }) => hasDraftActivity(reading)),
      [
        ["exam drafted", each((r) => r.drafted)],
        ...countRows("  audit ", (r) => r.audits),
        ["frozen", each((r) => r.frozen)],
      ],
    ),
    ...ifRows(
      readings.some(({ reading }) => hasComparisonActivity(reading)),
      [
        ["solves", each(({ solves }) => `${String(solves.finished)}/${String(solves.started)}`)],
        ["reported", each((r) => r.reported)],
        ...countRows("  ruling ", (r) => r.rulings),
      ],
    ),
    ["proposed", each((r) => r.proposed)],
    ["gated", each((r) => r.ran.length)],
    ...countRows("  ", (r) => r.gates),
    ["held", each((r) => r.held)],
    ["per held", each(perHeld)],
    ["room solves", each((r) => r.ran.reduce((sum, count) => sum + count, 0))],
    ["median turns", each((r) => r.turns?.[1] ?? "none")],
    [GAP, each(({ gaps }) => `${String(objectiveGaps(gaps))} of ${String(gaps.length)}`)],
    [
      "median gap",
      each(({ gaps }) => {
        const mid = spread(gaps)?.[1];
        return mid === undefined ? "none" : `${(mid * 100).toFixed(2)}%`;
      }),
    ],
  ];
  if (admissionLimit !== null) {
    console.log(`each cut after its first ${plural(admissionLimit, "task admission")}`);
  }
  console.log(columns(rows.map(([label, cells]) => [label, ...cells])).join("\n"));
  return 0;
}

function pairOf(spec: string, admissionLimit: number | null, die: CommandArgs["die"]) {
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
  const admissionCount = ({ events, from }: typeof arm) => admissionsFrom(events, from).length;
  const cut = Math.min(admissionLimit ?? Infinity, admissionCount(control), admissionCount(arm));
  const readAt = ({ events, from }: typeof arm) => readingOf(cutAt(events, from, cut), from, []);
  return {
    name: `${control.seat},${arm.seat}`,
    model: arm.who.split(" ").slice(0, 2).join(" "),
    cut,
    before: readAt(control),
    after: readAt(arm),
  };
}

function pairs(args: CommandArgs, specs: readonly string[]): number {
  if (specs.length === 0) args.die("name each pair as <control>,<arm>");
  const readPairs = specs.map((spec) => pairOf(spec, args.int("gates"), args.die));
  const shown = (value: number | null) => (value === null ? "none" : String(value));
  const perAdmission = (billed: number, admissions: number) =>
    admissions === 0 ? "none" : `$${(billed / admissions).toFixed(2)}`;
  const rows = readPairs.map(({ name, model, cut, before, after }) => [
    name,
    model,
    cut < THIN ? `${String(cut)} thin` : String(cut),
    ...MEASURES.map(([, of]) => `${shown(of(before))} / ${shown(of(after))}`),
    `${perAdmission(before.billed, cut)} / ${perAdmission(after.billed, cut)}`,
  ]);
  console.log(
    columns([
      ["pair", "examiner", "task admissions", ...MEASURES.map(([label]) => label), "$ per task admission"],
      ...rows,
    ]).join("\n"),
  );
  for (const model of new Set(readPairs.map((pair) => pair.model))) {
    const own = readPairs.filter((pair) => pair.model === model && pair.cut >= THIN);
    const thin = readPairs.filter((pair) => pair.model === model && pair.cut < THIN).map(({ name }) => name);
    const signs = MEASURES.map(([label, of]) => {
      const moved = own.flatMap(({ before, after }) => {
        const [was, is] = [of(before), of(after)];
        return was === null || is === null ? [] : [Math.sign(is - was)];
      });
      const count = (sign: number) => String(moved.filter((each) => each === sign).length);
      return [`  ${label}`, `more in ${count(1)}, fewer in ${count(-1)}, the same in ${count(0)}`];
    });
    const sum = (side: "before" | "after") => own.reduce((total, pair) => total + pair[side].billed, 0);
    const admitted = own.reduce((total, { cut }) => total + cut, 0);
    console.log(
      `\n${model}, the arm against its control over ${plural(own.length, "pair")} of ${String(THIN)} task admissions or more:`,
    );
    const dollars = `${perAdmission(sum("before"), admitted)} against ${perAdmission(sum("after"), admitted)}`;
    console.log(columns([...signs, ["  $ per task admission", dollars]]).join("\n"));
    if (thin.length > 0) console.log(`  thin, not counted: ${thin.join(" ")}`);
  }
  return 0;
}

async function prompt(args: CommandArgs, command: readonly string[]): Promise<number> {
  const [tree, name, [script, ...flags]] = [args.required("tree"), args.required("name"), command];
  if (script !== EXAMINE && script !== DRAFT) {
    args.die(`prompt composes an Examiner or draft session: -- ${EXAMINE} | ${DRAFT}`);
  }
  const log = seedLog(tree, name, args.die);
  const before = read(log).length;
  const show = (mode: ReturnType<typeof Writing> | ReturnType<typeof Drafting>): never => {
    console.log(`=== SYSTEM\n${mode.system}\n\n=== OPENING\n${mode.opening}`);
    for (const tool of mode.tools) console.log(`\n=== TOOL ${tool.name}\n${tool.description}`);
    console.log(
      `\n=== NUDGE ${mode.nudge}\n=== FINISH ${mode.finish}\n=== DECLINED ${String(mode.declined)}`,
    );
    if (read(log).length !== before) {
      console.error(`${name}: composing wrote ${String(read(log).length - before)} events`);
    }
    return runtimeProcess.exit(0);
  };
  runtimeProcess.chdir(tree);
  if (script === DRAFT) {
    // SAFETY: targets current Anabasis trees exporting `drafting(terms, within, home?)`.
    const [{ draftCommand }, { drafting }] = (await Promise.all([
      import(join(tree, script)),
      import(join(tree, "src/examiner/draft.ts")),
    ])) as [{ draftCommand: typeof DraftCommand }, { drafting: typeof Drafting }];
    await draftCommand(
      [...flags, "--name", name],
      (request) => show(drafting(request, async (action) => await action(), undefined)),
      null,
    );
    return 0;
  }
  // SAFETY: these paths are modules of an Anabasis tree; a tree whose signatures differ fails below.
  const [{ examineCommand }, { writing }, { solved }] = (await Promise.all([
    import(join(tree, script)),
    import(join(tree, "src/examiner/write.ts")),
    import(join(tree, ROUND)),
  ])) as [{ examineCommand: typeof ExamineCommand }, { writing: typeof Writing }, { solved: typeof Solved }];
  // SAFETY: a tree before v0.14 takes its seats third, and the session exits before its first turn.
  await (examineCommand as (...given: unknown[]) => Promise<void>)(
    [...flags, "--name", name],
    (request: Parameters<typeof Writing>[0]) => show(writing(request, undefined)),
    solved,
  );
  return 0;
}

async function census(args: CommandArgs, named: readonly string[]): Promise<number> {
  if (named.length === 0) args.die("name the logs or campaign folders to count");
  const logs: LogEvent[][] = [];
  for (const each of named) {
    const log = await logAcross(each);
    if (!existsSync(log)) args.die(`${log} does not exist`);
    logs.push(read(log).slice(cutOf(log) ?? 0));
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
  const seat = args.value("seat");
  if (seat !== null && (args.value("log") !== null || args.int("from") !== null)) {
    args.die("name a seat, or a log and an event, not both");
  }
  const stretch =
    seat === null
      ? (() => {
          const log = args.required("log");
          const from =
            args.int("from") ??
            cutOf(log) ??
            args.die("--from is required with --log outside a seed: the event the seat began at");
          return { log, from };
        })()
      : keptSeat(seat, args.die);
  const log = await logAcross(stretch.log);
  if (!existsSync(log)) args.die(`${log} does not exist`);
  const result = readingOf(read(log), stretch.from, args.list("mention"));
  console.log(args.flag("json") ? capturedJsonStringify(result, null, 2) : told(result).join("\n"));
  return 0;
}

const VERBS = {
  start,
  watch: (args: CommandArgs) => watch(args),
  due,
  stop,
  compare,
  pairs,
  calls: census,
  prompt,
  read: (args: CommandArgs, command: readonly string[]) => {
    if (command.length > 0) args.die("read takes no command");
    return readCommand(args);
  },
} satisfies Record<string, (args: CommandArgs, command: readonly string[]) => Promise<number> | number>;

async function main(args: CommandArgs): Promise<number> {
  const [verb, ...command] = args.positionals;
  const run = Object.entries(VERBS).find(([name]) => name === verb)?.[1];
  if (run !== undefined) return run(args, command);
  return args.die(
    `the verb is start, read, watch, due, stop, compare, pairs, calls or prompt, not ${verb ?? "none"}`,
  );
}

if (import.meta.main) {
  await runCommand({ name: "live-seat", usage: USAGE, options: OPTIONS, positionals: [1, 1000] }, main);
}
