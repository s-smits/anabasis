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
 * First of all, the seats' roots and the host's scratch folders that nobody will release go
 * (`releaseScratch`): what a killed campaign's solves, sessions, verifier cells and model homes left
 * in the temporary folder, and the root a killed test suite left (`SUITE_SCRATCH_ROOT`), told from
 * what a live process holds by its claim. What a run's log names as open goes as the archive takes
 * the run.
 *
 * A check runner's slot in this machine's home that no check has used for `TREE_DAYS` goes to the
 * Trash with the files beside it (`trashIdleSlots`), never deleted outright.
 *
 * Only the repository's worktrees are swept, so a separate clone is never read. Every host sweeps
 * its own originals with its own daily job, and this one then refreshes each configured host's
 * records through snapshots.ts and brings every campaign no process writes there whole but for
 * what it installed (`installs`), so the central host holds all a zip of a closed run can hold and
 * the zip fetches nothing. A host that does not answer is skipped with its copies as they were, and
 * the next sweep asks it again, so a Mac asleep for a night or a week catches up when it answers.
 * No original is deleted but on a machine that rolls a benchmark (`EVAL_RUNNER`), kept clear for outside evaluations
 * (`takeRetired`). Without --yes it describes the sweep and changes nothing.
 */
import { DAY_MS } from "#src/meta/clock.ts";
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from "#src/meta/filesystem.ts";
import { gitMaybe, gitText, mainTree, type Worktree as Tree, worktreeList } from "#src/meta/git.ts";
import { homedir } from "#src/meta/os.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess, warn } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { decodeOutput, runSync, runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { SCRATCH_ROOTS, SUITE_SCRATCH_ROOT } from "#src/wall/policy.ts";
import { claimed, releaseLeft } from "#src/wall/seat-root.ts";
import { controllersOf } from "./code.ts";
import { benchesOf, hostsOf, RUNNER_SLOTS } from "./host-config.ts";
import { takeRetired, syncRuns } from "./snapshots.ts";
import { stillRunning } from "./diagnosis.ts";
import { unlaunchedSeed } from "./receipt.ts";
import { archived, archiveOf, HERE, Misused, processes, runs } from "./registry.ts";
import { leftOpen, release } from "./stop.ts";

/** What one sweep is asked: the main worktree, how long idle is, the time, and whether to act. */
export interface Sweep {
  readonly main: string;
  readonly days: number;
  readonly now: number;
  readonly yes: boolean;
}

/** What each run's log names as open (`leftOpen`), by the log's path. */
type Open = Map<string, ReturnType<typeof leftOpen>>;

/** A worktree or branch nothing uses stays this long, and a tree with a change no commit names twice
 *  as long: past it the system has moved too far for the change to apply (operator, 26 September). */
const TREE_DAYS = 7;
const DIRTY_DAYS = 14;

const say = (sweep: Sweep, line: string) => console.log(`${sweep.yes ? "" : "would: "}${line}`);
const daysSince = (sweep: Sweep, ms: number) => (sweep.now - ms) / DAY_MS;

/** Every run no process writes or keeps whose log has not grown for `days`, moved to the archive,
 *  and every such seed no launch went on from, the archive's too, deleted, each after the roots it
 *  left `open` are released as a stop would. Returns the logs it moved or deleted, or would. */
export async function archiveIdle(sweep: Sweep, open: Open): Promise<Set<string>> {
  const moved = new Set<string>();
  const taken = new Set<string>();
  const own = archiveOf(sweep.main, HERE);
  for (const run of [...runs(sweep.main), ...archived(sweep.main).filter(unlaunchedSeed)]) {
    if (daysSince(sweep, lstatSync(run.path).mtimeMs) < sweep.days) continue;
    // Read again for each run: one launched while the sweep ran is live.
    if (stillRunning(run, processes())) continue;
    // A cut Builder session's notes are kept into the run's own folder, which then moves whole. A
    // root a live process claims is held whatever the process table is read to say of its run.
    const left = (open.get(run.path) ?? []).filter(({ root }) => !claimed(root));
    await release(run, processes(), sweep.yes ? "release" : "describe", left);
    const from = run.end === "solve.finished" ? run.path : dirname(run.path);
    if (unlaunchedSeed(run)) {
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
      warn(`${from}: the archive holds ${run.name} under both its names, so it stays`);
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

/**
 * Every seat root and folder of the host's scratch on this machine that nobody will release
 * (`src/wall/seat-root.ts`), and what each run here left open, for the archive to release as it
 * takes the run (`archiveIdle`). A root a run here still names as open is that run's and is spared
 * until then. The rest go by their claims: a dead claimant's at once, an unclaimed one after
 * `TREE_DAYS` without a write, their count said before they go, as every line of the sweep is.
 *
 * Until 16 November no sweep read these folders, and only a stop released any: a campaign that was
 * killed, or continued after a kill, left its roots for good, and so did every verifier cell and
 * model home a killed process held, with the check programs and hidden values in them. On
 * 17 November the first sweep that did took the three roots of a rehearsal's seed three hours after
 * its last event, since it asked only whether a process wrote the run, and its one line for the
 * 12,053 folders nobody held was to come only after their release.
 */
export async function releaseScratch(sweep: Sweep, parents: readonly string[]): Promise<Open> {
  const open: Open = new Map();
  for (const run of runs(sweep.main)) {
    try {
      open.set(run.path, leftOpen(run));
    } catch (error) {
      // Unread, its roots cannot be told from those nobody holds, so none goes by its claim today.
      warn(`${run.name}: ${errorMessage(error)}, so no root is released by its claim in this sweep`);
      return open;
    }
  }
  const spared = new Set([...open.values()].flatMap((roots) => roots.map(({ root }) => root)));
  const before = sweep.now - TREE_DAYS * DAY_MS;
  const left = await releaseLeft(parents, before, "describe", spared);
  say(sweep, `${String(left.length)} seat root(s) and host folder(s) nobody holds, released`);
  if (sweep.yes) await releaseLeft(parents, before, "release", spared);
  return open;
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
  const [first, ...others] = worktreeList(sweep.main);
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
  const left = sweep.yes ? worktreeList(sweep.main) : staying;
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

/**
 * The check runner's slots in this machine's home (`RUNNER_SLOTS`) that no task has used for
 * `TREE_DAYS`, each with the files beside it (`<slot>.status`, `.run.sh`, `.task.sh`), moved to the
 * Trash, from which the operator empties it. A slot is a clone and its packages kept warm for the
 * next check, so one a machine no longer sends checks to stayed for good: on 20 November the Linux
 * host, which stopped taking checks on 12 November, held three, 2.0 GB. Returns what goes, or would.
 */
export function trashIdleSlots(sweep: Sweep, home = homedir()): string[] {
  const folder = join(home, RUNNER_SLOTS);
  const entries = existsSync(folder) ? readdirSync(folder) : [];
  const seen = users();
  const doomed = entries
    .filter((entry) => /-slot-\d+$/u.test(entry))
    .map((slot) =>
      [slot, ...entries.filter((entry) => entry.startsWith(`${slot}.`))].map((entry) => join(folder, entry)),
    )
    .filter(([slot = "", ...beside]) => {
      const idle = daysSince(sweep, Math.max(...[slot, ...beside].map((path) => lstatSync(path).mtimeMs)));
      if (idle < TREE_DAYS || seen.some((line) => line.includes(slot))) return false;
      say(sweep, `${slot}: no check for ${idle.toFixed(1)} days, to the Trash`);
      return true;
    })
    .flat();
  if (!sweep.yes || doomed.length === 0) return doomed;
  const trash = runtimeProcess.platform === "darwin" ? ["/usr/bin/trash"] : ["gio", "trash"];
  try {
    const moved = runSync([...trash, ...doomed]);
    if (moved.exitCode !== 0) {
      throw new Error(decodeOutput(moved.stderr).trim() || `exit ${String(moved.exitCode)}`);
    }
  } catch (error) {
    // Nothing is deleted outright: a slot the Trash does not take stays for the next sweep.
    console.error(`${trash.join(" ")} left the idle slots where they are: ${errorMessage(error)}`);
    runtimeProcess.exitCode = 1;
  }
  return doomed;
}

/** `bun run runs retire`. */
export async function retire(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: { days: { type: "string", default: "1" }, yes: { type: "boolean", default: false } },
  });
  const days = Number(values.days);
  if (!Number.isFinite(days) || days < 0) throw new Misused();
  const sweep: Sweep = { main: mainTree(runtimeProcess.cwd()), days, now: Date.now(), yes: values.yes };
  // The machines that roll a benchmark, kept clear; read before the sweep, so a name no entry holds,
  // which would leave that host to fill unseen, refuses before anything moves.
  const cleared = new Set(benchesOf().flatMap(({ host }) => (host === undefined ? [] : [host.name])));
  console.log(
    `retire at ${new Date(sweep.now).toISOString()}${sweep.yes ? "" : ": nothing is done without --yes"}`,
  );
  const open = await releaseScratch(sweep, [...SCRATCH_ROOTS, SUITE_SCRATCH_ROOT]);
  retireUnused(sweep, await archiveIdle(sweep, open));
  trashIdleSlots(sweep);
  for (const host of hostsOf()) {
    try {
      say(
        sweep,
        `${host.name}: its campaigns' records, and those no process writes whole, into ${archiveOf(sweep.main, host.name)}`,
      );
      if (sweep.yes) {
        await syncRuns([], { from: host.name, depth: "record" });
        await syncRuns([], { from: host.name, depth: "whole", closed: true });
      }
      if (!cleared.has(host.name)) continue;
      say(sweep, `${host.name}: takes what its copy here holds whole; --yes copies first and can take more`);
      await takeRetired(host, sweep.yes ? "take" : "describe");
    } catch (error) {
      // One host that does not answer holds up no other.
      console.error(`${host.name}: ${errorMessage(error)}`);
      runtimeProcess.exitCode = 1;
    }
  }
}
