/**
 * What the rounds that fell short of a step show together: the companion of `stopRule`
 * (`round.ts`) for the other direction.
 *
 * `stopRule` pools every scored task of every compared session to bound the gain from above, and
 * stops the experiment when three sessions leave it flat. Nothing read the same rounds for what a
 * further one would take. This sets the kernel's two readings (`src/kernel/size.ts`) over a log:
 * the short rounds' tallies summed, with why the sum is no test of a step and what a repeat would
 * need, and whether twice the scoring solves buy more as tasks or as solves a side, on the pairs
 * those rounds scored, each read as its report found it (`pairsReported`).
 *
 * It decides nothing: no round is repeated, enlarged or stopped on it.
 */
import { lastReports } from "../kernel/ladder.ts";
import type { LogEvent } from "../kernel/log.ts";
import { boughtBy, shortRounds, together } from "../kernel/size.ts";
import { pairsReported } from "./round.ts";

/** The two readings of the rounds since the last step whose scored test did not clear `level`. */
export function shortOfAStep(events: readonly LogEvent[], level: number) {
  const rounds = shortRounds(events);
  const short = new Set(rounds.map(({ session }) => session));
  const pairs = lastReports(events).flatMap((report) =>
    short.has(report.session) ? pairsReported(events, report) : [],
  );
  return { together: together(rounds, level), bought: boughtBy(pairs, level) };
}
