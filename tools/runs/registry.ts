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
import { EXAMINE } from "#src/builder/admission.ts";
import { LOG_FILE, type LogEvent } from "#src/kernel/log.ts";
import { lastReports } from "#src/kernel/reports.ts";
import { existsSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { gitText, mainTree, worktrees } from "#src/meta/git.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { isString } from "#src/meta/json-shape.ts";
import { basename, join } from "#src/meta/path.ts";
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
/** The commands that write a campaign's log by hand, each naming it with `--name`: a round, an
 *  Examiner session (read as closed while it ran, the first time one did: exam-1, 2026-10-08), a
 *  checkpoint and a Builder session alone. */
const BY_HAND = ["tools/d2/round.ts", EXAMINE, "tools/d2/checkpoint.ts", "tools/d2/session.ts", DRAFT];
/** This CLI, whose verbs start, read and stop runs; `rehearse` alone writes a log. */
export const CLI = "tools/runs/cli.ts";
const LIVE = "tools/m0/live-solve.ts";
/** The flag a keeper runs under once it has left the verb that started it (`keep.ts`). */
export const KEEPING = "--here";
const CAMPAIGN_END = "comparison.reported";
/** Where a worktree keeps its campaigns, one folder each. */
export const CAMPAIGNS = join(".ana", "d2");
/** The archive, under the main worktree, which git ignores. */
export const ARCHIVE = join("data", "runs");
/** The archive's folder of this machine's own campaigns, and the word `runs move` names it by. */
export const HERE = "here";

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
const runsAs = (args: readonly string[], tools: readonly string[]) =>
  args.some((arg) => tools.some((tool) => arg.endsWith(tool)));

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
  // The package script `bun run runs <verb>`, which holds no log open whatever the verb: a
  // rehearsal's log is written by the CLI process it starts.
  if (args[1] === "run" && args[2] === "runs") return false;
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

/** Every process that may write a run's log, with the worktree it runs in. */
export function processes(): Running[] {
  const table = runTextSyncOrThrow(["ps", "-axo", "pid=,args="]).split("\n");
  const found = table.flatMap((row) => {
    const [pid = "", ...args] = row.trim().split(/\s+/);
    return writesCampaign(args) || runsAs(args, [LIVE]) ? [{ pid, args }] : [];
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

/** The processes in `running` that write `run`'s log: a campaign's by its name, a live solve's by
 *  the task and cycle its name begins with. A flag is read in both forms `parseArgs` takes: until
 *  20 October a campaign started by hand with `--name=r1` read as closed while it wrote. */
export function writers(run: Run, running: readonly Running[]): Running[] {
  const flag = (args: readonly string[], name: string) =>
    args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? args[args.indexOf(name) + 1];
  const writes = (args: readonly string[]) =>
    run.end === CAMPAIGN_END
      ? writesCampaign(args) && flag(args, "--name") === run.name
      : runsAs(args, [LIVE]) &&
        run.name.startsWith(`${String(flag(args, "--task"))}-${String(flag(args, "--cycle"))}-`);
  return running.filter(({ cwd, args }) => cwd === run.tree && writes(args));
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

/** The processes that keep campaign `name` going (`keep.ts`), but this one. */
export function keepers(name: string): number[] {
  return runTextSyncOrThrow(["ps", "-axo", "pid=,args="])
    .split("\n")
    .flatMap((row) => {
      const [pid = "", ...args] = row.trim().split(/\s+/);
      const at = args.indexOf("keep");
      return runsAs(args, [CLI]) && at !== -1 && args[at + 1] === name && args.includes(KEEPING)
        ? [Number(pid)]
        : [];
    })
    .filter((pid) => pid !== runtimeProcess.pid);
}
