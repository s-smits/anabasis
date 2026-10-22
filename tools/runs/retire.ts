/**
 * Retire what the worktrees no longer use, and keep every campaign's traces.
 *
 *   bun --env-file=.env.runs run runs retire [--days 1] [--yes]
 *
 * A campaign no process writes or keeps (`writers`, `keepers`), whose log has not grown for
 * `--days`, leaves its worktree whole for the archive, `data/runs/here/<name>/` under the main
 * worktree (`ARCHIVE`), which git ignores; where the archive has the name already, it is filed
 * under `<name>.<its tree's folder>` (recode ran under one name in two trees). A live solve's log
 * goes to `here/.live/`. The readers read the archive (`readable`, `readNamed`: `view`, `source`,
 * `zip`, `replay`, the operator's page and the investigation), and `runs copy <name> --to
 * <worktree>` brings a campaign back to go on with, so one paused for longer than `--days` without
 * a keeper is copied back before `continue`.
 *
 * A seed (`seed.json` beside its log: a `sim-` campaign, or one the suite left behind) is deleted
 * instead, in a worktree or in the archive, once its log has not grown for `--days`: it is a copy of
 * a cut log made to rehearse on, and its source keeps the record. On 20 October a sweep would have
 * archived 563 of them, 547 left by the suite.
 *
 * A worktree other than the main one is then deleted once nothing has used it for `TREE_DAYS`: no
 * process works in it or names it on its command line, it holds no run log, and its last commit
 * and its top entries are older. One with a change no commit names stays for `DIRTY_DAYS`. Its
 * campaigns leave for the archive after `--days`, so the traces gather in one place within a day
 * while the tree waits a week for a session to come back to it (operator, 21 October: at one day
 * a dry run would delete 32 worktrees, every one idle less than two days). Where
 * no branch holds its commit, a local tag `retired/<sha9>` keeps it reachable (the repository is
 * public, so the tag is not pushed). Its node_modules, toolchains and the copies `.ana/moved/` set
 * aside go with it: what `copy` and `move` set aside goes on elsewhere, whole.
 *
 * Every configured host then sweeps its own originals. Since 22 October its records are refreshed
 * through snapshots.ts instead of a separate archive transfer. Readers fetch artefacts when
 * needed; originals remain whole on their owning machine. Record-only transfers avoid the
 * case-sensitive toolchain names a Mac cannot hold. Without --yes it describes both local and
 * remote retirement and moves no campaign.
 *
 * Until 20 October this was an operator's script outside the repository, run once a day: it moved a
 * retired tree's campaigns into the main worktree's `.ana/d2`, where every verb took them for runs
 * (384 campaigns, 6.5 GiB, that day), deleted each of them with its traces 14 days after it closed,
 * and reached no other host.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from "#src/meta/filesystem.ts";
import { gitMaybe, gitText, mainTree, worktrees } from "#src/meta/git.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { decodeOutput, runSync, runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { hostsOf } from "./host-config.ts";
import { verbOn } from "./hosts.ts";
import { syncRuns } from "./snapshots.ts";
import { archived, archiveOf, HERE, keepers, processes, runs, writers } from "./registry.ts";

/** What one sweep is asked: the main worktree, how long idle is, the time, and whether to act. */
export interface Sweep {
  readonly main: string;
  readonly days: number;
  readonly now: number;
  readonly yes: boolean;
}

const DAY_MS = 86_400_000;
/** A worktree nothing uses stays this long, and one with a change no commit names twice as long:
 *  past it the system has moved too far for the change to apply (operator, 26 September). */
const TREE_DAYS = 7;
const DIRTY_DAYS = 14;
const USAGE = "usage: bun run runs retire [--days 1] [--yes]";

const say = (sweep: Sweep, line: string) => console.log(`${sweep.yes ? "" : "would: "}${line}`);

/** Every run no process writes or keeps whose log has not grown for `days`, moved to the archive,
 *  and every such seed, the archive's too, deleted. Returns the logs it moved or deleted, or would. */
export function archiveIdle(sweep: Sweep): Set<string> {
  const moved = new Set<string>();
  const taken = new Set<string>();
  const own = archiveOf(sweep.main, HERE);
  for (const run of [...runs(sweep.main), ...archived(sweep.main).filter((each) => each.seed === true)]) {
    if (sweep.now - lstatSync(run.path).mtimeMs < sweep.days * DAY_MS) continue;
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

/** Whether a process works in `tree` or names it on its command line. */
function inUse(tree: string): boolean {
  const naming = runTextSyncOrThrow(["ps", "-axo", "args="])
    .split("\n")
    .some((args) => args.includes(tree));
  // lsof exits 1 when a process left between its reads, so its answer is read as given.
  const cwds = decodeOutput(runSync(["lsof", "-a", "-d", "cwd", "-Fn"]).stdout).split("\n");
  return naming || cwds.some((line) => line === `n${tree}` || line.startsWith(`n${tree}/`));
}

/** Keeps `tree`'s commit reachable once the tree is gone: a branch holds it, or a local tag. */
function keepCommit(sweep: Sweep, tree: string): void {
  const head = gitMaybe(tree, "rev-parse", "HEAD");
  if (head === null || gitText(sweep.main, "branch", "-a", "--contains", head) !== "") return;
  const tag = `retired/${head.slice(0, 9)}`;
  if (gitMaybe(sweep.main, "rev-parse", "-q", "--verify", `refs/tags/${tag}`) !== null) return;
  say(sweep, `tag ${tag} keeps ${head.slice(0, 9)}, which no branch holds`);
  if (sweep.yes) gitText(sweep.main, "tag", tag, head);
}

/** Every worktree but the main one that nothing has used for `TREE_DAYS`, deleted, deepest first; a
 *  run log in `archiving` counts as gone. */
export function retireTrees(sweep: Sweep, archiving: ReadonlySet<string>): void {
  const logs = runs(sweep.main).filter((run) => !archiving.has(run.path));
  const trees = worktrees(sweep.main)
    .slice(1)
    .filter((tree) => existsSync(tree))
    .toSorted((a, b) => b.length - a.length);
  for (const tree of trees) {
    // Idle since its last commit and since any of its top entries changed.
    const committed = Number(gitMaybe(tree, "log", "-1", "--format=%ct") ?? 0) * 1000;
    const touched = readdirSync(tree).map((entry) => lstatSync(join(tree, entry)).mtimeMs);
    const idle = (sweep.now - Math.max(committed, ...touched)) / DAY_MS;
    if (idle < TREE_DAYS || logs.some((run) => run.tree === tree) || inUse(tree)) continue;
    const dirty = (gitMaybe(tree, "status", "--porcelain") ?? "changed") !== "";
    if (dirty && idle < DIRTY_DAYS) {
      console.log(`${tree}: idle ${idle.toFixed(1)} days with a change no commit names, kept`);
      continue;
    }
    keepCommit(sweep, tree);
    say(
      sweep,
      `${tree}: idle ${idle.toFixed(1)} days${dirty ? ", its uncommitted change with it" : ""}, deleted`,
    );
    if (!sweep.yes) continue;
    // Toolchains and module caches hold entries without write permission.
    runSync(["chmod", "-R", "u+w", tree]);
    rmSync(tree, { recursive: true, force: true });
  }
  if (sweep.yes) gitText(sweep.main, "worktree", "prune");
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
  retireTrees(sweep, archiveIdle(sweep));
  for (const host of hostsOf()) {
    console.log(`── ${host.name}`);
    try {
      const code = await verbOn(host, ["retire", "--days", values.days, ...(sweep.yes ? ["--yes"] : [])]);
      if (code !== 0) throw new Error(`retire there ended with exit ${String(code)}`);
      if (sweep.yes) await syncRuns([], { from: host.name, depth: "record" });
    } catch (error) {
      // One host that does not answer holds up no other.
      console.error(`${host.name}: ${errorMessage(error)}`);
      runtimeProcess.exitCode = 1;
    }
  }
}
