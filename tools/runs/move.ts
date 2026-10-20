/**
 * Move a campaign to another machine, and go on with it there on the login named.
 *
 *   bun --env-file=<credentials> --env-file=.env.runs run runs move <name> --to <host|here>
 *     [--from <host|here>] [--login N] [--after promoted|compacted|reported|finished] [--hold]
 *     [--yes] [-- <flags>]
 *
 * One end is this machine (`here`, the default source) and the other a host `ANA_HOSTS` lists. The
 * verb pauses the campaign where it runs, at the next `--after` event with no comparison, Examiner
 * session or draft open (`runs pause`; one no process writes is taken as it is, and without
 * `--after` the pause waits for the next `finished`), makes a worktree beside the destination's
 * repository at the commit the source's worktree stands at, takes the campaign's folder there whole
 * with rsync and checks that the log arrived as long as it left, sets the source's folder aside under
 * `.ana/moved/`, as `runs copy` does, and runs `runs continue` there on the flags its last run kept.
 * A kept flag that names a path under the folder that holds the source's worktrees names the same
 * path under the destination's (`rehomed`), so a prompt file beside the repository is found on a
 * machine whose home is elsewhere; flags after `--` stand for the kept ones. `--hold` stops before
 * the continue, and prints it. Without `--yes` the verb reads where each end stands and moves
 * nothing.
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
 */
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { type Host, hostNamed, quoted, sshScript, verbOn } from "./hosts.ts";
import { asideOf, continueRun, lastRun, pause, setAside } from "./manage.ts";

/** One end of a move: this machine or a host, with the folder its worktrees sit in. */
interface End {
  readonly name: string;
  readonly host: Host | undefined;
  /** A worktree of the repository there, absolute: the folder it sits in holds the others. */
  readonly repo: string;
}

const HERE = "here";
const USAGE =
  "usage: bun run runs move <name> --to <host|here> [--from <host|here>] [--login N] [--after <event>] [--hold] [--yes] [-- <flags>]";

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
    repo: at(end, `cd ${host === undefined ? "." : host.tree} && git rev-parse --show-toplevel`),
  };
}

/** The worktree at `end` whose `.ana/d2/<name>` holds a campaign log, and refused where none or two do. */
function treeOf(end: End, name: string): string {
  const found = at(
    end,
    `git -C ${quoted(end.repo)} worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r w; do test -f "$w/.ana/d2/${name}/log.jsonl" && echo "$w"; done; true`,
  )
    .split("\n")
    .filter((line) => line !== "");
  const [only, other] = found;
  if (only === undefined) throw new Error(`no worktree ${end.name} holds a campaign ${name}`);
  if (other !== undefined) throw new Error(`${name} names a campaign in ${found.join(" and in ")}`);
  return only;
}

/** The rsync side of `path` at `end`. */
const side = (end: End, path: string) => (end.host === undefined ? path : `${end.host.ssh}:${path}`);

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
  if (name === undefined || values.to === undefined || values.to === values.from) throw new Error(USAGE);
  if (values.to !== HERE && values.from !== HERE) {
    throw new Error(
      `one end of a move is this machine: --from ${values.from} --to ${values.to} names two hosts`,
    );
  }
  const from = endOf(values.from);
  const to = endOf(values.to);
  const source = treeOf(from, name);
  const commit = at(from, `git -C ${quoted(source)} rev-parse HEAD`);
  const tree = join(dirname(to.repo), `anabasis-${name}`);
  const folder = (root: string) => join(root, ".ana", "d2", name);
  const login = values.login === undefined ? [] : ["--login", values.login];
  // Read before anything stops: a pause that a taken destination then refuses leaves the run stopped.
  if (at(to, `test -e ${quoted(tree)} && echo taken; true`) === "taken") {
    throw new Error(`${tree} is there already on ${to.name}: nothing was stopped or moved`);
  }
  console.log(
    `${name}: from ${source} (${from.name}) at ${commit.slice(0, 9)} to ${tree} (${to.name}), after its next ${values.after}`,
  );
  if (!values.yes) {
    console.log("nothing is done without --yes");
    return;
  }
  const paused = ["pause", name, "--after", values.after, "--yes"];
  if (from.host === undefined) await pause(paused.slice(1));
  else if ((await verbOn(from.host, paused)) !== 0) throw new Error(`${name} did not pause at ${from.name}`);
  at(
    to,
    `git -C ${quoted(to.repo)} fetch -q origin && git -C ${quoted(to.repo)} worktree add -q --detach ${quoted(tree)} ${commit} && mkdir -p ${quoted(folder(tree))}`,
  );
  runTextSyncOrThrow(["rsync", "-a", `${side(from, folder(source))}/`, `${side(to, folder(tree))}/`]);
  const size = (end: End, root: string) => at(end, `wc -c < ${quoted(join(folder(root), "log.jsonl"))}`);
  if (size(from, source) !== size(to, tree)) {
    throw new Error(`the log did not arrive whole in ${folder(tree)}: ${folder(source)} is left as it was`);
  }
  // The receipts are read where they are on this machine: the source's before it is set aside, or
  // the copy that arrived.
  const local = from.host === undefined ? source : tree;
  const kept = lastRun({
    name,
    tree: local,
    path: join(folder(local), "log.jsonl"),
    end: "comparison.reported",
  });
  const flags = given.length > 0 ? given : rehomed(kept.flags, dirname(from.repo), dirname(to.repo));
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
    return;
  }
  if (to.host === undefined) await continueRun(going.slice(1));
  else if ((await verbOn(to.host, going)) !== 0) throw new Error(`${name} did not go on at ${to.name}`);
}
