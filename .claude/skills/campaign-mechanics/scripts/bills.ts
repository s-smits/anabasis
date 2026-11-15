#!/usr/bin/env bun
/**
 * What the solves and sessions on record billed, against their turns and the reserve a solve is
 * held at.
 *
 *   bun .claude/skills/campaign-mechanics/scripts/bills.ts <log.jsonl | campaign name>...
 *   bun .claude/skills/campaign-mechanics/scripts/bills.ts --runs <dir> [--since <date>]
 *
 * A campaign is capped in dollars (`--budget`), priced turn by turn from the tokens each turn used
 * (`billOf`, `src/kernel/meter.ts`). A turn count bounds a solve as a condition of the comparison
 * and prices nothing, so the one place a count of turns stands in for dollars is the reserve
 * (`--reserve`): a solve starts only while the budget holds a reserve for it beside those in
 * flight (`affords`, `src/campaign/opening.ts`), and is not cut once it runs, so the budget holds
 * where no solve under the setting's limits bills past its reserve. This prints, for each seat and
 * model, whether that holds on the record and how far turns say what a seat cost:
 *
 * - the finished seats, their median turns, and their bill at the median, the 99th centile and the
 *   dearest;
 * - the dollars a turn across seats (10th, 50th and 90th centile) and the rank correlation of a
 *   seat's turns with its bill: near 1, more turns nearly always cost more, which says nothing of
 *   how much;
 * - the seats with a turn at ten times their own median turn or more;
 * - for solves, how many billed past the reserve of their campaign, the count that says whether
 *   `--reserve` is set high enough for a setting. Read it before naming longer limits or a lower
 *   reserve.
 *
 * Written on 13 November, when a reader of the README asked whether a turn budget tracks cost and
 * the answer took a scratch script. Over the 145 campaigns archived from 25 October that day, the
 * 29,241 Opus solves had a rank correlation of 0.82 and billed 0.018 to 0.059 dollars a turn
 * between the 10th and 90th centile, 63 held a turn at ten times their median, the dearest billed
 * 1.61 dollars, and none passed its reserve.
 *
 * It prints counts and dollars, and never a task, an answer or a check.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { campaignLogs } from "#skills/main/logs.ts";
import { formatOf, MISSING, printed } from "#skills/main/print.ts";
import { openingOf } from "#src/campaign/opening.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { SEATS, type Seat, traced, whose } from "#src/kernel/trace.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { median } from "#src/meta/tally.ts";
import { logEvents } from "#tools/runs/registry.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

const SINCE = "2026-10-25";
/** A turn this many times its seat's median turn is one the turn count does not price. */
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

/** One finished seat: what its end says it billed over how many turns, each turn's own dollars, and
 *  for a solve the reserve its campaign held it at. */
export interface Billed {
  readonly seat: Seat;
  readonly model: string;
  readonly turns: number;
  readonly billed: number;
  readonly each: readonly number[];
  readonly reserve: number | null;
}

/** Every solve and session of `events` that ended with a bill on record. A Referee's reading ends
 *  in a finding with no bill of its own, so none is listed. */
export function billedSeats(events: readonly LogEvent[]): Billed[] {
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

/** Each value's rank from 0, ties sharing the mean of the ranks they span. */
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

/** Spearman's rank correlation of `one` with `other`, or null where either does not vary. */
export function rankCorrelation(one: readonly number[], other: readonly number[]): number | null {
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

/** Whether one of a seat's turns cost `DEAR` times its median turn or more. */
const hasDearTurn = ({ each }: Billed): boolean => {
  const middle = median(each);
  return middle !== null && middle > 0 && each.some((turn) => turn >= DEAR * middle);
};

/** One row a seat and model, the largest group first. */
export function billRows(seats: readonly Billed[]): string[][] {
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
      const paths =
        home === null
          ? await Promise.all(args.positionals.map((named) => logAcross(named)))
          : (await campaignLogs(home, [], args.value("since") ?? SINCE)).map(({ path }) => path);
      const seats = paths.flatMap((path) => billedSeats(logEvents(path)));
      console.log(printed(HEAD, billRows(seats), formatOf(args)));
      console.log(`\n${String(paths.length)} logs, ${String(seats.length)} finished seats with a bill.`);
    },
  );
}
