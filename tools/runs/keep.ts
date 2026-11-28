/**
 * Keeps a campaign going until it ends on its own terms.
 *
 *   bun --env-file=<file> run runs keep <name> [--logins 2,3,4] [--wait-hours 0.25] [--yes | --here]
 *
 * Once a minute a keeper takes one of four turns (`turnOf`). Where the live run's log ends on a
 * provider wait with more than `--wait-hours` left, it stops the run and goes on with it on another
 * login; less is left to the login's own reset, since a move cuts the Builder's conversation.
 * Where the process is gone after an environment ending or none, it goes on on the same login
 * unless that login is at its cap; any other ending is the campaign's own, and the keeper leaves.
 * A run goes on from its log at its worktree's commit, through the refusals of `runs continue`.
 */
import type { LogEvent } from "#src/kernel/log.ts";
import { endedOf } from "#src/kernel/reports.ts";
import { nonRetryableProvider } from "#src/kernel/solve.ts";
import { askedOf, type Seat, traced } from "#src/kernel/trace.ts";
import { HOUR_MS } from "#src/meta/clock.ts";
import { isString } from "#src/meta/json-shape.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { envRunsFile } from "./host-config.ts";
import { GOES_ON, type RunState, runState } from "./state.ts";
import { type Live, payerOf } from "./live.ts";
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
  seatModels,
  startRefusal,
} from "./logins.ts";
import { checkStart, lastRun, leaveKeeper, rerun, said, start, WAIT_HOURS } from "./manage.ts";
import { flagOf, keepers, logEvents, Misused, processes, type Run, runNamed } from "./registry.ts";
import { stop } from "./stop.ts";

export type Turn = "watch" | "move" | "continue" | "done";

interface Hands {
  readonly events: () => readonly LogEvent[];
  readonly stands: (events: readonly LogEvent[], now: number) => RunState;
  readonly last: () => { readonly login?: string | undefined; readonly flags: readonly string[] };
  readonly fleet: () => Promise<{ live: Live[]; unasked: string[] }>;
  readonly read: typeof readLogins;
  readonly checkStart: (login: string | undefined, flags: readonly string[]) => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly start: (login: string | undefined) => Promise<boolean>;
  readonly handoff?: (successor: string) => void;
  readonly say: (line: string) => void;
  readonly env: Env;
}

const LOOK_MS = 60_000;
const ASK_MS = 10 * 60_000;
const BARREN = 3;
const SEAT_ROLE: Readonly<Record<Seat, "builder" | "examiner" | "reviewer" | "solver">> = {
  build: "builder",
  exam: "examiner",
  draft: "examiner",
  referee: "reviewer",
  solve: "solver",
};

function refusalOnClaudeLogin(events: readonly LogEvent[], why: string, flags: readonly string[]): boolean {
  if (!billsLogin(events, flags)) return false;
  if (/disabled Claude subscription access/u.test(why)) return true;
  const asked = askedOf(events);
  const models = seatModels(events, flags);
  for (let index = events.length - 2; index >= 0; index -= 1) {
    const event = events[index];
    if (event === undefined || event.kind === "campaign.ended") break;
    const err = event.data.error;
    if (!event.kind.endsWith(".turn") || !isString(err) || !nonRetryableProvider(err) || !why.includes(err)) {
      continue;
    }
    const turn = traced(event, index);
    const model = turn === null ? undefined : (asked.get(turn.id) ?? models[SEAT_ROLE[turn.seat]]);
    if (model !== undefined) return model.startsWith("claude/");
  }
  return false;
}

const turnsIn = (events: readonly LogEvent[]): number =>
  events.filter(({ kind, data }) => kind.endsWith(".turn") && data.stopReason !== "error").length;

export function turnOf(state: RunState, now: number, waitMs: number): Turn {
  if (state.kind === "waiting") {
    return state.wait.for === "provider" && state.wait.until - now > waitMs ? "move" : "watch";
  }
  if (state.kind === "ended") return state.ending === GOES_ON ? "continue" : "done";
  if (state.kind === "stopped" && state.pause !== undefined) return "done";
  return state.kind === "kept" || state.kind === "stopped" ? "continue" : "watch";
}

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

export const keeperActed = (line: string): boolean =>
  /: (?:move|continue) (?:on login|without a login)|; left waiting$|(?:no seat took a model turn|non-retryable provider refusal[^:]*): kept no longer$/u.test(
    line,
  );

export function keeperOf(name: string, pool: () => Promise<readonly string[]>, waitMs: number, hands: Hands) {
  const spentUntil = new Map<string, number>();
  let barren = 0;
  let worked = -1;
  let waitedOn = "";
  let askAt = 0;
  const act = (now: number, what: string) => hands.say(`${new Date(now).toISOString()} ${name}: ${what}`);
  return async (now: number): Promise<boolean> => {
    const events = hands.events();
    const state = hands.stands(events, now);
    const turn = turnOf(state, now, waitMs);
    if (turn === "done") {
      const successor = events.at(-1)?.data.successor;
      if (state.kind === "ended" && isString(successor)) hands.handoff?.(successor);
      hands.say(
        state.kind === "ended"
          ? `${name} ended on ${state.ending}: kept no longer`
          : `${name} paused (${state.kind === "stopped" && state.pause !== undefined ? state.pause.why : "a pause"}): kept no longer`,
      );
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
    const ended = endedOf(events);
    if (turn === "continue" && ended?.ending === GOES_ON && nonRetryableProvider(ended.why)) {
      if (current === undefined || !refusalOnClaudeLogin(events, ended.why, flags)) {
        act(now, "non-retryable provider refusal outside the Claude login: kept no longer");
        return true;
      }
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
      if (
        target === null &&
        logins.length > 0 &&
        logins.every((login) => spentUntil.get(login) === Number.POSITIVE_INFINITY)
      ) {
        act(now, "non-retryable provider refusal on every login: kept no longer");
        return true;
      }
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

/** Read again at each call, so an edit of the host's pool reaches a running keeper; a pool carried from
 *  another host stays as carried. */
function poolOf(file: string, env: Env): () => Promise<readonly string[]> {
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

async function keepGoing(
  run: Run,
  pool: () => Promise<readonly string[]>,
  waitMs: number,
  named: readonly string[] | undefined,
  waitHours: string,
): Promise<void> {
  const look = keeperOf(run.name, pool, waitMs, {
    events: () => logEvents(run.path),
    stands: (events, now) => runState(run, events, processes(), now),
    last: () => lastRun(run),
    fleet: async () => asGathered(await liveEverywhere("configured")),
    read: readNotClosed,
    checkStart: (login, flags) => checkStart(run, rerun(flags, undefined), { login }),
    stop: () => stop([run.name, "--yes"]),
    start: (login) => start(run, rerun(lastRun(run).flags, undefined), login, undefined),
    handoff: (successor) => {
      const next = runNamed(successor);
      if (flagOf(lastRun(next).flags, "--moves") !== "0" && keepers(next.name, processes()).length === 0) {
        leaveKeeper(next, named, waitHours);
      }
    },
    say: (line) => console.log(line),
    env: runtimeProcess.env,
  });
  while (!(await look(Date.now()))) await Bun.sleep(LOOK_MS);
}

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
    return keepGoing(run, pool, Number(values["wait-hours"]) * HOUR_MS, named, values["wait-hours"]);
  }
  if (keepers(name).length > 0) throw new Error(`${name} is kept already`);
  if (!values.yes) return said(run, `would be kept going on logins ${logins.join(", ")}`);
  leaveKeeper(run, named, values["wait-hours"]);
}
