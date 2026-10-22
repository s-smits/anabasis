/**
 * Start a campaign, go on with one, and pause one at a clean point.
 *
 *   bun --env-file=<file> run runs launch <name> [--login N] [--yes] -- <the campaign command's flags>
 *   bun --env-file=<file> run runs continue <name> [--at <commit>] [--login N] [--budget N]
 *     [--after promoted|compacted|reported|finished] [--yes] [-- <flags>]
 *   bun run runs pause <name> --after promoted|compacted|reported|finished [--yes]
 *   bun run runs copy <name> --to <worktree> [--yes]
 *
 * `launch` starts the campaign command (`tools/d2/harness-builder.ts`) under a name no worktree
 * holds a campaign of, in this worktree. `continue` runs a campaign again from its log in the
 * worktree that holds it, on the flags its last run kept (`lastLaunch`), less its name and its
 * total: the record holds the total, which a budget word may have set since, and `--budget` names
 * another. `pause` waits until the log has gained one more of the named event and no comparison,
 * Examiner session or draft is open, and then stops the run (`stop.ts`); `continue --after` is that
 * pause and then the continue, which moves a run to another login or commit. Flags after `--` stand
 * for the kept ones.
 *
 * `copy` takes a campaign no process writes or keeps, its folder whole, to another worktree of the
 * repository, from a worktree or from this machine's archive (`runs retire`), and sets the folder it
 * leaves aside under `.ana/moved/` of the tree it was in, so that one worktree holds
 * the name; `continue` then goes on with it there. It is the one way a campaign's folder moves
 * (operator, 15 October), since a log is never copied by hand. Another machine takes it by
 * `runs move` (`move.ts`).
 *
 * Without `--yes` a verb says what it would do and does nothing. With it, a start refuses a run a
 * process writes, a worktree with a change no commit names and a commit no remote branch holds;
 * `--at` another commit is refused while a comparison that began has not reported, since that
 * comparison goes on under its own terms and its solves were made under its own code, and the
 * command refuses it there and ends on its environment. Then it checks out the commit, installs,
 * and starts the command only once the command's own dry run passed: niced, in a process group of
 * its own, its output beside the receipt the command keeps (`launch-run-<n>.out` and `.err`).
 *
 * `--login N` runs the command on the login the environment holds as `CLAUDE_CODE_OAUTH_TOKEN<N>`,
 * passed on as `CLAUDE_CODE_OAUTH_TOKEN`, and no numbered key reaches the command. With none named
 * and no unnumbered login held, the one numbered login is taken, and two or more are refused: on 16
 * October a launch from a file holding one numbered key dropped it, and three drafts ended on a
 * provider not configured. The verb never opens the env file: Bun's own `--env-file` loads it.
 *
 * Until 15 October this was shell lines in a skill and scripts of the operator's: each continue was
 * typed by hand from the receipt, a pause was a shell loop, and a login went through a wrapper that
 * also carried the run's name, so a stop ended two process groups for one run. The launcher that
 * went on 11 October (`7f0add79:docs/simplify.md`, D2) asked a move's admissions a second time; these verbs
 * ask none, and the command refuses what it refuses.
 */
import { unfinished } from "#src/kernel/trace.ts";
import { LOG_FILE, type LogEvent } from "#src/kernel/log.ts";
import { cpSync, existsSync, mkdirSync, openSync, renameSync, statSync } from "#src/meta/filesystem.ts";
import { worktrees } from "#src/meta/git.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { capturedExecPath, capturedSpawn, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { decodeOutput, processGroupExists, runSync } from "#src/meta/subprocess.ts";
import { lastLaunch, nextRun } from "./receipt.ts";
import {
  BUILDER,
  CAMPAIGNS,
  campaignOf,
  everyRun,
  HERE,
  isCampaign,
  keepers,
  logEvents,
  openComparisons,
  processes,
  type Run,
  readNamed,
  runNamed,
  standing,
  writers,
} from "./registry.ts";
import { stop } from "./stop.ts";
import { installAt, publishedAt } from "./code.ts";

/** The events a pause waits for one more of, by the word that names it. */
const AFTER = {
  promoted: "harness.promoted",
  compacted: "build.compacted",
  reported: "comparison.reported",
  finished: "build.finished",
} as const;
const TOKEN = "CLAUDE_CODE_OAUTH_TOKEN";
const NUMBERED = new RegExp(`^${TOKEN}\\d+$`);
/** The flags a run again does not repeat: its name, which the verb names, and its total. */
const DROPPED = ["--name", "--budget"];
const LOOK_MS = 30_000;

/** The flags a campaign runs again on: `flags` less its name and total, and `budget` where named. */
export function rerun(flags: readonly string[], budget: string | undefined): string[] {
  const kept = flags.filter(
    (flag, at) =>
      !DROPPED.includes(flags[at - 1] ?? "") &&
      !DROPPED.some((dropped) => flag === dropped || flag.startsWith(`${dropped}=`)),
  );
  return budget === undefined ? kept : [...kept, "--budget", budget];
}

/** `env` with no numbered login, and with login `login`, or the one numbered login held, as its login. */
export function loginEnv(env: Readonly<Record<string, string | undefined>>, login: string | undefined) {
  const kept: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(env).filter(([key]) => !NUMBERED.test(key)),
  );
  if (login === undefined) {
    const held = Object.keys(env).filter((key) => NUMBERED.test(key) && env[key] !== "");
    if ((env[TOKEN] ?? "") !== "" || held.length === 0) return kept;
    if (held.length > 1) {
      throw new Error(`no login named, and ${held.join(", ")} held: name one with --login N`);
    }
    return loginEnv(env, held[0]?.slice(TOKEN.length));
  }
  const token = env[`${TOKEN}${login}`];
  if (token === undefined || token === "") {
    throw new Error(
      `${TOKEN}${login} is not set: run the verb under bun --env-file=<the file that holds it>`,
    );
  }
  // The receipt keeps which login ran (`keepReceipt`), which `keep` moves a run off.
  return { ...kept, [TOKEN]: token, ANA_LOGIN: login };
}

/** Whether a pause may stop the run whose log is `events`: it holds more than `base` of `kind`, and
 *  no comparison, Examiner session or draft is open. The Builder's conversation is open throughout
 *  a led campaign, and a pause cuts it: the campaign run again opens a new one on its notes. */
export function restsAfter(events: readonly LogEvent[], kind: string, base: number): boolean {
  const examining = unfinished(events).some(({ of }) => of === "exam" || of === "draft");
  return (
    events.filter((event) => event.kind === kind).length > base &&
    !examining &&
    openComparisons(events).length === 0
  );
}

/** Wait in `run` for one more `after` event at a point it rests, then stop it. */
async function pauseAt(run: Run, after: string): Promise<void> {
  const kind = Object.entries(AFTER).find(([word]) => word === after)?.[1];
  if (kind === undefined) throw new Error(`--after takes ${Object.keys(AFTER).join(", ")}`);
  const base = logEvents(run.path).filter((event) => event.kind === kind).length;
  console.log(
    `${run.name}: waiting for ${kind} past ${String(base)}, with no comparison or Examiner session open`,
  );
  // A log runs to tens of megabytes, and one that did not grow says what it said.
  let size = -1;
  while (writers(run, processes()).length > 0) {
    const grown = statSync(run.path).size;
    if (grown !== size && restsAfter(logEvents(run.path), kind, base)) return stop([run.name, "--yes"]);
    size = grown;
    await Bun.sleep(LOOK_MS);
  }
  console.log(`${run.name} is not running`);
}

/** Start the campaign command for `run` on `flags` in its worktree, at `at` where named, once every
 *  refusal of the head comment is passed and its dry run passed. */
export async function start(
  run: Run,
  flags: readonly string[],
  login: string | undefined,
  at: string | undefined,
) {
  const env = loginEnv(runtimeProcess.env, login);
  if (writers(run, processes()).length > 0) {
    throw new Error(`${run.name} is already being written in ${run.tree}`);
  }
  const { commit, dirty } = standing(run.tree);
  if (dirty) throw new Error(`${run.tree} holds a change no commit names: a run's commit states its source`);
  const target = publishedAt(run.tree, at ?? commit);
  if (target !== commit) {
    const open = openComparisons(logEvents(run.path));
    if (open.length > 0) {
      throw new Error(
        `comparison ${open.join(", ")} began and has not reported: it goes on at ${commit.slice(0, 9)}`,
      );
    }
  }
  installAt(run.tree, target);
  const command = [capturedExecPath, BUILDER, "--name", run.name, ...flags];
  const dry = runSync([...command, "--dry-run"], { cwd: run.tree, env });
  console.log(decodeOutput(dry.stdout).trim().split("\n").slice(-4).join("\n"));
  if (dry.exitCode !== 0) {
    throw new Error(`the dry run at ${target.slice(0, 9)} refused: nothing was started`);
  }
  mkdirSync(dirname(run.path), { recursive: true });
  // The command keeps its receipt as `launch-<nextRun>.json`, and its output sits beside it.
  const out = join(dirname(run.path), `launch-${nextRun(run.path)}`);
  const child = capturedSpawn(["nice", "-n", "19", ...command], {
    cwd: run.tree,
    env,
    // A process group of its own, which `bun run runs stop` ends, outliving this verb.
    detached: true,
    stdin: "ignore",
    stdout: openSync(`${out}.out`, "a"),
    stderr: openSync(`${out}.err`, "a"),
  });
  child.unref();
  await Bun.sleep(3000);
  const alive = processGroupExists(child.pid);
  console.log(
    `${run.name} in ${run.tree} at ${target.slice(0, 9)}: pid ${String(child.pid)}, ${alive ? "running" : "gone"}; ${out}.err`,
  );
  if (!alive) runtimeProcess.exitCode = 1;
}

/** The last run of the campaign command `run` kept a receipt of. */
export function lastRun(run: Run) {
  const kept = lastLaunch(run.path);
  if (kept === undefined) throw new Error(`no run of the campaign command beside ${run.path} kept its flags`);
  return kept;
}

const said = (run: Run, what: string) =>
  console.log(`${run.name} in ${run.tree}: ${what}; nothing is done without --yes`);

/** `bun run runs launch`. */
export async function launch(args: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { login: { type: "string" }, yes: { type: "boolean", default: false } },
  });
  const [name, ...flags] = positionals;
  if (name === undefined || flags.some((flag) => flag === "--name" || flag.startsWith("--name="))) {
    throw new Error(
      "usage: bun run runs launch <name> [--login N] [--yes] -- <the campaign command's flags but --name>",
    );
  }
  // By case too: on macOS's file system a name that differs only by case is the same folder.
  const held = everyRun().find((run) => run.name.toLowerCase() === name.toLowerCase() && isCampaign(run));
  if (held !== undefined) {
    throw new Error(`${name} names a campaign in ${dirname(held.path)}: go on with it by runs continue`);
  }
  const run = campaignOf(runtimeProcess.cwd(), name);
  if (!values.yes) return said(run, `would start ${BUILDER} ${flags.join(" ")}`);
  await start(run, flags, values.login, undefined);
}

/** `bun run runs continue`. */
export async function continueRun(args: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      at: { type: "string" },
      login: { type: "string" },
      budget: { type: "string" },
      after: { type: "string" },
      yes: { type: "boolean", default: false },
    },
  });
  const [name, ...given] = positionals;
  if (name === undefined) {
    throw new Error(
      "usage: bun run runs continue <name> [--at <commit>] [--login N] [--budget N] [--after <event>] [--yes] [-- <flags>]",
    );
  }
  const run = runNamed(name);
  // Flags after `--` stand for the kept ones: a pack's path where the campaign was copied to
  // another host is that host's.
  const flags = given.length > 0 ? rerun(given, values.budget) : rerun(lastRun(run).flags, values.budget);
  if (!values.yes) {
    const after = values.after === undefined ? "" : `after its next ${values.after}, `;
    return said(run, `would go on ${after}at ${values.at ?? "its commit"} on ${flags.join(" ")}`);
  }
  const target = values.at === undefined ? undefined : publishedAt(run.tree, values.at);
  if (values.after !== undefined) await pauseAt(run, values.after);
  await start(run, flags, values.login, target);
}

/** `bun run runs pause`. */
export async function pause(args: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { after: { type: "string" }, yes: { type: "boolean", default: false } },
  });
  const [name] = positionals;
  if (name === undefined || values.after === undefined) {
    throw new Error("usage: bun run runs pause <name> --after promoted|compacted|reported|finished [--yes]");
  }
  const run = runNamed(name);
  if (!values.yes) return said(run, `would be stopped after its next ${values.after}`);
  await pauseAt(run, values.after);
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
  const copied = join(into, LOG_FILE);
  if (statSync(copied).size !== statSync(run.path).size) {
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
