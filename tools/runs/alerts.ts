/**
 * Cron-driven monitor of every promotion, starter-comparison reading, campaign ending and stall
 * across all configured hosts, without a model. Campaigns have no cap on promotions, so an operator
 * needs timely word to decide when to pause; `pulse` reports only to a session that polls.
 *
 *   bun run runs alerts [--state .ana/runs-alerts.json]
 *   bun run runs alerts --rows
 *
 * State is keyed by campaign name so that a run relocated by `runs move` retains its history. Runs
 * on unreachable hosts remain in the state as last observed so that reconnecting hosts report what
 * changed; a run is dropped from state only once a responding host no longer holds it. On a first
 * run, or when the state file cannot be parsed, the command records the current snapshot without
 * emitting historical alerts.
 */
import { type Static, Type } from "typebox";
import { existsSync, readFileSync, statSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { asked, answerOf } from "./hosts.ts";
import { keeperActed } from "./keep.ts";
import { keepsItself } from "./manage.ts";
import { type RunState, runState } from "./state.ts";
import { onStatus } from "./pulse.ts";
import { remember } from "./pulse-readers.ts";
import { lastLaunch } from "./receipt.ts";
import { climbed, ENDED, type Promotion, promotionsOf, word } from "./said.ts";
import {
  archived,
  HERE,
  isCampaign,
  keeperLogPath,
  logEvents,
  processes,
  type Run,
  runs,
  type Running,
  writers,
} from "./registry.ts";

export interface Row {
  readonly name: string;
  readonly promotions: readonly Promotion[];
  readonly state: RunState;
  /** Whether this run should have a keeper attached (`keepsItself`); a run with no fallback login
   *  should not. */
  readonly owed: boolean;
  readonly lastAt: string | null;
  readonly kept: readonly string[];
  /** Whether a pause stopped the run (`stateOf`), sent separately for older peers. */
  readonly paused: boolean;
  readonly endings: readonly string[];
}

/** One host's answer: its active rows and every campaign folder it holds, including closed runs
 *  older than a day that `rows` omits, so they never read as vanished. */
export interface HostRows {
  readonly rows: readonly Row[];
  readonly held: readonly string[];
  /** Campaigns `runs retire` moved into this host's archive, so leaving the registry is no disappearance. */
  readonly retired: readonly string[];
}

interface Answer {
  readonly host: string;
  readonly said: HostRows | null;
}

const STATE = join(".ana", "runs-alerts.json");
const MAYBE_TEXT = Type.Union([Type.String(), Type.Null()]);
/** A run as last seen; `reads` holds the sessions of starter comparisons already reported. */
const SEEN = Type.Object({
  host: Type.String(),
  promotions: Type.Number(),
  reads: Type.Array(Type.String()),
  ending: MAYBE_TEXT,
  gap: MAYBE_TEXT,
  quiet: Type.Boolean(),
  kept: Type.Number(),
  endings: Type.Optional(Type.Number()),
});
type Seen = Static<typeof SEEN>;
const ALERT_STATE = Type.Object({
  down: Type.Array(Type.String()),
  looks: Type.Optional(Type.Record(Type.String(), Type.Number())),
  runs: Type.Record(Type.String(), SEEN),
});
/** Missed polls before an unreachable host holding an open run is reported again (six ten-minute
 *  polls, one hour). */
const REPEAT_ALERT_CYCLES = 6;
export type AlertState = Static<typeof ALERT_STATE>;

/** A host's `alerts --rows` answer. It requires fields older checkouts lack (such as `state` and
 *  `endings`), so an incompatible peer reads as unreachable. */
const HOST_ROWS = Type.Object({
  rows: Type.Array(
    Type.Unsafe<Row>(
      Type.Object({
        name: Type.String(),
        state: Type.Object({ kind: Type.String() }),
        kept: Type.Array(Type.Unknown()),
        paused: Type.Boolean(),
        endings: Type.Array(Type.String()),
        promotions: Type.Array(
          Type.Object({
            digest: Type.String(),
            read: Type.Union([Type.Null(), Type.Object({ session: Type.String(), tally: Type.Object({}) })]),
          }),
        ),
      }),
    ),
  ),
  held: Type.Array(Type.String()),
  retired: Type.Array(Type.String()),
});

function rowOf(run: Run, running: readonly Running[], now: number): Row {
  const events = logEvents(run.path);
  const last = events.at(-1);
  const file = keeperLogPath(run);
  const state = runState(run, events, running, now);
  return {
    name: run.name,
    promotions: promotionsOf(events),
    state,
    owed: keepsItself(runtimeProcess.env, lastLaunch(run.path)?.login),
    lastAt: last?.at ?? null,
    kept: existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(keeperActed) : [],
    paused: state.kind === "stopped" && state.pause !== undefined,
    endings: events.flatMap(({ kind, data }) => (kind === ENDED ? [word(data.ending)] : [])),
  };
}

function rowsHere(now: number): HostRows {
  const running = processes();
  const held = runs().filter(isCampaign);
  const rows = held.flatMap((run) => {
    // A log may vanish between listing and stat (as in test teardown), so a missing one is skipped
    // rather than ending the poll.
    const log = statSync(run.path, { throwIfNoEntry: false });
    if (log === undefined) return [];
    const writing = writers(run, running).length > 0 ? "open" : "closed";
    // Only runs `status` shows that hold a launch receipt (`keepReceipt`): rehearsal seeds and test
    // campaigns write none, which keeps their scripted promotions out of the alerts.
    const read = lastLaunch(run.path) !== undefined && onStatus(run, writing, now - log.mtimeMs);
    return read ? [rowOf(run, running, now)] : [];
  });
  const retired = archived().flatMap((run) => (run.archived === HERE ? [run.name] : []));
  return { rows, held: held.map(({ name }) => name), retired };
}

const written = (state: RunState): state is Extract<RunState, { kept: boolean }> => "kept" in state;

/** The log's last ending, whether or not a keeper went on past it. */
const endingOf = (state: RunState): string | null => {
  if (state.kind === "kept") return state.ending ?? null;
  return state.kind === "ended" ? state.ending : null;
};

/** Any liveness or keeper defect of an unfinished run. The narrowing is exhaustive, so a new
 *  `RunState` variant fails to compile here. */
function gapOf({ state, owed, paused }: Row): string | null {
  if (written(state)) return owed && !state.kept ? "no keeper" : null;
  if (state.kind === "ended") return null;
  if (state.kind === "kept") return "no writer process; its keeper lives";
  state.kind satisfies "stopped";
  if (paused) return "paused";
  return owed ? "no writer process and no keeper" : "no writer process";
}

function seenOf(row: Row, host: string): Seen {
  return {
    host,
    promotions: row.promotions.length,
    reads: row.promotions.flatMap(({ read }) => (read === null ? [] : [read.session])),
    ending: endingOf(row.state),
    gap: gapOf(row),
    quiet: row.state.kind === "quiet",
    kept: row.kept.length,
    endings: row.endings.length,
  };
}

/** New alert lines for `row` against the previous snapshot `seen`. A run seen for the first time
 *  sums up its promotions in one line rather than replaying them. */
function newsOf(row: Row, now: Seen, seen: Seen | undefined): string[] {
  const last = row.promotions.at(-1);
  const first =
    last === undefined
      ? []
      : [`first seen with ${plural(row.promotions.length, "promotion")}, the last ${last.digest}`];
  const gap = now.gap === seen?.gap ? null : now.gap;
  const quiet = now.quiet && seen?.quiet !== true;
  // Every ending added since `seen`, including those a keeper went on past; an older snapshot without
  // `endings` falls back to the current ending.
  const fresh = now.ending === null || now.ending === seen?.ending ? [] : [now.ending];
  const gained = seen?.endings === undefined ? fresh : row.endings.slice(seen.endings);
  const stands = now.ending === null ? -1 : gained.length - 1;
  return [
    ...(seen === undefined ? first : climbed(row, seen).map(({ line }) => line)),
    ...row.kept
      .slice(seen?.kept ?? row.kept.length)
      .map((line) => `keeper: ${line.replace(`${row.name}: `, "")}`),
    ...(gap === null ? [] : [gap]),
    ...(quiet
      ? [`quiet: no new event since ${row.lastAt ?? "its start"}, and no login limit waited on`]
      : []),
    ...gained.map((said, at) => `ended ${said}${at === stands ? "" : ", and went on"}`),
  ];
}

/**
 * One poll's state fold: the prior state (null on the first poll) and each host's answer (null
 * where unreachable) give the lines and the next state.
 */
export function alertsOf(
  before: AlertState | null,
  answers: readonly Answer[],
): { lines: string[]; next: AlertState } {
  const down = answers.flatMap(({ host, said }) => (said === null ? [host] : []));
  const heard = answers.flatMap(({ host, said }) => (said === null ? [] : [{ host, said }]));
  const answered = new Set(heard.map(({ host }) => host));
  const held = new Set(heard.flatMap(({ said }) => said.held));
  const retired = new Set(heard.flatMap(({ said }) => said.retired));
  // A campaign on two hosts or worktrees (mid-move) is read from its written copy.
  const current = new Map(
    heard
      .flatMap(({ host, said }) => said.rows.map((row) => ({ host, row })))
      .toSorted((one, other) => Number(written(one.row.state)) - Number(written(other.row.state)))
      .map((each) => [each.row.name, each]),
  );
  const lines: string[] = [];
  const next: Record<string, Seen> = {};
  const looks = Object.fromEntries(down.map((host) => [host, (before?.looks?.[host] ?? 0) + 1]));
  for (const host of down) {
    const silent = looks[host] ?? 1;
    const open = Object.values(before?.runs ?? {}).some((seen) => seen.host === host && seen.ending === null);
    if (before !== null && !before.down.includes(host)) {
      lines.push(`${host}: unreachable from this checkout; retaining last known run status`);
    } else if (open && silent % REPEAT_ALERT_CYCLES === 0) {
      lines.push(
        `${host}: unreachable for ${String(silent)} consecutive polls while a run was last seen active`,
      );
    }
  }
  for (const [name, seen] of Object.entries(before?.runs ?? {})) {
    if (current.has(name)) continue;
    if (held.has(name) || !answered.has(seen.host)) {
      next[name] = seen;
    } else if (seen.ending === null && !retired.has(name)) {
      lines.push(`${name} (${seen.host}): left the registry with no ending seen`);
    }
  }
  for (const [name, { host, row }] of current) {
    const now = seenOf(row, host);
    if (before !== null) {
      lines.push(...newsOf(row, now, before.runs[name]).map((line) => `${name} (${host}): ${line}`));
    }
    next[name] = now;
  }
  if (before === null) {
    const silent = down.length === 0 ? "" : `; ${down.join(", ")} gave no answer this tree reads`;
    lines.push(
      `first look: recorded ${plural(current.size, "run")} on ${plural(heard.length, "host")}, and each later look prints what is new${silent}`,
    );
  }
  return { lines, next: { down, looks, runs: next } };
}

/** The previous alert state at `path`: `before` is null where it is missing or unreadable, and
 *  `torn` where it exists but fails the schema. */
function lastLook(path: string): { before: AlertState | null; torn: boolean } {
  if (!existsSync(path)) return { before: null, torn: false };
  const before = answerOf(ALERT_STATE, [readFileSync(path, "utf8")]);
  return { before, torn: before === null };
}

async function looked(): Promise<Answer[]> {
  const away = await asked(["alerts", "--rows"]);
  return [
    { host: HERE, said: rowsHere(Date.now()) },
    ...away.map(({ host, lines }) => ({
      host: host.name,
      said: answerOf(HOST_ROWS, lines),
    })),
  ];
}

export async function alerts(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      state: { type: "string", default: STATE },
      rows: { type: "boolean", default: false },
    },
  });
  if (values.rows) {
    console.log(capturedJsonStringify(rowsHere(Date.now())));
    return;
  }
  const { before, torn } = lastLook(values.state);
  const { lines, next } = alertsOf(before, await looked());
  if (torn) console.log(`${values.state} could not be read, so this look is a first look`);
  for (const line of lines) console.log(line);
  remember(values.state, capturedJsonStringify(next));
}
