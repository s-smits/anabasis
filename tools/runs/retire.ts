/**
 * Retire what the checkouts no longer use, and keep every campaign's traces.
 *
 *   bun --env-file=.env.runs run runs retire [--days 1] [--yes]
 *
 * A campaign no process writes or keeps (`writers`, `keepers`), whose log has not grown for
 * `--days`, leaves its worktree whole for the archive, `data/runs/here/<name>/` under the main
 * worktree (`ARCHIVE`), which git ignores; where the archive has the name already, it is filed
 * under `<name>.<its tree's folder>` (recode ran under one name in two trees). A live solve's log
 * goes to `here/.live/`. The readers read the archive, and `runs copy <name> --to <worktree>` brings
 * a campaign back to go on with, so one paused for longer than `--days` without a keeper is copied
 * back before `continue`.
 *
 * A seed (`seed.json` beside its log) is deleted instead, in a worktree or in the archive, once its
 * log has not grown for `--days`: it is a copy of a cut log made to rehearse on, and its source keeps
 * the record. On 20 October a sweep would have archived 563 of them, 547 left by the suite.
 *
 * A worktree other than the main one is then deleted once nothing has used it for `TREE_DAYS`: no
 * process works in it or names it on its command line, it holds no run log, and its last commit and
 * its top entries are older. One with a change no commit names stays for `DIRTY_DAYS`. Its
 * campaigns leave for the archive after `--days`, so the traces gather in one place within a day
 * while the tree waits a week for a session to come back to it (operator, 21 October). The
 * controllers a host prepares are worktrees too, and pruning them is `code.ts`'s alone
 * (`controllersOf`).
 *
 * A local branch no worktree holds goes once nothing has used it for `TREE_DAYS`: its last commit
 * and its reflog are older. Every land, restack, park and Codex lane leaves one, and until
 * 28 October nothing removed them: 1,243 had piled up here, 597 of them `claude/*`. A branch of an
 * open pull request lives on the remote, so the local copy is only a cache of it.
 *
 * A commit that a deleted tree or branch held, and that nothing else keeps reachable, keeps a local
 * tag `retired/<sha9>` (the repository is public, so the tag is not pushed). One rev-list decides
 * every such commit of a sweep, and the sweep reads the process table, the worktree listing and
 * every head's commit time once: until 28 October it asked `ps`, `lsof` and `git log` once per tree
 * and `branch --contains` once per deleted tree, 4.7 s for a dry run over 224 trees.
 *
 * Only the repository's worktrees are swept, so a separate clone is never read. Every host sweeps
 * its own originals with its own daily job, and this one then refreshes each configured host's
 * records through snapshots.ts. Without --yes it describes the sweep and changes nothing.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from "#src/meta/filesystem.ts";
import { gitMaybe, gitText, mainTree } from "#src/meta/git.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { decodeOutput, runSync, runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { controllersOf } from "./code.ts";
import { hostsOf } from "./host-config.ts";
import { syncRuns } from "./snapshots.ts";
import { archived, archiveOf, HERE, keepers, processes, runs, writers } from "./registry.ts";

/** What one sweep is asked: the main worktree, how long idle is, the time, and whether to act. */
export interface Sweep {
  readonly main: string;
  readonly days: number;
  readonly now: number;
  readonly yes: boolean;
}

/** A worktree as git lists it: its path, its commit and its branch, where it has each. */
interface Tree {
  readonly path: string;
  readonly head: string | null;
  readonly branch: string | null;
}

const DAY_MS = 86_400_000;
/** A worktree or branch nothing uses stays this long, and a tree with a change no commit names twice
 *  as long: past it the system has moved too far for the change to apply (operator, 26 September). */
const TREE_DAYS = 7;
const DIRTY_DAYS = 14;
const USAGE = "usage: bun run runs retire [--days 1] [--yes]";

const say = (sweep: Sweep, line: string) => console.log(`${sweep.yes ? "" : "would: "}${line}`);
const daysSince = (sweep: Sweep, ms: number) => (sweep.now - ms) / DAY_MS;

/** Every run no process writes or keeps whose log has not grown for `days`, moved to the archive,
 *  and every such seed, the archive's too, deleted. Returns the logs it moved or deleted, or would. */
export function archiveIdle(sweep: Sweep): Set<string> {
  const moved = new Set<string>();
  const taken = new Set<string>();
  const own = archiveOf(sweep.main, HERE);
  for (const run of [...runs(sweep.main), ...archived(sweep.main).filter((each) => each.seed === true)]) {
    if (daysSince(sweep, lstatSync(run.path).mtimeMs) < sweep.days) continue;
    // Read again for each run: one launched while the sweep ran is live.
    if (writers(run, processes()).length > 0 || keepers(run.name).length > 0) continue;
    const from = run.end === "solve.finished" ? run.path : dirname(run.path);
    if (run.seed === true) {
      say(sweep, `${from}: a seed, deleted`);
      moved.add(run.path);
      if (sweep.yes) rmSync(from, { recursive: true, force: true });
      continue;
    }
    // Its name, or its name after its tree's where that is taken, on disk or earlier in this sweep
    // (two trees' live solve logs share a file name).
    const name = run.end === "solve.finished" ? join(".live", basename(run.path)) : run.name;
    const to = [name, `${name}.${basename(run.tree)}`]
      .map((each) => join(own, each))
      .find((path) => !existsSync(path) && !taken.has(path));
    if (to === undefined) {
      console.error(`${from}: the archive holds ${run.name} under both its names, so it stays`);
      continue;
    }
    say(sweep, `${from} -> ${to}`);
    moved.add(run.path);
    taken.add(to);
    if (!sweep.yes) continue;
    mkdirSync(dirname(to), { recursive: true });
    // mv, which copies where the two lie on different volumes (a worktree under /tmp on Linux).
    runTextSyncOrThrow(["mv", from, to]);
  }
  return moved;
}

/** Every worktree with its commit and branch, from one listing; the main one first. */
function treesOf(main: string): Tree[] {
  return gitText(main, "worktree", "list", "--porcelain")
    .split("\n\n")
    .map((block) => {
      const field = (key: string) =>
        block
          .split("\n")
          .find((line) => line.startsWith(`${key} `))
          ?.slice(key.length + 1) ?? null;
      return {
        path: field("worktree") ?? "",
        head: field("HEAD"),
        branch: field("branch")?.slice(11) ?? null,
      };
    });
}

/** Every process's command line and working directory, read at once: a tree any names is in use. */
function users(): string[] {
  // lsof exits 1 when a process left between its reads, so its answer is read as given.
  const cwds = decodeOutput(runSync(["lsof", "-a", "-d", "cwd", "-Fn"]).stdout)
    .split("\n")
    .flatMap((line) => (line.startsWith("n") ? [`${line.slice(1)}/`] : []));
  return [...runTextSyncOrThrow(["ps", "-axo", "args="]).split("\n"), ...cwds];
}

/** Tags each of `tips` that nothing else keeps reachable: no ref but the branches `leaving`, and no
 *  head but `staying`'s. One rev-list answers for all of them. */
function keepCommits(
  sweep: Sweep,
  tips: readonly string[],
  leaving: readonly string[],
  staying: readonly string[],
) {
  if (tips.length === 0) return;
  const unheld = new Set(
    gitText(
      sweep.main,
      "rev-list",
      ...tips,
      "--not",
      "--single-worktree",
      ...leaving.map((name) => `--exclude=refs/heads/${name}`),
      "--all",
      ...staying,
    ).split("\n"),
  );
  for (const tip of new Set(tips.filter((each) => unheld.has(each)))) {
    say(sweep, `tag retired/${tip.slice(0, 9)} keeps ${tip.slice(0, 9)}, which nothing else holds`);
    if (sweep.yes) gitText(sweep.main, "update-ref", `refs/tags/retired/${tip.slice(0, 9)}`, tip);
  }
}

/** The trees nothing has used for `TREE_DAYS`, outermost last so a nested tree goes first; a run log
 *  in `archiving` counts as gone. */
function idleTrees(sweep: Sweep, trees: readonly Tree[], archiving: ReadonlySet<string>): Tree[] {
  const logs = new Set(runs(sweep.main).flatMap((run) => (archiving.has(run.path) ? [] : [run.tree])));
  const controllers = controllersOf(sweep.main);
  const heads = trees.flatMap((tree) => tree.head ?? []);
  const committed = new Map(
    (heads.length === 0 ? "" : gitText(sweep.main, "log", "--no-walk=unsorted", "--format=%H %ct", ...heads))
      .split("\n")
      .map((line) => [line.slice(0, line.indexOf(" ")), Number(line.slice(line.indexOf(" ") + 1)) * 1000]),
  );
  const seen = users();
  return trees
    .filter((tree) => existsSync(tree.path) && dirname(tree.path) !== controllers && !logs.has(tree.path))
    .filter((tree) => {
      const touched = readdirSync(tree.path).map((entry) => lstatSync(join(tree.path, entry)).mtimeMs);
      const idle = daysSince(sweep, Math.max(committed.get(tree.head ?? "") ?? 0, ...touched));
      if (idle < TREE_DAYS || seen.some((line) => line.includes(tree.path))) return false;
      const dirty = (gitMaybe(tree.path, "status", "--porcelain") ?? "changed") !== "";
      if (dirty && idle < DIRTY_DAYS) {
        console.log(`${tree.path}: idle ${idle.toFixed(1)} days with a change no commit names, kept`);
        return false;
      }
      say(
        sweep,
        `${tree.path}: idle ${idle.toFixed(1)} days${dirty ? ", its uncommitted change with it" : ""}, deleted`,
      );
      return true;
    })
    .toSorted((a, b) => b.path.length - a.path.length);
}

/** The local branches none of `trees` holds that nothing has used for `TREE_DAYS`, with their tips. */
function idleBranches(sweep: Sweep, trees: readonly Tree[]): { name: string; tip: string }[] {
  const held = new Set(trees.map((tree) => tree.branch));
  const logs = join(gitText(sweep.main, "rev-parse", "--path-format=absolute", "--git-common-dir"), "logs");
  return gitText(
    sweep.main,
    "for-each-ref",
    "--format=%(refname:lstrip=2) %(objectname) %(committerdate:unix)",
    "refs/heads",
  )
    .split("\n")
    .flatMap((row) => {
      const [name = "", tip = "", at = "0"] = row.split(" ");
      const reflog = join(logs, "refs", "heads", name);
      const used = Math.max(Number(at) * 1000, existsSync(reflog) ? lstatSync(reflog).mtimeMs : 0);
      if (name === "" || held.has(name) || daysSince(sweep, used) < TREE_DAYS) return [];
      say(
        sweep,
        `branch ${name}: idle ${daysSince(sweep, used).toFixed(1)} days, no worktree holds it, deleted`,
      );
      return [{ name, tip }];
    });
}

/** Every worktree but the main one, and every local branch no worktree holds, that nothing has used
 *  for `TREE_DAYS`, deleted, their commits kept reachable where nothing else holds them. */
export function retireUnused(sweep: Sweep, archiving: ReadonlySet<string>): void {
  const [first, ...others] = treesOf(sweep.main);
  const doomed = idleTrees(sweep, others, archiving);
  const staying = [first, ...others.filter((tree) => !doomed.includes(tree))].flatMap((tree) => tree ?? []);
  keepCommits(
    sweep,
    doomed.flatMap((tree) => tree.head ?? []),
    [],
    staying.flatMap((tree) => tree.head ?? []),
  );
  for (const tree of sweep.yes ? doomed : []) {
    // Asked again: a session may have come back to it while the sweep deleted the others.
    if (users().some((line) => line.includes(tree.path))) continue;
    // Toolchains and module caches hold entries without write permission.
    runSync(["chmod", "-R", "u+w", tree.path]);
    rmSync(tree.path, { recursive: true, force: true });
  }
  if (sweep.yes) gitText(sweep.main, "worktree", "prune");
  const left = sweep.yes ? treesOf(sweep.main) : staying;
  const branches = idleBranches(sweep, left);
  const names = branches.map((each) => each.name);
  keepCommits(
    sweep,
    branches.map((each) => each.tip),
    names,
    left.flatMap((tree) => tree.head ?? []),
  );
  if (sweep.yes && names.length > 0) gitText(sweep.main, "branch", "-D", ...names);
}

/** `bun run runs retire`. */
export async function retire(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: { days: { type: "string", default: "1" }, yes: { type: "boolean", default: false } },
  });
  const days = Number(values.days);
  if (!Number.isFinite(days) || days < 0) throw new Error(USAGE);
  const sweep: Sweep = { main: mainTree(runtimeProcess.cwd()), days, now: Date.now(), yes: values.yes };
  console.log(
    `retire at ${new Date(sweep.now).toISOString()}${sweep.yes ? "" : ": nothing is done without --yes"}`,
  );
  retireUnused(sweep, archiveIdle(sweep));
  for (const host of hostsOf()) {
    try {
      say(sweep, `${host.name}: its campaigns' records refreshed into ${archiveOf(sweep.main, host.name)}`);
      if (sweep.yes) await syncRuns([], { from: host.name, depth: "record" });
    } catch (error) {
      // One host that does not answer holds up no other.
      console.error(`${host.name}: ${errorMessage(error)}`);
      runtimeProcess.exitCode = 1;
    }
  }
}
