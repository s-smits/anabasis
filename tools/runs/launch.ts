/**
 * Launch a round once its log says it can report something, or an Examiner session, and stop a
 * run: v1's launch-run, on v2's records.
 *
 *   bun run runs launch [--env-file FILE] [--loaded] [--dry-run] <the flags of tools/d2/round.ts>
 *   bun run runs launch [--env-file FILE] [--loaded] [--dry-run] <the flags of tools/d1b/examine.ts>
 *   bun run runs stop <name> ... [--yes]
 *
 * Flags that hold `--examiner` are an Examiner session's, and any others a round's.
 *
 * `launch` runs in the worktree whose source should run. Before it starts anything it reads the
 * campaign's sets from the log and the host, and refuses:
 *
 *   - a log with no feasible task or no anchor (`admit-sweep.ts`, `prepare.ts`);
 *   - a scoring round with no task held outside the anchor: it has nothing to screen, so its scored
 *     set stays empty and it reads `no-step` whatever the Builder made. The eight truss rounds of
 *     2026-10-08 had no such task, and read `no-step` eight times for over $220;
 *   - the same round already running here;
 *   - a host whose load is over its cores, unless `--loaded` says its times will not be compared;
 *   - an `--env-file` that is not there. The path is Bun's to read and is never opened here;
 *   - a `--session` whose Builder started and did not end whole, as the round itself would.
 *
 * An Examiner session meets the last four of these, its id being one the log holds already, and
 * needs the campaign's log and no set in it. Its notes say what it is handed and where its tasks
 * can go: a task an earlier session left past gate 3, and whether the anchor is drawn yet.
 *
 * It then starts the command with the same flags, niced, in a process group of its own, with its
 * output in `.ana/d2/<name>/launch-<session>.out` and `.err`, and writes `launch-<session>.json`
 * beside them: the flags, the commit and the load it started under. Starting proves the process
 * stayed up for `START_MS`, and no model work.
 *
 * `stop` ends the process that writes each named run's log and every process that one started, and
 * nothing else: a round started by hand can share its process group with a sibling. A name is
 * matched whole. Without `--yes` it prints what it would end. A round goes on from its log when it
 * is launched again with the same `--session`, unless the stop fell inside its Builder session: that
 * session never finished, the round refuses a second one under its id, and so does `launch`. An
 * Examiner session's id is spent wherever the stop fell, and the next is handed what it left.
 */
import { existsSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { isString } from "#src/meta/json-shape.ts";
import { availableParallelism, loadavg } from "#src/meta/os.ts";
import { dirname, join } from "#src/meta/path.ts";
import { capturedExecPath, capturedSpawn, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { runTextSyncOrThrow, terminateAndReapProcessGroupId } from "#src/meta/subprocess.ts";
import { spent } from "#src/builder/round.ts";
import { claimed } from "#src/examiner/session.ts";
import { carriable, setsOf } from "../d2/campaign.ts";
import { EXAMINE, logEvents, processes, ROUND, runs, standing, writers } from "./pulse.ts";

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
}

/** What a round's launch is asked for beside it. */
export interface Asked extends Host {
  /** `--target`, as given: only "0" asks for no scored task. */
  readonly target: string | undefined;
  readonly admitted: boolean;
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

/** Why a round should not start, and what its reader should know when it does. */
export function preflight(sets: ReturnType<typeof setsOf>, asked: Asked) {
  const scoring = asked.target !== "0";
  const toScreen = sets.candidates.length + (asked.admitted ? sets.admitted.length : 0);
  const refusals = [
    ...said([
      [
        sets.feasible.length === 0,
        "the log holds no feasible task: put the pack's tasks in it with tools/m1/admit-sweep.ts --log <log> --feasible",
      ],
      [sets.feasible.length > 0 && sets.anchor.length === 0, "no anchor is drawn: run tools/d2/prepare.ts"],
      [
        scoring && toScreen === 0 && sets.anchor.length > 0,
        `no task is held outside the anchor, so the round has nothing to screen and cannot step: run an Examiner session (${EXAMINE}), or pass --target 0 for a round that reads its anchor alone`,
      ],
    ]),
    ...refused(asked),
  ];
  const notes = said([
    [
      true,
      `${String(sets.anchor.length)} anchor · ${String(sets.released.length)} released for practice · ${String(sets.candidates.length)} held to screen · ${String(sets.admitted.length)} admitted`,
    ],
    [!scoring, "--target 0: the round scores no task and cannot read step. Its anchor is all it compares"],
    [sets.released.length === 0, "no task is released: the Builder has nothing to practise on"],
  ]);
  return { refusals, notes };
}

/** The same for an Examiner session on a campaign whose log is `events`, or null where the
 *  campaign has none here. It needs no set: what it writes is what a round later screens. */
export function examPreflight(events: readonly LogEvent[] | null, asked: Host) {
  const sets = setsOf(events ?? []);
  const waiting = carriable(events ?? []).waiting.map(({ task }) => task.taskId);
  const refusals = [
    ...said([
      [
        events === null,
        "the campaign has no log in this worktree: open it with tools/c/accept.ts and tools/m1/admit-sweep.ts --log <log> --feasible",
      ],
    ]),
    ...refused(asked),
  ];
  const notes = said([
    [
      waiting.length > 0,
      `${waiting.join(", ")} passed gate 3 in an earlier session and is handed to this one for its controls`,
    ],
    [
      sets.anchor.length > 0,
      "the anchor is drawn: what this session writes is a round's to screen, and is not drawn into the anchor",
    ],
    [
      events !== null && sets.anchor.length === 0,
      "no anchor is drawn: run tools/d2/prepare.ts after this session, and its tasks stand a chance of the anchor",
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
      target: { type: "string" },
      admitted: { type: "boolean", default: false },
      examiner: { type: "string" },
    },
  });
  const { name, session, target, "env-file": envFile } = values;
  if (!isString(name) || !isString(session)) {
    throw new Error(
      `usage: bun run runs launch [--env-file FILE] [--loaded] [--dry-run] <the flags of ${ROUND} or of ${EXAMINE}>`,
    );
  }
  const examining = isString(values.examiner);
  const own = new Set(
    tokens.flatMap((token) => {
      if (token.kind !== "option" || !OWN.has(token.name)) return [];
      return token.inlineValue === false ? [token.index, token.index + 1] : [token.index];
    }),
  );
  const flags = args.filter((_, index) => !own.has(index));
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
    spent: (examining ? claimed : spent)(events ?? [], session),
  };
  const { refusals, notes } = examining
    ? examPreflight(events, host)
    : preflight(setsOf(events ?? []), {
        ...host,
        target: isString(target) ? target : undefined,
        admitted: values.admitted === true,
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
    examining ? EXAMINE : ROUND,
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
  const found = runs()
    .filter((run) => names.includes(run.name))
    .flatMap((run) =>
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
    const events = logEvents(run.path);
    const session = events.findLast(({ kind }) => kind === "build.started")?.data.session;
    const cut = ran.some((arg) => arg.endsWith(EXAMINE))
      ? "An Examiner session's id names one session: the next takes another --session, and is handed the tasks this one left past gate 3"
      : isString(session)
        ? spent(events, session)
        : null;
    console.log(
      `  stopped, its log as it was. ${cut ?? "A round goes on from it when launched again with the same --session"}`,
    );
  }
  if (found.length > 0 && !values.yes) console.log("nothing is ended without --yes");
}
