#!/usr/bin/env bun
/**
 * Summarises recorded solve and session expenditure against turn counts and the per-solve budget
 * reserve: `bills.ts <log.jsonl | campaign name>...` or `bills.ts --runs <dir> [--since <date>]`. A
 * campaign is capped in dollars (`--budget`), priced turn by turn (`billOf`); a new solve starts
 * only when the remaining budget covers its reserve (`--reserve`) beside active solves (`affords`),
 * and running solves are not preempted, so the cap holds provided no solve exceeds its reserve.
 * Grouped by seat and model, it reports median turns and spend, cost per turn and the Spearman
 * correlation of turns with bill, seats with a turn at `DEAR` times their median, and solves over
 * their campaign's reserve.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { campaignLogs, namedLogs } from "#skills/main/logs.ts";
import { formatOf, MISSING, printed } from "#skills/main/print.ts";
import { openingOf } from "#src/campaign/opening.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { SEATS, type Seat, traced, whose } from "#src/kernel/trace.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { median } from "#src/meta/tally.ts";
import { logEvents } from "#tools/runs/registry.ts";

const SINCE = "2026-10-25";
/** Multiplier above a seat's median turn cost that flags an outlier turn poorly captured by turn counts. */
const DEAR = 10;
const USAGE = `usage:
  bills.ts <log.jsonl | campaign name>...
  bills.ts --runs <dir> [--since <date>] [--format md|tsv]

What finished solves and sessions billed against their turns, and the solves past their reserve.
--runs    every campaign under this folder instead of the ones named
--since   with --runs, campaigns whose last event is at or after this date; ${SINCE} by default`;
const HEAD = [
  "seat",
  "model",
  "seats",
  "turns p50",
  "$ p50",
  "$ p99",
  "$ max",
  "$/turn p10",
  "p50",
  "p90",
  "rank corr.",
  `a turn ${String(DEAR)}x median`,
  "past reserve",
];

export interface Billed {
  readonly seat: Seat;
  readonly model: string;
  readonly turns: number;
  readonly billed: number;
  readonly each: readonly number[];
  readonly reserve: number | null;
}

/** Referee findings carry no separate bill and are omitted. */
function billedSeats(events: readonly LogEvent[]): Billed[] {
  const reserve = openingOf(events)?.budget?.reserve ?? null;
  const open = new Map<string, { model: string; each: number[] }>();
  const seats: Billed[] = [];
  for (const [index, event] of events.entries()) {
    const [of, part] = event.kind.split(".");
    const seat = SEATS.find((each) => each === of);
    if (seat === undefined) continue;
    const { data } = event;
    const named = data[whose(seat)];
    if (!isString(named)) continue;
    const id = `${seat} ${named}`;
    if (part === "started") {
      open.set(id, { model: isString(data.model) ? data.model : MISSING, each: [] });
    } else if (part === "turn") {
      const turn = traced(event, index);
      if (turn?.part === "turn" && turn.billed !== null) open.get(id)?.each.push(turn.billed);
    } else if (part === "finished") {
      const began = open.get(id);
      open.delete(id);
      const { billed, turns } = data;
      if (began !== undefined && isNumber(billed) && isNumber(turns) && turns > 0) {
        seats.push({ seat, ...began, turns, billed, reserve: seat === "solve" ? reserve : null });
      }
    }
  }
  return seats;
}

const centile = (sorted: readonly number[], share: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? Number.NaN;

/** Zero-based average ranks: tied values take the mean of the rank positions they span. */
function ranks(values: readonly number[]): number[] {
  const order = values.map((value, at) => ({ value, at })).toSorted((a, b) => a.value - b.value);
  const out = values.map(() => 0);
  for (let from = 0; from < order.length; ) {
    let to = from;
    while (order[to + 1]?.value === order[from]?.value) to += 1;
    for (const { at } of order.slice(from, to + 1)) out[at] = (from + to) / 2;
    from = to + 1;
  }
  return out;
}

/** Spearman's rank correlation of `one` and `other`, or null if either series is constant. */
function rankCorrelation(one: readonly number[], other: readonly number[]): number | null {
  const [a, b] = [ranks(one), ranks(other)];
  const mid = (a.length - 1) / 2;
  let [both, left, right] = [0, 0, 0];
  for (const [at, rank] of a.entries()) {
    const against = (b[at] ?? mid) - mid;
    both += (rank - mid) * against;
    left += (rank - mid) ** 2;
    right += against ** 2;
  }
  return left === 0 || right === 0 ? null : both / Math.sqrt(left * right);
}

const hasDearTurn = ({ each }: Billed): boolean => {
  const middle = median(each);
  return middle !== null && middle > 0 && each.some((turn) => turn >= DEAR * middle);
};

function billRows(seats: readonly Billed[]): string[][] {
  const groups = Map.groupBy(seats, ({ seat, model }) => `${seat}\t${model}`);
  return [...groups.values()]
    .toSorted((a, b) => b.length - a.length)
    .map((group) => {
      const [first] = group;
      const bills = group.map(({ billed }) => billed).toSorted((a, b) => a - b);
      const aTurn = group.map(({ billed, turns }) => billed / turns).toSorted((a, b) => a - b);
      const turns = group.map(({ turns: count }) => count);
      const held = group.filter(({ reserve }) => reserve !== null);
      const past = held.filter(({ billed, reserve }) => reserve !== null && billed > reserve);
      const corr = rankCorrelation(
        turns,
        group.map(({ billed }) => billed),
      );
      const of = (count: number, all: number) => `${String(count)} of ${String(all)}`;
      return [
        first?.seat ?? MISSING,
        first?.model ?? MISSING,
        String(group.length),
        String(median(turns) ?? MISSING),
        ...[0.5, 0.99, 1].map((share) => centile(bills, share).toFixed(2)),
        ...[0.1, 0.5, 0.9].map((share) => centile(aTurn, share).toFixed(3)),
        corr === null ? MISSING : corr.toFixed(2),
        of(group.filter(hasDearTurn).length, group.length),
        held.length === 0 ? MISSING : of(past.length, held.length),
      ];
    });
}

if (import.meta.main) {
  await runCommand(
    {
      name: "bills",
      usage: USAGE,
      options: { runs: "abs", since: "text", format: "text" },
      positionals: [0, 64],
    },
    async (args: CommandArgs) => {
      const home = args.value("runs");
      if ((home === null) === (args.positionals.length === 0)) {
        args.die("name the campaigns, or a folder of them with --runs");
      }
      const logs =
        home === null
          ? await namedLogs(args.positionals)
          : await campaignLogs(home, [], args.value("since") ?? SINCE);
      const seats = logs.flatMap(({ path }) => billedSeats(logEvents(path)));
      console.log(printed(HEAD, billRows(seats), formatOf(args)));
      console.log(`\n${String(logs.length)} logs, ${String(seats.length)} finished seats with a bill.`);
    },
  );
}
