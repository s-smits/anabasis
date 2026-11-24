/**
 * Cron-driven alert monitor that reports every promotion, starter-comparison reading, campaign
 * ending, and stall across all configured hosts without involving a model. Because campaigns have no
 * automatic cap on promotions, an operator or controller session needs timely notification to decide
 * when to pause; `pulse` only reports to an actively polling session.
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

/** Snapshot of a single run as observed by the host holding it. */
export interface Row {
  readonly name: string;
  readonly promotions: readonly Promotion[];
  /** Current lifecycle state (`runState`): actively written, kept, ended, or stopped. */
  readonly state: RunState;
  /** Whether this run should have an attached keeper (`keepsItself`); runs with no fallback login do not. */
  readonly owed: boolean;
  readonly lastAt: string | null;
  /** Keeper action lines recorded for this run, ordered oldest first. */
  readonly kept: readonly string[];
  /** Whether a pause stopped the run (`stateOf`), transmitted separately for compatibility with older peers. */
  readonly paused: boolean;
  /** All campaign endings recorded in the log, ordered oldest first. */
  readonly endings: readonly string[];
}

/** Response from a single host: its active rows together with every campaign directory it holds
 *  (including closed runs older than a day that are omitted from `rows`), preventing false vanished-run alerts. */
export interface HostRows {
  readonly rows: readonly Row[];
  readonly held: readonly string[];
  /** Campaigns moved into this host's local archive by `runs retire`, so leaving the active registry
   *  does not register as a disappearance. */
  readonly retired: readonly string[];
}

/** Result of querying one host; `said` is null if the host did not return a readable payload. */
interface Answer {
  readonly host: string;
  readonly said: HostRows | null;
}

/** Default state file path when `--state` is not supplied. */
const STATE = join(".ana", "runs-alerts.json");
const MAYBE_TEXT = Type.Union([Type.String(), Type.Null()]);
/** Previously observed state of a single run; `reads` holds the session IDs of starter comparisons already reported. */
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
/** Serialised alert state: unreachable hosts, consecutive missed-poll counts per host, and last-seen run records. */
const ALERT_STATE = Type.Object({
  down: Type.Array(Type.String()),
  looks: Type.Optional(Type.Record(Type.String(), Type.Number())),
  runs: Type.Record(Type.String(), SEEN),
});
/** Consecutive missed polls before re-reporting an unreachable host that holds an open run
 *  (six ten-minute polls equals one hour). */
const REPEAT_ALERT_CYCLES = 6;
export type AlertState = Static<typeof ALERT_STATE>;

/** Schema for a host's `alerts --rows` payload. Requires fields absent from older checkouts
 *  (such as `state` and `endings`) so incompatible peers register as unreachable. */
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

/** Builds the alert row for `run` from its log at timestamp `now` and the live process table `running`. */
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

/** Collects alert rows, held campaign names, and retired archive names for the local host. */
function rowsHere(now: number): HostRows {
  const running = processes();
  const held = runs().filter(isCampaign);
  const rows = held.flatMap((run) => {
    // A log may disappear between directory enumeration and stat (for example during test teardown),
    // so skip missing entries instead of aborting the whole poll.
    const log = statSync(run.path, { throwIfNoEntry: false });
    if (log === undefined) return [];
    const writing = writers(run, running).length > 0 ? "open" : "closed";
    // Filter runs to match `status` while requiring a launch receipt (`keepReceipt`). Rehearsal
    // seeds and test campaigns use scripted seats and write no receipt, keeping synthetic
    // promotions out of operator notifications.
    const read = lastLaunch(run.path) !== undefined && onStatus(run, writing, now - log.mtimeMs);
    return read ? [rowOf(run, running, now)] : [];
  });
  const retired = archived().flatMap((run) => (run.archived === HERE ? [run.name] : []));
  return { rows, held: held.map(({ name }) => name), retired };
}

/** Type guard indicating whether a process is actively writing the run's log (carrying keeper presence). */
const written = (state: RunState): state is Extract<RunState, { kept: boolean }> => "kept" in state;

/** Returns the log's terminal ending string, whether or not a keeper continued past it. */
const endingOf = (state: RunState): string | null => {
  if (state.kind === "kept") return state.ending ?? null;
  return state.kind === "ended" ? state.ending : null;
};

/** Describes any liveness or keeper defect for an unfinished run. Narrowing is exhaustive so adding
 *  a new variant to `RunState` produces a compile error here. */
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

/** Produces new alert lines for `row` relative to the previous snapshot `seen`. A run observed for
 *  the first time summarises its existing promotions in a single line rather than replaying history. */
function newsOf(row: Row, now: Seen, seen: Seen | undefined): string[] {
  const last = row.promotions.at(-1);
  const first =
    last === undefined
      ? []
      : [`first seen with ${plural(row.promotions.length, "promotion")}, the last ${last.digest}`];
  // Report newly entered liveness gaps and transitions into the quiet state.
  const gap = now.gap === seen?.gap ? null : now.gap;
  const quiet = now.quiet && seen?.quiet !== true;
  // Emit each ending added since `seen` (including intermediate endings a keeper resumed past); fall
  // back to the current ending when reading an older state snapshot without `endings` counts.
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
 * Pure state-transition fold for one alert poll: combines the prior state (`null` on first poll)
 * with each host's response (`null` when unreachable) to produce output lines and the next state.
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
  // When a campaign exists on two hosts or worktrees (for example mid-move), prefer the actively written copy.
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

/** Reads the previous alert state from `path`. Returns `before: null` if missing or unreadable;
 *  `torn` is true when the file exists but fails schema validation. */
function lastLook(path: string): { before: AlertState | null; torn: boolean } {
  if (!existsSync(path)) return { before: null, torn: false };
  const before = answerOf(ALERT_STATE, [readFileSync(path, "utf8")]);
  return { before, torn: before === null };
}

/** Polls this host and every peer in `ANA_HOSTS` for their current alert rows. */
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

/** Entry point for `bun run runs alerts`. */
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
