/**
 * Keep a campaign going until it ends on its own terms.
 *
 *   bun --env-file=<file> run runs keep <name> [--logins 2,3,4] [--wait-hours 1] [--yes]
 *
 * A keeper looks at the run once a minute and takes one of four turns (`turnOf`). While the run's
 * process lives and its log ends on a provider wait (`campaign.waited`, `for: "provider"`) longer
 * than `--wait-hours`, it stops the run and goes on with it on another login. Where the process
 * is gone it goes on with the run on the same login, unless that login carries its cap of live
 * runs: after an ending on the environment, as the operator asked of every such run, and after no
 * ending at all, a process that died. Any other
 * ending is the campaign's own, and the keeper leaves. A run goes on from its log at the commit
 * its worktree stands at, on its kept flags, through the refusals of `runs continue`.
 *
 * The next login is the one with capacity whose week resets soonest, of those this keeper has not seen
 * spent (`room`, `logins.ts`), and `--logins` defaults to `ANA_LOGINS`. With none it says so once
 * and waits. A run none of whose seats is a `claude/` model bills no login and goes on without one
 * (`billsLogin`), and so does every run on a machine that holds only the plain login (`plainOnly`). A run that goes on three times in a row without a model turn of any seat that the
 * provider answered (`turnsIn`) is left: something the keeper cannot mend ends it each time.
 *
 * With `--yes` the verb leaves a keeper running by itself, its output in `keep.out` beside the log,
 * and ends: one keeper a run, and `runs stop`, `pause` or `continue --after` of the run end it. Until
 * 15 October this was three shell loops of the operator's and a wrapper a login, each moving one run.
 */
import type { LogEvent } from "#src/kernel/log.ts";
import { openSync } from "#src/meta/filesystem.ts";
import { isString } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { capturedExecPath, capturedSpawn, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { allowedLogins, atCap, billsLogin, liveEverywhere, plainOnly, readLogins, room } from "./logins.ts";
import type { Live } from "./live.ts";
import { lastRun, rerun, start } from "./manage.ts";
import { KEEPING, keepers, logEvents, processes, type Run, runNamed, writers } from "./registry.ts";
import { stop } from "./stop.ts";

export type Turn = "watch" | "move" | "continue" | "done";

const LOOK_MS = 60_000;
const HOUR = 3_600_000;
/** Goings-on in a row with no model turn, after which a keeper leaves its run. */
const BARREN = 3;

/**
 * The model turns `events` record that the provider answered, of any seat: what a going-on has to
 * add to count as work. A launch into a failure still writes its moves, its ending and a turn of
 * each seat it opened, stopped on `error`, so the log grows however little was done: on 20 October
 * esp32-fresh-opus-m1-air-r2 went on 15 times in a row, every 13 minutes, into one DNS failure, four
 * failed turns each time, and its keeper, which counted the log's bytes, never left (lane 35 of the
 * investigation of 27 October).
 */
export const turnsIn = (events: readonly LogEvent[]): number =>
  events.filter(({ kind, data }) => kind.endsWith(".turn") && data.stopReason !== "error").length;

/** What a keeper does with a run whose log is `events` and whose process is `process`, at `now`. */
export function turnOf(
  events: readonly LogEvent[],
  process: "open" | "closed",
  now: number,
  waitMs: number,
): Turn {
  const last = events.at(-1);
  if (process === "open") {
    const until = last?.kind === "campaign.waited" && last.data.for === "provider" ? last.data.until : null;
    return isString(until) && Date.parse(until) - now > waitMs ? "move" : "watch";
  }
  if (last?.kind !== "campaign.ended") return "continue";
  return last.data.ending === "environment" ? "continue" : "done";
}

/**
 * The login a run goes on with after `turn`: none for a run that bills no login, else its own on a
 * continue, unless this keeper saw it spent or it is `full`, else the first of `roomy`, those with
 * capacity, or null to wait. On 20 October two Codex runs kept on the M1 would have waited for one of
 * three spent logins none of their seats used; until 26 October such a run went on as a login all
 * the same, and `runs usage` counted it against that login's most. A dead run is not live, so until
 * 26 October its own login could fill its live-run cap elsewhere and the keeper went on above it.
 */
export async function nextLogin(
  turn: Turn,
  { current, spent, billed }: { current: string | undefined; spent: ReadonlySet<string>; billed: boolean },
  roomy: () => Promise<readonly string[]>,
  full: (login: string) => Promise<boolean>,
): Promise<string | undefined | null> {
  if (!billed) return undefined;
  if (turn === "continue" && current !== undefined && !spent.has(current) && !(await full(current))) {
    return current;
  }
  return (await roomy())[0] ?? null;
}

/** The logins of `logins` a run may move to: those with capacity, less those this keeper saw `spent`
 *  and those at their live-run cap across the fleet (`atCap`), or none while a host goes uncounted.
 *  Until 26 October a keeper moved a run onto a login with capacity whatever runs it carried already,
 *  which `fresh` refuses. */
export async function roomFor(
  logins: readonly string[],
  spent: ReadonlySet<string>,
  { live, unasked }: { live: readonly Live[]; unasked: readonly string[] },
  read: typeof readLogins = readLogins,
  env: Readonly<Record<string, string | undefined>> = runtimeProcess.env,
): Promise<string[]> {
  if (unasked.length > 0) return [];
  const out = new Set([...spent, ...atCap(env, logins, live)]);
  return room(
    await read(
      logins.filter((login) => !out.has(login)),
      env,
    ),
    logins,
    out,
  );
}

/** Keep `run` going on `logins` until it ends on its own terms. */
async function keepGoing(run: Run, logins: readonly string[], waitMs: number): Promise<void> {
  // A login this keeper moved off, until its limit resets.
  const spentUntil = new Map<string, number>();
  let barren = 0;
  let worked = -1;
  let waiting = false;
  for (; ; await Bun.sleep(LOOK_MS)) {
    const events = logEvents(run.path);
    const now = Date.now();
    const turn = turnOf(events, writers(run, processes()).length > 0 ? "open" : "closed", now, waitMs);
    if (turn === "done") {
      const ending = events.at(-1)?.data.ending;
      return console.log(`${run.name} ended on ${isString(ending) ? ending : "?"}: kept no longer`);
    }
    if (turn === "watch") continue;
    const current = lastRun(run).login;
    const until = events.at(-1)?.data.until;
    if (turn === "move" && current !== undefined && isString(until)) {
      spentUntil.set(current, Date.parse(until));
    }
    for (const [login, at] of spentUntil) {
      if (at <= now) spentUntil.delete(login);
    }
    const spent = new Set(spentUntil.keys());
    let fleet: Awaited<ReturnType<typeof liveEverywhere>> | undefined;
    const counted = async () => (fleet ??= await liveEverywhere("configured"));
    const target = await nextLogin(
      turn,
      { current, spent, billed: logins.length > 0 && billsLogin(events, lastRun(run).flags) },
      async () => roomFor(logins, spent, await counted()),
      async (login) => {
        const { live, unasked } = await counted();
        return unasked.length > 0 || atCap(runtimeProcess.env, [login], live).size > 0;
      },
    );
    if (target === null) {
      if (!waiting) console.log(`${run.name}: no login with capacity; left waiting`);
      waiting = true;
      continue;
    }
    waiting = false;
    const turns = turnsIn(events);
    barren = turn === "continue" && turns === worked ? barren + 1 : 0;
    worked = turns;
    if (barren >= BARREN) {
      return console.log(
        `${run.name} went on ${String(BARREN)} times and no seat took a model turn: kept no longer`,
      );
    }
    console.log(
      `${new Date(now).toISOString()} ${run.name}: ${turn} ${target === undefined ? "without a login" : `on login ${target}`}`,
    );
    try {
      if (turn === "move") await stop([run.name, "--yes"]);
      await start(run, rerun(lastRun(run).flags, undefined), target, undefined);
    } catch (error) {
      console.log(`  ${errorMessage(error)}`);
    }
  }
}

/** `bun run runs keep`. */
export async function keep(args: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      logins: { type: "string" },
      "wait-hours": { type: "string", default: "1" },
      yes: { type: "boolean", default: false },
      here: { type: "boolean", default: false },
    },
  });
  const [name] = positionals;
  const logins = values.logins?.split(",") ?? allowedLogins(runtimeProcess.env);
  if (name === undefined) {
    throw new Error(
      "usage: bun --env-file=<file> run runs keep <name> --logins 2,3,4 [--wait-hours 1] [--yes]",
    );
  }
  const run = runNamed(name);
  if (
    logins.length === 0 &&
    !plainOnly(runtimeProcess.env) &&
    billsLogin(logEvents(run.path), lastRun(run).flags)
  ) {
    throw new Error("no allowed Claude login: name --logins, set ANA_LOGINS or CLAUDE_CODE_OAUTH_TOKEN");
  }
  if (values.here) return keepGoing(run, logins, Number(values["wait-hours"]) * HOUR);
  if (keepers(name).length > 0) throw new Error(`${name} is kept already`);
  if (!values.yes) {
    return console.log(
      `${name} in ${run.tree}: would be kept going on logins ${logins.join(", ")}; nothing is done without --yes`,
    );
  }
  const out = join(dirname(run.path), "keep.out");
  const child = capturedSpawn(
    [
      capturedExecPath,
      join(import.meta.dir, "cli.ts"),
      "keep",
      name,
      "--logins",
      logins.join(","),
      "--wait-hours",
      values["wait-hours"],
      KEEPING,
    ],
    {
      cwd: run.tree,
      env: runtimeProcess.env,
      detached: true,
      stdin: "ignore",
      stdout: openSync(out, "a"),
      stderr: openSync(out, "a"),
    },
  );
  child.unref();
  console.log(`${name}: kept by pid ${String(child.pid)}; ${out}`);
}
