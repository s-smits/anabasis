/**
 * Lanes 28 and 29: whether a chain of promotions adds up against the starter, and whether an
 * objective-only step won by more than the reference's own noise.
 *
 * Each promotion is read against its parent, so a chain of them can each win and still fail to beat
 * the starter on tasks that did not choose any of them. A starter read mixes three kinds of task
 * (`starterReads`, `src/campaign/climb.ts`), and only the tasks written after the promotion are new
 * to the promoted harness; those are also written by an Examiner that reads the reference's outcomes
 * (`src/examiner/record.ts`), so they may lean against the reference and not the starter. Summed over a
 * campaign's reads, a reference that loses more than it wins there is what lane 28 separates: margin
 * noise selected for, the Examiner's aim, or a worse harness.
 *
 * A step whose untied tasks all tie on validity is carried by the objective alone, and each of its
 * wins is a margin between two valid answers. The report's own A/A is the reference read against
 * itself under the same setting, rebuilt from its solves (`pairsReported`), and on a task whose
 * halves tied on validity its difference is a margin two solves of one harness reach by chance
 * there; a win no larger than its own task's is inside that noise (lane 29). An A/A task its halves split on validity
 * scores up to 600 points, which no win between valid answers can reach (`WEIGHTS`), so it sets no
 * ceiling. Scores are read under this tree's rule (`differenceOf`). Both decide nothing.
 */
import { ORIGINS, type Origin, starterReads } from "#src/campaign/climb.ts";
import { differenceOf, pointsOf, type Tally } from "#src/kernel/compare.ts";
import { lastReports, pairsReported } from "#src/kernel/reports.ts";
import { fired, type Index, share, type Trigger } from "./folds.ts";

const [CHOSEN, BEFORE, AFTER] = ORIGINS;

const wlt = ({ wins, losses, ties }: Tally) => `${String(wins)}-${String(losses)}-${String(ties)}`;

/** `tallies` summed. */
function summed(tallies: readonly Tally[]): Tally {
  return {
    wins: tallies.reduce((total, { wins }) => total + wins, 0),
    losses: tallies.reduce((total, { losses }) => total + losses, 0),
    ties: tallies.reduce((total, { ties }) => total + ties, 0),
  };
}

/** `CHAIN AGAINST THE STARTER` (lane 28): two or more starter reads whose tasks written after their
 *  promotions the reference lost more often than it won, summed over the reads. */
export function chainTrigger(log: Index): Trigger[] {
  const reads = starterReads(log.events);
  if (reads.length < 2) return [];
  const of = (origin: Origin) => summed(reads.map(({ origins }) => origins[origin].whole));
  const after = of(AFTER);
  if (after.losses <= after.wins) return [];
  const each = reads.map(({ session, origins }) => `${session} ${wlt(origins[AFTER].whole)}`);
  const alone = (reading: string) => reads.filter(({ after: read }) => read === reading).length;
  return [
    fired(
      "CHAIN AGAINST THE STARTER",
      `the reference's wins, losses and ties against the starter on tasks written after its promotion, oldest read first: ${each.join(", ")}; summed ${wlt(after)}, on tasks written before and not chosen on ${wlt(of(BEFORE))}, on the tasks that chose the harness ${wlt(of(CHOSEN))}; on the tasks written after alone, ${share(alone("a step"), reads.length)} reads a step and ${String(alone("a step for the starter"))} a step for the starter`,
    ),
  ];
}

/** `MARGINS INSIDE THE NOISE` (lane 29): each step whose untied tasks all tie on validity and more
 *  than half of whose wins are no larger than its own A/A's difference on the same task, where that
 *  task's halves tied on validity; a win on a task with no such A/A difference is not counted
 *  inside. One outlier task no longer sets the ceiling for every win, which put 14 of one step's 20
 *  wins inside against 4 read task by task. A win where its task's A/A tied clears a zero difference
 *  only, so the line counts those, and the tail counts the other such steps most of whose wins were
 *  of that kind, which gives no spread to read a margin against. */
export function marginTrigger(log: Index): Trigger[] {
  const read = lastReports(log.events).flatMap((report) => {
    if (report.data.reading !== "step") return [];
    const untied = pairsReported(log.events, report).filter((pair) => differenceOf(pair) !== 0);
    if (untied.length === 0 || untied.some((pair) => pointsOf(pair).validity !== 0)) return [];
    const spread = new Map(
      pairsReported(log.events, report, "old")
        .filter((pair) => pointsOf(pair).validity === 0)
        .map((pair) => [pair.task, Math.abs(differenceOf(pair))]),
    );
    if (spread.size === 0) return [];
    const wins = untied.filter((pair) => differenceOf(pair) > 0);
    const inside = wins.filter((pair) => differenceOf(pair) <= (spread.get(pair.task) ?? -1)).length;
    const zero = wins.filter((pair) => spread.get(pair.task) === 0).length;
    return [{ session: report.session, wins: wins.length, inside, zero }];
  });
  const lines = read.flatMap(({ session, wins, inside, zero }) =>
    inside * 2 > wins
      ? [
          `${session} won ${share(inside, wins)} by no more than its A/A's difference on the same task where validity tied${zero === 0 ? "" : `, and ${String(zero)} more where that task's A/A tied, clear only of a zero difference`}`,
        ]
      : [],
  );
  const flat = read.filter(({ wins, inside, zero }) => inside * 2 <= wins && zero * 2 > wins).length;
  const tail =
    flat === 0
      ? ""
      : `; ${share(flat, read.length)} objective-only steps won most of their tasks where the A/A tied, which gives no spread to read a margin against`;
  return lines.length > 0 ? [fired("MARGINS INSIDE THE NOISE", `${lines.join("; ")}${tail}`)] : [];
}
