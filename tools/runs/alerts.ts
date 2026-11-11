/**
 * A warning at every promotion of every run and at any sign a run stopped moving, in plain code, from
 * cron, with no model in the loop. No run carries a cap on promotions, so a person or a session has to
 * learn of one to decide on a pause, and the pulse says it only to a session that is looking.
 *
 *   bun run runs alerts [--state .ana/runs-alerts.json]
 *   bun run runs alerts --rows
 *
 * One look asks every host `ANA_HOSTS` lists for its rows (`--rows`, which each host reads for itself,
 * as only it can see its own processes) and prints one line on stdout for each thing new since the
 * state file's last look, and nothing otherwise. A look remembers only after it has printed, so a kill
 * says a line twice and loses none. It starts and stops nothing: the line that says a run is ready to
 * pause prints the command for a person to run, since a pause is the operator's word.
 *
 * The state is keyed by a run's name, so a run that `runs move` took to another host is the same run.
 * A run a silent host holds stays as it was last seen, so a host coming back says what it gained, and
 * a run leaves the state only once a host that answered no longer holds it. A first look, or one
 * after a state file that cannot be read, records the present and fires on no history.
 */
import { type Static, Type } from "typebox";
import { pauseSince } from "#src/campaign/word.ts";
import { existsSync, readFileSync, statSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { asked, answerOf } from "./hosts.ts";
import { keeperActed } from "./keep.ts";
import { keepsItself } from "./manage.ts";
import { launchedIn, type RunState, runState } from "./state.ts";
import { onStatus } from "./pulse.ts";
import { remember } from "./pulse-readers.ts";
import { lastLaunch, unlaunchedSeed } from "./receipt.ts";
import { climbed, type Promotion, promotionsOf } from "./said.ts";
import {
  archived,
  HERE,
  isCampaign,
  keptFile,
  logEvents,
  processes,
  type Run,
  runs,
  type Running,
  writers,
} from "./registry.ts";

/** One run as the host that holds it reads it now. */
export interface Row {
  readonly name: string;
  readonly promotions: readonly Promotion[];
  /** Where the run stands (`runState`): written on, kept, ended or stopped. */
  readonly state: RunState;
  /** Whether this run gets a keeper by itself (`keepsItself`): one that has nowhere to move does not. */
  readonly owed: boolean;
  readonly lastAt: string | null;
  /** What its keeper said it did, oldest first. */
  readonly kept: readonly string[];
  /** Whether its current launch was left a pause (`pauseSince`); a peer on an older tree sends none. */
  readonly paused?: boolean;
}

/** What a host answered: its rows, and every campaign it holds, which the rows leave out once they are
 *  closed and a day old. A run named here is no vanished run. */
export interface HostRows {
  readonly rows: readonly Row[];
  readonly held: readonly string[];
  /** The campaigns `runs retire` moved into this host's own archive; a peer on an older tree sends
   *  none. A run that left the registry for it has not vanished. */
  readonly retired?: readonly string[];
}

/** What one host answered a look, null for one that gave no answer the look can read. */
interface Answer {
  readonly host: string;
  readonly said: HostRows | null;
}

/** The file's last look, where no `--state` names another. */
const STATE = join(".ana", "runs-alerts.json");
const MAYBE_TEXT = Type.Union([Type.String(), Type.Null()]);
/** What the last look saw of one run; `reads` are the starter comparisons read so far, by id. */
const SEEN = Type.Object({
  host: Type.String(),
  promotions: Type.Number(),
  reads: Type.Array(Type.String()),
  ending: MAYBE_TEXT,
  gap: MAYBE_TEXT,
  quiet: Type.Boolean(),
  kept: Type.Number(),
});
type Seen = Static<typeof SEEN>;
/** The state file: the hosts the last look heard nothing from, and what it saw of each run. */
const ALERT_STATE = Type.Object({ down: Type.Array(Type.String()), runs: Type.Record(Type.String(), SEEN) });
export type AlertState = Static<typeof ALERT_STATE>;

/** A host's answer to `alerts --rows`, checked for the parts a peer on an older tree lacks, such as
 *  `state`, so that such a peer reads as a host down. The rest of a row is this tree's own `Row`. */
const HOST_ROWS = Type.Object({
  rows: Type.Array(
    Type.Unsafe<Row>(
      Type.Object({
        name: Type.String(),
        state: Type.Object({ kind: Type.String() }),
        kept: Type.Array(Type.Unknown()),
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
  retired: Type.Optional(Type.Array(Type.String())),
});

/** The row of `run`, whose log is read at `now` among the processes `running`. */
function rowOf(run: Run, running: readonly Running[], now: number): Row {
  const events = logEvents(run.path);
  const last = events.at(-1);
  const file = keptFile(run);
  return {
    name: run.name,
    promotions: promotionsOf(events),
    state: runState(run, events, running, now),
    owed: keepsItself(runtimeProcess.env, lastLaunch(run.path)?.login),
    lastAt: last?.at ?? null,
    kept: existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(keeperActed) : [],
    paused: pauseSince(events, launchedIn(run, events)) !== undefined,
  };
}

/**
 * Whether a look reads a run: as `status` shows it, less a seed no launch continued. A rehearsal
 * writes its seed, so `status` shows it, and on 6 November two reached the operator's notifications
 * as "first seen with 6 promotions" beside a real second promotion.
 */
export const onAlerts = (run: Run, writing: "open" | "closed", age: number): boolean =>
  !unlaunchedSeed(run) && onStatus(run, writing, age);

/** This machine's rows, and the name of every campaign its worktrees hold. */
function rowsHere(now: number): HostRows {
  const running = processes();
  const held = runs().filter(isCampaign);
  const rows = held.flatMap((run) => {
    const writing = writers(run, running).length > 0 ? "open" : "closed";
    return onAlerts(run, writing, now - statSync(run.path).mtimeMs) ? [rowOf(run, running, now)] : [];
  });
  const retired = archived().flatMap((run) => (run.archived === HERE ? [run.name] : []));
  return { rows, held: held.map(({ name }) => name), retired };
}

/** Whether a process writes the run's log: a state written on carries whether a keeper lives beside it. */
const written = (state: RunState): state is Extract<RunState, { kept: boolean }> => "kept" in state;

/** The ending a run's log ends on, whether its keeper goes on past it or not. */
const endingOf = (state: RunState): string | null => {
  if (state.kind === "kept") return state.ending ?? null;
  return state.kind === "ended" ? state.ending : null;
};

/** What is wrong with a run that has not ended, in the words a line says it. Each guard narrows the
 *  state, and a kind added to `RunState` fails to compile at the last. */
function gapOf({ state, owed, paused }: Row): string | null {
  if (written(state)) return owed && !state.kept ? "no keeper" : null;
  if (state.kind === "ended") return null;
  if (state.kind === "kept") return "no writer process; its keeper lives";
  state.kind satisfies "stopped";
  if (paused === true) return "paused";
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
  };
}

/** The lines `row`, which stands at `now`, earns since `seen`, each to be headed by the run's name. A
 *  run first seen says its promotions in one line, since its log may hold a seed's or a run's from
 *  before this state. */
function newsOf(row: Row, now: Seen, seen: Seen | undefined): string[] {
  const last = row.promotions.at(-1);
  const first =
    last === undefined
      ? []
      : [`first seen with ${plural(row.promotions.length, "promotion")}, the last ${last.digest}`];
  // What turned since `seen`: the gap and the ending where each is new, and whether the log went quiet.
  const gap = now.gap === seen?.gap ? null : now.gap;
  const ending = now.ending === seen?.ending ? null : now.ending;
  const quiet = now.quiet && seen?.quiet !== true;
  return [
    ...(seen === undefined ? first : climbed(row, seen).map(({ line }) => line)),
    ...row.kept
      .slice(seen?.kept ?? row.kept.length)
      .map((line) => `keeper: ${line.replace(`${row.name}: `, "")}`),
    ...(gap === null ? [] : [gap]),
    ...(quiet
      ? [`quiet: no new event since ${row.lastAt ?? "its start"}, and no login limit waited on`]
      : []),
    ...(ending === null ? [] : [`ended ${ending}`]),
  ];
}

/**
 * The fold of one look: from what the last look saw (null for none) and what each host answered (null
 * for one that gave no answer) to the lines to print and what to remember.
 */
export function alertsOf(
  before: AlertState | null,
  answers: readonly Answer[],
): { lines: string[]; next: AlertState } {
  const down = answers.flatMap(({ host, said }) => (said === null ? [host] : []));
  const heard = answers.flatMap(({ host, said }) => (said === null ? [] : [{ host, said }]));
  const answered = new Set(heard.map(({ host }) => host));
  const held = new Set(heard.flatMap(({ said }) => said.held));
  const retired = new Set(heard.flatMap(({ said }) => said.retired ?? []));
  // A name two hosts or two worktrees hold is the one with a writer, as a run mid-move is.
  const current = new Map(
    heard
      .flatMap(({ host, said }) => said.rows.map((row) => ({ host, row })))
      .toSorted((one, other) => Number(written(one.row.state)) - Number(written(other.row.state)))
      .map((each) => [each.row.name, each]),
  );
  const lines: string[] = [];
  const next: Record<string, Seen> = {};
  for (const host of down) {
    if (before !== null && !before.down.includes(host)) {
      lines.push(`${host}: gave no answer this tree reads; its runs stay as last seen`);
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
  return { lines, next: { down, runs: next } };
}

/** The state file's last look, null where there is none or it could not be read, which `torn` says:
 *  a torn file and JSON of the wrong form read alike. */
function lastLook(path: string): { before: AlertState | null; torn: boolean } {
  if (!existsSync(path)) return { before: null, torn: false };
  const before = answerOf(ALERT_STATE, [readFileSync(path, "utf8")]);
  return { before, torn: before === null };
}

/** What this machine and every host `ANA_HOSTS` lists answer one look. */
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

/** `bun run runs alerts`. */
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
