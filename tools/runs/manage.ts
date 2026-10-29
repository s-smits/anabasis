/**
 * Start a campaign, go on with one, and pause one at a clean point.
 *
 *   bun --env-file=<file> run runs launch <name> [--login N] [--yes] -- <the campaign command's flags>
 *   bun --env-file=<file> run runs continue <name> [--at <commit>] [--login N] [--budget N]
 *     [--after next|promoted|compacted|reported|finished] [--yes] [-- <flags>]
 *   bun run runs pause <name> [--after next|promoted|compacted|reported|finished] [--yes]
 *
 * `launch` starts the campaign command (`tools/d2/harness-builder.ts`) under a name no worktree
 * holds a campaign of, in this worktree. `continue` runs a campaign again from its log in the
 * worktree that holds it, on the flags its last run kept (`lastLaunch`), less its name and its
 * total: the record holds the total, which a budget word may have set since, and `--budget` names
 * another. `pause` waits until the log has gained one more of the named event and no comparison,
 * Examiner session or draft is open, and then stops the run (`stop.ts`); `continue --after` is that
 * pause and then the continue, which moves a run to another login or commit. `next`, the word a
 * pause takes where none is named, waits for the next solve that finishes or tool call any seat
 * records, and stops the run there with whatever is open: on 29 October a login had to be freed
 * from a campaign in the middle of an Examiner session, which the clean-point words would only have
 * stopped once the session ended. Flags after `--` stand for the kept ones. A campaign's folder moves by `runs copy` and `runs move` (`move.ts`).
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
 * passed on as `CLAUDE_CODE_OAUTH_TOKEN` and recorded as `ANA_LOGIN`; no numbered key reaches the
 * command. With none named the unnumbered token stays and the numbered keys are removed. The launch
 * guesses no numbered login: the dry run refuses a seat whose provider holds no credential
 * (`served`), so a Claude run may use the unnumbered token, and a run that bills none starts without
 * one. Until 26 October the launcher took the one numbered login a file held, refused
 * two, and from 25 October read the seats' models to skip both for a run that bills none: on
 * 16 October three drafts had ended on a provider not configured, which the dry run now refuses,
 * and on 25 October a gpt-6.1-sol launch was refused for want of a login no seat would use. Which
 * login a run takes is chosen by `fresh` and `keep` (`billsLogin`, `logins.ts`). The verb never
 * opens the env file: Bun's own `--env-file` loads it.
 *
 * Until 15 October this was shell lines in a skill and scripts of the operator's: each continue was
 * typed by hand from the receipt, a pause was a shell loop, and a login went through a wrapper that
 * also carried the run's name, so a stop ended two process groups for one run. These verbs ask no
 * admission of a move (`7f0add79:docs/simplify.md`, D2): the command refuses what it refuses.
 */
import { unfinished } from "#src/kernel/trace.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { mkdirSync, openSync, statSync } from "#src/meta/filesystem.ts";
import { dirname, join } from "#src/meta/path.ts";
import { capturedExecPath, capturedSpawn, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { decodeOutput, processGroupExists, runSync } from "#src/meta/subprocess.ts";
import { lastLaunch, nextRun } from "./receipt.ts";
import { payerOf } from "./live.ts";
import { roomToStart } from "./logins.ts";
import {
  BUILDER,
  campaignOf,
  everyRun,
  isCampaign,
  logEvents,
  openComparisons,
  processes,
  type Run,
  runNamed,
  standing,
  writers,
} from "./registry.ts";
import { stop } from "./stop.ts";
import { installAt, publishedAt } from "./code.ts";

/** The events a pause waits for one more of, by the word that names it: `next` is the smallest step
 *  a run completes, a finished solve or a recorded tool call of any seat. */
const AFTER = {
  next: [
    "solve.finished",
    "build.call",
    "draft.call",
    "exam.call",
    "referee.call",
    "repair.call",
    "solve.call",
  ],
  promoted: ["harness.promoted"],
  compacted: ["build.compacted"],
  reported: ["comparison.reported"],
  finished: ["build.finished"],
} as const;
const TOKEN = "CLAUDE_CODE_OAUTH_TOKEN";
const NUMBERED = new RegExp(`^${TOKEN}\\d+$`);
/** The flags a run again does not repeat: its name, which the verb names, and its total. */
const DROPPED = ["--name", "--budget"];
const LOOK_MS = 30_000;
/** How often a pause at the next step looks, since a step follows another within seconds. */
const STEP_MS = 1_000;

/** The flags a campaign runs again on: `flags` less its name and total, and `budget` where named. */
export function rerun(flags: readonly string[], budget: string | undefined): string[] {
  const kept = flags.filter(
    (flag, at) =>
      !DROPPED.includes(flags[at - 1] ?? "") &&
      !DROPPED.some((dropped) => flag === dropped || flag.startsWith(`${dropped}=`)),
  );
  return budget === undefined ? kept : [...kept, "--budget", budget];
}

/** `env` less its numbered logins, and with `login`, where named, as its login. */
export function loginEnv(env: Readonly<Record<string, string | undefined>>, login: string | undefined) {
  const kept = Object.fromEntries(Object.entries(env).filter(([key]) => !NUMBERED.test(key)));
  if (login === undefined) return kept;
  const token = env[`${TOKEN}${login}`];
  if (token === undefined || token === "") {
    throw new Error(
      `${TOKEN}${login} is not set: run the verb under bun --env-file=<the file that holds it>`,
    );
  }
  // The receipt keeps which login ran (`keepReceipt`), which `keep` and `runs usage` read.
  return { ...kept, [TOKEN]: token, ANA_LOGIN: login };
}

/** The kinds of event the word `after` names, or undefined where it names none. */
const kindsOf = (after: string): readonly string[] | undefined =>
  Object.entries(AFTER).find(([word]) => word === after)?.[1];

/** How many events of the kinds `after` names `events` holds. */
const countOf = (events: readonly LogEvent[], after: string) =>
  events.filter((event) => kindsOf(after)?.includes(event.kind) === true).length;

/** Whether a pause may stop the run whose log is `events`: it holds more than `base` of the kinds
 *  `after` names, and, past the next step, no comparison, Examiner session or draft is open. The
 *  Builder's conversation is open throughout a led campaign, and a pause cuts it: the campaign run
 *  again opens a new one on its notes. */
export function restsAfter(events: readonly LogEvent[], after: string, base: number): boolean {
  return (
    countOf(events, after) > base &&
    (after === "next" ||
      (!unfinished(events).some(({ of }) => of === "exam" || of === "draft") &&
        openComparisons(events).length === 0))
  );
}

/** Wait in `run` for one more `after` event at a point it rests, then stop it. */
async function pauseAt(run: Run, after: string): Promise<void> {
  const kinds = kindsOf(after);
  if (kinds === undefined) throw new Error(`--after takes ${Object.keys(AFTER).join(", ")}`);
  const base = countOf(logEvents(run.path), after);
  console.log(
    after === "next"
      ? `${run.name}: waiting for its next finished solve or tool call`
      : `${run.name}: waiting for ${kinds.join(", ")} past ${String(base)}, with no comparison or Examiner session open`,
  );
  // A log runs to tens of megabytes, and one that did not grow says what it said.
  let size = -1;
  while (writers(run, processes()).length > 0) {
    const grown = statSync(run.path).size;
    if (grown !== size && restsAfter(logEvents(run.path), after, base)) return stop([run.name, "--yes"]);
    size = grown;
    await Bun.sleep(after === "next" ? STEP_MS : LOOK_MS);
  }
  console.log(`${run.name} is not running`);
}

/** Start the campaign command for `run` on `flags` in its worktree, as `login` where named and at
 *  `at` where named, once every refusal of the head comment is passed and its dry run passed. */
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
  const open = target === commit ? [] : openComparisons(logEvents(run.path));
  if (open.length > 0) {
    throw new Error(
      `comparison ${open.join(", ")} began and has not reported: it goes on at ${commit.slice(0, 9)}`,
    );
  }
  await roomToStart(payerOf(login, flags), "here", run.name);
  installAt(run.tree, target);
  const command = [capturedExecPath, BUILDER, "--name", run.name, ...flags];
  const dry = runSync([...command, "--dry-run"], { cwd: run.tree, env });
  console.log(decodeOutput(dry.stdout).trim().split("\n").slice(-4).join("\n"));
  if (dry.exitCode !== 0) {
    // The campaign command's own refusal, such as a seat without a credential, is the reason.
    console.error(decodeOutput(dry.stderr).trimEnd());
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

/** What `run` would do without `--yes`, said. */
export const said = (run: Run, what: string) =>
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
  const flags = rerun(given.length > 0 ? given : lastRun(run).flags, values.budget);
  if (!values.yes) {
    const after = values.after === undefined ? "" : `after its next ${values.after}, `;
    return said(run, `would go on ${after}at ${values.at ?? "its commit"} on ${flags.join(" ")}`);
  }
  // A commit no remote holds is refused before the pause, which would leave the run stopped.
  const target = values.at === undefined ? undefined : publishedAt(run.tree, values.at);
  if (values.after !== undefined) {
    // Counted before the pause, which would leave the run stopped where `start` then refuses it.
    await roomToStart(payerOf(values.login, flags), "here", run.name);
    await pauseAt(run, values.after);
  }
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
  if (name === undefined) {
    throw new Error(
      "usage: bun run runs pause <name> [--after next|promoted|compacted|reported|finished] [--yes]",
    );
  }
  const run = runNamed(name);
  const after = values.after ?? "next";
  if (!values.yes) return said(run, `would be stopped after its next ${after === "next" ? "step" : after}`);
  await pauseAt(run, after);
}
