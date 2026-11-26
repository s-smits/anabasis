/**
 * Which run a name is and which process writes it, as every verb of `bun run runs` and the
 * operator's page ask before they read or act on a log.
 */
import { EXAMINE } from "#src/campaign/admission.ts";
import { LOG_FILE, type LogEvent, read } from "#src/kernel/log.ts";
import { lastReports, startedComparisons } from "#src/kernel/reports.ts";
import { existsSync, readdirSync, readFileSync, readlinkSync, statSync } from "#src/meta/filesystem.ts";
import { gitText, mainTree, worktrees } from "#src/meta/git.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { decodeOutput, runSync, runTextSyncOrThrow } from "#src/meta/subprocess.ts";

export interface Run {
  readonly name: string;
  readonly tree: string;
  readonly path: string;
  readonly end: "comparison.reported" | "solve.finished";
  readonly seed?: boolean;
  readonly archived?: string;
}

export interface Running {
  readonly pid: number;
  readonly cwd: string;
  readonly args: readonly string[];
}

export const BUILDER = "tools/campaign/harness-builder.ts";
/** The draft holds a root as an Examiner session does, so run by itself it must not read as closed, or a
 *  stop would release its root and leave it running. */
export const DRAFT = "tools/eval/draft.ts";
export const SEED_FILE = "seed.json";
export const ROUND = "tools/campaign/round.ts";
/** The commands that write a campaign's log by hand, each naming it with `--name`: an Examiner
 *  session (which would otherwise read as closed while it ran), a standalone comparison and a
 *  Builder session alone. */
const BY_HAND = [EXAMINE, "tools/campaign/checkpoint.ts", "tools/campaign/session.ts", DRAFT];
export const CLI = "tools/runs/cli.ts";
export const SEAT = "system-path-simulation/scripts/live-seat.ts";
export const KEEPING = "--here";
const CAMPAIGN_END = "comparison.reported";
export const CAMPAIGNS = join(".ana", "d2");
export const ARCHIVE = join("data", "runs");
export const HERE = "here";
const PACK_REVISION = /(?:-anabasis)?(?:-v\d+[a-z0-9]*)?$/u;

export const harnessesOf = (repo: string, ...parts: readonly string[]) =>
  join(mainTree(repo), "data", "harnesses", ...parts);
export const archiveOf = (repo: string, ...parts: readonly string[]) =>
  join(mainTree(repo), ARCHIVE, ...parts);

export const fileStat = (path: string) => statSync(path, { throwIfNoEntry: false });

/** Linux lists a folder's names unsorted, so the archive would read in another order there than on macOS. */
const listed = (dir: string) => (fileStat(dir)?.isDirectory() === true ? readdirSync(dir).toSorted() : []);
const campaignIn = (dir: string, name: string, tree: string): Run => ({
  name,
  tree,
  path: join(dir, name, LOG_FILE),
  end: CAMPAIGN_END,
  seed: existsSync(join(dir, name, SEED_FILE)),
});
export const campaignOf = (tree: string, name: string) => campaignIn(join(tree, CAMPAIGNS), name, tree);
export const campaignsIn = (dir: string, tree: string): Run[] =>
  listed(dir)
    .filter((name) => existsSync(join(dir, name, LOG_FILE)))
    .map((name) => campaignIn(dir, name, tree));
export const isCampaign = (run: Run) => run.end === CAMPAIGN_END;
export class Misused extends Error {}

export function packOf(name: string): string {
  const fresh = name.indexOf("-fresh-");
  return fresh > 0 ? name.slice(0, fresh) : (name.split("-")[0] ?? name);
}

export function domainOf(name: string): string {
  const pack = packOf(name);
  const base = pack.replace(PACK_REVISION, "");
  return base === "" ? pack : base;
}
/**
 * Bun's first non-option argument after `nice` and `run`, so a shell whose command line merely
 * names the campaign command does not read as its writer. `runsAs` also maps pre-rename d2 and
 * d1b tool directories to `tools/campaign/` and `tools/eval/` while campaigns launched before the
 * rename are live; drop the mapping once none remain.
 */
function scriptOf(args: readonly string[]): string | undefined {
  const [bun, ...rest] = args[0] === "nice" ? args.slice(3) : args;
  if (bun === undefined || basename(bun) !== "bun") return undefined;
  const named = rest.filter((arg) => !arg.startsWith("-"));
  return named[0] === "run" ? named[1] : named[0];
}
const LEGACY_TOOL_DIR = /(^|\/)tools\/(d2|d1b)\//u;
export const runsAs = (args: readonly string[], tools: readonly string[]) => {
  const script = scriptOf(args);
  if (script === undefined) return false;
  const normalized = script.replace(
    LEGACY_TOOL_DIR,
    (_match, prefix: string, legacy: string) => `${prefix}tools/${legacy === "d2" ? "campaign" : "eval"}/`,
  );
  return tools.some((tool) => normalized.endsWith(tool));
};

function writesCampaign(args: readonly string[]): boolean {
  if (runsAs(args, [CLI])) return args.includes("rehearse");
  return runsAs(args, [BUILDER, ...BY_HAND]);
}

function runsIn(trees: readonly string[]): Run[] {
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

function archivedIn(main: string): Run[] {
  const root = join(main, ARCHIVE);
  return listed(root)
    .filter((from) => !from.startsWith("."))
    .flatMap((from) => campaignsIn(join(root, from), main).map((run) => ({ ...run, archived: from })));
}

const allRuns = (repo: string, trees = worktrees(repo)) => [
  ...runsIn(trees),
  ...archivedIn(trees[0] ?? repo),
];

export const runs = (repo = runtimeProcess.cwd()): Run[] => runsIn(worktrees(repo));

export const archived = (repo = runtimeProcess.cwd()): Run[] => archivedIn(mainTree(repo));

export const everyRun = (repo = runtimeProcess.cwd()): Run[] => allRuns(repo);

/** This machine's own campaigns, never a copy of a host's: a catalogue lists them to the other
 *  machines, and a refresh refuses a host's campaign that shares a name with one. */
export const originals = (repo = runtimeProcess.cwd()): Run[] =>
  allRuns(repo).filter((run) => isCampaign(run) && (run.archived === undefined || run.archived === HERE));

export function readable(repo = runtimeProcess.cwd()): Run[] {
  const trees = worktrees(repo);
  const held = runsIn(trees);
  const names = new Set(held.map(({ name }) => name));
  const kept = new Map<string, Run>();
  for (const run of archivedIn(trees[0] ?? repo)) {
    if (!names.has(run.name) && (!kept.has(run.name) || run.archived === HERE)) kept.set(run.name, run);
  }
  return [...held, ...kept.values()];
}

export function readNamed(name: string, repo = runtimeProcess.cwd()): Run {
  const trees = worktrees(repo);
  const held = runsIn(trees);
  if (held.some((run) => run.name === name && isCampaign(run))) return runNamed(name, held);
  const copies = archivedIn(trees[0] ?? repo).filter((run) => run.name === name);
  const own = copies.find((run) => run.archived === HERE);
  if (own !== undefined) return own;
  const [only, other] = copies;
  if (only === undefined) return runNamed(name, held);
  if (other !== undefined) {
    throw new Error(`${name} names copies from ${copies.map((run) => run.archived).join(" and from ")}`);
  }
  return only;
}

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

export function wholeLines(path: string): string {
  const text = readFileSync(path, "utf8");
  return text.slice(0, text.lastIndexOf("\n") + 1);
}

export function logEvents(path: string): LogEvent[] {
  if (!existsSync(path)) throw new Error(`no log at ${path}`);
  return read(path);
}

export function readLog(path: string): { readonly events: LogEvent[]; readonly size: number } | null {
  if (fileStat(path) === undefined) return null;
  const events = logEvents(path);
  const size = fileStat(path)?.size;
  return size === undefined ? null : { events, size };
}

export function standing(tree: string) {
  return { commit: gitText(tree, "rev-parse", "HEAD"), dirty: gitText(tree, "status", "--porcelain") !== "" };
}

function cwdOf(pid: string): string {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return "";
  }
}

export function processes(table = runTextSyncOrThrow(["ps", "-axo", "pid=,args="]).split("\n")): Running[] {
  const found = table.flatMap((row) => {
    const [pid = "", ...args] = row.trim().split(/\s+/);
    const kept = writesCampaign(args) || runsAs(args, [CLI]);
    return kept || args.some((arg) => arg.endsWith(SEAT)) ? [{ pid, args }] : [];
  });
  if (found.length === 0) return [];
  // Linux names each cwd in /proc. Its lsof walks every descriptor up to the open-file limit Bun
  // raises for its children, which takes far longer than reading /proc.
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

export function flagOf(args: readonly string[], name: string): string | undefined {
  const joined = args.find((arg) => arg.startsWith(`${name}=`));
  if (joined !== undefined) return joined.slice(name.length + 1);
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

export const ownArgs = (args: readonly string[]) =>
  args.slice(0, args.includes("--") ? args.indexOf("--") : args.length);

export function writers(run: Run, running: readonly Running[]): Running[] {
  const writes = (args: readonly string[]) =>
    isCampaign(run) && writesCampaign(args) && flagOf(args, "--name") === run.name;
  // The worktree is the script's, as the campaign command places its log by its own checkout
  // (`campaignLog`), not the working directory, which would read a script of another checkout run
  // from this one as this one's writer. Every script is `tools/<dir>/<file>`.
  const treeOf = (cwd: string, args: readonly string[]) =>
    dirname(dirname(dirname(resolve(cwd, scriptOf(args) ?? ""))));
  return running.filter(({ cwd, args }) => treeOf(cwd, args) === run.tree && writes(args));
}

/** An old ladder's reading is not one: no move goes on with it, and left open it would keep a run
 *  from resting or moving commit for good. */
export function openComparisons(events: readonly LogEvent[]): string[] {
  const reported = new Set(lastReports(events).map(({ session }) => session));
  return startedComparisons(events).filter((session) => !reported.has(session));
}

export const keeperLogPath = (run: Run) => join(dirname(run.path), "keep.out");

const cliMatches = (running: readonly Running[], match: (args: readonly string[]) => boolean) =>
  running.flatMap(({ pid, args }) =>
    pid !== runtimeProcess.pid && runsAs(args, [CLI]) && match(args) ? [pid] : [],
  );

export const waiters = (name: string, running: readonly Running[] = processes()): number[] =>
  cliMatches(running, (args) => {
    const after = args.some((arg) => arg === "--after" || arg.startsWith("--after="));
    const at = args.findIndex((arg) => arg === "pause" || (after && arg === "continue"));
    return at !== -1 && args.slice(at + 1).includes(name);
  });

export const keepers = (name: string, running: readonly Running[] = processes()): number[] =>
  cliMatches(running, (args) => {
    const at = args.indexOf("keep");
    return at !== -1 && args.includes(KEEPING) && args[at + 1] === name;
  });
