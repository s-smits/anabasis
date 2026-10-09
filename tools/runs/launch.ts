/**
 * Launch a round or a checkpoint once its log says it can report something, or an Examiner
 * session, and stop a run: v1's launch-run, on v2's records.
 *
 *   bun run runs launch [--env-file FILE] [--loaded] [--dry-run] <the flags of tools/d2/round.ts>
 *   bun run runs launch [--env-file FILE] [--loaded] [--dry-run] <the flags of tools/d2/checkpoint.ts>
 *   bun run runs launch [--env-file FILE] [--loaded] [--dry-run] <the flags of tools/d1b/examine.ts>
 *   bun run runs stop <name> ... [--yes]
 *
 * Flags that hold `--examiner` are an Examiner session's, flags that hold `--id` a checkpoint's,
 * and any others a round's.
 *
 * `launch` runs in the worktree whose source should run. Before it starts anything it reads the
 * campaign's sets from the log and the host, and refuses:
 *
 *   - a log with no held-out task (`prepare.ts`);
 *   - a comparison that would leave fewer untied tasks than a step takes at its level. It could not
 *     read a step whatever the harnesses did, and the plan blocks a launch that cannot give a
 *     result (`docs/plan.md`, Phase 2). The untied tasks are counted from the share the campaign's
 *     last comparison left untied, where that comparison was made under the setting this one
 *     would run under: another solver or other limits tie other tasks. A task the harness this
 *     one is made with was valid on in every solve there can only tie again, so no more are
 *     counted than it left to win: after buffer's first step the harness that won was valid in
 *     every solve on 8 of 11 tasks (2026-10-09). Before any such comparison every scored task
 *     is counted whole, and so is one held out since it. Until
 *     2026-10-09 this was a note, and the eight truss rounds of 2026-10-08 scored no task and
 *     read `no-step` eight times for over $220;
 *   - a comparison with no `--cap`: the plan requires a dollar cap at launch for each comparison;
 *   - an id whose comparison has reported: a comparison that reported is finished;
 *   - the same run already running here;
 *   - a host whose load is over its cores, unless `--loaded` says its times will not be compared;
 *   - an `--env-file` that is not there. The path is Bun's to read and is never opened here;
 *   - a `--session` whose Builder started and did not end whole, as the round itself would
 *     (`spent`), or one an Examiner session already took (`claimed`).
 *
 * Its notes then say what a comparison of this size can show before it is paid for (`sizeLines`,
 * `src/kernel/size.ts`): the smallest results that clear its level, and the plan's power at it.
 * They say when the cap holds a reserve for fewer solves than the comparison's test makes.
 * They also say when the `--solve-minutes` and `--solve-turns` it was given are not the limits the
 * log's last test-side solves ran under, or the `--solver` and `--solver-effort` it names are not
 * who made them, since no solve on record is then counted (`tools/d2/setting.ts`). A launch that
 * names no `--solver` solves as the stored cycle's own, which it does not open, and says nothing
 * of the solver.
 *
 * An Examiner session solves nothing, so it meets the host's refusals and its id's, and needs the
 * campaign's log and no set in it.
 *
 * It then starts the command with the same flags, niced, in a process group of its own, with its
 * output in `.ana/d2/<name>/launch-<session>.out` and `.err`, and writes `launch-<session>.json`
 * beside them: the flags, the commit and the load it started under. Starting proves the process
 * stayed up for `START_MS`, and no model work.
 *
 * `stop` ends the process that writes each named run's log and every process that one started, and
 * nothing else: a round started by hand can share its process group with a sibling. A name is
 * matched whole. Without `--yes` it prints what it would end. A round or a checkpoint goes on from
 * its log when it is launched again under the same id, unless the stop fell inside a Builder
 * session: that session never finished, the round refuses a second one under its id, and so does
 * `launch`. An Examiner session's id is spent wherever the stop fell.
 *
 * A stop also releases what the run held on the host: the capped root of each solve and Builder
 * session its log started and never finished, which only the ended process would have let go. A
 * named run that is not running is released the same way, so a run that was killed, or stopped
 * before this was done, is cleaned up by stopping it again.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { sweepOf } from "#src/kernel/compare.ts";
import { settingId } from "#src/kernel/condition.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { awaitingLabel, lastReports, latestBuilt } from "#src/kernel/reports.ts";
import { sizeLines } from "#src/kernel/size.ts";
import { ranUnder, solverLast } from "#src/kernel/solves.ts";
import { taskSets } from "#src/kernel/task.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { availableParallelism, loadavg } from "#src/meta/os.ts";
import { dirname, join } from "#src/meta/path.ts";
import { capturedExecPath, capturedSpawn, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { runTextSyncOrThrow, terminateAndReapProcessGroupId } from "#src/meta/subprocess.ts";
import { type Cap, spent } from "#src/builder/round.ts";
import { sessionDirs } from "#src/builder/session.ts";
import { claimed } from "#src/examiner/session.ts";
import { type SolveDirs, solveDirs } from "#src/solve/command.ts";
import { releaseDiskCap } from "#src/verify/disk-cap.ts";
import { ROUND_OPTIONS, targetNamed } from "../d2/round.ts";
import { type NamedSetting, restarts, SETTING_OPTIONS, settingNamed } from "../d2/setting.ts";
import {
  CHECKPOINT,
  EXAMINE,
  logEvents,
  processes,
  ROUND,
  type Run,
  runs,
  standing,
  writers,
} from "./pulse.ts";
import { seedCut } from "./seed.ts";

const START_MS = 8000;
/** The launcher's own flags; every other one is the round's. */
const OWN = new Set(["env-file", "loaded", "dry-run"]);

/** What any launch finds on the host and in the log's sessions. */
export interface Host {
  readonly loaded: boolean;
  readonly load: number;
  readonly cores: number;
  /** The processes already writing this campaign's log. */
  readonly running: readonly number[];
  /** The `--env-file` that is not there, or null. */
  readonly missing: string | null;
  /** Why the command would refuse this session's id (`spent`, `claimed`), or null. */
  readonly spent: string | null;
  /** Who the command's solves would be by and what they would be held to, as its four flags name
   *  them (`tools/d2/setting.ts`), and who the log's last test-side solve was by, null before any. */
  readonly named: NamedSetting;
  readonly ran: ReturnType<typeof solverLast>;
}

/** What a comparison's launch is asked for beside it. */
export interface Asked extends Host {
  /** `--target`, `--solves` and `--level`, as given or as the round defaults them. */
  readonly target: number;
  readonly solves: number;
  readonly level: number;
  /** Whether the command runs a Builder session before it compares. */
  readonly builds: boolean;
  /** The dollar cap `--cap` and `--reserve` name, or null where no cap is named. */
  readonly cap: Cap | null;
  /** Why the comparison's id is taken (`reportedAs`), or null. */
  readonly reported: string | null;
}

/** What a launch reads of a log's tasks: how many are held out and may be scored, how many wait
 *  for a person's label and are left out, how many are released for practice, and the share of
 *  its tallied tasks left untied by the last comparison made under the setting of the log's last
 *  test-side solve, and by the harness the next would be made with, null before any, with how
 *  many tasks were held out since it tallied. */
export interface Supply {
  readonly held: number;
  readonly awaiting: number;
  readonly released: number;
  readonly untied: number | null;
  readonly since: number;
}

/** What a launch keeps of a round's start, in `launch-<session>.json` beside its log. The log holds
 *  the host's code by content and no commit, so this is where a round's commit is on record. */
export interface Receipt {
  readonly at: string;
  readonly pid: number;
  readonly flags: readonly string[];
  readonly envFile: string | null;
  readonly commit: string;
  readonly dirty: boolean;
  readonly load: number;
  readonly cores: number;
}

/** Where a launch of `session` keeps its receipt and its output, less the extension. */
const kept = (log: string, session: string) => join(dirname(log), `launch-${session}`);

/** The receipt of the launch of `session` beside `log`, or null for a round started by hand. */
export function receiptOf(log: string, session: string): Receipt | null {
  const file = `${kept(log, session)}.json`;
  return existsSync(file) ? parseJsonAs<Receipt>(readFileSync(file, "utf8")) : null;
}

const said = (rows: readonly (readonly [boolean, string])[]) =>
  rows.flatMap(([holds, text]) => (holds ? [text] : []));

/** Why nothing should start on this host or under this session's id, whatever the command. */
function refused(asked: Host): string[] {
  return said([
    [
      asked.running.length > 0,
      `this campaign's log is already being written here, by pid ${asked.running.join(", ")}`,
    ],
    [
      asked.load > asked.cores && !asked.loaded,
      `the host's load is ${asked.load.toFixed(1)} on ${String(asked.cores)} cores: what starts into it slows every other run and reaches walls an idle host would not. Wait, or pass --loaded when its times will not be compared`,
    ],
    [asked.missing !== null, `${String(asked.missing)} is not there`],
    [asked.spent !== null, `${String(asked.spent)}. Pass another --session`],
  ]);
}

/** Why no command would run comparison `id` again, or null: it has reported, and a comparison
 *  that reported is finished. Launched again it would say what it said and end, which a launch
 *  reads as a start that failed. */
export function reportedAs(events: readonly LogEvent[], id: string): string | null {
  const report = events.findLast(({ kind, data }) => kind === "comparison.reported" && data.session === id);
  return report === undefined
    ? null
    : `comparison ${id} has reported ${isString(report.data.reading) ? report.data.reading : "something"}, and a comparison that reported is finished`;
}

/** The value a command line gives flag `--name`, as `--name value` or `--name=value`. */
function flagOf(args: readonly string[], name: string): string | undefined {
  const joined = args.find((arg) => arg.startsWith(`--${name}=`));
  if (joined !== undefined) return joined.slice(name.length + 3);
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
}

/** A log's supply of tasks, as `preflight` takes it, for a comparison made with the harness
 *  `--reference` names. */
export function supplyOf(events: readonly LogEvent[], reference = "starter"): Supply {
  const sets = taskSets(events);
  const waiting = awaitingLabel(events).filter((version) => sets.held.includes(version));
  const solved = ranUnder(events).findLast(({ under }) => under.side === "test")?.under;
  const setting = solved === undefined ? null : settingId(solved);
  const last = lastReports(events).findLast(
    ({ data }) =>
      Array.isArray(data.versions) &&
      data.versions.length > 0 &&
      asRecord(data.scored) !== null &&
      data.setting === setting,
  )?.data;
  const tally = asRecord(last?.scored);
  const versions = Array.isArray(last?.versions) ? last.versions : [];
  const tallied = versions.length;
  // A task the harness to be compared with was valid on in every solve there can only tie again.
  const named =
    reference === "latest" ? latestBuilt(events) : reference === "starter" ? last?.starter : reference;
  const side = last?.old === named ? "old" : "fresh";
  const full = last?.[side] === named ? asRecord(last?.valid)?.[side] : null;
  const closed = Array.isArray(full) && isNumber(full.at(-1)) ? Number(full.at(-1)) : 0;
  const untied =
    tally !== null && isNumber(tally.wins) && isNumber(tally.losses) && tallied > 0
      ? Math.min(tally.wins + tally.losses, tallied - closed) / tallied
      : null;
  const since = sets.held.filter((version) => ![...versions, ...waiting].includes(version)).length;
  const [held, awaiting] = [sets.held.length - waiting.length, waiting.length];
  return { held, awaiting, released: sets.released.length, untied, since };
}

/** Why a round or a checkpoint should not start, and what its reader should know when it does. */
export function preflight(supply: Supply, asked: Asked) {
  const scored = Math.min(asked.target, supply.held);
  const [size = "", ...power] = sizeLines(scored, asked);
  // What a comparison's test can say at this size is arithmetic, and rehearsals found it before a
  // round paid to (2026-10-08): exam-1 held one task to score.
  const least = sweepOf(asked.level);
  // A share measured of another solver, or under other limits, says little of this comparison.
  const restarted = restarts(asked.named, asked.ran);
  const share = restarted.length === 0 ? (supply.untied ?? 1) : 1;
  // A task held out since that comparison has no share on record, and is counted whole.
  const untied = scored * (share + ((1 - share) * supply.since) / Math.max(1, supply.held));
  // The comparison's test alone: both harnesses, on every scored task.
  const test = 2 * scored * asked.solves;
  const afforded = asked.cap === null ? test : Math.floor(asked.cap.dollars / asked.cap.reserve);
  const more = `Run an Examiner session (${EXAMINE}) for more held-out tasks`;
  const refusals = [
    ...said([
      [
        supply.held === 0,
        "the log holds no held-out task to score: run tools/d2/prepare.ts, which takes the pack's tasks in",
      ],
      [
        supply.held > 0 && scored < least,
        `${size}. ${more}${asked.target < least ? `, and ask for a --target of ${String(least)} or more` : ""}`,
      ],
      [
        scored >= least && untied < least,
        `the campaign's last comparison left ${String(Math.round(100 * share))}% of its tasks for this one to untie: the rest tied there, or this one's reference harness was valid on them in every solve. At that share ${String(scored)} scored tasks${supply.since > 0 ? `, the ${String(supply.since)} held out since counted whole,` : ""} leave about ${untied.toFixed(1)} untied, where at --level ${String(asked.level)} a step takes ${String(least)}, all won: this comparison could hardly read a step. ${more}, or change the budget so that fewer tasks tie`,
      ],
      [
        asked.cap === null,
        "no --cap is named: a comparison is launched under a dollar cap, and one the cap cuts short reads not-scored",
      ],
      [asked.reported !== null, `${String(asked.reported)}. Pass another id`],
    ]),
    ...refused(asked),
  ];
  const notes = [
    `${String(supply.held)} held out · ${String(supply.released)} released for practice · ${String(scored)} to score`,
    ...(scored < least ? [] : [size, ...power]),
    ...said([
      [
        supply.awaiting > 0,
        `${String(supply.awaiting)} held-out task(s) wait for a person's label and are not scored (tools/d2/prepare.ts)`,
      ],
      [asked.builds && supply.released === 0, "no task is released: the Builder has nothing to practise on"],
      [
        asked.cap !== null && afforded < test,
        `the cap of $${String(asked.cap?.dollars)} holds a reserve of $${String(asked.cap?.reserve)} for ${String(afforded)} solves, and the comparison's test alone makes ${String(test)}${asked.builds ? ", after a session whose spend the same cap holds" : ""}: it is cut short and reads not-scored unless its solves bill well under their reserve`,
      ],
    ]),
    ...restarted,
  ];
  return { refusals, notes };
}

/** The same for an Examiner session on a campaign whose log is `events`, or null where the
 *  campaign has none here. It solves nothing and needs no set: what it writes is held out. */
export function examPreflight(events: readonly LogEvent[] | null, asked: Host) {
  const sets = taskSets(events ?? []);
  const refusals = [
    ...said([
      [
        events === null,
        "the campaign has no log in this worktree: open it with tools/c/accept.ts and tools/d2/prepare.ts",
      ],
    ]),
    ...refused(asked),
  ];
  const notes = said([
    [
      events !== null,
      `${String(sets.held.length)} held out · ${String(sets.released.length)} released for practice: what this session writes is held out beside them`,
    ],
  ]);
  return { refusals, notes };
}

/** Start `cmd` in a process group of its own, its output under `base`, and return the process. */
export function start(cmd: readonly string[], base: string) {
  return capturedSpawn({
    cmd: [...cmd],
    stdin: "ignore",
    stdout: Bun.file(`${base}.out`),
    stderr: Bun.file(`${base}.err`),
    // Its own group, so that this command's end is not its end and a stop reaches all it started.
    detached: true,
  });
}

/** `args` without the options `own` names and their values, as `parseArgs` tokenised them: what a
 *  command that takes another's flags hands on to it. */
export function passedOn(
  args: readonly string[],
  tokens: readonly { kind: string; index: number; name?: string; inlineValue?: boolean | undefined }[],
  own: ReadonlySet<string>,
): string[] {
  const dropped = new Set(
    tokens.flatMap(({ kind, index, name, inlineValue }) => {
      if (kind !== "option" || name === undefined || !own.has(name)) return [];
      return inlineValue === false ? [index, index + 1] : [index];
    }),
  );
  return args.filter((_, index) => !dropped.has(index));
}

/** `bun run runs launch`. */
export async function launch(args: readonly string[]): Promise<void> {
  const { values, tokens } = parseArgs({
    args: [...args],
    strict: false,
    tokens: true,
    options: {
      "env-file": { type: "string" },
      loaded: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      name: { type: "string" },
      session: { type: "string" },
      id: { type: "string" },
      target: ROUND_OPTIONS.target,
      solves: ROUND_OPTIONS.solves,
      level: ROUND_OPTIONS.level,
      cap: ROUND_OPTIONS.cap,
      reserve: ROUND_OPTIONS.reserve,
      tasks: { type: "string" },
      reference: ROUND_OPTIONS.reference,
      ...SETTING_OPTIONS,
      examiner: { type: "string" },
    },
  });
  const { name, "env-file": envFile } = values;
  // A checkpoint is named by its `--id`, which stands where a session's id does.
  const checking = isString(values.id);
  const session = checking ? values.id : values.session;
  if (!isString(name) || !isString(session)) {
    throw new Error(
      `usage: bun run runs launch [--env-file FILE] [--loaded] [--dry-run] <the flags of ${ROUND}, of ${CHECKPOINT} or of ${EXAMINE}>`,
    );
  }
  const examining = isString(values.examiner);
  const flags = passedOn(args, tokens, OWN);
  const tree = runtimeProcess.cwd();
  const run = runs().find(
    (found) => found.tree === tree && found.name === name && found.end === "comparison.reported",
  );
  const load = loadavg()[0] ?? 0;
  const cores = availableParallelism();
  const events = run === undefined ? null : logEvents(run.path);
  const host: Host = {
    loaded: values.loaded === true,
    load,
    cores,
    running: run === undefined ? [] : writers(run, processes()).map(({ pid }) => pid),
    missing: isString(envFile) && !existsSync(envFile) ? envFile : null,
    // A checkpoint runs no session, so no id of one can be spent on it.
    spent: checking ? null : (examining ? claimed : spent)(events ?? [], session),
    // The command's own reading of its four flags, so a wall it would refuse is refused here.
    named: settingNamed({
      solver: isString(values.solver) ? values.solver : undefined,
      "solver-effort": String(values["solver-effort"]),
      "solve-minutes": String(values["solve-minutes"]),
      "solve-turns": String(values["solve-turns"]),
      "solve-model-turns": isString(values["solve-model-turns"]) ? values["solve-model-turns"] : undefined,
    }),
    ran: solverLast(events ?? []),
  };
  const { refusals, notes } = examining
    ? examPreflight(events, host)
    : preflight(supplyOf(events ?? [], String(values.reference)), {
        ...host,
        // A checkpoint that names its tasks scores those, however many the log holds beside them.
        target: isString(values.tasks) ? values.tasks.split(",").length : targetNamed(String(values.target)),
        solves: Number(values.solves),
        level: Number(values.level),
        builds: !checking,
        cap: isString(values.cap) ? { dollars: Number(values.cap), reserve: Number(values.reserve) } : null,
        reported: reportedAs(events ?? [], session),
      });
  for (const note of notes) console.log(`· ${note}`);
  if (run === undefined || refusals.length > 0) {
    // A refusal is an answer and not a fault of this command, so it is said without a stack.
    for (const why of refusals) console.error(`⚠ ${why}`);
    console.error(`${name} is not launched`);
    runtimeProcess.exitCode = 1;
    return;
  }
  const cmd = [
    "nice",
    "-n",
    "19",
    capturedExecPath,
    ...(isString(envFile) ? [`--env-file=${envFile}`] : []),
    examining ? EXAMINE : checking ? CHECKPOINT : ROUND,
    ...flags,
  ];
  if (values["dry-run"] === true) {
    console.log(`would start: ${cmd.join(" ")}`);
    return;
  }
  const base = kept(run.path, session);
  const child = start(cmd, base);
  const receipt: Receipt = {
    at: new Date().toISOString(),
    pid: child.pid,
    flags,
    envFile: isString(envFile) ? envFile : null,
    ...standing(tree),
    load,
    cores,
  };
  writeFileSync(`${base}.json`, `${capturedJsonStringify(receipt, null, 2)}\n`);
  const ended = await Promise.race([child.exited, Bun.sleep(START_MS).then(() => null)]);
  if (ended !== null) {
    throw new Error(
      `${name} ended within ${String(START_MS / 1000)} s, with code ${String(ended)}: read ${base}.err`,
    );
  }
  child.unref();
  console.log(
    `launched ${name} ${session} as pid ${String(child.pid)}, at ${receipt.commit.slice(0, 9)}${receipt.dirty ? " with uncommitted changes" : ""}, under a load of ${load.toFixed(1)}`,
  );
  console.log(`  watch  bun run runs pulse ${name}`);
  console.log(`  stop   bun run runs stop ${name} --yes`);
}

/** `pid` and every process it started, the nearest first, from a `ps` table of pid and parent. */
export function family(table: string, pid: number): number[] {
  const started = new Map<number, number[]>();
  for (const row of table.trim().split("\n")) {
    const [child = 0, parent = 0] = row.trim().split(/\s+/).map(Number);
    started.set(parent, [...(started.get(parent) ?? []), child]);
  }
  const found = [pid];
  for (const next of found) found.push(...(started.get(next) ?? []));
  return found;
}

/**
 * The directories of the solves and Builder sessions a run started and never finished. A run that
 * was stopped or killed leaves the capped root of each mounted: only its own process would have let
 * it go. A seed's log begins as its source's, and what that run has open is the source's to hold.
 */
export function leftOpen(run: Pick<Run, "path" | "seed">): SolveDirs[] {
  const events = logEvents(run.path).slice(run.seed === true ? seedCut(dirname(run.path)) : 0);
  const open = (role: "solve" | "build", key: "solve" | "session") => {
    const ended = new Set(
      events.flatMap(({ kind, data }) => (kind === `${role}.finished` ? [data[key]] : [])),
    );
    return events.flatMap(({ kind, data }) => {
      const id = data[key];
      return kind === `${role}.started` && isString(id) && !ended.has(id) ? [id] : [];
    });
  };
  return [
    ...open("solve", "solve").map((id) => solveDirs(id)),
    ...open("build", "session").map((id) => sessionDirs(run.path, id)),
  ];
}

/** `bun run runs stop`. */
export async function stop(args: readonly string[]): Promise<void> {
  const { values, positionals: names } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { yes: { type: "boolean", default: false } },
  });
  if (names.length === 0) throw new Error("usage: bun run runs stop <name> ... [--yes]");
  const running = processes();
  const table = runTextSyncOrThrow(["ps", "-axo", "pid=,ppid="]);
  const named = runs().filter((run) => names.includes(run.name));
  const found = named.flatMap((run) =>
    writers(run, running).map(({ pid, args: ran }) => ({ run, ran, pids: family(table, pid) })),
  );
  if (found.length === 0) console.log("none of these is running");
  for (const { run, ran, pids } of found) {
    console.log(
      `${run.name} in ${run.tree}: pid ${String(pids[0])} and the ${String(pids.length - 1)} it started`,
    );
    if (!values.yes) continue;
    // The run's own process first, so that it starts nothing more, then what it left.
    let left = 0;
    for (const pid of pids) left += (await terminateAndReapProcessGroupId(pid)) ? 0 : 1;
    if (left > 0) console.log(`  ⚠ ${String(left)} of them would not end`);
    // A round has no ending to write when it is stopped, so a stop inside a Builder session spends
    // that session's id: say so here, where the operator decides what to launch next.
    // The session is the stopped process's own, by its flags: a checkpoint names none, and the
    // log's last Builder session may be another run's.
    const session = flagOf(ran, "session");
    const cut = ran.some((arg) => arg.endsWith(EXAMINE))
      ? "An Examiner session's id names one session: the next takes another --session"
      : session === undefined
        ? null
        : spent(logEvents(run.path), session);
    console.log(
      `  stopped, its log as it was. ${cut ?? "A round or a checkpoint goes on from it when launched again under the same id"}`,
    );
  }
  // What a run was stopped or killed inside is still there, whenever that was: a mounted volume, or
  // the folder and image of one. A run that is still being written holds its roots in use, and is
  // left alone.
  const still = processes();
  let held = 0;
  for (const run of named.filter((each) => writers(each, still).length === 0)) {
    const left = leftOpen(run).filter(({ root }) => existsSync(root));
    if (left.length === 0) continue;
    held += left.length;
    console.log(
      `${run.name} in ${run.tree}: ${String(left.length)} capped root(s) its solves and sessions left behind`,
    );
    if (!values.yes) continue;
    for (const { root, host } of left) {
      await releaseDiskCap(root);
      rmSync(host, { recursive: true, force: true });
    }
    console.log("  released");
  }
  if (found.length + held > 0 && !values.yes) console.log("nothing is ended or released without --yes");
}
