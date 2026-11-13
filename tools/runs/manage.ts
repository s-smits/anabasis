/**
 * Start a campaign, go on with one, and pause one at a clean point.
 *
 *   bun --env-file=<file> run runs launch <name> [--login N] [--yes]
 *     -- <the campaign command's flags but --name>
 *   bun --env-file=<file> run runs continue <name> [--at <commit>] [--login N] [--budget N]
 *     [--after <word>[|<word>...]] [--yes] [-- <flags>]
 *   bun run runs pause <name> [--after <word>[|<word>...]] [--yes]
 *
 * `launch` starts the campaign command (`tools/d2/harness-builder.ts`) under a name no worktree
 * holds a campaign of, in this worktree. `continue` runs a campaign again from its log in the
 * worktree that holds it, on the flags its last run kept (`lastLaunch`), less its name and its
 * total: the record holds the total, which a budget word may have set since, and `--budget` names
 * another. `pause` waits until the log has gained one more of the named event and nothing but the
 * Builder's conversation is open, and then stops the run (`stop.ts`), `reported` also waiting out a
 * promotion its starter comparison has not read (`restsAfter`); `continue --after` is that
 * pause and then the continue, which moves a run to another login or commit. `next`, the word a
 * pause takes where none is named, waits for the next solve that finishes or tool call any seat
 * records, having left a word that starts no further solve, once every open solve has finished, or
 * past the run's own limit on a solve with whatever is open, since a cut solve is paid for again:
 * `runs stop` is the one that does not wait. On 29 October a login had to be freed
 * from a campaign in the middle of an Examiner session, which the clean-point words would only have
 * stopped once the session ended. Flags after `--` stand for the kept ones. A campaign's folder moves by `runs copy` and `runs move` (`move.ts`).
 *
 * A run `launch` or `continue` starts on a numbered login gets a keeper (`keep.ts`) where another login
 * is allowed, so that it goes on elsewhere at a limit with nobody there (operator, 5 November: "bring
 * over to other account that still has room if 5hr limit or full limit is reached"). `ANA_KEEP=off`
 * leaves every run the environment starts without one (`keepsItself`). Until then
 * a keeper took a person's `runs keep` a run, and on 5 November two campaigns on a login whose week ran
 * out sat idle in their wait, two days from its reset, with no keeper to move them.
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
 * and on 25 October a gpt-6.1-sol launch was refused for want of a login no seat would use. A
 * `continue` that names no login stays on the one its last run recorded, which is no guess: on
 * 11 November one typed without `--login` put a run launched on a numbered login on the unnumbered
 * one, where its Builder session crashed at once, and the account that pays is the operator's. Which
 * login a run takes is chosen by `fresh` and `keep` (`billsLogin`, `logins.ts`). The verb never
 * opens the env file: Bun's own `--env-file` loads it.
 *
 * Until 15 October this was shell lines in a skill and scripts of the operator's: each continue was
 * typed by hand from the receipt, a pause was a shell loop, and a login went through a wrapper that
 * also carried the run's name, so a stop ended two process groups for one run. These verbs ask no
 * admission of a move (`7f0add79:docs/simplify.md`, D2): the command refuses what it refuses.
 */
import { SEATS, traceKind, unfinished } from "#src/kernel/trace.ts";
import { append, type LogEvent } from "#src/kernel/log.ts";
import { PAUSE, pauseWaitMs } from "#src/campaign/word.ts";
import { epochsOf } from "#src/campaign/climb.ts";
import { mkdirSync, openSync, statSync } from "#src/meta/filesystem.ts";
import { dirname, join } from "#src/meta/path.ts";
import { capturedExecPath, capturedSpawn, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { decodeOutput, processGroupExists, runSync } from "#src/meta/subprocess.ts";
import { lastLaunch, nextRun } from "./receipt.ts";
import { payerOf } from "./live.ts";
import { LIMITS } from "../d2/campaign.ts";
import { recordedSetting } from "../d2/setting.ts";
import { allowedLogins, type Env, NUMBERED, roomToStart, TOKEN, tokenOf } from "./logins.ts";
import {
  BUILDER,
  campaignOf,
  everyRun,
  isCampaign,
  KEEPING,
  logEvents,
  keepers,
  keptFile,
  Misused,
  openComparisons,
  processes,
  type Run,
  runNamed,
  standing,
  waiters,
  writers,
} from "./registry.ts";
import { stop } from "./stop.ts";
import { installAt, publishedAt } from "./code.ts";

/** The hours left in a provider wait below which a keeper leaves its run to the login's own reset. */
export const WAIT_HOURS = "0.25";

/** The events a pause waits for one more of, by the word that names it: `next` is the smallest step
 *  a run completes, a finished solve or a recorded tool call of any seat, and `compacted` a
 *  compaction of any seat's conversation. Words joined by `|` wait for the first of their events. */
const AFTER = {
  next: ["solve.finished", "build.call", "draft.call", "exam.call", "referee.call", "solve.call"],
  compacted: SEATS.map((seat) => traceKind(seat, "compacted")),
  reported: ["comparison.reported"],
  promoted: ["harness.promoted"],
  examined: ["exam.finished"],
  finished: ["build.finished"],
} as const;
/** The flags a run again does not repeat: its name, which the verb names, and its total. */
const DROPPED = ["--name", "--budget"];
const LOOK_MS = 30_000;
/** How often a pause at the next step looks, since a step follows another within seconds. */
const STEP_MS = 1000;

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
export function loginEnv(env: Env, login: string | undefined) {
  const kept = Object.fromEntries(Object.entries(env).filter(([key]) => !NUMBERED.test(key)));
  if (login === undefined) return kept;
  const token = tokenOf(env, login);
  if (token === undefined) {
    throw new Error(
      `${TOKEN}${login} is not set: run the verb under bun --env-file=<the file that holds it>`,
    );
  }
  // The receipt keeps which login ran (`keepReceipt`), which `keep` and `runs usage` read.
  return { ...kept, [TOKEN]: token, ANA_LOGIN: login };
}

const isWord = (word: string): word is keyof typeof AFTER => Object.hasOwn(AFTER, word);

/** The kinds of event the words `after` names, refused where one of them names none, or where
 *  `next` is joined to another: it pauses at the next step, with its own word to the run and its own
 *  rest, and every other point lies past it. The dry form asks it too, and so refuses as `--yes` does. */
function kindsOf(after: string): readonly string[] {
  const words = after.split("|");
  if (!words.every(isWord) || (words.length > 1 && words.includes("next"))) {
    throw new Error(`--after takes ${Object.keys(AFTER).join(", ")}, or several but next joined by |`);
  }
  return words.flatMap((word) => AFTER[word]);
}

/** How many events of `kinds` `events` holds. */
const countOf = (events: readonly LogEvent[], kinds: readonly string[]) =>
  events.filter(({ kind }) => kinds.includes(kind)).length;

/** Whether a pause may stop the run whose log is `events`: it holds more than `base` of the kinds
 *  `after` names, and no solve is open at the next step, or, past it, nothing but the Builder's
 *  conversation: no comparison, Examiner ask, draft, solve or Referee reading. The Builder's
 *  conversation is open throughout a led campaign, and a pause cuts it: the campaign run again opens
 *  a new one on its notes, from the last harness it practised or froze (`endCut`). A practice solve
 *  and its reading are read since that conversation began: one a killed run left open stays open on
 *  record, since `endCut` ends sessions only (3 of 65 campaigns since 1 November), and holds nothing.
 *  `reported` alone also waits out a promotion no starter comparison has tallied (`epochsOf`), since
 *  a run rested there leaves it unconfirmed (`AGENTS.md`, factor 1): the host promotes a step before
 *  any other comparison, and on 13 November opened a writing session 5 seconds after one, past which
 *  a pause would have rested the run before that read. A word naming `promoted` rests at it. */
export function restsAfter(events: readonly LogEvent[], after: string, base: number): boolean {
  if (countOf(events, kindsOf(after)) <= base) return false;
  const open = unfinished(events);
  if (after === "next") return !open.some(({ of }) => of === "solve");
  const last = epochsOf(events).at(-1);
  if (after === "reported" && last?.reference !== "starter" && last?.starter_tally === null) return false;
  const led = events.slice(events.findLastIndex(({ kind }) => kind === "build.started"));
  return (
    !open.some(({ of }) => of === "exam" || of === "draft") &&
    openComparisons(events).length === 0 &&
    unfinished(led).every(({ of }) => of === "build")
  );
}

/** How long a pause at the next step lets the open solves of the run whose log is `events` finish:
 *  the limit its setting recorded, as the solves were given it. */
export function solvesMs(events: readonly LogEvent[]): number {
  return pauseWaitMs((recordedSetting(events)?.minutes ?? LIMITS.wallSeconds / 60) * 60);
}

async function pauseAt(run: Run, after: string): Promise<void> {
  const kinds = kindsOf(after);
  // One waiter a run: a `continue --after` would start again a run another's pause had stopped.
  const waiting = waiters(run.name);
  if (waiting.length > 0) {
    throw new Error(`${run.name} already waits to stop in process ${waiting.join(", ")}`);
  }
  const events = logEvents(run.path);
  const base = countOf(events, kinds);
  const allowed = solvesMs(events);
  console.log(
    after === "next"
      ? `${run.name}: starting no further solve, and letting its open ones finish, ${String(allowed / 60_000)} minutes at most`
      : `${run.name}: waiting for ${kinds.join(", ")} past ${String(base)}, with nothing but the Builder's conversation open${after === "reported" ? " and no promotion left unread against the starter" : ""}`,
  );
  if (after === "next" && writers(run, processes()).length > 0) {
    append(run.path, "campaign.word", { word: PAUSE });
  }
  const patience = Date.now() + allowed;
  // A log runs to tens of megabytes, and one that did not grow says what it said.
  let size = -1;
  // A kept run between two starts, at a login's limit, still owes the point a word names: its keeper
  // starts it again, and a stop now would read a comparison it never wrote.
  const waits = () =>
    writers(run, processes()).length > 0 || (after !== "next" && keepers(run.name).length > 0);
  while (waits()) {
    const grown = statSync(run.path).size;
    // Past its patience nothing need have moved: a held solve records nothing.
    const late = after === "next" && Date.now() > patience;
    if (late || (grown !== size && restsAfter(logEvents(run.path), after, base))) {
      return stop([run.name, "--yes"]);
    }
    size = grown;
    await Bun.sleep(after === "next" ? STEP_MS : LOOK_MS);
  }
  // A keeper starts a run no process writes again: until 30 October it outlived the pause, and
  // could go on with the run at its source while a move copied it away.
  if (keepers(run.name).length > 0) return stop([run.name, "--yes"]);
  console.log(`${run.name} is not running`);
}

/** Start the campaign command for `run` on `flags` in its worktree, as `login` where named and at
 *  `at` where named, once every refusal of the head comment is passed and its dry run passed, and
 *  say whether it is running three seconds on. */
export async function start(
  run: Run,
  flags: readonly string[],
  login: string | undefined,
  at: string | undefined,
): Promise<boolean> {
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
  const command = dryRun(run, flags, env, target);
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
  return alive;
}

/** The campaign command for `run` on `flags`, once its dry run in `run`'s tree at `at` passed. */
function dryRun(run: Run, flags: readonly string[], env: ReturnType<typeof loginEnv>, at: string) {
  const command = [capturedExecPath, BUILDER, "--name", run.name, ...flags];
  const dry = runSync([...command, "--dry-run"], { cwd: run.tree, env });
  console.log(decodeOutput(dry.stdout).trim().split("\n").slice(-4).join("\n"));
  if (dry.exitCode !== 0) {
    // The campaign command's own refusal, such as a seat without a credential, is the reason.
    console.error(decodeOutput(dry.stderr).trimEnd());
    throw new Error(`the dry run at ${at.slice(0, 9)} refused: nothing was started`);
  }
  return command;
}

/** Leave a keeper of `run` running by itself, its output in `keep.out` beside the log: on `logins`
 *  where they were named, otherwise on the pool its host names at each move (`poolOf`, `keep.ts`). */
export function leaveKeeper(run: Run, logins: readonly string[] | undefined, waitHours: string): void {
  const out = keptFile(run);
  const child = capturedSpawn(
    [
      capturedExecPath,
      join(import.meta.dir, "cli.ts"),
      "keep",
      run.name,
      ...(logins === undefined ? [] : ["--logins", logins.join(",")]),
      "--wait-hours",
      waitHours,
      KEEPING,
    ],
    {
      cwd: run.tree,
      // A keeper outlives the verb, and counts every machine's runs even where another host sent it.
      env: { ...runtimeProcess.env, ANA_HOP: undefined },
      detached: true,
      stdin: "ignore",
      stdout: openSync(out, "a"),
      stderr: openSync(out, "a"),
    },
  );
  child.unref();
  console.log(`${run.name}: kept by pid ${String(child.pid)}; ${out}`);
}

/** Whether a run started on `login` gets a keeper by itself: it pays by a numbered login, another is
 *  allowed to go on with, and `ANA_KEEP=off` did not say otherwise. A run with no numbered login has
 *  nowhere to move, and goes on as it was started. */
export function keepsItself(env: Env, login: string | undefined): boolean {
  return env.ANA_KEEP !== "off" && login !== undefined && allowedLogins(env).some((other) => other !== login);
}

/** `start`, then a keeper where the run is running and `keepsItself`, unless it has one. */
async function startKept(
  run: Run,
  flags: readonly string[],
  { login, at }: { login: string | undefined; at: string | undefined },
): Promise<void> {
  const running = await start(run, flags, login, at);
  if (running && keepsItself(runtimeProcess.env, login) && keepers(run.name).length === 0) {
    leaveKeeper(run, undefined, WAIT_HOURS);
  }
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
    options: {
      login: { type: "string" },
      yes: { type: "boolean", default: false },
    },
  });
  const [name, ...flags] = positionals;
  if (name === undefined || flags.some((flag) => flag === "--name" || flag.startsWith("--name="))) {
    throw new Misused();
  }
  // By case too: on macOS's file system a name that differs only by case is the same folder.
  const held = everyRun().find((run) => run.name.toLowerCase() === name.toLowerCase() && isCampaign(run));
  if (held !== undefined) {
    throw new Error(`${name} names a campaign in ${dirname(held.path)}: go on with it by runs continue`);
  }
  const run = campaignOf(runtimeProcess.cwd(), name);
  if (!values.yes) return said(run, `would start ${BUILDER} ${flags.join(" ")}`);
  await startKept(run, flags, { login: values.login, at: undefined });
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
    throw new Misused();
  }
  if (values.after !== undefined) kindsOf(values.after);
  const run = runNamed(name);
  // Flags after `--` stand for the kept ones: a pack's path where the campaign was copied to
  // another host is that host's.
  const flags = rerun(given.length > 0 ? given : lastRun(run).flags, values.budget);
  const login = values.login ?? lastLaunch(run.path)?.login;
  if (!values.yes) {
    const after = values.after === undefined ? "" : `after its next ${values.after}, `;
    const payer = login === undefined ? "the unnumbered login" : `login ${login}`;
    return said(
      run,
      `would go on ${after}at ${values.at ?? "its commit"} on ${payer} with ${flags.join(" ")}`,
    );
  }
  // A commit no remote holds is refused before the pause, which would leave the run stopped.
  const target = values.at === undefined ? undefined : publishedAt(run.tree, values.at);
  const { commit } = standing(run.tree);
  // `next` may stop the run inside a comparison, which `start` then refuses at another commit.
  if (values.after === "next" && target !== undefined && target !== commit) {
    throw new Error(
      "--after next can stop the run inside a comparison, which --at another commit refuses: name reported or finished",
    );
  }
  if (values.after !== undefined) {
    // Counted before the pause, which would leave the run stopped where `start` then refuses it, as
    // is the command's dry run at the run's own commit; another commit is installed first, after it.
    await roomToStart(payerOf(login, flags), "here", run.name);
    if ((target ?? commit) === commit) dryRun(run, flags, loginEnv(runtimeProcess.env, login), commit);
    await pauseAt(run, values.after);
  }
  await startKept(run, flags, { login, at: target });
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
    throw new Misused();
  }
  const after = values.after ?? "next";
  kindsOf(after);
  const run = runNamed(name);
  if (!values.yes) return said(run, `would be stopped after its next ${after === "next" ? "step" : after}`);
  await pauseAt(run, after);
}
