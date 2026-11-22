/**
 * Keep a campaign going until it ends on its own terms.
 *
 *   bun --env-file=<file> run runs keep <name> [--logins 2,3,4] [--wait-hours 0.25] [--yes | --here]
 *
 * `launch`, `continue` and so `fresh` and `move` leave a run on a numbered login its keeper by
 * themselves (`keepsItself`, `manage.ts`); this verb attaches one to a run already live, or to a run
 * started under `ANA_KEEP=off`.
 *
 * A keeper looks at the run once a minute and takes one of four turns (`turnOf`). While the run's
 * process lives and its log ends on a provider wait (`campaign.waited`, `for: "provider"`), whichever
 * limit named it, the week's or the five hours', and more than `--wait-hours` of it is left, it stops
 * the run and goes on with it on another login (the operator's choice). Less than that is left to the
 * login's own reset, since a move cuts the Builder's conversation. Where the process
 * is gone it goes on with the run on the same login, unless that login carries its cap of live
 * runs: after an ending on the environment, as the operator asked of every such run, and after no
 * ending at all, a process that died. Any other
 * ending is the campaign's own, and the keeper leaves. A run goes on from its log at the commit
 * its worktree stands at, on its kept flags, through the refusals of `runs continue`.
 *
 * The next login is the one with capacity whose week resets soonest, of those this keeper has not seen
 * spent (`room`, `logins.ts`), those below their cap of live runs on every host (`atCap`), and those
 * whose five hours are read to last to their reset with this run added (`fiveHourWith`). A login that
 * could not be read is not taken: a move spends on another login, so it needs a reading to say it
 * may. `--logins` defaults to `ANA_LOGINS`, read again before each move (`poolOf`). With none it says
 * why once and waits, and asks again every `ASK_MS`. Its own login goes unasked on a continue, since its runs are already in its pace.
 * A run none of whose seats is a `claude/` model bills no login and goes on without one
 * (`billsLogin`), and so does every run on a machine that holds only the plain login (`plainOnly`). A run that goes on three times in a row without a model turn of any seat that the
 * provider answered (`turnsIn`) is left: something the keeper cannot mend ends it each time.
 *
 * With `--yes` the verb leaves a keeper running by itself, its output in `keep.out` beside the log,
 * and ends: one keeper a run, and `runs stop`, `pause` or `continue --after` of the run end it. That
 * keeper is this verb under `--here` (`KEEPING`), which keeps the run in this process.
 */
import type { LogEvent } from "#src/kernel/log.ts";
import { endedOf } from "#src/kernel/reports.ts";
import { nonRetryableProvider } from "#src/kernel/solve.ts";
import { HOUR_MS } from "#src/meta/clock.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { envRunsFile } from "./host-config.ts";
import { GOES_ON, type RunState, runState } from "./state.ts";
import { payerOf } from "./live.ts";
import {
  allowedLogins,
  atCap,
  asGathered,
  billsLogin,
  type Env,
  fiveHourWith,
  liveEverywhere,
  plainOnly,
  type readLogins,
  readNotClosed,
  room,
  startRefusal,
} from "./logins.ts";
import type { Live } from "./live.ts";
import { checkStart, lastRun, leaveKeeper, rerun, said, start, WAIT_HOURS } from "./manage.ts";
import { keepers, logEvents, Misused, processes, type Run, runNamed } from "./registry.ts";
import { stop } from "./stop.ts";

export type Turn = "watch" | "move" | "continue" | "done";

/** What a keeper's look reads and does, which a test scripts. */
interface Hands {
  readonly events: () => readonly LogEvent[];
  readonly stands: (events: readonly LogEvent[], now: number) => RunState;
  readonly last: () => { readonly login?: string | undefined; readonly flags: readonly string[] };
  readonly fleet: () => Promise<{ live: Live[]; unasked: string[] }>;
  readonly read: typeof readLogins;
  readonly checkStart: (login: string | undefined, flags: readonly string[]) => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly start: (login: string | undefined) => Promise<boolean>;
  readonly say: (line: string) => void;
  readonly env: Env;
}

const LOOK_MS = 60_000;
/** How long a keeper with nowhere to go waits before it reads the logins again: a reading may cost a
 *  one-token request a login (`readLogins`), and a week's wait lasts for days. */
const ASK_MS = 10 * 60_000;
/** Goings-on in a row with no model turn, after which a keeper leaves its run. */
const BARREN = 3;

/**
 * The model turns `events` record that the provider answered, of any seat: what a going-on has to
 * add to count as work. A launch into a failure still writes its moves, its ending and a turn of
 * each seat it opened, stopped on `error`, so the log grows however little was done, and a keeper
 * that counted the log's bytes would go on into one DNS failure again and again and never leave.
 */
const turnsIn = (events: readonly LogEvent[]): number =>
  events.filter(({ kind, data }) => kind.endsWith(".turn") && data.stopReason !== "error").length;

/** What a keeper does at `now` with a run that stands as `state`: it moves one waiting on a provider
 *  for longer than `waitMs`, goes on with one nothing writes unless it ended on its own terms, and
 *  watches the rest. */
export function turnOf(state: RunState, now: number, waitMs: number): Turn {
  if (state.kind === "waiting") {
    return state.wait.for === "provider" && state.wait.until - now > waitMs ? "move" : "watch";
  }
  if (state.kind === "ended") return state.ending === GOES_ON ? "continue" : "done";
  return state.kind === "kept" || state.kind === "stopped" ? "continue" : "watch";
}

/**
 * The login a run goes on with after `turn`: none for a run that bills no login, else its own on a
 * continue, unless this keeper saw it spent or it is `full`, else the first of `roomy`, those with
 * capacity, or null to wait. A Codex run waits for no Claude login its seats never use, and is
 * counted against none. A dead run is not live, so its own login can fill its live-run cap
 * elsewhere, and the keeper does not go on above it. A run that bills no login has nowhere to move
 * and sits out its wait, rather than being stopped and restarted on the same account every look,
 * into the same limit.
 */
export async function nextLogin(
  turn: Turn,
  { current, spent, billed }: { current: string | undefined; spent: ReadonlySet<string>; billed: boolean },
  roomy: () => Promise<readonly string[]>,
  full: (login: string) => Promise<boolean>,
): Promise<string | undefined | null> {
  if (!billed) return turn === "move" ? null : undefined;
  if (turn === "continue" && current !== undefined && !spent.has(current) && !(await full(current))) {
    return current;
  }
  return (await roomy())[0] ?? null;
}

/** The logins of `logins` a run may move to: those with capacity, less those this keeper saw `spent`,
 *  those at their live-run cap across the fleet (`atCap`) and those whose five hours run out or could
 *  not be read with this run added (`fiveHourWith`), or none while a host goes uncounted; and why any
 *  was left for its five hours, so that a keeper does not move a run onto a login that already
 *  carries its cap, which `fresh` refuses. */
export async function roomFor(
  logins: readonly string[],
  spent: ReadonlySet<string>,
  { live, unasked }: { live: readonly Live[]; unasked: readonly string[] },
  read: typeof readLogins = readNotClosed,
  { env = runtimeProcess.env, now = Date.now() }: { env?: Env; now?: number } = {},
): Promise<{ logins: string[]; why: string }> {
  if (unasked.length > 0) return { logins: [], why: "" };
  const out = new Set([...spent, ...atCap(env, logins, live)]);
  const readings = await read(
    logins.filter((login) => !out.has(login)),
    env,
  );
  const forecast = readings.map((reading) => ({
    login: reading.login,
    at: fiveHourWith(reading, live.filter((run) => run.login === reading.login).length, now),
  }));
  const over = forecast.filter(({ at }) => at !== null && at >= 100).map(({ login }) => login);
  const unread = forecast.filter(({ at }) => at === null).map(({ login }) => login);
  const reasons = [
    ...(over.length === 0 ? [] : [`login ${over.join(", ")} would reach five hours with this run added`]),
    ...(unread.length === 0 ? [] : [`login ${unread.join(", ")} could not be read`]),
  ];
  return { logins: room(readings, logins, new Set([...out, ...over, ...unread])), why: reasons.join("; ") };
}

/** Whether a line of `keep.out` says this keeper moved or restarted its run, left it waiting or gave it
 *  up (`keeperOf`), as against its error text and a run that ended by itself, which the log says. */
export const keeperActed = (line: string): boolean =>
  /: (?:move|continue) (?:on login|without a login)|; left waiting$|no seat took a model turn: kept no longer$/u.test(
    line,
  );

/** A keeper of the run `name` on the logins `pool` gives at each move: each call is one look at `now`,
 *  and says whether it leaves. */
export function keeperOf(name: string, pool: () => Promise<readonly string[]>, waitMs: number, hands: Hands) {
  // A login this keeper moved off, until its limit resets.
  const spentUntil = new Map<string, number>();
  let barren = 0;
  let worked = -1;
  let waitedOn = "";
  let askAt = 0;
  // Each act under the time of the look, since a wait and a giving up write no event.
  const act = (now: number, what: string) => hands.say(`${new Date(now).toISOString()} ${name}: ${what}`);
  return async (now: number): Promise<boolean> => {
    const events = hands.events();
    const state = hands.stands(events, now);
    const turn = turnOf(state, now, waitMs);
    if (turn === "done" && state.kind === "ended") {
      hands.say(`${name} ended on ${state.ending}: kept no longer`);
      return true;
    }
    if (turn === "watch") {
      waitedOn = "";
      askAt = 0;
      return false;
    }
    const { login: current, flags } = hands.last();
    const logins = await pool();
    if (turn === "move" && current !== undefined && state.kind === "waiting") {
      spentUntil.set(current, state.wait.until);
    }
    // A permanent provider refusal (disabled subscription, missing credits, unconfigured provider)
    // never clears on retry, so mark the login spent and move to another roomy login instead of
    // restarting into the same failure.
    const ended = endedOf(events);
    if (
      turn === "continue" &&
      current !== undefined &&
      ended?.ending === GOES_ON &&
      nonRetryableProvider(ended.why)
    ) {
      spentUntil.set(current, Number.POSITIVE_INFINITY);
    }
    for (const [login, at] of spentUntil) {
      if (at <= now) spentUntil.delete(login);
    }
    if (now < askAt) return false;
    const spent = new Set(spentUntil.keys());
    let fleet: Awaited<ReturnType<Hands["fleet"]>> | undefined;
    const counted = async () => (fleet ??= await hands.fleet());
    let why = "";
    const target = await nextLogin(
      turn,
      { current, spent, billed: logins.length > 0 && billsLogin(events, flags) },
      async () => {
        const found = await roomFor(logins, spent, await counted(), hands.read, { env: hands.env, now });
        ({ why } = found);
        return found.logins;
      },
      async (login) => startRefusal(hands.env, payerOf(login, flags), "here", await counted(), name) !== null,
    );
    let refusal =
      target === null ? null : startRefusal(hands.env, payerOf(target, flags), "here", await counted(), name);
    if (turn === "move" && target !== null && refusal === null) {
      try {
        await hands.checkStart(target, flags);
      } catch (error) {
        refusal = errorMessage(error);
      }
    }
    if (target === null || refusal !== null) {
      const reason = refusal ?? (why === "" ? "no login to go on with" : why);
      if (reason !== waitedOn) act(now, `${reason}; left waiting`);
      waitedOn = reason;
      askAt = now + ASK_MS;
      return false;
    }
    waitedOn = "";
    askAt = 0;
    const turns = turnsIn(events);
    barren = turn === "continue" && turns === worked ? barren + 1 : 0;
    worked = turns;
    if (barren >= BARREN) {
      act(now, `went on ${String(BARREN)} times and no seat took a model turn: kept no longer`);
      return true;
    }
    act(now, `${turn} ${target === undefined ? "without a login" : `on login ${target}`}`);
    try {
      if (turn === "move") await hands.stop();
      await hands.start(target);
    } catch (error) {
      hands.say(`  ${errorMessage(error)}`);
    }
    return false;
  };
}

/**
 * The logins a keeper started without `--logins` may move its run to: those `ANA_LOGINS` names in
 * `file`, its host's `.env.runs`, at each call, where the pool it started with is the one that file
 * named; otherwise the pool it started with. So an edit of the pool reaches a running keeper, and a
 * pool carried from another host stays as carried, where a running keeper would otherwise go on
 * choosing from the logins it had been started with after the operator narrowed the pool.
 */
export function poolOf(file: string, env: Env): () => Promise<readonly string[]> {
  const named = async () =>
    /^ANA_LOGINS=["']?([^"'\s#]*)/mu.exec(
      await Bun.file(file)
        .text()
        .catch(() => ""),
    )?.[1];
  const follows = named().then((first) => first === env.ANA_LOGINS);
  // A file it cannot read, or a line it no longer finds, keeps the last pool rather than widening
  // it to every login `.env` holds.
  let last = env.ANA_LOGINS;
  return async () => {
    if (!(await follows)) return allowedLogins(env);
    last = (await named()) ?? last;
    return allowedLogins({ ...env, ANA_LOGINS: last });
  };
}

/** Keep `run` going on the logins `pool` gives until it ends on its own terms. */
async function keepGoing(run: Run, pool: () => Promise<readonly string[]>, waitMs: number): Promise<void> {
  const look = keeperOf(run.name, pool, waitMs, {
    events: () => logEvents(run.path),
    stands: (events, now) => runState(run, events, processes(), now),
    last: () => lastRun(run),
    fleet: async () => asGathered(await liveEverywhere("configured")),
    read: readNotClosed,
    checkStart: (login, flags) => checkStart(run, rerun(flags, undefined), { login }),
    stop: () => stop([run.name, "--yes"]),
    start: (login) => start(run, rerun(lastRun(run).flags, undefined), login, undefined),
    say: (line) => console.log(line),
    env: runtimeProcess.env,
  });
  while (!(await look(Date.now()))) await Bun.sleep(LOOK_MS);
}

/** `bun run runs keep`. */
export async function keep(args: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      logins: { type: "string" },
      "wait-hours": { type: "string", default: WAIT_HOURS },
      yes: { type: "boolean", default: false },
      here: { type: "boolean", default: false },
    },
  });
  const [name] = positionals;
  // An empty `--logins` names none, rather than the one login "".
  const named = values.logins?.split(",").filter((login) => login !== "");
  const logins = named ?? allowedLogins(runtimeProcess.env);
  if (name === undefined) {
    throw new Misused();
  }
  const run = runNamed(name);
  if (
    logins.length === 0 &&
    !plainOnly(runtimeProcess.env) &&
    billsLogin(logEvents(run.path), lastRun(run).flags)
  ) {
    throw new Error("no allowed Claude login: name --logins, set ANA_LOGINS or CLAUDE_CODE_OAUTH_TOKEN");
  }
  if (values.here) {
    const pool = named === undefined ? poolOf(envRunsFile(run.tree), runtimeProcess.env) : async () => named;
    return keepGoing(run, pool, Number(values["wait-hours"]) * HOUR_MS);
  }
  if (keepers(name).length > 0) throw new Error(`${name} is kept already`);
  if (!values.yes) return said(run, `would be kept going on logins ${logins.join(", ")}`);
  leaveKeeper(run, named, values["wait-hours"]);
}
