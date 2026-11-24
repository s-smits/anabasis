/**
 * Move a campaign to another machine, and go on with it there on the login named.
 *
 *   bun --env-file=<credentials> --env-file=.env.runs run runs move <name> --to <host>
 *     [--from <host>] [--login N] [--after <word>[|<word>...]] [--hold]
 *     [--yes] [-- <flags>]
 *
 * Each end is a host `ANA_HOSTS` lists or this machine, named by its own short host name or `here`
 * and the default source (the operator names every machine by its name); between two
 * hosts the folder passes through this machine, since rsync takes one remote side. The verb pauses
 * the campaign where it runs, at the next `--after` event with nothing but the Builder's
 * conversation open (`runs pause`; one no process writes is taken as it is, and without
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
 * Remote receipts are read here, since the source worktree may predate the receipt reader.
 *
 *   bun run runs copy <name> --to <worktree> [--yes]
 *
 *   bun --env-file=.env.runs run runs fetch [<name>] [--from <host>] [--whole]
 */
import { foreignFiles, placeOf, UNAME_PLACES } from "#src/harness/place.ts";
import { LOG_FILE } from "#src/kernel/log.ts";
import { TOOL_TREE_DIR } from "#src/meta/bundle-layout.ts";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
} from "#src/meta/filesystem.ts";
import { worktrees } from "#src/meta/git.ts";
import { tmpdir } from "#src/meta/os.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { type Host, hostNamed, hostsOf, ownName } from "./host-config.ts";
import { quoted, rsync, shellOn, shellPath, sideOf } from "./host-command.ts";
import { verbOn } from "./hosts.ts";
import { stillRunning } from "./diagnosis.ts";
import { CAMPAIGNS, HERE, Misused, processes, readNamed } from "./registry.ts";
import { fetchBenches, syncRuns } from "./snapshots.ts";
import { recordDegradations } from "./degradations.ts";
import { continueRun, pause, said } from "./manage.ts";
import { payerOf } from "./live.ts";
import { roomToStart } from "./logins.ts";
import { outOfStep } from "./sync.ts";
import { loginPresent } from "./placement.ts";
import { preparedHost, publishedAt } from "./code.ts";
import { lastLaunch } from "./receipt.ts";

/** One end of a move: this machine or a host, with the folder its worktrees sit in. */
interface End {
  readonly name: string;
  readonly host: Host | undefined;
  /** A worktree of the repository there, absolute: the folder it sits in holds the others. */
  readonly repo: string;
}

/** `flags` with each path under `from` named under `to` instead, whole or after a flag's `=`. */
function rehomed(flags: readonly string[], from: string, to: string): string[] {
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
  return runTextSyncOrThrow(shellOn(end.host, script)).trim();
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
    `git -C ${quoted(end.repo)} worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r w; do test -f "$w/${CAMPAIGNS}/${name}/${LOG_FILE}" && echo "$w"; done; true`,
  )
    .split("\n")
    .filter((line) => line !== "");
  const [only, other] = found;
  if (other !== undefined) throw new Error(`${name} names a campaign in ${found.join(" and in ")}`);
  return only;
}

/** What `read` makes of the files `filters` take from the campaign folder `dir` at `end`, copied here
 *  first where `end` is another host. */
async function readAt<T>(
  end: End,
  dir: string,
  filters: readonly string[],
  read: (here: string) => T | Promise<T>,
) {
  if (end.host === undefined) return await read(dir);
  const stage = mkdtempSync(join(tmpdir(), "ana-move-read-"));
  try {
    await rsync(`${sideOf(end.host, dir)}/`, `${stage}/`, ...filters);
    return await read(stage);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/** The last launch's receipt, read through the local receipt owner before anything is paused or copied. */
const launchAt = async (end: End, dir: string) =>
  await readAt(end, dir, ["--include=/launch-*.json", "--exclude=/*"], (here) =>
    lastLaunch(join(here, LOG_FILE)),
  );

/** The table's Python and tools at `to`, brought in step as `runs sync --yes` would before the pause
 *  where `mode` applies, and refused where a seat would still find one out of step. */
async function inStepAt(to: End, mode: "read" | "apply"): Promise<void> {
  const behind = await outOfStep(to.name, to.host, mode);
  if (behind.length === 0) return;
  const why = `${to.name} is out of step where a seat would find it: ${behind.join("; ")}`;
  if (mode === "apply") throw new Error(`${why}; nothing was stopped or moved`);
  console.log(`${why}; --yes brings it in step first`);
}

/** Refuses a move to another system or processor where a kept harness's tool tree holds a program the
 *  destination cannot run, by the outside read's own test (`foreignFiles`): a kept harness is its
 *  digest, so it is never rebuilt there, as the outside read rebuilds its copy. */
async function runnableAt(from: End, to: End, dir: string): Promise<void> {
  const [source, destination] = [from, to].map((end) => UNAME_PLACES.get(at(end, "uname -sm")));
  if (source === destination) return;
  if (destination === undefined) throw new Error(`${to.name} is no machine a harness is read for`);
  const trees = [
    "--include=/states/",
    "--include=/states/*/",
    `--include=/states/*/${TOOL_TREE_DIR}/***`,
    "--include=/exams/",
    "--include=/exams/*/",
    "--include=/exams/*/bundle/",
    `--include=/exams/*/bundle/${TOOL_TREE_DIR}/***`,
  ];
  const found = await readAt(from, dir, [...trees, "--exclude=*"], async (here) => {
    const entries = (root: string, tail: readonly string[], label: (name: string) => string) =>
      (existsSync(root) ? readdirSync(root) : []).map((entry) => ({
        tag: label(entry),
        tree: join(root, entry, ...tail, TOOL_TREE_DIR),
      }));
    const dirs = [
      ...entries(join(here, "states"), [], (state) => state.slice(0, 12)),
      ...entries(join(here, "exams"), ["bundle"], (exam) => `exam/${exam}`),
    ];
    const each = dirs.map(async ({ tag, tree }) => {
      const foreign = await foreignFiles(tree, placeOf(destination));
      return foreign.slice(0, 3).map(({ path, why }) => `${tag} ${path} (${why})`);
    });
    return (await Promise.all(each)).flat();
  });
  if (found.length > 0) {
    throw new Error(
      `kept harnesses or exam toolchains hold programs ${to.name} cannot run, and neither is rebuilt: ${found.slice(0, 6).join(", ")}; move it to a machine of its own system and processor: nothing was stopped or moved`,
    );
  }
}

/** The rsync side of `path` at `end`. */

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
    throw new Misused();
  }
  const from = endOf(fromName);
  const to = endOf(toName);
  const source = treeOf(from, name);
  const tree = join(dirname(to.repo), `anabasis-${name}`);
  const folder = (root: string) => join(root, CAMPAIGNS, name);
  const login = values.login === undefined ? [] : ["--login", values.login];
  const size = (end: End, root: string) =>
    Number(at(end, `{ wc -c < ${quoted(join(folder(root), LOG_FILE))}; } 2>/dev/null || echo 0`));
  // Read before anything stops: a pause that a taken destination then refuses leaves the run stopped.
  const taken = at(
    to,
    `test -e ${quoted(tree)} && { git -C ${quoted(tree)} rev-parse HEAD 2>/dev/null || echo taken; }; true`,
  );
  if (source === undefined) {
    throw new Error(
      taken === ""
        ? `no worktree ${from.name} holds a campaign ${name}`
        : `${tree} is there already on ${to.name}: no worktree on ${from.name} holds ${name}; inspect ${folder(tree)} on ${to.name}, then use runs continue ${name} there (with explicit flags after -- if no launch receipt exists); if incomplete, recover the source folder from .ana/moved/; nothing was stopped or moved`,
    );
  }
  const commit = at(from, `git -C ${quoted(source)} rev-parse HEAD`);
  // A move cut between its worktree and setting the source aside left the destination at the same
  // commit holding no more of the log than the source: the next one goes on from there.
  const resumed =
    taken === commit &&
    at(to, `git -C ${quoted(tree)} status --porcelain`) === "" &&
    size(to, tree) <= size(from, source);
  if (taken !== "" && !resumed) {
    throw new Error(
      `${tree} is there already on ${to.name}: the source remains at ${folder(source)} on ${from.name}; preserve ${folder(tree)} outside ${tree}, remove the destination with git -C ${quoted(to.repo)} worktree remove ${quoted(tree)} on ${to.name}, then retry; nothing was stopped or moved`,
    );
  }
  const launch = await launchAt(from, folder(source));
  await runnableAt(from, to, folder(source));
  const kept = given.length > 0 ? given : (launch?.flags ?? null);
  if (kept === null && !values.hold) {
    throw new Error(
      `${name} has no launch receipt at ${folder(source)}: supply campaign flags after -- or use --hold; nothing was stopped or moved`,
    );
  }
  const flags = given.length > 0 ? given : rehomed(kept ?? [], dirname(from.repo), dirname(to.repo));
  console.log(
    `${name}: from ${source} (${from.name}) at ${commit.slice(0, 9)} to ${tree} (${to.name})${resumed ? ", going on with the copy an earlier move left" : ""}, after its next ${values.after}`,
  );
  await inStepAt(to, values.yes ? "apply" : "read");
  if (!values.yes) {
    console.log("nothing is done without --yes");
    return;
  }
  // Counted before the pause, on the login `continue` goes on with, less the run itself.
  const numbered = values.login ?? launch?.login;
  await roomToStart(payerOf(numbered, flags), to.host?.name ?? "here", name);
  // Asked before the pause too: `continue` refuses a login its host lacks, by then of a stopped run.
  const asks = to.host !== undefined && numbered !== undefined && !values.hold;
  if (asks && !(await loginPresent(to.host, numbered))) {
    throw new Error(`login ${numbered} must be carried to ${to.name} first: nothing was stopped or moved`);
  }
  // Prepare before the pause: a missing commit or failed install must leave the source running.
  const controller = to.host === undefined ? undefined : await preparedHost(to.host, commit);
  if (to.host === undefined) publishedAt(to.repo, commit);
  const paused = ["pause", name, "--after", values.after, "--yes"];
  if (from.host === undefined) await pause(paused.slice(1));
  else if ((await verbOn(from.host, paused)) !== 0) throw new Error(`${name} did not pause at ${from.name}`);
  const worktree = `git -C ${quoted(to.repo)} worktree add -q --detach ${quoted(tree)} ${quoted(commit)} && `;
  at(to, `${resumed ? "" : worktree}mkdir -p ${quoted(folder(tree))}`);
  // Each relay owns its stage. A retry must copy only files still at the source.
  const stage = from.host && to.host ? mkdtempSync(join(tmpdir(), "ana-move-")) : undefined;
  try {
    if (stage !== undefined) await rsync(`${sideOf(from.host, folder(source))}/`, `${stage}/`);
    await rsync(`${stage ?? sideOf(from.host, folder(source))}/`, `${sideOf(to.host, folder(tree))}/`);
  } finally {
    if (stage !== undefined) rmSync(stage, { recursive: true, force: true });
  }
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
    options: { from: { type: "string" }, whole: { type: "boolean", default: false } },
  });
  const [name, ...rest] = positionals;
  if (rest.length > 0) throw new Misused();
  const from = keyIfDefined("from", values.from);
  // A reader takes a copy as it stands where no host can be asked (`syncRuns`), so a campaign asked
  // for by name is refused before the read, rather than a fetch from a tree that holds no host list
  // printing the stale copy's path and exiting 0.
  if (name !== undefined && hostsOf().length === 0) {
    throw new Error(`ANA_HOSTS lists no host, so there is nowhere to fetch ${name} from`);
  }
  // With no name, the records of every campaign the other hosts hold: the gather a timer runs.
  // `--whole` brings their folders too, as the nightly pass does; a named campaign always comes whole.
  const copies = await syncRuns(name === undefined ? [] : [name], {
    ...from,
    ...(name === undefined ? { depth: values.whole ? "whole" : "record" } : { match: "exact" }),
  });
  if (copies.length === 0 && name !== undefined) {
    throw new Error(`no host ANA_HOSTS lists holds a campaign ${name}`);
  }
  for (const log of copies) console.log(log);
  if (name !== undefined) return;
  for (const line of recordDegradations(copies, runtimeProcess.cwd())) console.log(line);
  // The gather keeps the benchmark scores here beside the campaigns whose references they read.
  for (const folder of await fetchBenches()) console.log(folder);
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
    throw new Misused(`--to names a worktree of this repository: ${trees.join(", ")}`);
  }
  const run = readNamed(name);
  if (run.archived !== undefined && run.archived !== HERE) {
    throw new Error(
      `${name} is a copy of a campaign ${run.archived} holds: runs move takes one to another machine`,
    );
  }
  if (stillRunning(run, processes())) {
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
function asideOf(tree: string, name: string): string {
  return join(tree, ".ana", "moved", `${name}-${new Date().toISOString().replaceAll(/[:.]/g, "")}`);
}

/** Moves `folder` to `aside`, making `.ana/moved/` where the tree has none yet. */
function setAside(folder: string, aside: string): void {
  mkdirSync(dirname(aside), { recursive: true });
  renameSync(folder, aside);
}
