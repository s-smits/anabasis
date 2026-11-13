/**
 * Which run a name is and which process writes it: what every verb of `bun run runs` and the
 * operator's page (`packages/ui`) ask before they read or act on a log.
 *
 * A run is a log in one of the repository's worktrees: a campaign's `.ana/d2/<name>/log.jsonl`, or
 * a live solve's `.ana/live/<name>.jsonl`. It is open while a process that writes it runs in that
 * worktree, and a name is a campaign's whole name: two campaigns have run under one name in two
 * worktrees (13 October), so a verb that acts on one refuses a name that is two (`runNamed`).
 *
 * Until 15 October this was the head of `pulse.ts`, and each verb that acted on one run matched
 * names its own way: `stop` by every tree's campaign of the name, `view` by this worktree's, and
 * `zip` and the pulse by what a name holds, which is a reader's convenience and no way to choose a
 * run to stop.
 *
 * A campaign that has left its worktree is in the archive, `data/runs/` of the main worktree
 * (`ARCHIVE`): this machine's own under `here/`, put there by `runs retire`, and a copy of one a
 * host holds under that host's name, put there by `runs fetch` and by `runs retire`. No verb acts
 * on an archived campaign, which no process writes, and the readers read it (`readable`,
 * `readNamed`): until 20 October a retired campaign went to the main worktree's `.ana/d2`, where
 * every verb took it for a run, and was deleted 14 days after it closed.
 */
import { EXAMINE } from "#src/campaign/admission.ts";
import { LOG_FILE, type LogEvent } from "#src/kernel/log.ts";
import { lastReports } from "#src/kernel/reports.ts";
import { existsSync, readdirSync, readFileSync, readlinkSync } from "#src/meta/filesystem.ts";
import { gitText, mainTree, worktrees } from "#src/meta/git.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { isString } from "#src/meta/json-shape.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { decodeOutput, runSync, runTextSyncOrThrow } from "#src/meta/subprocess.ts";

export interface Run {
  readonly name: string;
  readonly tree: string;
  readonly path: string;
  /** The event that says the run is done: a campaign's comparison reports, a live solve finishes. */
  readonly end: "comparison.reported" | "solve.finished";
  /** A copy of another campaign, made to rehearse on (`seed.ts`). */
  readonly seed?: boolean;
  /** The machine an archived campaign came from: `here`, or a host `ANA_HOSTS` lists. */
  readonly archived?: string;
}

/** A process that may write a log: its id, the worktree it runs in and its arguments. */
export interface Running {
  readonly pid: number;
  readonly cwd: string;
  readonly args: readonly string[];
}

/** The command a whole campaign runs as, which runs each of its moves in its own process. */
export const BUILDER = "tools/d2/harness-builder.ts";
/** The command the session that drafts an exam runs as. It holds a root as an Examiner session
 *  does since 11 October, and run by itself it was read as closed while it ran: a stop would have
 *  released its root and left it running. */
export const DRAFT = "tools/d1b/draft.ts";
/** The file beside a log that says its campaign is a seed, and of what. */
export const SEED_FILE = "seed.json";
/** The command that runs one round of a campaign by hand. */
export const ROUND = "tools/d2/round.ts";
/** The commands that write a campaign's log by hand, each naming it with `--name`: a round, an
 *  Examiner session (read as closed while it ran, the first time one did: exam-1, 2026-10-08), a
 *  standalone comparison and a Builder session alone. */
const BY_HAND = [ROUND, EXAMINE, "tools/d2/checkpoint.ts", "tools/d2/session.ts", DRAFT];
/** This CLI, whose verbs start, read and stop runs; `rehearse` alone writes a log. */
export const CLI = "tools/runs/cli.ts";
const LIVE = "tools/m0/live-solve.ts";
export const SEAT = "system-path-simulation/scripts/live-seat.ts";
/** The flag a keeper runs under once it has left the verb that started it (`keep.ts`). */
export const KEEPING = "--here";
const CAMPAIGN_END = "comparison.reported";
/** Where a worktree keeps its campaigns, one folder each. */
export const CAMPAIGNS = join(".ana", "d2");
/** The archive, under the main worktree, which git ignores. */
export const ARCHIVE = join("data", "runs");
/** The archive's folder of this machine's own campaigns, and the word `runs move` names it by. */
export const HERE = "here";

/** The harnesses campaigns hand over, one folder each, under the main worktree, which git ignores:
 *  `runs fresh` names a campaign's own there, and `close.ts` writes there by hand (27 October). */
export const harnessesOf = (repo: string, ...parts: readonly string[]) =>
  join(mainTree(repo), "data", "harnesses", ...parts);
/** A path in the archive of the repository `repo` lies in. */
export const archiveOf = (repo: string, ...parts: readonly string[]) =>
  join(mainTree(repo), ARCHIVE, ...parts);

/** A folder's names in one order on every host: Linux's file systems list them unsorted, and on 20
 *  October the archive's campaigns read in another order there than on macOS. */
const listed = (dir: string) => (existsSync(dir) ? readdirSync(dir).toSorted() : []);
/** The campaign `name` whose folder lies in `dir`, read as `tree`'s. */
const campaignIn = (dir: string, name: string, tree: string): Run => ({
  name,
  tree,
  path: join(dir, name, LOG_FILE),
  end: CAMPAIGN_END,
  seed: existsSync(join(dir, name, SEED_FILE)),
});
/** The campaign `name` of the worktree `tree`, whether or not its log is there yet. */
export const campaignOf = (tree: string, name: string) => campaignIn(join(tree, CAMPAIGNS), name, tree);
/** The campaigns whose folders in `dir` hold a log, read as `tree`'s. */
export const campaignsIn = (dir: string, tree: string): Run[] =>
  listed(dir)
    .filter((name) => existsSync(join(dir, name, LOG_FILE)))
    .map((name) => campaignIn(dir, name, tree));
/** Whether `run` is a campaign, as against a live solve. */
export const isCampaign = (run: Run) => run.end === CAMPAIGN_END;
/** A verb given words it cannot act on: the CLI answers with the usage the head of the verb's file
 *  states, the one owner of it, under the message where there is one. Until 11 November each verb
 *  threw a usage line of its own, and 12 of the 18 had come to differ from the head's. */
export class Misused extends Error {}

/** A campaign's pack, from its name, the one place a stored campaign keeps it: what stands before
 *  the first `-fresh-` of the `<pack>-fresh-<model>...` that `runs fresh` names, so a hyphenated
 *  pack stays whole, else the name's first word, as campaigns named by hand were read. */
export function packOf(name: string): string {
  const fresh = name.indexOf("-fresh-");
  return fresh > 0 ? name.slice(0, fresh) : (name.split("-")[0] ?? name);
}
/**
 * The script a process runs: Bun's first argument that is no option of its own, under `nice` where
 * `start` started it niced, and after `run` where it was named so. Until 20 October any argument
 * ending in a script's path counted, so a shell whose command line merely named the campaign
 * command read as its writer.
 */
function scriptOf(args: readonly string[]): string | undefined {
  const [bun, ...rest] = args[0] === "nice" ? args.slice(3) : args;
  if (bun === undefined || basename(bun) !== "bun") return undefined;
  const named = rest.filter((arg) => !arg.startsWith("-"));
  return named[0] === "run" ? named[1] : named[0];
}
export const runsAs = (args: readonly string[], tools: readonly string[]) => {
  const script = scriptOf(args);
  return script !== undefined && tools.some((tool) => script.endsWith(tool));
};

/**
 * Whether a process writes a campaign's log: the campaign command, a command run by hand, or a
 * rehearsal (`rehearse.ts`), a round on a seed run as a verb of this CLI. A stop releases what a
 * run nobody writes left mounted, so a writer missed here would lose its roots: unlisted, two
 * campaign commands read as closed, `runs stop` answered "none of these is running" and counted a
 * live session's root as left behind (2026-10-10).
 *
 * Any other verb of this CLI is none, whatever its command line carries: on 10 October a launch of
 * a round into the tree that held its log was refused as "already being written here" by the one
 * process that matched, the launcher itself.
 */
function writesCampaign(args: readonly string[]): boolean {
  if (runsAs(args, [CLI])) return args.includes("rehearse");
  return runsAs(args, [BUILDER, ...BY_HAND]);
}

/** Every run log in the worktrees of the repository `repo` lies in. */
export function runs(repo = runtimeProcess.cwd()): Run[] {
  const trees = worktrees(repo);
  return trees.flatMap((tree) => [
    ...campaignsIn(join(tree, CAMPAIGNS), tree),
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

/** Every campaign the archive holds, under the main worktree of the repository `repo` lies in. */
export function archived(repo = runtimeProcess.cwd()): Run[] {
  const main = mainTree(repo);
  const root = archiveOf(main);
  // `here` and a folder for each host; a dot file beside them (`.DS_Store`) holds no campaign.
  return listed(root)
    .filter((from) => !from.startsWith("."))
    .flatMap((from) => campaignsIn(join(root, from), main).map((run) => ({ ...run, archived: from })));
}

/** This machine's original campaigns: its worktrees' and its own archive's, never a copy of a host's.
 *  A catalogue lists these to the other machines, and a refresh refuses a host's campaign that
 *  shares a name with one. */
export const originals = (repo = runtimeProcess.cwd()): Run[] =>
  [...runs(repo), ...archived(repo).filter((run) => run.archived === HERE)].filter(isCampaign);

/** Every run a name can be taken by: the worktrees' and the archive's. */
export const everyRun = (repo = runtimeProcess.cwd()): Run[] => [...runs(repo), ...archived(repo)];

/** The runs a reader reads: every worktree's, and one archived copy of each campaign whose name none
 *  of those has, this machine's before a host's, so a page keys it and a zip stages it once. */
export function readable(repo = runtimeProcess.cwd()): Run[] {
  const held = runs(repo);
  const names = new Set(held.map(({ name }) => name));
  const copies = new Map<string, Run>();
  for (const run of archived(repo)) {
    if (!names.has(run.name) && (!copies.has(run.name) || run.archived === HERE)) copies.set(run.name, run);
  }
  return [...held, ...copies.values()];
}

/** The campaign `name` a reader reads: the one a worktree holds, else this machine's archived one,
 *  else a host's copy, refused where two hosts' copies are all there is. */
export function readNamed(name: string, repo = runtimeProcess.cwd()): Run {
  const held = runs(repo);
  if (held.some((run) => run.name === name && isCampaign(run))) return runNamed(name, held);
  const copies = archived(repo).filter((run) => run.name === name);
  const own = copies.find((run) => run.archived === HERE);
  if (own !== undefined) return own;
  const [only, other] = copies;
  if (only === undefined) return runNamed(name, held);
  if (other !== undefined) {
    throw new Error(`${name} names copies from ${copies.map((run) => run.archived).join(" and from ")}`);
  }
  return only;
}

/** The one campaign named `name`, whole, among `among`: refused where none is and where two
 *  worktrees hold one. An archived campaign is none: no process writes it until `runs copy` brings
 *  it back to a worktree. */
export function runNamed(name: string, among: readonly Run[] = runs()): Run {
  const found = among.filter((run) => run.name === name && isCampaign(run));
  const [only, other] = found;
  if (only === undefined) {
    const back = archived().some((run) => run.name === name && run.archived === HERE)
      ? `: it is archived, and runs copy ${name} --to <worktree> brings it back`
      : "";
    throw new Error(`no campaign log is named ${name} in this repository's worktrees${back}`);
  }
  if (other !== undefined) {
    throw new Error(`${name} names a campaign in ${found.map(({ tree }) => tree).join(" and in ")}`);
  }
  return only;
}

/** A log's text up to its last whole line: a torn last line is an append in flight. */
export function wholeLines(path: string): string {
  const text = readFileSync(path, "utf8");
  return text.slice(0, text.lastIndexOf("\n") + 1);
}

/** The whole lines of a log an append may be writing to. */
export function logEvents(path: string): LogEvent[] {
  return wholeLines(path)
    .split("\n")
    .slice(0, -1)
    .map((line) => parseJsonAs<LogEvent>(line));
}

/** Where a worktree stands: its commit, and whether it holds a change no commit names. */
export function standing(tree: string) {
  return { commit: gitText(tree, "rev-parse", "HEAD"), dirty: gitText(tree, "status", "--porcelain") !== "" };
}

/** A process's cwd from /proc, or "" for one that left between the two reads, as lsof leaves it. */
function cwdOf(pid: string): string {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return "";
  }
}

/** Every process that may write a run's log, keep one going or seat a simulation, with its worktree:
 *  one table (a row of `ps` pids and arguments each), so `writers`, `keepers` and seats read one moment. */
export function processes(table = runTextSyncOrThrow(["ps", "-axo", "pid=,args="]).split("\n")): Running[] {
  const found = table.flatMap((row) => {
    const [pid = "", ...args] = row.trim().split(/\s+/);
    // Every verb of this CLI, so that a keeper and a pause waiting on a run are seen beside its writers.
    const kept = writesCampaign(args) || runsAs(args, [LIVE, CLI]);
    return kept || args.some((arg) => arg.endsWith(SEAT)) ? [{ pid, args }] : [];
  });
  if (found.length === 0) return [];
  // Linux names each cwd in /proc. Its lsof walks every descriptor up to the open-file limit Bun
  // raises for its children, which took 0.77 s on the Linux runner against 0.04 s (30 October).
  if (existsSync("/proc/self/cwd")) {
    return found.map(({ pid: id, args }) => ({ pid: Number(id), cwd: cwdOf(id), args }));
  }
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

/** The value of the flag `name` on a command line, in either form `parseArgs` takes (`--name x` and
 *  `--name=x`), or undefined where it is absent. Until 20 October a campaign started by hand with
 *  `--name=r1` read as closed while it wrote, and until 10 November an absent flag read as `args[0]`. */
export function flagOf(args: readonly string[], name: string): string | undefined {
  const joined = args.find((arg) => arg.startsWith(`${name}=`));
  if (joined !== undefined) return joined.slice(name.length + 1);
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

/** A command line's own arguments, those before any `--`. */
export const ownArgs = (args: readonly string[]) =>
  args.slice(0, args.includes("--") ? args.indexOf("--") : args.length);

/** The processes in `running` that write `run`'s log: a campaign's by its name, a live solve's by
 *  the task and cycle its name begins with. */
export function writers(run: Run, running: readonly Running[]): Running[] {
  const writes = (args: readonly string[]) =>
    run.end === CAMPAIGN_END
      ? writesCampaign(args) && flagOf(args, "--name") === run.name
      : runsAs(args, [LIVE]) &&
        run.name.startsWith(`${String(flagOf(args, "--task"))}-${String(flagOf(args, "--cycle"))}-`);
  // The worktree is the script's, as the campaign command places its log by its own checkout
  // (`campaignLog`): until 20 October it was the working directory, and a script of another
  // checkout run from this one was read as this one's writer. Every script is `tools/<dir>/<file>`.
  const treeOf = (cwd: string, args: readonly string[]) =>
    dirname(dirname(dirname(resolve(cwd, scriptOf(args) ?? ""))));
  return running.filter(({ cwd, args }) => treeOf(cwd, args) === run.tree && writes(args));
}

/** The comparisons of `events` that began and have not reported. An old ladder's reading is none:
 *  no move goes on with one since the ladder was retired on 16 October, so one left open would
 *  keep a run from resting and from moving to another commit for good. */
export function openComparisons(events: readonly LogEvent[]): string[] {
  const reported = new Set(lastReports(events).map(({ session }) => session));
  const begun = events.flatMap(({ kind, data }) =>
    kind === "comparison.started" && data.ladder !== true ? [data.session] : [],
  );
  return [...new Set(begun.filter(isString))].filter((session) => !reported.has(session));
}

/** The file beside `run`'s log that holds its keeper's output. */
export const keptFile = (run: Run) => join(dirname(run.path), "keep.out");

/** The processes in `running`, but this one, that wait to stop campaign `name`, named before or after
 *  their flags: a `runs pause`, or a `runs continue --after`, which starts the run again once it has
 *  stopped. */
export const waiters = (name: string, running: readonly Running[] = processes()): number[] =>
  running.flatMap(({ pid, args }) => {
    const after = args.some((arg) => arg === "--after" || arg.startsWith("--after="));
    const at = args.findIndex((arg) => arg === "pause" || (after && arg === "continue"));
    const waits = runsAs(args, [CLI]) && at !== -1 && args.slice(at + 1).includes(name);
    return waits && pid !== runtimeProcess.pid ? [pid] : [];
  });

/** The processes in `running`, but this one, that keep campaign `name` going (`runs keep`, `keep.ts`). */
export const keepers = (name: string, running: readonly Running[] = processes()): number[] =>
  running.flatMap(({ pid, args }) => {
    const at = args.indexOf("keep");
    const kept = runsAs(args, [CLI]) && at !== -1 && args.includes(KEEPING) && args[at + 1] === name;
    return kept && pid !== runtimeProcess.pid ? [pid] : [];
  });
