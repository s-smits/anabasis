/**
 * Launch a round or a checkpoint once its log says it can report something, a Builder session by
 * itself, or an Examiner session, and stop a run: v1's launch-run, on v2's records.
 *
 *   bun run runs launch [--env-file FILE] [--loaded] [--dry-run] <the flags of tools/d2/round.ts>
 *   bun run runs launch [--env-file FILE] [--loaded] [--dry-run] <the flags of tools/d2/checkpoint.ts>
 *   bun run runs launch [--env-file FILE] [--loaded] [--dry-run] --no-comparison <the flags of tools/d2/session.ts>
 *   bun run runs launch [--env-file FILE] [--loaded] [--dry-run] <the flags of tools/d1b/examine.ts>
 *   bun run runs stop <name> ... [--yes]
 *
 * Flags that hold `--examiner` are an Examiner session's, flags that hold `--id` a checkpoint's,
 * and any others a round's, unless `--no-comparison` says the session runs with no comparison
 * after it: the plan's checkpoint is several sessions and then one comparison.
 *
 * `launch` runs in the worktree whose source should run. Before it starts anything it reads the
 * campaign's log and the host, and refuses:
 *
 *   - whatever the comparison's own admission refuses (`src/builder/admission.ts`): no held-out
 *     task, too few to read a step or too few left untied, no `--cap`, a checker nobody has read,
 *     and a campaign the plan's stop rule has stopped, unless `--past-stop` says why it goes on.
 *     The command asks the same function again before its first event, so a round started by hand
 *     is refused where this launch would be. The eight truss rounds of 2026-10-08 scored no task
 *     and read `no-step` eight times for over $220, when the first of these was a note;
 *   - an id whose comparison has reported: a comparison that reported is finished;
 *   - the same run already running here;
 *   - a host whose load is over its cores, unless `--loaded` says its times will not be compared;
 *   - an `--env-file` that is not there. The path is Bun's to read and is never opened here;
 *   - a `--session` whose Builder started and did not end whole, as the round itself would
 *     (`spent`), one an Examiner session already took (`claimed`), or, for a session by itself,
 *     one that has ended (`sessionTaken`).
 *
 * Its notes then say what a comparison of this size can show before it is paid for (`sizeLines`,
 * `src/kernel/size.ts`): the smallest results that clear its level, and the plan's power at it.
 * They say when the cap holds a reserve for fewer solves than the comparison's test makes.
 * The setting it would run under is the campaign's recorded one (`tools/d2/setting.ts`): a flag
 * that names another is refused here as the command would refuse it, unless `--new-setting` is
 * passed. The notes say when that setting is not the one the log's last test-side solves ran
 * under, since no tally on record then speaks for it. A launch that names no `--solver` solves as
 * the stored cycle's own, which it does not open, and says nothing of the solver.
 *
 * A session with no comparison scores nothing, so it meets the session's own admission
 * (`sessionAdmission`): its cap, a checker that has been read, and the stop rule. An Examiner
 * session solves nothing, so it meets the host's refusals and its id's, and needs the campaign's
 * log and no set in it.
 *
 * It then starts the command with the same flags, niced, in a process group of its own, with its
 * output in `.ana/d2/<name>/launch-<session>.out` and `.err`, and writes `launch-<session>.json`
 * beside them: the flags, the commit and the load it started under. Starting proves the process
 * stayed up for `START_MS`, and no model work. A command that ends inside that window with code 0
 * finished, and is said to have: a Builder session that leaves its harness as it was can take
 * seconds, and the first live one to do so (4.9 s, 2026-10-09) was reported as a start that failed.
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
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { solverLast } from "#src/kernel/solves.ts";
import { taskSets } from "#src/kernel/task.ts";
import { isString } from "#src/meta/json-shape.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { availableParallelism, loadavg } from "#src/meta/os.ts";
import { dirname, join } from "#src/meta/path.ts";
import {
  capturedExecPath,
  capturedSpawn,
  parseArgs,
  type ParseArgsOptionsConfig,
  runtimeProcess,
} from "#src/meta/process.ts";
import { runTextSyncOrThrow, terminateAndReapProcessGroupId } from "#src/meta/subprocess.ts";
import {
  admission,
  begun,
  EXAMINE,
  sessionAdmission,
  type Supply,
  supplyOf,
  type Wanted,
  type WantedPractice,
} from "#src/builder/admission.ts";
import { sessionDirs, spent } from "#src/builder/session.ts";
import { claimed, examinerDirs } from "#src/examiner/session.ts";
import { type SolveDirs, solveDirs } from "#src/solve/command.ts";
import { releaseDiskCap } from "#src/verify/disk-cap.ts";
import { CHECKPOINT_OPTIONS } from "../d2/checkpoint.ts";
import { EXAMINE_OPTIONS } from "../d1b/examine.ts";
import { capRead, ROUND_OPTIONS, SESSION_OPTIONS } from "../d2/round.ts";
import {
  firstRecord,
  type NamedSetting,
  recordedSetting,
  restarts,
  SETTING_OPTIONS,
  settingAsked,
} from "../d2/setting.ts";
import {
  BUILDER,
  CHECKPOINT,
  logEvents,
  processes,
  ROUND,
  type Run,
  runs,
  SESSION,
  standing,
  writers,
} from "./pulse.ts";
import { seedCut } from "./seed.ts";

/** A flag's value as `parseArgs` gives it for a command line it does not hold to its options. */
type Loose = string | boolean | (string | boolean)[] | undefined;

const START_MS = 8000;
/** The launcher's own flags; every other one is the command's. */
const OWN = new Set(["env-file", "loaded", "dry-run", "no-comparison"]);
/** Each command's own option table, by which it parses its flags at its first line. */
const OPTIONS_OF: ReadonlyMap<string, ParseArgsOptionsConfig> = new Map<string, ParseArgsOptionsConfig>([
  [ROUND, ROUND_OPTIONS],
  [SESSION, SESSION_OPTIONS],
  [CHECKPOINT, CHECKPOINT_OPTIONS],
  [EXAMINE, EXAMINE_OPTIONS],
]);

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

/** What a comparison's launch is asked for beside it: what the comparison wants, as its flags name
 *  it, and whether its id is free. */
export interface Asked extends Host, Omit<Wanted, "restarted"> {
  /** Why the comparison's id is taken (`reportedAs`), or null. */
  readonly reported: string | null;
  /** Whether the log holds this comparison's own start (`begun`): it was admitted when it began,
   *  and goes on from its log as the command lets it. */
  readonly continued?: boolean | undefined;
}

/** What a launch keeps of a round's start, in `launch-<session>.json` beside its log. The log holds
 *  the host's code by content and no commit, so this is where a round's commit is on record. A run
 *  of the campaign command keeps one too, as `launch-run-<n>.json` (`tools/d2/harness-builder.ts`):
 *  until 10 October it kept none, and the flag line of the run that recorded a campaign's setting
 *  was on no record. */
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

/** Keep `receipt` as the launch of `session` beside `log`. */
export function writeReceipt(log: string, session: string, receipt: Receipt): void {
  writeFileSync(`${kept(log, session)}.json`, `${capturedJsonStringify(receipt, null, 2)}\n`);
}

/** Every launch whose receipt sits beside `log`, oldest first, less the flags and the env file's
 *  path a receipt also holds. None for a campaign whose rounds were started by hand. */
export function launchesOf(log: string) {
  const folder = dirname(log);
  return readdirSync(folder)
    .flatMap((file) => {
      const session = /^launch-(.+)\.json$/.exec(file)?.[1];
      const receipt = session === undefined ? null : receiptOf(log, session);
      if (session === undefined || receipt === null) return [];
      const { at, commit, dirty, load, cores } = receipt;
      return [{ session, at, commit, dirty, load, cores }];
    })
    .sort((a, b) => a.at.localeCompare(b.at));
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

/** Why no launch runs session `id` by itself, or null: it did not end whole (`spent`), or it ended.
 *  Launched again, a session that ended would say what it left and end, which a launch reads as a
 *  start that failed; inside a round it goes on to its comparison, and is not refused. */
export function sessionTaken(events: readonly LogEvent[], id: string): string | null {
  const ended = events.some(({ kind, data }) => kind === "build.finished" && data.session === id);
  return spent(events, id) ?? (ended ? `session ${id} has ended, and what it left is on record` : null);
}

/** The value a command line gives flag `--name`, as `--name value` or `--name=value`. */
function flagOf(args: readonly string[], name: string): string | undefined {
  const joined = args.find((arg) => arg.startsWith(`--${name}=`));
  if (joined !== undefined) return joined.slice(name.length + 3);
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
}

/** Why a round or a checkpoint should not be launched, and what its reader should know when it is:
 *  the comparison's own admission on this log, then what only its id and this host can refuse. */
export function preflight(supply: Supply, asked: Asked) {
  const { refusals, notes } = admission(supply, { ...asked, restarted: restarts(asked.named, asked.ran) });
  // A comparison that began is not asked again, here as in the command: a checkpoint that set a
  // task aside and was stopped could not be launched again while the launcher asked the whole
  // check of it a second time (the third review, row F45).
  const going = asked.continued === true && asked.reported === null;
  return {
    refusals: [
      ...(going ? [] : refusals),
      ...said([[asked.reported !== null, `${String(asked.reported)}. Pass another id`]]),
      ...refused(asked),
    ],
    notes: going ? ["this comparison goes on from its log: it was admitted when it began", ...notes] : notes,
  };
}

/** The same for a Builder session with no comparison after it: the session's own admission, then
 *  the host and its id. */
export function sessionPreflight(supply: Supply, asked: Host & WantedPractice) {
  const { refusals, notes } = sessionAdmission(supply, asked);
  return { refusals: [...refusals, ...refused(asked)], notes };
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

/**
 * The command's own reading of its setting against the campaign's record (`tools/d2/setting.ts`),
 * from flags this launcher parsed loosely: a wall the command would refuse, or a flag that names
 * another setting than the campaign's, is refused here, before anything starts. An Examiner
 * session solves and scores nothing, and none of its flags is a setting's: its `--tasks` is how
 * many tasks it may write.
 */
export function settingFlagged(values: Readonly<Record<string, Loose>>, events: readonly LogEvent[]) {
  const text = (flag: Loose) => (isString(flag) ? flag : undefined);
  if (isString(values.examiner)) return settingAsked({}, null);
  return settingAsked(
    {
      solver: text(values.solver),
      "solver-effort": text(values["solver-effort"]),
      "solve-minutes": text(values["solve-minutes"]),
      "solve-turns": text(values["solve-turns"]),
      "solve-model-turns": text(values["solve-model-turns"]),
      tasks: text(values.tasks),
      target: text(values.target),
      "new-setting": values["new-setting"] === true,
    },
    recordedSetting(events),
  );
}

/** The command a launch starts, by what its flags hold. */
function commandOf(holds: {
  readonly examining: boolean;
  readonly checking: boolean;
  readonly alone: boolean;
}): string {
  if (holds.examining) return EXAMINE;
  if (holds.checking) return CHECKPOINT;
  return holds.alone ? SESSION : ROUND;
}

/**
 * What the command would say of the flags passed on to it, before anything starts, or null where
 * it takes them. A launch parses its own flags loosely, so that each command's flags pass through
 * it, and passed on a flag the command does not take: on 10 October a dry run would have started
 * a session by itself with `--predict`, a comparison's flag, and another with the command's own
 * path as a positional, and each command refuses those at its first line, after the receipt is
 * written and the operator's word for the launch is spent.
 */
export function flagsRefused(command: string, flags: readonly string[]): string | null {
  const options = OPTIONS_OF.get(command);
  if (options === undefined) return `${command} is not a command a launch starts`;
  try {
    parseArgs({ args: [...flags], options });
    return null;
  } catch (error) {
    return `${command} would refuse these flags: ${errorMessage(error)}`;
  }
}

/** The flags a launch reads for itself: its own, and those of the command that its preflight
 *  needs, with the command's defaults. Every other flag is passed on unread. */
export const LAUNCH_OPTIONS = {
  "env-file": { type: "string" },
  loaded: { type: "boolean", default: false },
  "dry-run": { type: "boolean", default: false },
  "no-comparison": { type: "boolean", default: false },
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
  "past-stop": ROUND_OPTIONS["past-stop"],
  "practice-solves": ROUND_OPTIONS["practice-solves"],
  ...SETTING_OPTIONS,
  examiner: { type: "string" },
} as const;

/**
 * What a launch's flags ask of a comparison and of a session by itself, as their admissions take
 * them, with the setting they would run under. It is what the launcher's preflight reads and what
 * the campaign view asks the next moves with (`tools/runs/view.ts`), so that the two say the same
 * of one log. The launcher opens no campaign, so it knows the solver only where a flag names it:
 * the command asks again with the campaign open.
 */
export function askedFlagged(values: Readonly<Record<string, Loose>>, events: readonly LogEvent[]) {
  const setting = settingFlagged(values, events);
  const ran = solverLast(events);
  const session: WantedPractice = {
    // Read as the command reads it, so a cap that is no number is refused before anything starts.
    cap: isString(values.cap) ? capRead(values.cap, String(values.reserve)) : null,
    pastStop: isString(values["past-stop"]) ? values["past-stop"] : undefined,
    unrecorded: firstRecord(setting, setting.named, ran),
    practiceSolves: Number(values["practice-solves"]),
  };
  const comparison: Wanted = {
    ...session,
    // A comparison that names its tasks scores those, however many the log holds beside them.
    target: setting.tasks === undefined ? setting.target : setting.tasks.split(",").length,
    solves: Number(values.solves),
    level: Number(values.level),
    builds: true,
    restarted: restarts(setting.named, ran),
  };
  return { setting, ran, reference: String(values.reference), comparison, session };
}

/** `bun run runs launch`. */
export async function launch(args: readonly string[]): Promise<void> {
  const { values, tokens } = parseArgs({
    args: [...args],
    strict: false,
    tokens: true,
    options: LAUNCH_OPTIONS,
  });
  const { name, "env-file": envFile } = values;
  // A checkpoint is named by its `--id`, which stands where a session's id does.
  const checking = isString(values.id);
  const session = checking ? values.id : values.session;
  if (!isString(name) || !isString(session)) {
    throw new Error(
      `usage: bun run runs launch [--env-file FILE] [--loaded] [--dry-run] <the flags of ${ROUND}, of ${CHECKPOINT}, of ${SESSION} with --no-comparison, or of ${EXAMINE}>`,
    );
  }
  const examining = isString(values.examiner);
  const alone = values["no-comparison"] === true;
  if (alone && (checking || examining)) {
    throw new Error(
      "--no-comparison names a Builder session by itself: a checkpoint (--id) runs no session, and an Examiner session (--examiner) compares nothing",
    );
  }
  const flags = passedOn(args, tokens, OWN);
  const tree = runtimeProcess.cwd();
  const run = runs().find(
    (found) => found.tree === tree && found.name === name && found.end === "comparison.reported",
  );
  const load = loadavg()[0] ?? 0;
  const cores = availableParallelism();
  const events = run === undefined ? null : logEvents(run.path);
  const asked = askedFlagged(values, events ?? []);
  const host: Host = {
    loaded: values.loaded === true,
    load,
    cores,
    running: run === undefined ? [] : writers(run, processes()).map(({ pid }) => pid),
    missing: isString(envFile) && !existsSync(envFile) ? envFile : null,
    // A checkpoint runs no session, so no id of one can be spent on it.
    spent: checking ? null : (examining ? claimed : alone ? sessionTaken : spent)(events ?? [], session),
    named: asked.setting.named,
    ran: asked.ran,
  };
  const { refusals, notes } = examining
    ? examPreflight(events, host)
    : alone
      ? sessionPreflight(supplyOf(events ?? []), { ...host, ...asked.session })
      : preflight(supplyOf(events ?? [], asked.reference), {
          ...host,
          ...asked.comparison,
          builds: !checking,
          reported: reportedAs(events ?? [], session),
          continued: begun(events ?? [], session, "comparison.started"),
        });
  const command = commandOf({ examining, checking, alone });
  const flagged = flagsRefused(command, flags);
  const whys = flagged === null ? refusals : [...refusals, flagged];
  for (const note of notes) console.log(`· ${note}`);
  if (run === undefined || whys.length > 0) {
    // A refusal is an answer and not a fault of this command, so it is said without a stack.
    for (const why of whys) console.error(`⚠ ${why}`);
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
    command,
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
  writeReceipt(run.path, session, receipt);
  const ended = await Promise.race([child.exited, Bun.sleep(START_MS).then(() => null)]);
  const early = endedEarly(ended, `${name} ${session}`, base);
  if (early !== null) {
    console.log(early);
    return;
  }
  child.unref();
  console.log(
    `launched ${name} ${session} as pid ${String(child.pid)}, at ${receipt.commit.slice(0, 9)}${receipt.dirty ? " with uncommitted changes" : ""}, under a load of ${load.toFixed(1)}`,
  );
  console.log(`  watch  bun run runs pulse ${name}`);
  console.log(`  stop   bun run runs stop ${name} --yes`);
}

/**
 * What a launch says of a command that ended inside its start window, and nothing of one that still
 * runs (`ended` is then null). Code 0 is a command that finished; any other is a start that failed,
 * which throws.
 */
export function endedEarly(ended: number | null, run: string, base: string): string | null {
  if (ended === null) return null;
  const within = `within ${String(START_MS / 1000)} s`;
  if (ended !== 0) throw new Error(`${run} ended ${within}, with code ${String(ended)}: read ${base}.err`);
  return `${run} finished ${within}: read ${base}.out`;
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
 * The directories of the solves and sessions a run started and never finished. A run that was
 * stopped or killed leaves the capped root of each mounted: only its own process would have let it
 * go. A seed's log begins as its source's, and what that run has open is the source's to hold.
 *
 * An Examiner session has a capped root as a Builder's: left out here, the root of the one a stop
 * cut stayed mounted and had to be released by hand (buffer x-1, 2026-10-10).
 */
export function leftOpen(run: Pick<Run, "path" | "seed">): SolveDirs[] {
  const events = logEvents(run.path).slice(run.seed === true ? seedCut(dirname(run.path)) : 0);
  const open = (role: "solve" | "build" | "exam", key: "solve" | "session") => {
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
    ...open("exam", "session").map((id) => examinerDirs(run.path, id)),
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
    const ranAs = (tool: string) => ran.some((arg) => arg.endsWith(tool));
    const cut = ranAs(EXAMINE)
      ? "An Examiner session's id names one session: the next takes another --session"
      : // A campaign command names no session: the one it was inside is in its log, and its id is
        // spent whichever role it was. A word costs none, and both campaigns stopped by signal on
        // 10 October lost a session that was running (b-1 and x-1).
        ranAs(BUILDER)
        ? "A campaign goes on from its log under the same --name, and the session it was inside has spent its id. A word left with tools/d2/word.ts ends a campaign at its next move boundary and spends none"
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
