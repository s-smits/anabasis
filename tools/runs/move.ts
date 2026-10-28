/**
 * Move a campaign to another machine, and go on with it there on the login named.
 *
 *   bun --env-file=<credentials> --env-file=.env.runs run runs move <name> --to <host>
 *     [--from <host>] [--login N] [--after promoted|compacted|reported|finished] [--hold]
 *     [--yes] [-- <flags>]
 *
 * Each end is a host `ANA_HOSTS` lists or this machine, named by its own short host name or `here`
 * and the default source (27 October: the operator names every machine by its name); between two
 * hosts the folder passes through this machine, since rsync takes one remote side. The verb pauses
 * the campaign where it runs, at the next `--after` event with no comparison, Examiner session or
 * draft open (`runs pause`; one no process writes is taken as it is, and without
 * `--after` the pause waits for the next `finished`), makes a worktree beside the destination's
 * repository at the commit the source's worktree stands at, takes the campaign's folder there whole
 * with rsync and checks that the log arrived as long as it left, sets the source's folder aside under
 * `.ana/moved/`, as `runs copy` does, and runs `runs continue` there on the flags its last run kept.
 * A kept flag that names a path under the folder that holds the source's worktrees names the same
 * path under the destination's (`rehomed`), so a prompt file beside the repository is found on a
 * machine whose home is elsewhere; flags after `--` stand for the kept ones. `--hold` stops before
 * the continue, and prints it. A held seed needs no launch receipt; going on without one needs
 * explicit campaign flags. Flags are read before the pause or copy. An occupied destination is
 * left untouched, with instructions to preserve its campaign before removing the worktree and
 * retrying, or to continue there if the source was already set aside. Without `--yes` the verb
 * reads where each end stands and moves nothing.
 * Remote receipts are read here, since the source worktree may predate the receipt reader
 * (26 October 2026).
 *
 * A log is never copied by hand (operator, 15 October), and until 19 October a campaign went to
 * another host only so: `runs copy` moves a folder between worktrees of one machine and said that
 * another host takes it with rsync. On 19 October a fresh Opus campaign was moved from one host to
 * another and back by stopping it and launching a new one each time, which left two campaigns
 * that ended in their draft, for $0.72, where its own log could have gone on. A change of login on
 * one machine needs no move: `runs continue --after <event> --login N`.
 *
 * The run's states link their programs by relative paths, which hold in the new folder. What an
 * Examiner's or a Builder's shell left in its home links where that machine's tools are, and the
 * next session there builds its own again. A `runs keep` that keeps the campaign at its source is
 * not stopped by the move: stop it first.
 *
 *   bun run runs copy <name> --to <worktree> [--yes]
 *
 * `copy` takes a campaign no process writes or keeps, its folder whole, to another worktree of the
 * repository, from a worktree or from this machine's archive (`runs retire`), and sets the folder it
 * leaves aside under `.ana/moved/` of the tree it was in, so that one worktree holds the name;
 * `continue` then goes on with it there. It is the one way a campaign's folder moves on one machine
 * (operator, 15 October), since a log is never copied by hand.
 *
 *   bun --env-file=.env.runs run runs fetch <name> [--from <host>]
 *
 * `fetch` takes a copy of a campaign another machine holds, to read here: its folder whole, into
 * the archive as `data/runs/<host>/<name>/` of the main worktree (`ARCHIVE`), where the readers read
 * it and no verb acts on it, so the name stays one run. It asks every host which holds the name
 * unless `--from` names one, prints the copy's log, and run again brings the copy level with its
 * source. The run is left as it is. On 20 October a whole-run investigation of three runs on another
 * host read copies made by hand; until then a copy went to `.ana/fetched/`, which no reader read.
 */
import { LOG_FILE } from "#src/kernel/log.ts";
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "#src/meta/filesystem.ts";
import { worktrees } from "#src/meta/git.ts";
import { tmpdir } from "#src/meta/os.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { type Host, hostNamed, ownName } from "./host-config.ts";
import { quoted, rsync, shellPath, sshScript, worktreesIn } from "./host-command.ts";
import { verbOn } from "./hosts.ts";
import { CAMPAIGNS, HERE, keepers, processes, readNamed, writers } from "./registry.ts";
import { syncRuns } from "./snapshots.ts";
import { continueRun, pause, said } from "./manage.ts";
import { preparedHost, publishedAt } from "./code.ts";
import { lastLaunch } from "./receipt.ts";

/** One end of a move: this machine or a host, with the folder its worktrees sit in. */
interface End {
  readonly name: string;
  readonly host: Host | undefined;
  /** A worktree of the repository there, absolute: the folder it sits in holds the others. */
  readonly repo: string;
}

const USAGE =
  "usage: bun run runs move <name> --to <host> [--from <host>] [--login N] [--after <event>] [--hold] [--yes] [-- <flags>]";

/** `flags` with each path under `from` named under `to` instead, whole or after a flag's `=`. */
export function rehomed(flags: readonly string[], from: string, to: string): string[] {
  const under = `${from}/`;
  return flags.map((flag) => {
    if (flag.startsWith(under)) return `${to}/${flag.slice(under.length)}`;
    const equals = flag.indexOf(`=${under}`);
    return equals === -1
      ? flag
      : `${flag.slice(0, equals + 1)}${to}/${flag.slice(equals + 1 + under.length)}`;
  });
}

/** The shell text `script` run at `end`, its output trimmed. */
function at(end: End, script: string): string {
  const command = end.host === undefined ? ["sh", "-c", script] : sshScript(end.host, script);
  return runTextSyncOrThrow(command).trim();
}

/** The end `name` names: this machine, or a host `ANA_HOSTS` lists. */
function endOf(name: string): End {
  const host = name === HERE ? undefined : hostNamed(name);
  const end = { name, host, repo: "" };
  // A host's tree is written as `ANA_HOSTS` holds it, so that `~` names the home there.
  return {
    ...end,
    repo: at(end, `cd ${host === undefined ? "." : shellPath(host.tree)} && git rev-parse --show-toplevel`),
  };
}

/** The worktree at `end` whose `.ana/d2/<name>` holds a campaign log, refused where two do. */
function treeOf(end: End, name: string): string | undefined {
  const found = at(
    end,
    `${worktreesIn(quoted(end.repo))} | while IFS= read -r w; do test -f "$w/${CAMPAIGNS}/${name}/${LOG_FILE}" && echo "$w"; done; true`,
  )
    .split("\n")
    .filter((line) => line !== "");
  const [only, other] = found;
  if (other !== undefined) throw new Error(`${name} names a campaign in ${found.join(" and in ")}`);
  return only;
}

/** Read kept flags through the local receipt owner before pausing or copying the campaign. */
function flagsAt(end: End, source: string, name: string): readonly string[] | null {
  const log = join(source, CAMPAIGNS, name, LOG_FILE);
  if (end.host === undefined) return lastLaunch(log)?.flags ?? null;
  const stage = join(tmpdir(), `ana-move-receipts-${crypto.randomUUID()}`);
  mkdirSync(stage);
  try {
    rsync(`${side(end, dirname(log))}/`, `${stage}/`, "--include=/launch-*.json", "--exclude=/*");
    return lastLaunch(join(stage, LOG_FILE))?.flags ?? null;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/** The rsync side of `path` at `end`. */
const side = (end: End, path: string) => (end.host === undefined ? path : `${end.host.ssh}:${quoted(path)}`);

/** `bun run runs move`. */
export async function move(args: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      to: { type: "string" },
      from: { type: "string", default: HERE },
      login: { type: "string" },
      after: { type: "string", default: "finished" },
      hold: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
    },
  });
  const [name, ...given] = positionals;
  const own = ownName();
  const [fromName = HERE, toName] = [values.from, values.to].map((end) => (end === own ? HERE : end));
  if (name === undefined || !isSafePathSegment(name) || toName === undefined || toName === fromName) {
    throw new Error(USAGE);
  }
  const from = endOf(fromName);
  const to = endOf(toName);
  const source = treeOf(from, name);
  const tree = join(dirname(to.repo), `anabasis-${name}`);
  const folder = (root: string) => join(root, CAMPAIGNS, name);
  const login = values.login === undefined ? [] : ["--login", values.login];
  // Read before anything stops: a pause that a taken destination then refuses leaves the run stopped.
  if (at(to, `test -e ${quoted(tree)} && echo taken; true`) === "taken") {
    const recovery =
      source === undefined
        ? `no worktree on ${from.name} holds ${name}; inspect ${folder(tree)} on ${to.name}, then use runs continue ${name} there (with explicit flags after -- if no launch receipt exists); if incomplete, recover the source folder from .ana/moved/`
        : `the source remains at ${folder(source)} on ${from.name}; preserve ${folder(tree)} outside ${tree}, remove the destination with git -C ${quoted(to.repo)} worktree remove ${quoted(tree)} on ${to.name}, then retry`;
    throw new Error(`${tree} is there already on ${to.name}: ${recovery}; nothing was stopped or moved`);
  }
  if (source === undefined) throw new Error(`no worktree ${from.name} holds a campaign ${name}`);
  const commit = at(from, `git -C ${quoted(source)} rev-parse HEAD`);
  const kept = given.length > 0 ? given : flagsAt(from, source, name);
  if (kept === null && !values.hold) {
    throw new Error(
      `${name} has no launch receipt at ${folder(source)}: supply campaign flags after -- or use --hold; nothing was stopped or moved`,
    );
  }
  const flags = given.length > 0 ? given : rehomed(kept ?? [], dirname(from.repo), dirname(to.repo));
  console.log(
    `${name}: from ${source} (${from.name}) at ${commit.slice(0, 9)} to ${tree} (${to.name}), after its next ${values.after}`,
  );
  if (!values.yes) {
    console.log("nothing is done without --yes");
    return;
  }
  // Prepare before the pause: a missing commit or failed install must leave the source running.
  const controller = to.host === undefined ? undefined : preparedHost(to.host, commit);
  if (to.host === undefined) publishedAt(to.repo, commit);
  const paused = ["pause", name, "--after", values.after, "--yes"];
  if (from.host === undefined) await pause(paused.slice(1));
  else if ((await verbOn(from.host, paused)) !== 0) throw new Error(`${name} did not pause at ${from.name}`);
  at(
    to,
    `git -C ${quoted(to.repo)} worktree add -q --detach ${quoted(tree)} ${quoted(commit)} && mkdir -p ${quoted(folder(tree))}`,
  );
  // rsync takes one remote side, so a move between two hosts stages the folder here.
  const stage = from.host && to.host ? join(tmpdir(), `ana-move-${crypto.randomUUID()}`) : undefined;
  if (stage !== undefined) rsync(`${side(from, folder(source))}/`, `${stage}/`);
  rsync(`${stage ?? side(from, folder(source))}/`, `${side(to, folder(tree))}/`);
  if (stage !== undefined) rmSync(stage, { recursive: true, force: true });
  const size = (end: End, root: string) => at(end, `wc -c < ${quoted(join(folder(root), LOG_FILE))}`);
  if (size(from, source) !== size(to, tree)) {
    throw new Error(`the log did not arrive whole in ${folder(tree)}: ${folder(source)} is left as it was`);
  }
  const aside = asideOf(source, name);
  if (from.host === undefined) setAside(folder(source), aside);
  else at(from, `mkdir -p ${quoted(dirname(aside))} && mv ${quoted(folder(source))} ${quoted(aside)}`);
  console.log(
    `${name} is in ${tree} on ${to.name}, and its folder at ${from.name} was set aside as ${aside}`,
  );
  const going = ["continue", name, ...login, "--yes", "--", ...flags];
  if (values.hold) {
    console.log(
      `held: go on with bun run runs ${to.host === undefined ? "" : `on ${to.name} `}${going.join(" ")}`,
    );
    if (kept === null) console.log("no launch receipt: supply campaign flags after -- to continue");
    return;
  }
  if (to.host === undefined) await continueRun(going.slice(1));
  else if (controller !== undefined && (await verbOn(controller, going)) !== 0) {
    throw new Error(`${name} did not go on at ${to.name}`);
  }
}

/** `bun run runs fetch`. */
export async function fetch(args: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { from: { type: "string" } },
  });
  const [name, ...rest] = positionals;
  if (rest.length > 0) throw new Error("usage: bun run runs fetch [<name>] [--from <host>]");
  const from = keyIfDefined("from", values.from);
  // With no name, the records of every campaign the other hosts hold: the gather a timer runs.
  const copies = await syncRuns(name === undefined ? [] : [name], {
    ...from,
    ...(name === undefined ? { depth: "record" } : { match: "exact" }),
  });
  if (copies.length === 0 && name !== undefined) {
    throw new Error(`no host ANA_HOSTS lists holds a campaign ${name}`);
  }
  for (const log of copies) console.log(log);
}

/** `bun run runs copy`. */
export function copy(args: readonly string[]): void {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { to: { type: "string" }, yes: { type: "boolean", default: false } },
  });
  const [name] = positionals;
  const trees = worktrees(runtimeProcess.cwd());
  const to = trees.find((tree) => values.to !== undefined && tree === resolve(values.to));
  if (name === undefined || to === undefined) {
    throw new Error(`usage: bun run runs copy <name> --to <a worktree: ${trees.join(", ")}> [--yes]`);
  }
  const run = readNamed(name);
  if (run.archived !== undefined && run.archived !== HERE) {
    throw new Error(
      `${name} is a copy of a campaign ${run.archived} holds: runs move takes one to another machine`,
    );
  }
  if (writers(run, processes()).length > 0 || keepers(name).length > 0) {
    throw new Error(`${name} is being written or kept in ${run.tree}: pause it first`);
  }
  const from = dirname(run.path);
  const into = join(to, CAMPAIGNS, name);
  if (existsSync(into)) throw new Error(`${into} is there already`);
  if (!values.yes) return said(run, `would be copied whole to ${into}, and its folder here set aside`);
  cpSync(from, into, { recursive: true, verbatimSymlinks: true });
  if (statSync(join(into, LOG_FILE)).size !== statSync(run.path).size) {
    throw new Error(`the copy of ${run.path} is not whole: ${from} is left as it was`);
  }
  const aside = asideOf(run.tree, name);
  setAside(from, aside);
  console.log(`${name} is in ${to} now, and its folder was set aside as ${aside}; go on with runs continue`);
}

/** Where a run's folder is set aside in `tree` once a copy of it went elsewhere: one copy a name,
 *  which `runNamed` asks, so the folder left is no run any registry reads (`runs copy`, `runs move`). */
export function asideOf(tree: string, name: string): string {
  return join(tree, ".ana", "moved", `${name}-${new Date().toISOString().replace(/[:.]/g, "")}`);
}

/** Moves `folder` to `aside`, making `.ana/moved/` where the tree has none yet. */
export function setAside(folder: string, aside: string): void {
  mkdirSync(dirname(aside), { recursive: true });
  renameSync(folder, aside);
}
