#!/usr/bin/env bun
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import type { applyContinuation as ApplyContinuation } from "#src/agent/session.ts";
import { EXAMINE } from "#src/campaign/admission.ts";
import type { drafting as Drafting } from "#src/examiner/draft.ts";
import type { writing as Writing } from "#src/examiner/write.ts";
import type { draftCommand as DraftCommand } from "#tools/eval/draft.ts";
import type { examineCommand as ExamineCommand } from "#tools/eval/examine.ts";
import type { solved as Solved } from "#tools/campaign/round.ts";
import { LOG_FILE, type LogEvent, read } from "#src/kernel/log.ts";
import { type Call, callsOf, tracesIn } from "#src/kernel/trace.ts";
import { billedBetween } from "#src/kernel/meter.ts";
import { heldAtGate } from "#src/kernel/task.ts";
import {
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { gitText } from "#src/meta/git.ts";
import { capturedJsonParse, capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { type JsonObject, asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { availableParallelism, loadavg } from "#src/meta/os.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import { capturedExecPath, capturedSpawn, runtimeProcess } from "#src/meta/process.ts";
import { processGroupExists } from "#src/meta/subprocess.ts";
import { BUILDER, DRAFT, ROUND, SEED_FILE, processes } from "#tools/runs/registry.ts";
import { codeLine, seedCut } from "#tools/runs/seed.ts";
import { seats as seatFlags } from "#tools/runs/fresh.ts";
import { loginEnv } from "#tools/runs/manage.ts";
import { logAcross } from "#tools/runs/snapshots.ts";
import { release, stopProcessTree } from "#tools/runs/stop.ts";

const USAGE = `usage:
  live-seat.ts start --tree <worktree> --name sim-<what> --out <prefix> --cap <dollars> --minutes <n>
    [--login N] [--model <one>|<b>,<e>,<r>,<s>] [--effort <lmhx x4>] [--mention <text>]... -- <command> <its flags>
  live-seat.ts read --seat <prefix> | --log <path> --from <event> [--mention <text>]... [--json]
  live-seat.ts stop <prefix>...
  live-seat.ts compare <prefix>... [--gates N]
  live-seat.ts pairs <control>,<arm>... [--gates N]
  live-seat.ts calls <log or campaign folder>...
  live-seat.ts prompt --tree <worktree> --name sim-<what> -- tools/eval/examine.ts|draft.ts <its flags>`;

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
  gates: "int",
} as const;
const POLL_MS = 5000;
const QUIET_TICKS = 60;
const ERROR_LINE = /error|denied|not found|no such|not permitted|timed out|refused|invalid|cannot|failed/iu;
const SEATED = ["--examiner", "--examiner-effort", "--reviewer", "--reviewer-effort"] as const;
const THIN = 6;
const WRAPPER_GRACE_MS = 30_000;
const SESSION_STARTS = new Set<string>(["exam.started", "draft.started", "build.started"]);
const SESSION_ENDS = new Set<string>(["exam.finished", "draft.finished", "build.finished"]);

interface Reading {
  readonly events: readonly [number, number];
  readonly minutes: number;
  readonly billed: number;
  readonly sessions: readonly string[];
  readonly ended: readonly string[];
  readonly drafted: number;
  readonly audits: Readonly<Record<string, number>>;
  readonly frozen: number;
  readonly checkpoints: number;
  readonly practice: { readonly started: number; readonly finished: number };
  readonly promotions: number;
  readonly reverts: number;
  readonly campaignEnded: readonly string[];
  readonly comparisons: readonly string[];
  readonly reported: number;
  readonly solves: { readonly started: number; readonly finished: number };
  readonly rulings: Readonly<Record<string, number>>;
  readonly proposed: number;
  readonly gates: Readonly<Record<string, number>>;
  readonly held: number;
  readonly calls: Readonly<Record<string, number>>;
  readonly mentions: Readonly<Record<string, number>>;
}

const MEASURES: readonly (readonly [string, (reading: Reading) => number | null])[] = [
  ["held", ({ held }) => held],
  ["proposed", ({ proposed }) => proposed],
];

const admissionWord = (data: JsonObject): string => (isString(data.outcome) ? data.outcome : "unknown");

const hasDraft = (r: Reading) => r.drafted > 0 || Object.keys(r.audits).length > 0 || r.frozen > 0;
const hasBuild = (r: Reading) =>
  r.checkpoints > 0 || r.practice.started > 0 || r.promotions > 0 || r.reverts > 0;
const hasComp = (r: Reading) => r.comparisons.length > 0 || r.reported > 0;
const hasExam = (r: Reading) => r.proposed > 0 || Object.keys(r.gates).length > 0 || r.held > 0;
const ratio = ({ finished, started }: { readonly finished: number; readonly started: number }) =>
  `${String(finished)}/${String(started)}`;
const shortDigest = (value: unknown) => (isString(value) ? value.slice(0, 8) : "?");

export function readingOf(events: readonly LogEvent[], from: number, mentions: readonly string[]): Reading {
  const stretch = events.slice(from);
  const of = (kind: string) => stretch.flatMap((event) => (event.kind === kind ? [event.data] : []));
  const admissions = of("task.gate");
  const traces = tracesIn(stretch);
  const calls = [...callsOf(traces, "exam"), ...callsOf(traces, "draft"), ...callsOf(traces, "build")];
  const first = stretch[0]?.at;
  const last = stretch.at(-1)?.at;
  const comparisons = of("comparison.started").flatMap(({ session }) => (isString(session) ? [session] : []));
  const compIds = new Set(comparisons);
  const solveStarts = of("solve.started");
  const compSolves = new Set(
    solveStarts.flatMap(({ solve, comparison }) =>
      isString(solve) && isString(comparison) && compIds.has(comparison) ? [solve] : [],
    ),
  );
  const practiceSolves = new Set<string>();
  let openBuilds = 0;
  for (const { kind, data } of stretch) {
    if (kind === "build.started") openBuilds += 1;
    else if (kind === "build.finished") openBuilds = Math.max(0, openBuilds - 1);
    else if (
      kind === "solve.started" &&
      openBuilds > 0 &&
      isString(data.solve) &&
      !isString(data.comparison)
    ) {
      practiceSolves.add(data.solve);
    }
  }
  const finishedSolves = of("solve.finished");
  return {
    events: [from, events.length],
    minutes: first === undefined || last === undefined ? 0 : (Date.parse(last) - Date.parse(first)) / 60_000,
    billed: billedBetween(events, from),
    sessions: stretch.flatMap(({ kind, data }) =>
      SESSION_STARTS.has(kind) && isString(data.session) ? [data.session] : [],
    ),
    ended: stretch.flatMap(({ kind, data }) =>
      SESSION_ENDS.has(kind) && isString(data.ended) ? [data.ended] : [],
    ),
    drafted: of("exam.drafted").length,
    audits: countBy(of("referee.draft"), ({ verdict }) => (isString(verdict) ? verdict : "unknown")),
    frozen: of("contract.frozen").length,
    checkpoints: of("build.checkpoint").length,
    practice: {
      started: practiceSolves.size,
      finished: finishedSolves.filter(({ solve }) => isString(solve) && practiceSolves.has(solve)).length,
    },
    promotions: of("harness.promoted").length,
    reverts: of("harness.reverted").length,
    campaignEnded: of("campaign.ended").flatMap(({ ending }) => (isString(ending) ? [ending] : [])),
    comparisons,
    reported: of("comparison.reported").length,
    solves: {
      started: compSolves.size,
      finished: finishedSolves.filter(({ solve }) => isString(solve) && compSolves.has(solve)).length,
    },
    rulings: countBy(of("referee.finding"), ({ ruling }) => (isString(ruling) ? ruling : "unknown")),
    proposed: of("task.proposed").length,
    gates: countBy(admissions, admissionWord),
    held: admissions.filter(({ outcome }) => heldAtGate(outcome)).length,
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
  const builderLine = [
    `checkpoints ${String(reading.checkpoints)}`,
    `practice ${ratio(reading.practice)}`,
    ...(reading.promotions > 0 ? [`promoted ${String(reading.promotions)}`] : []),
    ...(reading.reverts > 0 ? [`reverted ${String(reading.reverts)}`] : []),
  ].join(", ");
  const lines = [
    `events ${String(reading.events[0])} to ${String(reading.events[1])}, ${reading.minutes.toFixed(0)} min, $${reading.billed.toFixed(2)} billed`,
    `sessions ${reading.sessions.join(", ") || "none"}; ended ${reading.ended.join(", ") || "none yet"}`,
  ];
  if (hasDraft(reading)) {
    lines.push(
      `exam drafted ${String(reading.drafted)}, audits ${listed(reading.audits)}, frozen ${String(reading.frozen)}`,
    );
  }
  if (hasBuild(reading)) lines.push(`builder ${builderLine}`);
  if (hasComp(reading)) {
    lines.push(
      `comparisons ${reading.comparisons.join(", ") || "none"} (reported ${String(reading.reported)}), solves ${ratio(reading.solves)}, rulings ${listed(reading.rulings)}`,
    );
  }
  if (hasExam(reading)) {
    lines.push(
      `drafts proposed ${String(reading.proposed)}, task admissions ${listed(reading.gates)}; held ${String(reading.held)}`,
    );
  }
  if (reading.campaignEnded.length > 0) lines.push(`campaign ended ${reading.campaignEnded.join(", ")}`);
  lines.push(`calls ${listed(reading.calls)}`);
  for (const [text, count] of Object.entries(reading.mentions)) {
    lines.push(`calls naming ${text}: ${String(count)}`);
  }
  return lines;
}

const textOf = (value: unknown) => (isString(value) ? value : JSON.stringify(value));

const NEWS = {
  "task.gate": (data: JsonObject) => {
    const ran = asRecord(data.reference)?.ran;
    return `gate ${textOf(data.outcome)}, ${admissionWord(data)}${isNumber(ran) ? `, ${plural(ran, "solve")} ran` : ""}`;
  },
  "exam.drafted": () => "exam drafted",
  "referee.draft": (data: JsonObject) =>
    `draft audit ${textOf(data.verdict)}${isNumber(data.pass) ? ` pass ${String(data.pass)}` : ""}`,
  "referee.draft.refused": () => "draft audit refused",
  "contract.frozen": () => "contract frozen",
  "build.checkpoint": (data: JsonObject) => `checkpoint ${shortDigest(data.harness)}`,
  "harness.promoted": (data: JsonObject) => `promoted ${shortDigest(data.harness)}`,
  "harness.reverted": (data: JsonObject) => `reverted to ${shortDigest(data.harness)}`,
  "referee.finding": (data: JsonObject) => `ruling ${textOf(data.ruling)} on ${textOf(data.solve)}`,
  "referee.refused": (data: JsonObject) => `ruling refused on ${textOf(data.solve)}`,
  "comparison.reported": (data: JsonObject) => `${textOf(data.session)} reported ${textOf(data.reading)}`,
  "campaign.ended": (data: JsonObject) => `campaign ended ${textOf(data.ending)}`,
} satisfies Readonly<Record<string, (data: JsonObject) => string>>;

export function newsOf(events: readonly LogEvent[], from: number): string[] {
  return events.slice(from).flatMap(({ kind, data }) => {
    const format = Object.entries(NEWS).find(([key]) => key === kind)?.[1];
    if (format !== undefined) return [format(data)];
    return SESSION_ENDS.has(kind) ? [`${textOf(data.session)} ended ${textOf(data.ended)}`] : [];
  });
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

async function releaseSeed(tree: string, name: string, log: string): Promise<void> {
  if (!existsSync(tree) || !existsSync(log) || !existsSync(join(dirname(log), SEED_FILE))) return;
  await release(
    { name, tree: realpathSync(tree), path: log, end: "comparison.reported", seed: true },
    processes(),
    "release",
  );
}

function resolveStartSeats(args: CommandArgs, command: readonly string[]): readonly string[] {
  const stretch = command[0]?.endsWith(BUILDER) === true;
  if (!stretch) return [];
  if (command.some((one) => /^--(?:builder|examiner|reviewer|solver)(?:-effort)?(?:=|$)/u.test(one))) {
    args.die("a stretch names its seats with --model and --effort alone, as runs fresh does");
  }
  const model =
    args.value("model") ?? args.die("name --model: one model, or four (Builder, Examiner, Referee, solver)");
  return seatFlags(model, args.value("effort") ?? undefined).seated;
}

async function start(args: CommandArgs, command: readonly string[]): Promise<number> {
  const tree = args.required("tree");
  const name = args.required("name");
  const out = args.required("out");
  const cap = Number(args.required("cap"));
  const minutes = args.int("minutes") ?? args.die("--minutes is required");
  if (!Number.isFinite(cap) || cap <= 0) args.die("--cap is a number of dollars above 0");
  if (command.length === 0) args.die("name the command after --");
  const closed = existsSync(`${out}.stopped`) ? readFileSync(`${out}.stopped`, "utf8") : "";
  if (closed !== "") args.die(`${out} was stopped (${closed}): its round is read; seat under another --out`);
  const seated = resolveStartSeats(args, command);
  const log = seedLog(tree, name, args.die);
  console.log(codeLine(tree, dirname(log)));
  const [load1 = 0] = loadavg();
  const cores = availableParallelism();
  if (load1 > cores) {
    console.log(`⚠ host 1m load ${load1.toFixed(1)} on ${String(cores)} cores: wall times may stretch`);
  }
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
  const began = Date.now();
  let seen = from;
  let lastSize = statSync(log).size;
  let billed = 0;
  let quiet = 0;
  let stopped: string | null = null;
  while (processGroupExists(child.pid)) {
    for (let slept = 0; slept < POLL_MS && processGroupExists(child.pid); slept += 1000) {
      await Bun.sleep(1000);
    }
    const size = statSync(log).size;
    let news: string[] = [];
    if (size !== lastSize) {
      lastSize = size;
      const events = read(log);
      billed = billedBetween(events, from);
      news = newsOf(events, seen);
      for (const line of news) console.log(`${line}, $${billed.toFixed(2)}`);
      seen = events.length;
    }
    quiet = news.length > 0 ? 0 : quiet + 1;
    const elapsed = (Date.now() - began) / 60_000;
    if (quiet >= QUIET_TICKS) {
      console.log(`${elapsed.toFixed(0)} min, $${billed.toFixed(2)}`);
      quiet = 0;
    }
    if (billed >= cap || elapsed > minutes) {
      stopped =
        billed >= cap
          ? `its cap, $${billed.toFixed(2)} of $${String(cap)}`
          : `its ${String(minutes)} minutes`;
      await stopProcessTree(child.pid);
    }
  }
  stopped ??= readFileSync(`${out}.stopped`, "utf8") || null;
  await releaseSeed(tree, name, log);
  console.log(stopped === null ? `${name} ended by itself` : `${name} stopped at ${stopped}`);
  console.log(told(readingOf(read(log), from, args.list("mention"))).join("\n"));
  return stopped === null ? 0 : 1;
}

const cutOf = (log: string) => (existsSync(join(dirname(log), SEED_FILE)) ? seedCut(dirname(log)) : null);

function stretchOf(args: CommandArgs): { readonly log: string; readonly from: number } {
  const seat = args.value("seat");
  if (seat === null) {
    const log = args.required("log");
    const from =
      args.int("from") ??
      cutOf(log) ??
      args.die("--from is required with --log outside a seed: the event the seat began at");
    return { log, from };
  }
  if (args.value("log") !== null || args.int("from") !== null) {
    args.die("name a seat, or a log and an event, not both");
  }
  return keptSeat(seat, args.die);
}

function keptSeat(seat: string, die: CommandArgs["die"]) {
  const kept = asRecord(capturedJsonParse(readFileSync(`${seat}.json`, "utf8")));
  const { tree, name, from, pid, wrapper, commit, command } = kept ?? {};
  if (!isString(tree) || !isString(name) || !isNumber(from)) die(`${seat}.json is no seat start kept`);
  return {
    tree,
    name,
    log: join(tree, ".ana", "d2", name, LOG_FILE),
    from,
    pid: isNumber(pid) ? pid : null,
    wrapper: isNumber(wrapper) ? wrapper : null,
    commit: isString(commit) ? commit : "?",
    command: Array.isArray(command) ? command.filter(isString) : [],
  };
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
    const { tree, name, log, pid, wrapper } = keptSeat(seat, args.die);
    if (pid === null || !processGroupExists(pid)) {
      console.error(
        `${basename(seat)} has no process group running on this host: it ended, or runs elsewhere`,
      );
      await releaseSeed(tree, name, log);
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
    await releaseSeed(tree, name, log);
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

type Row = readonly [string, readonly string[]];

function compareRows(
  readings: readonly { readonly seat: string; readonly commit: string; readonly reading: Reading }[],
): readonly Row[] {
  const row = (label: string, pick: (reading: Reading) => number | string): Row => [
    label,
    readings.map(({ reading }) => String(pick(reading))),
  ];
  const perHeld = ({ held, billed }: Reading) =>
    held === 0 ? "none held" : `$${(billed / held).toFixed(2)}`;
  const countRows = (prefix: string, pick: (reading: Reading) => Readonly<Record<string, number>>) =>
    [...new Set(readings.flatMap(({ reading }) => Object.keys(pick(reading))))]
      .toSorted()
      .map((key) => row(`${prefix}${key}`, (reading) => pick(reading)[key] ?? 0));
  const any = (predicate: (reading: Reading) => boolean) =>
    readings.some(({ reading }) => predicate(reading));
  const rows: Row[] = [
    ["seat", readings.map(({ seat }) => basename(seat))],
    ["commit", readings.map(({ commit }) => commit)],
    row("minutes", ({ minutes }) => minutes.toFixed(0)),
    row("billed", ({ billed }) => `$${billed.toFixed(2)}`),
  ];
  if (any(hasDraft)) {
    rows.push(
      row("exam drafted", ({ drafted }) => drafted),
      ...countRows("  audit ", ({ audits }) => audits),
      row("frozen", ({ frozen }) => frozen),
    );
  }
  if (any(hasBuild)) {
    rows.push(
      row("checkpoints", ({ checkpoints }) => checkpoints),
      row("practice", ({ practice }) => ratio(practice)),
      row("promoted", ({ promotions }) => promotions),
    );
    if (any(({ reverts }) => reverts > 0)) rows.push(row("reverted", ({ reverts }) => reverts));
  }
  if (any(hasComp)) {
    rows.push(
      row("solves", ({ solves }) => ratio(solves)),
      row("reported", ({ reported }) => reported),
      ...countRows("  ruling ", ({ rulings }) => rulings),
    );
  }
  if (any(hasExam)) {
    rows.push(
      row("proposed", ({ proposed }) => proposed),
      ...countRows("  ", ({ gates }) => gates),
      row("held", ({ held }) => held),
      row("per held", perHeld),
    );
  }
  if (any(({ campaignEnded }) => campaignEnded.length > 0)) {
    rows.push(row("ended", ({ campaignEnded }) => campaignEnded.join(", ") || "none"));
  }
  return rows;
}

function compare(args: CommandArgs, seats: readonly string[]): number {
  if (seats.length < 2) args.die("name two seats' prefixes or more");
  const admissionLimit = args.int("gates");
  const readings = seats.map((seat) => {
    const { log, from, commit } = keptSeat(seat, args.die);
    return { seat, commit, reading: readingOf(cutAt(read(log), from, admissionLimit), from, []) };
  });
  if (admissionLimit !== null) {
    console.log(`each cut after its first ${plural(admissionLimit, "task admission")}`);
  }
  console.log(columns(compareRows(readings).map(([label, cells]) => [label, ...cells])).join("\n"));
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

interface PrintableMode {
  readonly system: string;
  readonly opening: string;
  readonly tools: readonly {
    readonly name: string;
    readonly description: string;
    readonly parameters?: unknown;
  }[];
  readonly nudge: string;
  readonly finish: string;
  readonly declined: string | null;
}

function printMode(mode: PrintableMode, log: string, before: number, name: string): never {
  console.log(`=== SYSTEM\n${mode.system}\n\n=== OPENING\n${mode.opening}`);
  for (const tool of mode.tools) {
    console.log(`\n=== TOOL ${tool.name}\n${tool.description}`);
    if (tool.parameters !== undefined) {
      console.log(`=== SCHEMA ${tool.name}\n${capturedJsonStringify(tool.parameters, null, 2)}`);
    }
  }
  console.log(`\n=== NUDGE ${mode.nudge}\n=== FINISH ${mode.finish}\n=== DECLINED ${String(mode.declined)}`);
  if (read(log).length !== before) {
    console.error(`${name}: composing wrote ${String(read(log).length - before)} events`);
  }
  return runtimeProcess.exit(0);
}

async function prompt(args: CommandArgs, command: readonly string[]): Promise<number> {
  const [tree, name] = [args.required("tree"), args.required("name")];
  const [script, ...flags] = command;
  if (script !== EXAMINE && script !== DRAFT) {
    args.die(`prompt composes an Examiner or draft session: -- ${EXAMINE} | ${DRAFT}`);
  }
  const log = seedLog(tree, name, args.die);
  const before = read(log).length;
  // SAFETY: target Anabasis trees may export `applyContinuation`; older trees omit it cleanly.
  const sessionMod = (await import(join(tree, "src/agent/session.ts"))) as {
    applyContinuation?: typeof ApplyContinuation;
  };
  const apply = sessionMod.applyContinuation ?? ((opening: string) => opening);
  const show = (mode: PrintableMode, continuation: Parameters<typeof ApplyContinuation>[1]) =>
    printMode({ ...mode, opening: apply(mode.opening, continuation) }, log, before, name);
  runtimeProcess.chdir(tree);
  if (script === DRAFT) {
    // SAFETY: targets current Anabasis trees exporting `drafting(terms, within, home?)`.
    const [{ draftCommand }, { drafting }] = (await Promise.all([
      import(join(tree, script)),
      import(join(tree, "src/examiner/draft.ts")),
    ])) as [{ draftCommand: typeof DraftCommand }, { drafting: typeof Drafting }];
    const composed: Parameters<typeof DraftCommand>[1] = (request) =>
      show(
        drafting(request, async (action) => await action(), undefined),
        request.continuation,
      );
    await draftCommand([...flags, "--name", name], composed, null);
    return 0;
  }
  // SAFETY: these paths are modules of an Anabasis tree; a tree whose signatures differ fails below.
  const [{ examineCommand }, { writing }, { solved }] = (await Promise.all([
    import(join(tree, script)),
    import(join(tree, "src/examiner/write.ts")),
    import(join(tree, ROUND)),
  ])) as [{ examineCommand: typeof ExamineCommand }, { writing: typeof Writing }, { solved: typeof Solved }];
  const composed: Parameters<typeof ExamineCommand>[1] = (request) =>
    show(writing(request, undefined), request.continuation);
  // SAFETY: a tree before v0.14 takes its seats third, and the session exits before its first turn.
  await (examineCommand as (...given: unknown[]) => Promise<void>)(
    [...flags, "--name", name],
    composed,
    solved,
  );
  return 0;
}

async function census(args: CommandArgs, named: readonly string[]): Promise<number> {
  if (named.length === 0) args.die("name the logs or campaign folders to count");
  const calls = new Map<string, Call>();
  const wentOn = new Set<string>();
  const sessions = new Set<string>();
  const key = ({ at, index }: { at: string; index: number }) => `${at} ${String(index)}`;
  for (const each of named) {
    const log = await logAcross(each);
    if (!existsSync(log)) args.die(`${log} does not exist`);
    const events = read(log).slice(cutOf(log) ?? 0);
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
  const byTool = countBy(all, ({ tool }) => tool);
  const failedByTool = countBy(failed, ({ tool }) => tool);
  const kinds = countBy(
    failed,
    ({ tool, text }) =>
      `${tool}: ${kindOf(text)
        .replaceAll(/[\da-f]{12,}|\d+/gu, "N")
        .slice(0, 100)}`,
  );
  const most = (counts: Readonly<Record<string, number>>) =>
    Object.entries(counts).toSorted(([, a], [, b]) => b - a);
  console.log(
    [
      `${plural(all.length, "Examiner call")} in ${plural(sessions.size, "session")} over ${plural(named.length, "log")}, each call once`,
      ...most(byTool).map(
        ([tool, count]) => `  ${tool} ${String(count)}, failed ${String(failedByTool[tool] ?? 0)}`,
      ),
      "failed calls by kind, the commonest first:",
      ...most(kinds)
        .slice(0, 30)
        .map(([kind, count]) => `  ${String(count).padStart(4)}  ${kind}`),
      `finish ${String(all.filter(({ tool }) => tool === "finish").length)}, the session went on after ${String(wentOn.size)}`,
    ].join("\n"),
  );
  return 0;
}

async function main(args: CommandArgs): Promise<number> {
  const [verb, ...command] = args.positionals;
  if (verb === "start") return start(args, command);
  if (verb === "stop") return stop(args, command);
  if (verb === "compare") return compare(args, command);
  if (verb === "pairs") return pairs(args, command);
  if (verb === "calls") return census(args, command);
  if (verb === "prompt") return prompt(args, command);
  if (verb !== "read") {
    return args.die(`the verb is start, read, stop, compare, pairs, calls or prompt, not ${verb ?? "none"}`);
  }
  if (command.length > 0) args.die("read takes no command");
  const stretch = stretchOf(args);
  const log = await logAcross(stretch.log);
  if (!existsSync(log)) args.die(`${log} does not exist`);
  const result = readingOf(read(log), stretch.from, args.list("mention"));
  console.log(args.flag("json") ? capturedJsonStringify(result, null, 2) : told(result).join("\n"));
  return 0;
}

if (import.meta.main) {
  await runCommand({ name: "live-seat", usage: USAGE, options: OPTIONS, positionals: [1, 1000] }, main);
}
