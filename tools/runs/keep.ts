/**
 * Keep a campaign going until it ends on its own terms.
 *
 *   bun --env-file=<file> run runs keep <name> [--logins 2,3,4] [--wait-hours 1] [--yes]
 *
 * A keeper looks at the run once a minute and takes one of four turns (`turnOf`). While the run's
 * process lives and its log ends on a provider wait (`campaign.waited`, `for: "provider"`) longer
 * than `--wait-hours`, it stops the run and goes on with it on another login. Where the process
 * is gone it goes on with the run on the same login: after an ending on the environment, as the
 * operator asked of every such run, and after no ending at all, a process that died. Any other
 * ending is the campaign's own, and the keeper leaves. A run goes on from its log at the commit
 * its worktree stands at, on its kept flags, through the refusals of `runs continue`.
 *
 * The next login is the one with room whose week resets soonest, of those this keeper has not seen
 * spent (`room`, `logins.ts`), and `--logins` defaults to `ANA_LOGINS`. With none it says so once
 * and waits. A run that goes on three times in a row without its log growing
 * is left: something the keeper cannot mend ends it each time.
 *
 * With `--yes` the verb leaves a keeper running by itself, its output in `keep.out` beside the log,
 * and ends: one keeper a run, and `runs stop`, `pause` or `continue --after` of the run end it. Until
 * 15 October this was three shell loops of the operator's and a wrapper a login, each moving one run.
 */
import { openingOf } from "#src/builder/opening.ts";
import { type LogEvent } from "#src/kernel/log.ts";
import { openSync, statSync } from "#src/meta/filesystem.ts";
import { isString } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { capturedExecPath, capturedSpawn, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { recordedSetting } from "../d2/setting.ts";
import { allowedLogins, readLogins, room } from "./logins.ts";
import { lastRun, rerun, start } from "./manage.ts";
import { KEEPING, keepers, logEvents, processes, type Run, runNamed, writers } from "./registry.ts";
import { stop } from "./stop.ts";

export type Turn = "watch" | "move" | "continue" | "done";

const LOOK_MS = 60_000;
const HOUR = 3_600_000;
/** Goings-on in a row with no growth of the log, after which a keeper leaves its run. */
const BARREN = 3;

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

/** The models a run's seats run on: as its kept flags name them, `--seat model` or `--seat=model`,
 *  and as its opening and setting record them for the seats its flags leave to the record. */
export function seatModels(events: readonly LogEvent[], flags: readonly string[]): string[] {
  const opening = openingOf(events);
  return [
    ...flags.map((flag) => flag.slice(flag.indexOf("=") + 1)),
    ...Object.values(opening?.seats ?? {}).map((seat) => seat?.model),
    opening?.solver?.model,
    recordedSetting(events)?.solver?.model,
  ].filter(isString);
}

/**
 * The login a run goes on with after `turn`, or null to wait: its own on a continue, unless this
 * keeper saw it spent, else the first of `roomy`, those with room. A run none of whose `models` is
 * a `claude/` one bills no login, so it goes on whatever room they have: on 20 October the two
 * Codex runs kept on the M1 named no login, and would have waited for one of three spent logins
 * none of their seats used.
 */
export async function nextLogin(
  turn: Turn,
  {
    current,
    spent,
    models,
  }: { current: string | undefined; spent: ReadonlySet<string>; models: readonly string[] },
  roomy: () => Promise<readonly string[]>,
  logins: readonly string[],
): Promise<string | null> {
  const billed = models.some((model) => model.startsWith("claude/"));
  if (turn === "continue" && current !== undefined && !(billed && spent.has(current))) return current;
  return (await roomy())[0] ?? (billed ? null : (logins[0] ?? null));
}

/** Keep `run` going on `logins` until it ends on its own terms. */
async function keepGoing(run: Run, logins: readonly string[], waitMs: number): Promise<void> {
  // A login this keeper moved off, until its limit resets.
  const spentUntil = new Map<string, number>();
  let barren = 0;
  let grown = -1;
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
    const target = await nextLogin(
      turn,
      { current, spent, models: seatModels(events, lastRun(run).flags) },
      async () => room(await readLogins(logins, runtimeProcess.env), logins, spent),
      logins,
    );
    if (target === null) {
      if (!waiting) console.log(`${run.name}: no login with room; left waiting`);
      waiting = true;
      continue;
    }
    waiting = false;
    const size = statSync(run.path).size;
    barren = turn === "continue" && size === grown ? barren + 1 : 0;
    grown = size;
    if (barren >= BARREN) {
      return console.log(
        `${run.name} went on ${String(BARREN)} times and its log did not grow: kept no longer`,
      );
    }
    console.log(`${new Date(now).toISOString()} ${run.name}: ${turn} on login ${target}`);
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
  if (name === undefined || logins.length === 0) {
    throw new Error(
      "usage: bun --env-file=<file> run runs keep <name> --logins 2,3,4 [--wait-hours 1] [--yes]",
    );
  }
  const run = runNamed(name);
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
