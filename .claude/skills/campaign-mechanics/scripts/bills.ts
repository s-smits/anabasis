#!/usr/bin/env bun
/**
 * Summarises recorded solve and session expenditure against turn counts and the per-solve budget
 * reserve.
 *
 *   bun .claude/skills/campaign-mechanics/scripts/bills.ts <log.jsonl | campaign name>...
 *   bun .claude/skills/campaign-mechanics/scripts/bills.ts --runs <dir> [--since <date>]
 *
 * A campaign is capped in dollars (`--budget`), priced turn by turn from token usage (`billOf`,
 * `src/kernel/meter.ts`). A turn limit bounds each solve as a comparison condition rather than a
 * direct cost limit; the budget reserve (`--reserve`) is the single mechanism linking spend
 * protection to in-flight solves. A new solve starts only when remaining budget covers its reserve
 * alongside active solves (`affords`, `src/campaign/opening.ts`), and running solves are not
 * preempted, so the cap holds provided no solve under the active limits exceeds its reserve. This
 * script reports, grouped by seat and model, whether that condition holds empirically and how
 * closely turn counts track dollar expenditure:
 *
 * - finished seat counts, median turn counts, and spend at the median, 99th percentile, and
 *   maximum;
 * - cost per turn across seats (10th, 50th, and 90th percentiles) and the Spearman rank
 *   correlation between turns and total bill (a value near 1 indicates monotonic ordering rather
 *   than a fixed unit price);
 * - seats containing at least one turn priced at ten times their own median turn or higher;
 * - for solves, the number that exceeded their campaign's reserve, indicating whether `--reserve`
 *   is adequate before raising limits or lowering the reserve.
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

/** Completed seat record: total turns and expenditure, per-turn costs, and the solve reserve when applicable. */
export interface Billed {
  readonly seat: Seat;
  readonly model: string;
  readonly turns: number;
  readonly billed: number;
  readonly each: readonly number[];
  readonly reserve: number | null;
}

/** Extracts every completed solve and session with a recorded bill; Referee findings carry no separate bill and are omitted. */
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

/** Computes zero-based average ranks, assigning tied values the mean of the rank positions they span. */
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

/** Computes Spearman's rank correlation between `one` and `other`, returning null if either series is constant. */
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

/** Returns whether any single turn in the seat cost at least `DEAR` times its median turn. */
const hasDearTurn = ({ each }: Billed): boolean => {
  const middle = median(each);
  return middle !== null && middle > 0 && each.some((turn) => turn >= DEAR * middle);
};

/** Formats one summary row per `(seat, model)` group, ordered from largest to smallest group. */
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
