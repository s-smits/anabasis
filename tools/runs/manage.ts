/**
 * Start a campaign, go on with one, and pause one at a clean point. `continue` reruns on the flags the
 * last run kept, less its name and total. `pause` stops the run once the log gains one more of the
 * named event and nothing but the Builder's conversation is open; `next`, the default, also waits for
 * open solves, since a cut solve is paid again. A run on a numbered login gets a keeper where another
 * login is allowed (`ANA_KEEP=off` disables it). Without `--yes` a verb only says what it would do.
 *
 *   bun --env-file=<file> run runs launch <name> [--login N] [--yes]
 *     -- <the campaign command's flags but --name>
 *   bun --env-file=<file> run runs continue <name> [--at <commit>] [--login N] [--budget N]
 *     [--after <word>[|<word>...]] [--yes] [-- <flags>]
 *   bun run runs pause <name> [--after <word>[|<word>...]] [--eval] [--yes]
 */
import { unfinished } from "#src/kernel/trace.ts";
import { append, type LogEvent } from "#src/kernel/log.ts";
import {
  PAUSE,
  pauseCountOf,
  pauseKindsOf,
  pausePointReached,
  pauseWaitMs,
  unpromotedStep,
} from "#src/campaign/signal.ts";
import { epochsOf } from "#src/campaign/climb.ts";
import { existsSync, mkdirSync, openSync, statSync } from "#src/meta/filesystem.ts";
import { keysIf } from "#src/meta/optional-key.ts";
import { dirname, join } from "#src/meta/path.ts";
import { capturedExecPath, capturedSpawn, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { decodeOutput, processGroupExists, runSync } from "#src/meta/subprocess.ts";
import { lastLaunch, nextRun } from "./receipt.ts";
import { payerOf } from "./live.ts";
import { LIMITS } from "../campaign/campaign.ts";
import { recordedSetting } from "../campaign/setting.ts";
import { allowedLogins, type Env, NUMBERED, roomToStart, TOKEN, tokenOf } from "./logins.ts";
import {
  BUILDER,
  campaignOf,
  everyRun,
  isCampaign,
  KEEPING,
  logEvents,
  keepers,
  keeperLogPath,
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
import { GOES_ON, runState } from "./state.ts";
import { installAt, publishedAt } from "./code.ts";

export const WAIT_HOURS = "0.25";

const DROPPED = ["--name", "--budget"];
const LOOK_MS = 5000;
const STEP_MS = 1000;

export function rerun(flags: readonly string[], budget: string | undefined): string[] {
  const kept = flags.filter(
    (flag, at) =>
      !DROPPED.includes(flags[at - 1] ?? "") &&
      !DROPPED.some((dropped) => flag === dropped || flag.startsWith(`${dropped}=`)),
  );
  return budget === undefined ? kept : [...kept, "--budget", budget];
}

export function loginEnv(env: Env, login: string | undefined) {
  const kept = Object.fromEntries(Object.entries(env).filter(([key]) => !NUMBERED.test(key)));
  if (login === undefined) return kept;
  const token = tokenOf(env, login);
  if (token === undefined) {
    throw new Error(
      `${TOKEN}${login} is not set: run the verb under bun --env-file=<the file that holds it>`,
    );
  }
  return { ...kept, [TOKEN]: token, ANA_LOGIN: login };
}

export function heldBy(events: readonly LogEvent[], after: string, base: number): string[] {
  const kinds = pauseKindsOf(after);
  const open = new Set(unfinished(events).map(({ of }) => of));
  const held = (holds: boolean, what: string) => (holds ? [what] : []);
  const more = held(
    pauseCountOf(events, kinds) <= base,
    `one more ${kinds.join(" or ")}, past ${String(base)}`,
  );
  if (after === "next") return [...more, ...held(open.has("solve"), "its open solves")];
  const pendingStep = after === "reported" && unpromotedStep(events);
  const last = epochsOf(events).at(-1);
  const unread = after === "reported" && last?.starter_tally === null && last.reference !== "starter";
  const led = events.slice(events.findLastIndex(({ kind }) => kind === "build.started"));
  return [
    ...more,
    ...held(pendingStep, "the promotion of a reported step"),
    ...held(unread, "a starter comparison that tallies a task under the newest promotion"),
    ...held(open.has("exam") || open.has("draft"), "the open Examiner session or draft"),
    ...held(openComparisons(events).length > 0, "the open comparison"),
    ...held(!unfinished(led).every(({ of }) => of === "build"), "the open solve or Referee reading"),
  ];
}

async function pauseAt(run: Run, after: string, by: string, ready?: () => Promise<boolean>): Promise<void> {
  const kinds = pauseKindsOf(after);
  // One waiter a run, or a `continue --after` would restart a run another's pause had stopped.
  const waiting = waiters(run.name);
  if (waiting.length > 0) {
    throw new Error(`${run.name} already waits to stop in process ${waiting.join(", ")}`);
  }
  const events = logEvents(run.path);
  const base = pauseCountOf(events, kinds);
  const word = {
    word: PAUSE,
    why: `${by} --after ${after}`,
    ...keysIf(after !== "next", () => ({ after, base })),
  };
  const allowed = pauseWaitMs((recordedSetting(events)?.minutes ?? LIMITS.wallSeconds / 60) * 60);
  console.log(
    after === "next"
      ? `${run.name}: starting no further solve, and letting its open ones finish, ${String(allowed / 60_000)} minutes at most`
      : `${run.name}: waiting for ${kinds.join(", ")} past ${String(base)}, with nothing but the Builder's conversation open${after === "reported" ? " and no promotion left unread against the starter" : ""}`,
  );
  const preArm = after === "next" || ready === undefined;
  let armedFor = "";
  const armLive = () => {
    const pids = writers(run, processes()).map(({ pid }) => pid);
    const launched = lastLaunch(run.path)?.pid;
    if (pids.length === 0 || (launched !== undefined && !pids.includes(launched))) return;
    const live = pids.map(String).toSorted().join(",");
    if (live !== armedFor) {
      append(run.path, "campaign.word", word);
      armedFor = live;
    }
  };
  if (preArm) armLive();
  const patience = Date.now() + allowed;
  // A log runs to tens of megabytes, and one that did not grow says what it said.
  let size = -1;
  const waits = () =>
    writers(run, processes()).length > 0 || (after !== "next" && keepers(run.name).length > 0);
  while (waits()) {
    if (preArm) armLive();
    const grown = statSync(run.path).size;
    const late = after === "next" && Date.now() > patience;
    const rests = () => heldBy(logEvents(run.path), after, base).length === 0;
    if (late || (grown !== size && rests())) {
      if (after === "next") return stop([run.name, "--yes"]);
      if (ready !== undefined && !(await ready())) return;
      const stillRests = rests();
      if (stillRests && armedFor === "" && pausePointReached(logEvents(run.path), after, base)) {
        append(run.path, "campaign.word", word);
      }
      if (stillRests) return stop([run.name, "--yes"]);
    }
    size = grown;
    await Bun.sleep(after === "next" ? STEP_MS : LOOK_MS);
  }
  // A keeper starts a run no process writes again, so it must not outlive the pause.
  if (keepers(run.name).length > 0) return stop([run.name, "--yes"]);
  console.log(`${run.name} is not running`);
}

async function startable(
  run: Run,
  flags: readonly string[],
  { login, at, stands }: { login: string | undefined; at: string | undefined; stands: string },
) {
  const { commit, dirty } = standing(run.tree);
  if (dirty) throw new Error(`${run.tree} holds a change no commit names: a run's commit states its source`);
  const target = publishedAt(run.tree, at ?? commit);
  await roomToStart(payerOf(login, flags), "here", run.name, stands);
  return { commit, target };
}

export async function checkStart(
  run: Run,
  flags: readonly string[],
  { login, at }: { login: string | undefined; at?: string | undefined },
): Promise<void> {
  const { commit, target } = await startable(run, flags, {
    login,
    at,
    stands: "nothing was stopped or started",
  });
  if (target === commit) dryRun(run, flags, loginEnv(runtimeProcess.env, login), commit);
}

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
  const kept = keepers(run.name).length > 0 ? "and its keeper goes on" : "and has no keeper";
  const stands = `${run.name} is not running ${kept}; nothing was started`;
  const { commit, target } = await startable(run, flags, { login, at, stands });
  const open = target === commit ? [] : openComparisons(logEvents(run.path));
  if (open.length > 0) {
    throw new Error(
      `comparison ${open.join(", ")} began and has not reported: it goes on at ${commit.slice(0, 9)}`,
    );
  }
  installAt(run.tree, target);
  const command = dryRun(run, flags, env, target);
  mkdirSync(dirname(run.path), { recursive: true });
  const out = join(dirname(run.path), `launch-${nextRun(run.path)}`);
  const child = capturedSpawn(["nice", "-n", "19", ...command], {
    cwd: run.tree,
    env,
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

function dryRun(run: Run, flags: readonly string[], env: ReturnType<typeof loginEnv>, at: string) {
  const d2 = "tools/d2/harness-builder.ts";
  const script = existsSync(join(run.tree, BUILDER))
    ? BUILDER
    : existsSync(join(run.tree, d2))
      ? d2
      : BUILDER;
  const command = [capturedExecPath, script, "--name", run.name, ...flags];
  const dry = runSync([...command, "--dry-run"], { cwd: run.tree, env });
  console.log(decodeOutput(dry.stdout).trim().split("\n").slice(-4).join("\n"));
  if (dry.exitCode !== 0) {
    console.error(decodeOutput(dry.stderr).trimEnd());
    throw new Error(`the dry run at ${at.slice(0, 9)} refused: nothing was started`);
  }
  return command;
}

export function leaveKeeper(run: Run, logins: readonly string[] | undefined, waitHours: string): void {
  const out = keeperLogPath(run);
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

export function keepsItself(env: Env, login: string | undefined): boolean {
  return env.ANA_KEEP !== "off" && login !== undefined && allowedLogins(env).some((other) => other !== login);
}

async function launchRunKeeper(
  run: Run,
  flags: readonly string[],
  { login, at }: { login: string | undefined; at: string | undefined },
): Promise<void> {
  const running = await start(run, flags, login, at);
  if (running && keepsItself(runtimeProcess.env, login) && keepers(run.name).length === 0) {
    leaveKeeper(run, undefined, WAIT_HOURS);
  }
}

export function lastRun(run: Run) {
  const kept = lastLaunch(run.path);
  if (kept === undefined) throw new Error(`no run of the campaign command beside ${run.path} kept its flags`);
  return kept;
}

export const said = (run: Run, what: string) =>
  console.log(`${run.name} in ${run.tree}: ${what}; nothing is done without --yes`);

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
  // By case too: on macOS's file system names differing only by case are the same folder.
  const held = everyRun().find((run) => run.name.toLowerCase() === name.toLowerCase() && isCampaign(run));
  if (held !== undefined) {
    throw new Error(`${name} names a campaign in ${dirname(held.path)}: go on with it by runs continue`);
  }
  const run = campaignOf(runtimeProcess.cwd(), name);
  if (!values.yes) return said(run, `would start ${BUILDER} ${flags.join(" ")}`);
  await launchRunKeeper(run, flags, { login: values.login, at: undefined });
}

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
  if (values.after !== undefined) pauseKindsOf(values.after);
  const run = runNamed(name);
  const flags = rerun(given.length > 0 ? given : lastRun(run).flags, values.budget);
  const login = values.login ?? lastLaunch(run.path)?.login;
  const payer = login === undefined ? "the unnumbered login" : `login ${login}`;
  if (!values.yes) {
    const after = values.after === undefined ? "" : `after its next ${values.after}, `;
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
    await roomToStart(payerOf(login, flags), "here", run.name);
    if ((target ?? commit) === commit) dryRun(run, flags, loginEnv(runtimeProcess.env, login), commit);
    const armed = logEvents(run.path).length;
    const left = () => {
      const [events, running, kept] = [logEvents(run.path), processes(), lastLaunch(run.path)];
      const state = runState(run, events, running);
      const ending = state.kind === "ended" ? state.ending : GOES_ON;
      if (ending !== GOES_ON && events.length > armed) return `ended on ${ending} during the wait`;
      const asked = kept?.commit === (target ?? commit) && kept.login === login;
      return asked &&
        rerun(kept.flags, undefined).join(" ") === flags.join(" ") &&
        writers(run, running).length > 0
        ? `already runs on ${payer} at ${kept.commit.slice(0, 9)}`
        : null;
    };
    await pauseAt(run, values.after, `runs continue on ${payer}`, async () => {
      if (left() !== null) return false;
      await checkStart(run, flags, { login, at: target });
      return true;
    });
    const why = left();
    if (why !== null) return console.log(`${run.name} ${why}: nothing was stopped or started`);
  }
  await launchRunKeeper(run, flags, { login, at: target });
}

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
  pauseKindsOf(after);
  const run = runNamed(name);
  if (!values.yes) {
    const events = logEvents(run.path);
    const holds = heldBy(events, after, pauseCountOf(events, pauseKindsOf(after))).join(", and for ");
    return said(
      run,
      `would be stopped after its next ${after === "next" ? "step" : after}; it waits for ${holds}`,
    );
  }
  await pauseAt(run, after, "runs pause");
}
