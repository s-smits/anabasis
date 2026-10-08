/**
 * Launch a round once its log says it can report something, and stop a run: v1's launch-run, on
 * v2's records.
 *
 *   bun run runs launch [--env-file FILE] [--loaded] [--dry-run] <the flags of tools/d2/round.ts>
 *   bun run runs stop <name> ... [--yes]
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
 * It then starts `round.ts` with the same flags, niced, in a process group of its own, with its
 * output in `.ana/d2/<name>/launch-<session>.out` and `.err`, and writes `launch-<session>.json`
 * beside them: the flags, the commit and the load it started under. Starting proves the process
 * stayed up for `START_MS`, and no model work.
 *
 * `stop` ends the process that writes each named run's log and every process that one started, and
 * nothing else: a round started by hand can share its process group with a sibling. A name is
 * matched whole. Without `--yes` it prints what it would end. A round goes on from its log when it
 * is launched again with the same `--session`, unless the stop fell inside its Builder session: that
 * session never finished, the round refuses a second one under its id, and so does `launch`.
 */
import { existsSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isString } from "#src/meta/json-shape.ts";
import { availableParallelism, loadavg } from "#src/meta/os.ts";
import { dirname, join } from "#src/meta/path.ts";
import { capturedExecPath, capturedSpawn, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { runTextSyncOrThrow, terminateAndReapProcessGroupId } from "#src/meta/subprocess.ts";
import { spent } from "#src/builder/round.ts";
import { setsOf } from "../d2/campaign.ts";
import { logEvents, processes, ROUND, runs, writers } from "./pulse.ts";

const START_MS = 8000;
/** The launcher's own flags; every other one is the round's. */
const OWN = new Set(["env-file", "loaded", "dry-run"]);

/** What a launch is asked for and finds on the host. */
export interface Asked {
  /** `--target`, as given: only "0" asks for no scored task. */
  readonly target: string | undefined;
  readonly admitted: boolean;
  readonly loaded: boolean;
  readonly load: number;
  readonly cores: number;
  /** The processes already writing this round's log. */
  readonly running: readonly number[];
  /** The `--env-file` that is not there, or null. */
  readonly missing: string | null;
  /** Why the round would refuse this session's id (`spent`), or null. */
  readonly spent: string | null;
}

/** Why a round should not start, and what its reader should know when it does. */
export function preflight(sets: ReturnType<typeof setsOf>, asked: Asked) {
  const scoring = asked.target !== "0";
  const toScreen = sets.candidates.length + (asked.admitted ? sets.admitted.length : 0);
  const said = (rows: readonly (readonly [boolean, string])[]) =>
    rows.flatMap(([holds, text]) => (holds ? [text] : []));
  const refusals = said([
    [
      sets.feasible.length === 0,
      "the log holds no feasible task: put the pack's tasks in it with tools/m1/admit-sweep.ts --log <log> --feasible",
    ],
    [sets.feasible.length > 0 && sets.anchor.length === 0, "no anchor is drawn: run tools/d2/prepare.ts"],
    [
      scoring && toScreen === 0 && sets.anchor.length > 0,
      "no task is held outside the anchor, so the round has nothing to screen and cannot step: run an Examiner session (tools/d1b/examine.ts), or pass --target 0 for a round that reads its anchor alone",
    ],
    [asked.running.length > 0, `the round is already running here, as pid ${asked.running.join(", ")}`],
    [
      asked.load > asked.cores && !asked.loaded,
      `the host's load is ${asked.load.toFixed(1)} on ${String(asked.cores)} cores: a round started into it slows every other and reaches walls an idle host would not. Wait, or pass --loaded when its times will not be compared`,
    ],
    [asked.missing !== null, `${String(asked.missing)} is not there`],
    [asked.spent !== null, `${String(asked.spent)}. Pass another --session`],
  ]);
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
    },
  });
  const { name, session, target, "env-file": envFile } = values;
  if (!isString(name) || !isString(session)) {
    throw new Error(
      `usage: bun run runs launch [--env-file FILE] [--loaded] [--dry-run] <the flags of ${ROUND}>`,
    );
  }
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
  const events = run === undefined ? [] : logEvents(run.path);
  const { refusals, notes } = preflight(setsOf(events), {
    target: isString(target) ? target : undefined,
    admitted: values.admitted === true,
    loaded: values.loaded === true,
    load,
    cores,
    running: run === undefined ? [] : writers(run, processes()).map(({ pid }) => pid),
    missing: isString(envFile) && !existsSync(envFile) ? envFile : null,
    spent: spent(events, session),
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
    ROUND,
    ...flags,
  ];
  if (values["dry-run"] === true) {
    console.log(`would start: ${cmd.join(" ")}`);
    return;
  }
  const git = (...rest: string[]) => runTextSyncOrThrow(["git", ...rest]).trim();
  const base = join(dirname(run.path), `launch-${session}`);
  const child = start(cmd, base);
  const receipt = {
    at: new Date().toISOString(),
    pid: child.pid,
    flags,
    envFile: isString(envFile) ? envFile : null,
    commit: git("rev-parse", "HEAD"),
    dirty: git("status", "--porcelain") !== "",
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
    .flatMap((run) => writers(run, running).map(({ pid }) => ({ run, pids: family(table, pid) })));
  if (found.length === 0) console.log("none of these is running");
  for (const { run, pids } of found) {
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
    const cut = isString(session) ? spent(events, session) : null;
    console.log(
      `  stopped, its log as it was. ${cut ?? "A round goes on from it when launched again with the same --session"}`,
    );
  }
  if (found.length > 0 && !values.yes) console.log("nothing is ended without --yes");
}
