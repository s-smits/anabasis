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
import { onStatus, pulse, remember } from "./pulse.ts";
import { lastLaunch } from "./receipt.ts";
import {
  HERE,
  isCampaign,
  keepers,
  keptFile,
  logEvents,
  processes,
  type Run,
  runs,
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
  readonly ending: string | null;
  readonly writer: boolean;
  readonly keeper: boolean;
  /** Whether this run gets a keeper by itself (`keepsItself`): one that has nowhere to move does not. */
  readonly owed: boolean;
  /** The pulse's reading of no new event, which counts a named reset as the run's last word. */
  readonly quiet: boolean;
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

/** The row of `run`, whose log is read at `now`. */
function rowOf(run: Run, open: boolean, now: number): Row {
  const events = logEvents(run.path);
  const last = events.at(-1);
  const look = pulse(run, events, open ? "open" : "closed", undefined, { now, alarms: () => null });
  const file = keptFile(run);
  return {
    name: run.name,
    promotions: promotionsOf(events),
    ending: last?.kind === "campaign.ended" && isString(last.data.ending) ? last.data.ending : null,
    writer: open,
    keeper: keepers(run.name).length > 0,
    owed: keepsItself(runtimeProcess.env, lastLaunch(run.path)?.login),
    quiet: look.seen.quiet,
    lastAt: last?.at ?? null,
    kept: existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(keeperActed) : [],
  };
}

/**
 * Whether a look reads a run: as `status` shows it, less a seed no launch continued. A rehearsal
 * writes its seed, so `status` shows it, and on 6 November two reached the operator's notifications
 * as "first seen with 6 promotions" beside a real second promotion.
 */
export const onAlerts = (run: Run, open: boolean, age: number): boolean =>
  (run.seed !== true || lastLaunch(run.path) !== undefined) && onStatus(run, open, age);

/** This machine's rows, and the name of every campaign its worktrees hold. */
function rowsHere(now: number): HostRows {
  const running = processes();
  const held = runs().filter(isCampaign);
  const rows = held.flatMap((run) => {
    const open = writers(run, running).length > 0;
    return onAlerts(run, open, now - statSync(run.path).mtimeMs) ? [rowOf(run, open, now)] : [];
  });
  return { rows, held: held.map(({ name }) => name) };
}

/** A host's answer, or null for one that gave none a look can read. */
function answerOf(lines: readonly string[] | null): HostRows | null {
  if (lines === null) return null;
  try {
    const answer = parseJsonAs<HostRows>(lines.join("\n"));
    const whole = answer.rows.every(
      ({ name, promotions, kept }) => isString(name) && Array.isArray(promotions) && Array.isArray(kept),
    );
    return whole && Array.isArray(answer.held) ? answer : null;
  } catch {
    return null;
  }
}

/** What is wrong with a run that has not ended, in the words a line says it. */
function gapOf({ ending, writer, keeper, owed }: Row): string | null {
  if (ending !== null) return null;
  if (writer) return owed && !keeper ? "no keeper" : null;
  if (keeper) return "no writer process; its keeper lives";
  return owed ? "no writer process and no keeper" : "no writer process";
}

function seenOf(row: Row, host: string): Seen {
  return {
    host,
    promotions: row.promotions.length,
    reads: row.promotions.flatMap(({ read }) => (read === null ? [] : [read.session])),
    ending: row.ending,
    gap: gapOf(row),
    quiet: row.quiet,
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
  return [
    ...(seen === undefined ? first : climbLines(row, seen)),
    ...row.kept
      .slice(seen?.kept ?? row.kept.length)
      .map((line) => `keeper: ${line.replace(`${row.name}: `, "")}`),
    ...(gap !== null && gap !== seen?.gap ? [gap] : []),
    ...(row.quiet && seen?.quiet !== true
      ? [`quiet: no new event since ${row.lastAt ?? "its start"}, and no login limit waited on`]
      : []),
    ...(row.ending !== null && row.ending !== seen?.ending ? [`ended ${row.ending}`] : []),
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
      .toSorted((one, other) => Number(one.row.writer) - Number(other.row.writer))
      .map((each) => [each.row.name, each]),
  );
  const lines: string[] = [];
  const next: Record<string, Seen> = {};
  for (const host of down) {
    if (before !== null && !before.down.includes(host)) {
      lines.push(`${host}: did not answer; its runs stay as last seen`);
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
    const silent = down.length === 0 ? "" : `; ${down.join(", ")} did not answer`;
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
