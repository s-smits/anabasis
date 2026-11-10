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
import { epochsOf, starterReads } from "#src/campaign/climb.ts";
import type { Tally } from "#src/kernel/compare.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { existsSync, readFileSync, statSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isBoolean, isNumber, isString } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { asked } from "./hosts.ts";
import { keeperActed } from "./keep.ts";
import { keepsItself } from "./manage.ts";
import { type RunState, runState } from "./state.ts";
import { onStatus } from "./pulse.ts";
import { remember } from "./pulse-readers.ts";
import { lastLaunch, unlaunchedSeed } from "./receipt.ts";
import {
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

/** One promotion of a run, and its starter comparison once one tallied a task (`epochsOf`). */
interface Promotion {
  readonly digest: string;
  readonly read: {
    readonly session: string;
    readonly tally: Tally;
    /** Whether its tally, turned so that the reference is the side ahead, reads a step at its
     *  level (`confirmed`, `epochsOf`); the comparison's own reading is the starter's, never this. */
    readonly confirmed: boolean;
    /** The tally on the tasks written after the promotion. A peer whose tree predates it sends none. */
    readonly writtenAfter?: Tally;
  } | null;
}

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
}

/** What a host answered: its rows, and every campaign it holds, which the rows leave out once they are
 *  closed and a day old. A run named here is no vanished run. */
export interface HostRows {
  readonly rows: readonly Row[];
  readonly held: readonly string[];
}

/** What the last look saw of one run. */
interface Seen {
  readonly host: string;
  readonly promotions: number;
  /** The starter comparisons read so far, by id. */
  readonly reads: readonly string[];
  readonly ending: string | null;
  readonly gap: string | null;
  readonly quiet: boolean;
  readonly kept: number;
}

export interface AlertState {
  readonly down: readonly string[];
  readonly runs: Readonly<Record<string, Seen>>;
}

/** Starter comparisons read that make a run ready to pause, the threshold of `wri2p2.ts`. */
const READY_AT = 2;
const DIGEST_CHARS = 8;
/** The file's last look, where no `--state` names another. */
const STATE = join(".ana", "runs-alerts.json");

function promotionsOf(events: readonly LogEvent[]): Promotion[] {
  const reads = starterReads(events);
  return epochsOf(events)
    .slice(1)
    .map(({ reference, starter_read: session, starter_tally: tally, confirmed }) => {
      const after = reads.find((each) => each.session === session)?.origins["written after"].whole;
      return {
        digest: reference.slice(0, DIGEST_CHARS),
        read:
          session === null || tally === null
            ? null
            : {
                session,
                tally,
                confirmed: confirmed === true,
                ...keyIfDefined("writtenAfter", after),
              },
      };
    });
}

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
  return { rows, held: held.map(({ name }) => name) };
}

/** Whether `value` is a promotion as this tree reads one (`Promotion`). */
function readsPromotion(value: unknown): boolean {
  const promotion = asRecord(value);
  const read = asRecord(promotion?.read);
  const readable = promotion?.read === null || (isString(read?.session) && asRecord(read?.tally) !== null);
  return isString(promotion?.digest) && readable;
}

/** Whether `value` is a row as this tree reads one (`Row`). */
function readsRow(value: unknown): boolean {
  const row = asRecord(value);
  return (
    isString(row?.name) &&
    isString(asRecord(row?.state)?.kind) &&
    Array.isArray(row?.kept) &&
    Array.isArray(row?.promotions) &&
    row.promotions.every(readsPromotion)
  );
}

/** A host's answer, or null for one that gave none a look can read: a peer on an older tree sends
 *  rows that lack a part, such as `state`, and reads as a host down. */
function answerOf(lines: readonly string[] | null): HostRows | null {
  if (lines === null) return null;
  try {
    const answer = parseJsonAs<HostRows>(lines.join("\n"));
    return answer.rows.every(readsRow) && Array.isArray(answer.held) ? answer : null;
  } catch {
    return null;
  }
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
function gapOf({ state, owed }: Row): string | null {
  if (written(state)) return owed && !state.kept ? "no keeper" : null;
  if (state.kind === "ended") return null;
  if (state.kind === "kept") return "no writer process; its keeper lives";
  state.kind satisfies "stopped";
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

/** What a run's promotions and starter comparisons add to what `seen` remembers. */
function climbLines(row: Row, seen: Seen): string[] {
  const lines = row.promotions.flatMap(({ digest, read }, at) => {
    const nth = String(at + 1);
    const promoted =
      at < seen.promotions
        ? []
        : [
            `promotion ${nth}, harness ${digest}${read === null ? "; a pause should wait for its starter comparison, or it stays unconfirmed for good" : ""}`,
          ];
    if (read === null || seen.reads.includes(read.session)) return promoted;
    const { wins, losses, ties } = read.tally;
    const after = read.writtenAfter;
    return [
      ...promoted,
      `starter comparison ${read.session} after promotion ${nth} (${digest}) read ${read.confirmed ? "a step" : "no step"} for the reference: won ${String(wins)}, lost ${String(losses)}, tied ${String(ties)}, ${read.confirmed ? "confirmed" : "not confirmed"}${after === undefined ? "" : `; on tasks written after it won ${String(after.wins)}, lost ${String(after.losses)}, tied ${String(after.ties)}`}`,
    ];
  });
  const read = row.promotions.filter((one) => one.read !== null).length;
  return seen.reads.length < READY_AT && read >= READY_AT
    ? [...lines, `ready to pause, ${String(read)} promotions read: bun run runs pause ${row.name} --yes`]
    : lines;
}

/** The lines `row` earns since `seen`, each to be headed by the run's name. A run first seen says its
 *  promotions in one line, since its log may hold a seed's or a run's from before this state. */
function newsOf(row: Row, seen: Seen | undefined): string[] {
  const last = row.promotions.at(-1);
  const first =
    last === undefined
      ? []
      : [`first seen with ${plural(row.promotions.length, "promotion")}, the last ${last.digest}`];
  const gap = gapOf(row);
  const ending = endingOf(row.state);
  return [
    ...(seen === undefined ? first : climbLines(row, seen)),
    ...row.kept
      .slice(seen?.kept ?? row.kept.length)
      .map((line) => `keeper: ${line.replace(`${row.name}: `, "")}`),
    ...(gap !== null && gap !== seen?.gap ? [gap] : []),
    ...(row.state.kind === "quiet" && seen?.quiet !== true
      ? [`quiet: no new event since ${row.lastAt ?? "its start"}, and no login limit waited on`]
      : []),
    ...(ending !== null && ending !== seen?.ending ? [`ended ${ending}`] : []),
  ];
}

/**
 * The fold of one look: from what the last look saw (null for none) and what each host answered (null
 * for one that gave no answer) to the lines to print and what to remember.
 */
export function alertsOf(
  before: AlertState | null,
  answers: readonly { readonly host: string; readonly said: HostRows | null }[],
): { lines: string[]; next: AlertState } {
  const down = answers.flatMap(({ host, said }) => (said === null ? [host] : []));
  const heard = answers.flatMap(({ host, said }) => (said === null ? [] : [{ host, said }]));
  const answered = new Set(heard.map(({ host }) => host));
  const held = new Set(heard.flatMap(({ said }) => said.held));
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
    } else if (seen.ending === null) {
      lines.push(`${name} (${seen.host}): left the registry with no ending seen`);
    }
  }
  for (const [name, { host, row }] of current) {
    if (before !== null) {
      lines.push(...newsOf(row, before.runs[name]).map((line) => `${name} (${host}): ${line}`));
    }
    next[name] = seenOf(row, host);
  }
  if (before === null) {
    const silent = down.length === 0 ? "" : `; ${down.join(", ")} gave no answer this tree reads`;
    lines.push(
      `first look: recorded ${plural(current.size, "run")} on ${plural(heard.length, "host")}, and each later look prints what is new${silent}`,
    );
  }
  return { lines, next: { down, runs: next } };
}

/** Whether `value` is a state the fold can read, every run in it included. */
function wellFormed(value: unknown): value is AlertState {
  const state = asRecord(value);
  const seen = asRecord(state?.runs);
  if (seen === null || !Array.isArray(state?.down)) return false;
  return Object.values(seen).every((entry) => {
    const run = asRecord(entry);
    return (
      run !== null &&
      isString(run.host) &&
      isNumber(run.promotions) &&
      Array.isArray(run.reads) &&
      (run.ending === null || isString(run.ending)) &&
      (run.gap === null || isString(run.gap)) &&
      isBoolean(run.quiet) &&
      isNumber(run.kept)
    );
  });
}

/** The state file's last look, null where there is none or it could not be read, which `torn` says. */
function lastLook(path: string): { before: AlertState | null; torn: boolean } {
  if (!existsSync(path)) return { before: null, torn: false };
  try {
    const before = capturedJsonParse(readFileSync(path, "utf8"));
    if (wellFormed(before)) return { before, torn: false };
  } catch {
    // A torn file is no JSON; it falls through to the same answer as JSON of the wrong form.
  }
  return { before: null, torn: true };
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
  const away = await asked(["alerts", "--rows"]);
  const { lines, next } = alertsOf(before, [
    { host: HERE, said: rowsHere(Date.now()) },
    ...away.map(({ host, lines: said }) => ({ host: host.name, said: answerOf(said) })),
  ]);
  if (torn) console.log(`${values.state} could not be read, so this look is a first look`);
  for (const line of lines) console.log(line);
  remember(values.state, capturedJsonStringify(next));
}
